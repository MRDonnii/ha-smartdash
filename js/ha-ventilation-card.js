const VERSION = "0.2.37";

class HAVentilationCard extends HTMLElement {
  static getStubConfig() {
    return {
      title: "Ventilation",
      animation: true,
      show_afterheat: false,
      entities: {
        outdoor_temperature: "sensor.outdoor_temperature",
        supply_temperature: "sensor.supply_temperature",
        extract_temperature: "sensor.extract_temperature",
        exhaust_temperature: "sensor.exhaust_temperature",
        supply_fan_rpm: "sensor.supply_fan_speed",
        extract_fan_rpm: "sensor.extract_fan_speed"
      }
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = undefined;
    this._signature = "";
    this._id = `hav-${Math.random().toString(36).slice(2, 9)}`;
    this._viewWidth = 440;
    this._resizeObserver = undefined;
    this._lastRecovery = undefined;
  }

  connectedCallback() {
    if (this._resizeObserver || typeof ResizeObserver === "undefined") return;
    this._resizeObserver = new ResizeObserver(() => {
      const next = this._responsiveViewWidth();
      if (Math.abs(next - this._viewWidth) < 2) return;
      this._viewWidth = next;
      this._render(this._signature);
    });
    this._resizeObserver.observe(this);
  }

  disconnectedCallback() {
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this._config = {
      title: "Ventilation",
      animation: true,
      show_afterheat: false,
      entities: {},
      ...config,
      entities: { ...(config.entities || {}) }
    };
    this._signature = "";
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const signature = JSON.stringify(Object.values(this._config.entities || {}).map(id => hass?.states?.[id]?.state));
    if (signature !== this._signature) this._render(signature);
  }

  getCardSize() { return 10; }
  getGridOptions() { return { rows: "auto", columns: 12, min_columns: 6 }; }

  _responsiveViewWidth() {
    const cardWidth = this.getBoundingClientRect?.().width || 0;
    const mobile = cardWidth > 0 ? cardWidth < 700 : window.matchMedia?.("(max-width: 700px)")?.matches === true;
    if (cardWidth < 1) return mobile ? 440 : 520;
    if (mobile) return 440;
    const diagramWidth = Math.max(440, cardWidth - (mobile ? 20 : 108));
    const diagramHeight = mobile ? 390 : 390;
    const viewHeight = mobile ? 340 : 320;
    return Math.max(440, viewHeight * (diagramWidth / diagramHeight));
  }

  _state(key) {
    const id = this._config.entities?.[key];
    const entity = id ? this._hass?.states?.[id] : undefined;
    return entity && !["unknown", "unavailable", ""].includes(entity.state) ? entity : undefined;
  }

  _number(key, suffix = "", digits = 0) {
    const value = Number(this._state(key)?.state);
    const language = this._hass?.locale?.language || this._hass?.language || "en";
    return Number.isFinite(value) ? `${value.toLocaleString(language, { maximumFractionDigits: digits })}${suffix}` : "—";
  }

  _recoveryValue() {
    const language = this._hass?.locale?.language || this._hass?.language || "en";
    const measured = Number(this._state("heat_recovery")?.state);
    if (Number.isFinite(measured)) {
      this._lastRecovery = measured;
      return `${measured.toLocaleString(language, { maximumFractionDigits: 0 })}%`;
    }
    const outdoor = Number(this._state("outdoor_temperature")?.state);
    const extract = Number(this._state("extract_temperature")?.state);
    const exhaust = Number(this._state("exhaust_temperature")?.state);
    const span = extract - outdoor;
    if ([outdoor, extract, exhaust].every(Number.isFinite) && Math.abs(span) >= 0.1) {
      const estimated = Math.max(0, Math.min(100, (extract - exhaust) / span * 100));
      this._lastRecovery = estimated;
      return `≈${estimated.toLocaleString(language, { maximumFractionDigits: 0 })}%`;
    }
    return Number.isFinite(this._lastRecovery)
      ? `≈${this._lastRecovery.toLocaleString(language, { maximumFractionDigits: 0 })}%`
      : "—";
  }

  _on(key) {
    return ["on", "open", "opening", "true", "active"].includes(String(this._state(key)?.state).toLowerCase());
  }

  _entityValue(key, fallbackSuffix = "", digits = 0) {
    const entity = this._state(key);
    if (!entity) return "—";
    const value = Number(entity.state);
    if (!Number.isFinite(value)) return this._escape(entity.state);
    const language = this._hass?.locale?.language || this._hass?.language || "en";
    const suffix = entity.attributes?.unit_of_measurement || fallbackSuffix;
    return `${value.toLocaleString(language, { maximumFractionDigits: digits })}${suffix ? ` ${suffix}` : ""}`;
  }

  _statusValue(key, active, inactive) {
    return this._state(key) ? (this._on(key) ? active : inactive) : "—";
  }

  _modeLabel() {
    const raw = String(this._state("mode")?.state || "").trim();
    if (!raw) return "—";
    const normalized = raw.toLowerCase().replace(/[ -]+/g, "_");
    const labels = {
      auto_or_scheduled: "Auto / plan",
      auto: "Auto",
      scheduled: "Planlagt",
      manual: "Manuel",
      away: "Ude",
      standby: "Standby",
      summer: "Sommer",
      bypass: "Bypass"
    };
    return labels[normalized] || raw.replace(/_/g, " ");
  }

  _airQualityValue() {
    const state = String(this._state("air_quality")?.state || "").toLowerCase();
    return ({ good: "God", moderate: "Moderat", poor: "Dårlig" })[state] || (state ? this._escape(this._state("air_quality").state) : "—");
  }

  _detail(label, value, stateClass = "", key = "") {
    return `<div class="detail ${stateClass} ${key ? "entity-hit" : ""}"${key ? ` data-key="${key}" tabindex="0"` : ""}><small>${label}</small><strong>${value}</strong></div>`;
  }

  _temperatureColor(key) {
    const value = Number(this._state(key)?.state);
    if (!Number.isFinite(value)) return "#8c9aa8";
    const stops = [[-10,[42,91,201]],[14,[57,125,219]],[22,[235,126,70]],[30,[235,84,61]],[40,[215,48,57]]];
    if (value <= stops[0][0]) return `rgb(${stops[0][1].join(",")})`;
    for (let i = 1; i < stops.length; i++) {
      if (value <= stops[i][0]) {
        const [a, ca] = stops[i - 1], [b, cb] = stops[i], amount = (value - a) / (b - a);
        return `rgb(${ca.map((channel, index) => Math.round(channel + (cb[index] - channel) * amount)).join(",")})`;
      }
    }
    return `rgb(${stops[stops.length - 1][1].join(",")})`;
  }

  _relativeTemperatureColors(keys) {
    const samples = keys.map(key => ({ key, value: Number(this._state(key)?.state) })).filter(sample => Number.isFinite(sample.value));
    if (samples.length < 2) return Object.fromEntries(keys.map(key => [key, this._temperatureColor(key)]));
    const minimum = Math.min(...samples.map(sample => sample.value));
    const maximum = Math.max(...samples.map(sample => sample.value));
    const span = maximum - minimum;
    if (span < .2) return Object.fromEntries(keys.map(key => [key, "rgb(165,180,185)"]));
    const palette = [[55,128,220], [84,188,211], [224,190,125], [236,91,70]];
    const colorFor = value => {
      const position = Math.max(0, Math.min(1, (value - minimum) / span));
      const scaled = position * (palette.length - 1);
      const index = Math.min(palette.length - 2, Math.floor(scaled));
      const amount = scaled - index;
      return `rgb(${palette[index].map((channel, channelIndex) => Math.round(channel + (palette[index + 1][channelIndex] - channel) * amount)).join(",")})`;
    };
    return Object.fromEntries(keys.map(key => {
      const sample = samples.find(item => item.key === key);
      return [key, sample ? colorFor(sample.value) : this._temperatureColor(key)];
    }));
  }

  _escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  _mixTemperatureColor(stops, position) {
    const sorted = [...stops].sort((a, b) => a.offset - b.offset);
    const upperIndex = sorted.findIndex(stop => position <= stop.offset);
    if (upperIndex < 0) return sorted[sorted.length - 1].color;
    if (upperIndex === 0) return sorted[0].color;
    const lower = sorted[upperIndex - 1], upper = sorted[upperIndex];
    const amount = (position - lower.offset) / Math.max(.001, upper.offset - lower.offset);
    const from = lower.color.match(/\d+/g)?.map(Number), to = upper.color.match(/\d+/g)?.map(Number);
    if (!from || !to) return lower.color;
    return `rgb(${from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount)).join(",")})`;
  }

  _temperatureLayers(route, path, stops) {
    const segments = 48, overlap = .42;
    return Array.from({ length: segments }, (_, index) => {
      const start = index * 100 / segments;
      const length = 100 / segments + overlap;
      const color = this._mixTemperatureColor(stops, (index + .5) / segments);
      return `<path class="temperature-segment ${route}" pathLength="100" d="${path}" stroke="${color}" stroke-dasharray="${length} ${100 - length}" stroke-dashoffset="${-start}"/>`;
    }).join("");
  }

  _duct(route, path, rpmKey, temperatureStops) {
    const rpm = Number(this._state(rpmKey)?.state);
    const running = Number.isFinite(rpm) && rpm > 0;
    const duration = Math.max(3.6, Math.min(7.2, 8.1 - rpm / 650));
    return `<g class="duct ${route} ${running ? "running" : ""}" style="--flow-duration:${duration}s">
      <path class="rim" d="${path}"/><path class="inner" d="${path}"/>
      ${this._temperatureLayers(route, path, temperatureStops)}
      <path class="flow-stream glow" pathLength="100" d="${path}"/>
      <path class="flow-stream pulse" pathLength="100" d="${path}"/>
    </g>`;
  }

  _temperature(key, label, x, y, anchor) {
    return `<g class="temp entity-hit" data-key="${key}" tabindex="0" transform="translate(${x} ${y})" text-anchor="${anchor}"><text class="label">${label}</text><text class="value" y="24">${this._number(key, "°", 1)}</text></g>`;
  }

  _bindMoreInfo() {
    const open = key => {
      const entityId = this._config.entities?.[key];
      if (!entityId) return;
      this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
    };
    this.shadowRoot.querySelectorAll("[data-key]").forEach(element => {
      element.addEventListener("click", event => { event.stopPropagation(); open(element.dataset.key); });
      element.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(element.dataset.key); }
      });
    });
  }

  _render(signature = "") {
    if (!this.shadowRoot) return;
    this._signature = signature;
    const bypass = this._on("bypass");
    const afterheat = this._config.show_afterheat === true;
    const showAfterheatValues = afterheat && !bypass;
    const heating = this._on("afterheat_active");
    const supplyKey = afterheat && !bypass && this._config.entities?.afterheat_after ? "afterheat_after" : "supply_temperature";
    const supplyRunning = Number(this._state("supply_fan_rpm")?.state) > 0;
    const extractRunning = Number(this._state("extract_fan_rpm")?.state) > 0;
    const cardWidth = this.getBoundingClientRect?.().width || 0;
    const mobile = cardWidth > 0 ? cardWidth < 700 : window.matchMedia?.("(max-width: 700px)")?.matches === true;
    const viewWidth = this._viewWidth || this._responsiveViewWidth();
    const viewHeight = mobile ? 370 : 320;
    const scaleX = viewWidth / 440;
    const centerX = 194 * scaleX;
    const right = viewWidth - 24;
    const top = mobile ? 158 : 140;
    const bottom = mobile ? 242 : 220;
    const centerY = (top + bottom) / 2;
    const coreOffsetY = centerY - 144;
    const topTemperatureY = mobile ? 94 : 82;
    const bottomTemperatureY = mobile ? 304 : 267;
    const cold = bypass
      ? `M24 ${top} H${right}`
      : `M24 ${top} H${centerX - 61} C${centerX - 50} ${top} ${centerX - 43} ${centerY - 33} ${centerX - 35} ${centerY - 27} L${centerX + 35} ${centerY + 27} C${centerX + 43} ${centerY + 33} ${centerX + 50} ${bottom} ${centerX + 61} ${bottom} H${right}`;
    const warm = bypass
      ? `M${right} ${bottom} H24`
      : `M${right} ${top} H${centerX + 61} C${centerX + 50} ${top} ${centerX + 43} ${centerY - 33} ${centerX + 35} ${centerY - 27} L${centerX - 35} ${centerY + 27} C${centerX - 43} ${centerY + 33} ${centerX - 50} ${bottom} ${centerX - 61} ${bottom} H24`;
    const temperatureColors = this._relativeTemperatureColors(["outdoor_temperature", "supply_temperature", supplyKey, "extract_temperature", "exhaust_temperature"]);
    const supplyStart = temperatureColors.outdoor_temperature;
    const supplyMiddle = temperatureColors.supply_temperature;
    const supplyEnd = temperatureColors[supplyKey];
    const extract = temperatureColors.extract_temperature;
    const exhaust = temperatureColors.exhaust_temperature;
    const mode = this._modeLabel();
    const level = String(this._state("level")?.state || "—").replace(/^level_/, "");
    const flow = Number(this._state("water_flow")?.state), waterReturn = Number(this._state("water_return")?.state);
    const measuredDelta = Number(this._state("water_delta")?.state);
    const deltaValue = Number.isFinite(measuredDelta) ? measuredDelta : Number.isFinite(flow) && Number.isFinite(waterReturn) ? flow - waterReturn : NaN;
    const delta = Number.isFinite(deltaValue) ? `${deltaValue.toLocaleString(undefined, { maximumFractionDigits: 1 })}°` : "—";
    const coilX = (centerX + 50 + right) / 2;
    const alarmActive = this._on("alarm");
    const fanAnimationDelay = -((Date.now() / 1000) % 2.8);

    this.shadowRoot.innerHTML = `<style>${this._styles()}</style><style>${this._responsiveStyles()}</style><ha-card class="${bypass ? "bypass" : ""}">
      <header><div><small>VENTILATION</small><h2>${this._escape(this._config.title)}</h2></div><span class="entity-hit" data-key="mode" tabindex="0">${this._escape(mode)}</span></header>
      <div class="body"><aside class="left">
        <div class="entity-hit ${bypass ? "info" : ""}" data-key="bypass" tabindex="0"><strong>${this._statusValue("bypass", "Åben", "Lukket")}</strong><small>Bypass</small></div>
        <div class="entity-hit" data-key="air_quality" tabindex="0"><strong>${this._airQualityValue()}</strong><small>Luftkvalitet</small></div>
        <div class="entity-hit" data-key="heat_transfer" tabindex="0"><strong>${this._entityValue("heat_transfer", "W")}</strong><small>Varmeoverførsel</small></div>
        <div class="entity-hit ${alarmActive ? "danger" : this._state("alarm") ? "ok" : ""}" data-key="alarm" tabindex="0"><strong>${this._state("alarm") ? (alarmActive ? "Alarm" : "OK") : "—"}</strong><small>Alarm</small></div>
      </aside><div class="diagram"><svg viewBox="0 0 ${viewWidth} ${viewHeight}" role="img" aria-label="Ventilation airflow">
        <defs>
          <linearGradient id="${this._id}-cold" gradientUnits="userSpaceOnUse" x1="24" x2="${right}"><stop offset="0" stop-color="${supplyStart}"/><stop offset=".53" stop-color="${supplyMiddle}"/><stop offset="1" stop-color="${supplyEnd}"/></linearGradient>
          <linearGradient id="${this._id}-warm" gradientUnits="userSpaceOnUse" x1="24" x2="${right}"><stop offset="0" stop-color="${exhaust}"/><stop offset=".47" stop-color="${exhaust}"/><stop offset="1" stop-color="${extract}"/></linearGradient>
        </defs>
        <path class="house" d="M${112 * scaleX} ${mobile ? 72 : 60} L${273 * scaleX} 2 L${436 * scaleX} ${mobile ? 72 : 60} V${viewHeight - 7} H${112 * scaleX} Z"/>
        <text class="zone" x="14" y="${mobile ? 61 : 54}">UDE</text><text class="zone" x="${273 * scaleX}" y="${mobile ? 43 : 43}" text-anchor="middle">INDE</text>
        <g class="climate" transform="translate(${273 * scaleX} ${mobile ? 69 : 64})" text-anchor="middle"><g class="entity-hit" data-key="room_temperature" tabindex="0"><text x="-35">Rum</text><text class="climate-value" x="-35" y="19">${this._number("room_temperature", "°", 1)}</text></g><path d="M0 -4 V22"/><g class="entity-hit" data-key="humidity" tabindex="0"><text x="35">Fugt</text><text class="climate-value" x="35" y="19">${this._number("humidity", "%")}</text></g></g>
        ${this._duct("cold", cold, "supply_fan_rpm", heating ? [{ offset: 0, color: supplyStart }, { offset: .43, color: supplyStart }, { offset: .60, color: supplyMiddle }, { offset: .77, color: supplyMiddle }, { offset: .90, color: supplyEnd }, { offset: 1, color: supplyEnd }] : [{ offset: 0, color: supplyStart }, { offset: .43, color: supplyStart }, { offset: .60, color: supplyMiddle }, { offset: 1, color: supplyMiddle }])}${this._duct("warm", warm, "extract_fan_rpm", [{ offset: 0, color: extract }, { offset: .43, color: extract }, { offset: .60, color: exhaust }, { offset: 1, color: exhaust }])}
        <path class="core" transform="translate(${centerX - 194} ${coreOffsetY})" d="M194 96 L242 144 194 192 146 144Z"/><path class="fin" transform="translate(${centerX - 194} ${coreOffsetY})" d="M165 132 L181 116 M207 172 L223 156"/>
        <g class="core-label entity-hit" data-key="heat_recovery" tabindex="0" transform="translate(${centerX} ${centerY})" text-anchor="middle"><text class="core-value" y="-2">${bypass ? "—" : this._recoveryValue()}</text><text class="core-caption" y="11">Genvinding</text></g>
        <g class="fan supply entity-hit" data-key="supply_fan_percent" tabindex="0" transform="translate(${86 * scaleX} ${top})"><text y="-27" text-anchor="middle">${this._number("supply_fan_percent", "%")}</text><rect x="-9" y="-21" width="18" height="42" rx="8"/><ellipse cx="4" cy="0" rx="3" ry="15"/></g>
        <g transform="translate(${86 * scaleX} ${top})"><g class="fan-wind supply ${supplyRunning ? "running" : ""}" style="stroke:${this._temperatureColor("outdoor_temperature")};animation-delay:${fanAnimationDelay}s"><path d="M11 -7 C23 -7 24 -14 35 -14"/><path d="M11 0 H43"/><path d="M11 7 C23 7 26 14 37 14"/></g></g>
        <g class="fan extract entity-hit" data-key="extract_fan_percent" tabindex="0" transform="translate(${86 * scaleX} ${bottom})"><text y="-27" text-anchor="middle">${this._number("extract_fan_percent", "%")}</text><rect x="-9" y="-21" width="18" height="42" rx="8"/><ellipse cx="-4" cy="0" rx="3" ry="15"/></g>
        <g transform="translate(${86 * scaleX} ${bottom})"><g class="fan-wind extract ${extractRunning ? "running" : ""}" style="stroke:${this._temperatureColor("exhaust_temperature")};animation-delay:${fanAnimationDelay}s"><path d="M-11 -7 C-23 -7 -24 -14 -35 -14"/><path d="M-11 0 H-43"/><path d="M-11 7 C-23 7 -26 14 -37 14"/></g></g>
        ${showAfterheatValues ? `<g class="coil ${heating ? "active" : ""}" transform="translate(${coilX - 310} ${bottom - 170})"><text class="entity-hit" data-key="water_delta" tabindex="0" x="310" y="134" text-anchor="middle">ΔT ${delta}</text><rect class="glow" x="246" y="146" width="128" height="60" rx="11"/><rect class="face" x="248" y="148" width="124" height="56" rx="9"/><path d="M310 155 V197"/><g class="entity-hit" data-key="water_flow" tabindex="0"><text class="small" x="279" y="166" text-anchor="middle">Fremløb</text><text class="coil-value" x="279" y="191" text-anchor="middle">${this._number("water_flow", "°", 1)}</text></g><g class="entity-hit" data-key="water_return" tabindex="0"><text class="small" x="341" y="166" text-anchor="middle">Retur</text><text class="coil-value" x="341" y="191" text-anchor="middle">${this._number("water_return", "°", 1)}</text></g></g>` : ""}
        ${this._temperature("outdoor_temperature", "Udeluft", 14, topTemperatureY, "start")}${this._temperature(bypass ? supplyKey : "extract_temperature", bypass ? "Indblæsning" : "Udsugning", viewWidth - 14, topTemperatureY, "end")}${this._temperature("exhaust_temperature", "Afkast", 14, bottomTemperatureY, "start")}${this._temperature(bypass ? "extract_temperature" : supplyKey, bypass ? "Udsugning" : "Indblæsning", viewWidth - 14, bottomTemperatureY, "end")}
      </svg></div><aside class="right"><div class="entity-hit" data-key="co2" tabindex="0"><strong>${this._number("co2")}</strong><small>CO₂ · ppm</small></div><div class="entity-hit" data-key="level" tabindex="0"><strong>${this._escape(level)}</strong><small>Ventilatortrin</small></div><div class="entity-hit" data-key="power" tabindex="0"><strong>${this._number("power", " W")}</strong><small>Effekt</small></div><div class="entity-hit" data-key="filter_days" tabindex="0"><strong>${this._number("filter_days", " d")}</strong><small>Filter tilbage</small></div></aside></div>
    </ha-card>`;
    this._bindMoreInfo();
  }

  _styles() {
    return `:host{display:block}ha-card{display:block;box-sizing:border-box;min-height:465px;padding:12px 14px;overflow:hidden;background:var(--ha-card-background,var(--card-background-color));color:var(--primary-text-color)}header{display:flex;align-items:center;justify-content:space-between;gap:8px}header small{display:block;font-size:9px;letter-spacing:.15em;color:var(--secondary-text-color)}h2{margin:2px 0 0;font-size:20px}header span{max-width:52%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid color-mix(in srgb,var(--success-color,#59cbaa) 30%,transparent);border-radius:20px;padding:5px 9px;color:var(--success-color,#81d7bd);font-size:11px}.body{display:grid;grid-template-columns:72px minmax(0,1fr) 72px;grid-template-areas:"left diagram right";gap:8px;height:340px}.diagram{min-width:0;position:relative;grid-area:diagram}.diagram svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.house{fill:#f2994a14;stroke:#86afc244;stroke-width:1.3}.zone{font-size:10px;font-weight:600;letter-spacing:1.5px;fill:var(--secondary-text-color)}.climate{font-size:9px;fill:var(--secondary-text-color)}.climate path{stroke:#ffffff24}.climate-value{font-size:17px;font-weight:500;fill:var(--primary-text-color)}.rim{fill:none;stroke:#8295a5;stroke-width:14;opacity:.7}.inner{fill:none;stroke:#1d2b36;stroke-width:11}.temperature-segment{fill:none;stroke-width:8;opacity:.76;stroke-linecap:butt}.core-label{pointer-events:auto}.core-value{font-size:14px;font-weight:650;fill:var(--primary-text-color)}.core-caption{font-size:6px;letter-spacing:.04em;fill:var(--secondary-text-color)}.flow-stream{display:none;fill:none;stroke-linecap:round;pointer-events:none}.running .flow-stream{display:inline;animation:flow-march var(--flow-duration,5.5s) linear infinite}.flow-stream.glow{stroke:#ffffff30;stroke-width:5;stroke-dasharray:2 10;filter:blur(2px)}.flow-stream.pulse{stroke:#ffffffe0;stroke-width:2.15;stroke-dasharray:1.5 10.5;filter:drop-shadow(0 0 2px #ffffffaa)}.core{fill:#192531;stroke:#7c9aad;stroke-width:1.5}.fin{fill:none;stroke:#86afc2;opacity:.6}.bypass .core,.bypass .fin{opacity:.3}.fan rect{fill:#1b2935;stroke:#89a8b9}.fan ellipse{fill:#0c1822}.fan text{font-size:12px;fill:var(--primary-text-color)}.fan-wind{fill:none;stroke-width:1.5;stroke-linecap:round;opacity:0;will-change:transform,opacity}.fan-wind.running.supply{animation:wind-supply 2.8s linear infinite}.fan-wind.running.extract{animation:wind-extract 2.8s linear infinite}.temp .label{font-size:11px;fill:var(--secondary-text-color)}.temp .value{font-size:24px;font-weight:600}.coil text{font-size:12px;fill:var(--primary-text-color)}.coil .face{fill:#222c38;stroke:#ad927877}.coil .face,.coil path,.coil text{transition:opacity .45s ease,filter .45s ease,stroke .45s ease}.coil:not(.active) .face,.coil:not(.active) path{opacity:.24}.coil:not(.active) text{opacity:.38}.coil.active .face{stroke:#ff6655;filter:drop-shadow(0 0 5px #ff4f3f)}.coil .glow{fill:#ff4f3f;filter:blur(9px);opacity:0}.coil.active .glow{animation:afterheat-glow 2.4s ease-in-out infinite;opacity:.58}.coil path{stroke:#ffffff25}.coil.active path{stroke:#ffb0a2aa}.coil .small{font-size:9px;fill:var(--secondary-text-color)}.coil .coil-value{font-size:17px;font-weight:600}aside{display:grid;grid-template-rows:repeat(4,1fr)}aside.right{grid-area:right;border-left:1px solid #ffffff12}aside.left{grid-area:left;border-right:1px solid #ffffff12}aside div{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:3px;min-width:0}aside strong,aside small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}aside strong{font-size:15px;font-weight:500}aside small{font-size:8px;color:var(--secondary-text-color)}aside div.info strong{color:#69cfe8}aside div.ok strong{color:var(--success-color,#73d2ae)}aside div.danger strong{color:#f08383}@keyframes flow-march{from{stroke-dashoffset:0}to{stroke-dashoffset:-24}}@keyframes pulse{0%,100%{opacity:.12}50%{opacity:.4}}@keyframes afterheat-glow{0%,100%{opacity:.38}50%{opacity:.82}}@keyframes wind-supply{0%{transform:translateX(0);opacity:0}12%{opacity:.82}88%{opacity:.82}100%{transform:translateX(14px);opacity:0}}@keyframes wind-extract{0%{transform:translateX(0);opacity:0}12%{opacity:.82}88%{opacity:.82}100%{transform:translateX(-14px);opacity:0}}${this._config.animation === false ? ".air,.flow-stream,.fan-wind{display:none!important}.coil .glow{animation:none!important}" : ""}@media(prefers-reduced-motion:reduce){.air,.flow-stream,.fan-wind{display:none!important}.coil .glow{animation:none!important}}@media(max-width:500px){ha-card{min-height:460px;padding:10px 7px}.body{grid-template-columns:62px minmax(0,1fr) 62px;height:310px}.temp .value{font-size:20px}}`;
  }

  _responsiveStyles() {
    return `
      :host {
        container-type: inline-size;
        --vent-bg: var(--primary-background-color, #1c1c1c);
        --vent-fg: var(--primary-text-color);
        --vent-muted: var(--secondary-text-color);
        --vent-component: color-mix(in srgb, var(--vent-bg) 91%, var(--vent-fg) 9%);
        --vent-component-strong: color-mix(in srgb, var(--vent-bg) 68%, var(--vent-fg) 32%);
        --vent-line: color-mix(in srgb, var(--vent-fg) 18%, transparent);
      }
      ha-card {
        background: var(--ha-card-background, var(--card-background-color, var(--vent-bg)));
        color: var(--vent-fg);
        border: 1px solid var(--vent-line);
      }
      .temp .value, .climate-value, .coil .coil-value {
        fill: color-mix(in srgb, var(--vent-fg) 78%, var(--vent-bg));
      }
      .temp .label { font-size: 12.5px; }
      .temp .value { font-size: 22px; }
      .climate { font-size: 10px; }
      .climate-value { font-size: 16px; }
      .coil .small { font-size: 10px; }
      .coil .coil-value { font-size: 16px; }
      .house { fill: #f2994a14; stroke: var(--vent-line); }
      .rim { stroke: color-mix(in srgb, var(--vent-fg) 42%, var(--vent-bg)); }
      .inner { stroke: color-mix(in srgb, var(--vent-bg) 54%, var(--vent-fg) 46%); }
      .core, .fan rect, .coil .face { fill: var(--vent-component); stroke: color-mix(in srgb, var(--vent-fg) 38%, transparent); }
      .fan ellipse { fill: var(--vent-component-strong); }
      .fin, .coil path, .climate path { stroke: color-mix(in srgb, var(--vent-fg) 25%, transparent); }
      .entity-hit { cursor: pointer; }
      .entity-hit:focus-visible { outline: 2px solid var(--info-color, #4aa3ff); outline-offset: 2px; }
      @media (max-width: 700px) {
        ha-card { min-height: 0; padding: 12px 10px; }
        header { padding: 0 3px 6px; }
        header small { font-size: 11px; }
        h2 { font-size: 30px; }
        header span { max-width: 46%; font-size: 12px; padding: 7px 9px; }
        .body {
          grid-template-columns: 1fr;
          grid-template-rows: 380px auto auto;
          grid-template-areas: "diagram" "left" "right";
          gap: 8px;
          height: auto;
        }
        .diagram { min-height: 380px; }
        aside {
          grid-template-columns: repeat(4, minmax(0, 1fr));
          grid-template-rows: auto;
          border: 0;
          border-top: 1px solid var(--vent-line);
          gap: 0;
          padding: 10px 2px 2px;
        }
        aside div { min-width: 0; min-height: 54px; padding: 4px 5px; }
        aside div + div { border-left: 1px solid color-mix(in srgb, var(--vent-fg) 10%, transparent); }
        aside strong { font-size: 18px; line-height: 1; font-weight: 700; letter-spacing: -.02em; white-space: nowrap; }
        aside small { margin-top: 5px; font-size: 10px; line-height: 1.15; text-wrap: balance; }
        .zone { font-size: 13px; }
        .climate { font-size: 13px; }
        .climate-value { font-size: 21px; font-weight: 600; }
        .temp .label { font-size: 15px; }
        .temp .value { font-size: 27px; font-weight: 650; }
        .fan text { font-size: 15px; }
        .coil text { font-size: 15px; }
        .coil .small { font-size: 11px; }
        .coil .coil-value { font-size: 18px; }
      }
    `;
  }
}

if (!customElements.get("ha-ventilation-card")) customElements.define("ha-ventilation-card", HAVentilationCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "ha-ventilation-card", name: "HA Ventilation Card", description: "Temperature-aware heat-recovery ventilation card", preview: true });
console.info(`%c HA-VENTILATION-CARD %c ${VERSION} `, "color:#fff;background:#28789f;font-weight:700", "color:#28789f;background:#fff");
