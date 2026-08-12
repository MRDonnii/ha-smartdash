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
    const cards = [];
    if (IDS.leonora) cards.push({ id: "robot_leonora", type: "leonora", display: "full", desktop: { w: 3, h: 2 }, tablet: { w: 1, h: 2 }, portrait: { h: 2 } });
    if (IDS.gunner) cards.push({ id: "robot_gunner", type: "gunner", display: "full", desktop: { w: 6, h: 2 }, tablet: { w: 2, h: 2 }, portrait: { h: 2 } });
    if (IDS.poul) cards.push({ id: "robot_poul", type: "poul", display: "full", desktop: { w: 3, h: 2 }, tablet: { w: 1, h: 2 }, portrait: { h: 2 } });
    return cards;
  }

  function savedCards() {
    const cards = BeastConfig.get("pageLayouts.robots.cards");
    return Array.isArray(cards) ? cards : defaultCards();
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

  function refreshGunnerMap(map) {
    if (!map || !IDS.gunnerMap) return;
    if (IDS.gunnerMap !== gunnerMapEntityId) {
      if (gunnerMapObjectUrl) URL.revokeObjectURL(gunnerMapObjectUrl);
      gunnerMapObjectUrl = null;
      gunnerMapEntityId = IDS.gunnerMap;
      gunnerMapLastFetchAt = 0;
    }
    const now = Date.now();
    if (gunnerMapObjectUrl && now - gunnerMapLastFetchAt < GUNNER_MAP_REFRESH_MS) return;
    gunnerMapLastFetchAt = now;
    BeastAuth.haFetchBlob(`/api/image_proxy/${IDS.gunnerMap}`).then((blob) => {
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

  function buildGenericRobot(entityId, domain) {
    const entity = state(entityId);
    const features = robotFeatures(entityId);
    const name = entity?.attributes?.friendly_name || BeastEntityPicker.friendlyName(entityId);
    const model = BeastRegistry.getDevice(BeastRegistry.getEntityMeta(entityId)?.deviceId)?.model || (domain === "vacuum" ? "Robotstøvsuger" : "Robotplæneklipper");
    const startService = domain === "vacuum" ? "start" : "start_mowing";
    const extraFacts = [
      features.bin ? `<span>${BeastCore.icon("grid", { size: 15 })} ${value(features.bin, "off") === "on" ? "Beholder kræver opmærksomhed" : "Beholder klar"}</span>` : "",
      features.progress ? `<span>${BeastCore.icon("check", { size: 15 })} ${escapeHtml(value(features.progress))}%</span>` : "",
      features.area ? `<span>${BeastCore.icon("home", { size: 15 })} ${escapeHtml(value(features.area))}</span>` : ""
    ].filter(Boolean).join("");
    return `
      <article class="beast-robot-card beast-robot-card--product">
        <div class="beast-robot-card-head">
          <div><small>${escapeHtml(model)}</small><strong class="beast-robot-name">${escapeHtml(name)}</strong></div>
          ${statusPill(entityId)}
        </div>
        <div class="beast-robot-media">${features.map ? `<img data-robot-image="${escapeHtml(features.map)}" alt="${escapeHtml(name)}">` : `<span class="beast-robot-generic-icon">${BeastCore.icon("robot", { size: 72 })}</span>`}</div>
        <div class="beast-robot-facts">
          ${battery(entityId, features.battery)}
          <span>${BeastCore.icon("home", { size: 15 })} ${escapeHtml(STATE_LABELS[entity?.state] || entity?.state || "Offline")}</span>
          ${extraFacts}
        </div>
        ${actions(entityId, domain, startService)}
        ${features.selects.length ? `<div class="beast-robot-settings">${features.selects.map((id) => selectControl(id, BeastEntityPicker.friendlyName(id))).join("")}</div>` : ""}
        ${features.buttons.length ? `<div class="beast-robot-quick-actions">${features.buttons.slice(0, 4).map((id) => `<button type="button" data-command="button|press|${escapeHtml(id)}">${escapeHtml(BeastEntityPicker.friendlyName(id))}</button>`).join("")}</div>` : ""}
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

  function buildLeonora() {
    return `
      <article class="beast-robot-card beast-robot-card--product">
        <div class="beast-robot-card-head">
          <div><small>iRobot Roomba 860</small><strong class="beast-robot-name">Leonora</strong></div>
          ${statusPill(IDS.leonora)}
        </div>
        <div class="beast-robot-media">${IDS.leonoraImage ? `<img data-robot-image="${escapeHtml(IDS.leonoraImage)}" alt="Leonora · iRobot Roomba 860">` : `<picture><img class="beast-robot-theme-image is-dark" src="./assets/robots/leonora-roomba-860.png" alt="Leonora · iRobot Roomba 860"><img class="beast-robot-theme-image is-light" src="./assets/robots/leonora-roomba-860-light.png" alt=""></picture>`}</div>
        <div class="beast-robot-facts">
          ${battery(IDS.leonora, IDS.leonoraBattery)}
          <span>${BeastCore.icon("grid", { size: 15 })} Beholder ${value(IDS.leonoraBin, "off") === "on" ? "fuld" : "klar"}</span>
        </div>
        ${actions(IDS.leonora, "vacuum", "start")}
      </article>
    `;
  }

  function buildGunner() {
    const selectedCount = GUNNER_ROOMS.filter((room) => state(room.id)?.state === "on").length;
    return `
      <article class="beast-robot-card beast-robot-card--map">
        <div class="beast-robot-card-head">
          <div><small>Roborock S7 MaxV</small><strong class="beast-robot-name">Gunneren</strong></div>
          ${statusPill(IDS.gunner)}
        </div>
        <div class="beast-robot-map">
          <div class="beast-robot-map-canvas">
            <img id="beastGunnerMap" alt="Gunnerens rengøringskort"${gunnerMapObjectUrl ? ` src="${gunnerMapObjectUrl}"` : ""}>
            <div class="beast-robot-room-layer" aria-label="Vælg rum på kortet">
              ${GUNNER_ROOMS.map((room) => `
                <button type="button" class="beast-map-room beast-map-room--${room.cls}${state(room.id)?.state === "on" ? " is-selected" : ""}" data-room="${room.id}" aria-label="${escapeHtml(room.label)}" title="${escapeHtml(room.label)}" aria-pressed="${state(room.id)?.state === "on"}">
                  ${BeastCore.icon(state(room.id)?.state === "on" ? "check" : "grid", { size: 15 })}
                  <span>${escapeHtml(room.label)}</span>
                </button>
              `).join("")}
            </div>
          </div>
          <div class="beast-robot-map-stats">
            ${battery(IDS.gunner, IDS.gunnerBattery)}
            <span>${escapeHtml(value(IDS.gunnerRoom, "Intet rum"))}</span>
            <span>${escapeHtml(value(IDS.gunnerProgress, "0"))}%</span>
          </div>
        </div>
        <div class="beast-robot-quick-actions">
          <button type="button" data-gunner-action="dock">${BeastCore.icon("home", { size: 17 })}<span>Send i dock</span></button>
          <button type="button" data-gunner-action="empty">${BeastCore.icon("grid", { size: 17 })}<span>Tøm beholder</span></button>
        </div>
        <div class="beast-robot-selection">
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
        </div>
        <div class="beast-robot-settings">
          ${suctionControl()}
          ${selectControl(IDS.gunnerMop, "Vand")}
          ${selectControl(IDS.gunnerMopMode, "Moppetype")}
        </div>
      </article>
    `;
  }

  function buildPoul() {
    return `
      <article class="beast-robot-card beast-robot-card--product">
        <div class="beast-robot-card-head">
          <div><small>WORX Landroid M500 Plus</small><strong class="beast-robot-name">Poul</strong></div>
          ${statusPill(IDS.poul)}
        </div>
        <div class="beast-robot-media">${IDS.poulImage ? `<img data-robot-image="${escapeHtml(IDS.poulImage)}" alt="Poul · WORX Landroid M500 Plus">` : `<picture><img class="beast-robot-theme-image is-dark" src="./assets/robots/poul-landroid-m500-plus.png" alt="Poul · WORX Landroid M500 Plus"><img class="beast-robot-theme-image is-light" src="./assets/robots/poul-landroid-m500-plus-light.png" alt=""></picture>`}</div>
        <div class="beast-robot-facts">
          ${battery(IDS.poul, IDS.poulBattery)}
          <span>${BeastCore.icon("robot", { size: 15 })} ${value(IDS.poulOnline, "off") === "on" ? "Forbundet" : "Offline"}</span>
          <span>${value(IDS.poulCharging, "off") === "on" ? "Oplader" : "Klar"}</span>
        </div>
        ${actions(IDS.poul, "lawn_mower", "start_mowing")}
      </article>
    `;
  }

  function robotCardMarkup(card) {
    if (BeastStandardCards.isStandardType(card.type)) return BeastStandardCards.renderMarkup(card);
    let content = "";
    if (card.type === "leonora") content = buildLeonora();
    else if (card.type === "gunner") content = buildGunner();
    else if (card.type === "poul") content = buildPoul();
    else if (card.entity === SPECIAL_ROBOTS.leonora) content = buildLeonora();
    else if (card.entity === SPECIAL_ROBOTS.gunner) content = buildGunner();
    else if (card.entity === SPECIAL_ROBOTS.poul) content = buildPoul();
    else if (card.entity) content = buildGenericRobot(card.entity, card.entity.startsWith("lawn_mower.") ? "lawn_mower" : "vacuum");
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
    if (map) refreshGunnerMap(map);
    containerEl.querySelectorAll("[data-robot-image]").forEach((image) => {
      BeastAuth.setAuthedImageSrc(image, `/api/image_proxy/${image.dataset.robotImage}`);
    });

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
    overlay.innerHTML = `<div class="beast-modal beast-page-card-settings" role="dialog" aria-modal="true">
      <div class="beast-modal-header"><div><small>Robotter</small><h3>Indhold i kortet</h3></div><button type="button" class="beast-modal-close" data-close>${BeastCore.icon("close", { size: 22 })}</button></div>
      <div class="beast-modal-body"><label>Robot<select data-robot>${robotOptions}</select></label><label>Visning<select data-display>
        <option value="full">Komplet styring</option><option value="compact">Kompakt status</option><option value="media">Kun billede eller kort</option><option value="controls">Kun status og styring</option>
      </select></label><p>Størrelsen ændres direkte med håndtaget i kortets nederste højre hjørne.</p></div>
      <div class="beast-modal-actions"><button type="button" data-close>Annullér</button><button type="button" class="beast-btn beast-btn-primary" data-save>Gem kort</button></div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("[data-display]").value = card.display || "full";
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) return overlay.remove();
      if (!event.target.closest("[data-save]")) return;
      commit({ ...card, type: "robot", entity: overlay.querySelector("[data-robot]").value, display: overlay.querySelector("[data-display]").value });
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
    const button = document.getElementById("beastRobotsEdit");
    if (button && !button.dataset.pageEditActionBound) window.BeastPageActions?.attach(button, () => pageEditor.enter());
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
