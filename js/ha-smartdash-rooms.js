(function () {
  let ROOM_ORDER = [];

  const DOOR_WINDOW_CLASSES = ["door", "window", "garage_door", "opening"];
  const PRESENCE_CLASSES = ["motion", "occupancy", "presence"];
  let ROOM_CLIMATE_SENSORS = {};
  let ROOM_POPUP_ENTITIES = {};
  let ROOM_LAYOUT = { order: [], hidden: [], sizes: {} };

  // No real photo on file for every area — these self-contained gradient
  // placeholders (no external image dependency) stand in where one is missing.
  const PLACEHOLDER_GRADIENTS = [
    ["#8b6cff", "#22d3ee"],
    ["#ff5cb3", "#8b6cff"],
    ["#22d3ee", "#2fe0a8"],
    ["#ffc857", "#ff5cb3"],
    ["#2fe0a8", "#4fb8ff"],
    ["#ff5d7a", "#8b6cff"]
  ];

  function hashString(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    return hash;
  }

  function placeholderGradientFor(areaId) {
    const pair = PLACEHOLDER_GRADIENTS[hashString(areaId) % PLACEHOLDER_GRADIENTS.length];
    return `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`;
  }

  function roomPhotoMarkup(area) {
    if (area.picture) {
      return `<img class="beast-room-photo-img" data-ha-path="${escapeHtml(area.picture)}" alt="">`;
    }
    return `<div class="beast-room-photo-placeholder" style="background:${placeholderGradientFor(area.area_id)};">${BeastCore.icon("home", { size: 32 })}</div>`;
  }

  let containerEl = null;
  let openAreaId = null;
  let savedGridScrollTop = 0;
  let savedModalScrollTop = 0;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function callService(domain, service, entityId, data = {}) {
    return BeastAuth.haFetch(`/api/services/${domain}/${service}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_id: entityId, ...data })
    }).catch((error) => {
      BeastCore.log(`Rum: kommando fejlede (${error.message}).`);
    });
  }

  function entityName(entityId) {
    const state = BeastHaSocket.getState(entityId);
    return (state && state.attributes && state.attributes.friendly_name) || entityId.split(".")[1];
  }

  function roomEntityIds(areaId, domain) {
    const configured = ROOM_POPUP_ENTITIES[areaId];
    const source = configured ? configured.filter((entityId) => entityId.startsWith(`${domain}.`)) : BeastRegistry.getAreaEntityIds(areaId, domain);
    return source.filter((entityId) => {
      const meta = BeastRegistry.getEntityMeta(entityId);
      const state = BeastHaSocket.getState(entityId);
      const text = `${entityId} ${meta?.platform || ""} ${meta?.name || ""} ${meta?.originalName || ""} ${state?.attributes?.friendly_name || ""}`.toLowerCase();
      if (text.includes("unifi") || text.includes("protect")) return false;
      if (domain === "climate" && !text.includes("better_thermostat") && !text.includes("better thermostat")) return false;
      if (ROOM_POPUP_ENTITIES[areaId] && !ROOM_POPUP_ENTITIES[areaId].includes(entityId)) return false;
      return true;
    });
  }

  function groupedLights(areaId) {
    const groups = new Map();
    roomEntityIds(areaId, "light").forEach((id) => {
      const name = entityName(id).trim();
      const key = name.toLocaleLowerCase("da-DK");
      if (!groups.has(key)) groups.set(key, { name, ids: [] });
      groups.get(key).ids.push(id);
    });
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name, "da"));
  }

  function sensorNumber(entityId) {
    const value = Number(BeastHaSocket.getState(entityId)?.state);
    return Number.isFinite(value) ? value : null;
  }

  function roomClimate(areaId, climateIds) {
    const configured = ROOM_CLIMATE_SENSORS[areaId] || [];
    let temperature = sensorNumber(configured[0]);
    let humidity = sensorNumber(configured[1]);

    if (temperature === null && climateIds.length) {
      const value = Number(BeastHaSocket.getState(climateIds[0])?.attributes?.current_temperature);
      if (Number.isFinite(value)) temperature = value;
    }

    const area = BeastRegistry.getArea(areaId);
    if (temperature === null && area?.temperature_entity_id) temperature = sensorNumber(area.temperature_entity_id);
    if (humidity === null && area?.humidity_entity_id) humidity = sensorNumber(area.humidity_entity_id);

    return {
      temperatureLabel: temperature === null ? "–" : `${temperature.toFixed(1)}°`,
      humidityLabel: humidity === null ? "–" : `${Math.round(humidity)}%`
    };
  }

  function roomSummary(areaId) {
    const lightIds = roomEntityIds(areaId, "light");
    const climateIds = roomEntityIds(areaId, "climate");
    const binarySensorIds = roomEntityIds(areaId, "binary_sensor");

    const lightGroups = groupedLights(areaId);
    const lightsOn = lightGroups.filter((group) => group.ids.some((id) => BeastHaSocket.getState(id)?.state === "on")).length;

    const climate = roomClimate(areaId, climateIds);

    let openCount = 0;
    let presence = false;
    binarySensorIds.forEach((id) => {
      const s = BeastHaSocket.getState(id);
      if (!s || s.state !== "on") return;
      const deviceClass = s.attributes.device_class;
      if (DOOR_WINDOW_CLASSES.includes(deviceClass)) openCount += 1;
      if (areaId !== "kontor" && PRESENCE_CLASSES.includes(deviceClass)) presence = true;
    });

    return { lightIds, lightGroups, climateIds, lightsOn, ...climate, openCount, presence };
  }

  // Any binary_sensor change anywhere in the house (a motion sensor, a
  // door) re-triggers this — with 15 rooms' worth of them that's often.
  // A full innerHTML rebuild every time destroyed and recreated every card,
  // which re-ran BeastAuth.setAuthedImageSrc on every room photo (a fresh
  // authenticated fetch each time), so the whole grid visibly blanked and
  // popped back in on a loop. Existing cards are now patched in place —
  // only the text/badges that actually change get touched, and a card's
  // photo is fetched once, on creation, never again.
  function renderGrid() {
    const configured = BeastConfig.get("pageLayouts.rooms") || {};
    ROOM_LAYOUT = configured.roomLayout || ROOM_LAYOUT;
    const hidden = new Set(Array.isArray(ROOM_LAYOUT.hidden) ? ROOM_LAYOUT.hidden : []);
    const order = Array.isArray(ROOM_LAYOUT.order) ? ROOM_LAYOUT.order : [];
    const orderIndex = new Map(order.map((id, index) => [id, index]));
    const areas = ROOM_ORDER
      .map((areaId) => BeastRegistry.getArea(areaId))
      .filter((area) => area && !hidden.has(area.area_id))
      .sort((a, b) => (orderIndex.get(a.area_id) ?? 9999) - (orderIndex.get(b.area_id) ?? 9999));

    let grid = document.getElementById("beastRoomsGrid");
    if (!grid) {
      containerEl.innerHTML = `<button type="button" class="beast-page-edit-trigger beast-rooms-layout-trigger" id="beastRoomsLayoutEdit" aria-label="Rediger rumkort" title="Rediger rumkort">⋮</button><div class="beast-rooms-grid" id="beastRoomsGrid"></div><div id="beastRoomModalHost"></div>`;
      grid = document.getElementById("beastRoomsGrid");
      observeGridResize(grid);
    }
    grid.querySelectorAll("[data-area-id]").forEach((card) => {
      if (!areas.some((area) => area.area_id === card.dataset.areaId)) card.remove();
    });

    areas.forEach((area) => {
      const summary = roomSummary(area.area_id);
      const badges = [];
      if (summary.lightIds.length) {
        badges.push(`<span class="beast-room-badge${summary.lightsOn ? " is-active" : ""}">${BeastCore.icon("sun", { size: 14 })}${summary.lightsOn}/${summary.lightGroups.length}</span>`);
      }
      if (summary.openCount) {
        badges.push(`<span class="beast-room-badge is-warning">${summary.openCount} åben</span>`);
      }
      if (summary.presence) {
        badges.push(`<span class="beast-room-badge is-active">${BeastCore.icon("users", { size: 14 })}</span>`);
      }
      const badgesHtml = badges.join("") || '<span class="beast-room-badge">–</span>';

      const existing = grid.querySelector(`[data-area-id="${area.area_id}"]`);
      if (existing) {
        const climate = existing.querySelector(".beast-room-climate");
        if (climate) climate.setAttribute("aria-label", `Temperatur ${summary.temperatureLabel}, fugtighed ${summary.humidityLabel}`);
        const values = existing.querySelectorAll(".beast-room-climate b");
        if (values[0]) values[0].textContent = summary.temperatureLabel;
        if (values[1]) values[1].textContent = summary.humidityLabel;
        const badgesHost = existing.querySelector(".beast-room-badges");
        if (badgesHost) badgesHost.innerHTML = badgesHtml;
        return;
      }

      const card = document.createElement("button");
      card.type = "button";
      card.className = "beast-room-card";
      card.dataset.areaId = area.area_id;
      const size = ROOM_LAYOUT.sizes?.[area.area_id];
      if (size?.w || size?.h) {
        card.style.setProperty("--room-card-w", String(Math.max(1, Math.min(4, Number(size.w) || 1))));
        card.style.setProperty("--room-card-h", String(Math.max(1, Math.min(2, Number(size.h) || 1))));
      }
      card.innerHTML = `
        <div class="beast-room-photo">${roomPhotoMarkup(area)}</div>
        <div class="beast-room-climate" aria-label="Temperatur ${summary.temperatureLabel}, fugtighed ${summary.humidityLabel}">
          <span>${BeastCore.icon("thermometer", { size: 21 })}<b>${summary.temperatureLabel}</b><small>Temperatur</small></span>
          <span>${BeastCore.icon("droplet", { size: 20 })}<b>${summary.humidityLabel}</b><small>Fugtighed</small></span>
        </div>
        <div class="beast-room-card-scrim">
          <span class="beast-room-name">${escapeHtml(area.name)}</span>
          <div class="beast-room-badges">${badgesHtml}</div>
        </div>
      `;
      card.addEventListener("click", () => openRoomModal(area.area_id));
      grid.appendChild(card);
      const img = card.querySelector("img[data-ha-path]");
      if (img) BeastAuth.setAuthedImageSrc(img, img.dataset.haPath);
    });
    balanceGridColumns(grid);
    BeastNativePageEditor.mount({ section:"rooms", label:"Rum", root:()=>containerEl, host:()=>containerEl.querySelector("#beastRoomsGrid"), trigger:"#beastRoomsLayoutEdit", cards:()=>{
      const hidden = new Set((BeastConfig.get("pageLayouts.rooms.roomLayout") || {}).hidden || []);
      const ids = ROOM_ORDER.filter((id) => BeastRegistry.getArea(id));
      return ids.map((id,index)=>({ id, label:BeastRegistry.getArea(id)?.name || id, selector:`[data-area-id="${CSS.escape(id)}"]`, titleSelector:".beast-room-name", enabled:!hidden.has(id), desktop:{x:(index%3)*4+1,y:Math.floor(index/3)*5+1,w:4,h:5} }));
    }, onSave:(cards)=>{
      const roomLayout = BeastConfig.get("pageLayouts.rooms.roomLayout") || {};
      BeastConfig.set("pageLayouts.rooms.roomLayout", { ...roomLayout, hidden:cards.filter((card)=>card.enabled===false).map((card)=>card.id) });
    }, onFinish:()=>renderGrid() });
  }

  function openRoomLayoutEditor() {
    document.getElementById("beastRoomLayoutEditor")?.remove();
    const layout = BeastConfig.get("pageLayouts.rooms.roomLayout") || {};
    const hidden = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
    const order = Array.isArray(layout.order) && layout.order.length ? layout.order.slice() : ROOM_ORDER.slice();
    const ids = [...new Set([...order, ...ROOM_ORDER])].filter((id) => ROOM_ORDER.includes(id));
    const overlay = document.createElement("div"); overlay.id = "beastRoomLayoutEditor"; overlay.className = "beast-modal-overlay";
    overlay.innerHTML = `<div class="beast-modal beast-room-layout-modal" role="dialog" aria-modal="true"><div class="beast-modal-header"><h3>Rediger rumkort</h3><button type="button" class="beast-modal-close" data-close>×</button></div><div class="beast-modal-body"><p class="beast-page-editor-hint">Skjul rum eller ændr rækkefølgen. Popup-styringen i hvert rum ændres ikke.</p><div class="beast-room-layout-list">${ids.map((id, index) => { const area = BeastRegistry.getArea(id); return `<div class="beast-room-layout-row" data-room-layout-id="${id}"><label><input type="checkbox" data-room-visible ${hidden.has(id) ? "" : "checked"}> <strong>${area?.name || id}</strong></label><div><button type="button" data-room-up ${index ? "" : "disabled"}>↑</button><button type="button" data-room-down ${index < ids.length - 1 ? "" : "disabled"}>↓</button></div></div>`; }).join("")}</div><button type="button" class="beast-btn beast-btn-primary" data-room-layout-save>Gem rumlayout</button></div></div>`;
    document.body.appendChild(overlay);
    const list = overlay.querySelector(".beast-room-layout-list");
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) return overlay.remove();
      if (event.target.closest("[data-room-layout-save]")) {
        const nextOrder = [...list.querySelectorAll("[data-room-layout-id]")].map((item) => item.dataset.roomLayoutId);
        const nextHidden = [...list.querySelectorAll("[data-room-layout-id]")].filter((item) => !item.querySelector("[data-room-visible]").checked).map((item) => item.dataset.roomLayoutId);
        BeastConfig.set("pageLayouts.rooms.roomLayout", { ...layout, order: nextOrder, hidden: nextHidden });
        overlay.remove(); renderGrid(); return;
      }
      const row = event.target.closest("[data-room-layout-id]"); if (!row) return;
      if (event.target.closest("[data-room-up]") && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
      if (event.target.closest("[data-room-down]") && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
      if (event.target.closest("[data-room-up], [data-room-down]")) overlay.querySelectorAll(".beast-room-layout-row").forEach((item, i, all) => { item.querySelector("[data-room-up]").disabled = i === 0; item.querySelector("[data-room-down]").disabled = i === all.length - 1; });
    });
  }

  const GRID_MIN_CARD_WIDTH = 280;

  // grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)) fills rows
  // left-to-right and just stops -- a trailing row with far fewer cards
  // than fit width-wise (e.g. 7, 7, 1) still reserves the same column
  // tracks as a full row, leaving most of it visibly empty instead of
  // stretching to fill it. Picking an explicit column count that divides
  // the actual card count as evenly as possible (e.g. 5, 5, 5 for the same
  // 15 cards) removes that dead space instead.
  function balanceGridColumns(grid) {
    const itemCount = grid.children.length;
    if (!itemCount) return;
    const containerWidth = grid.clientWidth;
    if (!containerWidth) return;
    const gapPx = parseFloat(getComputedStyle(grid).columnGap) || 0;
    const maxColumnsThatFit = Math.max(1, Math.floor((containerWidth + gapPx) / (GRID_MIN_CARD_WIDTH + gapPx)));
    const rows = Math.ceil(itemCount / maxColumnsThatFit);
    const columns = Math.ceil(itemCount / rows);
    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(min(${GRID_MIN_CARD_WIDTH}px, 100%), 1fr))`;
  }

  let gridResizeObserver = null;

  function observeGridResize(grid) {
    if (!window.ResizeObserver) { balanceGridColumns(grid); return; }
    if (gridResizeObserver) gridResizeObserver.disconnect();
    gridResizeObserver = new ResizeObserver(() => balanceGridColumns(grid));
    gridResizeObserver.observe(grid);
  }

  function buildLightsSection(areaId) {
    const groups = groupedLights(areaId);
    if (!groups.length) return "";
    const anyOn = groups.some((group) => group.ids.some((id) => BeastHaSocket.getState(id)?.state === "on"));
    const rows = groups.map((group) => {
      const states = group.ids.map((id) => BeastHaSocket.getState(id)).filter(Boolean);
      const on = states.some((state) => state.state === "on");
      const brightnessValues = states.map((state) => Number(state.attributes?.brightness)).filter(Number.isFinite);
      const brightness = brightnessValues.length
        ? Math.round((brightnessValues.reduce((sum, value) => sum + value, 0) / brightnessValues.length / 255) * 100) : null;
      const entityValue = group.ids.join(",");
      return `
        <div class="beast-light-group-card${on ? " is-on" : ""}">
          <div class="beast-light-group-head">
            <span class="beast-light-group-icon">${BeastCore.icon("sun", { size: 23 })}</span>
            <div><strong>${escapeHtml(group.name)}</strong><small>${group.ids.length === 1 ? "Enkelt lys" : `${group.ids.length} pærer · samlet gruppe`}</small></div>
            <button type="button" class="beast-toggle-btn${on ? " is-on" : ""}" data-action="toggle-light" data-entity="${entityValue}" aria-label="Skift ${escapeHtml(group.name)}">${BeastCore.icon("bolt", { size: 18 })}</button>
          </div>
          ${brightness !== null ? `
            <label class="beast-light-brightness">
              <span>${BeastCore.icon("sun", { size: 15 })}<b>Lysstyrke</b><output>${brightness}%</output></span>
              <input type="range" min="1" max="100" value="${brightness}" data-action="light-brightness" data-entity="${entityValue}">
            </label>
          ` : ""}
        </div>
      `;
    }).join("");
    return `
      <div>
        <p class="beast-modal-section-title">
          <span>Lys</span>
          <button type="button" class="beast-modal-master-btn" data-action="master-light" data-state="${anyOn ? "off" : "on"}">${anyOn ? "Sluk alle" : "Tænd alle"}</button>
        </p>
        <div class="beast-light-group-grid">${rows}</div>
      </div>
    `;
  }

  function buildClimateSection(areaId) {
    const ids = roomEntityIds(areaId, "climate");
    if (!ids.length) return "";
    const rows = ids.map((id) => {
      const s = BeastHaSocket.getState(id);
      const current = s && Number.isFinite(Number(s.attributes.current_temperature)) ? Number(s.attributes.current_temperature).toFixed(1) : "–";
      const target = s && Number.isFinite(Number(s.attributes.temperature)) ? Number(s.attributes.temperature) : null;
      return `
        <div class="beast-control-row" data-entity="${id}" data-domain="climate">
          <span class="beast-control-name">${escapeHtml(entityName(id))}</span>
          <span class="beast-control-meta">${current}° nu</span>
          <div class="beast-stepper">
            <button type="button" class="beast-transport-btn" data-action="climate-down" data-entity="${id}">${BeastCore.icon("minus", { size: 16 })}</button>
            <span class="beast-stepper-value">${target !== null ? `${target}°` : "–"}</span>
            <button type="button" class="beast-transport-btn" data-action="climate-up" data-entity="${id}">${BeastCore.icon("plus", { size: 16 })}</button>
          </div>
        </div>
      `;
    }).join("");
    return `<div><p class="beast-modal-section-title"><span>Klima</span></p><div class="beast-control-list">${rows}</div></div>`;
  }

  function buildCoverSection(areaId) {
    const ids = roomEntityIds(areaId, "cover");
    if (!ids.length) return "";
    const rows = ids.map((id) => `
      <div class="beast-control-row" data-entity="${id}" data-domain="cover">
        <span class="beast-control-name">${escapeHtml(entityName(id))}</span>
        <div class="beast-stepper">
          <button type="button" class="beast-transport-btn" data-action="cover-open" data-entity="${id}">${BeastCore.icon("chevron-up", { size: 16 })}</button>
          <button type="button" class="beast-transport-btn" data-action="cover-stop" data-entity="${id}">${BeastCore.icon("close", { size: 14 })}</button>
          <button type="button" class="beast-transport-btn" data-action="cover-close" data-entity="${id}">${BeastCore.icon("chevron-down", { size: 16 })}</button>
        </div>
      </div>
    `).join("");
    return `<div><p class="beast-modal-section-title"><span>Persienner</span></p><div class="beast-control-list">${rows}</div></div>`;
  }

  function buildLockSection(areaId) {
    const ids = roomEntityIds(areaId, "lock");
    if (!ids.length) return "";
    const rows = ids.map((id) => {
      const s = BeastHaSocket.getState(id);
      const locked = s && s.state === "locked";
      return `
        <div class="beast-control-row" data-entity="${id}" data-domain="lock">
          <span class="beast-control-name">${escapeHtml(entityName(id))}</span>
          <button type="button" class="beast-toggle-btn${locked ? " is-on" : ""}" data-action="toggle-lock" data-entity="${id}" data-locked="${locked}">${BeastCore.icon(locked ? "lock" : "unlock", { size: 18 })}</button>
        </div>
      `;
    }).join("");
    return `<div><p class="beast-modal-section-title"><span>Låse</span></p><div class="beast-control-list">${rows}</div></div>`;
  }

  function buildSwitchSection(areaId) {
    const ids = roomEntityIds(areaId, "switch");
    if (!ids.length) return "";
    const rows = ids.map((id) => {
      const s = BeastHaSocket.getState(id);
      const on = s && s.state === "on";
      return `
        <div class="beast-control-row" data-entity="${id}" data-domain="switch">
          <span class="beast-control-name">${escapeHtml(entityName(id))}</span>
          <button type="button" class="beast-toggle-btn${on ? " is-on" : ""}" data-action="toggle-switch" data-entity="${id}">${BeastCore.icon("bolt", { size: 18 })}</button>
        </div>
      `;
    }).join("");
    return `<div><p class="beast-modal-section-title"><span>Andet</span></p><div class="beast-control-list">${rows}</div></div>`;
  }

  function buildExtraSection(areaId) {
    const configured = ROOM_POPUP_ENTITIES[areaId] || [];
    const supportedDomains = new Set(["sensor", "binary_sensor", "fan", "media_player", "input_boolean", "input_select", "automation", "valve", "vacuum"]);
    const ids = configured.filter((id) => supportedDomains.has(id.split(".")[0]));
    if (!ids.length) return "";
    const cards = ids.map((id) => {
      const s = BeastHaSocket.getState(id);
      if (!s) return "";
      const domain = id.split(".")[0];
      const on = ["on", "open", "playing", "cleaning"].includes(s.state);
      const unavailable = ["unknown", "unavailable"].includes(s.state);
      const readable = unavailable ? "Ikke tilgængelig" : domain === "binary_sensor"
        ? (on ? "Åben" : "Lukket")
        : domain === "sensor" ? `${escapeHtml(s.state)}${s.attributes?.unit_of_measurement ? ` ${escapeHtml(s.attributes.unit_of_measurement)}` : ""}`
        : on ? "Aktiv" : "Fra";
      let control = "";
      if (domain === "input_select") {
        control = `<select class="beast-room-extra-select" data-action="select-option" data-entity="${id}">${(s.attributes?.options || []).map((option) => `<option value="${escapeHtml(option)}"${option === s.state ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`;
      } else if (["fan", "media_player", "input_boolean", "automation", "valve", "vacuum"].includes(domain)) {
        control = `<button type="button" class="beast-toggle-btn${on ? " is-on" : ""}" data-action="toggle-extra" data-entity="${id}" data-domain="${domain}" data-state="${escapeHtml(s.state)}">${BeastCore.icon(on ? "check" : "bolt", { size: 17 })}</button>`;
      }
      return `<div class="beast-room-extra-card"><span class="beast-room-extra-icon">${BeastCore.icon(domain === "binary_sensor" ? (on ? "unlock" : "lock") : domain === "media_player" ? "music" : domain === "fan" ? "wind" : "grid", { size: 19 })}</span><div><strong>${escapeHtml(entityName(id))}</strong><small>${readable}</small></div>${control}</div>`;
    }).join("");
    return cards ? `<div><p class="beast-modal-section-title"><span>Rumfunktioner</span></p><div class="beast-room-extra-grid">${cards}</div></div>` : "";
  }

  function openRoomModal(areaId) {
    openAreaId = areaId;
    renderModal();
  }

  function closeRoomModal() {
    openAreaId = null;
    savedModalScrollTop = 0;
    const host = document.getElementById("beastRoomModalHost");
    if (host) host.innerHTML = "";
  }

  function renderModal() {
    const host = document.getElementById("beastRoomModalHost");
    if (!host || !openAreaId) return;
    const currentBody = host.querySelector(".beast-modal-body");
    if (currentBody) savedModalScrollTop = currentBody.scrollTop;
    const area = BeastRegistry.getArea(openAreaId);
    if (!area) return;

    const sections = [
      buildLightsSection(openAreaId),
      buildClimateSection(openAreaId),
      buildCoverSection(openAreaId),
      buildLockSection(openAreaId),
      buildSwitchSection(openAreaId),
      buildExtraSection(openAreaId)
    ].filter(Boolean);

    host.innerHTML = `
      <div class="beast-modal-overlay" id="beastRoomModalOverlay">
        <div class="beast-modal beast-room-modal">
          <div class="beast-modal-header">
            <div><small>Rumstyring</small><h3>${escapeHtml(area.name)}</h3></div>
            <button type="button" class="beast-modal-close" id="beastRoomModalClose">${BeastCore.icon("close", { size: 16 })}</button>
          </div>
          <div class="beast-modal-body">
            ${sections.length ? sections.join("") : '<p class="beast-music-empty">Ingen styrbare enheder fundet i dette rum.</p>'}
          </div>
        </div>
      </div>
    `;

    document.getElementById("beastRoomModalClose").addEventListener("click", closeRoomModal);
    document.getElementById("beastRoomModalOverlay").addEventListener("click", (event) => {
      if (event.target.id === "beastRoomModalOverlay") closeRoomModal();
    });

    host.querySelectorAll("[data-action]:not(input[type='range']):not(select)").forEach((el) => {
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        handleAction(el.dataset.action, el.dataset.entity, el);
      });
    });
    host.querySelectorAll("input[data-action='light-brightness']").forEach((input) => {
      input.addEventListener("input", () => { input.closest("label")?.querySelector("output")?.replaceChildren(`${input.value}%`); });
      input.addEventListener("change", () => handleAction("light-brightness", input.dataset.entity, input));
    });
    host.querySelectorAll("select[data-action='select-option']").forEach((select) => {
      select.addEventListener("change", () => handleAction("select-option", select.dataset.entity, select));
    });
    window.requestAnimationFrame(() => {
      const nextBody = host.querySelector(".beast-modal-body");
      if (nextBody) nextBody.scrollTop = savedModalScrollTop;
    });
  }

  function handleAction(action, entityId, el) {
    const entityIds = entityId && entityId.includes(",") ? entityId.split(",") : entityId;
    if (action === "toggle-light") {
      const anyOn = (Array.isArray(entityIds) ? entityIds : [entityIds]).some((id) => BeastHaSocket.getState(id)?.state === "on");
      callService("light", anyOn ? "turn_off" : "turn_on", entityIds).then(refreshModalSoon);
    } else if (action === "light-brightness") {
      callService("light", "turn_on", entityIds, { brightness_pct: Number(el.value) }).then(refreshModalSoon);
    } else if (action === "master-light") {
      const ids = roomEntityIds(openAreaId, "light");
      const turnOn = el.dataset.state === "on";
      callService("light", turnOn ? "turn_on" : "turn_off", ids).then(refreshModalSoon);
    } else if (action === "climate-up" || action === "climate-down") {
      const s = BeastHaSocket.getState(entityId);
      const current = s && Number.isFinite(Number(s.attributes.temperature)) ? Number(s.attributes.temperature) : 20;
      const next = current + (action === "climate-up" ? 0.5 : -0.5);
      callService("climate", "set_temperature", entityId, { temperature: next }).then(refreshModalSoon);
    } else if (action === "cover-open") {
      callService("cover", "open_cover", entityId);
    } else if (action === "cover-close") {
      callService("cover", "close_cover", entityId);
    } else if (action === "cover-stop") {
      callService("cover", "stop_cover", entityId);
    } else if (action === "toggle-lock") {
      const locked = el.dataset.locked === "true";
      callService("lock", locked ? "unlock" : "lock", entityId).then(refreshModalSoon);
    } else if (action === "toggle-switch") {
      callService("switch", "toggle", entityId).then(refreshModalSoon);
    } else if (action === "select-option") {
      callService("input_select", "select_option", entityId, { option: el.value }).then(refreshModalSoon);
    } else if (action === "toggle-extra") {
      const domain = el.dataset.domain;
      const state = el.dataset.state;
      if (domain === "valve") callService("valve", state === "open" ? "close_valve" : "open_valve", entityId).then(refreshModalSoon);
      else if (domain === "vacuum") callService("vacuum", state === "cleaning" ? "return_to_base" : "start", entityId).then(refreshModalSoon);
      else callService(domain, "toggle", entityId).then(refreshModalSoon);
    }
  }

  function refreshModalSoon() {
    window.setTimeout(() => { if (openAreaId) renderModal(); }, 300);
  }

  function render() {
    if (!containerEl) return;
    if (!BeastRegistry.isLoaded()) {
      containerEl.innerHTML = `<p class="beast-panel-title">Rum</p><p class="beast-music-empty">Henter rum…</p>`;
      return;
    }
    const currentGrid = containerEl.querySelector(".beast-rooms-grid");
    if (currentGrid) savedGridScrollTop = currentGrid.scrollTop;
    const currentModalBody = containerEl.querySelector(".beast-modal-body");
    if (currentModalBody) savedModalScrollTop = currentModalBody.scrollTop;
    renderGrid();
    if (openAreaId) renderModal();
    window.requestAnimationFrame(() => {
      const nextGrid = containerEl.querySelector(".beast-rooms-grid");
      if (nextGrid) nextGrid.scrollTop = savedGridScrollTop;
    });
  }

  const ROOM_RELEVANT_DOMAINS = ["light", "climate", "binary_sensor", "cover", "lock", "switch"];

  function init(root) {
    const roomConfig = BeastConfig.get("panels.rooms") || {};
    ROOM_ORDER = Array.isArray(roomConfig.areaIds) ? roomConfig.areaIds.slice() : [];
    ROOM_CLIMATE_SENSORS = roomConfig.climateSensors || {};
    ROOM_POPUP_ENTITIES = roomConfig.entityOverrides || {};
    containerEl = root;
    containerEl.classList.add("beast-rooms-panel");
    containerEl.innerHTML = `<p class="beast-music-empty">Forbinder…</p>`;

    const debouncedRender = BeastCore.stableUpdater(containerEl, () => {
      if (BeastRegistry.isLoaded()) render();
    }, 400);

    BeastHaSocket.onStatusChange((status) => {
      if (status !== "connected") return;
      BeastRegistry.ensureLoaded().then(render).catch(() => {
        containerEl.innerHTML = `<p class="beast-music-empty">Kunne ikke hente rum-data.</p>`;
      });
    });

    ROOM_RELEVANT_DOMAINS.forEach((domain) => {
      BeastHaSocket.subscribeDomain(domain, debouncedRender);
    });
  }

  BeastCore.registerPanel("rooms", "beastRoomsZone", init);
})();
