(function () {
  let IDS = {};
  let PRINTER_LIVE_STREAM = "";
  const BAMBU_SNAPSHOT_REFRESH_MS = 6000;

  let containerEl = null;
  let bambuSnapshotTimerId = null;
  let stopConfirmUntil = 0;
  let lastStructureSignature = "";

  function applyConfig() {
    const config = BeastConfig.get("panels.printer") || {};
    const trays = Array.isArray(config.traySensors) ? config.traySensors : [];
    IDS = {
      status: config.statusSensor, stage: config.stageSensor, progress: config.progressSensor, remaining: config.remainingSensor,
      nozzleTemp: config.nozzleTemp, nozzleTarget: config.nozzleTarget, bedTemp: config.bedTemp, bedTarget: config.bedTarget,
      currentLayer: config.currentLayer, totalLayers: config.totalLayers, taskName: config.taskName, camera: config.cameraImage,
      pauseBtn: config.pauseButton, resumeBtn: config.resumeButton, stopBtn: config.stopButton, activeTray: config.activeTray,
      tray1: trays[0], tray2: trays[1], tray3: trays[2], tray4: trays[3], amsHumidity: config.amsHumidity,
      totalUsage: config.totalUsage
    };
    PRINTER_LIVE_STREAM = config.liveStream || "";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function num(id) {
    const s = BeastHaSocket.getState(id);
    return s && Number.isFinite(Number(s.state)) ? Number(s.state) : null;
  }

  function sensorText(id, fallback = "–", decimals = null) {
    const state = BeastHaSocket.getState(id);
    if (!state || ["unknown", "unavailable", "none", ""].includes(String(state.state).toLowerCase())) return fallback;
    const number = Number(state.state);
    const value = Number.isFinite(number) && decimals !== null ? number.toFixed(decimals) : state.state;
    const unit = state.attributes?.unit_of_measurement || "";
    return `${value}${unit ? ` ${unit}` : ""}`;
  }

  function formatRemainingTime() {
    const state = BeastHaSocket.getState(IDS.remaining);
    const value = Number(state?.state);
    if (!Number.isFinite(value)) return "–";
    const unit = String(state?.attributes?.unit_of_measurement || "").toLowerCase();
    let totalMinutes = value;
    if (["h", "hr", "hour", "hours", "t", "timer"].includes(unit)) totalMinutes = value * 60;
    if (["s", "sec", "second", "seconds"].includes(unit)) totalMinutes = value / 60;
    totalMinutes = Math.max(0, Math.round(totalMinutes));
    if (totalMinutes < 60) return `${totalMinutes} min`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes ? `${hours} t ${minutes} min` : `${hours} t`;
  }

  function usefulTaskLabel(taskState) {
    const candidates = [];
    const addState = (state) => {
      if (!state) return;
      const attrs = state.attributes || {};
      ["task_name", "subtask_name", "title", "file_name", "filename", "gcode_file", "name"].forEach((key) => candidates.push(attrs[key]));
      candidates.push(state.state);
    };
    addState(taskState);
    Array.from(BeastHaSocket.getAllStates().values())
      .filter((state) => isPrinterEntity(state) && /task|subtask|gcode|file.*name/i.test(state.entity_id))
      .forEach(addState);
    const label = candidates.find((value) => {
      const text = String(value || "").trim();
      return text.length > 2 && !/^\d+([.,]\d+)?$/.test(text) && !["unknown", "unavailable", "none", "printing", "idle"].includes(text.toLowerCase());
    });
    return label ? String(label).replace(/\.(3mf|gcode)$/i, "") : "Aktivt printjob";
  }

  function stageLabel(value) {
    const raw = String(value || "").trim();
    const translations = {
      printing: "Udskriver",
      running: "Kører",
      idle: "Klar",
      finish: "Færdig",
      finished: "Færdig",
      paused: "På pause",
      prepare: "Forbereder",
      preparing: "Forbereder",
      calibrating: "Kalibrerer",
      heating: "Varmer op"
    };
    return translations[raw.toLowerCase()] || raw || "Ukendt";
  }

  function pressButton(entityId) {
    return BeastAuth.haFetch(`/api/services/button/press`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_id: entityId })
    }).catch((error) => BeastCore.log(`Printer: kommando fejlede (${error.message}).`));
  }

  function cleanState(entity, fallback = "–") {
    const value = entity?.state;
    return !value || ["unknown", "unavailable", "none"].includes(value) ? fallback : value;
  }

  function isPrinterEntity(state) {
    const text = `${state?.entity_id || ""} ${state?.attributes?.friendly_name || ""}`.toLowerCase();
    return text.includes("bambu") || text.includes("p1s") || text.includes("3d printer");
  }

  function findPrinterLight() {
    return Array.from(BeastHaSocket.getAllStates().values()).find((state) => {
      if (!state?.entity_id?.startsWith("light.") || !isPrinterEntity(state)) return false;
      return /chamber|light|lys|printer/i.test(`${state.entity_id} ${state.attributes?.friendly_name || ""}`);
    }) || null;
  }

  function findPrintImages(taskState) {
    const images = [];
    const seen = new Set();
    const add = (label, path) => {
      if (!path || seen.has(path)) return;
      seen.add(path);
      images.push({ label, path });
    };
    const attrs = taskState?.attributes || {};
    ["entity_picture", "image_url", "thumbnail", "thumbnail_url", "cover", "cover_url"].forEach((key) => add("Aktuelt emne", attrs[key]));
    Array.from(BeastHaSocket.getAllStates().values())
      .filter((state) => state?.entity_id?.startsWith("image.") && state.entity_id !== IDS.camera && isPrinterEntity(state))
      .filter((state) => /cover|model|task|print|thumbnail|preview|emne/i.test(`${state.entity_id} ${state.attributes?.friendly_name || ""}`))
      .slice(0, 3)
      .forEach((state) => add(state.attributes?.friendly_name || "Printemne", `/api/image_proxy/${state.entity_id}`));
    return images.slice(0, 3);
  }

  function toggleLight(entityId) {
    return BeastAuth.haFetch("/api/services/light/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_id: entityId })
    }).catch((error) => BeastCore.log(`Printerlys: kommando fejlede (${error.message}).`));
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function updateLiveValues(data) {
    const stateEl = document.getElementById("beastPrinterState");
    if (stateEl) {
      stateEl.textContent = data.stateLabel;
      stateEl.classList.toggle("is-printing", data.printing);
    }
    setText("beastPrinterTask", data.taskLabel);
    setText("beastPrinterStage", data.stageLabel);
    setText("beastPrinterPercent", String(Math.round(data.progress)));
    const progressBar = document.getElementById("beastPrinterProgressBar");
    if (progressBar) progressBar.style.width = `${Math.max(0, Math.min(100, data.progress))}%`;
    setText("beastPrinterRemaining", data.remainingText);
    setText("beastPrinterLayer", `${data.layer ?? "–"} / ${data.totalLayers ?? "–"}`);
    setText("beastPrinterNozzle", `${data.nozzleText} / ${data.nozzleTargetText}`);
    setText("beastPrinterBed", `${data.bedText} / ${data.bedTargetText}`);
    setText("beastPrinterAmsMeta", `${data.amsHumidityText} fugt · ${data.totalUsageText} drift`);
    const lightButton = document.getElementById("beastPrinterLight");
    if (lightButton && data.printerLight) {
      lightButton.classList.toggle("is-on", data.printerLight.state === "on");
      const status = lightButton.querySelector("strong");
      if (status) status.textContent = data.printerLight.state === "on" ? "Tændt" : "Slukket";
    }
  }

  function trayDetails(id, index, activeTray) {
    const state = BeastHaSocket.getState(id);
    const raw = cleanState(state, "Tom");
    const name = state?.attributes?.name || state?.attributes?.type || raw;
    const color = state?.attributes?.color || state?.attributes?.rgba || "";
    const safeColor = /^#?[0-9a-f]{6,8}$/i.test(String(color)) ? `#${String(color).replace("#", "").slice(0, 6)}` : "";
    const active = String(activeTray).includes(String(index)) || String(activeTray).toLowerCase() === `tray ${index}`;
    return `
      <div class="beast-printer-tray${active ? " is-active" : ""}">
        <span class="beast-printer-spool" style="${safeColor ? `--spool-color:${safeColor}` : ""}"></span>
        <span><small>Plads ${index}${active ? " · aktiv" : ""}</small><strong>${escapeHtml(name)}</strong></span>
      </div>
    `;
  }

  function render() {
    if (!containerEl) return;
    const status = BeastHaSocket.getState(IDS.status);
    const stage = BeastHaSocket.getState(IDS.stage);
    const progress = num(IDS.progress) ?? 0;
    const remaining = num(IDS.remaining);
    const statusText = cleanState(status, "Ukendt");
    const statusKey = statusText.toLowerCase();
    const printing = !["idle", "finish", "finished", "offline", "ukendt"].includes(statusKey);
    const taskName = BeastHaSocket.getState(IDS.taskName);
    const taskLabel = usefulTaskLabel(taskName);
    const printerLight = findPrinterLight();
    const printImages = findPrintImages(taskName);
    const layer = num(IDS.currentLayer);
    const totalLayers = num(IDS.totalLayers);
    const nozzle = num(IDS.nozzleTemp);
    const nozzleTarget = num(IDS.nozzleTarget);
    const bed = num(IDS.bedTemp);
    const bedTarget = num(IDS.bedTarget);
    const activeTray = cleanState(BeastHaSocket.getState(IDS.activeTray), "");
    const stateLabel = printing ? "Printer nu" : statusKey === "finish" || statusKey === "finished" ? "Færdig" : "Klar";
    const liveData = {
      stateLabel,
      printing,
      taskLabel: printing ? taskLabel : "Ingen aktiv opgave",
      stageLabel: stageLabel(cleanState(stage, statusText)),
      progress,
      remaining,
      remainingText: formatRemainingTime(),
      layer,
      totalLayers,
      nozzle,
      nozzleTarget,
      nozzleText: sensorText(IDS.nozzleTemp, "–", 0),
      nozzleTargetText: sensorText(IDS.nozzleTarget, "–", 0),
      bed,
      bedTarget,
      bedText: sensorText(IDS.bedTemp, "–", 0),
      bedTargetText: sensorText(IDS.bedTarget, "–", 0),
      amsHumidity: num(IDS.amsHumidity),
      totalUsage: num(IDS.totalUsage),
      amsHumidityText: sensorText(IDS.amsHumidity, "–", 0),
      totalUsageText: sensorText(IDS.totalUsage, "–", 0).replace(/\bh\b/i, "t"),
      printerLight
    };
    const structureSignature = JSON.stringify([
      printing,
      liveData.taskLabel,
      printerLight?.entity_id || "",
      printImages.map((image) => image.path),
      activeTray,
      ...[IDS.tray1, IDS.tray2, IDS.tray3, IDS.tray4].map((id) => {
        const tray = BeastHaSocket.getState(id);
        return [tray?.state, tray?.attributes?.name, tray?.attributes?.type, tray?.attributes?.color, tray?.attributes?.rgba];
      })
    ]);
    if (containerEl.querySelector(".beast-printer-dashboard") && structureSignature === lastStructureSignature) {
      updateLiveValues(liveData);
      return;
    }
    lastStructureSignature = structureSignature;

    containerEl.innerHTML = `
      <div class="beast-printer-dashboard">
        <section class="beast-printer-visual">
          <div class="beast-printer-cam beast-printer-cam--main">
            <iframe class="beast-printer-live-frame" id="beastPrinterLiveFrame" src="./camera-player.html?v=7&src=${encodeURIComponent(PRINTER_LIVE_STREAM)}" title="3D-printer livekamera" frameborder="0" allow="autoplay"></iframe>
            <span class="beast-printer-cam-label">3D Printer · Livekamera</span>
            <span class="beast-printer-live"><i></i> Live</span>
          </div>
          <div class="beast-printer-cam beast-printer-cam--secondary">
            <img class="beast-printer-cam-img" id="beastPrinterCamImg" alt="">
            <span class="beast-printer-cam-label">Bambu Lab P1S · Statuskamera</span>
          </div>
        </section>
        <section class="beast-printer-control">
          <div class="beast-printer-status-head">
            <div>
              <span class="beast-printer-state${printing ? " is-printing" : ""}" id="beastPrinterState">${stateLabel}</span>
              <h2 id="beastPrinterTask">${escapeHtml(liveData.taskLabel)}</h2>
              <p id="beastPrinterStage">${escapeHtml(liveData.stageLabel)}</p>
            </div>
            <strong class="beast-printer-percent"><span id="beastPrinterPercent">${Math.round(progress)}</span><small>%</small></strong>
          </div>
          <div class="beast-printer-quick-controls">
            <button type="button" class="beast-printer-light${printerLight?.state === "on" ? " is-on" : ""}" id="beastPrinterLight" ${printerLight ? "" : "disabled"}>
              <span class="beast-printer-light-icon">${BeastCore.icon("sun", { size: 23 })}</span>
              <span><small>Lys i printeren</small><strong>${printerLight ? (printerLight.state === "on" ? "Tændt" : "Slukket") : "Ikke fundet"}</strong></span>
              <i aria-hidden="true"></i>
            </button>
          </div>
          <div class="beast-printer-progress"><i id="beastPrinterProgressBar" style="width:${Math.max(0, Math.min(100, progress))}%"></i></div>
          ${printImages.length ? `
            <div class="beast-printer-model-section">
              <div class="beast-printer-model-head"><span><small>Printjob</small><strong>Billeder af emnet</strong></span><em>${printImages.length} ${printImages.length === 1 ? "billede" : "billeder"}</em></div>
              <div class="beast-printer-model-gallery">
                ${printImages.map((image, index) => `<button type="button" class="beast-printer-model-image" data-print-image="${index}"><img alt="${escapeHtml(image.label)}"><span>${escapeHtml(image.label)}</span></button>`).join("")}
              </div>
            </div>
          ` : ""}
          <div class="beast-printer-metrics">
            <div><small>Resterende</small><strong id="beastPrinterRemaining">${liveData.remainingText}</strong></div>
            <div><small>Lag</small><strong id="beastPrinterLayer">${layer ?? "–"} / ${totalLayers ?? "–"}</strong></div>
            <div><small>Dyse</small><strong id="beastPrinterNozzle">${liveData.nozzleText} / ${liveData.nozzleTargetText}</strong></div>
            <div><small>Byggeplade</small><strong id="beastPrinterBed">${liveData.bedText} / ${liveData.bedTargetText}</strong></div>
          </div>
          ${printing ? `
            <div class="beast-printer-actions">
              <button type="button" class="beast-security-action-btn" id="beastPrinterPause">Ⅱ&nbsp; Pause</button>
              <button type="button" class="beast-security-action-btn" id="beastPrinterResume">▶&nbsp; Fortsæt</button>
              <button type="button" class="beast-security-action-btn is-danger" id="beastPrinterStop">■&nbsp; Stop print</button>
            </div>
          ` : ""}
          <div class="beast-printer-ams-head">
            <div><small>AMS</small><strong>Filament</strong></div>
            <span id="beastPrinterAmsMeta">${liveData.amsHumidityText} fugt · ${liveData.totalUsageText} drift</span>
          </div>
          <div class="beast-printer-trays">
            ${[IDS.tray1, IDS.tray2, IDS.tray3, IDS.tray4].map((id, index) => trayDetails(id, index + 1, activeTray)).join("")}
          </div>
        </section>
      </div>
    `;

    refreshBambuSnapshot(true);
    printImages.forEach((image, index) => {
      const img = containerEl.querySelector(`[data-print-image="${index}"] img`);
      if (!img) return;
      if (/^https?:\/\//i.test(image.path)) img.src = image.path;
      else BeastAuth.setAuthedImageSrc(img, image.path);
    });
    document.getElementById("beastPrinterLight")?.addEventListener("click", () => {
      if (printerLight) toggleLight(printerLight.entity_id);
    });
    document.getElementById("beastPrinterPause")?.addEventListener("click", () => pressButton(IDS.pauseBtn));
    document.getElementById("beastPrinterResume")?.addEventListener("click", () => pressButton(IDS.resumeBtn));
    document.getElementById("beastPrinterStop")?.addEventListener("click", (event) => {
      if (Date.now() > stopConfirmUntil) {
        stopConfirmUntil = Date.now() + 4000;
        event.currentTarget.classList.add("is-confirming");
        event.currentTarget.textContent = "Tryk igen for at stoppe";
        return;
      }
      stopConfirmUntil = 0;
      pressButton(IDS.stopBtn);
    });
  }

  async function refreshBambuSnapshot(force = false) {
    const img = document.getElementById("beastPrinterCamImg");
    if (!img || (!force && !BeastCore.isPanelVisible(containerEl))) return;
    try {
      const blob = await BeastAuth.haFetchBlob(`/api/image_proxy/${IDS.camera}`);
      const objectUrl = URL.createObjectURL(blob);
      const preload = new Image();
      preload.src = objectUrl;
      if (preload.decode) await preload.decode();
      if (!img.isConnected) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      if (img.dataset.objectUrl) URL.revokeObjectURL(img.dataset.objectUrl);
      img.dataset.objectUrl = objectUrl;
      img.src = objectUrl;
    } catch (error) {
      BeastCore.log(`Bambu-kamera: billede kunne ikke opdateres (${error.message}).`);
    }
  }

  function init(root) {
    applyConfig();
    containerEl = root;
    containerEl.classList.add("beast-printer-panel");
    containerEl.innerHTML = `<p class="beast-music-empty">Henter…</p>`;

    BeastHaSocket.onStatusChange((status) => { if (status === "connected") render(); });
    const debouncedRender = BeastCore.stableUpdater(containerEl, render, 500);
    [IDS.status, IDS.stage, IDS.progress, IDS.remaining, IDS.nozzleTemp, IDS.nozzleTarget, IDS.bedTemp, IDS.bedTarget,
      IDS.currentLayer, IDS.totalLayers, IDS.taskName, IDS.activeTray, IDS.tray1, IDS.tray2, IDS.tray3, IDS.tray4,
      IDS.amsHumidity, IDS.totalUsage].forEach((id) => {
      BeastHaSocket.subscribeEntity(id, debouncedRender);
    });
    BeastHaSocket.subscribeDomain("light", (entityId, state) => {
      if (isPrinterEntity(state)) debouncedRender();
    });
    BeastHaSocket.subscribeDomain("image", (entityId, state) => {
      if (isPrinterEntity(state)) debouncedRender();
    });

    window.clearInterval(bambuSnapshotTimerId);
    bambuSnapshotTimerId = window.setInterval(refreshBambuSnapshot, BAMBU_SNAPSHOT_REFRESH_MS);
    document.addEventListener("beast:sectionchange", (event) => {
      if (event.detail?.section === "printer") refreshBambuSnapshot(true);
    });
  }

  BeastCore.registerPanel("printer", "beastPrinterZone", init);
})();
