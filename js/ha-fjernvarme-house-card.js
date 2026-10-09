const VERSION = "0.3.3";

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
    this._detachedSignature = undefined;
    this._detailsPopupEl = undefined;
    this._detailsPopupCard = undefined;
    this.shadowRoot.addEventListener("click", event => this._handleMoreInfo(event));
    this.shadowRoot.addEventListener("keydown", event => this._handleMoreInfo(event));
  }
  connectedCallback() {
    // Catch up on state that arrived while this tab was unselected. Forcing the
    // structural rebuild (_render(true)) is what restarts the pipe-flow
    // animations cleanly rather than morphing into a half-animated tree.
    if (this._detachedSignature !== undefined) {
      this._signature = this._detachedSignature;
      this._detachedSignature = undefined;
      this._render(true);
    }
  }
  disconnectedCallback() { this._closeDetailsPopup(); }
  setConfig(config) {
    if (!config) throw new Error("Ugyldig konfiguration");
    const nextConfig = { title: "Fjernvarme", animation: true, show_details: true,details_title: "Calefa styring", ...config, entities: { ...(config.entities || {}) }, details_entities: { ...(config.details_entities || {}) } };
    const signature = JSON.stringify(nextConfig);
    this._config = nextConfig;
    if (signature === this._configSignature) return;
    this._configSignature = signature;
    this._signature = ""; this._render(true);
  }
  set hass(hass) {
    this._hass = hass;
    if (this._detailsPopupCard) this._detailsPopupCard.hass = hass;
    if (this._popupCards) this._popupCards.forEach(card => { card.hass = hass; });
    const ids = [...Object.values(this._config.entities || {}).flat()].filter(v => typeof v === "string");
    const sig = JSON.stringify(ids.map(id => [id, hass?.states?.[id]?.state, hass?.states?.[id]?.attributes?.unit_of_measurement]));
    if (sig === this._signature) return;
    // Detached behind an unselected tab: the wrapper still forwards every hass
    // tick, but rendering would rebuild the full unit/pipe SVG for a tree that
    // is not in the document. Defer to connectedCallback().
    if (!this.isConnected) { this._detachedSignature = sig; return; }
    this._signature = sig;
    this._render();
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
  _on(key) { return ["on","true","active","open","opening","running","heat","heating","ja","til","aktiv","kører"].includes(String(this._entity(key)?.state || "").toLowerCase()); }
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
  _standbyStatus() { const e=this._entity("auto_standby_status"), countdown=e?.attributes?.countdown; const value=e?`${this._esc(e.state)}${countdown?` · ${this._esc(countdown)}`:""}`:"—"; return `<div class="metric entity-hit" data-key="auto_standby_status" tabindex="0"><small>Auto standby</small><strong>${value}</strong></div>`; }
  _binaryStatus(label,key,onText,offText) { const e=this._entity(key); return `<div class="metric entity-hit" data-key="${key}" tabindex="0"><small>${label}</small><strong>${e?(this._on(key)?onText:offText):"—"}</strong></div>`; }
  _handleMoreInfo(event) {
    if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
    const detailsBtn = event.target?.closest?.("[data-open-details]");
    if (detailsBtn) {
      if (event.type === "keydown") event.preventDefault();
      event.stopPropagation();
      this._openDetailsPopup();
      return;
    }
    const popupBtn = event.target?.closest?.("[data-open-popup]");
    if (popupBtn) {
      if (event.type === "keydown") event.preventDefault();
      event.stopPropagation();
      this._openCardsPopup(Number(popupBtn.dataset.openPopup));
      return;
    }
    const element = event.target?.closest?.("[data-key]");
    if (!element) return;
    if (event.type === "keydown") event.preventDefault();
    event.stopPropagation();
    const entityId = this._entityId(element.dataset.key);
    if (!entityId || Array.isArray(entityId)) return;
    this.dispatchEvent(new CustomEvent("hass-more-info",{detail:{entityId},bubbles:true,composed:true}));
  }
  _openDetailsPopup() {
    if (!Object.keys(this._config.details_entities || {}).length) return;
    const { backdrop, host } = this._popupShell(this._config.details_title || "Detaljer");
    this._mountDetailsCard(host, backdrop);
  }

  // Faelles popup-skal (baggrund, panel, luk-knap, Escape, scroll-laas) for
  // baade "Calefa styring" og de ekstra kort-popups.
  _popupShell(label) {
    this._closeDetailsPopup();
    const backdrop = document.createElement("div");
    // Padding keeps the dialog clear of the OS status bar / notch: without it
    // the panel reaches the very top of the viewport on mobile and the close
    // button ends up underneath the clock. env() covers notched devices; the
    // max() floor covers webviews that report no safe-area inset at all.
    backdrop.style.cssText = "position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding-top:max(calc(env(safe-area-inset-top,0px) + 12px),48px);padding-bottom:max(calc(env(safe-area-inset-bottom,0px) + 12px),16px);padding-left:calc(env(safe-area-inset-left,0px) + 8px);padding-right:calc(env(safe-area-inset-right,0px) + 8px);background:rgba(5,9,15,.68);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px)";
    const panel = document.createElement("div");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", label);
    panel.tabIndex = -1;
    // The panel itself must never scroll: the close button is absolutely
    // positioned against it, so if the panel were the scroll container the
    // button would scroll out of reach on tall content. Only `host` scrolls.
    panel.style.cssText = "position:relative;display:flex;flex-direction:column;width:min(100%,900px);max-height:100%;overflow:hidden;border-radius:24px;box-shadow:0 28px 80px rgba(0,0,0,.58);outline:none";
    const closeBtn = document.createElement("button");
    closeBtn.setAttribute("aria-label", "Luk popup");
    closeBtn.textContent = "×";
    closeBtn.style.cssText = "position:absolute;top:12px;right:12px;z-index:20;min-width:40px;min-height:40px;border:1px solid var(--divider-color,rgba(255,255,255,.22));border-radius:50%;background:var(--card-background-color,rgba(10,14,20,.72));backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:var(--primary-text-color,#fff);font-size:20px;line-height:1;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)";
    closeBtn.addEventListener("click", () => this._closeDetailsPopup());
    const host = document.createElement("div");
    host.style.cssText = "flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch";
    panel.appendChild(closeBtn);
    panel.appendChild(host);
    backdrop.appendChild(panel);
    backdrop.addEventListener("click", event => { if (event.target === backdrop) this._closeDetailsPopup(); });
    this._escapeHandler = event => { if (event.key === "Escape") this._closeDetailsPopup(); };
    document.addEventListener("keydown", this._escapeHandler);
    this._bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.appendChild(backdrop);
    this._detailsPopupEl = backdrop;
    panel.focus();
    return { backdrop, panel, host };
  }

  // Popup med almindelige Lovelace-kort fra extra_popups[i].cards.
  // Bygger et enkelt Lovelace-kort til en popup og fanger fejl lokalt, saa
  // et enkelt daarligt kort viser en fejlkasse i stedet for at vaelte hele
  // popuppen. window.loadCardHelpers().createCardElement() returnerer i sig
  // selv typisk en hui-error-card ved ukendt type, men "set hass" paa det
  // faerdige element kan stadig kaste (fx manglende entitet i konfigen) -
  // det er lige praecis det tilfaelde der ikke var daekket foer.
  _byggKortSikkert(cfg) {
    try {
      if (!this._helpers) throw new Error("kort-hjaelpere ikke indlaest endnu");
      const el = this._helpers.createCardElement(cfg);
      el.hass = this._hass;
      return el;
    } catch (error) {
      console.error("HA Fjernvarme House Card: kunne ikke bygge popup-kort", cfg?.type, error);
      const boks = document.createElement("div");
      boks.style.cssText = "padding:14px;border-radius:12px;color:var(--error-color,#fca5a5);background:color-mix(in srgb,var(--error-color,#ef4444) 12%,transparent);font:12px/1.5 -apple-system,sans-serif;white-space:pre-wrap";
      boks.textContent = `Kunne ikke vise kortet "${cfg?.type || "?"}": ${error?.message || error}`;
      return boks;
    }
  }

  async _openCardsPopup(index) {
    const def = (Array.isArray(this._config.extra_popups) ? this._config.extra_popups : [])[index];
    if (!def || !Array.isArray(def.cards) || !def.cards.length) return;
    const { backdrop, panel, host } = this._popupShell(def.title || "Detaljer");
    // Calefa-kortet har sin egen flade; almindelige kort skal have en under sig.
    panel.style.background = "var(--card-background-color, #1c1f26)";
    host.style.boxSizing = "border-box";
    host.style.padding = "18px";
    const titel = document.createElement("div");
    titel.textContent = def.title || "";
    titel.style.cssText = "margin:4px 56px 14px 4px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--secondary-text-color)";
    const status = document.createElement("div");
    status.textContent = "Indlæser…";
    status.style.cssText = "padding:18px 4px;color:var(--secondary-text-color)";
    host.replaceChildren(titel, status);

    let helpers;
    try {
      helpers = await window.loadCardHelpers();
      this._helpers = helpers;
    } catch (error) {
      status.style.color = "#fca5a5";
      status.textContent = `Kunne ikke indlæse kortene: ${error?.message || error}`;
      return;
    }
    if (this._detailsPopupEl !== backdrop) return;

    const liste = document.createElement("div");
    liste.style.cssText = "display:flex;flex-direction:column;gap:12px";
    // Hvert kort bygges hver for sig. Uden try/catch her stoppede EET
    // fejlende kort (fx en manglende entitet der faar button-card's
    // set hass() til at kaste) heleaanden af .map()-loekken, og popuppen
    // blev haengende paa "Indlaeser..." for evigt - det var fejlen der
    // fik "Forbrug" til aldrig at loade.
    const kort = def.cards.map(cfg => {
      const el = this._byggKortSikkert(cfg);
      liste.appendChild(el);
      return el;
    });

    // Normalt fanger hui-card "ll-rebuild" og bygger kortet om - fx naar et
    // custom element foerst bliver defineret, eller naar et button-card har
    // hentet statistik og vil tegnes igen. Den vaert findes ikke i en popup,
    // saa uden dette ville de kort blive haengende i deres tomme tilstand.
    // Flere kort her deler samme globale cache-noegle (window.__fv_stats) for
    // at undgaa dobbelt-hentning. Det betoed at KUN det kort der selv vandt
    // kaploebet om at hente data fik glaeden af sit eget ll-rebuild-event -
    // et soeskendekort der bare ventede paa den delte cache fik aldrig besked
    // om at dataen var klar, og blev haengende paa "Indlaeser..." for evigt.
    // Byg derfor ALLE kort om ved enhver ll-rebuild, med EEN faelles vagt mod
    // genopbygnings-loekker i stedet for en pr. kort.
    let sidstAlle = 0;
    liste.addEventListener("ll-rebuild", ev => {
      ev.stopPropagation();
      const nu = Date.now();
      if (nu - sidstAlle < 1000) return;
      sidstAlle = nu;
      def.cards.forEach((cfg, i) => {
        const nyt = this._byggKortSikkert(cfg);
        kort[i].replaceWith(nyt);
        kort[i] = nyt;
      });
    });

    host.replaceChildren(titel, liste);
    this._popupCards = kort;
  }

  async _mountDetailsCard(host, backdrop) {
    const tag = "ha-calefa-details-card";
    const showError = message => {
      host.innerHTML = `<div style="padding:22px;color:var(--error-color,#fca5a5);background:color-mix(in srgb,var(--error-color,#ef4444) 12%,transparent);border-radius:16px;font:13px/1.5 -apple-system,sans-serif;white-space:pre-wrap">${this._esc(message)}</div>`;
    };
    // The details card ships in a separate dashboard resource, so at click
    // time it may not have finished evaluating yet (slow network, a resource
    // loaded later in the list, a cold page). Waiting on whenDefined() instead
    // of failing on a synchronous get() makes the popup immune to load order;
    // the timeout only exists so a genuinely missing resource still reports
    // something actionable instead of spinning forever.
    if (!customElements.get(tag)) {
      host.innerHTML = `<div style="padding:22px;color:var(--secondary-text-color,#9ba9b7);font:13px/1.5 -apple-system,sans-serif">Indlæser ${this._esc(tag)}…</div>`;
      let timeoutId;
      try {
        await Promise.race([
          customElements.whenDefined(tag),
          new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error("timeout")), 10000); })
        ]);
      } catch {
        showError(`Kortet "${tag}" blev ikke indlæst.\nTjek at ressourcen ha-fjernvarme-card.js er registreret under Indstillinger → Dashboards → Ressourcer.`);
        console.error(`HA Fjernvarme House Card: custom element "${tag}" never got defined`);
        return;
      } finally {
        clearTimeout(timeoutId);
      }
    }
    if (this._detailsPopupEl !== backdrop) return;
    let card;
    try {
      card = document.createElement(tag);
      card.setConfig({ title: this._config.details_title || "Detaljer", entities: this._config.details_entities });
    } catch (error) {
      showError(`Fejl i ${tag}:\n${error?.message || error}`);
      console.error(`HA Fjernvarme House Card: ${tag} setConfig() threw`, error);
      return;
    }
    if (this._detailsPopupEl !== backdrop) return;
    card.hass = this._hass;
    host.replaceChildren(card);
    this._detailsPopupCard = card;
  }
  _closeDetailsPopup() {
    this._detailsPopupEl?.remove();
    this._detailsPopupEl = undefined;
    this._detailsPopupCard = undefined;
    this._popupCards = undefined;
    if (this._bodyOverflow !== undefined) document.body.style.overflow = this._bodyOverflow;
    this._bodyOverflow = undefined;
    if (this._escapeHandler) document.removeEventListener("keydown", this._escapeHandler);
    this._escapeHandler = undefined;
  }
  _render(forceStructure = false) {
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
      <section><h3>Drift</h3><div class="metric-grid">${this._binaryStatus("Radiatorpumpe","ch_pump","Til","Fra")}${this._standbyStatus()}${this._binaryStatus("Standby","standby","Til","Fra")}${this._binaryStatus("Ferie","vacation","Til","Fra")}</div></section>
    </div>`;
    const markup=`<style>${this._styles(ps,primaryReturn,cs,radiatorReturn,hot,cold)}</style><style>${this._responsiveStyles()}</style><ha-card class="${alarms?"alarm":""}">
      <header><div><small>VARMECENTRAL</small><h2>${this._esc(this._config.title)}</h2></div><div class="chips">${Object.keys(this._config.details_entities || {}).length ? `<button class="details-btn" data-open-details><ha-icon icon="mdi:tune-variant"></ha-icon>${this._esc(this._config.details_title || "Detaljer")}</button>` : ""}${(Array.isArray(this._config.extra_popups) ? this._config.extra_popups : []).map((p, i) => Array.isArray(p?.cards) && p.cards.length ? `<button class="details-btn" data-open-popup="${i}"><ha-icon icon="${this._esc(p.icon || "mdi:view-grid-outline")}"></ha-icon>${this._esc(p.title || "Mere")}</button>` : "").join("")}<span class="alarm-chip">${alarms?`${alarms} alarm${alarms>1?"er":""}`:"Ingen alarmer"}</span><span>${operating}</span></div></header>
      <div class="hero"><div class="diagram"><svg viewBox="0 0 760 520" role="img" aria-label="Fjernvarmeunit med radiator, varmt vand og bypass">
        <defs>
          <linearGradient id="${this._id}-primary" x1="0" x2="1"><stop stop-color="#ef534f"/><stop offset=".55" stop-color="${this._tempColor(ps)}"/><stop offset="1" stop-color="${primaryReturn}"/></linearGradient>
          <linearGradient id="${this._id}-ch" x1="0" x2="1"><stop stop-color="${this._tempColor(cs)}"/><stop offset="1" stop-color="${radiatorReturn}"/></linearGradient>
          <linearGradient id="${this._id}-dhw" x1="0" x2="1"><stop stop-color="${this._tempColor(hot)}"/><stop offset="1" stop-color="#f2a063"/></linearGradient><linearGradient id="${this._id}-radiator-cooling" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ef514d"/><stop offset=".30" stop-color="#eb965f"/><stop offset=".68" stop-color="#55bebd"/><stop offset="1" stop-color="#4f94dc"/></linearGradient>
        </defs>
        <path class="house" d="M150 68 L430 8 750 68 V506 H150 Z"/><text class="zone" x="75" y="48" text-anchor="middle">FJERNVARMENET</text><text class="zone" x="430" y="34" text-anchor="middle">INDE I HUSET</text>
        ${this._pipe("primary-supply","M24 132 H200",primaryActive,7)}${this._pipe("primary-return","M200 360 H24",primaryActive,7)}
        ${this._pipe("dhw-hot","M380 350 H620 Q640 350 640 330",dhwActive,7)}${this._pipe("dhw-cold","M500 495 V430 H380",dhwActive,7)}
        <g class="unit"><rect x="200" y="80" width="180" height="400" rx="20"/><text class="unit-title" x="290" y="102" text-anchor="middle">WAVIN CALEFA</text>
          <g class="exchanger"><rect x="216" y="110" width="148" height="150" rx="12"/><text class="ex-title" x="290" y="130" text-anchor="middle">RADIATOR</text><g class="exchanger-metrics" text-anchor="middle"><text class="k" x="290" y="151">VENTIL</text><text class="v entity-hit" data-key="ch_valve" tabindex="0" x="290" y="167">${this._fmt("ch_valve",0)}</text><text class="k" x="290" y="188">FLOW</text><text class="v entity-hit" data-key="ch_flow" tabindex="0" x="290" y="204">${this._fmt("ch_flow",1)}</text><text class="k" x="290" y="225">EFFEKT</text><text class="v entity-hit" data-key="ch_power" tabindex="0" x="290" y="241">${this._fmt("ch_power",1)}</text></g></g>
          <g class="exchanger dhw-exchanger"><rect x="216" y="272" width="148" height="197" rx="12"/><text class="ex-title" x="290" y="292" text-anchor="middle">VARMT VAND</text><g class="exchanger-metrics" text-anchor="middle"><text class="k" x="290" y="313">VENTIL</text><text class="v entity-hit" data-key="dhw_valve" tabindex="0" x="290" y="329">${this._fmt("dhw_valve",0)}</text><text class="k" x="290" y="350">FLOW</text><text class="v entity-hit" data-key="dhw_flow" tabindex="0" x="290" y="366">${this._fmt("dhw_flow",1)}</text><text class="k" x="290" y="387">EFFEKT</text><text class="v entity-hit" data-key="dhw_power" tabindex="0" x="290" y="403">${this._fmt("dhw_power",1)}</text></g></g>
          <g class="dhw-bypass ${bypass ? "active" : ""} entity-hit" data-key="bvv_bypass_status" tabindex="0"><rect class="bypass-hit" x="223" y="421" width="134" height="44" rx="8"/><text class="bypass-status" x="290" y="430" text-anchor="middle">BYPASS ${bypass ? "AKTIV" : "LUKKET"}</text><g class="bypass-values" text-anchor="middle"><text class="k" x="258" y="440">FLOW</text><text class="v entity-hit" data-key="dhw_flow" tabindex="0" x="258" y="450">${this._fmt("dhw_flow",1)}</text><text class="k" x="322" y="440">TEMP</text><text class="v entity-hit" data-key="circulation_bypass_temp" tabindex="0" x="322" y="450">${this._temp("circulation_bypass_temp")}</text></g><path class="bypass-track" d="M230 459 H350"/><path class="bypass-flow" pathLength="100" d="M230 459 H350"/></g>
          <circle cx="200" cy="132" r="5"/><circle cx="200" cy="360" r="5"/><circle cx="380" cy="119" r="5"/><circle cx="380" cy="220" r="5"/><circle cx="380" cy="350" r="5"/><circle cx="380" cy="430" r="5"/>
        </g>
        <g class="radiator" transform="translate(587 102)"><rect width="146" height="135" rx="12"/></g>${this._pipe("ch-circuit","M380 119 H612 V205 H628 V119 H644 V205 H660 V119 H676 V205 H692 V119 H708 V220 H380",chActive,8)}
        <g class="label inside-temp entity-hit" data-key="ch_supply" tabindex="0" transform="translate(500 68)" text-anchor="middle"><text>Radiator fremløb</text><text class="label-value" style="font-size:29.25px" y="29">${this._temp("ch_supply")}</text></g><g class="label inside-temp entity-hit" data-key="ch_return" tabindex="0" transform="translate(500 169)" text-anchor="middle"><text>Radiator retur</text><text class="label-value" style="font-size:29.25px" y="29">${this._temp("ch_return")}</text></g><g class="label inside-temp entity-hit" data-key="dhw_hot_out" tabindex="0" transform="translate(500 299)" text-anchor="middle"><text>Varmt brugsvand</text><text class="label-value" style="font-size:29.25px" y="29">${this._temp("dhw_hot_out")}</text></g><g class="label inside-temp entity-hit" data-key="dhw_cold_in" tabindex="0" transform="translate(520 447)" text-anchor="start"><text>Koldtvand ind</text><text class="label-value" style="font-size:29.25px" y="29">${this._temp("dhw_cold_in")}</text></g><g class="tap ${dhwActive ? "active" : ""}" transform="translate(610 270)"><path class="tap-body" d="M30 60 V31 Q30 16 45 16 H78 Q90 16 90 28 V35"/><path class="tap-handle" d="M20 31 H40 M30 21 V41"/><path class="tap-outlet" d="M90 35 V47"/><path class="basin" d="M7 68 H108 L98 88 Q58 99 17 88 Z"/><path class="drop" d="M90 54 C81 66 85 75 90 75 C96 75 100 66 90 54Z"/><text x="58" y="111" text-anchor="middle">VARMT VAND</text></g>
        <g class="label primary in entity-hit" data-key="primary_supply" tabindex="0" transform="translate(75 68)" text-anchor="middle"><text>Fjernvarme fremløb</text><text class="label-value" style="font-size:31.5px" y="30">${this._temp("primary_supply")}</text></g><g class="delta entity-hit" data-key="primary_cooling" tabindex="0" transform="translate(75 205)"><text text-anchor="middle">AFKØLING</text><text class="label-value" style="font-size:20px" text-anchor="middle" y="26">${this._fmt("primary_cooling",1)}</text></g><g class="flow-metric entity-hit" data-key="meter_flow" tabindex="0" transform="translate(75 270)"><text text-anchor="middle">FLOW</text><text class="label-value" style="font-size:20px" text-anchor="middle" y="26">${this._fmt("meter_flow",1)}</text></g><g class="label primary out entity-hit" data-key="primary_return" tabindex="0" transform="translate(75 400)" text-anchor="middle"><text>Retur</text><text class="label-value" style="font-size:31.5px" y="31">${this._temp("primary_return")}</text></g><g class="outdoor-value entity-hit" data-key="ch_outdoor" tabindex="0" transform="translate(430 -42)" text-anchor="middle"><text>UDETEMPERATUR</text><text class="value" style="font-size:22.5px" y="24">${this._temp("ch_outdoor")}</text></g>
        
        

      </svg></div><aside>${this._metric("Effekt","meter_power",1)}${this._metric("Tryk","pressure",1)}${this._metric("Radiatorventil","ch_valve",0)}${this._metric("BV-ventil","dhw_valve",0)}</aside></div>${details}
    </ha-card>`;
    const currentCard = this.shadowRoot.querySelector("ha-card");
    if (forceStructure || !currentCard) {
      this.shadowRoot.innerHTML = markup;
      return;
    }
    const template = document.createElement("template");
    template.innerHTML = markup;
    const currentStyles = this.shadowRoot.querySelectorAll("style");
    const nextStyles = template.content.querySelectorAll("style");
    currentStyles.forEach((style, index) => {
      if (nextStyles[index] && style.textContent !== nextStyles[index].textContent) style.textContent = nextStyles[index].textContent;
    });
    this._morphNode(currentCard, template.content.querySelector("ha-card"));
  }
  _morphNode(current, next) {
    if (!current || !next) return;
    if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
      current.replaceWith(next.cloneNode(true)); return;
    }
    if (current.nodeType === Node.TEXT_NODE) {
      if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
      return;
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return;
    for (const attribute of Array.from(current.attributes)) {
      if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    }
    for (const attribute of Array.from(next.attributes)) {
      if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
    }
    const currentChildren = Array.from(current.childNodes);
    const nextChildren = Array.from(next.childNodes);
    for (let index = currentChildren.length - 1; index >= nextChildren.length; index -= 1) currentChildren[index].remove();
    for (let index = 0; index < nextChildren.length; index += 1) {
      const existing = current.childNodes[index];
      if (!existing) current.appendChild(nextChildren[index].cloneNode(true));
      else this._morphNode(existing, nextChildren[index]);
    }
  }
  _styles(ps,pr,cs,cr,hot,cold) { return `
    :host{display:block;--card-surface:var(--dashboard-card-bg,var(--ha-card-background,var(--card-background-color,#111820)))}ha-card{display:block;box-sizing:border-box;padding:16px;overflow:hidden;background:none;color:var(--primary-text-color);border:0;border-radius:0;box-shadow:none}header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:3px 7px 9px}header small{font-size:10px;letter-spacing:.18em;color:var(--secondary-text-color)}h2{font-size:25px;margin:3px 0 0}.chips{display:flex;gap:7px;align-items:center;justify-content:flex-end;flex-wrap:wrap}.chips span{font-size:10px;padding:7px 10px;border:1px solid color-mix(in srgb,var(--success-color,#62cfad) 32%,transparent);border-radius:18px;color:var(--success-color,#7bd9ba);background:#55cba908}.details-btn{display:flex;align-items:center;gap:4px;font:inherit;font-size:10px;font-weight:700;padding:7px 10px 7px 8px;border:1px solid color-mix(in srgb,var(--primary-text-color) 14%,transparent);border-radius:18px;color:var(--secondary-text-color);background:transparent;cursor:pointer}.details-btn ha-icon{--mdc-icon-size:13px}.details-btn:hover{color:var(--primary-text-color)}.alarm .alarm-chip{color:#f18787;border-color:#e7666655;background:#e7666610}.hero{display:grid;grid-template-columns:minmax(0,1fr) 92px;gap:10px}.diagram{min-width:0;aspect-ratio:760/520}.diagram svg{width:100%;height:100%;overflow:visible}.house{fill:#f2994a14;stroke:#78a4b940;stroke-width:1.5}.zone{font-size:10px;letter-spacing:1.6px;font-weight:700;fill:var(--secondary-text-color)}.pipe-rim,.pipe-core,.pipe-heat,.water-sheen{fill:none;stroke-linecap:round;stroke-linejoin:round}.pipe-rim{stroke:#8597a5;stroke-width:18;opacity:.75}.pipe-core{stroke:#1b2b35;stroke-width:14}.pipe-heat{stroke-width:9;opacity:.65}.water-sheen{display:none;stroke:rgba(222,247,255,.38);stroke-width:1.4;stroke-dasharray:3 16;filter:drop-shadow(0 0 1.5px rgba(190,236,255,.34))}.pipe.active .water-sheen{display:inline;animation:water-shimmer 3.2s linear infinite}.primary-supply .pipe-heat{stroke:#ed554f}.primary-return .pipe-heat{stroke:${pr}}.ch-circuit .pipe-heat{stroke:url(#${this._id}-radiator-cooling)}.ch-circuit .water-sheen{stroke-width:1.2;opacity:.38;animation-duration:4.4s!important}.ch-circuit .water-pulse{fill:rgba(231,249,255,.60);opacity:.46;transform:scale(.62)}.dhw-hot .pipe-heat{stroke:url(#${this._id}-dhw)}.dhw-cold .pipe-heat{stroke:${this._tempColor(cold)}}.water-pulse{display:none;fill:rgba(230,249,255,.66);filter:drop-shadow(0 0 2px rgba(195,239,255,.30));opacity:.62}.water-pulse circle{fill:rgba(255,255,255,.36)}.pipe.active .water-pulse{display:inline}.pipe:not(.active){opacity:.42}.pipe:not(.active) .water-sheen{display:none;animation:none}.unit rect{fill:#162631;stroke:#83a9ba;stroke-width:1.7}.unit text{font-size:8px;font-weight:700;letter-spacing:1px;fill:#a9bcc7}.unit .unit-title{font-size:9px}.exchanger .ex-title{font-size:9px}.exchanger-metrics .k{font-size:6.5px;fill:var(--secondary-text-color);font-weight:600}.exchanger-metrics .v{font-size:12px;fill:var(--primary-text-color);font-weight:700;letter-spacing:0}.exchanger-metrics .v.small{font-size:8px}.primary-row text{font-size:7px;fill:var(--secondary-text-color);letter-spacing:.05em}.primary-row .value{font-size:14px;font-weight:700;fill:var(--primary-text-color);letter-spacing:0}.primary-row .primary-flow{font-size:8px;fill:var(--secondary-text-color)}.outdoor-value text,.outdoor-value .value{font-size:8px;letter-spacing:.08em;fill:var(--secondary-text-color)}.outdoor-value .value{font-weight:700;letter-spacing:0;fill:var(--primary-text-color)}.unit circle{fill:#dce8ed;stroke:#13202a}.exchanger rect{fill:#1c2d38;stroke:#7598aa;stroke-width:1;opacity:.85}.exchanger path{fill:none;stroke:#7598aa;stroke-width:3.5;opacity:.85}.radiator>rect{fill:#1a2a35;stroke:#94aeba;stroke-width:1.5}.radiator .fin{fill:#253b47;stroke:#688492;stroke-width:.7}.radiator text,.tap text{font-size:8px;letter-spacing:1px;fill:var(--secondary-text-color)}.unit-valve circle{fill:#192a35;stroke:#d7a06f;stroke-width:1.2}.unit-valve path{fill:none;stroke:#e5b17d;stroke-width:1.3}.unit-valve text{font-size:6.5px;letter-spacing:.04em;fill:#e9c39d}.primary-unit-valve text{fill:#b9cbd4}.tap .tap-body,.tap .tap-outlet{fill:none;stroke:#9bb0ba;stroke-width:5;stroke-linecap:round;stroke-linejoin:round}.tap .tap-handle{fill:none;stroke:#b9cbd3;stroke-width:3;stroke-linecap:round}.tap .basin{fill:#172832;stroke:#7894a2;stroke-width:2;stroke-linejoin:round}.tap .drop{fill:${this._tempColor(hot)};stroke:none;opacity:0}.tap.active .drop{animation:drop 2s ease-in infinite}.label text,.bypass-label text,.bypass-icon text,.circuit-meta text,.delta text,.flow-metric text{font-size:9px;fill:var(--secondary-text-color)}.bypass-icon circle{fill:#1b2c37;stroke:#7898a8;stroke-width:1.5}.bypass-icon path{fill:none;stroke:#7898a8;stroke-width:2;stroke-linecap:round}.bypass-icon text{fill:var(--secondary-text-color);font-size:8px}.bypass-icon .label-value{fill:var(--primary-text-color);font-size:12px;font-weight:650}.bypass-icon.active circle{stroke:#e99a6f;filter:drop-shadow(0 0 5px #e87e5855)}.bypass-icon.active path{stroke:#e99a6f;transform-origin:center;animation:bypass-turn 2.4s linear infinite}.circuit-meta text{fill:var(--secondary-text-color);font-size:8px}.circuit-meta .label-value{fill:var(--primary-text-color);font-size:12px;font-weight:650}.label .pipe-meta{font-size:9px;fill:#b7c4cc}.label .label-value,.bypass-label .label-value,.delta .label-value,.flow-metric .label-value{font-size:15px;font-weight:650;fill:var(--primary-text-color)}.label.primary .label-value{font-size:21px}.delta .label-value{font-size:19px;fill:${this._coolingStatusColor(this._num("primary_cooling"))}}aside{display:grid;grid-template-rows:repeat(4,1fr);border-left:1px solid #ffffff14;padding-left:8px}.metric{min-width:0;display:flex;flex-direction:column;justify-content:center;text-align:center;padding:7px 4px}.metric small,.metric strong{display:block;overflow:hidden;text-overflow:ellipsis}.metric small{font-size:8px;color:var(--secondary-text-color);white-space:normal}.metric strong{font-size:13px;font-weight:600;margin-top:3px;white-space:nowrap}.details{display:grid;grid-template-columns:1.05fr 1fr 1.25fr 1.2fr;gap:8px;padding-top:11px;margin-top:5px;border-top:1px solid #ffffff12}.details section{min-width:0;padding:9px;border:1px solid #ffffff0e;border-radius:13px;background:#ffffff04}.details h3{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--secondary-text-color);margin:0 0 6px}.metric-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px}.metric-grid .metric{border-radius:8px;background:#ffffff04;min-height:37px}.metric.bad strong{color:#ef7777}@keyframes bypass-turn{to{transform:rotate(360deg)}}@keyframes water-shimmer{to{stroke-dashoffset:-38}}@keyframes drop{0%,35%{transform:translateY(-3px);opacity:0}60%{opacity:1}100%{transform:translateY(10px);opacity:0}}${this._config.animation===false?".water-pulse{display:none!important}.water-sheen,.drop,.bypass-icon.active path,.bypass-icon.active .bypass-pulse,.dhw-bypass.active .bypass-flow{animation:none!important}":""}@media(prefers-reduced-motion:reduce){.water-pulse{display:none!important}.water-sheen,.drop,.bypass-icon.active path,.bypass-icon.active .bypass-pulse,.dhw-bypass.active .bypass-flow{animation:none!important}}@media(max-width:700px){ha-card{padding:11px}.hero{grid-template-columns:minmax(0,1fr) 72px}.details{grid-template-columns:repeat(2,minmax(0,1fr))}h2{font-size:21px}.chips .alarm-chip{display:none}}@media(max-width:480px){.hero{grid-template-columns:1fr}.diagram{aspect-ratio:760/540}aside{grid-template-columns:repeat(4,minmax(0,1fr));grid-template-rows:auto;border-left:0;border-top:1px solid #ffffff14;padding:5px 0 0}.details{grid-template-columns:1fr}.chips span{font-size:8px;padding:5px 7px}.label.primary .label-value{font-size:18px}}
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
      /* Ingen baggrund her. Denne blok skrives i et <style> EFTER _styles(),
         saa den vandt over background:none deroppe og malede en lysegraa
         flade hen over stack-in-card'et - synlig som et "kort oven paa
         kortet". Kortet skal arve stakkens flade, ikke lave sin egen. */
      color: var(--fv-fg);
      border-color: var(--fv-line);
    }
    .label > text:first-child, .outdoor-value > text:first-child { font-size: 10.5px; }
    .inside-temp > text:first-child { font-size: 12.5px; }
    aside .metric { padding-inline: 1px; }
    aside .metric small {
      font-size: 11px;
      line-height: 1.15;
      text-wrap: balance;
    }
    aside .metric strong {
      font-size: 18px;
      line-height: 1.05;
      letter-spacing: -.02em;
    }
    .label .label-value, .outdoor-value .value {
      fill: color-mix(in srgb, var(--fv-fg) 78%, var(--fv-bg));
    }
    .label .label-value { font-size: 26px !important; }
    .label.primary .label-value { font-size: 28px !important; }
    .outdoor-value .value { font-size: 20px !important; }
    .house { fill: #f2994a14; stroke: var(--fv-line); }
    .pipe-rim { stroke: color-mix(in srgb, var(--fv-fg) 42%, var(--fv-bg)); }
    .pipe-core { stroke: color-mix(in srgb, var(--fv-bg) 54%, var(--fv-fg) 46%); }
    .dhw-cold .pipe-heat { stroke: #3e9ed3; }
    .unit rect, .exchanger rect, .radiator > rect, .radiator .fin,
    .unit-valve circle, .bypass-icon circle, .tap .basin {
      fill: var(--fv-component);
      stroke: color-mix(in srgb, var(--fv-fg) 38%, transparent);
    }
    .exchanger path, .tap .tap-body, .tap .tap-outlet, .tap .tap-handle,
    .bypass-icon path { stroke: color-mix(in srgb, var(--fv-fg) 48%, transparent); }
    .bypass-icon .bypass-pulse { fill: none; stroke: transparent; opacity: 0; transform-origin: center; }
    .bypass-icon.active .bypass-pulse { stroke: #e99a6f; animation: bypass-pulse 1.8s ease-out infinite; }
    @keyframes bypass-pulse { 0% { opacity: .7; transform: scale(.72); } 75%,100% { opacity: 0; transform: scale(1.3); } }
    .dhw-bypass .bypass-hit { fill: color-mix(in srgb, var(--fv-fg) 3%, transparent); stroke: color-mix(in srgb, var(--fv-fg) 10%, transparent); stroke-width: .7; }
    .dhw-bypass .bypass-status { fill: var(--fv-muted); font-size: 7.5px; font-weight: 750; letter-spacing: .075em; }
    .dhw-bypass.active .bypass-hit { fill: color-mix(in srgb, #e99a6f 11%, transparent); stroke: color-mix(in srgb, #e99a6f 55%, transparent); }
    .dhw-bypass.active .bypass-status { fill: #f0a277; }
    .dhw-bypass .bypass-values .k { fill: var(--fv-muted); font-size: 6.5px; font-weight: 650; letter-spacing: .04em; }
    .dhw-bypass .bypass-values .v { fill: var(--fv-fg); font-size: 10px; font-weight: 750; }
    .dhw-bypass .bypass-track, .dhw-bypass .bypass-flow { fill: none; stroke-linecap: round; stroke-linejoin: round; }
    .dhw-bypass .bypass-track { stroke: color-mix(in srgb, var(--fv-fg) 44%, transparent); stroke-width: 6; }
    .dhw-bypass .bypass-flow { stroke: #fff0df; stroke-width: 4; stroke-dasharray: 8 9; opacity: 0; filter: drop-shadow(0 0 3px #e99a6f); }
    .dhw-bypass.active .bypass-track { stroke: #e99a6f; filter: drop-shadow(0 0 5px #e87e5877); }
    .dhw-bypass.active .bypass-flow { opacity: 1; animation: dhw-bypass-flow 1.15s linear infinite; }
    @keyframes dhw-bypass-flow { to { stroke-dashoffset: -34; } }
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
      h2 { font-size: 30px; }
      .chips { max-width: 52%; }
      .chips .alarm-chip { display: inline-flex; }
      .chips span { font-size: 11px; padding: 7px 9px; }
      .hero { grid-template-columns: 1fr; gap: 8px; }
      .diagram { width: 100%; aspect-ratio: 760 / 520; }
      aside {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        grid-template-rows: auto;
        border-left: 0;
        border-top: 1px solid var(--fv-line);
        padding: 8px 0 0;
      }
      aside .metric { min-width: 0; padding: 6px 2px; }
      aside .metric small { font-size: 11px; line-height: 1.15; }
      aside .metric strong { font-size: 18px; }
      .zone { font-size: 13px; }
      .unit text { font-size: 11px; }
      .unit .unit-title, .exchanger .ex-title { font-size: 12px; }
      .exchanger-metrics .k { font-size: 9.5px; }
      .exchanger-metrics .v { font-size: 17px; }
      .label text, .circuit-meta text, .delta text, .flow-metric text { font-size: 14px; }
      .label > text:first-child, .outdoor-value > text:first-child { font-size: 14px; }
      .label .label-value { font-size: 32px !important; }
      .label.primary .label-value { font-size: 33px !important; }
      .circuit-meta .label-value { font-size: 36px !important; }
      .delta .label-value, .flow-metric .label-value { font-size: 22px !important; }
      .outdoor-value text { font-size: 13px; }
      .outdoor-value .value { font-size: 25px !important; }
      .label .pipe-meta { font-size: 12px; }
      .tap text { font-size: 10px; }
      .details { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
      .details section { padding: 8px 6px; }
      .metric-grid .metric { min-height: 42px; }
      .metric-grid .metric small { font-size: 10px; }
      .metric-grid .metric strong { font-size: 17px; }
    }
  `; }
}

class HAFjernvarmeHouseCardEditor extends HTMLElement {
  setConfig(config){this._config=config||{};if(!this._form)this._render();else this._form.data=this._config;}
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
if(!customElements.get("ha-fjernvarme-house-card-v2"))customElements.define("ha-fjernvarme-house-card-v2",class extends HAFjernvarmeHouseCard{});
if(!customElements.get("ha-fjernvarme-house-card-editor"))customElements.define("ha-fjernvarme-house-card-editor",HAFjernvarmeHouseCardEditor);
window.customCards=window.customCards||[];window.customCards.push({type:"ha-fjernvarme-house-card-v2",name:"HA Fjernvarme House Card",description:"Fjernvarmeunit med temperaturstyrede rør, radiator, varmt vand og bypass",preview:true});
console.info(`%c HA-FJERNVARME-HOUSE-CARD %c ${VERSION} `,"color:#fff;background:#bb433f;font-weight:700","color:#bb433f;background:#fff");
