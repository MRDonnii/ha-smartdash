(function () {
  let IDS = {};
  let VEHICLE_LABEL = "Elbil";

  function applyConfig() {
    const config = BeastConfig.get("panels.car") || {};
    const configuredDevice = config.sourceDevice ? BeastRegistry.getDevice(config.sourceDevice) : null;
    VEHICLE_LABEL = configuredDevice?.name || configuredDevice?.name_by_user || "Elbil";
    IDS = {
      battery: config.battery, range: config.range, shiftState: config.shiftState, chargerPower: config.chargerPower,
      chargingFinish: config.chargingFinishAt, charging: config.charging, pluggedIn: config.pluggedIn,
      doors: config.doorsOpen, windows: config.windowsOpen, locationTracker: config.locationTracker,
      lock: config.lock, odometer: config.odometer, insideTemp: config.insideTemp, outsideTemp: config.outsideTemp,
      chargingFinishAt: config.chargingFinishAt, energyAdded: config.energyAdded, tpmsFl: config.tpmsFl,
      tpmsFr: config.tpmsFr, tpmsRl: config.tpmsRl, tpmsRr: config.tpmsRr
    };
  }

  let containerEl = null;

  function callService(domain, service, entityId, data = {}) {
    return BeastAuth.haFetch(`/api/services/${domain}/${service}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_id: entityId, ...data })
    }).catch((error) => BeastCore.log(`Bil: kommando fejlede (${error.message}).`));
  }

  function stateOf(id) {
    return BeastHaSocket.getState(id);
  }

  function num(id, decimals = 0) {
    const s = stateOf(id);
    return s && Number.isFinite(Number(s.state)) ? Number(s.state).toFixed(decimals) : "–";
  }

  function buildTpms() {
    const wheels = [
      { id: IDS.tpmsFl, label: "For venstre", position: "fl" },
      { id: IDS.tpmsFr, label: "For højre", position: "fr" },
      { id: IDS.tpmsRl, label: "Bag venstre", position: "rl" },
      { id: IDS.tpmsRr, label: "Bag højre", position: "rr" }
    ].map((wheel) => ({ ...wheel, pressure: Number(stateOf(wheel.id)?.state) }));
    const valid = wheels.filter((wheel) => Number.isFinite(wheel.pressure));
    const highest = valid.length ? Math.max(...valid.map((wheel) => wheel.pressure)) : null;
    return `
      <div class="beast-tesla-tpms">
        <div class="beast-tesla-tpms-head">
          <div>
            <span>Dæktryk</span>
            <strong>${VEHICLE_LABEL}</strong>
          </div>
          <small>Live · PSI</small>
        </div>
        <div class="beast-tesla-stage">
          <div class="beast-tesla-car">
            <i class="beast-tesla-glass"></i>
            <i class="beast-tesla-roof"></i>
            <span class="beast-tesla-mark">T</span>
          </div>
          ${wheels.map((wheel) => {
            const low = highest !== null && Number.isFinite(wheel.pressure) && highest - wheel.pressure >= 2.5;
            return `
              <div class="beast-tesla-wheel beast-tesla-wheel--${wheel.position}${low ? " is-low" : ""}">
                <i></i>
                <span><small>${wheel.label}</small><strong>${Number.isFinite(wheel.pressure) ? wheel.pressure.toFixed(1) : "–"} <em>PSI</em></strong></span>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  function render() {
    if (!containerEl) return;
    const batteryValue = Number(stateOf(IDS.battery)?.state);
    const batteryLevel = Number.isFinite(batteryValue) ? Math.max(0, Math.min(100, Math.round(batteryValue))) : 0;
    const batteryPct = Number.isFinite(batteryValue) ? String(batteryLevel) : "–";
    const rangeKm = num(IDS.range, 0);
    const lockState = stateOf(IDS.lock);
    const locked = lockState && lockState.state === "locked";
    const charging = stateOf(IDS.charging)?.state === "on";
    const pluggedIn = stateOf(IDS.pluggedIn)?.state === "on";
    const doorsOpen = stateOf(IDS.doors)?.state === "on";
    const windowsOpen = stateOf(IDS.windows)?.state === "on";
    const tracker = stateOf(IDS.locationTracker);
    const locationLabel = tracker ? (tracker.state === "home" ? "Hjemme" : tracker.state) : "–";
    const shift = stateOf(IDS.shiftState)?.state || "P";
    const shiftLabel = { P: "Parkeret", D: "Kører", R: "Bakker", N: "Frigear" }[shift] || shift;
    const chargerPower = num(IDS.chargerPower, 1);
    const finishState = stateOf(IDS.chargingFinishAt);
    const finishLabel = finishState && finishState.state && !Number.isNaN(Date.parse(finishState.state))
      ? new Date(finishState.state).toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" }) : null;

    containerEl.innerHTML = `
      <button type="button" class="beast-page-edit-trigger" id="beastCarLayoutEdit" aria-label="Rediger billayout">⋮</button><div class="beast-car-top">
        <div class="beast-car-battery">
          <div class="beast-car-liquid-battery${charging ? " is-charging" : ""}" style="--battery-level:${batteryLevel}%; --battery-hue:${Math.round(batteryLevel * 1.2)}" role="img" aria-label="Batteri ${batteryPct} procent">
            <i class="beast-car-battery-terminal"></i>
            <div class="beast-car-battery-liquid">
              <i class="beast-car-liquid-wave"></i>
              <i class="beast-car-bubble is-one"></i>
              <i class="beast-car-bubble is-two"></i>
              <i class="beast-car-bubble is-three"></i>
              <i class="beast-car-bubble is-four"></i>
              <i class="beast-car-bubble is-five"></i>
              <i class="beast-car-bubble is-six"></i>
              <i class="beast-car-bubble is-seven"></i>
              <i class="beast-car-bubble is-eight"></i>
              <i class="beast-car-bubble is-nine"></i>
              <i class="beast-car-bubble is-ten"></i>
            </div>
            <span class="beast-car-battery-value"><strong>${batteryPct}</strong><small>%</small></span>
            ${charging ? `<span class="beast-car-battery-charging">${BeastCore.icon("bolt", { size: 18 })} Oplader</span>` : ""}
          </div>
          <span class="beast-car-battery-range">${rangeKm} km rækkevidde</span>
        </div>
      </div>
      <div class="beast-stat-grid">
        ${BeastCore.statTile({ icon: "car", label: "Status", value: escapeHtml(shiftLabel) })}
        ${BeastCore.statTile({ icon: "home", label: "Lokation", value: escapeHtml(locationLabel) })}
        ${BeastCore.statTile({
          icon: "bolt", label: "Opladning",
          value: charging ? `${chargerPower}<small>kW</small>` : (pluggedIn ? "Tilsluttet" : "Ikke tilsluttet"),
          meta: charging && finishLabel ? `Færdig kl. ${finishLabel}` : ""
        })}
        ${BeastCore.statTile({ icon: "chevron-right", label: "Kilometertal", value: `${num(IDS.odometer, 0)}<small>km</small>` })}
        ${BeastCore.statTile({ icon: "thermometer", label: "Temp inde / ude", value: `${num(IDS.insideTemp, 1)}° / ${num(IDS.outsideTemp, 1)}°` })}
        ${BeastCore.statTile({
          icon: locked ? "lock" : "unlock",
          label: "Døre & ruder",
          value: doorsOpen ? "Åbne" : "Lukkede",
          meta: windowsOpen ? "Ruder åbne" : "Ruder lukket",
          id: "beastCarDoorTile",
          extra: `<div class="beast-stat-tile-actions"><button type="button" class="beast-security-action-btn" id="beastCarLockBtn">${locked ? "Lås op" : "Lås"}</button></div>`
        })}
        ${buildTpms()}
      </div>
    `;
    wireCarLayout();

    document.getElementById("beastCarLockBtn")?.addEventListener("click", () => {
      callService("lock", locked ? "unlock" : "lock", IDS.lock).then(() => window.setTimeout(render, 400));
    });
  }

  function wireCarLayout() {
    const layout = BeastConfig.get("pageLayouts.car.carLayout") || {};
    const hidden = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
    containerEl.querySelector(".beast-car-top")?.classList.toggle("is-layout-hidden", hidden.has("battery"));
    containerEl.querySelector(".beast-stat-grid")?.classList.toggle("is-layout-hidden", hidden.has("details"));
    BeastNativePageEditor.mount({ section:"car", label:"Bil", root:()=>containerEl, host:()=>containerEl, trigger:"#beastCarLayoutEdit", cards:()=>[
      { id:"battery", label:"Batteri og rækkevidde", selector:".beast-car-top", enabled:!hidden.has("battery"), desktop:{x:1,y:1,w:4,h:12} },
      { id:"details", label:"Status, opladning og dæktryk", selector:":scope > .beast-stat-grid", enabled:!hidden.has("details"), desktop:{x:5,y:1,w:8,h:12} }
    ] });
  }

  function openCarLayout(layout) {
    const hidden = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
    const items = [["battery", "Batteri og rækkevidde"], ["details", "Status, opladning og dæktryk"]];
    const overlay = document.createElement("div"); overlay.className = "beast-modal-overlay";
    overlay.innerHTML = `<div class="beast-modal beast-car-layout-modal"><div class="beast-modal-header"><h3>Rediger billayout</h3><button type="button" class="beast-modal-close" data-close>×</button></div><div class="beast-modal-body"><div class="beast-car-layout-list">${items.map(([id,label]) => `<label><input type="checkbox" data-car-section="${id}" ${hidden.has(id) ? "" : "checked"}><strong>${label}</strong></label>`).join("")}</div><button type="button" class="beast-btn beast-btn-primary" data-save-car-layout>Gem layout</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) return overlay.remove();
      if (!event.target.closest("[data-save-car-layout]")) return;
      const nextHidden = items.filter(([id]) => !overlay.querySelector(`[data-car-section="${id}"]`).checked).map(([id]) => id);
      BeastConfig.set("pageLayouts.car.carLayout", { ...layout, hidden: nextHidden }); overlay.remove(); render();
    });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function init(root) {
    applyConfig();
    containerEl = root;
    containerEl.classList.add("beast-car-panel");
    containerEl.innerHTML = `<p class="beast-music-empty">Henter…</p>`;

    BeastHaSocket.onStatusChange((status) => { if (status === "connected") render(); });
    const debouncedRender = BeastCore.stableUpdater(containerEl, render, 300);
    Object.values(IDS).forEach((id) => BeastHaSocket.subscribeEntity(id, debouncedRender));
  }

  BeastCore.registerPanel("car", "beastCarZone", init);
})();
