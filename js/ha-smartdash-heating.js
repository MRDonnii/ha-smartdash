(function () {
  let DISTRICT = {};
  let ROOMS = [];
  let HEAT_PUMPS = [];
  let AUTOMATION_ID = null;
  let DANTHERM = {};

  let containerEl = null;

  function applyConfig() {
    const config = BeastConfig.get("panels.heating") || {};
    ROOMS = (config.rooms || []).map((id) => ({ id, label: BeastEntityPicker.friendlyName(id) }));
    HEAT_PUMPS = (config.heatPumps || []).map((id) => ({ id, unit: config.heatPumpUnits?.[id] || id, label: BeastEntityPicker.friendlyName(id) }));
    AUTOMATION_ID = config.automation || null;
    const district = Array.isArray(config.districtSensors) ? config.districtSensors : [];
    ["supply", "return", "cooling", "power", "energyToday", "energyMonth", "flow", "alarm"].forEach((key, index) => {
      DISTRICT[key] = district[index] || null;
    });
    const ventilation = Array.isArray(config.ventilationSensors) ? config.ventilationSensors : [];
    ["mode", "co2", "supplyTemp", "extractTemp", "recovery", "supplyFan", "extractFan", "filterLife", "filterAlarm", "bypass"].forEach((key, index) => {
      DANTHERM[key] = ventilation[index] || null;
    });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function num(id, decimals = 1) {
    const s = BeastHaSocket.getState(id);
    return s && Number.isFinite(Number(s.state)) ? Number(s.state).toFixed(decimals) : "–";
  }

  function callService(domain, service, entityId, data = {}) {
    return BeastAuth.haFetch(`/api/services/${domain}/${service}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_id: entityId, ...data })
    }).catch((error) => BeastCore.log(`Varme: kommando fejlede (${error.message}).`));
  }

  function buildRoomCard(room) {
    const s = BeastHaSocket.getState(room.id);
    const current = s && Number.isFinite(Number(s.attributes.current_temperature)) ? Number(s.attributes.current_temperature).toFixed(1) : "–";
    const target = s && Number.isFinite(Number(s.attributes.temperature)) ? Number(s.attributes.temperature) : null;
    const heating = s && s.attributes.hvac_action === "heating";
    const on = s && s.state !== "off";

    return `
      <div class="beast-heating-room-card${heating ? " is-heating" : ""}">
        <div class="beast-heating-room-head">
          <span class="beast-heating-room-name">${escapeHtml(room.label)}</span>
          <span class="beast-room-badge${on ? " is-active" : ""}">${on ? (heating ? "Varmer" : "Tændt") : "Slukket"}</span>
        </div>
        <span class="beast-heating-room-current">${current}°</span>
        <div class="beast-stepper">
          <button type="button" class="beast-transport-btn" data-action="heat-down" data-entity="${room.id}">${BeastCore.icon("minus", { size: 16 })}</button>
          <span class="beast-stepper-value">${target !== null ? `${target}°` : "–"}</span>
          <button type="button" class="beast-transport-btn" data-action="heat-up" data-entity="${room.id}">${BeastCore.icon("plus", { size: 16 })}</button>
        </div>
      </div>
    `;
  }

  function optionSelect(entityId, property, service, label) {
    const s = BeastHaSocket.getState(entityId);
    const options = s?.attributes?.[`${property}s`] || [];
    const current = s?.attributes?.[property] || "";
    if (!options.length) return "";
    return `
      <label class="beast-heatpump-select">
        <span>${label}</span>
        <select data-climate-select="${entityId}" data-service="${service}" data-field="${property}">
          ${options.map((option) => `<option value="${escapeHtml(option)}"${option === current ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}
        </select>
      </label>
    `;
  }

  function buildHeatPumpCard(pump) {
    const s = BeastHaSocket.getState(pump.id);
    const current = s && Number.isFinite(Number(s.attributes.current_temperature)) ? Number(s.attributes.current_temperature).toFixed(1) : "–";
    const target = s && Number.isFinite(Number(s.attributes.temperature)) ? Number(s.attributes.temperature) : null;
    const action = s?.attributes?.hvac_action || s?.state || "off";
    const preset = s?.attributes?.preset_mode || "auto";
    const modes = s?.attributes?.hvac_modes || ["off", "heat", "cool", "heat_cool"];
    const modeLabels = { off: "Fra", heat: "Varme", cool: "Køl", heat_cool: "Auto" };
    return `
      <article class="beast-heatpump-card is-${escapeHtml(action)}">
        <div class="beast-heatpump-head">
          <div><small>Varmepumpe</small><strong>${escapeHtml(pump.label)}</strong></div>
          <span>${action === "heating" ? "Varmer" : action === "cooling" ? "Køler" : s?.state === "off" ? "Slukket" : "Klar"}</span>
        </div>
        <div class="beast-heatpump-temperature">
          <span><small>Rum</small><strong>${current}°</strong></span>
          <div class="beast-stepper">
            <button type="button" class="beast-transport-btn" data-action="pump-temp-down" data-entity="${pump.id}">${BeastCore.icon("minus", { size: 18 })}</button>
            <span class="beast-stepper-value"><small>Mål</small>${target !== null ? `${target.toFixed(1)}°` : "–"}</span>
            <button type="button" class="beast-transport-btn" data-action="pump-temp-up" data-entity="${pump.id}">${BeastCore.icon("plus", { size: 18 })}</button>
          </div>
        </div>
        <div class="beast-heatpump-modes">
          ${modes.map((mode) => `<button type="button" class="${s?.state === mode ? "is-active" : ""}" data-pump-mode="${mode}" data-entity="${pump.id}">${modeLabels[mode] || mode}</button>`).join("")}
        </div>
        <div class="beast-heatpump-options">
          <div class="beast-heatpump-presets">
            <button type="button" class="${preset === "auto" ? "is-active" : ""}" data-preset="auto" data-entity="${pump.id}">Automatik</button>
            <button type="button" class="${preset === "manual" ? "is-active" : ""}" data-preset="manual" data-entity="${pump.id}">Manuel</button>
          </div>
          ${optionSelect(pump.unit, "fan_mode", "set_fan_mode", "Blæser")}
          ${optionSelect(pump.unit, "swing_mode", "set_swing_mode", "Retning")}
        </div>
      </article>
    `;
  }

  function render() {
    if (!containerEl) return;
    const alarm = BeastHaSocket.getState(DISTRICT.alarm);
    const alarmOk = alarm && alarm.state === "OK";
    const automation = BeastHaSocket.getState(AUTOMATION_ID);
    const automationOn = automation && automation.state === "on";

    containerEl.innerHTML = `
      <div class="beast-heating-main">
        <div class="beast-heating-hero">
          <div>
            <span class="beast-panel-title">Komfortzoner</span>
            <h2>Styr varmen rum for rum</h2>
            <p>${ROOMS.filter((room) => BeastHaSocket.getState(room.id)?.attributes?.hvac_action === "heating").length} rum varmer lige nu</p>
          </div>
          <button type="button" class="beast-heating-auto${automationOn ? " is-on" : ""}" id="beastHeatingAutoBtn">
            ${BeastCore.icon("bolt", { size: 20 })}<span><small>Automatisk styring</small><strong>${automationOn ? "Aktiv" : "Slået fra"}</strong></span>
          </button>
          <button type="button" class="beast-heating-layout-btn" id="beastHeatingLayoutEdit" aria-label="Rediger varmelayout">⋮</button>
        </div>
        <div class="beast-heating-room-grid">${ROOMS.map(buildRoomCard).join("")}</div>
        <div class="beast-heating-pumps-head"><span>Varmepumper</span><small>Fuld direkte styring</small></div>
        <div class="beast-heatpump-grid">${HEAT_PUMPS.map(buildHeatPumpCard).join("")}</div>
      </div>
      <aside class="beast-heating-sidebar">
        <section class="beast-heating-side-card beast-dantherm-card">
          <div class="beast-heating-side-head"><span>Dantherm ventilation</span><small>${escapeHtml(BeastHaSocket.getState(DANTHERM.mode)?.state || "–")}</small></div>
          <div class="beast-dantherm-air">
            <div><small>Indblæsning</small><strong>${num(DANTHERM.supplyTemp)}°</strong><i style="--air:${num(DANTHERM.supplyFan, 0)}%"></i></div>
            <div><small>Udsugning</small><strong>${num(DANTHERM.extractTemp)}°</strong><i style="--air:${num(DANTHERM.extractFan, 0)}%"></i></div>
          </div>
          <div class="beast-dantherm-metrics">
            <span><small>CO₂</small><strong>${num(DANTHERM.co2, 0)} ppm</strong></span>
            <span><small>Genvinding</small><strong>${num(DANTHERM.recovery, 0)}%</strong></span>
            <span><small>Filter</small><strong class="${BeastHaSocket.getState(DANTHERM.filterAlarm)?.state === "on" ? "is-warning" : ""}">${num(DANTHERM.filterLife, 0)}%</strong></span>
            <span><small>Bypass</small><strong>${BeastHaSocket.getState(DANTHERM.bypass)?.state === "on" ? "Åben" : "Lukket"}</strong></span>
          </div>
        </section>
        <section class="beast-heating-side-card beast-district-compact">
          <div class="beast-heating-side-head"><span>Fjernvarme</span><small class="${alarmOk ? "is-ok" : "is-warning"}">${escapeHtml(alarm?.state || "–")}</small></div>
          <div class="beast-district-flow">
            <span><small>Fremløb</small><strong>${num(DISTRICT.supply)}°</strong></span>
            <i></i>
            <span><small>Retur</small><strong>${num(DISTRICT.return)}°</strong></span>
          </div>
          <div class="beast-district-meta"><span>Afkøling ${num(DISTRICT.cooling)}°</span><span>${num(DISTRICT.power, 1)} kW</span><span>${num(DISTRICT.energyToday, 1)} kWh i dag</span></div>
        </section>
      </aside>
    `;
    wireHeatingLayout();

    containerEl.querySelectorAll("[data-action='heat-up'], [data-action='heat-down']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const entityId = btn.dataset.entity;
        const s = BeastHaSocket.getState(entityId);
        const current = s && Number.isFinite(Number(s.attributes.temperature)) ? Number(s.attributes.temperature) : 20;
        const next = current + (btn.dataset.action === "heat-up" ? 0.5 : -0.5);
        callService("climate", "set_temperature", entityId, { temperature: next }).then(() => window.setTimeout(render, 400));
      });
    });

    containerEl.querySelectorAll("[data-action='pump-temp-up'], [data-action='pump-temp-down']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const s = BeastHaSocket.getState(btn.dataset.entity);
        const current = Number.isFinite(Number(s?.attributes?.temperature)) ? Number(s.attributes.temperature) : 22;
        const temperature = current + (btn.dataset.action === "pump-temp-up" ? 0.5 : -0.5);
        callService("climate", "set_temperature", btn.dataset.entity, { temperature }).then(() => window.setTimeout(render, 400));
      });
    });
    containerEl.querySelectorAll("[data-pump-mode]").forEach((btn) => btn.addEventListener("click", () => {
      callService("climate", "set_hvac_mode", btn.dataset.entity, { hvac_mode: btn.dataset.pumpMode }).then(() => window.setTimeout(render, 400));
    }));
    containerEl.querySelectorAll("[data-preset]").forEach((btn) => btn.addEventListener("click", () => {
      callService("climate", "set_preset_mode", btn.dataset.entity, { preset_mode: btn.dataset.preset }).then(() => window.setTimeout(render, 400));
    }));
    containerEl.querySelectorAll("[data-climate-select]").forEach((select) => select.addEventListener("change", () => {
      callService("climate", select.dataset.service, select.dataset.climateSelect, { [select.dataset.field]: select.value }).then(() => window.setTimeout(render, 400));
    }));

    document.getElementById("beastHeatingAutoBtn")?.addEventListener("click", () => {
      callService("input_boolean", automationOn ? "turn_off" : "turn_on", AUTOMATION_ID).then(() => window.setTimeout(render, 400));
    });
  }

  function wireHeatingLayout() {
    const layout = BeastConfig.get("pageLayouts.heating.heatingLayout") || {};
    const hidden = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
    const selectors = { rooms: ".beast-heating-room-grid", pumps: ".beast-heating-pumps-head, .beast-heatpump-grid", dantherm: ".beast-dantherm-card", district: ".beast-district-compact" };
    Object.entries(selectors).forEach(([id, selector]) => containerEl.querySelectorAll(selector).forEach((el) => el.classList.toggle("is-layout-hidden", hidden.has(id))));
    BeastNativePageEditor.mount({ section:"heating", label:"Varme", root:()=>containerEl, host:()=>containerEl, trigger:"#beastHeatingLayoutEdit", cards:()=>[
      { id:"main", label:"Komfortzoner og varmepumper", selector:".beast-heating-main", titleSelector:".beast-heating-hero h2", enabled:!hidden.has("rooms") || !hidden.has("pumps"), desktop:{x:1,y:1,w:9,h:12} },
      { id:"sidebar", label:"Ventilation og fjernvarme", selector:".beast-heating-sidebar", enabled:!hidden.has("dantherm") || !hidden.has("district"), desktop:{x:10,y:1,w:3,h:12} }
    ] });
  }

  function openHeatingLayout(layout) {
    document.getElementById("beastHeatingLayoutEditor")?.remove();
    const hidden = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
    const items = [["rooms", "Komfortzoner"], ["pumps", "Varmepumper"], ["dantherm", "Dantherm ventilation"], ["district", "Fjernvarme"]];
    const overlay = document.createElement("div"); overlay.id = "beastHeatingLayoutEditor"; overlay.className = "beast-modal-overlay";
    overlay.innerHTML = `<div class="beast-modal beast-heating-layout-modal"><div class="beast-modal-header"><h3>Rediger varmelayout</h3><button type="button" class="beast-modal-close" data-close>×</button></div><div class="beast-modal-body"><div class="beast-heating-layout-list">${items.map(([id,label]) => `<label><input type="checkbox" data-heating-section="${id}" ${hidden.has(id) ? "" : "checked"}><strong>${label}</strong></label>`).join("")}</div><button type="button" class="beast-btn beast-btn-primary" data-save-heating-layout>Gem layout</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) return overlay.remove();
      if (!event.target.closest("[data-save-heating-layout]")) return;
      const nextHidden = items.filter(([id]) => !overlay.querySelector(`[data-heating-section="${id}"]`).checked).map(([id]) => id);
      BeastConfig.set("pageLayouts.heating.heatingLayout", { ...layout, hidden: nextHidden }); overlay.remove(); render();
    });
  }

  function init(root) {
    applyConfig();
    containerEl = root;
    containerEl.classList.add("beast-heating-panel");
    containerEl.innerHTML = `<p class="beast-music-empty">Henter…</p>`;

    BeastHaSocket.onStatusChange((status) => { if (status === "connected") render(); });
    const debouncedRender = BeastCore.stableUpdater(containerEl, render, 300);
    [...Object.values(DISTRICT), ...Object.values(DANTHERM), ...ROOMS.map((r) => r.id), ...HEAT_PUMPS.flatMap((p) => [p.id, p.unit]), AUTOMATION_ID].forEach((id) => {
      BeastHaSocket.subscribeEntity(id, debouncedRender);
    });
  }

  BeastCore.registerPanel("heating", "beastHeatingZone", init);
})();
