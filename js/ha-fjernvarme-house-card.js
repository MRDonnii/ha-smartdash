const VERSION = "0.1.27";

const FIELDS = [
  ["primary_supply", "Fjernvarme fremløb"], ["primary_return", "Fjernvarme retur"], ["primary_valve", "Fjernvarme hovedventil"], ["summer_cutoff", "Sommerudkobling"],
  ["primary_cooling", "Fjernvarme afkøling"], ["pressure", "Anlægstryk"],
  ["meter_power", "Aktuel effekt"], ["meter_flow", "Aktuelt flow"],
  ["meter_energy_total", "Energi total"], ["meter_volume_total", "Volumen total"],
  ["ch_supply", "Radiator fremløb"], ["ch_return", "Radiator retur"],
  ["ch_valve", "Radiatorventil"], ["ch_flow", "Radiatorflow"],
  ["ch_power", "Radiatoreffekt"], ["ch_outdoor", "Udetemperatur"],
  ["ch_pump", "Radiatorpumpe"], ["dhw_cold_in", "Koldtvand ind"],
  ["dhw_hot_out", "Varmt brugsvand"], ["dhw_flow", "Brugsvandsflow"],
  ["dhw_power", "Brugsvandseffekt"], ["dhw_valve", "Brugsvandsventil"],
  ["dhw_setpoint", "Brugsvand setpunkt"], ["dhw_status", "Brugsvand status"],
  ["circulation_temp", "Cirkulationstemperatur"], ["circulation_status", "Cirkulationsstatus"],
  ["circulation_bypass_temp", "Bypass temperatur"], ["bvv_bypass_status", "Bypass status"],
  ["standby", "Standby"], ["vacation", "Ferie"], ["sentio_active", "Varmekald aktiv"],
  ["sentio_status", "Varmekald status"], ["sentio_call_active", "Varmekald i gang"],
  ["sentio_fejl", "Varmekald fejl"], ["auto_standby_active", "Auto standby"],
  ["auto_standby_status", "Auto standby status"], ["auto_standby_engaged", "Standby aktiveret"],
  ["auto_standby_fejl", "Auto standby fejl"]
];

class HAFjernvarmeHouseCard extends HTMLElement {
  static getStubConfig() {
    return { title: "Fjernvarme", animation: true, entities: Object.fromEntries(FIELDS.map(([k]) => [k, ""])) };
  }
  static async getConfigElement() { return document.createElement("ha-fjernvarme-house-card-editor"); }
  constructor() {
    super(); this.attachShadow({ mode: "open" }); this._config = {}; this._hass = null; this._signature = "";
    this._id = `fvh-${Math.random().toString(36).slice(2, 9)}`;
  }
  setConfig(config) {
    if (!config) throw new Error("Ugyldig konfiguration");
    this._config = { title: "Fjernvarme", animation: true, show_details: true, entities: {}, ...config, entities: { ...(config.entities || {}) } };
    this._signature = ""; this._render();
  }
  set hass(hass) {
    this._hass = hass;
    const ids = [...Object.values(this._config.entities || {}).flat()].filter(v => typeof v === "string");
    const sig = JSON.stringify(ids.map(id => [id, hass?.states?.[id]?.state, hass?.states?.[id]?.attributes?.unit_of_measurement]));
    if (sig !== this._signature) { this._signature = sig; this._render(); }
  }
  getCardSize() { return this._config.show_details === false ? 10 : 15; }
  getGridOptions() { return { rows: "auto", columns: 12, min_columns: 6 }; }
  _entityId(key) {
    const configured = this._config.entities?.[key];
    if (configured) return configured;
    if (key === "summer_cutoff") return Object.keys(this._hass?.states || {}).find(id => /wavin_calefa.*itc_max_outdoor_temp$/.test(id));
    return undefined;
  }
  _entity(key) { const id = this._entityId(key); return id ? this._hass?.states?.[id] : undefined; }
  _num(key) { const n = Number.parseFloat(String(this._entity(key)?.state ?? "").replace(",", ".")); return Number.isFinite(n) ? n : undefined; }
  _on(key) { return ["on","true","active","open","opening","running","heat","heating","ja","aktiv","kører"].includes(String(this._entity(key)?.state || "").toLowerCase()); }
  _flowing(key) { const n=this._num(key); return Number.isFinite(n) ? n > 0.01 : this._on(key); }
  _fmt(key, digits = 1, fallbackUnit = "") {
    const e = this._entity(key); if (!e || ["unknown","unavailable",""].includes(e.state)) return "—";
    const n = this._num(key); if (!Number.isFinite(n)) return this._esc(e.state);
    const lang = this._hass?.locale?.language || this._hass?.language || "da";
    const unit = e.attributes?.unit_of_measurement || fallbackUnit;
    return `${n.toLocaleString(lang,{maximumFractionDigits:digits})}${unit ? ` ${unit}` : ""}`;
  }
  _esc(v) { return String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]); }
  _temp(key) { const n=this._num(key); return Number.isFinite(n) ? `${this._fmt(key,1,"°C")}` : "—"; }
  _tempColor(value) {
    if (!Number.isFinite(value)) return "#8295a5";
    const stops=[[5,[79,145,220]],[15,[92,190,215]],[25,[119,205,190]],[35,[225,188,111]],[50,[238,124,79]],[70,[235,78,70]]];
    if(value<=stops[0][0]) return `rgb(${stops[0][1]})`;
    for(let i=1;i<stops.length;i++){ if(value<=stops[i][0]){const [a,ca]=stops[i-1],[b,cb]=stops[i],t=(value-a)/(b-a);return `rgb(${ca.map((x,j)=>Math.round(x+(cb[j]-x)*t)).join(",")})`;}}
    return `rgb(${stops.at(-1)[1]})`;
  }
  _returnColor(supply, ret) {
    const cooling = Number.isFinite(supply) && Number.isFinite(ret) ? Math.max(0,supply-ret) : this._num("primary_cooling");
    const t = Math.sqrt(Math.max(0,Math.min(1,(cooling || 0)/24)));
    return `hsl(${Math.round(12+198*t)} ${Math.round(82-18*t)}% ${Math.round(59+3*t)}%)`;
  }
  _coolingStatusColor(value) {
    if (!Number.isFinite(value)) return "var(--secondary-text-color)";
    return value >= 20 ? "var(--success-color, #62cf8e)" : "var(--error-color, #ef6666)";
  }
  _pipe(cls, path, active=true, count=8) {
    const duration = 6.1 + count * .08;
    return `<g class="pipe ${cls} ${active ? "active" : ""}"><path class="pipe-rim" d="${path}"/><path class="pipe-core" d="${path}"/><path class="pipe-heat" d="${path}"/><path class="water-sheen" d="${path}"/>${Array.from({length:count},(_,i)=>`<g class="water-pulse"><ellipse cx="0" cy="0" rx="4.5" ry="1.8"/><circle cx="-8" cy="0" r=".8"/><animateMotion dur="${duration}s" begin="-${(i*duration/count).toFixed(2)}s" repeatCount="indefinite" rotate="auto" path="${path}"/></g>`).join("")}</g>`;
  }
  _metric(label,key,digits=1,cls="") { return `<div class="metric entity-hit ${cls}" data-key="${key}" tabindex="0"><small>${label}</small><strong>${this._fmt(key,digits)}</strong></div>`; }
  _status(label,key) { const e=this._entity(key), bad=/fejl|alarm|kritisk/i.test(key)&&this._on(key); return `<div class="metric entity-hit ${bad?"bad":""}" data-key="${key}" tabindex="0"><small>${label}</small><strong>${e?this._esc(e.state):"—"}</strong></div>`; }
  _binaryStatus(label,key,onText,offText) { const e=this._entity(key); return `<div class="metric entity-hit" data-key="${key}" tabindex="0"><small>${label}</small><strong>${e?(this._on(key)?onText:offText):"—"}</strong></div>`; }
  _bindMoreInfo() {
    const open = key => {
      const entityId = this._entityId(key);
      if (!entityId || Array.isArray(entityId)) return;
      this.dispatchEvent(new CustomEvent("hass-more-info",{detail:{entityId},bubbles:true,composed:true}));
    };
    this.shadowRoot.querySelectorAll("[data-key]").forEach(element => {
      element.addEventListener("click",event=>{event.stopPropagation();open(element.dataset.key);});
      element.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();open(element.dataset.key);}});
    });
  }
  _render() {
    if (!this.shadowRoot) return;
    const ps=this._num("primary_supply"), pr=this._num("primary_return"), cs=this._num("ch_supply"), cr=this._num("ch_return"), hot=this._num("dhw_hot_out"), cold=this._num("dhw_cold_in");
    const primaryReturn=this._returnColor(ps,pr), radiatorReturn=this._returnColor(cs,cr);
    const primaryActive=this._flowing("meter_flow");
    const chActive=this._flowing("ch_flow");
    const dhwActive=this._flowing("dhw_flow");
    const bypass=this._on("bvv_bypass_status") || /aktiv|open|on/i.test(String(this._entity("bvv_bypass_status")?.state||""));
    const alarmIds=Array.isArray(this._config.entities?.alarms)?this._config.entities.alarms:[];
    const alarms=alarmIds.filter(id=>["on","true","active","problem"].includes(String(this._hass?.states?.[id]?.state||"").toLowerCase())).length;
    const operating = this._on("standby") ? "Standby" : this._on("vacation") ? "Ferie" : chActive && dhwActive ? "Radiator + varmt vand" : dhwActive ? "Varmt vand" : chActive ? "Radiatorvarme" : "Klar";
    const details = this._config.show_details === false ? "" : `<div class="details">
      <section><h3>Fjernvarme</h3><div class="metric-grid">${this._metric("Fremløb","primary_supply")}${this._metric("Retur","primary_return")}${this._metric("Afkøling","primary_cooling")}${this._metric("Flow","meter_flow",2)}${this._metric("Effekt","meter_power",1)}${this._metric("Anlægstryk","pressure",1)}</div></section>
      <section><h3>Radiator</h3><div class="metric-grid">${this._metric("Fremløb","ch_supply")}${this._metric("Retur","ch_return")}${this._metric("Ventil","ch_valve",0)}${this._metric("Flow","ch_flow",1)}${this._metric("Effekt","ch_power",1)}${this._metric("Udetemperatur","ch_outdoor",1)}</div></section>
      <section><h3>Varmt vand</h3><div class="metric-grid">${this._metric("Koldt ind","dhw_cold_in")}${this._metric("Varmt ud","dhw_hot_out")}${this._metric("Flow","dhw_flow",2)}${this._metric("Ventil","dhw_valve",0)}${this._metric("Effekt","dhw_power",1)}${this._status("Bypass","bvv_bypass_status")}</div></section>
      <section><h3>Drift</h3><div class="metric-grid">${this._binaryStatus("Varmekald","sentio_call_active","Kald","Intet kald")}${this._binaryStatus("Auto standby","auto_standby_engaged","Aktiv","Fra")}${this._binaryStatus("Standby","standby","Til","Fra")}${this._binaryStatus("Ferie","vacation","Til","Fra")}</div></section>
    </div>`;
    this.shadowRoot.innerHTML=`<style>${this._styles(ps,primaryReturn,cs,radiatorReturn,hot,cold)}</style><style>${this._responsiveStyles()}</style><ha-card class="${alarms?"alarm":""}">
      <header><div><small>VARMECENTRAL</small><h2>${this._esc(this._config.title)}</h2></div><div class="chips"><span class="alarm-chip">${alarms?`${alarms} alarm${alarms>1?"er":""}`:"Ingen alarmer"}</span><span>${operating}</span></div></header>
      <div class="hero"><div class="diagram"><svg viewBox="0 0 760 520" role="img" aria-label="Fjernvarmeunit med radiator, varmt vand og bypass">
        <defs>
          <linearGradient id="${this._id}-primary" x1="0" x2="1"><stop stop-color="#ef534f"/><stop offset=".55" stop-color="${this._tempColor(ps)}"/><stop offset="1" stop-color="${primaryReturn}"/></linearGradient>
          <linearGradient id="${this._id}-ch" x1="0" x2="1"><stop stop-color="${this._tempColor(cs)}"/><stop offset="1" stop-color="${radiatorReturn}"/></linearGradient>
          <linearGradient id="${this._id}-dhw" x1="0" x2="1"><stop stop-color="${this._tempColor(hot)}"/><stop offset="1" stop-color="#f2a063"/></linearGradient><linearGradient id="${this._id}-radiator-cooling" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ef514d"/><stop offset=".30" stop-color="#eb965f"/><stop offset=".68" stop-color="#55bebd"/><stop offset="1" stop-color="#4f94dc"/></linearGradient>
        </defs>
        <path class="house" d="M150 68 L430 8 750 68 V506 H150 Z"/><text class="zone" x="34" y="48">FJERNVARMENET</text><text class="zone" x="430" y="50" text-anchor="middle">INDE I HUSET</text>
        ${this._pipe("primary-supply","M24 132 H200",primaryActive,7)}${this._pipe("primary-return","M200 360 H24",primaryActive,7)}
        ${this._pipe("dhw-hot","M380 350 H620 Q640 350 640 330",dhwActive,7)}${this._pipe("dhw-cold","M500 495 V430 H380",dhwActive,7)}
        <g class="unit"><rect x="200" y="80" width="180" height="400" rx="20"/><text class="unit-title" x="290" y="102" text-anchor="middle">WAVIN CALEFA</text>
          <g class="exchanger"><rect x="216" y="110" width="148" height="150" rx="12"/><text class="ex-title" x="290" y="130" text-anchor="middle">RADIATOR</text><g class="exchanger-metrics" text-anchor="middle"><text class="k" x="290" y="151">VENTIL</text><text class="v entity-hit" data-key="ch_valve" tabindex="0" x="290" y="167">${this._fmt("ch_valve",0)}</text><text class="k" x="290" y="188">FLOW</text><text class="v entity-hit" data-key="ch_flow" tabindex="0" x="290" y="204">${this._fmt("ch_flow",1)}</text><text class="k" x="290" y="225">EFFEKT</text><text class="v entity-hit" data-key="ch_power" tabindex="0" x="290" y="241">${this._fmt("ch_power",1)}</text></g></g>
          <g class="exchanger dhw-exchanger"><rect x="216" y="280" width="148" height="150" rx="12"/><text class="ex-title" x="290" y="300" text-anchor="middle">VARMT VAND</text><g class="exchanger-metrics" text-anchor="middle"><text class="k" x="290" y="321">VENTIL</text><text class="v entity-hit" data-key="dhw_valve" tabindex="0" x="290" y="337">${this._fmt("dhw_valve",0)}</text><text class="k" x="290" y="358">FLOW</text><text class="v entity-hit" data-key="dhw_flow" tabindex="0" x="290" y="374">${this._fmt("dhw_flow",1)}</text><text class="k" x="290" y="395">EFFEKT</text><text class="v entity-hit" data-key="dhw_power" tabindex="0" x="290" y="411">${this._fmt("dhw_power",1)}</text></g></g>
          ${bypass ? `<g class="bypass-icon active" transform="translate(345 412)"><circle r="10"/><path d="M-6 -1 A7 7 0 0 1 5 -6 L7 -9 M5 -6 L9 -4 M6 1 A7 7 0 0 1 -5 6 L-7 9 M-5 6 L-9 4"/></g>` : ""}
          <circle cx="200" cy="132" r="5"/><circle cx="200" cy="360" r="5"/><circle cx="380" cy="119" r="5"/><circle cx="380" cy="220" r="5"/><circle cx="380" cy="350" r="5"/><circle cx="380" cy="430" r="5"/>
        </g>
        <g class="radiator" transform="translate(587 102)"><rect width="146" height="135" rx="12"/></g>${this._pipe("ch-circuit","M380 119 H612 V205 H628 V119 H644 V205 H660 V119 H676 V205 H692 V119 H708 V220 H380",chActive,8)}
        <g class="label entity-hit" data-key="ch_supply" tabindex="0" transform="translate(500 60)" text-anchor="middle"><text>Radiator fremløb</text><text class="label-value" style="font-size:29.25px" y="29">${this._temp("ch_supply")}</text></g><g class="label entity-hit" data-key="ch_return" tabindex="0" transform="translate(500 161)" text-anchor="middle"><text>Radiator retur</text><text class="label-value" style="font-size:29.25px" y="29">${this._temp("ch_return")}</text></g><g class="label entity-hit" data-key="dhw_hot_out" tabindex="0" transform="translate(500 278)" text-anchor="middle"><text>Varmt brugsvand</text><text class="label-value" style="font-size:29.25px" y="29">${this._temp("dhw_hot_out")}</text></g><g class="label entity-hit" data-key="dhw_cold_in" tabindex="0" transform="translate(500 370)" text-anchor="middle"><text>Koldtvand ind</text><text class="label-value" style="font-size:29.25px" y="29">${this._temp("dhw_cold_in")}</text></g><g class="tap ${dhwActive ? "active" : ""}" transform="translate(610 270)"><path class="tap-body" d="M30 60 V31 Q30 16 45 16 H78 Q90 16 90 28 V35"/><path class="tap-handle" d="M20 31 H40 M30 21 V41"/><path class="tap-outlet" d="M90 35 V47"/><path class="basin" d="M7 68 H108 L98 88 Q58 99 17 88 Z"/><path class="drop" d="M90 54 C81 66 85 75 90 75 C96 75 100 66 90 54Z"/><text x="58" y="111" text-anchor="middle">VARMT VAND</text></g>
        <g class="label primary in entity-hit" data-key="primary_supply" tabindex="0" transform="translate(75 68)" text-anchor="middle"><text>Fjernvarme fremløb</text><text class="label-value" style="font-size:31.5px" y="30">${this._temp("primary_supply")}</text><text class="pipe-meta" y="51"><tspan class="entity-hit" data-key="meter_flow" tabindex="0">${this._fmt("meter_flow",1)}</tspan><tspan> · </tspan><tspan class="entity-hit" data-key="meter_power" tabindex="0">${this._fmt("meter_power",1)}</tspan></text></g><g class="delta entity-hit" data-key="primary_cooling" tabindex="0" transform="translate(75 176)"><text text-anchor="middle">AFKØLING</text><text class="label-value" style="font-size:28.5px" text-anchor="middle" y="32">${this._fmt("primary_cooling",1)}</text></g><g class="circuit-meta entity-hit" data-key="summer_cutoff" tabindex="0" transform="translate(75 237)" text-anchor="middle"><text y="-5">SOMMER</text><text y="7">UDKOBLING</text><text class="label-value" style="font-size:18px" y="31">${this._temp("summer_cutoff")}</text></g><g class="label primary out entity-hit" data-key="primary_return" tabindex="0" transform="translate(75 315)" text-anchor="middle"><text>Retur</text><text class="label-value" style="font-size:31.5px" y="31">${this._temp("primary_return")}</text></g><g class="outdoor-value entity-hit" data-key="ch_outdoor" tabindex="0" transform="translate(430 -42)" text-anchor="middle"><text>UDETEMPERATUR</text><text class="value" style="font-size:22.5px" y="24">${this._temp("ch_outdoor")}</text></g>
        
        

      </svg></div><aside>${this._metric("Effekt","meter_power",1)}${this._metric("Flow","meter_flow",2)}${this._metric("Tryk","pressure",1)}${this._metric("Radiatorventil","ch_valve",0)}${this._metric("BV-ventil","dhw_valve",0)}</aside></div>${details}
    </ha-card>`;
    this._bindMoreInfo();
  }
  _styles(ps,pr,cs,cr,hot,cold) { return `
    :host{display:block}ha-card{box-sizing:border-box;padding:16px;overflow:hidden;background:linear-gradient(145deg,color-mix(in srgb,var(--card-background-color) 96%,#132333),var(--card-background-color));color:var(--primary-text-color);border:1px solid color-mix(in srgb,var(--divider-color) 65%,transparent);border-radius:28px}header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:3px 7px 9px}header small{font-size:10px;letter-spacing:.18em;color:var(--secondary-text-color)}h2{font-size:25px;margin:3px 0 0}.chips{display:flex;gap:7px;align-items:center;justify-content:flex-end;flex-wrap:wrap}.chips span{font-size:10px;padding:7px 10px;border:1px solid color-mix(in srgb,var(--success-color,#62cfad) 32%,transparent);border-radius:18px;color:var(--success-color,#7bd9ba);background:#55cba908}.alarm .alarm-chip{color:#f18787;border-color:#e7666655;background:#e7666610}.hero{display:grid;grid-template-columns:minmax(0,1fr) 92px;gap:10px}.diagram{min-width:0;aspect-ratio:760/520}.diagram svg{width:100%;height:100%;overflow:visible}.house{fill:#7ea7ba07;stroke:#78a4b940;stroke-width:1.5}.zone{font-size:10px;letter-spacing:1.6px;font-weight:700;fill:var(--secondary-text-color)}.pipe-rim,.pipe-core,.pipe-heat,.water-sheen{fill:none;stroke-linecap:round;stroke-linejoin:round}.pipe-rim{stroke:#8597a5;stroke-width:18;opacity:.75}.pipe-core{stroke:#1b2b35;stroke-width:14}.pipe-heat{stroke-width:9;opacity:.65}.water-sheen{display:none;stroke:rgba(222,247,255,.38);stroke-width:1.4;stroke-dasharray:3 16;filter:drop-shadow(0 0 1.5px rgba(190,236,255,.34))}.pipe.active .water-sheen{display:inline;animation:water-shimmer 3.2s linear infinite}.primary-supply .pipe-heat{stroke:#ed554f}.primary-return .pipe-heat{stroke:${pr}}.ch-circuit .pipe-heat{stroke:url(#${this._id}-radiator-cooling)}.ch-circuit .water-sheen{stroke-width:1.2;opacity:.38;animation-duration:4.4s!important}.ch-circuit .water-pulse{fill:rgba(231,249,255,.60);opacity:.46;transform:scale(.62)}.dhw-hot .pipe-heat{stroke:url(#${this._id}-dhw)}.dhw-cold .pipe-heat{stroke:${this._tempColor(cold)}}.water-pulse{display:none;fill:rgba(230,249,255,.66);filter:drop-shadow(0 0 2px rgba(195,239,255,.30));opacity:.62}.water-pulse circle{fill:rgba(255,255,255,.36)}.pipe.active .water-pulse{display:inline}.pipe:not(.active){opacity:.42}.pipe:not(.active) .water-sheen{display:none;animation:none}.unit rect{fill:#162631;stroke:#83a9ba;stroke-width:1.7}.unit text{font-size:8px;font-weight:700;letter-spacing:1px;fill:#a9bcc7}.unit .unit-title{font-size:9px}.exchanger .ex-title{font-size:9px}.exchanger-metrics .k{font-size:6.5px;fill:var(--secondary-text-color);font-weight:600}.exchanger-metrics .v{font-size:12px;fill:var(--primary-text-color);font-weight:700;letter-spacing:0}.exchanger-metrics .v.small{font-size:8px}.primary-row text{font-size:7px;fill:var(--secondary-text-color);letter-spacing:.05em}.primary-row .value{font-size:14px;font-weight:700;fill:var(--primary-text-color);letter-spacing:0}.primary-row .primary-flow{font-size:8px;fill:var(--secondary-text-color)}.outdoor-value text,.outdoor-value .value{font-size:8px;letter-spacing:.08em;fill:var(--secondary-text-color)}.outdoor-value .value{font-weight:700;letter-spacing:0;fill:var(--primary-text-color)}.unit circle{fill:#dce8ed;stroke:#13202a}.exchanger rect{fill:#1c2d38;stroke:#7598aa;stroke-width:1;opacity:.85}.exchanger path{fill:none;stroke:#7598aa;stroke-width:3.5;opacity:.85}.radiator>rect{fill:#1a2a35;stroke:#94aeba;stroke-width:1.5}.radiator .fin{fill:#253b47;stroke:#688492;stroke-width:.7}.radiator text,.tap text{font-size:8px;letter-spacing:1px;fill:var(--secondary-text-color)}.unit-valve circle{fill:#192a35;stroke:#d7a06f;stroke-width:1.2}.unit-valve path{fill:none;stroke:#e5b17d;stroke-width:1.3}.unit-valve text{font-size:6.5px;letter-spacing:.04em;fill:#e9c39d}.primary-unit-valve text{fill:#b9cbd4}.tap .tap-body,.tap .tap-outlet{fill:none;stroke:#9bb0ba;stroke-width:5;stroke-linecap:round;stroke-linejoin:round}.tap .tap-handle{fill:none;stroke:#b9cbd3;stroke-width:3;stroke-linecap:round}.tap .basin{fill:#172832;stroke:#7894a2;stroke-width:2;stroke-linejoin:round}.tap .drop{fill:${this._tempColor(hot)};stroke:none;opacity:0}.tap.active .drop{animation:drop 2s ease-in infinite}.label text,.bypass-label text,.bypass-icon text,.circuit-meta text,.delta text{font-size:9px;fill:var(--secondary-text-color)}.bypass-icon circle{fill:#1b2c37;stroke:#7898a8;stroke-width:1.5}.bypass-icon path{fill:none;stroke:#7898a8;stroke-width:2;stroke-linecap:round}.bypass-icon text{fill:var(--secondary-text-color);font-size:8px}.bypass-icon .label-value{fill:var(--primary-text-color);font-size:12px;font-weight:650}.bypass-icon.active circle{stroke:#e99a6f;filter:drop-shadow(0 0 5px #e87e5855)}.bypass-icon.active path{stroke:#e99a6f;transform-origin:center;animation:bypass-turn 2.4s linear infinite}.circuit-meta text{fill:var(--secondary-text-color);font-size:8px}.circuit-meta .label-value{fill:var(--primary-text-color);font-size:12px;font-weight:650}.label .pipe-meta{font-size:9px;fill:#b7c4cc}.label .label-value,.bypass-label .label-value,.delta .label-value{font-size:15px;font-weight:650;fill:var(--primary-text-color)}.label.primary .label-value{font-size:21px}.delta .label-value{font-size:19px;fill:${this._coolingStatusColor(this._num("primary_cooling"))}}aside{display:grid;grid-template-rows:repeat(5,1fr);border-left:1px solid #ffffff14;padding-left:8px}.metric{min-width:0;display:flex;flex-direction:column;justify-content:center;text-align:center;padding:7px 4px}.metric small,.metric strong{display:block;overflow:hidden;text-overflow:ellipsis}.metric small{font-size:8px;color:var(--secondary-text-color);white-space:normal}.metric strong{font-size:13px;font-weight:600;margin-top:3px;white-space:nowrap}.details{display:grid;grid-template-columns:1.05fr 1fr 1.25fr 1.2fr;gap:8px;padding-top:11px;margin-top:5px;border-top:1px solid #ffffff12}.details section{min-width:0;padding:9px;border:1px solid #ffffff0e;border-radius:13px;background:#ffffff04}.details h3{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--secondary-text-color);margin:0 0 6px}.metric-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px}.metric-grid .metric{border-radius:8px;background:#ffffff04;min-height:37px}.metric.bad strong{color:#ef7777}@keyframes bypass-turn{to{transform:rotate(360deg)}}@keyframes water-shimmer{to{stroke-dashoffset:-38}}@keyframes drop{0%,35%{transform:translateY(-3px);opacity:0}60%{opacity:1}100%{transform:translateY(10px);opacity:0}}${this._config.animation===false?".water-pulse{display:none!important}.water-sheen,.drop,.bypass-icon.active path{animation:none!important}":""}@media(prefers-reduced-motion:reduce){.water-pulse{display:none!important}.water-sheen,.drop,.bypass-icon.active path{animation:none!important}}@media(max-width:700px){ha-card{padding:11px;border-radius:22px}.hero{grid-template-columns:minmax(0,1fr) 72px}.details{grid-template-columns:repeat(2,minmax(0,1fr))}h2{font-size:21px}.chips .alarm-chip{display:none}}@media(max-width:480px){.hero{grid-template-columns:1fr}.diagram{aspect-ratio:760/540}aside{grid-template-columns:repeat(5,minmax(0,1fr));grid-template-rows:auto;border-left:0;border-top:1px solid #ffffff14;padding:5px 0 0}.details{grid-template-columns:1fr}.chips span{font-size:8px;padding:5px 7px}.label.primary .label-value{font-size:18px}}
  `; }
  _responsiveStyles() { return `
    :host {
      container-type: inline-size;
      --fv-bg: var(--primary-background-color, #1c1c1c);
      --fv-fg: var(--primary-text-color);
      --fv-muted: var(--secondary-text-color);
      --fv-component: color-mix(in srgb, var(--fv-bg) 91%, var(--fv-fg) 9%);
      --fv-component-strong: color-mix(in srgb, var(--fv-bg) 68%, var(--fv-fg) 32%);
      --fv-line: color-mix(in srgb, var(--fv-fg) 18%, transparent);
    }
    ha-card {
      background: var(--ha-card-background, var(--card-background-color, var(--fv-bg)));
      color: var(--fv-fg);
      border-color: var(--fv-line);
    }
    .label > text:first-child, .outdoor-value > text:first-child { font-size: 10.5px; }
    .label .label-value, .outdoor-value .value {
      fill: color-mix(in srgb, var(--fv-fg) 78%, var(--fv-bg));
    }
    .label .label-value { font-size: 26px !important; }
    .label.primary .label-value { font-size: 28px !important; }
    .outdoor-value .value { font-size: 20px !important; }
    .house { fill: color-mix(in srgb, var(--fv-fg) 2%, transparent); stroke: var(--fv-line); }
    .pipe-rim { stroke: color-mix(in srgb, var(--fv-fg) 42%, var(--fv-bg)); }
    .pipe-core { stroke: color-mix(in srgb, var(--fv-bg) 54%, var(--fv-fg) 46%); }
    .unit rect, .exchanger rect, .radiator > rect, .radiator .fin,
    .unit-valve circle, .bypass-icon circle, .tap .basin {
      fill: var(--fv-component);
      stroke: color-mix(in srgb, var(--fv-fg) 38%, transparent);
    }
    .exchanger path, .tap .tap-body, .tap .tap-outlet, .tap .tap-handle,
    .bypass-icon path { stroke: color-mix(in srgb, var(--fv-fg) 48%, transparent); }
    .unit circle { fill: color-mix(in srgb, var(--fv-bg) 35%, var(--fv-fg) 65%); stroke: var(--fv-bg); }
    .unit text, .unit-valve text, .label .pipe-meta { fill: var(--fv-muted); }
    aside, .details { border-color: var(--fv-line); }
    .details section, .metric-grid .metric {
      border-color: var(--fv-line);
      background: color-mix(in srgb, var(--fv-fg) 4%, transparent);
    }
    .entity-hit { cursor: pointer; }
    .entity-hit:focus-visible { outline: 2px solid var(--info-color, #4aa3ff); outline-offset: 2px; }
    .ch-circuit.active .pipe-heat {
      opacity: .92;
      filter: drop-shadow(0 0 4px color-mix(in srgb, var(--warning-color, #f2994a) 58%, transparent));
    }
    .ch-circuit.active .water-sheen {
      stroke-width: 2.3;
      opacity: .88;
      stroke-dasharray: 5 12;
      filter: drop-shadow(0 0 3px rgba(225, 248, 255, .72));
      animation-duration: 2.5s !important;
    }
    .ch-circuit.active .water-pulse {
      opacity: .9;
      transform: scale(.92);
      filter: drop-shadow(0 0 4px rgba(221, 247, 255, .78));
    }
    @container (max-width: 700px) {
      ha-card { padding: 12px 9px; border-radius: 22px; }
      header { padding: 1px 4px 8px; }
      header small { font-size: 11px; }
      h2 { font-size: 26px; }
      .chips { max-width: 52%; }
      .chips .alarm-chip { display: inline-flex; }
      .chips span { font-size: 11px; padding: 7px 9px; }
      .hero { grid-template-columns: 1fr; gap: 8px; }
      .diagram { width: 100%; aspect-ratio: 760 / 520; }
      aside {
        grid-template-columns: repeat(5, minmax(0, 1fr));
        grid-template-rows: auto;
        border-left: 0;
        border-top: 1px solid var(--fv-line);
        padding: 8px 0 0;
      }
      aside .metric { min-width: 0; padding: 6px 2px; }
      aside .metric small { font-size: 9px; line-height: 1.15; }
      aside .metric strong { font-size: 14px; }
      .zone { font-size: 10px; }
      .unit text { font-size: 8.5px; }
      .unit .unit-title, .exchanger .ex-title { font-size: 9.5px; }
      .exchanger-metrics .k { font-size: 7.5px; }
      .exchanger-metrics .v { font-size: 13px; }
      .label text, .circuit-meta text, .delta text { font-size: 10px; }
      .label > text:first-child, .outdoor-value > text:first-child { font-size: 10px; }
      .label .label-value { font-size: 25px !important; }
      .label.primary .label-value { font-size: 27px !important; }
      .delta .label-value { font-size: 25px !important; }
      .circuit-meta .label-value { font-size: 16px !important; }
      .outdoor-value text { font-size: 10px; }
      .outdoor-value .value { font-size: 19px !important; }
      .label .pipe-meta { font-size: 9px; }
      .tap text { font-size: 8px; }
      .details { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
      .details section { padding: 8px 6px; }
      .metric-grid .metric { min-height: 42px; }
      .metric-grid .metric small { font-size: 10px; }
      .metric-grid .metric strong { font-size: 17px; }
    }
  `; }
}

class HAFjernvarmeHouseCardEditor extends HTMLElement {
  setConfig(config){this._config=config||{};this._render();}
  set hass(hass){this._hass=hass;if(this._form)this._form.hass=hass;}
  _render(){
    if(!this._config)return;
    this.innerHTML=`<style>:host{display:block;padding:12px}.hint{color:var(--secondary-text-color);font-size:12px;margin:0 0 12px}</style><p class="hint">Alle felter kan ændres. Tomme felter vises som — på kortet.</p><ha-form></ha-form>`;
    this._form=this.querySelector("ha-form"); this._form.hass=this._hass; this._form.data=this._config;
    this._form.schema=[{name:"title",selector:{text:{}}},{name:"animation",selector:{boolean:{}}},{name:"show_details",selector:{boolean:{}}},{type:"expandable",name:"entities",title:"Entiteter",schema:FIELDS.map(([name,label])=>({name,label,selector:{entity:{}}}))}];
    this._form.computeLabel=s=>s.label||s.name;
    this._form.addEventListener("value-changed",e=>{this.dispatchEvent(new CustomEvent("config-changed",{detail:{config:e.detail.value},bubbles:true,composed:true}));});
  }
}

if(!customElements.get("ha-fjernvarme-house-card"))customElements.define("ha-fjernvarme-house-card",HAFjernvarmeHouseCard);
if(!customElements.get("ha-fjernvarme-house-card-editor"))customElements.define("ha-fjernvarme-house-card-editor",HAFjernvarmeHouseCardEditor);
window.customCards=window.customCards||[];window.customCards.push({type:"ha-fjernvarme-house-card",name:"HA Fjernvarme House Card",description:"Fjernvarmeunit med temperaturstyrede rør, radiator, varmt vand og bypass",preview:true});
console.info(`%c HA-FJERNVARME-HOUSE-CARD %c ${VERSION} `,"color:#fff;background:#bb433f;font-weight:700","color:#bb433f;background:#fff");
