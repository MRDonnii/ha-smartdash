(function () {
  let IDS = {};
  let SPECIAL_ROBOTS = {};
  let selectedVacuums = [];
  let selectedMowers = [];
  let GUNNER_ROOMS = [];

  function applyConfig() {
    const config = BeastConfig.get("panels.robots") || {};
    selectedVacuums = Array.isArray(config.vacuums) ? config.vacuums.filter(Boolean) : [];
    selectedMowers = Array.isArray(config.mowers) ? config.mowers.filter(Boolean) : [];
    SPECIAL_ROBOTS = { leonora: selectedVacuums[0] || null, gunner: selectedVacuums[1] || null, poul: selectedMowers[0] || null };
    IDS = {
      leonora: SPECIAL_ROBOTS.leonora, gunner: SPECIAL_ROBOTS.gunner, poul: SPECIAL_ROBOTS.poul,
      leonoraBattery: config.leonoraBattery, leonoraBin: config.leonoraBin, gunnerMap: config.gunnerMap,
      gunnerBattery: config.gunnerBattery, gunnerRoom: config.gunnerRoom, gunnerProgress: config.gunnerProgress,
      gunnerMop: config.gunnerMop, gunnerMopMode: config.gunnerMopMode, gunnerCleanScript: config.gunnerCleanScript,
      poulBattery: config.poulBattery, poulOnline: config.poulOnline, poulCharging: config.poulCharging,
      leonoraImage: config.leonoraImage || null, poulImage: config.poulImage || null
    };
    GUNNER_ROOMS = (config.roomSelectors || []).map((id) => ({ id, label: BeastEntityPicker.friendlyName(id), cls: id.split(".")[1]?.replace(/^vacuum_/, "") || "room" }));
  }

  const STATE_LABELS = {
    docked: "Docket", cleaning: "Rengør", returning: "På vej hjem", paused: "Pause",
    idle: "Klar", error: "Fejl", mowing: "Slår græs", charging: "Oplader"
  };

  let containerEl = null;
  let gridEl = null;
  let pageEditor = null;
  let wholeHouseSelected = false;
  let roomLayoutEditing = false;
  const ROOM_LAYOUT_KEY = "beast_gunner_room_button_positions_v1";

  function defaultCards() {
    // Never infer a branded/special template from array position. Existing
    // saved leonora/gunner/poul cards remain untouched; new installations
    // get neutral cards built from their actual HA entities.
    return [...selectedVacuums, ...selectedMowers].map((entity, index) => ({
      id: `robot_${entity.replace(/[^a-z0-9_]+/gi, "_")}_${index}`,
      type: "robot", entity, display: "full",
      desktop: { w: 6, h: 2 }, tablet: { w: 2, h: 2 }, portrait: { h: 2 }
    }));
  }

  function savedCards() {
    const cards = BeastConfig.get("pageLayouts.robots.cards");
    if (BeastConfig.get("pageLayouts.robots.cardsConfigured") === true && Array.isArray(cards)) return cards;
    return Array.isArray(cards) && cards.length ? cards : defaultCards();
  }

  function cardSize(card) {
    return `data-builder-card="${escapeHtml(card.id)}" style="--desktop-w:${Number(card.desktop?.w) || 4};--desktop-h:${Number(card.desktop?.h) || 1};--tablet-w:${Number(card.tablet?.w) || 1};--tablet-h:${Number(card.tablet?.h) || 1};--portrait-h:${Number(card.portrait?.h) || 1};"`;
  }

  // The whole panel re-renders (innerHTML replace) on every relevant state
  // change, which is frequent while Gunner is actively cleaning (progress,
  // current room). That destroys and recreates the map <img> each time, and
  // since loading it is an authenticated blob fetch (not instant), the new
  // element sat blank until the fetch resolved -- a visible blink every
  // render. Caching the last frame at module scope (outliving any single
  // <img> element) and throttling the actual refetch fixes both: the new
  // element starts pre-filled with the last frame instead of blank, and the
  // network fetch only happens a few times a minute instead of on every render.
  let gunnerMapObjectUrl = null;
  let gunnerMapEntityId = null;
  let gunnerMapLastFetchAt = 0;
  const GUNNER_MAP_REFRESH_MS = 5000;

  function refreshGunnerMap(map, entityId = IDS.gunnerMap) {
    if (!map || !entityId) return;
    if (entityId !== gunnerMapEntityId) {
      if (gunnerMapObjectUrl) URL.revokeObjectURL(gunnerMapObjectUrl);
      gunnerMapObjectUrl = null;
      gunnerMapEntityId = entityId;
      gunnerMapLastFetchAt = 0;
    }
    const now = Date.now();
    if (gunnerMapObjectUrl && now - gunnerMapLastFetchAt < GUNNER_MAP_REFRESH_MS) return;
    gunnerMapLastFetchAt = now;
    BeastAuth.haFetchBlob(entityId.startsWith("camera.") ? (state(entityId)?.attributes?.entity_picture || `/api/camera_proxy/${entityId}`) : `/api/image_proxy/${entityId}`).then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      if (gunnerMapObjectUrl) URL.revokeObjectURL(gunnerMapObjectUrl);
      gunnerMapObjectUrl = objectUrl;
      const currentMap = document.getElementById("beastGunnerMap");
      if (currentMap) currentMap.src = objectUrl;
    }).catch(() => {});
  }

  function savedRoomPositions() {
    try { return JSON.parse(localStorage.getItem(ROOM_LAYOUT_KEY) || "{}"); }
    catch (_) { return {}; }
  }
  function saveRoomPosition(entityId, left, top) {
    const positions = savedRoomPositions();
    positions[entityId] = { left, top };
    localStorage.setItem(ROOM_LAYOUT_KEY, JSON.stringify(positions));
  }
  function applyRoomPositions(root) {
    const positions = savedRoomPositions();
    root.querySelectorAll("[data-room]").forEach((button) => {
      const position = positions[button.dataset.room];
      if (!position) return;
      button.style.left = `${position.left}%`;
      button.style.top = `${position.top}%`;
    });
  }

  function state(id) { return BeastHaSocket.getState(id); }
  function value(id, fallback = "–") {
    const result = state(id)?.state;
    return !result || ["unknown", "unavailable"].includes(result) ? fallback : result;
  }
  function escapeHtml(input) {
    return String(input ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }
  function callService(domain, service, entityId, data = {}) {
    return BeastAuth.haFetch(`/api/services/${domain}/${service}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_id: entityId, ...data })
    }).catch((error) => BeastCore.log(`Robotter: kommando fejlede (${error.message}).`));
  }
  function emptyGunnerBin() {
    const match = Array.from(BeastHaSocket.getAllStates().values()).find((entity) => {
      if (!entity?.entity_id?.startsWith("button.")) return false;
      const text = `${entity.entity_id} ${entity.attributes?.friendly_name || ""}`.toLowerCase();
      return /(gunner|roborock|s7)/.test(text) && /(empty|dust|bin|tøm|støv)/.test(text);
    });
    if (match) return callService("button", "press", match.entity_id);
    return callService("vacuum", "send_command", IDS.gunner, { command: "app_start_collect_dust" });
  }
  function statusPill(entityId) {
    const current = value(entityId, "offline");
    const active = ["cleaning", "mowing", "returning"].includes(current);
    return `<span class="beast-room-badge${active ? " is-active" : ""}">${escapeHtml(STATE_LABELS[current] || current)}</span>`;
  }
  function battery(entityId, sensorId) {
    const entityValue = state(entityId)?.attributes?.battery_level;
    const level = Number.isFinite(Number(entityValue)) ? entityValue : value(sensorId);
    return `<span>${BeastCore.icon("bolt", { size: 15 })} ${escapeHtml(level)}%</span>`;
  }
  function actions(entityId, domain, startService) {
    return `
      <div class="beast-robot-actions">
        <button type="button" class="beast-security-action-btn" data-command="${domain}|${startService}|${entityId}">Start</button>
        <button type="button" class="beast-security-action-btn" data-command="${domain}|pause|${entityId}">Pause</button>
        <button type="button" class="beast-security-action-btn" data-command="${domain}|${domain === "vacuum" ? "return_to_base" : "dock"}|${entityId}">Hjem</button>
      </div>
    `;
  }

  function robotFeatures(entityId) {
    const deviceId = BeastRegistry.getEntityMeta(entityId)?.deviceId;
    const entityIds = deviceId ? BeastRegistry.getDeviceEntityIds(deviceId) : [];
    const entries = entityIds.map((id) => ({ id, state: state(id), text: `${id} ${state(id)?.attributes?.friendly_name || ""}`.toLowerCase() }));
    const find = (domain, pattern) => entries.find((entry) => entry.id.startsWith(`${domain}.`) && pattern.test(entry.text))?.id || null;
    return {
      deviceId,
      entityIds,
      battery: find("sensor", /battery|batteri|akku|charge level/),
      bin: find("binary_sensor", /bin|dust|beholder|full|fuld/),
      progress: find("sensor", /progress|fremdrift|percent|procent/),
      area: find("sensor", /room|rum|zone|omrade|område/),
      map: entries.find((entry) => entry.id.startsWith("image."))?.id || null,
      selects: entries.filter((entry) => entry.id.startsWith("select.") && Array.isArray(entry.state?.attributes?.options)).map((entry) => entry.id),
      buttons: entries.filter((entry) => entry.id.startsWith("button.")).map((entry) => entry.id)
    };
  }

  function buildGenericRobot(entityId, domain, options = {}) {
    const entity = state(entityId);
    const features = robotFeatures(entityId);
    const name = options.name || options.label || entity?.attributes?.friendly_name || BeastEntityPicker.friendlyName(entityId);
    const model = options.model || BeastRegistry.getDevice(BeastRegistry.getEntityMeta(entityId)?.deviceId)?.model || (domain === "vacuum" ? "Robotstøvsuger" : "Robotplæneklipper");
    const bindings = options.bindings || {};
    const batteryEntity = bindings.battery || features.battery;
    const binEntity = bindings.bin || features.bin;
    const progressEntity = bindings.progress || features.progress;
    const areaEntity = bindings.area || features.area;
    const mediaEntity = bindings.media || features.map;
    const visible = { battery:true, status:true, facts:true, controls:true, settings:true, quickActions:true, ...(options.visible || {}) };
    const startService = domain === "vacuum" ? "start" : "start_mowing";
    const extraFacts = [
      binEntity ? `<span>${BeastCore.icon("grid", { size: 15 })} ${value(binEntity, "off") === "on" ? "Beholder kræver opmærksomhed" : "Beholder klar"}</span>` : "",
      progressEntity ? `<span>${BeastCore.icon("check", { size: 15 })} ${escapeHtml(value(progressEntity))}%</span>` : "",
      areaEntity ? `<span>${BeastCore.icon("home", { size: 15 })} ${escapeHtml(value(areaEntity))}</span>` : ""
    ].filter(Boolean).join("");
    return `
      <article class="beast-robot-card beast-robot-card--product">
        <div class="beast-robot-card-head">
          <div><small>${escapeHtml(model)}</small><strong class="beast-robot-name">${escapeHtml(name)}</strong></div>
          ${visible.status ? statusPill(entityId) : ""}
        </div>
        <div class="beast-robot-media">${options.imageUrl ? `<img data-robot-url="${escapeHtml(options.imageUrl)}" alt="${escapeHtml(name)}">` : mediaEntity ? `<img data-robot-image="${escapeHtml(mediaEntity)}" alt="${escapeHtml(name)}">` : `<span class="beast-robot-generic-icon">${BeastCore.icon(options.icon || "robot", { size: 72 })}</span>`}</div>
        ${visible.facts ? `<div class="beast-robot-facts">
          ${visible.battery ? battery(entityId, batteryEntity) : ""}
          <span>${BeastCore.icon("home", { size: 15 })} ${escapeHtml(STATE_LABELS[entity?.state] || entity?.state || "Offline")}</span>
          ${extraFacts}
        </div>` : ""}
        ${visible.controls ? actions(entityId, domain, startService) : ""}
        ${visible.settings && features.selects.length ? `<div class="beast-robot-settings">${features.selects.map((id) => selectControl(id, BeastEntityPicker.friendlyName(id))).join("")}</div>` : ""}
        ${visible.quickActions && features.buttons.length ? `<div class="beast-robot-quick-actions">${features.buttons.slice(0, Number(options.quickActions ?? 4)).map((id) => `<button type="button" data-command="button|press|${escapeHtml(id)}">${escapeHtml(BeastEntityPicker.friendlyName(id))}</button>`).join("")}</div>` : ""}
      </article>`;
  }
  function selectControl(entityId, label) {
    const entity = state(entityId);
    const options = entity?.attributes?.options || [];
    return `
      <label class="beast-robot-setting">
        <span>${label}</span>
        <select data-select="${entityId}">
          ${options.map((option) => `<option value="${escapeHtml(option)}"${option === entity?.state ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}
        </select>
      </label>
    `;
  }
  function suctionControl() {
    const entity = state(IDS.gunner);
    const options = entity?.attributes?.fan_speed_list || [];
    return `
      <label class="beast-robot-setting">
        <span>Sugestyrke</span>
        <select data-fan-speed="${IDS.gunner}">
          ${options.map((option) => `<option value="${escapeHtml(option)}"${option === entity?.attributes?.fan_speed ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}
        </select>
      </label>
    `;
  }

  function buildLeonora(card = {}) {
    const robotId = card.entity || IDS.leonora;
    const name = card.name || card.label || "Leonora";
    const model = card.model || "iRobot Roomba 860";
    const batteryId = card.bindings?.battery || IDS.leonoraBattery;
    const binId = card.bindings?.bin || IDS.leonoraBin;
    const visible = { battery:true, status:true, facts:true, controls:true, ...(card.visible || {}) };
    return `
      <article class="beast-robot-card beast-robot-card--product">
        <div class="beast-robot-card-head">
          <div><small>${escapeHtml(model)}</small><strong class="beast-robot-name">${escapeHtml(name)}</strong></div>
          ${visible.status ? statusPill(robotId) : ""}
        </div>
        <div class="beast-robot-media">${card.imageUrl ? `<img data-robot-url="${escapeHtml(card.imageUrl)}" alt="${escapeHtml(name)}">` : card.bindings?.media || IDS.leonoraImage ? `<img data-robot-image="${escapeHtml(card.bindings?.media || IDS.leonoraImage)}" alt="${escapeHtml(name)}">` : `<picture><img class="beast-robot-theme-image is-dark" src="./assets/robots/leonora-roomba-860.webp" alt="${escapeHtml(name)}"><img class="beast-robot-theme-image is-light" src="./assets/robots/leonora-roomba-860-light.webp" alt=""></picture>`}</div>
        ${visible.facts ? `<div class="beast-robot-facts">
          ${visible.battery ? battery(robotId, batteryId) : ""}
          <span>${BeastCore.icon("grid", { size: 15 })} Beholder ${value(binId, "off") === "on" ? "fuld" : "klar"}</span>
        </div>` : ""}
        ${visible.controls ? actions(robotId, "vacuum", "start") : ""}
      </article>
    `;
  }

  function buildGunner(card = {}) {
    const name = card.name || card.label || "Gunneren";
    const model = card.model || "Roborock S7 MaxV";
    const visible = { battery:true, status:true, facts:true, controls:true, settings:true, quickActions:true, ...(card.visible || {}) };
    const mapEntity = card.bindings?.media || IDS.gunnerMap;
    const areaEntity = card.bindings?.area || IDS.gunnerRoom;
    const progressEntity = card.bindings?.progress || IDS.gunnerProgress;
    const selectedCount = GUNNER_ROOMS.filter((room) => state(room.id)?.state === "on").length;
    return `
      <article class="beast-robot-card beast-robot-card--map">
        <div class="beast-robot-card-head">
          <div><small>${escapeHtml(model)}</small><strong class="beast-robot-name">${escapeHtml(name)}</strong></div>
          ${visible.status ? statusPill(IDS.gunner) : ""}
        </div>
        <div class="beast-robot-map">
          <div class="beast-robot-map-canvas">
            <img id="beastGunnerMap" data-gunner-map="${escapeHtml(mapEntity || "")}" alt="${escapeHtml(name)} rengøringskort"${gunnerMapObjectUrl ? ` src="${gunnerMapObjectUrl}"` : ""}>
            <div class="beast-robot-room-layer" aria-label="Vælg rum på kortet">
              ${GUNNER_ROOMS.map((room) => `
                <button type="button" class="beast-map-room beast-map-room--${room.cls}${state(room.id)?.state === "on" ? " is-selected" : ""}" data-room="${room.id}" aria-label="${escapeHtml(room.label)}" title="${escapeHtml(room.label)}" aria-pressed="${state(room.id)?.state === "on"}">
                  ${BeastCore.icon(state(room.id)?.state === "on" ? "check" : "grid", { size: 15 })}
                  <span>${escapeHtml(room.label)}</span>
                </button>
              `).join("")}
            </div>
          </div>
          ${visible.facts ? `<div class="beast-robot-map-stats">
            ${visible.battery ? battery(IDS.gunner, card.bindings?.battery || IDS.gunnerBattery) : ""}
            <span>${escapeHtml(value(areaEntity, "Intet rum"))}</span>
            <span>${escapeHtml(value(progressEntity, "0"))}%</span>
          </div>` : ""}
        </div>
        ${visible.quickActions ? `<div class="beast-robot-quick-actions">
          <button type="button" data-gunner-action="dock">${BeastCore.icon("home", { size: 17 })}<span>Send i dock</span></button>
          <button type="button" data-gunner-action="empty">${BeastCore.icon("grid", { size: 17 })}<span>Tøm beholder</span></button>
        </div>` : ""}
        ${visible.controls ? `<div class="beast-robot-selection">
          <span>${roomLayoutEditing ? `<strong>Flyt</strong> knapperne med fingeren` : `<strong>${wholeHouseSelected ? "Alle" : selectedCount}</strong> ${wholeHouseSelected ? "rum · hele huset" : selectedCount === 1 ? "rum valgt" : "rum valgt"}`}</span>
          <div>
            ${roomLayoutEditing ? `
              <button type="button" data-room-action="reset-layout">Nulstil</button>
              <button type="button" class="is-start" data-room-action="layout">${BeastCore.icon("check", { size: 18 })} Gem placering</button>
            ` : `
              <button type="button" data-room-action="layout">Flyt knapper</button>
              <button type="button" data-room-action="clear">Ryd valg</button>
              <button type="button" data-room-action="all">Hele huset</button>
              <button type="button" class="is-start" data-room-action="start"${selectedCount || wholeHouseSelected ? "" : " disabled"}>${BeastCore.icon("check", { size: 18 })} Start rengøring</button>
            `}
          </div>
        </div>` : ""}
        ${visible.settings ? `<div class="beast-robot-settings">
          ${suctionControl()}
          ${selectControl(IDS.gunnerMop, "Vand")}
          ${selectControl(IDS.gunnerMopMode, "Moppetype")}
        </div>` : ""}
      </article>
    `;
  }

  function buildPoul(card = {}) {
    const robotId = card.entity || IDS.poul;
    const name = card.name || card.label || "Poul";
    const model = card.model || "WORX Landroid M500 Plus";
    const visible = { battery:true, status:true, facts:true, controls:true, ...(card.visible || {}) };
    return `
      <article class="beast-robot-card beast-robot-card--product">
        <div class="beast-robot-card-head">
          <div><small>${escapeHtml(model)}</small><strong class="beast-robot-name">${escapeHtml(name)}</strong></div>
          ${visible.status ? statusPill(robotId) : ""}
        </div>
        <div class="beast-robot-media">${card.imageUrl ? `<img data-robot-url="${escapeHtml(card.imageUrl)}" alt="${escapeHtml(name)}">` : card.bindings?.media || IDS.poulImage ? `<img data-robot-image="${escapeHtml(card.bindings?.media || IDS.poulImage)}" alt="${escapeHtml(name)}">` : `<picture><img class="beast-robot-theme-image is-dark" src="./assets/robots/poul-landroid-m500-plus.webp" alt="${escapeHtml(name)}"><img class="beast-robot-theme-image is-light" src="./assets/robots/poul-landroid-m500-plus-light.webp" alt=""></picture>`}</div>
        ${visible.facts ? `<div class="beast-robot-facts">
          ${visible.battery ? battery(robotId, card.bindings?.battery || IDS.poulBattery) : ""}
          <span>${BeastCore.icon("robot", { size: 15 })} ${value(IDS.poulOnline, "off") === "on" ? "Forbundet" : "Offline"}</span>
          <span>${value(IDS.poulCharging, "off") === "on" ? "Oplader" : "Klar"}</span>
        </div>` : ""}
        ${visible.controls ? actions(robotId, "lawn_mower", "start_mowing") : ""}
      </article>
    `;
  }

  function robotCardMarkup(card) {
    if (BeastStandardCards.isStandardType(card.type)) return BeastStandardCards.renderMarkup(card);
    let content = "";
    if (card.type === "leonora") content = buildLeonora(card);
    else if (card.type === "gunner") content = buildGunner(card);
    else if (card.type === "poul") content = buildPoul(card);
    else if (card.entity) content = buildGenericRobot(card.entity, card.entity.startsWith("lawn_mower.") ? "lawn_mower" : "vacuum", card);
    return `<section class="beast-panel beast-ov-card beast-page-builder-card beast-robot-builder-card" ${cardSize(card)} data-card-display="${escapeHtml(card.display || "full")}">${content}</section>`;
  }

  function renderCards(cards) {
    if (!gridEl) return;
    gridEl.innerHTML = `${cards.map(robotCardMarkup).join("")}<div data-card-editor-anchor></div>`;
    wireCards();
  }

  function render() {
    if (!containerEl || pageEditor?.isEditing()) return;
    renderCards(savedCards());
  }

  function wireCards() {
    if (!gridEl) return;
    BeastStandardCards.wire(gridEl);
    const roomLayer = containerEl.querySelector(".beast-robot-room-layer");
    roomLayer?.classList.toggle("is-editing", roomLayoutEditing);
    if (roomLayer) applyRoomPositions(roomLayer);
    const map = document.getElementById("beastGunnerMap");
    if (map) refreshGunnerMap(map, map.dataset.gunnerMap || IDS.gunnerMap);
    containerEl.querySelectorAll("[data-robot-image]").forEach((image) => {
      const entityId = image.dataset.robotImage;
      const path = entityId.startsWith("camera.") ? (state(entityId)?.attributes?.entity_picture || `/api/camera_proxy/${entityId}`) : `/api/image_proxy/${entityId}`;
      BeastAuth.setAuthedImageSrc(image, path);
    });
    containerEl.querySelectorAll("[data-robot-url]").forEach((image) => { image.src = image.dataset.robotUrl; });

    containerEl.querySelectorAll("[data-command]").forEach((button) => {
      button.addEventListener("click", () => {
        const [domain, service, entityId] = button.dataset.command.split("|");
        callService(domain, service, entityId).then(() => window.setTimeout(render, 500));
      });
    });
    containerEl.querySelectorAll("[data-select]").forEach((select) => {
      select.addEventListener("change", () => {
        callService("select", "select_option", select.dataset.select, { option: select.value })
          .then(() => window.setTimeout(render, 400));
      });
    });
    containerEl.querySelectorAll("[data-room]").forEach((button) => {
      button.addEventListener("click", () => {
        if (roomLayoutEditing || button.dataset.dragged === "true") {
          button.dataset.dragged = "false";
          return;
        }
        const selected = button.getAttribute("aria-pressed") === "true";
        wholeHouseSelected = false;
        callService("input_boolean", selected ? "turn_off" : "turn_on", button.dataset.room)
          .then(() => window.setTimeout(render, 220));
      });
      button.addEventListener("pointerdown", (event) => {
        if (!roomLayoutEditing || !roomLayer) return;
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        button.dataset.dragged = "false";
        const move = (moveEvent) => {
          const bounds = roomLayer.getBoundingClientRect();
          const left = Math.max(5, Math.min(95, ((moveEvent.clientX - bounds.left) / bounds.width) * 100));
          const top = Math.max(5, Math.min(90, ((moveEvent.clientY - bounds.top) / bounds.height) * 100));
          button.style.left = `${left}%`;
          button.style.top = `${top}%`;
          button.dataset.dragged = "true";
        };
        const finish = () => {
          button.removeEventListener("pointermove", move);
          button.removeEventListener("pointerup", finish);
          button.removeEventListener("pointercancel", finish);
          if (button.dataset.dragged === "true") {
            saveRoomPosition(button.dataset.room, parseFloat(button.style.left), parseFloat(button.style.top));
          }
        };
        button.addEventListener("pointermove", move);
        button.addEventListener("pointerup", finish);
        button.addEventListener("pointercancel", finish);
      });
    });
    containerEl.querySelector("[data-room-action='layout']")?.addEventListener("click", () => {
      roomLayoutEditing = !roomLayoutEditing;
      render();
    });
    containerEl.querySelector("[data-room-action='reset-layout']")?.addEventListener("click", () => {
      localStorage.removeItem(ROOM_LAYOUT_KEY);
      render();
    });
    containerEl.querySelector("[data-gunner-action='dock']")?.addEventListener("click", () => {
      callService("vacuum", "return_to_base", IDS.gunner).then(() => window.setTimeout(render, 500));
    });
    containerEl.querySelector("[data-gunner-action='empty']")?.addEventListener("click", () => {
      emptyGunnerBin().then(() => window.setTimeout(render, 500));
    });
    containerEl.querySelector("[data-room-action='clear']")?.addEventListener("click", () => {
      wholeHouseSelected = false;
      callService("input_boolean", "turn_off", GUNNER_ROOMS.map((room) => room.id)).then(() => window.setTimeout(render, 250));
    });
    containerEl.querySelector("[data-room-action='all']")?.addEventListener("click", () => {
      wholeHouseSelected = true;
      callService("input_boolean", "turn_off", GUNNER_ROOMS.map((room) => room.id)).then(() => window.setTimeout(render, 250));
    });
    containerEl.querySelector("[data-room-action='start']")?.addEventListener("click", () => {
      if (!wholeHouseSelected && !GUNNER_ROOMS.some((room) => state(room.id)?.state === "on")) return;
      callService("script", "turn_on", IDS.gunnerCleanScript).then(() => {
        wholeHouseSelected = false;
        window.setTimeout(render, 500);
      });
    });
    containerEl.querySelectorAll("[data-fan-speed]").forEach((select) => {
      select.addEventListener("change", () => {
        callService("vacuum", "set_fan_speed", select.dataset.fanSpeed, { fan_speed: select.value })
          .then(() => window.setTimeout(render, 400));
      });
    });
  }

  function configureRobotCard(card, commit) {
    document.getElementById("beastRobotCardSettings")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "beastRobotCardSettings";
    overlay.className = "beast-modal-overlay";
    const selectedRobot = card.entity || (card.type === "leonora" ? IDS.leonora : card.type === "gunner" ? IDS.gunner : card.type === "poul" ? IDS.poul : "");
    const robotOptions = robotEntities().map((entity) => `<option value="${escapeHtml(entity.id)}"${entity.id === selectedRobot ? " selected" : ""}>${escapeHtml(entity.name)}</option>`).join("");
    const allEntities = BeastCardEditor.allEntities();
    const entityOptions = allEntities.map((entity) => `<option value="${escapeHtml(entity.id)}">${escapeHtml(entity.name)}</option>`).join("");
    const binding = (key) => escapeHtml(card.bindings?.[key] || "");
    const visible = { battery:true, status:true, facts:true, controls:true, settings:true, quickActions:true, ...(card.visible || {}) };
    const check = (key, label) => `<label class="beast-page-editor-check"><input type="checkbox" data-visible="${key}"${visible[key] ? " checked" : ""}> ${label}</label>`;
    overlay.innerHTML = `<div class="beast-modal beast-page-card-settings beast-robot-card-settings" role="dialog" aria-modal="true">
      <div class="beast-modal-header"><div><small>Robotkort</small><h3>Indhold og styring</h3><p>Tilpas navn, datakilder og præcis hvad kortet viser.</p></div><button type="button" class="beast-modal-close" data-close>${BeastCore.icon("close", { size: 22 })}</button></div>
      <div class="beast-modal-body"><div class="beast-robot-editor-grid">
        <section><h4>Robot og udseende</h4><label>Robot<select data-robot>${robotOptions}</select></label><label>Skabelon<select data-template><option value="robot">Automatisk / generisk</option><option value="leonora">Leonora · Roomba</option><option value="gunner">Gunneren · kortstyring</option><option value="poul">Poul · plæneklipper</option></select></label><label>Navn<input type="text" data-name value="${escapeHtml(card.name || card.label || "")}" placeholder="Brug navn fra Home Assistant"></label><label>Model / undertitel<input type="text" data-model value="${escapeHtml(card.model || "")}" placeholder="Brug model fra Home Assistant"></label><label>Billed- eller kort-entity<input type="search" list="beastRobotMediaEntities" data-binding="media" value="${binding("media")}" placeholder="image.* eller camera.*"></label><label>Alternativ billed-URL<input type="url" data-image-url value="${escapeHtml(card.imageUrl || "")}" placeholder="https://…"></label></section>
        <section><h4>Sensorer</h4><label>Batteri<input type="search" list="beastRobotAllEntities" data-binding="battery" value="${binding("battery")}" placeholder="Findes automatisk"></label><label>Beholder / advarsel<input type="search" list="beastRobotAllEntities" data-binding="bin" value="${binding("bin")}" placeholder="Findes automatisk"></label><label>Fremdrift<input type="search" list="beastRobotAllEntities" data-binding="progress" value="${binding("progress")}" placeholder="Findes automatisk"></label><label>Aktuelt rum / område<input type="search" list="beastRobotAllEntities" data-binding="area" value="${binding("area")}" placeholder="Findes automatisk"></label><label>Hurtige enhedsknapper<input type="number" min="0" max="10" data-quick-actions value="${Number(card.quickActions ?? 4)}"></label></section>
        <section><h4>Visning og betjening</h4><label>Visning<select data-display><option value="full">Komplet styring</option><option value="compact">Kompakt status</option><option value="media">Kun billede eller kort</option><option value="controls">Kun status og styring</option></select></label><div class="beast-robot-editor-checks">${check("status","Statusmærke")}${check("battery","Batteri")}${check("facts","Nøgletal")}${check("controls","Start, pause og hjem")}${check("settings","Robotindstillinger")}${check("quickActions","Hurtigknapper")}</div><p>Placering og størrelse ændres direkte på kortet. Tomme sensorfelter findes automatisk fra robotten.</p></section>
      </div><datalist id="beastRobotAllEntities">${entityOptions}</datalist><datalist id="beastRobotMediaEntities">${allEntities.filter((entity) => /^(image|camera)\./.test(entity.id)).map((entity) => `<option value="${escapeHtml(entity.id)}">${escapeHtml(entity.name)}</option>`).join("")}</datalist></div>
      <div class="beast-modal-actions"><button type="button" data-close>Annullér</button><button type="button" class="beast-btn beast-btn-primary" data-save>Gem kort</button></div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("[data-display]").value = card.display || "full";
    overlay.querySelector("[data-template]").value = ["leonora","gunner","poul"].includes(card.type) ? card.type : "robot";
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) return overlay.remove();
      if (!event.target.closest("[data-save]")) return;
      const bindings = {};
      overlay.querySelectorAll("[data-binding]").forEach((input) => { if (input.value.trim()) bindings[input.dataset.binding] = input.value.trim(); });
      const nextVisible = {};
      overlay.querySelectorAll("[data-visible]").forEach((input) => { nextVisible[input.dataset.visible] = input.checked; });
      commit({ ...card, type: overlay.querySelector("[data-template]").value, entity: overlay.querySelector("[data-robot]").value, name: overlay.querySelector("[data-name]").value.trim(), label: overlay.querySelector("[data-name]").value.trim(), model: overlay.querySelector("[data-model]").value.trim(), imageUrl: overlay.querySelector("[data-image-url]").value.trim(), bindings, visible:nextVisible, display: overlay.querySelector("[data-display]").value, quickActions:Number(overlay.querySelector("[data-quick-actions]").value)||0 });
      overlay.remove();
    });
  }

  function robotEntities() {
    return Array.from(BeastHaSocket.getAllStates().values())
      .filter((entity) => entity?.entity_id?.startsWith("vacuum.") || entity?.entity_id?.startsWith("lawn_mower."))
      .map((entity) => ({ id: entity.entity_id, name: entity.attributes?.friendly_name || entity.entity_id }))
      .sort((a, b) => a.name.localeCompare(b.name, "da"));
  }

  function editorEntities(type) {
    return type === "robot" ? robotEntities() : BeastCardEditor.allEntities();
  }

  function init(root) {
    applyConfig();
    containerEl = root;
    containerEl.classList.add("beast-robots-panel");
    containerEl.innerHTML = `<button type="button" class="beast-page-edit-trigger" id="beastRobotsEdit" aria-label="Rediger Robotter" title="Rediger siden">⋮</button><div class="beast-overview-grid beast-page-builder-grid beast-robots-grid is-freeform" id="beastRobotsGrid"></div>`;
    gridEl = document.getElementById("beastRobotsGrid");
    pageEditor = BeastCardEditor.attach({
      zoneEl: gridEl,
      configPath: "pageLayouts.robots.cards",
      cardTypes: [["robot", "Robot"], ...BeastStandardCards.types],
      singleInstanceTypes: ["leonora", "gunner", "poul"],
      renderCardMarkup: robotCardMarkup,
      seedCards: defaultCards,
      defaultCardSize: { desktop: { w: 4, h: 1 }, tablet: { w: 1, h: 1 }, portrait: { h: 1 } },
      allEntities: editorEntities,
      entityPickerTypes: ["robot", ...BeastStandardCards.entityPickerTypes],
      editLabel: "Redigerer Robotter",
      configureCard: configureRobotCard,
      onAfterRender: () => wireCards()
    });
    document.getElementById("beastRobotsEdit")?.addEventListener("click", () => pageEditor.enter());
    render();
    const stableRender = BeastCore.stableUpdater(containerEl, render, 350);
    BeastHaSocket.onStatusChange((status) => { if (status === "connected") render(); });
    const discoveredRobotEntities = [...selectedVacuums, ...selectedMowers].flatMap((id) => robotFeatures(id).entityIds);
    [...new Set([...selectedVacuums, ...selectedMowers, ...discoveredRobotEntities, ...Object.values(IDS).filter(Boolean), ...GUNNER_ROOMS.map((room) => room.id)])].forEach((id) => {
      BeastHaSocket.subscribeEntity(id, stableRender);
    });
  }

  BeastCore.registerPanel("robots", "beastRobotsZone", init);
})();
