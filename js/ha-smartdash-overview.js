(function () {
  // Dynamic strings in interactive cards need an explicit language choice;
  // the global DOM translator only handles completed static markup. Keep
  // this local helper aligned with the Calendar and Administration modules.
  function t(da, en) {
    return BeastLocalSettings.get("language", "en") === "da" ? da : en;
  }

  let WEATHER_ENTITY_ID = null;
  let POWER_ENTITY_ID = null;
  let PRICE_ENTITY_ID = null;
  let PRICE_FORECAST_ENTITY_ID = null;
  let PRICE_TOMORROW_ID = null;
  let MAIL_PRESENT_ID = null;
  let MAIL_COUNT_ID = null;
  let MAIL_DESCRIPTION_ID = null;
  let MAIL_IMAGE_ID = null;
  let MAIL_IMAGE_CARPORT_ID = null;
  let MAIL_IMAGE_FORHAVEN_ID = null;
  let CAR_BATTERY_ID = null;
  let CAR_RANGE_ID = null;
  let CAR_CHARGING_ID = null;
  let POOL_TEMPERATURE_ID = null;
  let LOCKS = [];
  let LOCK_IDS = [];
  let DOOR_IDS = [];
  let PRIMARY_ALARM_ID = null;
  let ALARM_IDS = [];
  let WASTE_SENSORS = [];
  const OVERVIEW_CAMERA_KEY = "beast_overview_cameras_v1";
  const OVERVIEW_LAYOUT_KEY = "beast_overview_layout_v1";
  const OVERVIEW_AUTO_FOCUS_KEY = "beast_overview_auto_focus_v1";
  let ROBOT_IDS = [];
  let PRINTER_STATUS_ID = null;
  let PRINTER_PROGRESS_ID = null;
  let PRINTER_REMAINING_ID = null;
  let PRINTER_TASK_ID = null;
  let PRINTER_CAMERA_IMAGE_ID = null;
  let PRINTER_BANNER_CAMERA_ID = null;
  let AULA_MESSAGE_ID = null;
  let AULA_LESSON_MINUTES = 10;
  const NOTIFICATION_SNOOZE_KEY = "beast_notification_snooze_v1";
  const OVERVIEW_CAMERA_LIMIT = 3;
  let UTILITY_VIEWS = {};

  function applyConfig() {
    const weather = BeastConfig.get("panels.weather") || {};
    const energy = BeastConfig.get("panels.energy") || {};
    const security = BeastConfig.get("panels.security") || {};
    const waste = BeastConfig.get("panels.waste") || {};
    const car = BeastConfig.get("panels.car") || {};
    const pool = BeastConfig.get("panels.pool") || {};
    const robots = BeastConfig.get("panels.robots") || {};
    const printer = BeastConfig.get("panels.printer") || {};
    const bannerSettings = BeastConfig.get("banners") || {};
    const app = BeastConfig.get("appEntities") || {};
    WEATHER_ENTITY_ID = weather.entity;
    POWER_ENTITY_ID = energy.powerSensor;
    PRICE_ENTITY_ID = energy.priceSensor;
    PRICE_FORECAST_ENTITY_ID = energy.priceForecastSensor;
    PRICE_TOMORROW_ID = energy.tomorrowAvailableSensor;
    MAIL_PRESENT_ID = app.mailPresent;
    MAIL_COUNT_ID = app.mailCount;
    MAIL_DESCRIPTION_ID = app.mailDescription;
    MAIL_IMAGE_ID = app.mailImage;
    MAIL_IMAGE_CARPORT_ID = app.mailImageCarport;
    MAIL_IMAGE_FORHAVEN_ID = app.mailImageForhaven;
    CAR_BATTERY_ID = car.battery; CAR_RANGE_ID = car.range; CAR_CHARGING_ID = car.charging;
    POOL_TEMPERATURE_ID = pool.waterTemp;
    LOCK_IDS = Array.isArray(security.locks) ? security.locks.filter(Boolean) : [];
    DOOR_IDS = Array.isArray(security.openingSensors) ? security.openingSensors.filter(Boolean) : [];
    LOCKS = LOCK_IDS.map((id) => ({ id, label: BeastEntityPicker.friendlyName(id) }));
    ALARM_IDS = Array.isArray(security.alarmPanels) ? security.alarmPanels.filter(Boolean) : [];
    PRIMARY_ALARM_ID = security.primaryAlarm || ALARM_IDS[0] || null;
    WASTE_SENSORS = Array.isArray(waste.sensors) ? waste.sensors.filter(Boolean) : [];
    ROBOT_IDS = [...(robots.vacuums || []), ...(robots.mowers || [])].filter(Boolean).map((id) => ({ id, label: BeastEntityPicker.friendlyName(id) }));
    PRINTER_STATUS_ID = printer.statusSensor; PRINTER_PROGRESS_ID = printer.progressSensor; PRINTER_REMAINING_ID = printer.remainingSensor;
    PRINTER_TASK_ID = printer.taskName; PRINTER_CAMERA_IMAGE_ID = printer.cameraImage;
    PRINTER_BANNER_CAMERA_ID = bannerSettings.printerCameraOverride || null;
    AULA_MESSAGE_ID = app.aulaMessageSensor || null;
    AULA_LESSON_MINUTES = Math.max(1, Number(bannerSettings.aulaLessonMinutes) || 10);
    const hasHeatSource = Boolean(energy.heatPowerSensor || energy.heatEnergySensor);
    const hasWaterSource = Boolean(energy.waterUsageSensor || energy.waterFlowSensor);
    UTILITY_VIEWS = {
      electric: { label: "El", current: energy.powerSensor, today: energy.totalEnergySensor, history: energy.powerSensor, mode: "average", unit: "W", todayUnit: "kWh" },
      ...(energy.showHeatOnOverview !== false && hasHeatSource ? { heat: { label: "Varme", current: energy.heatPowerSensor, today: energy.heatEnergySensor, history: energy.heatEnergySensor, mode: "delta", unit: "kW", todayUnit: "kWh" } } : {}),
      ...(energy.showWaterOnOverview !== false && hasWaterSource ? { water: { label: "Vand", current: energy.waterUsageSensor, today: energy.waterFlowSensor, history: energy.waterUsageSensor, mode: "delta", unit: "m³", todayUnit: "L/h" } } : {})
    };
    if (!UTILITY_VIEWS[utilityView]) utilityView = "electric";
  }

  let zoneEl = null;
  let clockTimerId = null;
  let cameraRefreshTimerId = null;
  let bannerRefreshTimerId = null;
  let pendingAlarmAction = null;
  let pendingAlarmTimerId = null;
  let pendingUnlockId = null;
  let pendingUnlockTimerId = null;
  let dailyForecast = [];
  let hourlyForecast = [];
  let weatherForecastLoading = false;
  let weatherForecastLoaded = false;
  let utilityView = "electric";
  let utilityHistory = [];
  let utilityHistoryLoading = false;
  let utilityHistoryTimerId = null;
  let overviewPriceView = "today";
  let stableMusicRender = null;
  let overviewPlayerExpanded = false;
  let lastOverviewPlaybackAt = 0;
  let overviewPlayerHideTimerId = null;
  let overviewPlayerDraggedUntil = 0;
  let bannerDraggedUntil = {};
  const printerImageCache = {}; // role -> { url, sourceId, lastFetchAt }
  // The printer's own built-in camera is an HA "image" entity (Bambu Lab's
  // integration, at least) -- HA has no live-stream proxy for that domain,
  // only entity_picture snapshots, so polling faster is the only lever
  // available for it. The optional "protect" override is a real "camera"
  // entity instead (e.g. a UniFi Protect camera pointed at the printer),
  // which genuinely can stream -- see printerLiveCamera()/activeBanners()
  // below, which use BeastCameras.resolveCamera() for that role instead of
  // this snapshot cache.
  const PRINTER_IMAGE_REFRESH_MS = 2000;
  function bannerPositionKey(type) { return `beast_banner_position_${type}_v1`; }
  // Edit-mode state (draft cards, is-editing) now lives inside the
  // BeastCardEditor instance created in init() -- see
  // js/ha-smartdash-card-editor.js.
  let overviewCardEditor = null;
  let contextualFocusTimerId = null;
  let motionFocusSlug = null;
  let mobileFeaturedCameraSlug = null;
  let lastCameraRenderSignature = null;
  let motionFocusTimerId = null;
  const OVERVIEW_PLAYER_IDLE_HIDE_MS = 120000;
  const OVERVIEW_PLAYER_POSITION_KEY = "beast_overview_player_position_v1";
  const OVERVIEW_PLAYER_ENABLED_KEY = "beast_overview_player_enabled_v1";

  function isFloatingPlayerEnabled() {
    return localStorage.getItem(OVERVIEW_PLAYER_ENABLED_KEY) !== "0";
  }

  function setFloatingPlayerEnabled(enabled) {
    localStorage.setItem(OVERVIEW_PLAYER_ENABLED_KEY, enabled ? "1" : "0");
    document.dispatchEvent(new CustomEvent("beast:overview-player-setting-changed"));
  }

  function callService(domain, service, entityId, data = {}) {
    return BeastAuth.haFetch(`/api/services/${domain}/${service}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_id: entityId, ...data })
    }).catch((error) => BeastCore.log(`Oversigt: kommando fejlede (${error.message}).`));
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function savedOverviewPlayerPosition() {
    try {
      const value = JSON.parse(localStorage.getItem(OVERVIEW_PLAYER_POSITION_KEY) || "null");
      return Number.isFinite(value?.x) && Number.isFinite(value?.y) ? value : null;
    } catch (error) {
      return null;
    }
  }

  function positionOverviewPlayer(host, position = savedOverviewPlayerPosition()) {
    if (!position || !host.classList.contains("beast-ov-clock-music")) return;
    const rect = host.getBoundingClientRect();
    const edge = 12;
    const x = Math.max(edge, Math.min(window.innerWidth - rect.width - edge, position.x));
    // Controls unfold on hover/tap. Reserve their full height while clamping so
    // a saved position near the bottom never lets the buttons leave the screen.
    const expandedHeight = rect.height + (host.classList.contains("is-expanded") ? 0 : 58);
    const y = Math.max(edge, Math.min(window.innerHeight - expandedHeight - edge, position.y));
    host.style.left = `${x}px`;
    host.style.top = `${y}px`;
    host.style.bottom = "auto";
    host.style.transform = "none";
    host.classList.add("has-custom-position");
  }

  function wireOverviewPlayerDrag(host) {
    positionOverviewPlayer(host);
    if (host.dataset.dragWired === "true") return;
    host.dataset.dragWired = "true";
    let drag = null;
    host.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      if (!event.target.closest(".beast-ov-music-drag")) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = host.getBoundingClientRect();
      drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: rect.left, y: rect.top, moved: false };
      host.setPointerCapture?.(event.pointerId);
      host.classList.add("is-dragging");
    });
    host.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 8) return;
      drag.moved = true;
      event.preventDefault();
      positionOverviewPlayer(host, { x: drag.x + dx, y: drag.y + dy });
    });
    const finishDrag = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      host.releasePointerCapture?.(event.pointerId);
      host.classList.remove("is-dragging");
      if (drag.moved) {
        const rect = host.getBoundingClientRect();
        localStorage.setItem(OVERVIEW_PLAYER_POSITION_KEY, JSON.stringify({ x: Math.round(rect.left), y: Math.round(rect.top) }));
        overviewPlayerDraggedUntil = Date.now() + 450;
      }
      drag = null;
    };
    host.addEventListener("pointerup", finishDrag);
    host.addEventListener("pointercancel", finishDrag);
    window.addEventListener("resize", () => positionOverviewPlayer(host));
  }

  function validPosition(value) {
    return Number.isFinite(value?.x) && Number.isFinite(value?.y) ? value : null;
  }

  // Positions live in BeastConfig (server-side) so they're the same on
  // every browser/device and survive a browser's local storage being
  // cleared -- previously each browser tracked its own position in
  // localStorage, which reset the instant the banner was opened somewhere
  // new. Older saved positions from that localStorage-only era are
  // migrated in transparently the first time they're read.
  // configKey is the path under "banners." holding this position -- either
  // "positions.<type>" for an individually-dragged banner, or
  // "groupPosition" for the single combined card used in stacked layout
  // mode. Legacy per-browser localStorage migration only ever applies to
  // the former (the combined card is new and never had a localStorage era).
  function savedBannerPosition(configKey) {
    const stored = validPosition(BeastConfig.get(`banners.${configKey}`));
    if (stored) return stored;
    const legacyType = configKey.startsWith("positions.") ? configKey.slice("positions.".length) : null;
    if (!legacyType) return null;
    try {
      const legacy = validPosition(JSON.parse(localStorage.getItem(bannerPositionKey(legacyType)) || "null"));
      if (legacy) {
        saveBannerPosition(configKey, legacy);
        localStorage.removeItem(bannerPositionKey(legacyType));
        return legacy;
      }
    } catch (error) { /* ignore malformed legacy value */ }
    return null;
  }

  function saveBannerPosition(configKey, position) {
    BeastConfig.set(`banners.${configKey}`, position);
  }

  function applyBannerPosition(host, position) {
    const rect = host.getBoundingClientRect();
    const edge = 12;
    const x = Math.max(edge, Math.min(window.innerWidth - rect.width - edge, position.x));
    const y = Math.max(edge, Math.min(window.innerHeight - rect.height - edge, position.y));
    host.style.left = `${x}px`;
    host.style.top = `${y}px`;
    host.style.transform = "none";
    host.classList.add("has-custom-position");
  }

  // Multiple banners can be visible at once now; each remembers its own
  // dragged position independently (keyed by type). This only ever applies
  // a *saved* (dragged) position -- the undragged default stack is handled
  // separately by stackDefaultBanners(), once every visible banner's real
  // content/height is in the DOM, so banners of different heights (e.g. the
  // compact doors banner vs. the taller image banners) sit flush against
  // each other instead of leaving a gap sized for the tallest one.
  function positionBanner(host, configKey) {
    const saved = savedBannerPosition(configKey);
    if (saved) applyBannerPosition(host, saved);
  }

  // Stacks every banner that hasn't been individually dragged directly
  // beneath the previous one, using each one's actual measured height --
  // "hænger sammen" (stick together) rather than fixed-size slots.
  //
  // renderBanners() calls this on every render (a printer's progress
  // percentage ticking every few seconds, for instance), so writing
  // style.top/left/transform unconditionally meant a banner containing a
  // live camera got its position "changed" to the exact same value over
  // and over. That's enough to make some browsers (kiosk/embedded ones
  // especially) treat the box as having moved and briefly reset the
  // video's decode surface -- which is what actually read as the camera
  // flickering to black, not anything about the stream or the iframe
  // itself. Only touching the DOM when a value has genuinely changed
  // avoids that churn; the height read (needed to stack the *next* banner
  // correctly) still has to happen every time, since text content -- and
  // so a banner's height -- can change independently of its position.
  function stackDefaultBanners(container, banners) {
    let top = 12;
    banners.forEach((banner) => {
      const host = container.querySelector(`[data-banner-type="${banner.type}"]`);
      if (!host || host.classList.contains("has-custom-position")) return;
      if (host.style.left !== "") host.style.left = "";
      if (host.style.transform !== "") host.style.transform = "";
      const nextTop = `${top}px`;
      if (host.style.top !== nextTop) host.style.top = nextTop;
      top += host.getBoundingClientRect().height + 12;
    });
  }

  function wireBannerDrag(host, configKey) {
    positionBanner(host, configKey);
    if (host.dataset.dragWired === "true") return;
    host.dataset.dragWired = "true";
    let drag = null;
    host.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      if (!event.target.closest(".beast-ov-mail-banner-drag")) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = host.getBoundingClientRect();
      drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: rect.left, y: rect.top, moved: false };
      host.setPointerCapture?.(event.pointerId);
      host.classList.add("is-dragging");
    });
    host.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 8) return;
      drag.moved = true;
      event.preventDefault();
      applyBannerPosition(host, { x: drag.x + dx, y: drag.y + dy });
    });
    const finishDrag = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      host.releasePointerCapture?.(event.pointerId);
      host.classList.remove("is-dragging");
      if (drag.moved) {
        const rect = host.getBoundingClientRect();
        saveBannerPosition(configKey, { x: Math.round(rect.left), y: Math.round(rect.top) });
        bannerDraggedUntil[configKey] = Date.now() + 450;
      }
      drag = null;
    };
    host.addEventListener("pointerup", finishDrag);
    host.addEventListener("pointercancel", finishDrag);
  }

  function renderClock() {
    const host = document.getElementById("beastOvClock");
    if (!host) return;
    const now = new Date();
    const h = String(now.getHours()).padStart(2, "0");
    const m = String(now.getMinutes()).padStart(2, "0");
    const wasteConfig = BeastConfig.get("panels.waste") || {};
    const configuredCalendarIds = Array.isArray(wasteConfig.calendars) ? wasteConfig.calendars.filter(Boolean) : [];
    // Empty selection keeps today's behavior (every calendar entity) so
    // installs that never touched this setting see no change -- once a
    // household picks specific calendars, only those are shown.
    const calendarItems = Array.from(BeastHaSocket.getAllStates().values())
      .filter((state) => state.entity_id.startsWith("calendar.") && state.attributes.start_time && state.attributes.message)
      .filter((state) => !configuredCalendarIds.length || configuredCalendarIds.includes(state.entity_id))
      .map((state) => ({ label: state.attributes.message, date: new Date(state.attributes.start_time) }))
      .filter((item) => !Number.isNaN(item.date.getTime()) && item.date.getTime() >= Date.now() - 3600000)
      .sort((a, b) => a.date - b.date);
    const wasteItems = getWasteItems();
    const nextWaste = wasteItems[0];
    // The two tiles under the planner are independently configurable
    // (Administration -> Forside -> Ur-widgets) -- each can show car, pool,
    // robots or 3D-printer status, or be turned off, using the exact same
    // entity/label/icon lookup the top-level generic overview cards use
    // (genericWidgetDefinitions()) so both stay in sync automatically.
    const quickTileDefs = genericWidgetDefinitions();
    const quickTileTypes = (Array.isArray(BeastConfig.get("overviewQuickTiles")) ? BeastConfig.get("overviewQuickTiles") : [])
      .filter((type) => quickTileDefs[type])
      .slice(0, 2);
    const quickTileHtml = quickTileTypes.map((type) => {
      const def = quickTileDefs[type];
      const state = BeastHaSocket.getState(def.entity);
      const unavailable = !state || ["unknown", "unavailable"].includes(state.state);
      return `
          <button type="button" class="beast-ov-car-compact" data-quick-tile="${type}">
            <span class="beast-ov-car-icon">${BeastCore.icon(def.icon, { size: 19 })}</span>
            <span><b>${escapeHtml(def.label)}</b><small>${escapeHtml(def.detail)}</small></span>
            <strong>${escapeHtml(unavailable ? "–" : `${state.state}${def.suffix}`)}</strong>
          </button>`;
    }).join("");
    // Both sections are optional (Administration -> Kalender & affald --
    // not every household has a calendar and a waste-collection sensor set
    // up) -- when only one is on, "has-single-section" lets it expand to
    // fill the space the other would have used instead of leaving a gap.
    const showCalendarCard = wasteConfig.showCalendarCard !== false;
    const showWasteCard = wasteConfig.showWasteCard !== false;
    const visibleSectionCount = (showCalendarCard ? 1 : 0) + (showWasteCard ? 1 : 0);
    const calendarSectionHtml = showCalendarCard ? `
          <section class="beast-ov-planner-section">
            <div class="beast-ov-planner-title">${BeastCore.icon("calendar", { size: 14 })}<span>Næste aftaler</span></div>
            <div class="beast-ov-calendar-list">
              ${calendarItems.slice(0, 4).map((item) => `
                <div class="beast-ov-calendar-item">
                  <span>${escapeHtml(formatCompactDate(item.date))}</span>
                  <b>${escapeHtml(item.label)}</b>
                </div>
              `).join("") || `<div class="beast-ov-planner-empty">Ingen kommende aftaler</div>`}
            </div>
          </section>` : "";
    const wasteSectionHtml = showWasteCard ? `
          <section class="beast-ov-planner-section beast-ov-waste-section">
            <div class="beast-ov-planner-title">${BeastCore.icon("grid", { size: 14 })}<span>Affald</span></div>
            ${nextWaste ? `
              <div class="beast-ov-waste-next">
                <div><b>${escapeHtml(nextWaste.name)}</b><span>Næste afhentning</span></div>
                <strong>${nextWaste.days === 0 ? "I dag" : nextWaste.days}<small>${nextWaste.days === 0 ? "afhentes" : (nextWaste.days === 1 ? "dag" : "dage")}</small></strong>
              </div>
            ` : `<div class="beast-ov-planner-empty">Ingen afhentning fundet</div>`}
          </section>` : "";
    host.innerHTML = `
      <div class="beast-ov-fill">
        <div class="beast-ov-clock-time">${h}<span class="beast-ov-clock-colon">:</span>${m}</div>
        <div class="beast-ov-clock-date">${escapeHtml(BeastCore.formatDate(now))}</div>
        <div class="beast-ov-clock-planner${visibleSectionCount === 1 ? " has-single-section" : ""}"${visibleSectionCount ? "" : " hidden"}>
          ${calendarSectionHtml}${wasteSectionHtml}
        </div>
        <div class="beast-ov-home-quick"${quickTileTypes.length ? "" : " hidden"}>${quickTileHtml}
        </div>
      </div>
    `;
    const fitCalendarItems = () => {
      const fill = host.querySelector(".beast-ov-fill");
      const items = Array.from(host.querySelectorAll(".beast-ov-calendar-item"));
      if (!fill || !items.length) return;
      items.forEach((item) => { item.hidden = false; });
      let visible = items.length;
      while (visible > 1 && fill.scrollHeight > fill.clientHeight + 1) {
        items[--visible].hidden = true;
      }
    };
    host._beastFitCalendarItems = fitCalendarItems;
    requestAnimationFrame(host._beastFitCalendarItems);
    if (!host._beastCalendarResizeObserver && window.ResizeObserver) {
      host._beastCalendarResizeObserver = new ResizeObserver(() => requestAnimationFrame(host._beastFitCalendarItems));
      host._beastCalendarResizeObserver.observe(host);
    }
    host.querySelectorAll("[data-quick-tile]").forEach((tile) => {
      tile.addEventListener("click", (event) => {
        event.stopPropagation();
        document.querySelector(`.beast-rail-btn[data-section="${tile.dataset.quickTile}"]`)?.click();
      });
    });
    renderMusic();
  }

  function validText(value) {
    return typeof value === "string" && !["unknown", "unavailable", ""].includes(value) ? value : null;
  }

  // Mirrors app.js's isNightScreenPeriod() window logic (handles a range
  // that wraps past midnight, e.g. 22:00-06:00) but keyed to its own
  // start/end pair rather than the screensaver's.
  function isWithinBannerSchedule(startTime, endTime) {
    const minutes = new Date().getHours() * 60 + new Date().getMinutes();
    const start = parseTimeToMinutes(startTime, 22 * 60);
    const end = parseTimeToMinutes(endTime, 6 * 60);
    if (start === end) return true;
    if (start > end) return minutes >= start || minutes < end;
    return minutes >= start && minutes < end;
  }

  function mailImages() {
    return {
      indkorsel: validText(BeastHaSocket.getState(MAIL_IMAGE_ID)?.state),
      carport: validText(BeastHaSocket.getState(MAIL_IMAGE_CARPORT_ID)?.state),
      forhaven: validText(BeastHaSocket.getState(MAIL_IMAGE_FORHAVEN_ID)?.state)
    };
  }

  // This used to be a shared "attention system" mixing in open/unlocked
  // doors, triggered alarms, high power price/usage, and camera-recovery --
  // all of that is already visible on the Security/Energy/Cameras cards, and
  // mixing it in here just meant the post banner sometimes got replaced by
  // something else entirely, which defeated the point of a banner you can
  // glance at and immediately know it's about the mailbox. This is now
  // post-only, on purpose.
  // Both the printer's own built-in camera and an optional external camera
  // (e.g. a Protect camera pointed at the printer) can be shown and
  // switched between, mirroring the mail banner's multi-camera switcher --
  // each is fetched/cached independently under its own role so having one
  // configured doesn't block or evict the other.
  function refreshPrinterImageRole(role, entityId) {
    if (!entityId) { delete printerImageCache[role]; return; }
    const cache = printerImageCache[role] || (printerImageCache[role] = { url: null, sourceId: null, lastFetchAt: 0 });
    if (entityId !== cache.sourceId) {
      if (cache.url) URL.revokeObjectURL(cache.url);
      cache.url = null;
      cache.sourceId = entityId;
      cache.lastFetchAt = 0;
    }
    const path = BeastHaSocket.getState(entityId)?.attributes?.entity_picture;
    if (!path) return;
    const now = Date.now();
    if (cache.url && now - cache.lastFetchAt < PRINTER_IMAGE_REFRESH_MS) return;
    cache.lastFetchAt = now;
    BeastAuth.haFetchBlob(path).then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      if (cache.url) URL.revokeObjectURL(cache.url);
      cache.url = objectUrl;
      renderBanners();
    }).catch(() => {});
  }

  // Resolves the optional external "protect" camera into a real live
  // camera object (go2rtc WebRTC if available, otherwise HA's own
  // authenticated MJPEG camera_proxy_stream -- see cameraInfoFor() in
  // ha-smartdash-cameras.js) instead of the periodic-snapshot approach the
  // printer's own built-in camera is stuck with.
  //
  // go2rtc stream names are auto-matched from the camera entity's own id
  // (see go2rtcVariantsForCamera() in ha-smartdash-cameras.js), which
  // doesn't always line up -- the dedicated Printer page already has a
  // manual override for exactly this (panels.printer.liveStream, "a raw
  // go2rtc stream name typed by hand ... only if the camera can't be
  // selected above"). Reusing that same override here (via
  // resolvedStreamName, which sharedCameraMarkup() already prefers over
  // streamName for per-camera quality overrides) means the banner gets the
  // same real low-latency stream the Printer page uses, instead of falling
  // back to HA's own slower proxy stream whenever auto-matching misses.
  // Sticky across a single missed resolve (see printerLiveCamera() below) --
  // BeastHaSocket.getState() briefly returning nothing for this entity
  // (a reconnect, a slow state update, ...) must not read as "the camera
  // is gone now" and tear the live iframe down, only to rebuild it (and
  // pay the WebRTC handshake all over again) the moment the next render
  // resolves it fine again. That rebuild-reconnect cycle is what reads as
  // flickering between a live picture and a black frame.
  let lastGoodPrinterLiveCamera = null;

  function printerLiveCamera() {
    if (!PRINTER_BANNER_CAMERA_ID) return (lastGoodPrinterLiveCamera = null);
    const camera = window.BeastCameras?.resolveCamera(PRINTER_BANNER_CAMERA_ID);
    if (!camera) return lastGoodPrinterLiveCamera;
    if (!camera.streamName) {
      const manualStream = String(BeastConfig.get("panels.printer.liveStream") || "").trim();
      if (manualStream) return (lastGoodPrinterLiveCamera = { ...camera, resolvedStreamName: manualStream });
    }
    return (lastGoodPrinterLiveCamera = camera);
  }

  function printerImages() {
    refreshPrinterImageRole("protect", PRINTER_BANNER_CAMERA_ID);
    refreshPrinterImageRole("indbygget", PRINTER_CAMERA_IMAGE_ID);
    return {
      protect: printerImageCache.protect?.url || null,
      indbygget: printerImageCache.indbygget?.url || null
    };
  }

  // Same "background-fetch into a cache, activeBanners() just reads the
  // cache synchronously" shape as printerImages() above -- a calendar's own
  // state doesn't expose "is anything starting soon" the way a sensor
  // state does, so this has to actually fetch upcoming events. Checked at
  // most once a minute; only triggers a re-render when the result changes,
  // so an idle screen isn't redrawn every minute for no reason.
  const aulaLessonCache = { checkedAt: 0, key: "", lessons: [] };
  const AULA_LESSON_CHECK_MS = 60000;

  async function refreshAulaLessonCache() {
    const calendarIds = BeastConfig.get("panels.waste.scheduleCalendars") || [];
    if (!calendarIds.length) { aulaLessonCache.lessons = []; return; }
    const now = Date.now();
    if (now - aulaLessonCache.checkedAt < AULA_LESSON_CHECK_MS) return;
    aulaLessonCache.checkedAt = now;
    const windowEndMs = now + AULA_LESSON_MINUTES * 60000;
    const results = await Promise.all(calendarIds.map(async (id) => {
      try {
        const events = await BeastAuth.haFetch(`/api/calendars/${id}?start=${new Date(now).toISOString()}&end=${new Date(windowEndMs).toISOString()}`);
        // Co-taught periods are separate same-time events (see waste.js) --
        // merge per calendar so a two-teacher lesson doesn't produce two
        // near-duplicate banner rows.
        return window.BeastScheduleSubjects?.mergeEvents(events || []) || [];
      } catch (error) {
        return [];
      }
    }));
    const upcoming = results.flat().filter((lesson) => {
      const startMs = new Date(lesson.start).getTime();
      return Number.isFinite(startMs) && startMs >= now && startMs <= windowEndMs;
    }).sort((a, b) => new Date(a.start) - new Date(b.start));
    const key = upcoming.map((lesson) => `${lesson.start}|${lesson.subject}`).join(",");
    if (key !== aulaLessonCache.key) {
      aulaLessonCache.key = key;
      aulaLessonCache.lessons = upcoming;
      renderBanners();
    }
  }

  function aulaLessons() {
    refreshAulaLessonCache();
    return aulaLessonCache.lessons;
  }

  const PRINTER_ACTIVE_STATES = ["running", "prepare", "slicing", "pause"];
  // A print-status sensor briefly reporting something outside
  // PRINTER_ACTIVE_STATES (an "unavailable" blip, a slow MQTT update, ...)
  // must not immediately drop the banner -- renderBanners() removes and
  // fully recreates a banner's host the moment it stops being in the
  // active list, which tears the live camera iframe down and pays the
  // WebRTC handshake all over again on the next blip back to "running".
  // That teardown/rebuild cycle is what reads as the banner's camera
  // flickering to black, even though printerLiveCamera()'s own
  // last-known-good guard already keeps the *photo* stable across a
  // renderBanners() call that still has the banner present. Grace period
  // is generous (a real "print finished" should still clear promptly, but
  // sensors momentarily going unavailable is common enough on a home
  // network to be worth riding out).
  const PRINTER_STATUS_GRACE_MS = 20000;
  let printerLastActiveStatus = null;
  let printerLastActiveAt = 0;
  // When the *current* print started, as opposed to printerLastActiveAt
  // (touched on every active tick, used only for the grace window above).
  // Reset exclusively on a genuine fresh start -- the gap since the last
  // active tick exceeded the grace window -- never on a brief status blip
  // mid-print. This is what "hide until the next print starts" (see the
  // snooze menu) actually watches: banner.occurrenceKey below.
  let printerActiveSince = 0;

  // Each banner type is independent: its own on/off toggle, its own trigger
  // condition, its own data. Multiple can be active and visible at once
  // (unlike the old single shared "top priority wins" attention system) --
  // see renderBanners() for how each gets its own draggable card.
  function activeBanners() {
    const banners = [];

    if (featureEnabled("postBanner") && BeastHaSocket.getState(MAIL_PRESENT_ID)?.state === "on") {
      const mailCount = Number(BeastHaSocket.getState(MAIL_COUNT_ID)?.state);
      const mailDescription = validText(BeastHaSocket.getState(MAIL_DESCRIPTION_ID)?.state);
      const images = mailImages();
      banners.push({
        type: "mail", title: "Der er post",
        detail: mailDescription || (Number.isFinite(mailCount) && mailCount > 0 ? `${mailCount} registreringer` : "Post registreret"),
        icon: "bell", image: images.indkorsel, images,
        // Identifies this particular delivery: the sensor only goes back to
        // "on" for a genuinely new one, so its own last_changed is a stable
        // key for "hide until the next delivery" (see snoozeUntilEvent()).
        occurrenceKey: BeastHaSocket.getState(MAIL_PRESENT_ID)?.last_changed || "",
        occurrenceLabel: "Indtil næste post"
      });
    }

    if (featureEnabled("printerBanner") && PRINTER_STATUS_ID) {
      const status = BeastHaSocket.getState(PRINTER_STATUS_ID)?.state;
      const isActiveNow = PRINTER_ACTIVE_STATES.includes(status);
      if (isActiveNow) {
        if (!printerLastActiveAt || Date.now() - printerLastActiveAt > PRINTER_STATUS_GRACE_MS) printerActiveSince = Date.now();
        printerLastActiveStatus = status; printerLastActiveAt = Date.now();
      }
      const withinGrace = !isActiveNow && printerLastActiveAt && Date.now() - printerLastActiveAt < PRINTER_STATUS_GRACE_MS;
      // Debug-only preview hook: ?forcePrinterBanner=1 shows the banner (and
      // its real camera, if one is configured) regardless of the printer's
      // actual status -- for checking the banner/camera itself without
      // waiting for or starting a real print. No query param -> normal
      // behavior, untouched.
      const forced = (() => { try { return new URLSearchParams(window.location.search).get("forcePrinterBanner") === "1"; } catch (_) { return false; } })();
      if (isActiveNow || withinGrace || forced) {
        const effectiveStatus = isActiveNow ? status : printerLastActiveStatus;
        const images = printerImages();
        const progress = Number(BeastHaSocket.getState(PRINTER_PROGRESS_ID)?.state);
        const remaining = Number(BeastHaSocket.getState(PRINTER_REMAINING_ID)?.state);
        const task = validText(BeastHaSocket.getState(PRINTER_TASK_ID)?.state);
        const progressLabel = Number.isFinite(progress) ? `${Math.round(progress)}%` : "";
        banners.push({
          type: "printer", title: effectiveStatus === "pause" ? "Printer på pause" : "Printer kører",
          detail: [progressLabel, task].filter(Boolean).join(" · ") || "Ingen data endnu",
          icon: "printer", image: images.protect || images.indbygget, images,
          liveCamera: printerLiveCamera(),
          progress: Number.isFinite(progress) ? progress : null,
          remaining: Number.isFinite(remaining) ? remaining : null,
          task,
          occurrenceKey: String(printerActiveSince),
          occurrenceLabel: "Indtil næste print"
        });
      }
    }

    if (featureEnabled("doorBanner")) {
      const thresholdMs = Math.max(1, Number(BeastConfig.get("banners.doorOpenTooLongMinutes")) || 15) * 60000;
      const now = Date.now();
      const tooLong = (state) => {
        const changedAt = new Date(state?.last_changed || 0).getTime();
        return Number.isFinite(changedAt) && now - changedAt >= thresholdMs;
      };
      const scheduleOk = !BeastConfig.get("banners.scheduleEnabled") ||
        isWithinBannerSchedule(BeastConfig.get("banners.scheduleStart"), BeastConfig.get("banners.scheduleEnd"));
      const openEntries = scheduleOk ? DOOR_IDS.map((id) => {
        const state = BeastHaSocket.getState(id);
        if (state?.state !== "on" || !tooLong(state)) return null;
        return { key: `${id}@${state.last_changed}`, label: `${BeastEntityPicker.friendlyName(id)} — åben` };
      }).filter(Boolean) : [];
      const unlockedEntries = scheduleOk ? LOCKS.map((entry) => {
        const state = BeastHaSocket.getState(entry.id);
        const value = state?.state;
        if (!value || ["locked", "unknown", "unavailable"].includes(value) || !tooLong(state)) return null;
        return { key: `${entry.id}@${state.last_changed}`, label: `${entry.label} — ulåst` };
      }).filter(Boolean) : [];
      const entries = [...openEntries, ...unlockedEntries];
      if (entries.length) {
        const rows = entries.map((entry) => entry.label);
        banners.push({
          type: "doors", title: `${rows.length} ${rows.length === 1 ? "indgang har" : "indgange har"} stået åbne/ulåste længe`,
          detail: rows.join(" · "), icon: "unlock", image: null, rows, compact: true,
          // Reopening a door (or unlocking again) after it was closed
          // produces a new last_changed and therefore a new key, so a
          // snooze doesn't also swallow the next, unrelated time it happens.
          occurrenceKey: entries.map((entry) => entry.key).sort().join("|"),
          occurrenceLabel: "Indtil næste hændelse"
        });
      }
    }

    if (featureEnabled("aulaMessageBanner") && AULA_MESSAGE_ID && BeastHaSocket.getState(AULA_MESSAGE_ID)?.state === "on") {
      const state = BeastHaSocket.getState(AULA_MESSAGE_ID);
      const subject = validText(state?.attributes?.subject);
      const sender = validText(state?.attributes?.sender);
      banners.push({
        type: "aulaMessage", title: "Ny AULA-besked",
        detail: [subject, sender ? `fra ${sender}` : ""].filter(Boolean).join(" · ") || "Ny besked i AULA",
        icon: "bell", image: null, compact: true
      });
    }

    if (featureEnabled("aulaLessonBanner")) {
      const lessons = aulaLessons();
      if (lessons.length) {
        const locale = window.HASmartdashI18n?.locale || "da-DK";
        const rows = lessons.map((lesson) => {
          const subject = window.BeastScheduleSubjects?.label(lesson.subject) || lesson.subject || "Ukendt fag";
          const teacher = lesson.teachers[0] || "";
          const time = new Date(lesson.start).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
          return `${time} · ${subject}${teacher ? ` — ${teacher}` : ""}`;
        });
        banners.push({
          type: "aulaLesson", title: lessons.length === 1 ? "Lektion starter snart" : `${lessons.length} lektioner starter snart`,
          detail: rows.join(" · "), icon: "calendar", image: null, rows, compact: true
        });
      }
    }

    return banners;
  }

  function snoozedNotifications() {
    try { return JSON.parse(localStorage.getItem(NOTIFICATION_SNOOZE_KEY) || "{}"); } catch (_) { return {}; }
  }

  function saveSnoozedNotifications(snoozed) {
    localStorage.setItem(NOTIFICATION_SNOOZE_KEY, JSON.stringify(snoozed));
  }

  // A snoozed entry is either { until: <timestamp> } (a fixed duration) or
  // { untilEvent: <occurrenceKey> } (hidden for as long as it's still the
  // same occurrence -- see occurrenceKey on each banner in activeBanners()).
  // Bare numbers are read the same as { until: n } for compatibility with
  // snoozes already saved in a browser from before this existed.
  function snoozeBanner(type, minutes = 30) {
    const snoozed = snoozedNotifications();
    snoozed[type] = { until: Date.now() + minutes * 60 * 1000 };
    saveSnoozedNotifications(snoozed);
  }

  function snoozeBannerUntilEvent(type, occurrenceKey) {
    const snoozed = snoozedNotifications();
    snoozed[type] = { untilEvent: occurrenceKey };
    saveSnoozedNotifications(snoozed);
  }

  function isBannerSnoozed(banner) {
    const entry = snoozedNotifications()[banner.type];
    if (entry === undefined || entry === null) return false;
    if (typeof entry === "number") return entry > Date.now();
    if (entry.until !== undefined) return entry.until > Date.now();
    if (entry.untilEvent !== undefined) return entry.untilEvent === banner.occurrenceKey;
    return false;
  }

  function visibleBanners() {
    return activeBanners().filter((banner) => !isBannerSnoozed(banner));
  }

  // Shared by all three banner popups (mail/printer/doors) so "hide" always
  // offers the same choice: three fixed durations, plus hiding until the
  // banner's own next occurrence -- next print, next delivery, next
  // door/lock event -- whichever applies to the banner it's attached to
  // (see occurrenceLabel/occurrenceKey in activeBanners()).
  function snoozeActionMarkup(banner) {
    return `<div class="beast-snooze-wrap" data-snooze-wrap>
      <button type="button" class="beast-btn" data-snooze-trigger aria-haspopup="true" aria-expanded="false">${BeastCore.icon("bell", { size: 16 })}<span>Skjul</span></button>
      <div class="beast-snooze-menu" data-snooze-menu hidden>
        <button type="button" data-snooze-minutes="15">15 minutter</button>
        <button type="button" data-snooze-minutes="30">30 minutter</button>
        <button type="button" data-snooze-minutes="60">1 time</button>
        ${banner.occurrenceKey ? `<button type="button" class="is-until-event" data-snooze-until-event>${escapeHtml(banner.occurrenceLabel || "Indtil næste hændelse")}</button>` : ""}
      </div>
    </div>`;
  }

  // `onSnoozed` closes the modal and re-renders the banners -- identical in
  // all three callers, but each owns its own overlay/close() so it's passed
  // in rather than assumed.
  function wireSnoozeMenu(root, banner, onSnoozed) {
    const wrap = root.querySelector("[data-snooze-wrap]");
    if (!wrap) return;
    const menu = wrap.querySelector("[data-snooze-menu]");
    const trigger = wrap.querySelector("[data-snooze-trigger]");
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      const next = menu.hidden;
      menu.hidden = !next;
      trigger.setAttribute("aria-expanded", String(next));
    });
    menu.querySelectorAll("[data-snooze-minutes]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      snoozeBanner(banner.type, Number(button.dataset.snoozeMinutes));
      onSnoozed();
    }));
    menu.querySelector("[data-snooze-until-event]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      snoozeBannerUntilEvent(banner.type, banner.occurrenceKey);
      onSnoozed();
    });
  }

  // Shared by both layout modes so mail/printer always get their real photo
  // at full size -- not a shrunk-down thumbnail -- whether they're their
  // own floating card or a row inside the combined one; only the wrapper
  // differs between the two modes, not what's inside it.
  // A live camera (currently only the printer banner's optional external
  // "protect" override -- see printerLiveCamera()) renders through the same
  // shared live-camera component the rest of the dashboard uses (WebRTC via
  // go2rtc, or HA's own authenticated MJPEG stream as a fallback) instead
  // of a periodically-refreshed still image. Returns null for a signature
  // that identifies non-live photos too (image URL, or "icon") -- used to
  // decide whether the photo element needs rebuilding at all (see
  // renderBanners()/renderCombinedBanner() below), since a live camera's
  // iframe/stream must not be torn down and recreated on every banner
  // re-render (progress ticking, etc.) or it never gets the chance to
  // actually play smoothly.
  function bannerPhotoMarkup(banner) {
    if (banner.compact) return { html: "", sig: "" };
    if (banner.image) return { html: `<img class="beast-ov-mail-banner-photo" src="${escapeHtml(banner.image)}" alt="">`, sig: `img:${banner.image}` };
    return { html: `<span class="beast-ov-mail-banner-icon">${BeastCore.icon(banner.icon, { size: 32 })}</span>`, sig: `icon:${banner.icon}` };
  }

  // Live cameras go through a dedicated path instead of bannerPhotoMarkup()'s
  // string diff: the string-sig guard should already stop the iframe from
  // being rebuilt when nothing changed, but it still showed a live-to-
  // white-flash flicker in practice, which only ever happens when the
  // <iframe> element itself gets torn down and a fresh one inserted (a
  // browser paints a blank white frame before a freshly-navigated iframe's
  // own page/background has loaded -- camera-player.html's own body is
  // black, so a *white* flash specifically means the element was recreated,
  // not that the stream inside an existing one hiccuped). Keeping exactly
  // one DOM node per camera identity alive here and only ever moving it
  // (appendChild on a node that's already in the document just relocates
  // it, never reloads it) removes even the possibility of that, regardless
  // of whatever was still triggering it in the string-based path.
  let printerLiveCameraEl = null;
  let printerLiveCameraSig = null;

  function ensurePrinterLiveCameraEl(camera) {
    const sig = `${camera.slug}:${camera.resolvedStreamName || camera.streamName || ""}`;
    // A cached element built before go2rtc's address was known would be the
    // Home Assistant MJPEG fallback (an <img>, not the WebRTC player's
    // <iframe>) -- and since the signature doesn't change when that address
    // later becomes available, it would otherwise stay the weaker transport
    // for the rest of the session. Rebuild once the real player is possible.
    const wantsIframe = window.BeastCameras.hasGo2rtc?.();
    const cachedIsIframe = Boolean(printerLiveCameraEl?.querySelector("iframe"));
    if (printerLiveCameraEl && printerLiveCameraSig === sig && (!wantsIframe || cachedIsIframe)) return printerLiveCameraEl;
    const wrap = document.createElement("div");
    wrap.innerHTML = window.BeastCameras.sharedCameraMarkup(camera, { className: "beast-ov-mail-banner-photo", label: false, motion: false });
    const el = wrap.firstElementChild;
    window.BeastCameras.wireSharedCameras(wrap, renderBanners);
    printerLiveCameraEl = el;
    printerLiveCameraSig = sig;
    return el;
  }

  function bannerTextMarkup(banner) {
    return banner.compact
      ? `<span class="beast-ov-mail-banner-icon-sm">${BeastCore.icon(banner.icon, { size: 18 })}</span>
        <div><strong>${escapeHtml(banner.title)}</strong><small>${escapeHtml(banner.detail)}</small></div>`
      : `<div><strong>${escapeHtml(banner.title)}</strong><small>${escapeHtml(banner.detail)}</small></div>`;
  }


  // Resize handles let a banner (or the combined card) be dragged wider
  // than its default -- width only, height/image aspect-ratio follows via
  // CSS. Never smaller than the CSS default (the minimum the user asked to
  // keep): clamping to defaultWidth, not 0, is what enforces that floor.
  //
  // Listeners are wired to `host` itself, not the resize handle span --
  // renderBanners() now re-renders host.innerHTML on a 30-second timer (see
  // init()), which would destroy and recreate the handle span mid-gesture
  // and silently end the drag if pointer capture/listeners lived there
  // instead. `host` itself is never destroyed (only its innerHTML), so
  // wiring at that level survives a re-render happening mid-drag -- the
  // exact same reasoning wireBannerDrag() already relies on. The
  // `dataset.resizeWired` guard means this only actually attaches once per
  // host; the saved-width reapplication above it still runs on every call
  // so a stored size keeps applying after content changes, but skips doing
  // so while a gesture is actively in progress so it can't fight the live
  // drag and snap back mid-motion.
  function wireBannerResize(host, configKey, defaultWidth) {
    if (host.dataset.resizing !== "true") {
      const saved = Number(BeastConfig.get(`banners.sizes.${configKey}`));
      if (Number.isFinite(saved) && saved > defaultWidth) host.style.width = `${saved}px`;
    }
    if (host.dataset.resizeWired === "true") return;
    host.dataset.resizeWired = "true";
    let resize = null;
    host.addEventListener("pointerdown", (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      if (!event.target.closest(".beast-ov-mail-banner-resize")) return;
      event.preventDefault();
      event.stopPropagation();
      resize = { pointerId: event.pointerId, startX: event.clientX, startWidth: host.getBoundingClientRect().width };
      host.setPointerCapture?.(event.pointerId);
      host.classList.add("is-resizing");
      host.dataset.resizing = "true";
    });
    host.addEventListener("pointermove", (event) => {
      if (!resize || event.pointerId !== resize.pointerId) return;
      const width = Math.max(defaultWidth, Math.round(resize.startWidth + (event.clientX - resize.startX)));
      host.style.width = `${width}px`;
      resize.pendingWidth = width;
    });
    const finish = (event) => {
      if (!resize || event.pointerId !== resize.pointerId) return;
      host.releasePointerCapture?.(event.pointerId);
      host.classList.remove("is-resizing");
      delete host.dataset.resizing;
      if (resize.pendingWidth !== undefined) {
        BeastConfig.set(`banners.sizes.${configKey}`, resize.pendingWidth);
        bannerDraggedUntil[configKey] = Date.now() + 400;
      }
      resize = null;
    };
    host.addEventListener("pointerup", finish);
    host.addEventListener("pointercancel", finish);
  }

  // In "stacked" layout mode every active banner renders as one row inside
  // a single shared card instead of each being its own independently
  // dragged floating card -- see renderCombinedBanner(). The two modes
  // never share DOM, so switching modes tears down whichever structure the
  // other mode left behind.
  function renderBanners() {
    const container = document.getElementById("beastOvBanners");
    if (!container) return;
    const banners = visibleBanners();
    if (BeastConfig.get("banners.layoutMode") === "stacked") {
      // ":scope >" is load-bearing. This exists to tear down the *other*
      // layout mode's leftovers -- its banner hosts, which are direct
      // children of the container. Without the direct-child restriction the
      // selector also matched this mode's own rows (renderCombinedBanner()
      // gives each row a data-banner-type too, nested inside
      // #beastOvBannerGroup), so every single render deleted and rebuilt
      // them. For a row holding a live camera that meant destroying and
      // recreating its <iframe> on every render -- the flicker to a blank
      // frame, on a stream that plays perfectly in the detail modal and on
      // the Printer page, both of which build their player exactly once.
      container.querySelectorAll(":scope > [data-banner-type]").forEach((el) => el.remove());
      renderCombinedBanner(container, banners);
      return;
    }
    container.querySelector("#beastOvBannerGroup")?.remove();
    const activeTypes = new Set(banners.map((banner) => banner.type));
    container.querySelectorAll("[data-banner-type]").forEach((el) => {
      if (!activeTypes.has(el.dataset.bannerType)) el.remove();
    });
    banners.forEach((banner) => {
      let host = container.querySelector(`[data-banner-type="${banner.type}"]`);
      const isNew = !host;
      if (isNew) {
        host = document.createElement("div");
        host.className = "beast-ov-mail-banner";
        host.dataset.bannerType = banner.type;
        host.innerHTML = `
          <span class="beast-ov-mail-banner-drag" aria-hidden="true"></span>
          <div class="beast-ov-mail-banner-photo-slot"></div>
          <span class="beast-ov-mail-banner-resize" aria-hidden="true"></span>
        `;
        container.appendChild(host);
        // Same reason as the combined layout's rows below: the host persists
        // across renders now, so the handler must read the element's current
        // banner instead of the one captured when it was created.
        host.onclick = (event) => {
          event.stopPropagation();
          if (Date.now() < (bannerDraggedUntil[`positions.${banner.type}`] || 0)) return;
          if (host._beastBanner) openBannerDetail(host._beastBanner);
        };
        wireBannerDrag(host, `positions.${banner.type}`);
        wireBannerResize(host, banner.type, 230);
      }
      host._beastBanner = banner;
      host.classList.toggle("has-image", Boolean(banner.image));
      host.classList.toggle("is-compact", Boolean(banner.compact));
      updateBannerHostBody(host, banner);
    });
    stackDefaultBanners(container, banners);
  }

  // Rebuilds a banner host's photo (only when its identity actually
  // changed -- see bannerPhotoMarkup()) and text separately, instead of
  // replacing the whole innerHTML on every call. A live camera's iframe
  // must survive re-renders triggered by unrelated state changes (a
  // printer's progress percentage ticking up every few seconds, for
  // instance) or it never gets to actually stream smoothly -- this is the
  // same problem, and the same fix, as renderCameras()'s render-signature
  // guard elsewhere in this file.
  function updateBannerHostBody(host, banner) {
    const photo = bannerPhotoMarkup(banner);
    let slot = host.querySelector(":scope > .beast-ov-mail-banner-photo-slot");
    if (!slot) {
      slot = document.createElement("div");
      slot.className = "beast-ov-mail-banner-photo-slot";
      const dragHandle = host.querySelector(":scope > .beast-ov-mail-banner-drag");
      if (dragHandle) dragHandle.insertAdjacentElement("afterend", slot);
      else host.prepend(slot);
    }
    if (banner.liveCamera && window.BeastCameras) {
      const el = ensurePrinterLiveCameraEl(banner.liveCamera);
      if (slot.firstElementChild !== el) {
        slot.innerHTML = "";
        slot.appendChild(el);
      }
      slot.dataset.photoSig = `node:${printerLiveCameraSig}`;
    } else if (slot.dataset.photoSig !== photo.sig) {
      slot.dataset.photoSig = photo.sig;
      slot.innerHTML = photo.html;
    }
    let textEl = host.querySelector(":scope > .beast-ov-mail-banner-text, :scope > .beast-ov-mail-banner-row");
    const textHtml = bannerTextMarkup(banner);
    const wantsRow = Boolean(banner.compact);
    if (!textEl || (wantsRow && !textEl.classList.contains("beast-ov-mail-banner-row")) || (!wantsRow && !textEl.classList.contains("beast-ov-mail-banner-text"))) {
      textEl?.remove();
      textEl = document.createElement("div");
      textEl.className = wantsRow ? "beast-ov-mail-banner-row" : "beast-ov-mail-banner-text";
      const resizeHandle = host.querySelector(":scope > .beast-ov-mail-banner-resize");
      if (resizeHandle) resizeHandle.insertAdjacentElement("beforebegin", textEl);
      else host.appendChild(textEl);
    }
    textEl.innerHTML = textHtml;
  }

  // Combined-card layout: every active banner is a row stacked inside one
  // shared card instead of its own separate floating card. Each row keeps
  // its own full-size body (mail/printer still get their real photo, not a
  // shrunk-down thumbnail -- the whole point of a photo alert is being able
  // to actually see it) via the same updateBannerHostBody() the separate-
  // card layout uses; doors' own compact row is unchanged since it never
  // had a photo. Each row still opens its own existing type-specific modal on
  // click; only one shared drag handle, resize handle, and saved position
  // (banners.groupPosition/banners.sizes.group) cover the whole card.
  function renderCombinedBanner(container, banners) {
    if (!banners.length) {
      container.querySelector("#beastOvBannerGroup")?.remove();
      return;
    }
    let host = container.querySelector("#beastOvBannerGroup");
    if (!host) {
      host = document.createElement("div");
      host.id = "beastOvBannerGroup";
      host.className = "beast-ov-mail-banner beast-ov-mail-banner-group";
      host.innerHTML = `
        <span class="beast-ov-mail-banner-drag" aria-hidden="true"></span>
        <span class="beast-ov-mail-banner-resize" aria-hidden="true"></span>
      `;
      container.appendChild(host);
      wireBannerDrag(host, "groupPosition");
      wireBannerResize(host, "group", 260);
    }
    const resizeHandle = host.querySelector(":scope > .beast-ov-mail-banner-resize");
    const activeTypes = new Set(banners.map((banner) => banner.type));
    host.querySelectorAll(":scope > .beast-ov-mail-banner-group-item").forEach((row) => {
      if (!activeTypes.has(row.dataset.bannerType)) row.remove();
    });
    banners.forEach((banner) => {
      let row = host.querySelector(`:scope > .beast-ov-mail-banner-group-item[data-banner-type="${banner.type}"]`);
      if (!row) {
        row = document.createElement("div");
        row.dataset.bannerType = banner.type;
        resizeHandle ? resizeHandle.insertAdjacentElement("beforebegin", row) : host.appendChild(row);
        // Reads the banner off the element rather than closing over the one
        // that happened to exist when the row was first created. Rows now
        // persist across renders (so a live camera's iframe survives), which
        // means a captured banner would stay frozen at its first-render
        // contents -- for the printer that's before its camera images have
        // finished loading, so opening the detail modal showed nothing at
        // all. The element's latest banner is always current.
        row.onclick = (event) => {
          event.stopPropagation();
          if (Date.now() < (bannerDraggedUntil.groupPosition || 0)) return;
          if (row._beastBanner) openBannerDetail(row._beastBanner);
        };
      }
      row._beastBanner = banner;
      const nextClassName = `beast-ov-mail-banner-group-item${banner.compact ? " is-compact" : ""}`;
      if (row.className !== nextClassName) row.className = nextClassName;
      updateBannerHostBody(row, banner);
    });
  }

  function openBannerDetail(banner) {
    if (banner.type === "mail") return openMailDetail(banner);
    if (banner.type === "printer") return openPrinterDetail(banner);
    if (banner.type === "doors") return openDoorsDetail(banner);
  }

  function snoozeBanner(type) {
    const snoozed = snoozedNotifications();
    snoozed[type] = Date.now() + 30 * 60 * 1000;
    localStorage.setItem(NOTIFICATION_SNOOZE_KEY, JSON.stringify(snoozed));
  }

  const MAIL_CAMERA_LABELS = { indkorsel: "Indkørsel", carport: "Carport", forhaven: "Forhaven" };

  function openMailDetail(banner, activeCamera = "indkorsel") {
    document.getElementById("beastOvBannerModal")?.remove();
    const images = banner.images || mailImages();
    const available = Object.entries(images).filter(([, url]) => url);
    const current = available.length ? (images[activeCamera] ? activeCamera : available[0][0]) : null;
    const overlay = document.createElement("div");
    overlay.id = "beastOvBannerModal";
    overlay.className = "beast-modal-overlay";
    overlay.innerHTML = `<div class="beast-modal beast-ov-mail-modal" role="dialog" aria-modal="true">
      <div class="beast-modal-header"><div><h3>Postkassen</h3><p>${escapeHtml(banner.detail)}</p></div><button type="button" class="beast-modal-close" data-close>${BeastCore.icon("close", { size: 22 })}</button></div>
      <div class="beast-modal-body">
        ${current ? `<div class="beast-ov-mail-modal-image"><img src="${escapeHtml(images[current])}" alt="${escapeHtml(MAIL_CAMERA_LABELS[current] || current)}"></div>` : ""}
        ${available.length > 1 ? `<div class="beast-ov-mail-modal-switch">${available.map(([key]) => `<button type="button" data-camera="${key}"${key === current ? " class=\"is-active\"" : ""}>${escapeHtml(MAIL_CAMERA_LABELS[key] || key)}</button>`).join("")}</div>` : ""}
        <div class="beast-ov-mail-modal-actions">
          <button type="button" class="beast-btn beast-btn-primary" data-mail-collected>${BeastCore.icon("check", { size: 17 })}<span>Posten er hentet</span></button>
          ${snoozeActionMarkup(banner)}
        </div>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    wireSnoozeMenu(overlay, banner, () => { close(); renderBanners(); });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) { close(); return; }
      const cameraButton = event.target.closest("[data-camera]");
      if (cameraButton) { openMailDetail(banner, cameraButton.dataset.camera); return; }
      if (event.target.closest("[data-mail-collected]")) {
        if (MAIL_PRESENT_ID) callService("input_boolean", "turn_off", MAIL_PRESENT_ID);
        close();
        renderBanners();
        return;
      }
      if (!event.target.closest("[data-snooze-wrap]")) { const menu = overlay.querySelector("[data-snooze-menu]"); if (menu) menu.hidden = true; }
    });
  }

  const PRINTER_CAMERA_LABELS = { protect: "Kamera", indbygget: "Indbygget" };

  function openPrinterDetail(banner, activeCamera = "protect") {
    document.getElementById("beastOvBannerModal")?.remove();
    const images = banner.images || printerImages();
    const liveCamera = banner.liveCamera || printerLiveCamera();
    const available = Object.entries(images).filter(([, url]) => url);
    const current = available.length ? (images[activeCamera] ? activeCamera : available[0][0]) : null;
    // "protect" gets the real live camera component (same as the banner
    // itself -- see bannerPhotoMarkup()) whenever it's configured; only
    // "indbygget" (the printer's own built-in "image" entity, which HA has
    // no live-stream proxy for) falls back to a still image, refreshed on
    // an interval below so it's at least not a single frozen frame for the
    // whole time the modal stays open.
    const showLive = current === "protect" && liveCamera && window.BeastCameras;
    const overlay = document.createElement("div");
    overlay.id = "beastOvBannerModal";
    overlay.className = "beast-modal-overlay";
    const remainingLabel = Number.isFinite(banner.remaining) ? `${banner.remaining.toFixed(1)} t tilbage` : "";
    const progress = Math.max(0, Math.min(100, banner.progress || 0));
    overlay.innerHTML = `<div class="beast-modal beast-ov-mail-modal" role="dialog" aria-modal="true">
      <div class="beast-modal-header"><div><h3>3D-printer</h3><p>${escapeHtml(banner.task || banner.title)}</p></div><button type="button" class="beast-modal-close" data-close>${BeastCore.icon("close", { size: 22 })}</button></div>
      <div class="beast-modal-body">
        ${current ? `<div class="beast-ov-mail-modal-image">${showLive ? window.BeastCameras.sharedCameraMarkup(liveCamera, { label: false, motion: false }) : `<img data-printer-modal-image src="${escapeHtml(images[current])}" alt="">`}</div>` : ""}
        ${available.length > 1 ? `<div class="beast-ov-mail-modal-switch">${available.map(([key]) => `<button type="button" data-camera="${key}"${key === current ? " class=\"is-active\"" : ""}>${escapeHtml(PRINTER_CAMERA_LABELS[key] || key)}</button>`).join("")}</div>` : ""}
        <div class="beast-ov-printer-modal-progress"><div class="beast-ov-printer-modal-bar" style="width:${progress}%"></div></div>
        <p class="beast-ov-printer-modal-meta">${Math.round(progress)}%${remainingLabel ? ` · ${remainingLabel}` : ""}</p>
        <div class="beast-ov-mail-modal-actions">
          <button type="button" class="beast-btn beast-btn-primary" data-open-printer>${BeastCore.icon("printer", { size: 17 })}<span>Åbn 3D-printer</span></button>
          ${snoozeActionMarkup(banner)}
        </div>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    if (showLive) window.BeastCameras.wireSharedCameras(overlay, () => {});
    // Keeps the built-in camera's still image actually moving while the
    // modal is open -- previously it was set once at creation and then
    // frozen for as long as the modal stayed up, even though the printer
    // camera itself was refreshing in the background the whole time.
    let refreshTimerId = null;
    if (!showLive && current) {
      refreshTimerId = window.setInterval(() => {
        const img = overlay.querySelector("[data-printer-modal-image]");
        const nextUrl = printerImages()[current];
        if (img && nextUrl && img.src !== nextUrl) img.src = nextUrl;
      }, PRINTER_IMAGE_REFRESH_MS);
    }
    const close = () => { window.clearInterval(refreshTimerId); overlay.remove(); };
    wireSnoozeMenu(overlay, banner, () => { close(); renderBanners(); });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) { close(); return; }
      const cameraButton = event.target.closest("[data-camera]");
      if (cameraButton) { close(); openPrinterDetail(banner, cameraButton.dataset.camera); return; }
      if (event.target.closest("[data-open-printer]")) { close(); document.querySelector('.beast-rail-btn[data-section="printer"]')?.click(); return; }
      if (!event.target.closest("[data-snooze-wrap]")) { const menu = overlay.querySelector("[data-snooze-menu]"); if (menu) menu.hidden = true; }
    });
  }

  function openDoorsDetail(banner) {
    document.getElementById("beastOvBannerModal")?.remove();
    const overlay = document.createElement("div");
    overlay.id = "beastOvBannerModal";
    overlay.className = "beast-modal-overlay";
    overlay.innerHTML = `<div class="beast-modal beast-ov-mail-modal" role="dialog" aria-modal="true">
      <div class="beast-modal-header"><div><h3>Døre & låse</h3><p>${escapeHtml(banner.title)}</p></div><button type="button" class="beast-modal-close" data-close>${BeastCore.icon("close", { size: 22 })}</button></div>
      <div class="beast-modal-body">
        <ul class="beast-ov-doors-modal-list">${banner.rows.map((row) => `<li>${escapeHtml(row)}</li>`).join("")}</ul>
        <div class="beast-ov-mail-modal-actions">
          <button type="button" class="beast-btn beast-btn-primary" data-open-security>${BeastCore.icon("shield", { size: 17 })}<span>Åbn sikkerhed</span></button>
          ${snoozeActionMarkup(banner)}
        </div>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    wireSnoozeMenu(overlay, banner, () => { close(); renderBanners(); });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) { close(); return; }
      if (event.target.closest("[data-open-security]")) { close(); document.querySelector('.beast-rail-btn[data-section="security"]')?.click(); return; }
      if (!event.target.closest("[data-snooze-wrap]")) { const menu = overlay.querySelector("[data-snooze-menu]"); if (menu) menu.hidden = true; }
    });
  }

  function savedOverviewLayout() {
    try {
      const saved = JSON.parse(localStorage.getItem(OVERVIEW_LAYOUT_KEY) || "{}");
      return { columns: "compact-wide-camera", compactOrder: saved.order || "clock-first", wideOrder: "weather-first", ...saved };
    } catch (_) { return { columns: "compact-wide-camera", compactOrder: "clock-first", wideOrder: "weather-first" }; }
  }

  function autoFocusEnabled() {
    return BeastConfig.get("features.eventFocus") === true;
  }

  function contextualPeriod() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return "morning";
    if (hour >= 12 && hour < 17) return "afternoon";
    if (hour >= 17 && hour < 23) return "evening";
    return "night";
  }

  function startContextualFocus() {
    window.clearInterval(contextualFocusTimerId);
    contextualFocusTimerId = window.setInterval(() => {
      if (!autoFocusEnabled() || overviewCardEditor?.isEditing() || !zoneEl?.closest(".beast-section")?.classList.contains("is-active")) return;
      renderSecurity();
    }, 60000);
  }

  function applyOverviewLayout() {
    if (!zoneEl) return;
    const layout = savedOverviewLayout();
    const focusEnabled = autoFocusEnabled();
    zoneEl.dataset.columns = layout.columns;
    zoneEl.dataset.compactOrder = layout.compactOrder;
    zoneEl.dataset.wideOrder = layout.wideOrder;
    zoneEl.dataset.autoFocus = focusEnabled ? contextualPeriod() : "static";
    const dynamic = BeastConfig.get("features.dynamicOverview") === true;
    zoneEl.classList.toggle("is-dynamic", dynamic);
    zoneEl.classList.toggle("is-editing", Boolean(overviewCardEditor?.isEditing()));
    zoneEl.querySelectorAll("[data-card]").forEach((card) => {
      if (dynamic) {
        const cardType = card.dataset.card === "generic" ? card.dataset.widget : card.dataset.card;
        const configured = cardType === "clock" || cardType === "security" || cardType === "cameras"
          || (cardType === "custom" ? Boolean(card.dataset.entity) : BeastConfig.isPanelConfigured(cardType === "heatpump" ? "heating" : cardType));
        card.hidden = !configured;
      } else card.hidden = false;
      card.querySelector(".beast-data-quality")?.remove();
      if (BeastConfig.get("features.dataQuality") === true) {
        const primaryIds = {
          weather: [BeastConfig.get("panels.weather.entity")], energy: [BeastConfig.get("panels.energy.powerSensor")],
          security: BeastConfig.get("panels.security.alarmPanels") || [], cameras: BeastConfig.get("panels.cameras.cameraEntities") || [],
          clock: []
        }[card.dataset.card] || [];
        if (primaryIds.length) {
          const states = primaryIds.map((id) => BeastHaSocket.getState(id)).filter(Boolean);
          const unavailable = states.length < primaryIds.filter(Boolean).length || states.some((state) => ["unknown","unavailable"].includes(state.state));
          const newest = Math.max(0, ...states.map((state) => new Date(state.last_updated || state.last_changed || 0).getTime()));
          const stale = !unavailable && newest && Date.now() - newest > (card.dataset.card === "weather" ? 2 * 3600000 : 30 * 60000);
          const badge = document.createElement("span"); badge.className = "beast-data-quality"; badge.dataset.quality = unavailable ? "unavailable" : stale ? "stale" : "live"; badge.textContent = unavailable ? "Utilgængelig" : stale ? "Forsinket" : "Live"; card.appendChild(badge);
        }
      }
      card.querySelector(".beast-ov-edit-label")?.remove();
    });
  }

  // Reconstructs the legacy 5-slot layout as a freeform card array, in the
  // same order/sizing admin.js's builder uses to seed itself the first
  // time it opens on an install that has never used the freeform layout --
  // so entering edit mode always starts from something meaningful instead
  // of a blank grid. Passed to BeastCardEditor as its seedCards() option.
  function seedCardsFromOverviewSlots() {
    const defaults = { main:{type:"cameras"}, compactTop:{type:"clock"}, compactBottom:{type:"security"}, wideTop:{type:"weather"}, wideBottom:{type:"energy"} };
    const slots = { ...defaults, ...(BeastConfig.get("overviewSlots") || {}) };
    const order = [
      ["compactTop", { w:3, h:1 }, { w:1, h:2 }, { h:2 }],
      ["wideTop", { w:5, h:1 }, { w:2, h:2 }, { h:2 }],
      ["main", { w:4, h:2 }, { w:2, h:2 }, { h:2 }],
      ["compactBottom", { w:3, h:1 }, { w:1, h:2 }, { h:2 }],
      ["wideBottom", { w:5, h:1 }, { w:2, h:2 }, { h:2 }]
    ];
    return order
      .map(([key, desktop, tablet, portrait]) => ({ id: key, ...(slots[key] || { type: "empty" }), desktop, tablet, portrait }))
      .filter((card) => card.type !== "empty");
  }

  // Passed to BeastCardEditor as its onAfterRender() option -- repaints
  // live content into freshly-rebuilt card shells and keeps the standalone
  // camera-menu element (see overviewCameraMenuMarkup() in app.js) in sync
  // with whether a cameras card is currently present.
  function overviewCardEditorOnAfterRender(cards) {
    const anchor = zoneEl.querySelector("#beastOvClockMusic");
    zoneEl.querySelector(".beast-ov-camera-header")?.remove();
    const menuWrap = document.createElement("div");
    menuWrap.innerHTML = window.overviewCameraMenuMarkup(cards.some((card) => card.type === "cameras"));
    zoneEl.insertBefore(menuWrap.firstElementChild, anchor);
    renderAll();
    wireOverviewChrome();
  }

  // Passed to BeastCardEditor as its renderEmptyState() option -- only
  // reached when cancelling out of edit mode on an install that has never
  // switched to the freeform layout (zero saved cards even before
  // editing). Re-runs the exact same render used at initial page load
  // instead of duplicating its legacy-slot defaults here.
  function overviewRenderEmptyState() {
    const anchor = zoneEl.querySelector("#beastOvClockMusic");
    zoneEl.querySelectorAll(":scope > .beast-ov-card").forEach((el) => el.remove());
    zoneEl.classList.remove("is-freeform");
    const wrap = document.createElement("div");
    wrap.innerHTML = window.renderOverviewSection();
    Array.from(wrap.querySelector("#beastOverviewZone").children).forEach((child) => {
      if (child.id === "beastOvBanners" || child.id === "beastOvClockMusic") return;
      zoneEl.insertBefore(child, anchor);
    });
    renderAll();
    wireOverviewChrome();
  }

  function wireOverviewChrome() {
    const menu = document.getElementById("beastOvCameraMenu");
    const toggle = document.getElementById("beastOvCameraMenuToggle");
    // Re-queried on every call rather than closed over once -- the single
    // document-level click listener below is only ever registered the
    // first time (see the _closeMenuWired guard), but the card editor's
    // internal renderCardsDom() removes and recreates the camera-menu/toggle
    // nodes on every edit-mode change, so a closure captured on the first
    // call would end up pointing at detached, stale elements after the
    // first rebuild.
    const closeMenu = () => {
      const liveMenu = document.getElementById("beastOvCameraMenu");
      if (liveMenu) liveMenu.hidden = true;
      document.getElementById("beastOvCameraMenuToggle")?.setAttribute("aria-expanded", "false");
    };
    document.querySelector(".beast-ov-camera-header")?.addEventListener("click", (event) => event.stopPropagation());
    // The overview is rebuilt during data and layout updates. Delegate the
    // menu trigger once so a newly rendered three-dot button never keeps a
    // stale or missing click handler.
    if (!wireOverviewChrome._menuToggleWired) {
      wireOverviewChrome._menuToggleWired = true;
      document.addEventListener("click", (event) => {
        const liveToggle = event.target.closest("#beastOvCameraMenuToggle");
        if (!liveToggle) return;
        event.preventDefault(); event.stopPropagation();
        const liveMenu = document.getElementById("beastOvCameraMenu");
        const opening = liveMenu?.hidden !== false;
        if (liveMenu) liveMenu.hidden = !opening;
        liveToggle.setAttribute("aria-expanded", String(opening));
      }, true);
    }
    menu?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.target.closest("button")) closeMenu();
    });
    // overviewCardEditorOnAfterRender() calls wireOverviewChrome() again on
    // every edit-mode change (add/remove/move/resize a card) to rebind the
    // camera-menu buttons on freshly recreated nodes -- but this document
    // listener only ever needs to exist once, not once per call.
    if (!wireOverviewChrome._closeMenuWired) {
      wireOverviewChrome._closeMenuWired = true;
      document.addEventListener("click", (event) => {
        if (!event.target.closest(".beast-ov-camera-header")) closeMenu();
      });
    }
    document.getElementById("beastOvEdit")?.addEventListener("click", (event) => { event.stopPropagation(); closeMenu(); overviewCardEditor.enter(); });
    // showAmbientMode() lives in app.js (a plain global function, not an
    // IIFE export) -- force=true so it shows on demand even outside the
    // configured schedule, since this is a manual preview action.
    document.getElementById("beastOvStartScreensaver")?.addEventListener("click", (event) => {
      event.stopPropagation();
      closeMenu();
      window.showAmbientMode?.(true);
    });
    applyOverviewLayout();
    positionCameraMenu();
    if (!wireOverviewChrome._resizeWired) {
      wireOverviewChrome._resizeWired = true;
      window.addEventListener("resize", positionCameraMenu);
    }
  }

  // Keep the front-page menu in the same global position as the Robotter
  // and 3D Printer edit menus: directly below the fixed connection dot.
  // This function remains wired to rebuild/resize events so any stale
  // inline position from an older cached build is actively cleared.
  function positionCameraMenu() {
    const header = document.querySelector(".beast-ov-camera-header");
    if (!header) return;
    header.style.left = "auto";
    header.style.right = "8px";
    header.style.top = "30px";
  }

  function formatCompactDate(date) {
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return `${window.HASmartdashI18n?.language === "en" ? "today" : "i dag"} ${date.toLocaleTimeString(window.HASmartdashI18n?.locale || "da-DK", { hour: "2-digit", minute: "2-digit" })}`;
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    if (date.toDateString() === tomorrow.toDateString()) return `${window.HASmartdashI18n?.language === "en" ? "tomorrow" : "i morgen"} ${date.toLocaleTimeString(window.HASmartdashI18n?.locale || "da-DK", { hour: "2-digit", minute: "2-digit" })}`;
    return date.toLocaleDateString(window.HASmartdashI18n?.locale || "da-DK", { weekday: "short", day: "numeric" });
  }

  function getWasteItems() {
    return WASTE_SENSORS
      .map((id) => BeastHaSocket.getState(id))
      .filter(Boolean)
      .map((state) => ({ name: state.attributes.name || state.attributes.friendly_name, days: Number(state.state) }))
      .filter((item) => Number.isFinite(item.days))
      .sort((a, b) => a.days - b.days);
  }

  function renderWeather() {
    const host = document.getElementById("beastOvWeather");
    if (!host) return;
    // A missing state (entity not in the socket's cache yet -- e.g. right
    // after an HA restart, before a fresh snapshot arrives) used to wipe
    // this whole widget down to "Intet vejrdata." with nothing left to
    // recover it visually. It now degrades the same way the dedicated
    // Weather page already does: dashes for the current-conditions numbers,
    // forecast rows kept (they come from dailyForecast/hourlyForecast,
    // loaded independently of this entity's live state).
    const state = BeastHaSocket.getState(WEATHER_ENTITY_ID);
    const meta = BeastCore.weatherMeta(state?.state);
    const temp = Number.isFinite(Number(state?.attributes?.temperature)) ? Math.round(Number(state.attributes.temperature)) : "–";
    const feelsLike = Number.isFinite(Number(state?.attributes?.apparent_temperature)) ? Math.round(Number(state.attributes.apparent_temperature)) : null;
    const humidity = Number.isFinite(Number(state?.attributes?.humidity)) ? Math.round(Number(state.attributes.humidity)) : null;
    const wind = Number.isFinite(Number(state?.attributes?.wind_speed)) ? Math.round(Number(state.attributes.wind_speed)) : null;
    const pressure = Number.isFinite(Number(state?.attributes?.pressure)) ? Math.round(Number(state.attributes.pressure)) : null;
    const visibility = Number.isFinite(Number(state?.attributes?.visibility)) ? Number(state.attributes.visibility).toFixed(0) : null;
    host.parentElement.dataset.mood = meta.mood;
    host.innerHTML = `
      <div class="beast-ov-fill">
        <div class="beast-ov-weather-now">
          <div class="beast-ov-weather-hero">
            <span class="beast-ov-weather-icon">${BeastCore.animatedWeatherIcon(meta.mood, 58)}</span>
            <div>
              <span class="beast-ov-weather-temp">${temp}°</span>
              <span class="beast-ov-weather-label">${escapeHtml(meta.label)}${feelsLike !== null ? ` · føles som ${feelsLike}°` : ""}</span>
            </div>
          </div>
          <div class="beast-ov-weather-metrics">
            <div>${BeastCore.icon("droplet", { size: 15 })}<span>Fugt</span><b>${humidity !== null ? humidity + "%" : "–"}</b></div>
            <div>${BeastCore.icon("cloud", { size: 15 })}<span>Vind</span><b>${wind !== null ? wind + " km/t" : "–"}</b></div>
            <div>${BeastCore.icon("grid", { size: 15 })}<span>Tryk</span><b>${pressure !== null ? pressure + " hPa" : "–"}</b></div>
            <div>${BeastCore.icon("search", { size: 15 })}<span>Sigt</span><b>${visibility !== null ? visibility + " km" : "–"}</b></div>
          </div>
        </div>
        <div class="beast-ov-hourly">
          ${hourlyForecast.slice(0, 6).map((entry) => {
            const entryMeta = BeastCore.weatherMeta(entry.condition);
            const date = new Date(entry.datetime);
            const rain = Number(entry.precipitation_probability);
            return `<div>
              <span>${escapeHtml(date.toLocaleTimeString(window.HASmartdashI18n?.locale || "da-DK", { hour: "2-digit", minute: "2-digit" }))}</span>
              <span>${BeastCore.animatedWeatherIcon(entryMeta.mood, 25)}</span>
              <b>${Number.isFinite(Number(entry.temperature)) ? Math.round(Number(entry.temperature)) + "°" : "–"}</b>
              <small>${Number.isFinite(rain) ? Math.round(rain) + "%" : ""}</small>
            </div>`;
          }).join("") || `<i>${weatherForecastLoading ? "Henter timevejret…" : "Timeprognosen er ikke tilgængelig"}</i>`}
        </div>
        <div class="beast-ov-week-title"><span>Næste 7 dage</span><small>${getSunSummary()}</small></div>
        <div class="beast-ov-week">
          ${dailyForecast.slice(0, 7).map((entry) => {
            const entryMeta = BeastCore.weatherMeta(entry.condition);
            const date = new Date(entry.datetime);
            const rain = Number(entry.precipitation_probability);
            return `<div class="beast-ov-week-day">
              <span>${escapeHtml(date.toLocaleDateString(window.HASmartdashI18n?.locale || "da-DK", { weekday: "short" }).replace(".", ""))}</span>
              ${BeastCore.animatedWeatherIcon(entryMeta.mood, 36)}
              <small class="beast-ov-week-condition">${escapeHtml(entryMeta.label || entry.condition || "Ukendt")}</small>
              <div><b>${Number.isFinite(Number(entry.temperature)) ? Math.round(Number(entry.temperature)) + "°" : "–"}</b><small>${Number.isFinite(Number(entry.templow)) ? Math.round(Number(entry.templow)) + "°" : "–"}</small></div>
              <em>${Number.isFinite(rain) ? Math.round(rain) + "%" : "–"}</em>
            </div>`;
          }).join("") || `<span class="beast-ov-week-empty">${weatherForecastLoading || !weatherForecastLoaded ? "Henter ugeudsigten fra Home Assistant…" : "Ugeprognosen er ikke tilgængelig"}</span>`}
        </div>
      </div>
    `;
  }

  async function loadWeatherForecast() {
    if (!WEATHER_ENTITY_ID || weatherForecastLoading) return;
    weatherForecastLoading = true;
    renderWeather();
    const fetchForecast = async (type) => {
      const result = await BeastAuth.haFetch("/api/services/weather/get_forecasts?return_response", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_id: WEATHER_ENTITY_ID, type })
      });
      const response = result?.service_response || result;
      const entityResult = response?.[WEATHER_ENTITY_ID] || response;
      return Array.isArray(entityResult?.forecast) ? entityResult.forecast : [];
    };
    const [hourlyResult, dailyResult] = await Promise.allSettled([
      fetchForecast("hourly"),
      fetchForecast("daily")
    ]);
    hourlyForecast = hourlyResult.status === "fulfilled" ? hourlyResult.value : [];
    if (dailyResult.status === "fulfilled") {
      dailyForecast = dailyResult.value;
    } else {
      const fallback = BeastHaSocket.getState(WEATHER_ENTITY_ID)?.attributes?.forecast;
      dailyForecast = Array.isArray(fallback) ? fallback : [];
    }
    [hourlyResult, dailyResult].forEach((result, index) => {
      if (result.status === "rejected") BeastCore.log(`Oversigt: kunne ikke hente ${index === 0 ? "timevejr" : "ugevejr"} (${result.reason?.message || "ukendt fejl"}).`);
    });
    weatherForecastLoading = false;
    weatherForecastLoaded = true;
    renderWeather();
  }

  function getSunSummary() {
    const sun = BeastHaSocket.getState("sun.sun");
    if (!sun) return "Dag / nat · regnchance";
    const rising = new Date(sun.attributes.next_rising);
    const setting = new Date(sun.attributes.next_setting);
    const format = (date) => Number.isNaN(date.getTime()) ? "–" : date.toLocaleTimeString(window.HASmartdashI18n?.locale || "da-DK", { hour: "2-digit", minute: "2-digit" });
    return `Sol op ${format(rising)} · ned ${format(setting)}`;
  }

  function renderCameras() {
    const area = document.getElementById("beastOvCameras");
    if (!area || !window.BeastCameras) return;
    const ventilation = window.BeastVentilation?.enabled() === true;
    if (area.classList.contains("hrv-enabled") !== ventilation) {
      area.classList.toggle("hrv-enabled", ventilation);
      area.innerHTML = ventilation ? '<div class="hrv-camera-host"></div><div class="hrv-card-host"></div>' : '';
      lastCameraRenderSignature = null;
    }
    const host = ventilation ? area.querySelector('.hrv-camera-host') : area;
    if (ventilation) BeastVentilation.render(area.querySelector('.hrv-card-host'));
    let allCameras = window.BeastCameras.getAllCameras("overview");
    const doorbellId = BeastConfig.get("appEntities.doorbellCamera");
    const doorbellCamera = doorbellId ? window.BeastCameras.resolveCamera(doorbellId) : null;
    if (doorbellCamera && !allCameras.some((camera) => camera.slug === doorbellCamera.slug)) allCameras = [doorbellCamera, ...allCameras];
    if (!allCameras.length) {
      host.innerHTML = `<p class="beast-music-empty">Ingen kameraer.</p>`;
      return;
    }
    const cameraBySlug = new Map(allCameras.map((camera) => [camera.slug, camera]));
    const centralSelection = BeastConfig.get("overviewCameraEntities");
    const hasCentralSelection = Array.isArray(centralSelection) && centralSelection.length > 0;
    let selectedSlugs = (Array.isArray(centralSelection) ? centralSelection : [])
      .map((id) => window.BeastCameras.resolveGroup(id)?.slug || window.BeastCameras.resolveCamera(id)?.slug || id)
      .filter((slug) => cameraBySlug.has(slug)).slice(0, OVERVIEW_CAMERA_LIMIT);
    // One-time migration from the old per-browser selection. It is copied
    // centrally only when no server-side choice exists.
    if (!selectedSlugs.length) {
      try {
        const legacy = JSON.parse(localStorage.getItem(OVERVIEW_CAMERA_KEY) || "[]");
        if (Array.isArray(legacy)) selectedSlugs = legacy.filter((slug) => cameraBySlug.has(slug)).slice(0, OVERVIEW_CAMERA_LIMIT);
      } catch (_) { selectedSlugs = []; }
    }
    // An explicit overview choice must win exactly as saved. The doorbell
    // camera still opens full-screen for a ring event, but forcing it into
    // this strip used to push the user's final selected camera out.
    if (!selectedSlugs.length) {
      const fallback = doorbellCamera
        ? [doorbellCamera, ...allCameras.filter((camera) => camera.slug !== doorbellCamera.slug)]
        : allCameras;
      selectedSlugs = fallback.slice(0, OVERVIEW_CAMERA_LIMIT).map((camera) => camera.slug);
    } else if (!hasCentralSelection) {
      // Keep a legacy browser selection intact during its one-time migration;
      // it becomes an explicit central selection the first time it is saved.
      selectedSlugs = selectedSlugs.slice(0, OVERVIEW_CAMERA_LIMIT);
    }
    let cameras = selectedSlugs.map((slug) => cameraBySlug.get(slug)).filter(Boolean);
    if (autoFocusEnabled() && motionFocusSlug && cameraBySlug.has(motionFocusSlug)) {
      cameras = [cameraBySlug.get(motionFocusSlug), ...cameras.filter((camera) => camera.slug !== motionFocusSlug)].slice(0, OVERVIEW_CAMERA_LIMIT);
    }
    if (ventilation) cameras = cameras.slice(0, 2);
    const isMobile = isMobileOverviewViewport();
    if (isMobile && (!mobileFeaturedCameraSlug || !cameras.some(camera => camera.slug === mobileFeaturedCameraSlug))) mobileFeaturedCameraSlug = cameras[0]?.slug || null;
    // Skip rebuilding when nothing camera-relevant actually changed.
    // renderCameras() runs as part of renderAll() on every reconnect and
    // several unrelated state updates (weather, security, ...) -- without
    // this guard each of those tore the live WebRTC iframe(s) down and
    // rebuilt them from scratch for no camera-side reason at all, which is
    // what read as the cameras blinking on their own.
    const cameraRenderSignature = JSON.stringify({
      mobile: isMobile,
      featured: isMobile ? mobileFeaturedCameraSlug : null,
      cameras: cameras.map((camera) => `${camera.slug}:${camera.resolvedStreamName || camera.streamName || ""}`)
    });
    if (cameraRenderSignature === lastCameraRenderSignature) return;
    lastCameraRenderSignature = cameraRenderSignature;
    // Mobile: one big featured camera plus small tappable thumbnails for
    // the rest, swapping which is featured in place -- the same pattern
    // the standalone Cameras page already uses, not the equal-size strip
    // the desktop/tablet front page shows.
    if (isMobile) {
      const featured = cameraBySlug.get(mobileFeaturedCameraSlug) || cameras[0];
      const others = cameras.filter((camera) => camera.slug !== mobileFeaturedCameraSlug);
      host.innerHTML = `
        <div class="beast-ov-camera-mobile">
          <div class="beast-ov-camera-mobile-featured" data-slug="${featured.slug}">
            ${window.BeastCameras.sharedCameraMarkup(featured, { className: "beast-overview-camera-render", label: true, motion: true })}
          </div>
          ${others.length ? `<div class="beast-ov-camera-mobile-thumbs">${others.map((camera) => `
            <button type="button" class="beast-ov-camera-mobile-thumb${camera.motion ? " has-motion" : ""}" data-slug="${camera.slug}" aria-label="Vis ${escapeHtml(camera.label)}">
              ${window.BeastCameras.sharedCameraMarkup(camera, { className: "beast-overview-camera-render", label: true, motion: true })}
            </button>
          `).join("")}</div>` : ""}
        </div>
      `;
      window.BeastCameras.wireSharedCameras(host, renderCameras, "overview");
      host.querySelectorAll(".beast-ov-camera-mobile-thumb").forEach((button) => {
        button.addEventListener("click", (event) => {
          if (event.target.closest("[data-camera-quality-slug]")) return;
          event.stopPropagation();
          mobileFeaturedCameraSlug = button.dataset.slug;
          renderCameras();
        });
      });
      return;
    }
    host.innerHTML = `
      <div class="beast-ov-camera-strip" data-count="${cameras.length}">${cameras.map((camera) => `
        <div class="beast-ov-camera-thumb${camera.motion ? " has-motion" : ""}" data-slug="${camera.slug}" role="button" tabindex="0" aria-label="Åbn ${escapeHtml(camera.label)}">
          ${window.BeastCameras.sharedCameraMarkup(camera, { className: "beast-overview-camera-render", label: true, motion: true })}
        </div>
      `).join("")}</div>
    `;
    window.BeastCameras.wireSharedCameras(host, renderCameras, "overview");
    const openCamera = (slug) => {
      if (!window.BeastCameras.selectCamera(slug)) return;
      document.dispatchEvent(new CustomEvent("beast:navigate", { detail: { section: "cameras" } }));
    };
    host.querySelectorAll(".beast-ov-camera-thumb").forEach((tile) => {
      tile.addEventListener("click", (event) => {
        if (event.target.closest("[data-camera-quality-slug]")) return;
        openCamera(tile.dataset.slug);
      });
      tile.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openCamera(tile.dataset.slug);
      });
    });
    const cameraPickerButton = document.getElementById("beastOvCameraPicker");
    if (cameraPickerButton) cameraPickerButton.onclick = (event) => {
      event.stopPropagation();
      const cameraMenu = document.getElementById("beastOvCameraMenu");
      if (cameraMenu) cameraMenu.hidden = true;
      document.getElementById("beastOvCameraMenuToggle")?.setAttribute("aria-expanded", "false");
      openCameraPicker(allCameras, selectedSlugs);
    };
  }

  function openCameraPicker(cameras, initialSlugs) {
    document.getElementById("beastOvCameraPickerModal")?.remove();
    const selected = Array.from(new Set(initialSlugs)).slice(0, OVERVIEW_CAMERA_LIMIT);
    const overlay = document.createElement("div");
    overlay.id = "beastOvCameraPickerModal";
    overlay.className = "beast-modal-overlay";
    overlay.innerHTML = `
      <div class="beast-modal beast-ov-camera-picker-modal" role="dialog" aria-modal="true" aria-label="Vælg kameraer til forsiden">
        <div class="beast-modal-header">
          <div>
            <h3>Vælg kameraer</h3>
            <p class="beast-ov-camera-picker-help">Vælg op til ${OVERVIEW_CAMERA_LIMIT} kameraer og bestem rækkefølgen</p>
          </div>
          <button type="button" class="beast-modal-close" data-close aria-label="Luk">${BeastCore.icon("close", { size: 22 })}</button>
        </div>
        <div class="beast-modal-body">
          ${window.BeastVentilation?.editorMarkup() || ""}
          <div class="beast-ov-camera-order">
            <strong>Rækkefølge på forsiden</strong>
            <div id="beastOvCameraOrder"></div>
          </div>
          <div class="beast-ov-camera-options">
            ${cameras.map((camera) => `
              <button type="button" class="beast-ov-camera-option${selected.includes(camera.slug) ? " is-selected" : ""}" data-camera-slug="${camera.slug}">
                <img${camera.streamName ? ` src="${window.BeastCameras.snapshotUrl(camera.resolvedStreamName || camera.streamName)}"` : ""} data-camera-picture="${camera.streamName ? "" : escapeHtml(camera.entityPicture || "")}" alt="">
                <span>${escapeHtml(camera.label)}</span>
                <i>${BeastCore.icon("check", { size: 18 })}</i>
              </button>
            `).join("")}
          </div>
          <div class="beast-ov-camera-picker-actions">
            <span class="beast-ov-camera-picker-save-state" role="status" aria-live="polite"></span>
            <button type="button" class="beast-btn beast-ov-camera-picker-done" data-save-camera-selection>Gem kameravalg</button>
          </div>
        </div>
      </div>
    `;

    async function saveAndRender() {
      const entities = selected.map((slug) => cameras.find((camera) => camera.slug === slug)?.entityId).filter(Boolean);
      const result = await BeastConfig.setMany({ overviewCameraEntities: entities, overviewVentilation: BeastVentilation.readEditor(overlay) });
      if (result?.success === false) return false;
      localStorage.removeItem(OVERVIEW_CAMERA_KEY);
      renderCameras();
      return true;
    }

    function renderSelectedOrder() {
      const host = overlay.querySelector("#beastOvCameraOrder");
      if (!host) return;
      host.innerHTML = selected.map((slug, index) => {
        const camera = cameras.find((item) => item.slug === slug);
        return `<div class="beast-ov-camera-order-row"><b>${index + 1}</b><span>${escapeHtml(camera?.label || slug)}</span><button type="button" data-order-index="${index}" data-order-move="-1" ${index === 0 ? "disabled" : ""} aria-label="Flyt op">${BeastCore.icon("chevron-up", { size: 18 })}</button><button type="button" data-order-index="${index}" data-order-move="1" ${index === selected.length - 1 ? "disabled" : ""} aria-label="Flyt ned">${BeastCore.icon("chevron-down", { size: 18 })}</button></div>`;
      }).join("");
      host.querySelectorAll("[data-order-move]").forEach((button) => button.addEventListener("click", () => {
        const from = Number(button.dataset.orderIndex);
        const to = from + Number(button.dataset.orderMove);
        if (to < 0 || to >= selected.length) return;
        [selected[from], selected[to]] = [selected[to], selected[from]];
        renderSelectedOrder();
      }));
    }

    function syncSelection() {
      overlay.querySelectorAll("[data-camera-slug]").forEach((button) => button.classList.toggle("is-selected", selected.includes(button.dataset.cameraSlug)));
      renderSelectedOrder();
    }

    overlay.querySelectorAll("[data-camera-slug]").forEach((button) => {
      button.addEventListener("click", () => {
        const slug = button.dataset.cameraSlug;
        const index = selected.indexOf(slug);
        if (index >= 0) {
          if (selected.length === 1) return;
          selected.splice(index, 1);
        } else {
          if (selected.length >= OVERVIEW_CAMERA_LIMIT) return;
          selected.push(slug);
        }
        syncSelection();
      });
    });
    overlay.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => overlay.remove()));
    overlay.querySelector("[data-save-camera-selection]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const status = overlay.querySelector(".beast-ov-camera-picker-save-state");
      button.disabled = true;
      button.classList.add("is-busy");
      button.textContent = "Gemmer…";
      if (status) status.textContent = "";
      const saved = await saveAndRender();
      if (saved) {
        overlay.remove();
        return;
      }
      button.disabled = false;
      button.classList.remove("is-busy");
      button.textContent = "Prøv igen";
      if (status) status.textContent = "Kunne ikke gemme kameravalget. Kontroller forbindelsen til serveren.";
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) overlay.remove();
    });
    renderSelectedOrder();
    document.body.appendChild(overlay);
    overlay.querySelectorAll("img[data-camera-picture]").forEach((img) => {
      const picture = img.dataset.cameraPicture;
      if (picture) BeastAuth.setAuthedImageSrc(img, picture);
    });
  }

  function refreshCameraSnapshots() {
    if (!window.BeastCameras || !BeastCore.isPanelVisible(zoneEl)) return;
    const cams = window.BeastCameras.getAllCameras("overview");
    // Only cameras without a go2rtc mapping get a plain <img> here (ones
    // with one use a live iframe instead, nothing to refresh); go through
    // HA's own authenticated camera image for those.
    document.querySelectorAll("#beastOvCameras .beast-ov-camera-thumb img").forEach((img) => {
      const slug = img.closest(".beast-ov-camera-thumb")?.dataset.slug;
      const cam = cams.find((c) => c.slug === slug);
      if (cam?.entityPicture) BeastAuth.setAuthedImageSrc(img, cam.entityPicture);
    });
  }

  function updateOverviewCameraMotion() {
    if (!window.BeastCameras) return;
    const allCameras = window.BeastCameras.getAllCameras("overview");
    const cameraBySlug = new Map(allCameras.map((camera) => [camera.slug, camera]));
    const movingCamera = allCameras.find((camera) => camera.motion);
    if (autoFocusEnabled() && movingCamera && motionFocusSlug !== movingCamera.slug) {
      motionFocusSlug = movingCamera.slug;
      window.clearTimeout(motionFocusTimerId);
      motionFocusTimerId = window.setTimeout(() => { motionFocusSlug = null; renderCameras(); }, 45000);
      renderCameras();
      return;
    }
    document.querySelectorAll("#beastOvCameras .beast-ov-camera-thumb").forEach((tile) => {
      const camera = cameraBySlug.get(tile.dataset.slug);
      if (!camera) return;
      tile.classList.toggle("has-motion", camera.motion);
      let badge = tile.querySelector("em");
      if (camera.motion && !badge) {
        badge = document.createElement("em");
        badge.innerHTML = `${BeastCore.icon("bolt", { size: 12 })} ${camera.motionLabel || "Hændelse"} nu`;
        tile.appendChild(badge);
      } else if (!camera.motion && badge) {
        badge.remove();
      }
    });
    if (autoFocusEnabled()) {
      const strip = document.querySelector("#beastOvCameras .beast-ov-camera-strip");
      const activeTile = strip ? Array.from(strip.children).find((tile) => cameraBySlug.get(tile.dataset.slug)?.motion) : null;
      if (activeTile && strip.firstElementChild !== activeTile) strip.prepend(activeTile);
    }
  }

  function contextualSecurityMarkup(period) {
    const states = Array.from(BeastHaSocket.getAllStates().values());
    const periodMeta = {
      morning: ["Godmorgen", "Dagens vigtigste information", "sun"],
      afternoon: ["Huset nu", "Robotter og aktuelt energiforbrug", "grid"],
      evening: ["God aften", "Lys, musik og sikkerhed", "moon"]
    }[period];
    if (!periodMeta) return null;

    if (period === "morning") {
      const appointments = states.filter((state) => state.entity_id.startsWith("calendar.") && state.attributes.start_time && state.attributes.message)
        .map((state) => ({ label: state.attributes.message, date: new Date(state.attributes.start_time) }))
        .filter((item) => !Number.isNaN(item.date.getTime()) && item.date.getTime() >= Date.now() - 3600000)
        .sort((a, b) => a.date - b.date).slice(0, 2);
      const battery = Number(BeastHaSocket.getState(CAR_BATTERY_ID)?.state);
      const range = Number(BeastHaSocket.getState(CAR_RANGE_ID)?.state);
      return { meta: periodMeta, body: `
        <div class="beast-ov-focus-grid">
          <button type="button" data-smart-nav="waste"><span>${BeastCore.icon("calendar", { size: 19 })}</span><div><small>Næste aftale</small><strong>${appointments[0] ? escapeHtml(appointments[0].label) : "Dagen er fri"}</strong><em>${appointments[0] ? escapeHtml(formatCompactDate(appointments[0].date)) : "Ingen kommende aftaler"}</em></div></button>
          <button type="button" data-smart-nav="car"><span>${BeastCore.icon("car", { size: 19 })}</span><div><small>Transport</small><strong>Energitte ${Number.isFinite(battery) ? Math.round(battery) + "%" : "–"}</strong><em>${Number.isFinite(range) ? Math.round(range) + " km rækkevidde" : "Klar til afgang"}</em></div></button>
          ${appointments[1] ? `<button type="button" data-smart-nav="waste"><span>${BeastCore.icon("calendar", { size: 19 })}</span><div><small>Derefter</small><strong>${escapeHtml(appointments[1].label)}</strong><em>${escapeHtml(formatCompactDate(appointments[1].date))}</em></div></button>` : `<button type="button" data-smart-nav="energy"><span>${BeastCore.icon("bolt", { size: 19 })}</span><div><small>Strøm lige nu</small><strong>${escapeHtml(BeastHaSocket.getState(PRICE_ENTITY_ID)?.state || "–")} kr/kWh</strong><em>Se dagens bedste timer</em></div></button>`}
        </div>` };
    }

    if (period === "afternoon") {
      const power = Number(BeastHaSocket.getState(POWER_ENTITY_ID)?.state);
      return { meta: periodMeta, body: `<div class="beast-ov-focus-grid">
        ${ROBOT_IDS.map((robot) => { const state = BeastHaSocket.getState(robot.id)?.state || "ukendt"; return `<button type="button" data-smart-nav="robots"><span>${BeastCore.icon("robot", { size: 19 })}</span><div><small>${escapeHtml(robot.label)}</small><strong>${escapeHtml({ cleaning:"Rengør", docked:"Docket", returning:"På vej hjem", mowing:"Slår græs", charging:"Oplader", idle:"Klar" }[state] || state)}</strong><em>Åbn robotstyring</em></div></button>`; }).join("")}
        <button type="button" data-smart-nav="energy"><span>${BeastCore.icon("bolt", { size: 19 })}</span><div><small>Energiforbrug</small><strong>${Number.isFinite(power) ? (power / 1000).toFixed(2) + " kW" : "–"}</strong><em>Forbrug lige nu</em></div></button>
      </div>` };
    }

    const lightsOn = states.filter((state) => state.entity_id.startsWith("light.") && state.state === "on");
    const nowPlaying = window.BeastMusic?.getNowPlaying();
    const unlocked = LOCKS.filter((lock) => BeastHaSocket.getState(lock.id)?.state !== "locked").length;
    const alarm = BeastHaSocket.getState(PRIMARY_ALARM_ID)?.state || "unknown";
    return { meta: periodMeta, body: `<div class="beast-ov-focus-grid is-evening">
      <button type="button" data-smart-nav="rooms"><span>${BeastCore.icon("sun", { size: 19 })}</span><div><small>Lys</small><strong>${lightsOn.length} tændt</strong><em>${lightsOn.length ? "Tryk for rumstyring" : "Alle lys er slukket"}</em></div></button>
      <button type="button" ${nowPlaying?.title && nowPlaying?.playing ? `data-smart-nav="music"` : `class="is-inactive" disabled`}><span>${BeastCore.icon("music", { size: 19 })}</span><div><small>Musik</small><strong>${nowPlaying?.title && nowPlaying?.playing ? escapeHtml(nowPlaying.title) : "Ingen musik"}</strong><em>${nowPlaying?.artist && nowPlaying?.playing ? escapeHtml(nowPlaying.artist) : "Afspilleren er inaktiv"}</em></div></button>
      <button type="button" data-smart-nav="security"><span>${BeastCore.icon(unlocked ? "unlock" : "lock", { size: 19 })}</span><div><small>Låse</small><strong>${unlocked ? unlocked + " ulåst" : "Alle låst"}</strong><em>Åbn sikkerhed</em></div></button>
      <button type="button" data-smart-nav="security"><span>${BeastCore.icon("shield", { size: 19 })}</span><div><small>Alarm</small><strong>${escapeHtml(alarm === "disarmed" ? "Alarm fra" : alarm)}</strong><em>Se alle alarmsystemer</em></div></button>
    </div>` };
  }

  function wireContextualFocus(host) {
    host.querySelectorAll("[data-smart-nav]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      document.querySelector(`.beast-rail-btn[data-section="${button.dataset.smartNav}"]`)?.click();
    }));
  }

  function renderSecurity() {
    const host = document.getElementById("beastOvSecurity");
    if (!host) return;
    const contextual = autoFocusEnabled() ? contextualSecurityMarkup(contextualPeriod()) : null;
    if (contextual) {
      host.innerHTML = `<div class="beast-ov-context-focus"><div class="beast-ov-context-head"><span>${BeastCore.icon(contextual.meta[2], { size: 20 })}</span><div><strong>${contextual.meta[0]}</strong><small>${contextual.meta[1]}</small></div><b>Automatisk</b></div>${contextual.body}</div>`;
      wireContextualFocus(host);
      return;
    }
    const entries = LOCKS.map((lock) => ({
      ...lock,
      locked: BeastHaSocket.getState(lock.id)?.state === "locked"
    }));
    const doorsOpen = DOOR_IDS.filter((id) => BeastHaSocket.getState(id)?.state === "on").length;
    const locksUnlocked = entries.filter((entry) => !entry.locked).length;
    const alarmState = BeastHaSocket.getState(PRIMARY_ALARM_ID);
    const alarmValue = alarmState?.state || "unknown";
    const alarmArmed = alarmValue.startsWith("armed");
    const alarmTriggered = alarmValue === "triggered";
    const allSecure = doorsOpen === 0 && locksUnlocked === 0;
    const alarmLabels = {
      disarmed: "Alarm fra",
      armed_home: "Hjemmetilstand",
      armed_away: "Udetilstand",
      armed_night: "Nattilstand",
      pending: "Tilkobler…",
      arming: "Tilkobler…",
      triggered: "ALARM!"
    };
    const alarmSystems = ALARM_IDS.map((id) => ({ id, label: BeastEntityPicker.friendlyName(id) })).map((system) => {
      const value = BeastHaSocket.getState(system.id)?.state || "unknown";
      return { ...system, value, text: alarmLabels[value] || value };
    });
    host.innerHTML = `
      <div class="beast-ov-security-center${alarmTriggered ? " is-triggered" : ""}">
        <div class="beast-ov-security-head">
          <div>
            <strong>${alarmTriggered ? "Alarm aktiveret" : (allSecure ? "Indgange sikret" : "Kræver opmærksomhed")}</strong>
            <span>${alarmLabels[alarmValue] || "Status ukendt"} · ${doorsOpen} åbne · ${locksUnlocked} ulåste</span>
          </div>
        </div>
        <div class="beast-ov-entry-list">
          ${entries.map((entry) => `
            <button type="button" class="beast-ov-entry${entry.locked ? " is-locked" : ""}${pendingUnlockId === entry.id ? " is-pending" : ""}" data-lock="${entry.id}" data-locked="${entry.locked}">
              <span class="beast-ov-entry-dot${entry.locked ? "" : " is-open"}"></span>
              <span class="beast-ov-entry-copy"><b>${escapeHtml(entry.label)}</b><small>${entry.locked ? "Låst" : "Ulåst"}</small></span>
              <span class="beast-ov-entry-state">${pendingUnlockId === entry.id ? "Bekræft oplåsning" : (entry.locked ? "Låst" : "Ulåst")}</span>
              <span class="beast-ov-entry-action">${BeastCore.icon(entry.locked ? "lock" : "unlock", { size: 20 })}</span>
            </button>
          `).join("")}
        </div>
        ${locksUnlocked ? `<button type="button" class="beast-ov-lock-all" id="beastOvLockAll">${BeastCore.icon("lock", { size: 15 })} Lås alle døre</button>` : ""}
        <div class="beast-ov-alarm-systems">
          ${alarmSystems.map((system) => `
            <div class="${system.value === "triggered" ? "is-triggered" : (system.value.startsWith("armed") ? "is-armed" : "")}">
              <span>${escapeHtml(system.label)}</span>
              <b>${escapeHtml(system.text)}</b>
            </div>
          `).join("")}
        </div>
      </div>
    `;

    host.querySelectorAll("[data-lock]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const locked = btn.dataset.locked === "true";
        const lockId = btn.dataset.lock;
        if (locked && pendingUnlockId !== lockId) {
          pendingUnlockId = lockId;
          window.clearTimeout(pendingUnlockTimerId);
          pendingUnlockTimerId = window.setTimeout(() => {
            pendingUnlockId = null;
            renderSecurity();
          }, 3500);
          renderSecurity();
          return;
        }
        pendingUnlockId = null;
        window.clearTimeout(pendingUnlockTimerId);
        callService("lock", locked ? "unlock" : "lock", lockId).then(() => window.setTimeout(renderSecurity, 400));
      });
    });

    document.getElementById("beastOvLockAll")?.addEventListener("click", (event) => {
      event.stopPropagation();
      const unlockedIds = entries.filter((entry) => !entry.locked).map((entry) => entry.id);
      if (unlockedIds.length) callService("lock", "lock", unlockedIds).then(() => window.setTimeout(renderSecurity, 400));
    });

  }

  function priceLevel(price) {
    if (price < 1.5) return { label: "Billig", cls: "is-cheap" };
    if (price < 3) return { label: "Normal", cls: "is-normal" };
    return { label: "Dyr", cls: "is-expensive" };
  }

  function energyAdvice(priceSeries, currentPrice, power) {
    if (!priceSeries.length || !Number.isFinite(currentPrice)) return { icon: "bolt", title: "Afventer prisdata", detail: "Anbefalingen opdateres automatisk" };
    let best = null;
    for (let index = 0; index <= priceSeries.length - 3; index += 1) {
      const slice = priceSeries.slice(index, index + 3);
      const average = slice.reduce((sum, item) => sum + item.value, 0) / 3;
      if (!best || average < best.average) best = { index, average };
    }
    if (!best) best = { index: 0, average: priceSeries.reduce((sum, item) => sum + item.value, 0) / priceSeries.length };
    const bestStart = best ? String(priceSeries[best.index]?.label || best.index).padStart(2, "0").slice(0, 2) : "–";
    const bestEnd = best ? String((Number(bestStart) + 3) % 24).padStart(2, "0") : "–";
    if (Number.isFinite(power) && power >= 5000) return { icon: "bolt", title: "Forbruget er højt lige nu", detail: `${(power / 1000).toFixed(1)} kW · flyt om muligt forbrug til kl. ${bestStart}–${bestEnd}` };
    if (currentPrice >= 3) return { icon: "bolt", title: "Vent med større forbrug", detail: `Bedste tretimers vindue er kl. ${bestStart}–${bestEnd} · ca. ${best.average.toFixed(2)} kr/kWh` };
    if (best && currentPrice <= best.average * 1.12) return { icon: "check", title: "Et godt tidspunkt at bruge strøm", detail: `${currentPrice.toFixed(2)} kr/kWh lige nu` };
    return { icon: "bolt", title: `Billigst kl. ${bestStart}–${bestEnd}`, detail: `Ca. ${best.average.toFixed(2)} kr/kWh i gennemsnit` };
  }

  function normalizePriceEntries(list) {
    if (!Array.isArray(list)) return [];
    const buckets = new Map();
    list.forEach((entry, index) => {
      const value = Number(typeof entry === "number" ? entry : (entry?.price ?? entry?.value));
      if (!Number.isFinite(value)) return;
      const rawTime = entry?.start || entry?.time || entry?.timestamp || entry?.hour;
      const date = rawTime ? new Date(rawTime) : new Date(Date.now() + index * 3600000);
      if (Number.isNaN(date.getTime())) return;
      const hour = date.getHours();
      const bucket = buckets.get(hour) || [];
      bucket.push(value);
      buckets.set(hour, bucket);
    });
    return Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).map(([hour, values]) => ({
      label: String(hour).padStart(2, "0"),
      value: values.reduce((sum, value) => sum + value, 0) / values.length
    }));
  }

  function getOverviewPriceSeries(view) {
    const priceState = BeastHaSocket.getState(PRICE_ENTITY_ID);
    const tomorrowState = BeastHaSocket.getState(PRICE_TOMORROW_ID);
    const forecastState = BeastHaSocket.getState(PRICE_FORECAST_ENTITY_ID);
    if (view === "today") {
      return normalizePriceEntries(priceState?.attributes?.prices || priceState?.attributes?.raw_today || priceState?.attributes?.today);
    }
    if (view === "tomorrow") {
      return normalizePriceEntries(tomorrowState?.attributes?.prices || priceState?.attributes?.raw_tomorrow || priceState?.attributes?.tomorrow);
    }
    const tomorrow = new Date();
    tomorrow.setHours(23, 59, 59, 999);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const candidates = [];
    [forecastState?.attributes, priceState?.attributes].filter(Boolean).forEach((attributes) => {
      Object.values(attributes).forEach((value) => {
        const list = Array.isArray(value?.value) ? value.value : (Array.isArray(value) ? value : []);
        list.forEach((entry) => {
          const rawTime = entry?.start || entry?.time || entry?.timestamp || entry?.hour;
          const date = rawTime ? new Date(rawTime) : null;
          if (date && !Number.isNaN(date.getTime()) && date > tomorrow) candidates.push(entry);
        });
      });
    });
    if (!candidates.length) return [];
    const firstDate = new Date(candidates[0].start || candidates[0].time || candidates[0].timestamp || candidates[0].hour);
    return normalizePriceEntries(candidates.filter((entry) => {
      const date = new Date(entry.start || entry.time || entry.timestamp || entry.hour);
      return date.toDateString() === firstDate.toDateString();
    }));
  }

  // Use the same current-day window as the detailed Energy graph: local
  // midnight through now, expanded across the available chart width.
  function buildOverviewUsageLine(points) {
    if (!points.length) return "";
    const width = 600;
    const height = 100;
    const padY = 8;
    const values = points.map((item) => item.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const now = new Date();
    const elapsedMinutes = Math.max(1, now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60);
    const coordinates = points.map((item, index) => [
      Math.min(1, item.minutes / elapsedMinutes) * width,
      padY + (height - padY * 2) - ((values[index] - min) / range) * (height - padY * 2)
    ]);
    // Curved rather than straight segments purely for a smoother-looking
    // connection between points — the data itself is untouched (each point
    // is still a real per-bucket peak, per loadUtilityHistory), so genuine
    // spikes still read as tall peaks, just with rounded sides instead of
    // razor-sharp triangles.
    const line = BeastCore.catmullRomPath(coordinates);
    const last = coordinates[coordinates.length - 1];
    const area = `${line} L${last[0].toFixed(1)} ${height} L${coordinates[0][0].toFixed(1)} ${height} Z`;
    const dotLeftPct = (last[0] / width) * 100;
    const dotTopPct = (last[1] / height) * 100;
    // A Catmull-Rom curve can overshoot *between* two points, not just past
    // the first/last one — clipping only at the SVG's own edges (0..height)
    // still let it dip a few px below the lowest real value before hitting
    // that edge, which read as "going negative" for a mostly-zero series
    // like Varme/Vand. Clipping the line's own clip-path at the exact y of
    // the lowest recorded point makes that dip impossible: nothing can ever
    // render below where the real minimum actually is. The area fill keeps
    // its own full-height clip so it still reaches the widget's bottom.
    const lowestY = Math.max(...coordinates.map((c) => c[1]));
    // Colours the line by level when that mode is on -- see
    // BeastCore.chartLineGradient(); null means keep the plain stroke.
    const bandBounds = { width, height, top: padY, bottom: height - padY };
    const lineGradient = BeastCore.chartLineStroke(coordinates, values, bandBounds);
    const areaFill = BeastCore.chartAreaFill(coordinates, values, { ...bandBounds, topOpacity: 0.34 });
    return `<div class="beast-ov-utility-line-wrap">
      <svg class="beast-ov-utility-line" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Forbrug fra midnat til nu">
        <defs>
          ${lineGradient.defs}
          ${areaFill.defs}
          <clipPath id="beastOvUtilityAreaClip"><rect x="0" y="0" width="${width}" height="${height}"></rect></clipPath>
          <clipPath id="beastOvUtilityLineClip"><rect x="0" y="0" width="${width}" height="${lowestY.toFixed(1)}"></rect></clipPath>
        </defs>
        <path class="beast-ov-utility-line-area" fill="${areaFill.fill}" mask="${areaFill.mask}" d="${area}" clip-path="url(#beastOvUtilityAreaClip)"></path>
        <path class="beast-ov-utility-line-path" d="${line}" clip-path="url(#beastOvUtilityLineClip)" style="stroke:${lineGradient.stroke}"></path>
      </svg>
      <span class="beast-ov-utility-dot" style="left:${dotLeftPct.toFixed(2)}%;top:${dotTopPct.toFixed(2)}%"></span>
    </div>`;
  }

  // Follows the same shared setting as the Energy page's own usage graph
  // (panels.energy.usageChartType), so switching there switches here too --
  // it's one preference about how usage is drawn, not a per-screen one.
  function buildOverviewUsageBars(points) {
    if (!points.length) return "";
    const width = 600;
    const height = 100;
    const padY = 8;
    const values = points.map((item) => item.value);
    const max = Math.max(...values, 0.001);
    // Bucketed to a readable column count: the raw series is far denser
    // than this card is wide, so one bar per point would be sub-pixel.
    const barCount = Math.min(40, values.length);
    const bucketed = Array.from({ length: barCount }, (_, index) => {
      const start = Math.floor((index * values.length) / barCount);
      const end = Math.max(start + 1, Math.floor(((index + 1) * values.length) / barCount));
      const bucket = values.slice(start, end);
      return bucket.reduce((sum, value) => sum + value, 0) / bucket.length;
    });
    const slot = width / barCount;
    const barWidth = Math.max(1.5, slot * 0.66);
    const bars = bucketed.map((value, index) => {
      const barHeight = Math.max(1, (value / max) * (height - padY));
      const x = slot * index + (slot - barWidth) / 2;
      // Shared colour settings, so bars and lines follow the same choice.
      const ratio = Math.max(0, Math.min(1, value / (max || 1)));
      const fill = BeastCore.chartColorForRatio(ratio);
      return `<rect x="${x.toFixed(1)}" y="${(height - barHeight).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="${Math.min(2, barWidth / 2).toFixed(1)}" style="fill:${fill}"></rect>`;
    }).join("");
    return `<div class="beast-ov-utility-line-wrap">
      <svg class="beast-ov-utility-line beast-ov-utility-bars" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Forbrug fra midnat til nu, vist som søjler">
        <g>${bars}</g>
      </svg>
    </div>`;
  }

  // El, Varme and Vand each keep their own choice: a spiky electricity
  // trace and a slow-moving water total genuinely suit different shapes, so
  // one shared setting forced a compromise on at least one of them.
  // panels.energy.usageChartType stays the fallback -- it's the "default"
  // set in Administration, used until a view is given its own answer.
  // Each utility view is its own graph as far as this setting is concerned:
  // a spiky electricity trace and a slow-moving water total genuinely suit
  // different shapes. Keys go through the shared store in BeastCore so every
  // graph in the dashboard is handled the same way.
  function usageChartKey(view) { return `overview.utility.${view}`; }

  function buildOverviewUsageChart(points) {
    return BeastCore.chartType(usageChartKey(utilityView)) === "bars"
      ? buildOverviewUsageBars(points)
      : buildOverviewUsageLine(points);
  }

  // Only while the front page is in edit mode: this is a layout decision,
  // so it belongs with the other edit-mode controls rather than taking up
  // space in the card during normal use.
  function usageChartTypeEditorMarkup() {
    if (!overviewCardEditor?.isEditing()) return "";
    return BeastCore.chartTypeToggleMarkup(usageChartKey(utilityView), `${UTILITY_VIEWS[utilityView]?.label || ""}-graf`);
  }

  // Keep the five axis markers aligned with the current-day window.
  function utilityAxisLabels() {
    const now = new Date();
    const elapsedMinutes = now.getHours() * 60 + now.getMinutes();
    return Array.from({ length: 5 }, (_, index) => {
      if (index === 4) return t("Nu", "Now");
      const minutes = Math.round((elapsedMinutes * index) / 4);
      return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    });
  }

  function renderEnergy() {
    const host = document.getElementById("beastOvEnergy");
    if (!host) return;
    const config = UTILITY_VIEWS[utilityView];
    const utilityState = BeastHaSocket.getState(config.current);
    const todayState = BeastHaSocket.getState(config.today);
    const priceState = BeastHaSocket.getState(PRICE_ENTITY_ID);
    const utilityValue = utilityState && Number.isFinite(Number(utilityState.state)) ? Number(utilityState.state) : null;
    const price = priceState && Number.isFinite(Number(priceState.state)) ? Number(priceState.state) : null;
    const level = price !== null ? priceLevel(price) : { label: "–", cls: "" };
    const displayValue = utilityValue === null ? "–" : utilityView === "electric"
      ? (utilityValue >= 1000 ? `${(utilityValue / 1000).toFixed(2)} kW` : `${Math.round(utilityValue)} W`)
      : utilityView === "heat" ? `${utilityValue.toFixed(2)} kW` : `${utilityValue.toFixed(3)} m³`;
    const todayValue = todayState && Number.isFinite(Number(todayState.state)) ? Number(todayState.state) : null;
    const todayDisplay = todayValue === null ? "–" : `${todayValue.toFixed(config.todayUnit === "m³" ? 3 : config.todayUnit === "L/h" ? 0 : 2)} ${config.todayUnit}`;
    const priceSeries = getOverviewPriceSeries(overviewPriceView);
    const maxPrice = Math.max(...priceSeries.map((item) => item.value), 0.01);
    const minPrice = priceSeries.length ? Math.min(...priceSeries.map((item) => item.value)) : null;
    const highPrice = priceSeries.length ? Math.max(...priceSeries.map((item) => item.value)) : null;
    const advice = energyAdvice(priceSeries, price, utilityView === "electric" ? utilityValue : Number(BeastHaSocket.getState(POWER_ENTITY_ID)?.state));

    host.innerHTML = `
      <div class="beast-ov-energy-shell">
        <div class="beast-ov-energy-head">
          <div>
            <span class="beast-ov-energy-label">${config.label} lige nu</span>
            <strong>${displayValue}</strong>
            <small>I dag ${todayDisplay}</small>
          </div>
          <div class="beast-ov-utility-toggle">
            ${Object.entries(UTILITY_VIEWS).map(([key, item]) => `<button type="button" data-utility="${key}" class="${utilityView === key ? "is-active" : ""}">${item.label}</button>`).join("")}
          </div>
        </div>
        ${usageChartTypeEditorMarkup()}
        <div class="beast-ov-utility-chart">
          ${utilityHistory.length ? buildOverviewUsageChart(utilityHistory) : `<i>${utilityHistoryLoading ? "Henter dagsgraf…" : "Ingen historik"}</i>`}
        </div>
        <div class="beast-ov-chart-axis">${utilityAxisLabels().map((label) => `<span>${label}</span>`).join("")}</div>
        <div class="beast-ov-price-head">
          <div>
            <span class="beast-ov-energy-price ${level.cls}">${price !== null ? price.toFixed(2) : "–"} kr/kWh · ${level.label}</span>
            <small>${minPrice !== null ? `Lav ${minPrice.toFixed(2)} · Høj ${highPrice.toFixed(2)}` : "Ingen priser tilgængelige"}</small>
          </div>
          <div class="beast-ov-price-toggle">
            <button type="button" data-price-view="today" class="${overviewPriceView === "today" ? "is-active" : ""}">I dag</button>
            <button type="button" data-price-view="tomorrow" class="${overviewPriceView === "tomorrow" ? "is-active" : ""}">I morgen</button>
            <button type="button" data-price-view="future" class="${overviewPriceView === "future" ? "is-active" : ""}">Frem</button>
          </div>
        </div>
        <div class="beast-ov-price-chart">
          ${priceSeries.length ? priceSeries.map((item, index) => {
            const active = overviewPriceView === "today" && index === new Date().getHours();
            const isMin = item.value === minPrice;
            const isMax = item.value === highPrice;
            return `<span class="${active ? "is-current " : ""}${isMin ? "is-min " : ""}${isMax ? "is-max" : ""}" style="height:${Math.max(7, (item.value / maxPrice) * 100)}%;--delay:${index * 18}ms;--price-hue:${Math.max(0, 150 - ((item.value - (minPrice || 0)) / Math.max(0.01, highPrice - (minPrice || 0))) * 150)}" title="${item.label}:00 · ${item.value.toFixed(2)} kr/kWh"></span>`;
          }).join("") : `<i>Ingen prisdata for valgt dag</i>`}
        </div>
        <div class="beast-ov-chart-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
        <div class="beast-ov-energy-foot">
          <span class="beast-ov-energy-advice">${BeastCore.icon(advice.icon, { size: 16 })}<span><b>${escapeHtml(advice.title)}</b><small>${escapeHtml(advice.detail)}</small></span></span>
          <button type="button" class="beast-ov-energy-details">${BeastCore.icon("chevron-right", { size: 16 })} Fuld visning</button>
        </div>
      </div>
    `;
    host.querySelectorAll("[data-utility]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (utilityView === button.dataset.utility) return;
        utilityView = button.dataset.utility;
        utilityHistory = [];
        renderEnergy();
        loadUtilityHistory();
      });
    });
    host.querySelectorAll("[data-price-view]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        overviewPriceView = button.dataset.priceView;
        renderEnergy();
      });
    });
    host.querySelector(".beast-ov-energy-details")?.addEventListener("click", (event) => {
      event.stopPropagation();
      document.querySelector('.beast-rail-btn[data-section="energy"]')?.click();
    });
  }

  async function loadUtilityHistory() {
    if (utilityHistoryLoading) return;
    utilityHistoryLoading = true;
    renderEnergy();
    const config = UTILITY_VIEWS[utilityView];
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    // 5-minute buckets to match Home Assistant's own history graph
    // interval — same data resolution, not just a similar look.
    const elapsedMinutes = Math.max(1, (Date.now() - start.getTime()) / 60000);
    const bucketCount = Math.max(6, Math.min(288, Math.ceil(elapsedMinutes / 5)));
    const bucketMinutes = elapsedMinutes / bucketCount;
    try {
      const result = await BeastAuth.haFetch(`/api/history/period/${start.toISOString()}?filter_entity_id=${encodeURIComponent(config.history)}&minimal_response`);
      const rows = (result && result[0]) || [];
      const buckets = Array.from({ length: bucketCount }, () => []);
      rows.forEach((row) => {
        const value = Number(row.state ?? row.s);
        const date = new Date(row.last_changed || row.lc || row.last_updated);
        if (!Number.isFinite(value) || Number.isNaN(date.getTime())) return;
        const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((date - start) / 60000 / bucketMinutes)));
        buckets[index].push(value);
      });
      let previousRaw = null;
      let lastAverage = null;
      utilityHistory = buckets.map((values, index) => {
        let value;
        if (values.length) {
          if (config.mode === "delta") {
            value = Math.max(0, values[values.length - 1] - (previousRaw ?? values[0]));
            previousRaw = values[values.length - 1];
          } else {
            // Peak, not mean: averaging a bucket's raw readings together is
            // exactly what smooths short spikes away, which is the one
            // thing a "so you can see spikes" chart can't do.
            value = Math.max(...values);
            lastAverage = value;
          }
        } else {
          value = config.mode === "delta" ? 0 : (lastAverage ?? 0);
        }
        const minutes = index * bucketMinutes;
        const bucketStart = new Date(start.getTime() + minutes * 60000);
        return { value, minutes, label: `${String(bucketStart.getHours()).padStart(2, "0")}:${String(bucketStart.getMinutes()).padStart(2, "0")}` };
      });
    } catch (error) {
      utilityHistory = [];
      BeastCore.log(`Oversigt: kunne ikke hente ${config.label.toLowerCase()}historik (${error.message}).`);
    } finally {
      utilityHistoryLoading = false;
      renderEnergy();
    }
  }

  function renderMusic() {
    const host = document.getElementById("beastOvClockMusic");
    if (!host || !window.BeastMusic) return;
    if (!isFloatingPlayerEnabled()) {
      window.clearTimeout(overviewPlayerHideTimerId);
      host.innerHTML = "";
      host.classList.remove("beast-ov-clock-music", "is-expanded");
      overviewPlayerExpanded = false;
      return;
    }
    const nowPlaying = window.BeastMusic.getNowPlaying();
    if (!nowPlaying || !nowPlaying.title) {
      window.clearTimeout(overviewPlayerHideTimerId);
      host.innerHTML = "";
      host.classList.remove("beast-ov-clock-music");
      return;
    }
    if (nowPlaying.playing) {
      lastOverviewPlaybackAt = Date.now();
      window.clearTimeout(overviewPlayerHideTimerId);
    } else {
      if (!lastOverviewPlaybackAt) lastOverviewPlaybackAt = Date.now();
      const idleFor = Date.now() - lastOverviewPlaybackAt;
      if (idleFor >= OVERVIEW_PLAYER_IDLE_HIDE_MS) {
        host.innerHTML = "";
        host.classList.remove("beast-ov-clock-music", "is-expanded");
        overviewPlayerExpanded = false;
        return;
      }
      window.clearTimeout(overviewPlayerHideTimerId);
      overviewPlayerHideTimerId = window.setTimeout(() => {
        stableMusicRender?.();
      }, OVERVIEW_PLAYER_IDLE_HIDE_MS - idleFor + 50);
    }
    host.classList.add("beast-ov-clock-music");
    host.classList.toggle("is-expanded", overviewPlayerExpanded);
    const volume = Math.round((nowPlaying.volume || 0) * 100);
    host.innerHTML = `
      <button type="button" class="beast-ov-music-summary" aria-expanded="${overviewPlayerExpanded}" aria-label="Åbn mediestyring">
        <span class="beast-ov-music-drag" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
        <img class="beast-ov-clock-music-art" id="beastOvMusicArt" alt="">
        <div class="beast-ov-clock-music-info">
          <span class="beast-ov-clock-music-title">${escapeHtml(nowPlaying.title)}</span>
          <span class="beast-ov-clock-music-artist">${escapeHtml(nowPlaying.artist)}</span>
        </div>
        ${nowPlaying.playing ? `<div class="beast-ov-eq"><span></span><span></span><span></span></div>` : ""}
        <span class="beast-ov-music-expand">${BeastCore.icon("chevron-up", { size: 17 })}</span>
      </button>
      <div class="beast-ov-music-controls">
        <button type="button" data-media-action="media_previous_track" aria-label="Forrige nummer">${BeastCore.icon("skip-back", { size: 17 })}</button>
        <button type="button" class="is-primary" data-media-action="media_play_pause" aria-label="${nowPlaying.playing ? "Pause" : "Afspil"}">${BeastCore.icon(nowPlaying.playing ? "pause" : "play", { size: 18 })}</button>
        <button type="button" data-media-action="media_stop" aria-label="Stop"><span class="beast-ov-stop-icon"></span></button>
        <button type="button" data-media-action="media_next_track" aria-label="Næste nummer">${BeastCore.icon("skip-forward", { size: 17 })}</button>
        <label class="beast-ov-music-volume">${BeastCore.icon(nowPlaying.muted ? "volume-mute" : "volume", { size: 15 })}<input type="range" min="0" max="100" value="${volume}" aria-label="Lydstyrke"></label>
      </div>
    `;
    const art = document.getElementById("beastOvMusicArt");
    if (art && nowPlaying.picture) {
      if (/^https?:\/\//i.test(nowPlaying.picture)) art.src = nowPlaying.picture;
      else BeastAuth.setAuthedImageSrc(art, nowPlaying.picture);
    }
    host.querySelector(".beast-ov-music-summary")?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (Date.now() < overviewPlayerDraggedUntil) return;
      overviewPlayerExpanded = !overviewPlayerExpanded;
      host.classList.toggle("is-expanded", overviewPlayerExpanded);
      event.currentTarget.setAttribute("aria-expanded", String(overviewPlayerExpanded));
      window.requestAnimationFrame(() => positionOverviewPlayer(host));
    });
    wireOverviewPlayerDrag(host);
    host.querySelectorAll("[data-media-action]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        callService("media_player", button.dataset.mediaAction, nowPlaying.entityId);
      });
    });
    const volumeSlider = host.querySelector(".beast-ov-music-volume input");
    let volumeTimerId = null;
    volumeSlider?.addEventListener("input", (event) => {
      event.stopPropagation();
      window.clearTimeout(volumeTimerId);
      volumeTimerId = window.setTimeout(() => {
        callService("media_player", "volume_set", nowPlaying.entityId, { volume_level: Number(volumeSlider.value) / 100 });
      }, 140);
    });
    volumeSlider?.addEventListener("click", (event) => event.stopPropagation());
  }

  function renderAll() {
    renderBanners();
    renderClock();
    renderWeather();
    renderCameras();
    renderSecurity();
    renderEnergy();
    renderGenericWidgets();
    applyOverviewLayout();
  }

  // Shared by the top-level car/pool/robots/printer overview cards and the
  // clock card's two "quick tile" slots, so both pick their entity/label/
  // icon from exactly one place instead of two definitions silently
  // drifting apart.
  function genericWidgetDefinitions() {
    const config = BeastConfig.getAll();
    return {
      car: { label:"Bil", entity:config.panels?.car?.battery, suffix:"%", icon:"car", detail:"Batteri" },
      pool: { label:"Pool", entity:config.panels?.pool?.waterTemp, suffix:"°", icon:"droplet", detail:"Temperatur" },
      robots: { label:"Robotter", entity:[...(config.panels?.robots?.vacuums || []),...(config.panels?.robots?.mowers || [])][0], suffix:"", icon:"robot", detail:"Aktuel status" },
      printer: { label:"3D-printer", entity:config.panels?.printer?.statusSensor, suffix:"", icon:"printer", detail:"Printstatus" },
      heatpump: { label:"Varmepumpe", entity:(config.panels?.heating?.heatPumps || [])[0], suffix:"", icon:"wind", detail:"Varme og temperatur" }
    };
  }

  function renderGenericWidgets() {
    const definitions = genericWidgetDefinitions();
    document.querySelectorAll("[data-widget] .beastOvGeneric").forEach((host) => {
      const card = host.closest("[data-widget]"), type = card.dataset.widget;
      const definition = definitions[type] || { label:card.dataset.label || "Home Assistant", entity:card.dataset.entity, suffix:"", icon:"grid", detail:"Aktuel værdi" };
      if (card.dataset.entity) definition.entity = card.dataset.entity;
      let state = BeastHaSocket.getState(definition.entity);
      // A saved overview card can point at an entity that was renamed or
      // replaced later in Administration. Keep the explicit choice when it
      // is valid, but recover to the first configured live heat pump instead
      // of leaving the card permanently unavailable.
      if (type === "heatpump" && !state) {
        const configured = BeastConfig.get("panels.heating.heatPumps") || [];
        const fallbackEntity = configured.find((entityId) => BeastHaSocket.getState(entityId));
        if (fallbackEntity) {
          definition.entity = fallbackEntity;
          state = BeastHaSocket.getState(fallbackEntity);
        }
      }
      const unavailable = !state || ["unknown","unavailable"].includes(state.state);
      const label = card.dataset.label || definition.label;
      const isHeatPump = type === "heatpump";
      const current = Number(state?.attributes?.current_temperature);
      const target = Number(state?.attributes?.temperature);
      const value = isHeatPump && Number.isFinite(current) ? `${current.toFixed(1)}°` : (unavailable ? "Ikke tilgængelig" : `${state.state}${definition.suffix}`);
      const detail = isHeatPump ? `${state?.attributes?.hvac_action || state?.state || "–"}${Number.isFinite(target) ? ` · Mål ${target.toFixed(1)}°` : ""}` : (state?.attributes?.friendly_name || definition.detail);
      if (isHeatPump && state) {
        const attributes = state.attributes || {};
        const modes = Array.isArray(attributes.hvac_modes) ? attributes.hvac_modes : [];
        const fanModes = Array.isArray(attributes.fan_modes) ? attributes.fan_modes : [];
        const presetModes = Array.isArray(attributes.preset_modes) ? attributes.preset_modes : [];
        const swingModes = Array.isArray(attributes.swing_modes) ? attributes.swing_modes : [];
        const modeLabels = {
          off:t("Slukket", "Off"), heat:t("Varme", "Heat"), heating:t("Varmer", "Heating"),
          cool:t("Køl", "Cool"), cooling:t("Køler", "Cooling"), heat_cool:"Auto", auto:"Auto",
          dry:t("Affugt", "Dry"), drying:t("Affugter", "Drying"), fan_only:t("Blæser", "Fan"),
          fan:t("Blæser", "Fan"), idle:t("Klar", "Ready"), none:t("Ingen", "None"),
          low:t("Lav", "Low"), medium_low:t("Mellem-lav", "Medium low"), medium:t("Mellem", "Medium"),
          medium_high:t("Mellem-høj", "Medium high"), high:t("Høj", "High"), quiet:t("Stille", "Quiet"),
          turbo:"Turbo", manual:t("Manuel", "Manual"), full_swing:t("Fuld bevægelse", "Full swing")
        };
        const modeLabel = (option) => {
          const key = String(option || "").toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
          return modeLabels[key] || String(option || "").replaceAll("_", " ").replaceAll("-", " ");
        };
        const action = String(attributes.hvac_action || state.state || "off").toLowerCase();
        const activeMode = String(state.state || "off").toLowerCase();
        const visualMode = action.includes("heat") ? "heating" : action.includes("cool") ? "cooling" : action.includes("fan") ? "fan" : action === "off" ? "off" : "idle";
        const select = (kind, title, options, selected) => options.length ? `<label><span>${title}</span><select data-heatpump-select="${kind}">${options.map((option) => `<option value="${escapeHtml(option)}"${option === selected ? " selected" : ""}>${escapeHtml(modeLabel(option))}</option>`).join("")}</select></label>` : "";
        host.innerHTML = `<div class="beast-ov-heatpump is-${visualMode}" data-heatpump-entity="${escapeHtml(definition.entity)}">
          <div class="beast-ov-heatpump-head"><span>${BeastCore.icon(visualMode === "heating" ? "bolt" : visualMode === "cooling" ? "droplet" : "wind", { size:22 })}</span><div><small>${escapeHtml(label)}</small><strong>${escapeHtml(attributes.friendly_name || definition.label)}</strong></div><div class="beast-ov-heatpump-state"><i></i><b>${escapeHtml(modeLabel(action))}</b></div><button type="button" data-heatpump-power aria-label="${activeMode === "off" ? t("Tænd varmepumpe", "Turn on heat pump") : t("Sluk varmepumpe", "Turn off heat pump")}" class="${activeMode === "off" ? "" : "is-on"}">${BeastCore.icon("power", { size:18 })}</button></div>
          <div class="beast-ov-heatpump-main"><div class="beast-ov-heatpump-reading"><span><small>${t("Rumtemperatur", "Room temperature")}</small><strong>${escapeHtml(value)}</strong></span><div class="beast-ov-heatpump-target"><button type="button" data-heatpump-temperature="down" aria-label="${t("Sænk måltemperatur", "Lower target temperature")}">${BeastCore.icon("minus", { size:19 })}</button><span><small>${t("Måltemperatur", "Target temperature")}</small><strong>${Number.isFinite(target) ? `${target.toFixed(1)}°` : "–"}</strong></span><button type="button" data-heatpump-temperature="up" aria-label="${t("Hæv måltemperatur", "Raise target temperature")}">${BeastCore.icon("plus", { size:19 })}</button></div></div><div class="beast-ov-heatpump-visual" aria-hidden="true"><span>${BeastCore.icon("fan", { size:34 })}</span><i></i><i></i><i></i></div></div>
          ${modes.length ? `<div class="beast-ov-heatpump-modes">${modes.map((mode) => `<button type="button" data-heatpump-mode="${escapeHtml(mode)}" class="${activeMode === String(mode).toLowerCase() ? "is-active" : ""}">${escapeHtml(modeLabel(mode))}</button>`).join("")}</div>` : ""}
          <div class="beast-ov-heatpump-options">${select("fan_mode", t("Blæser", "Fan"), fanModes, attributes.fan_mode)}${select("preset_mode", t("Program", "Preset"), presetModes, attributes.preset_mode)}${select("swing_mode", t("Retning", "Direction"), swingModes, attributes.swing_mode)}</div>
        </div>`;
        host.querySelectorAll("button,select").forEach((control) => control.addEventListener("click", (event) => event.stopPropagation()));
        host.querySelector("[data-heatpump-power]")?.addEventListener("click", () => {
          const nextMode = activeMode === "off" ? (modes.find((mode) => String(mode).toLowerCase() === "heat") || modes.find((mode) => String(mode).toLowerCase() !== "off")) : "off";
          if (nextMode) callService("climate", "set_hvac_mode", definition.entity, { hvac_mode:nextMode });
        });
        host.querySelectorAll("[data-heatpump-temperature]").forEach((button) => button.addEventListener("click", () => {
          if (!Number.isFinite(target)) return;
          const step = Number(attributes.target_temp_step) || 0.5;
          const min = Number.isFinite(Number(attributes.min_temp)) ? Number(attributes.min_temp) : -Infinity;
          const max = Number.isFinite(Number(attributes.max_temp)) ? Number(attributes.max_temp) : Infinity;
          const temperature = Math.min(max, Math.max(min, target + (button.dataset.heatpumpTemperature === "up" ? step : -step)));
          callService("climate", "set_temperature", definition.entity, { temperature });
        }));
        host.querySelectorAll("[data-heatpump-mode]").forEach((button) => button.addEventListener("click", () => callService("climate", "set_hvac_mode", definition.entity, { hvac_mode:button.dataset.heatpumpMode })));
        host.querySelectorAll("[data-heatpump-select]").forEach((selectEl) => selectEl.addEventListener("change", (event) => {
          event.stopPropagation();
          const field = selectEl.dataset.heatpumpSelect;
          const service = { fan_mode:"set_fan_mode", preset_mode:"set_preset_mode", swing_mode:"set_swing_mode" }[field];
          if (service) callService("climate", service, definition.entity, { [field]:selectEl.value });
        }));
      } else {
        host.innerHTML = `<div class="beast-ov-generic-content"><span>${BeastCore.icon(definition.icon,{size:31})}</span><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><em>${escapeHtml(detail)}</em></div>`;
      }
      card.classList.toggle("is-unavailable", unavailable);
    });
  }

  // Each panel redraws only its own graphs -- see the dispatch in
  // setupChartTypeToggles() (ha-smartdash-app.js).
  document.addEventListener("beast:chart-type-changed", (event) => {
    const key = String(event.detail?.key || "");
    if (key === "*" || key.startsWith("overview.utility.")) renderEnergy();
  });
  // Colours are a global setting rather than a per-graph one, so any config
  // change may have altered them -- redraw so the change is visible without
  // a reload.
  document.addEventListener("beast:config-changed", () => { renderEnergy(); renderCameras(); });

  function init(root) {
    applyConfig();
    zoneEl = root;
    stableMusicRender = BeastCore.stableUpdater(zoneEl, renderMusic, 250);
    overviewCardEditor = BeastCardEditor.attach({
      zoneEl,
      configPath: "overviewCards",
      cardTypes: [
        ["cameras","Kameraer"], ["clock","Ur, kalender og affald"], ["weather","Vejr"], ["security","Sikkerhed"], ["energy","Energi"],
        ["car","Bil"], ["pool","Pool"], ["robots","Robotter"], ["printer","3D-printer"], ["heatpump","Varmepumpe"], ["custom","Valgfri HA-entity"]
      ],
      singleInstanceTypes: ["cameras", "clock", "weather", "security", "energy"],
      renderCardMarkup: (card) => window.overviewCardMarkup(card),
      seedCards: seedCardsFromOverviewSlots,
      allEntities: (type) => {
        const entities = BeastCardEditor.allEntities();
        return type === "heatpump" ? entities.filter((entity) => entity.id.startsWith("climate.")) : entities;
      },
      entityPickerTypes: ["custom", "heatpump"],
      editLabel: "Redigerer forsiden",
      onAfterRender: overviewCardEditorOnAfterRender,
      renderEmptyState: overviewRenderEmptyState,
    });
    renderAll();
    wireOverviewChrome();
    // Do not depend solely on a future socket status transition. On faster
    // installations the HA socket is already connected before this panel is
    // mounted, so no new "connected" event arrives and the front-page
    // forecast/history loaders would otherwise never run.
    loadWeatherForecast();
    loadUtilityHistory();
    window.clearInterval(utilityHistoryTimerId);
    utilityHistoryTimerId = window.setInterval(loadUtilityHistory, 5 * 60 * 1000);
    document.addEventListener("beast:overview-player-setting-changed", () => stableMusicRender());
    document.addEventListener("beast:camera-streams-changed", () => renderAll());

    let hasConnectedOnce = false;
    let reconnectRefreshTimerId = null;
    BeastHaSocket.onStatusChange((status) => {
      if (status !== "connected") return;
      if (!hasConnectedOnce) {
        // First-ever connect for this page load (see the comment above) --
        // refresh immediately, same as always.
        hasConnectedOnce = true;
        renderAll();
        loadWeatherForecast();
        loadUtilityHistory();
        return;
      }
      // A reconnect after being disconnected. A flapping connection can
      // fire "connected" several times within seconds; refreshing on every
      // single one tore the live camera iframes down and rebuilt them
      // each time, which looked like the cameras blinking on their own.
      // Debounce so only the reconnect that actually sticks triggers one
      // refresh, 30s after it settles.
      window.clearTimeout(reconnectRefreshTimerId);
      reconnectRefreshTimerId = window.setTimeout(() => {
        renderAll();
        loadWeatherForecast();
        loadUtilityHistory();
      }, 30000);
    });

    window.clearInterval(clockTimerId);
    clockTimerId = window.setInterval(renderClock, 30000);

    window.clearInterval(cameraRefreshTimerId);
    cameraRefreshTimerId = window.setInterval(refreshCameraSnapshots, 8000);

    // Banners were previously only re-evaluated on a relevant entity state
    // change (a door/lock changing, or a snooze modal closing) -- so a
    // doors/locks alert scheduled for e.g. 22:00-06:00 wouldn't reliably
    // appear or disappear exactly at those times if nothing else happened
    // to touch a door/lock right then; it would just sit stale until the
    // next unrelated state change. A cheap periodic re-render (same
    // interval as the clock) makes the schedule boundary -- and an expired
    // 30-minute snooze -- take effect on their own.
    window.clearInterval(bannerRefreshTimerId);
    bannerRefreshTimerId = window.setInterval(renderBanners, 30000);

    if (WEATHER_ENTITY_ID) BeastHaSocket.subscribeEntity(WEATHER_ENTITY_ID, () => { renderWeather(); applyOverviewLayout(); });
    Object.values(UTILITY_VIEWS).forEach((config) => {
      if (config.current) BeastHaSocket.subscribeEntity(config.current, () => { renderEnergy(); applyOverviewLayout(); });
      if (config.today) BeastHaSocket.subscribeEntity(config.today, renderEnergy);
    });
    [PRICE_ENTITY_ID, PRICE_FORECAST_ENTITY_ID, PRICE_TOMORROW_ID].filter(Boolean).forEach((id) => BeastHaSocket.subscribeEntity(id, () => { renderEnergy(); applyOverviewLayout(); }));
    [...LOCK_IDS, ...DOOR_IDS, ...ALARM_IDS].forEach((id) => BeastHaSocket.subscribeEntity(id, () => { renderSecurity(); applyOverviewLayout(); renderBanners(); }));
    ROBOT_IDS.forEach((robot) => BeastHaSocket.subscribeEntity(robot.id, renderSecurity));
    [PRINTER_STATUS_ID, PRINTER_PROGRESS_ID, PRINTER_REMAINING_ID, PRINTER_TASK_ID, PRINTER_CAMERA_IMAGE_ID, PRINTER_BANNER_CAMERA_ID].filter(Boolean).forEach((id) => BeastHaSocket.subscribeEntity(id, () => { renderBanners(); renderSecurity(); }));
    WASTE_SENSORS.forEach((id) => BeastHaSocket.subscribeEntity(id, renderClock));
    [MAIL_PRESENT_ID, MAIL_COUNT_ID, MAIL_DESCRIPTION_ID, MAIL_IMAGE_ID, MAIL_IMAGE_CARPORT_ID, MAIL_IMAGE_FORHAVEN_ID].filter(Boolean).forEach((id) => BeastHaSocket.subscribeEntity(id, renderBanners));
    if (AULA_MESSAGE_ID) BeastHaSocket.subscribeEntity(AULA_MESSAGE_ID, renderBanners);
    // The "open/unlocked too long" door banner is duration-based, not just
    // state-based -- a door that's been open past the threshold needs its
    // banner to appear even without a NEW state change firing this second.
    // Covered by the tracked bannerRefreshTimerId above (same mechanism,
    // shorter interval) -- this used to be a second, untracked 60s
    // setInterval doing the exact same call, never cleared on re-init.
    let bannerResizeTimerId = null;
    window.addEventListener("resize", () => {
      window.clearTimeout(bannerResizeTimerId);
      bannerResizeTimerId = window.setTimeout(renderBanners, 150);
    });
    [CAR_BATTERY_ID, CAR_RANGE_ID, CAR_CHARGING_ID, POOL_TEMPERATURE_ID].filter(Boolean).forEach((id) => BeastHaSocket.subscribeEntity(id, renderClock));
    ["sensor", "select", "cover", "fan", "binary_sensor"].forEach(domain => BeastHaSocket.subscribeDomain(domain, id => {
      if (Object.values(BeastConfig.get("overviewVentilation.entities") || {}).includes(id)) renderCameras();
    }));
    BeastHaSocket.subscribeDomain("calendar", renderClock);
    BeastHaSocket.subscribeDomain("light", renderSecurity);
    BeastHaSocket.subscribeDomain("media_player", () => { stableMusicRender(); renderSecurity(); });
    BeastHaSocket.subscribeDomain("binary_sensor", (entityId) => {
      if (window.BeastCameras?.isSmartDetectionEntity(entityId)) updateOverviewCameraMotion();
    });
  }

  BeastCore.registerPanel("overviewWidgets", "beastOverviewZone", init);

  // Lets the ambient/screensaver overlay (app.js, a separate full-screen
  // element shown while the whole dashboard including this page is
  // hidden) surface the same active alerts as compact pills, without
  // duplicating the banner-detection/snooze/schedule logic above.
  function activeBannerSummaries() {
    return visibleBanners().map((banner) => ({ type: banner.type, icon: banner.icon, title: banner.title }));
  }

  window.BeastOverview = { isFloatingPlayerEnabled, setFloatingPlayerEnabled, activeBannerSummaries };
})();
