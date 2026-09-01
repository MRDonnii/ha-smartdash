(function () {
  let DISTRICT = {};
  let ROOMS = [];
  let HEAT_PUMPS = [];
  let AUTOMATION_ID = null;
  let DANTHERM = {};
  let HAS_VENTILATION = false;
  let HAS_DISTRICT = false;
  let ANALYTICS = {};
  let heatingHistory = {};
  let historyLoading = false;

  let containerEl = null;

  function applyConfig() {
    const config = BeastConfig.get("panels.heating") || {};
    ROOMS = (config.rooms || []).map((id) => ({ id, label: BeastEntityPicker.friendlyName(id) }));
    HEAT_PUMPS = (config.heatPumps || []).map((id) => ({ id, unit: config.heatPumpUnits?.[id] || id, label: BeastEntityPicker.friendlyName(id) }));
    AUTOMATION_ID = config.automation || null;
    const district = Array.isArray(config.districtSensors) ? config.districtSensors : [];
    HAS_DISTRICT = district.some(Boolean);
    ["supply", "return", "cooling", "power", "energyToday", "energyMonth", "flow", "alarm"].forEach((key, index) => {
      DISTRICT[key] = district[index] || null;
    });
    ANALYTICS = {
      power: config.heatPowerSensor || DISTRICT.power || null,
      today: config.heatEnergyTodaySensor || DISTRICT.energyToday || null,
      month: config.heatEnergyMonthSensor || DISTRICT.energyMonth || null
    };
    const ventilation = Array.isArray(config.ventilationSensors) ? config.ventilationSensors : [];
    HAS_VENTILATION = ventilation.some(Boolean);
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

  function findCalefaEntity(...patterns) {
    const states = BeastHaSocket.getAllStates();
    for (const [entityId, state] of states) {
      const haystack = `${entityId} ${state?.attributes?.friendly_name || ""}`.toLowerCase();
      if (patterns.every((pattern) => haystack.includes(pattern))) return entityId;
    }
    return null;
  }

  function calefaEntities() {
    const find = (...patterns) => findCalefaEntity("wavin", "calefa", ...patterns);
    const existing = (entityId, fallback) => BeastHaSocket.getState(entityId) ? entityId : fallback;
    return {
      primary_supply: existing("sensor.wavin_calefa_2_fjernvarme_fremlob_temperatur", DISTRICT.supply || find("fjernvarme", "freml")),
      summer_cutoff: existing("sensor.wavin_calefa_2_itc_max_outdoor_temp", find("sommerudkobling")),
      primary_return: existing("sensor.wavin_calefa_2_fjernvarme_retur_temperatur", DISTRICT.return || find("fjernvarme", "retur")),
      primary_cooling: existing("sensor.calefa_fjernvarme_delta_t", DISTRICT.cooling),
      pressure: find("anlaegstryk"), meter_power: existing("sensor.calefa_fjernvarme_effekt_estimat", DISTRICT.power),
      meter_flow: existing("sensor.calefa_fjernvarme_flow_aktiv", DISTRICT.flow), meter_energy_total: existing("sensor.fjernvarme_total_energy_consumption_2", findCalefaEntity("fjernvarme_total_energy")),
      meter_volume_total: existing("sensor.fjernvarme_total_volume_2", findCalefaEntity("fjernvarme_total_volume")),
      ch_supply: find("cvv", "freml"), ch_return: find("cvv", "retur"),
      ch_valve: existing("sensor.wavin_calefa_2_cvv_ventilposition", find("cvv", "ventilposition")), ch_flow: existing("sensor.calefa_radiator_flow_aktiv", findCalefaEntity("calefa_radiator_flow")),
      ch_power: existing("sensor.calefa_radiator_effekt_estimat", findCalefaEntity("calefa_radiator_effekt")), ch_outdoor: find("udetemperatur"),
      ch_pump: find("heating_pump_status"), dhw_cold_in: find("koldtvands"),
      dhw_hot_out: existing("sensor.wavin_calefa_2_brugsvand_ud_temperatur", find("brugsvand", "temperatur")), dhw_flow: find("brugsvandsflow"),
      dhw_power: existing("sensor.wavin_calefa_2_varmtvand_effekt_estimat", findCalefaEntity("calefa_varmtvand_effekt")), dhw_valve: existing("sensor.wavin_calefa_2_ventilposition", find("varmtvandsventil")),
      dhw_setpoint: find("brugsvand", "setpunkt"), dhw_status: find("brugsvand", "status"),
      circulation_temp: find("cirkulation", "temperatur"), circulation_status: find("cirkulation", "status"),
      circulation_bypass_temp: find("bypass", "temperatur"), bvv_bypass_status: findCalefaEntity("bvv_bypass_status"),
      standby: existing("switch.bryggers_wavin_calefa_2", findCalefaEntity("switch.wavin_calefa", "standby")), vacation: existing("switch.bryggers_wavin_calefa_2_2", findCalefaEntity("switch.wavin_calefa", "ferie")),
      sentio_active: existing("switch.bryggers_wavin_calefa_2_varme_varmekald", null), sentio_status: existing("sensor.bryggers_wavin_calefa_2_varmekald_status", null),
      sentio_call_active: existing("binary_sensor.bryggers_wavin_calefa_2_varmekald_i_gang", null), sentio_fejl: existing("binary_sensor.bryggers_wavin_calefa_2_varmekald_fejl", null),
      auto_standby_active: existing("switch.bryggers_wavin_calefa_2_varme_automatisk_standby", null), auto_standby_status: existing("sensor.bryggers_wavin_calefa_2_automatisk_standby_status", null),
      auto_standby_engaged: existing("binary_sensor.bryggers_wavin_calefa_2_automatisk_standby_aktiv", null), auto_standby_fejl: existing("binary_sensor.bryggers_wavin_calefa_2_automatisk_standby_fejl", null),
      alarms: [
        "binary_sensor.wavin_calefa_2_tryk_kritisk_lav_fejl", "binary_sensor.wavin_calefa_2_tryk_lav_advarsel",
        "binary_sensor.wavin_calefa_2_tryk_hoj_advarsel", "binary_sensor.wavin_calefa_2_district_heating_supply_sensor_failure",
        "binary_sensor.wavin_calefa_2_district_heating_return_sensor_failure", "binary_sensor.wavin_calefa_2_dhw_motor_failure",
        "binary_sensor.wavin_calefa_2_dhw_motor_stuck", "binary_sensor.wavin_calefa_2_dhw_sensor_failure",
        "binary_sensor.wavin_calefa_2_cold_water_sensor_failure", "binary_sensor.wavin_calefa_2_no_secondary_pressure",
        "binary_sensor.wavin_calefa_2_pressure_sensor_failure", "binary_sensor.wavin_calefa_2_flow_sensor_failure",
        "binary_sensor.wavin_calefa_2_heating_supply_sensor_failure_itc", "binary_sensor.wavin_calefa_2_heating_return_sensor_failure_itc",
        "binary_sensor.wavin_calefa_2_outdoor_sensor_failure", "binary_sensor.wavin_calefa_2_heating_valve_motor_failure_itc",
        "binary_sensor.wavin_calefa_2_htco_error_itc", "binary_sensor.wavin_calefa_2_lav_energi_advarsel",
        DISTRICT.alarm
      ].filter((entityId) => entityId && BeastHaSocket.getState(entityId))
    };
  }

  function mountCalefaCard() {
    const card = containerEl?.querySelector("ha-fjernvarme-house-card");
    if (!card) return;
    card.setConfig({ title: "Fjernvarme", animation: true, show_details: false, entities: calefaEntities() });
    card.hass = {
      states: Object.fromEntries(BeastHaSocket.getAllStates()),
      callService: (domain, service, data) => BeastAuth.haFetch(`/api/services/${domain}/${service}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data || {})
      })
    };
  }

  function callService(domain, service, entityId, data = {}) {
    return BeastAuth.haFetch(`/api/services/${domain}/${service}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_id: entityId, ...data })
    }).catch((error) => BeastCore.log(`Varme: kommando fejlede (${error.message}).`));
  }

  function stateValue(id, decimals = 1) {
    const state = BeastHaSocket.getState(id);
    const value = Number(state?.state);
    return { value: Number.isFinite(value) ? value : null, unit: state?.attributes?.unit_of_measurement || "", text: Number.isFinite(value) ? value.toFixed(decimals) : "–" };
  }

  function historyPath(values, width = 540, height = 118) {
    if (!Array.isArray(values) || values.length < 2) return "";
    const min = Math.min(...values), max = Math.max(...values), span = Math.max(.001, max - min);
    return values.map((value, index) => `${index ? "L" : "M"}${(index / (values.length - 1) * width).toFixed(1)},${(height - ((value - min) / span) * (height - 12) - 6).toFixed(1)}`).join(" ");
  }

  function analyticsMarkup() {
    const power = stateValue(ANALYTICS.power, 1), today = stateValue(ANALYTICS.today, 1), month = stateValue(ANALYTICS.month, 1);
    const powerSeries = heatingHistory[ANALYTICS.power] || [];
    const co2Series = heatingHistory[DANTHERM.co2] || [];
    const chart = (series, label, colorClass) => `<div class="beast-heating-chart ${colorClass}"><div><span>${label}</span><small>${series.length ? "Seneste 24 timer" : historyLoading ? "Henter historik…" : "Ingen historik"}</small></div><svg viewBox="0 0 540 118" preserveAspectRatio="none" aria-label="${label}">${series.length > 1 ? `<path class="area" d="${historyPath(series)} L540,118 L0,118 Z"></path><path class="line" d="${historyPath(series)}"></path>` : ""}</svg></div>`;
    return `<section class="beast-heating-analytics">
      <div class="beast-heating-analytics-head"><div><small>Forbrug og indeklima</small><strong>Varme de seneste 24 timer</strong></div><span>${BeastCore.icon("bolt", { size:20 })} Live fra Home Assistant</span></div>
      <div class="beast-heating-kpis">
        <article><small>Effekt nu</small><strong>${power.text}<em>${escapeHtml(power.unit)}</em></strong><span>${ANALYTICS.power ? BeastEntityPicker.friendlyName(ANALYTICS.power) : "Vælg sensor i Admin"}</span></article>
        <article><small>Forbrug i dag</small><strong>${today.text}<em>${escapeHtml(today.unit)}</em></strong><span>Akkumuleret siden midnat</span></article>
        <article><small>Denne måned</small><strong>${month.text}<em>${escapeHtml(month.unit)}</em></strong><span>Samlet varmeenergi</span></article>
        <article><small>Dantherm CO₂</small><strong>${num(DANTHERM.co2, 0)}<em>ppm</em></strong><span>${num(DANTHERM.recovery, 0)}% genvinding</span></article>
      </div>
      <div class="beast-heating-chart-grid">${chart(powerSeries, "Varmeeffekt", "is-heat")}${chart(co2Series, "CO₂ og luftkvalitet", "is-air")}</div>
    </section>`;
  }

  async function loadHeatingHistory() {
    if (historyLoading) return;
    const ids = [...new Set([ANALYTICS.power, DANTHERM.co2].filter(Boolean))];
    if (!ids.length) return;
    historyLoading = true;
    render();
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    try {
      const payload = await BeastAuth.haFetch(`/api/history/period/${start}?filter_entity_id=${encodeURIComponent(ids.join(","))}&minimal_response`);
      ids.forEach((id) => { heatingHistory[id] = []; });
      (Array.isArray(payload) ? payload : []).forEach((rows) => {
        const id = rows?.[0]?.entity_id;
        if (!id || !ids.includes(id)) return;
        heatingHistory[id] = rows.map((row) => Number(row.state)).filter(Number.isFinite);
      });
    } catch (error) {
      BeastCore.log(`Varme: kunne ikke hente historik (${error.message}).`);
    } finally {
      historyLoading = false;
      render();
    }
  }

  function buildRoomCard(room) {
    const s = BeastHaSocket.getState(room.id);
    const current = s && Number.isFinite(Number(s.attributes.current_temperature)) ? Number(s.attributes.current_temperature).toFixed(1) : "–";
    const target = s && Number.isFinite(Number(s.attributes.temperature)) ? Number(s.attributes.temperature) : null;
    const heating = s && s.attributes.hvac_action === "heating";
    const cooling = s && s.attributes.hvac_action === "cooling";
    const on = s && s.state !== "off";

    return `
      <div class="beast-heating-room-card${heating ? " is-heating" : ""}${cooling ? " is-cooling" : ""}${on ? " is-on" : " is-off"}">
        <div class="beast-heating-room-head">
          <span class="beast-heating-room-name">${escapeHtml(room.label)}</span>
          <span class="beast-room-badge${on ? " is-active" : ""}">${on ? (heating ? "Varmer" : cooling ? "Køler" : "Tændt") : "Slukket"}</span>
        </div>
        <div class="beast-heating-room-reading"><span><small>Rumtemperatur</small><strong class="beast-heating-room-current">${current}°</strong></span><i aria-hidden="true">${BeastCore.icon(heating ? "flame" : cooling ? "snowflake" : "thermometer", { size: 19 })}</i></div>
        <div class="beast-stepper">
          <button type="button" class="beast-transport-btn" data-action="heat-down" data-entity="${room.id}" aria-label="Sænk temperaturen i ${escapeHtml(room.label)}">${BeastCore.icon("minus", { size: 16 })}</button>
          <span class="beast-stepper-value"><small>Måltemperatur</small><strong>${target !== null ? `${target}°` : "–"}</strong></span>
          <button type="button" class="beast-transport-btn" data-action="heat-up" data-entity="${room.id}" aria-label="Hæv temperaturen i ${escapeHtml(room.label)}">${BeastCore.icon("plus", { size: 16 })}</button>
        </div>
      </div>
    `;
  }

  function climateOptionLabel(option) {
    const labels = {
      off: "Slukket", heat: "Varme", cool: "Køl", heat_cool: "Auto", auto: "Auto",
      dry: "Affugt", fan_only: "Blæser", fan: "Blæser", none: "Ingen", low: "Lav",
      medium_low: "Mellem-lav", medium: "Mellem", medium_high: "Mellem-høj", high: "Høj",
      quiet: "Stille", manual: "Manuel", full_swing: "Fuld bevægelse"
    };
    const key = String(option || "").toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
    return labels[key] || String(option || "").replaceAll("_", " ").replaceAll("-", " ");
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
          ${options.map((option) => `<option value="${escapeHtml(option)}"${option === current ? " selected" : ""}>${escapeHtml(climateOptionLabel(option))}</option>`).join("")}
        </select>
      </label>
    `;
  }

  function buildHeatPumpCard(pump) {
    const s = BeastHaSocket.getState(pump.id);
    const current = s && Number.isFinite(Number(s.attributes.current_temperature)) ? Number(s.attributes.current_temperature).toFixed(1) : "–";
    const target = s && Number.isFinite(Number(s.attributes.temperature)) ? Number(s.attributes.temperature) : null;
    const action = s?.attributes?.hvac_action || s?.state || "off";
    const modes = s?.attributes?.hvac_modes || ["off", "heat", "cool", "heat_cool"];
    const pumpName = String(pump.label || pump.id).replace(/^varmepumpe\s+/i, "").replace(/^qlima\s+/i, "");
    const statusLabel = action === "heating" ? "Varmer" : action === "cooling" ? "Køler" : s?.state === "off" ? "Slukket" : "Klar";
    const statusIcon = action === "heating" ? "flame" : action === "cooling" ? "snowflake" : "wind";
    return `
      <article class="beast-heatpump-card is-${escapeHtml(action)}">
        <div class="beast-heatpump-head">
          <i>${BeastCore.icon(statusIcon, { size: 20 })}</i>
          <div><small>Varmepumpe</small><strong>${escapeHtml(pumpName)}</strong></div>
          <span><b></b>${statusLabel}</span>
          <button type="button" data-pump-power data-entity="${pump.id}" aria-label="${s?.state === "off" ? "Tænd" : "Sluk"} ${escapeHtml(pumpName)}" class="${s?.state === "off" ? "" : "is-on"}">${BeastCore.icon("power", { size: 18 })}</button>
        </div>
        <div class="beast-heatpump-main-control">
          <div class="beast-heatpump-temperature">
            <span><small>Rumtemperatur</small><strong>${current}°</strong></span>
            <div class="beast-stepper">
              <button type="button" class="beast-transport-btn" data-action="pump-temp-down" data-entity="${pump.id}" aria-label="Sænk måltemperatur">${BeastCore.icon("minus", { size: 19 })}</button>
              <span class="beast-stepper-value"><small>Måltemperatur</small><strong>${target !== null ? `${target.toFixed(1)}°` : "–"}</strong></span>
              <button type="button" class="beast-transport-btn" data-action="pump-temp-up" data-entity="${pump.id}" aria-label="Hæv måltemperatur">${BeastCore.icon("plus", { size: 19 })}</button>
            </div>
          </div>
          <div class="beast-heatpump-visual" aria-hidden="true"><span>${BeastCore.icon("fan", { size: 30 })}</span><i></i><i></i><i></i></div>
        </div>
        <div class="beast-heatpump-modes">
          ${modes.map((mode) => `<button type="button" class="${s?.state === mode ? "is-active" : ""}" data-pump-mode="${mode}" data-entity="${pump.id}">${escapeHtml(climateOptionLabel(mode))}</button>`).join("")}
        </div>
        <div class="beast-heatpump-options">
          ${optionSelect(pump.id, "preset_mode", "set_preset_mode", "Program")}
          ${optionSelect(pump.unit, "fan_mode", "set_fan_mode", "Blæser")}
          ${optionSelect(pump.unit, "swing_mode", "set_swing_mode", "Retning")}
        </div>
      </article>
    `;
  }

  function render() {
    if (!containerEl) return;
    const heatingLayout = BeastConfig.get("pageLayouts.heating.heatingLayout") || {};
    containerEl.classList.toggle("is-room-compact", heatingLayout.roomDensity === "compact");
    containerEl.classList.toggle("is-pump-roomy", heatingLayout.pumpDensity === "roomy");
    const alarm = BeastHaSocket.getState(DISTRICT.alarm);
    const alarmOk = alarm && alarm.state === "OK";
    const automation = BeastHaSocket.getState(AUTOMATION_ID);
    const automationOn = automation && automation.state === "on";
    const heatingRooms = ROOMS.filter((room) => BeastHaSocket.getState(room.id)?.attributes?.hvac_action === "heating").length;
    const activePumps = HEAT_PUMPS.filter((pump) => ["heating", "cooling"].includes(BeastHaSocket.getState(pump.id)?.attributes?.hvac_action)).length;
    const roomTemperatures = ROOMS.map((room) => Number(BeastHaSocket.getState(room.id)?.attributes?.current_temperature)).filter(Number.isFinite);
    const averageTemperature = roomTemperatures.length ? (roomTemperatures.reduce((sum, value) => sum + value, 0) / roomTemperatures.length).toFixed(1) : "–";
    const supplyFan = Number(BeastHaSocket.getState(DANTHERM.supplyFan)?.state);
    const extractFan = Number(BeastHaSocket.getState(DANTHERM.extractFan)?.state);
    const ventilationActive = (Number.isFinite(supplyFan) && supplyFan > 0) || (Number.isFinite(extractFan) && extractFan > 0);
    const districtPower = Number(BeastHaSocket.getState(DISTRICT.power)?.state);
    const districtMarkup = HAS_DISTRICT ? `<section class="beast-heating-side-card beast-district-compact beast-calefa-card${Number.isFinite(districtPower) && districtPower > 0.05 ? " is-flowing" : ""}"><ha-fjernvarme-house-card></ha-fjernvarme-house-card></section>` : "";

    containerEl.innerHTML = `
      <div class="beast-heating-main">
        <div class="beast-heating-hero">
          <div>
            <span class="beast-panel-title">Klima og komfort</span>
            <h2>Husets varme</h2>
            <p>${heatingRooms ? `${heatingRooms} rum varmer` : "Alle rum er i balance"} · gennemsnit ${averageTemperature}° · ${activePumps ? `${activePumps} varmepumpe aktiv` : "varmepumper i ro"}</p>
          </div>
          <button type="button" class="beast-heating-auto${automationOn ? " is-on" : ""}" id="beastHeatingAutoBtn">
            ${BeastCore.icon("bolt", { size: 20 })}<span><small>Automatisk styring</small><strong>${automationOn ? "Aktiv" : "Slået fra"}</strong></span>
          </button>
          <div class="beast-heating-edit-actions"><button type="button" class="beast-heating-display-btn" id="beastHeatingDisplayEdit" aria-label="Rediger kortvisning" title="Kortvisning">${BeastCore.icon("grid", { size: 19 })}</button><button type="button" class="beast-page-edit-trigger beast-heating-layout-btn" id="beastHeatingLayoutEdit" aria-label="Flyt og tilpas varmesiden" title="Flyt og tilpas">⋮</button></div>
        </div>
        <div class="beast-heating-room-grid">${ROOMS.map(buildRoomCard).join("")}</div>
      </div>
      <aside class="beast-heating-sidebar">
        <div class="beast-heating-pumps-head"><span>Varmepumper</span><small>Komplet styring</small></div>
        <div class="beast-heatpump-grid">${HEAT_PUMPS.map(buildHeatPumpCard).join("")}</div>
      </aside>
      <aside class="beast-heating-insights">
        ${analyticsMarkup()}
        ${HAS_VENTILATION ? `<section class="beast-heating-side-card beast-dantherm-card${ventilationActive ? " is-running" : ""}">
          <div class="beast-heating-side-head"><span>Dantherm ventilation</span><small>${escapeHtml(BeastHaSocket.getState(DANTHERM.mode)?.state || "–")}</small></div>
          <div class="beast-dantherm-air">
            <div><small>Indblæsning</small><strong>${num(DANTHERM.supplyTemp)}°</strong><i style="--air:${num(DANTHERM.supplyFan, 0)}%"></i></div>
            <div><small>Udsugning</small><strong>${num(DANTHERM.extractTemp)}°</strong><i style="--air:${num(DANTHERM.extractFan, 0)}%"></i></div>
          </div>
          <div class="beast-dantherm-visual" aria-hidden="true"><span>${BeastCore.icon("wind", { size: 34 })}</span><div><i></i><i></i><i></i></div><small>${ventilationActive ? "Luftskifte aktivt" : "Ventilation i ro"}</small></div>
          <div class="beast-dantherm-metrics">
            <span><small>CO₂</small><strong>${num(DANTHERM.co2, 0)} ppm</strong></span>
            <span><small>Genvinding</small><strong>${num(DANTHERM.recovery, 0)}%</strong></span>
            <span><small>Filter</small><strong class="${BeastHaSocket.getState(DANTHERM.filterAlarm)?.state === "on" ? "is-warning" : ""}">${num(DANTHERM.filterLife, 0)}%</strong></span>
            <span><small>Bypass</small><strong>${BeastHaSocket.getState(DANTHERM.bypass)?.state === "on" ? "Åben" : "Lukket"}</strong></span>
          </div>
        </section>` : ""}
        ${districtMarkup}
      </aside>
    `;
    mountCalefaCard();
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
        const step = Number(s?.attributes?.target_temp_step) || 0.5;
        const min = Number.isFinite(Number(s?.attributes?.min_temp)) ? Number(s.attributes.min_temp) : -Infinity;
        const max = Number.isFinite(Number(s?.attributes?.max_temp)) ? Number(s.attributes.max_temp) : Infinity;
        const temperature = Math.min(max, Math.max(min, current + (btn.dataset.action === "pump-temp-up" ? step : -step)));
        callService("climate", "set_temperature", btn.dataset.entity, { temperature }).then(() => window.setTimeout(render, 400));
      });
    });
    containerEl.querySelectorAll("[data-pump-mode]").forEach((btn) => btn.addEventListener("click", () => {
      callService("climate", "set_hvac_mode", btn.dataset.entity, { hvac_mode: btn.dataset.pumpMode }).then(() => window.setTimeout(render, 400));
    }));
    containerEl.querySelectorAll("[data-pump-power]").forEach((btn) => btn.addEventListener("click", () => {
      const state = BeastHaSocket.getState(btn.dataset.entity);
      const modes = Array.isArray(state?.attributes?.hvac_modes) ? state.attributes.hvac_modes : [];
      const nextMode = state?.state === "off" ? (modes.find((mode) => mode === "heat") || modes.find((mode) => mode !== "off")) : "off";
      if (nextMode) callService("climate", "set_hvac_mode", btn.dataset.entity, { hvac_mode: nextMode }).then(() => window.setTimeout(render, 400));
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
    if (!HAS_VENTILATION) hidden.add("dantherm");
    if (!HAS_DISTRICT) hidden.add("district");
    const selectors = { analytics: ".beast-heating-analytics", rooms: ".beast-heating-room-grid", pumps: ".beast-heating-pumps-head, .beast-heatpump-grid", dantherm: ".beast-dantherm-card", district: ".beast-district-compact" };
    Object.entries(selectors).forEach(([id, selector]) => containerEl.querySelectorAll(selector).forEach((el) => el.classList.toggle("is-layout-hidden", hidden.has(id))));
    BeastNativePageEditor.mount({ section:"heating", label:"Varme", root:()=>containerEl, host:()=>containerEl, trigger:"#beastHeatingLayoutEdit", cards:()=>[
      { id:"main", label:"Termostater", selector:".beast-heating-main", titleSelector:".beast-heating-hero h2", enabled:!hidden.has("rooms"), desktop:{x:1,y:1,w:4,h:12} },
      { id:"sidebar", label:"Varmepumper", selector:".beast-heating-sidebar", enabled:!hidden.has("pumps"), desktop:{x:5,y:1,w:4,h:12} },
      { id:"insights", label:"Statistik og teknik", selector:".beast-heating-insights", enabled:!hidden.has("analytics") || !hidden.has("dantherm") || !hidden.has("district"), desktop:{x:9,y:1,w:4,h:12} }
    ] });
    document.getElementById("beastHeatingDisplayEdit")?.addEventListener("click", () => openHeatingLayout(layout));
  }

  function openHeatingLayout(layout) {
    document.getElementById("beastHeatingLayoutEditor")?.remove();
    const hidden = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
    const items = [["analytics", "Forbrug og grafer"], ["rooms", "Komfortzoner"], ["pumps", "Varmepumper"], ["dantherm", "Dantherm ventilation"], ["district", "Fjernvarme"]];
    const overlay = document.createElement("div"); overlay.id = "beastHeatingLayoutEditor"; overlay.className = "beast-modal-overlay";
    overlay.innerHTML = `<div class="beast-modal beast-heating-layout-modal"><div class="beast-modal-header"><h3>Rediger kortvisning</h3><button type="button" class="beast-modal-close" data-close>×</button></div><div class="beast-modal-body"><div class="beast-heating-layout-list">${items.map(([id,label]) => `<label><input type="checkbox" data-heating-section="${id}" ${hidden.has(id) ? "" : "checked"}><strong>${label}</strong></label>`).join("")}</div><div class="beast-heating-layout-selects"><label>Termostatkort<select data-room-density><option value="spacious"${layout.roomDensity === "compact" ? "" : " selected"}>Store og tydelige</option><option value="compact"${layout.roomDensity === "compact" ? " selected" : ""}>Kompakte</option></select></label><label>Varmepumpekort<select data-pump-density><option value="compact"${layout.pumpDensity === "roomy" ? "" : " selected"}>Kompakte</option><option value="roomy"${layout.pumpDensity === "roomy" ? " selected" : ""}>Rummelige med animation</option></select></label><label>Placering af fjernvarme<select data-district-placement><option value="sidebar"${layout.districtPlacement === "pumps" ? "" : " selected"}>Højre side</option><option value="pumps"${layout.districtPlacement === "pumps" ? " selected" : ""}>Ved varmepumper</option></select></label></div><button type="button" class="beast-btn beast-btn-primary" data-save-heating-layout>Gem kortvisning</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) return overlay.remove();
      if (!event.target.closest("[data-save-heating-layout]")) return;
      const nextHidden = items.filter(([id]) => !overlay.querySelector(`[data-heating-section="${id}"]`).checked).map(([id]) => id);
      BeastConfig.set("pageLayouts.heating.heatingLayout", { ...layout, hidden: nextHidden, roomDensity: overlay.querySelector("[data-room-density]").value, pumpDensity: overlay.querySelector("[data-pump-density]").value, districtPlacement: overlay.querySelector("[data-district-placement]").value }); overlay.remove(); render();
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
    [ANALYTICS.power, ANALYTICS.today, ANALYTICS.month].filter(Boolean).forEach((id) => BeastHaSocket.subscribeEntity(id, debouncedRender));
    render();
    loadHeatingHistory();
  }

  BeastCore.registerPanel("heating", "beastHeatingZone", init);
})();
