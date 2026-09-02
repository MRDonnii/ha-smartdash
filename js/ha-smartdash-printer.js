(function () {
  let IDS = {};
  let PRINTER_LIVE_STREAM = "";
  const BAMBU_SNAPSHOT_REFRESH_MS = 6000;

  let containerEl = null;
  let gridEl = null;
  let pageEditor = null;
  let bambuSnapshotTimerId = null;
  let stopConfirmUntil = 0;
  let lastStructureSignature = "";

  function defaultCards() {
    const config = BeastConfig.get("panels.printer") || {};
    return [
      { id: "printer_cameras", type: "cameras", entity: config.liveCamera || null, secondaryEntity: config.cameraImage || null, desktop: { w: 5, h: 2 }, tablet: { w: 2, h: 2 }, portrait: { h: 2 } },
      { id: "printer_control", type: "control", display: "full", desktop: { w: 7, h: 2 }, tablet: { w: 2, h: 2 }, portrait: { h: 2 } }
    ];
  }

  function savedCards() {
    const cards = BeastConfig.get("pageLayouts.printer.cards");
    if (BeastConfig.get("pageLayouts.printer.cardsConfigured") === true && Array.isArray(cards)) return cards;
    return Array.isArray(cards) && cards.length ? cards : defaultCards();
  }

  function cardSize(card) {
    // --desktop-w/-h are emitted pre-doubled to match the freeform grid's
    // 24-track desktop resolution -- see ha-smartdash-layout.css.
    return `data-builder-card="${escapeHtml(card.id)}" style="--desktop-w:${(Number(card.desktop?.w) || 4) * 2};--desktop-h:${(Number(card.desktop?.h) || 1) * 2};--tablet-w:${Number(card.tablet?.w) || 1};--tablet-h:${Number(card.tablet?.h) || 1};--portrait-h:${Number(card.portrait?.h) || 1};"`;
  }

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
    // liveCamera (a HA camera.* entity) is resolved through the same
    // go2rtc stream lookup the main Cameras panel uses -- preferred over
    // liveStream (a raw go2rtc stream name typed by hand) since it can be
    // picked from the entity list instead of needing the exact go2rtc
    // stream name memorized.
    const resolvedLiveCamera = config.liveCamera ? window.BeastCameras?.resolveCamera?.(config.liveCamera) : null;
    PRINTER_LIVE_STREAM = resolvedLiveCamera?.streamName || config.liveStream || "";
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
    setText("beastPrinterProgressStage", data.stageLabel);
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
        <span class="beast-printer-spool" style="${safeColor ? `--spool-color:${safeColor}` : ""}"><i></i></span>
        <span><small>Plads ${index}</small><strong>${escapeHtml(name)}</strong></span>
        ${active ? `<b>Aktiv</b>` : ""}
      </div>
    `;
  }

  function printerData() {
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
    return {
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
      printerLight, printImages, activeTray
    };
  }

  function printerCardMarkup(card) {
    if (BeastStandardCards.isStandardType(card.type)) return BeastStandardCards.renderMarkup(card);
    const data = printerData();
    if (card.type === "cameras") {
      const cameraDisplay = card.cameraDisplay || BeastConfig.get("panels.printer.cameraDisplay") || "both";
      const liveEntity = card.entity || BeastConfig.get("panels.printer.liveCamera");
      const secondary = card.secondaryEntity || IDS.camera;
      // The display preference may choose between configured sources, but it
      // must never create a placeholder slot for a source that was not set.
      const showLiveCamera = cameraDisplay !== "printer" && Boolean(liveEntity);
      const showPrinterCamera = cameraDisplay !== "live" && Boolean(secondary);
      if (!showLiveCamera && !showPrinterCamera) return "";
      const resolved = liveEntity ? window.BeastCameras?.resolveCamera?.(liveEntity) : null;
      const fallbackState = liveEntity ? BeastHaSocket.getState(liveEntity) : null;
      const liveCamera = resolved || (liveEntity ? { slug: liveEntity.replace(/^camera\./, ""), entityId: liveEntity, label: fallbackState?.attributes?.friendly_name || "3D Printer", entityPicture: fallbackState?.attributes?.entity_picture || null } : null);
      return `<section class="beast-panel beast-ov-card beast-page-builder-card beast-printer-builder-card" ${cardSize(card)} data-printer-card="cameras" data-camera-display="${escapeHtml(cameraDisplay)}" data-secondary-camera="${escapeHtml(showPrinterCamera ? (secondary || "") : "")}">
        <section class="beast-printer-visual${showLiveCamera && showPrinterCamera ? "" : " is-single"}">
          ${showLiveCamera ? `<div class="beast-printer-cam beast-printer-cam--main">
            ${BeastCameras.sharedCameraMarkup(liveCamera, { className: "beast-printer-live-frame", label: false, motion: false })}
            <span class="beast-printer-cam-label">3D Printer · Livekamera</span>
            <span class="beast-printer-live"><i></i> Live</span>
          </div>` : ""}
          ${showPrinterCamera ? `<div class="beast-printer-cam beast-printer-cam--secondary">
            <img class="beast-printer-cam-img" id="beastPrinterCamImg" alt="">
            <span class="beast-printer-cam-label">Printerkamera</span>
          </div>` : ""}
        </section></section>`;
    }
    return `<section class="beast-panel beast-ov-card beast-page-builder-card beast-printer-builder-card" ${cardSize(card)} data-printer-card="control" data-card-display="${escapeHtml(card.display || "full")}">
        <section class="beast-printer-control">
          <div class="beast-printer-status-head">
            <div>
              <span class="beast-printer-state${data.printing ? " is-printing" : ""}" id="beastPrinterState">${data.stateLabel}</span>
              <h2 id="beastPrinterTask">${escapeHtml(data.taskLabel)}</h2>
              <p id="beastPrinterStage">${escapeHtml(data.stageLabel)}</p>
            </div>
          </div>
          <div class="beast-printer-progress-panel${data.printImages.length && card.showImages !== false ? " has-model" : ""}">
            ${data.printImages.length && card.showImages !== false ? `<button type="button" class="beast-printer-progress-model" data-print-image="0"><img alt="${escapeHtml(data.printImages[0].label)}"><span>${escapeHtml(data.printImages[0].label)}</span></button>` : ""}
            <div class="beast-printer-progress-content">
              <header><span><small>Printets fremdrift</small><strong id="beastPrinterProgressStage">${escapeHtml(data.stageLabel)}</strong></span><b><span id="beastPrinterPercent">${Math.round(data.progress)}</span><small>%</small></b></header>
              <div class="beast-printer-progress"><i id="beastPrinterProgressBar" style="width:${Math.max(0, Math.min(100, data.progress))}%"></i></div>
              <footer>
                <span>${BeastCore.icon("clock", { size:18 })}<small>Resterende</small><strong id="beastPrinterRemaining">${data.remainingText}</strong></span>
                <span>${BeastCore.icon("grid", { size:18 })}<small>Aktuelt lag</small><strong id="beastPrinterLayer">${data.layer ?? "–"} / ${data.totalLayers ?? "–"}</strong></span>
              </footer>
            </div>
          </div>
          <div class="beast-printer-quick-controls">
            <button type="button" class="beast-printer-light${data.printerLight?.state === "on" ? " is-on" : ""}" id="beastPrinterLight" ${data.printerLight ? "" : "disabled"}>
              <span class="beast-printer-light-icon">${BeastCore.icon("sun", { size: 23 })}</span>
              <span><small>Lys i printeren</small><strong>${data.printerLight ? (data.printerLight.state === "on" ? "Tændt" : "Slukket") : "Ikke fundet"}</strong></span>
              <i aria-hidden="true"></i>
            </button>
          </div>
          <div class="beast-printer-metrics">
            <div class="is-nozzle"><span>${BeastCore.icon("thermometer", { size:22 })}</span><div><small>Dysetemperatur · nu / mål</small><strong id="beastPrinterNozzle">${data.nozzleText} / ${data.nozzleTargetText}</strong></div></div>
            <div class="is-bed"><span>${BeastCore.icon("thermometer", { size:22 })}</span><div><small>Byggeplade · nu / mål</small><strong id="beastPrinterBed">${data.bedText} / ${data.bedTargetText}</strong></div></div>
          </div>
          ${data.printing ? `
            <div class="beast-printer-actions">
              <button type="button" class="beast-security-action-btn" id="beastPrinterPause">Ⅱ&nbsp; Pause</button>
              <button type="button" class="beast-security-action-btn" id="beastPrinterResume">▶&nbsp; Fortsæt</button>
              <button type="button" class="beast-security-action-btn is-danger" id="beastPrinterStop">■&nbsp; Stop print</button>
            </div>
          ` : ""}
          <div class="beast-printer-ams-section">
            <div class="beast-printer-ams-head">
              <div><small>AMS</small><strong>Filament</strong></div>
              <span id="beastPrinterAmsMeta">${data.amsHumidityText} fugt · ${data.totalUsageText} drift</span>
            </div>
            <div class="beast-printer-trays">
              ${[IDS.tray1, IDS.tray2, IDS.tray3, IDS.tray4].map((id, index) => trayDetails(id, index + 1, data.activeTray)).join("")}
            </div>
          </div>
        </section></section>`;
  }

  function wireCards() {
    if (!gridEl) return;
    const data = printerData();
    BeastStandardCards.wire(gridEl);
    BeastCameras?.wireSharedCameras?.(gridEl, render);
    refreshBambuSnapshot(true);
    data.printImages.forEach((image, index) => {
      const img = containerEl.querySelector(`[data-print-image="${index}"] img`);
      if (!img) return;
      if (/^https?:\/\//i.test(image.path)) img.src = image.path;
      else BeastAuth.setAuthedImageSrc(img, image.path);
    });
    document.getElementById("beastPrinterLight")?.addEventListener("click", () => {
      if (data.printerLight) toggleLight(data.printerLight.entity_id);
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

  function render() {
    if (!gridEl || pageEditor?.isEditing()) return;
    const cards = savedCards();
    const data = printerData();
    const structureSignature = JSON.stringify([
      cards,
      data.printing,
      data.taskLabel,
      data.printerLight?.entity_id || "",
      data.printImages.map((image) => image.path),
      data.activeTray,
      ...[IDS.tray1, IDS.tray2, IDS.tray3, IDS.tray4].map((id) => {
        const tray = BeastHaSocket.getState(id);
        return [tray?.state, tray?.attributes?.name, tray?.attributes?.type, tray?.attributes?.color, tray?.attributes?.rgba];
      })
    ]);
    if (gridEl.querySelector("[data-printer-card]") && structureSignature === lastStructureSignature) {
      updateLiveValues(data);
      return;
    }
    lastStructureSignature = structureSignature;
    const renderedCards = cards.map((card) => ({ card, markup: printerCardMarkup(card) })).filter((item) => item.markup);
    const hasCameraCard = renderedCards.some((item) => item.card.type === "cameras");
    gridEl.innerHTML = `${renderedCards.map((item) => {
      if (hasCameraCard || item.card.type !== "control") return item.markup;
      return printerCardMarkup({ ...item.card, desktop:{ ...(item.card.desktop || {}), w:12 }, tablet:{ ...(item.card.tablet || {}), w:2 } });
    }).join("")}<div data-card-editor-anchor></div>`;
    wireCards();
  }

  async function refreshBambuSnapshot(force = false) {
    const liveImg = containerEl?.querySelector(".beast-printer-cam--main .beast-shared-camera-snapshot[data-camera-picture]");
    if (liveImg && (force || BeastCore.isPanelVisible(containerEl))) BeastAuth.setAuthedImageSrc(liveImg, liveImg.dataset.cameraPicture);
    const img = document.getElementById("beastPrinterCamImg");
    if (!img || (!force && !BeastCore.isPanelVisible(containerEl))) return;
    const selectedCamera = img.closest("[data-secondary-camera]")?.dataset.secondaryCamera || IDS.camera;
    if (!selectedCamera) return;
    try {
      const selectedState = BeastHaSocket.getState(selectedCamera);
      const picturePath = selectedCamera.startsWith("camera.")
        ? selectedState?.attributes?.entity_picture
        : `/api/image_proxy/${selectedCamera}`;
      if (!picturePath) return;
      const blob = await BeastAuth.haFetchBlob(picturePath);
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

  function cameraEntities(includeImages = false) {
    return Array.from(BeastHaSocket.getAllStates().values())
      .filter((state) => state?.entity_id?.startsWith("camera.") || (includeImages && state?.entity_id?.startsWith("image.")))
      .map((state) => ({ id: state.entity_id, name: state.attributes?.friendly_name || state.entity_id }))
      .sort((a, b) => a.name.localeCompare(b.name, "da"));
  }

  function optionsMarkup(entities, selected) {
    return `<option value="">Ikke valgt</option>${entities.map((entity) => `<option value="${escapeHtml(entity.id)}"${entity.id === selected ? " selected" : ""}>${escapeHtml(entity.name)}</option>`).join("")}`;
  }

  function configurePrinterCard(card, commit) {
    document.getElementById("beastPrinterCardSettings")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "beastPrinterCardSettings";
    overlay.className = "beast-modal-overlay";
    const cameraFields = card.type === "cameras" ? `<label>Livekamera<select data-live-camera>${optionsMarkup(cameraEntities(false), card.entity)}</select></label><label>Statuskamera<select data-secondary-camera>${optionsMarkup(cameraEntities(true), card.secondaryEntity)}</select></label>` : `<label>Visning<select data-display><option value="full">Alt indhold</option><option value="compact">Kompakt status og styring</option><option value="status">Kun status og målinger</option></select></label><label><input type="checkbox" data-show-images ${card.showImages === false ? "" : "checked"}> Vis billeder af emnet</label><label>Maks. billeder<input type="number" min="1" max="6" data-image-limit value="${Number(card.imageLimit || 3)}"></label>`;
    overlay.innerHTML = `<div class="beast-modal beast-page-card-settings" role="dialog" aria-modal="true"><div class="beast-modal-header"><div><small>3D Printer</small><h3>Indstil kort</h3></div><button type="button" class="beast-modal-close" data-close>${BeastCore.icon("close", { size: 22 })}</button></div><div class="beast-modal-body">${cameraFields}<p>Størrelsen ændres direkte med håndtaget i kortets nederste højre hjørne.</p></div><div class="beast-modal-actions"><button type="button" data-close>Annullér</button><button type="button" class="beast-btn beast-btn-primary" data-save>Gem kort</button></div></div>`;
    document.body.appendChild(overlay);
    if (overlay.querySelector("[data-display]")) overlay.querySelector("[data-display]").value = card.display || "full";
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) return overlay.remove();
      if (!event.target.closest("[data-save]")) return;
      const updated = { ...card };
      if (card.type === "cameras") {
        updated.entity = overlay.querySelector("[data-live-camera]").value || null;
        updated.secondaryEntity = overlay.querySelector("[data-secondary-camera]").value || null;
      } else { updated.display = overlay.querySelector("[data-display]").value; updated.showImages = overlay.querySelector("[data-show-images]").checked; updated.imageLimit = Number(overlay.querySelector("[data-image-limit]").value) || 3; }
      commit(updated);
      overlay.remove();
    });
  }

  function init(root) {
    applyConfig();
    containerEl = root;
    containerEl.classList.add("beast-printer-panel");
    containerEl.innerHTML = `<button type="button" class="beast-page-edit-trigger" id="beastPrinterEdit" aria-label="Rediger 3D Printer" title="Rediger siden">⋮</button><div class="beast-overview-grid beast-page-builder-grid beast-printer-dashboard is-freeform" id="beastPrinterGrid"></div>`;
    gridEl = document.getElementById("beastPrinterGrid");
    pageEditor = BeastCardEditor.attach({
      zoneEl: gridEl,
      configPath: "pageLayouts.printer.cards",
      cardTypes: [["cameras", "Printerkameraer"], ["control", "Printstatus og styring"], ...BeastStandardCards.types],
      singleInstanceTypes: ["cameras", "control"],
      renderCardMarkup: printerCardMarkup,
      seedCards: defaultCards,
      defaultCardSize: { desktop: { w: 4, h: 1 }, tablet: { w: 1, h: 1 }, portrait: { h: 1 } },
      allEntities: BeastCardEditor.allEntities,
      entityPickerTypes: BeastStandardCards.entityPickerTypes,
      editLabel: "Redigerer 3D Printer",
      configureCard: configurePrinterCard,
      onAfterRender: () => wireCards()
    });
    document.getElementById("beastPrinterEdit")?.addEventListener("click", () => pageEditor.enter());
    render();

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
