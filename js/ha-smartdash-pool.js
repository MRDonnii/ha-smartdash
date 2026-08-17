(function () {
  let IDS = {};
  let POOL_CAMERA_STREAM = "";
  let POOL_CAMERA = null;

  function applyConfig() {
    const config = BeastConfig.get("panels.pool") || {};
    IDS = {
      temperature: config.waterTemp, pump: config.pumpSwitch, status: config.pumpStatus,
      runtime: config.runtime, person: config.personInWater, automation: config.automationToggle
    };
    POOL_CAMERA = config.cameraEntity ? window.BeastCameras?.resolveCamera?.(config.cameraEntity) : null;
    POOL_CAMERA_STREAM = POOL_CAMERA?.streamName || config.cameraStream || "";
  }

  let containerEl = null;
  let temperatureHistory = [];
  let temperatureHistoryLoading = false;

  function callService(domain, service, entityId) {
    return BeastAuth.haFetch(`/api/services/${domain}/${service}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_id: entityId })
    }).catch((error) => BeastCore.log(`Pool: kommando fejlede (${error.message}).`));
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function renderTemperatureHistory() {
    const host = document.getElementById("beastPoolTemperatureHistory");
    if (!host) return;
    if (!temperatureHistory.length) {
      host.innerHTML = `<p class="beast-music-empty">${temperatureHistoryLoading ? "Henter temperaturhistorik…" : "Ingen temperaturhistorik fundet."}</p>`;
      return;
    }
    const values = temperatureHistory.map((point) => point.value);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const latest = values[values.length - 1];
    host.innerHTML = `
      <div class="beast-pool-chart-head">
        <span><small>Vandtemperatur · 24 timer</small><strong>${latest.toFixed(1)}°</strong></span>
        <span><em>Min ${minimum.toFixed(1)}°</em><em>Maks ${maximum.toFixed(1)}°</em></span>
      </div>
      <div class="beast-pool-chart">${BeastCore.sparkline(values, { width: 760, height: 105, color: "var(--accent-b)" })}</div>
      <div class="beast-pool-chart-axis"><span>24 timer siden</span><span>12 timer</span><span>Nu</span></div>`;
  }

  async function loadTemperatureHistory() {
    if (temperatureHistoryLoading) return;
    temperatureHistoryLoading = true;
    renderTemperatureHistory();
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    try {
      const result = await BeastAuth.haFetch(`/api/history/period/${start}?filter_entity_id=${encodeURIComponent(IDS.temperature)}&minimal_response`);
      const rows = (result && result[0]) || [];
      const points = rows.map((row) => ({
        value: Number(row.state ?? row.s),
        time: new Date(row.last_changed || row.last_updated || row.lc).getTime()
      })).filter((point) => Number.isFinite(point.value) && Number.isFinite(point.time));
      const stride = Math.max(1, Math.ceil(points.length / 96));
      temperatureHistory = points.filter((point, index) => index % stride === 0 || index === points.length - 1);
    } catch (error) {
      temperatureHistory = [];
      BeastCore.log(`Pool: temperaturhistorik kunne ikke hentes (${error.message}).`);
    } finally {
      temperatureHistoryLoading = false;
      renderTemperatureHistory();
    }
  }

  function render() {
    if (!containerEl) return;
    const temp = BeastHaSocket.getState(IDS.temperature);
    const pump = BeastHaSocket.getState(IDS.pump);
    const status = BeastHaSocket.getState(IDS.status);
    const runtime = BeastHaSocket.getState(IDS.runtime);
    const person = BeastHaSocket.getState(IDS.person);
    const automation = BeastHaSocket.getState(IDS.automation);

    const tempNumber = temp && Number.isFinite(Number(temp.state)) ? Number(temp.state) : null;
    const tempLabel = tempNumber !== null ? `${tempNumber.toFixed(1)}°` : "–";
    const runtimeH = runtime && Number.isFinite(Number(runtime.state)) ? Number(runtime.state).toFixed(1) : "–";
    const goalH = Number(status?.attributes?.dagsmaal_timer);
    const pumpOn = pump && pump.state === "on";
    const automationOn = automation && automation.state === "on";
    const personInWater = person && person.state === "on";
    const energyToday = Number(status?.attributes?.forbrug_i_dag_kwh);
    const costToday = Number(status?.attributes?.pris_i_dag_dkk);
    const priceNow = Number(status?.attributes?.elpris_nu);
    const priceAverage = Number(status?.attributes?.elpris_gennemsnit_i_dag);
    const runtimePct = Number.isFinite(Number(runtimeH)) && Number.isFinite(goalH) && goalH > 0 ? Math.min(100, (Number(runtimeH) / goalH) * 100) : 0;
    const comfort = tempNumber === null ? "Ingen temperaturdata" : tempNumber >= 27 ? "Perfekt badevand" : tempNumber >= 24 ? "Behageligt" : tempNumber >= 20 ? "Friskt" : "Køligt";
    const cameraLabel = POOL_CAMERA?.label || "Pool & terrasse";
    const cameraMarkup = POOL_CAMERA
      ? window.BeastCameras.sharedCameraMarkup(POOL_CAMERA, { className: "beast-pool-shared-camera", label: false, motion: false })
      : POOL_CAMERA_STREAM
        ? `<iframe src="./camera-player.html?v=19&base=${encodeURIComponent(BeastConfig.get("panels.cameras.go2rtcBaseUrl") || "")}&transport=webrtc&src=${encodeURIComponent(POOL_CAMERA_STREAM)}" title="Pool livekamera" frameborder="0" allow="autoplay"></iframe>`
        : `<div class="beast-pool-camera-empty">Vælg et kamera under Administration → Pool</div>`;

    if (containerEl.querySelector(".beast-pool-dashboard")) {
      document.getElementById("beastPoolHeaderStatus").textContent = escapeHtml(status?.state || "Ukendt status");
      document.getElementById("beastPoolTemperature").textContent = tempLabel;
      document.getElementById("beastPoolComfort").textContent = comfort;
      document.getElementById("beastPoolPresence").hidden = !personInWater;
      document.getElementById("beastPoolPumpStatus").textContent = pumpOn ? "Kører" : "Slukket";
      document.getElementById("beastPoolAutoStatus").textContent = automationOn ? "Aktiv" : "Fra";
      const pumpBtn = document.getElementById("beastPoolPumpBtn");
      pumpBtn.dataset.on = String(pumpOn);
      pumpBtn.classList.toggle("is-on", pumpOn);
      pumpBtn.querySelector("strong").textContent = pumpOn ? "Stop pumpe" : "Start pumpe";
      const autoBtn = document.getElementById("beastPoolAutoBtn");
      autoBtn.dataset.on = String(automationOn);
      autoBtn.classList.toggle("is-on", automationOn);
      autoBtn.querySelector("strong").textContent = automationOn ? "Slå automatik fra" : "Slå automatik til";
      document.getElementById("beastPoolRuntime").textContent = `${runtimeH} t`;
      document.getElementById("beastPoolRuntimeGoal").textContent = Number.isFinite(goalH) ? `Mål ${goalH} t` : "Intet mål";
      document.getElementById("beastPoolRuntimeBar").style.width = `${runtimePct}%`;
      document.getElementById("beastPoolEnergy").textContent = Number.isFinite(energyToday) ? `${energyToday.toFixed(1)} kWh` : "–";
      document.getElementById("beastPoolCost").textContent = Number.isFinite(costToday) ? `${costToday.toFixed(1)} kr` : "–";
      document.getElementById("beastPoolPrice").textContent = Number.isFinite(priceNow) ? `${priceNow.toFixed(2)} kr` : "–";
      document.getElementById("beastPoolPriceAverage").textContent = Number.isFinite(priceAverage) ? `Snit ${priceAverage.toFixed(2)} kr` : "Intet snit";
      return;
    }

    containerEl.innerHTML = `
      <button type="button" class="beast-page-edit-trigger" id="beastPoolLayoutEdit" aria-label="Rediger poollayout">⋮</button><div class="beast-pool-dashboard">
        <section class="beast-pool-hero">
          <header><span>${BeastCore.icon("droplet", { size: 22 })} Pool</span><em id="beastPoolHeaderStatus">${escapeHtml(status?.state || "Ukendt status")}</em></header>
          <div class="beast-pool-water-orb">
            <div class="beast-pool-water-depth"></div>
            <div class="beast-pool-caustics"></div>
            <div class="beast-pool-water-wave"><i></i></div>
            <div class="beast-pool-ripple is-one"></div>
            <div class="beast-pool-ripple is-two"></div>
            <div class="beast-pool-bubbles">
              <i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>
            </div>
            <div class="beast-pool-glass-shine"></div>
            <div class="beast-pool-temperature"><strong id="beastPoolTemperature">${tempLabel}</strong><span>Vandtemperatur</span></div>
          </div>
          <div class="beast-pool-comfort"><strong id="beastPoolComfort">${comfort}</strong><span>Aktuel badekomfort</span><b id="beastPoolPresence" ${personInWater ? "" : "hidden"}>${BeastCore.icon("users", { size: 14 })} Person i vandet</b></div>
          <div class="beast-pool-touch-controls">
            <button type="button" class="${pumpOn ? "is-on" : ""}" id="beastPoolPumpBtn" data-on="${pumpOn}"><span>${BeastCore.icon("bolt", { size: 24 })}</span><span><small>Pumpe · <i id="beastPoolPumpStatus">${pumpOn ? "Kører" : "Slukket"}</i></small><strong>${pumpOn ? "Stop pumpe" : "Start pumpe"}</strong></span></button>
            <button type="button" class="${automationOn ? "is-on" : ""}" id="beastPoolAutoBtn" data-on="${automationOn}"><span>${BeastCore.icon("check", { size: 24 })}</span><span><small>Automatik · <i id="beastPoolAutoStatus">${automationOn ? "Aktiv" : "Fra"}</i></small><strong>${automationOn ? "Slå automatik fra" : "Slå automatik til"}</strong></span></button>
          </div>
        </section>
        <section class="beast-pool-live">
          <header><div><small>Livekamera</small><strong>${escapeHtml(cameraLabel)}</strong></div><span><i></i> LIVE</span></header>
          <div class="beast-pool-live-frame">${cameraMarkup}</div>
          <footer><span>${BeastCore.icon("camera", { size: 16 })} ${escapeHtml(cameraLabel)}</span><em>Livevisning</em></footer>
        </section>
        <section class="beast-pool-insights">
          <div class="beast-pool-temperature-chart-card" id="beastPoolTemperatureHistory"><p class="beast-music-empty">Henter temperaturhistorik…</p></div>
          <div class="beast-pool-runtime-card"><span class="beast-pool-insight-icon">${BeastCore.icon("settings", { size: 21 })}</span><span><small>Køretid i dag</small><strong id="beastPoolRuntime">${runtimeH} t</strong><em id="beastPoolRuntimeGoal">${Number.isFinite(goalH) ? `Mål ${goalH} t` : "Intet mål"}</em></span><div><i id="beastPoolRuntimeBar" style="width:${runtimePct}%"></i></div></div>
          <div><span class="beast-pool-insight-icon">${BeastCore.icon("bolt", { size: 21 })}</span><span><small>Forbrug i dag</small><strong id="beastPoolEnergy">${Number.isFinite(energyToday) ? `${energyToday.toFixed(1)} kWh` : "–"}</strong><em id="beastPoolCost">${Number.isFinite(costToday) ? `${costToday.toFixed(1)} kr` : "–"}</em></span></div>
          <div><span class="beast-pool-insight-icon">${BeastCore.icon("bolt", { size: 21 })}</span><span><small>Elpris nu</small><strong id="beastPoolPrice">${Number.isFinite(priceNow) ? `${priceNow.toFixed(2)} kr` : "–"}</strong><em id="beastPoolPriceAverage">${Number.isFinite(priceAverage) ? `Snit ${priceAverage.toFixed(2)} kr` : "Intet snit"}</em></span></div>
        </section>
      </div>
    `;
    wirePoolLayout();
    window.BeastCameras?.wireSharedCameras?.(containerEl);
    renderTemperatureHistory();

    document.getElementById("beastPoolPumpBtn")?.addEventListener("click", () => {
      const button = document.getElementById("beastPoolPumpBtn");
      callService("switch", button.dataset.on === "true" ? "turn_off" : "turn_on", IDS.pump);
    });
    document.getElementById("beastPoolAutoBtn")?.addEventListener("click", () => {
      const button = document.getElementById("beastPoolAutoBtn");
      callService("input_boolean", button.dataset.on === "true" ? "turn_off" : "turn_on", IDS.automation);
    });
  }

  function wirePoolLayout() {
    const layout = BeastConfig.get("pageLayouts.pool.poolLayout") || {};
    const hidden = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
    const selectors = { hero: ".beast-pool-hero", camera: ".beast-pool-live", insights: ".beast-pool-insights" };
    Object.entries(selectors).forEach(([id, selector]) => containerEl.querySelectorAll(selector).forEach((el) => el.classList.toggle("is-layout-hidden", hidden.has(id))));
    BeastNativePageEditor.mount({ section: "pool", label: "Pool", root: () => containerEl, host: () => containerEl.querySelector(".beast-pool-dashboard"), trigger: "#beastPoolLayoutEdit", cards: () => [
      { id:"hero", label:"Poolstatus og styring", selector:".beast-pool-hero", titleSelector:":scope > header > span", enabled:!hidden.has("hero"), desktop:{x:1,y:1,w:4,h:9} },
      { id:"camera", label:"Livekamera", selector:".beast-pool-live", titleSelector:":scope > header strong", enabled:!hidden.has("camera"), desktop:{x:5,y:1,w:8,h:9} },
      { id:"insights", label:"Temperatur og driftsindsigt", selector:".beast-pool-insights", enabled:!hidden.has("insights"), desktop:{x:1,y:10,w:12,h:3} }
    ] });
  }

  function openPoolLayout(layout) {
    const hidden = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
    const items = [["hero", "Poolstatus og styring"], ["camera", "Livekamera"], ["insights", "Temperatur og driftsindsigt"]];
    const overlay = document.createElement("div"); overlay.className = "beast-modal-overlay";
    overlay.innerHTML = `<div class="beast-modal beast-pool-layout-modal"><div class="beast-modal-header"><h3>Rediger poollayout</h3><button type="button" class="beast-modal-close" data-close>×</button></div><div class="beast-modal-body"><div class="beast-pool-layout-list">${items.map(([id,label]) => `<label><input type="checkbox" data-pool-section="${id}" ${hidden.has(id) ? "" : "checked"}><strong>${label}</strong></label>`).join("")}</div><button type="button" class="beast-btn beast-btn-primary" data-save-pool-layout>Gem layout</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) return overlay.remove();
      if (!event.target.closest("[data-save-pool-layout]")) return;
      const nextHidden = items.filter(([id]) => !overlay.querySelector(`[data-pool-section="${id}"]`).checked).map(([id]) => id);
      BeastConfig.set("pageLayouts.pool.poolLayout", { ...layout, hidden: nextHidden }); overlay.remove(); render();
    });
  }

  function init(root) {
    applyConfig();
    containerEl = root;
    containerEl.classList.add("beast-pool-panel");
    containerEl.innerHTML = `<p class="beast-music-empty">Henter…</p>`;

    BeastHaSocket.onStatusChange((status) => { if (status === "connected") render(); });
    const debouncedRender = BeastCore.stableUpdater(containerEl, render, 300);
    Object.values(IDS).forEach((id) => BeastHaSocket.subscribeEntity(id, debouncedRender));
    loadTemperatureHistory();

  }

  BeastCore.registerPanel("pool", "beastPoolZone", init);
})();
