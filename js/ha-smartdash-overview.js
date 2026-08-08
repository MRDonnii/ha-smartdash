(function () {
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
    UTILITY_VIEWS = {
      electric: { label: "El", current: energy.powerSensor, today: energy.totalEnergySensor, history: energy.powerSensor, mode: "average", unit: "W", todayUnit: "kWh" },
      heat: { label: "Varme", current: energy.heatPowerSensor, today: energy.heatEnergySensor, history: energy.heatEnergySensor, mode: "delta", unit: "kW", todayUnit: "kWh" },
      water: { label: "Vand", current: energy.waterUsageSensor, today: energy.waterFlowSensor, history: energy.waterUsageSensor, mode: "delta", unit: "m³", todayUnit: "L/h" }
    };
  }

  let zoneEl = null;
  let clockTimerId = null;
  let cameraRefreshTimerId = null;
  let pendingAlarmAction = null;
  let pendingAlarmTimerId = null;
  let pendingUnlockId = null;
  let pendingUnlockTimerId = null;
  let dailyForecast = [];
  let hourlyForecast = [];
  let utilityView = "electric";
  let utilityHistory = [];
  let utilityHistoryLoading = false;
  let overviewPriceView = "today";
  let stableMusicRender = null;
  let overviewPlayerExpanded = false;
  let lastOverviewPlaybackAt = 0;
  let overviewPlayerHideTimerId = null;
  let overviewPlayerDraggedUntil = 0;
  let bannerDraggedUntil = {};
  const printerImageCache = {}; // role -> { url, sourceId, lastFetchAt }
  const PRINTER_IMAGE_REFRESH_MS = 5000;
  function bannerPositionKey(type) { return `beast_banner_position_${type}_v1`; }
  let overviewEditing = false;
  let contextualFocusTimerId = null;
  let motionFocusSlug = null;
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
  function savedBannerPosition(type) {
    const stored = validPosition(BeastConfig.get(`banners.positions.${type}`));
    if (stored) return stored;
    try {
      const legacy = validPosition(JSON.parse(localStorage.getItem(bannerPositionKey(type)) || "null"));
      if (legacy) {
        saveBannerPosition(type, legacy);
        localStorage.removeItem(bannerPositionKey(type));
        return legacy;
      }
    } catch (error) { /* ignore malformed legacy value */ }
    return null;
  }

  function saveBannerPosition(type, position) {
    BeastConfig.set("banners.positions", { ...(BeastConfig.get("banners.positions") || {}), [type]: position });
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
  function positionBanner(host, type) {
    const saved = savedBannerPosition(type);
    if (saved) applyBannerPosition(host, saved);
  }

  // Stacks every banner that hasn't been individually dragged directly
  // beneath the previous one, using each one's actual measured height --
  // "hænger sammen" (stick together) rather than fixed-size slots.
  function stackDefaultBanners(container, banners) {
    let top = 12;
    banners.forEach((banner) => {
      const host = container.querySelector(`[data-banner-type="${banner.type}"]`);
      if (!host || host.classList.contains("has-custom-position")) return;
      host.style.left = "";
      host.style.transform = "";
      host.style.top = `${top}px`;
      top += host.getBoundingClientRect().height + 12;
    });
  }

  function wireBannerDrag(host, type) {
    positionBanner(host, type);
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
        saveBannerPosition(type, { x: Math.round(rect.left), y: Math.round(rect.top) });
        bannerDraggedUntil[type] = Date.now() + 450;
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
    const calendarItems = Array.from(BeastHaSocket.getAllStates().values())
      .filter((state) => state.entity_id.startsWith("calendar.") && state.attributes.start_time && state.attributes.message)
      .map((state) => ({ label: state.attributes.message, date: new Date(state.attributes.start_time) }))
      .filter((item) => !Number.isNaN(item.date.getTime()) && item.date.getTime() >= Date.now() - 3600000)
      .sort((a, b) => a.date - b.date);
    const wasteItems = getWasteItems();
    const nextWaste = wasteItems[0];
    const carBattery = Number(BeastHaSocket.getState(CAR_BATTERY_ID)?.state);
    const carRange = Number(BeastHaSocket.getState(CAR_RANGE_ID)?.state);
    const carCharging = BeastHaSocket.getState(CAR_CHARGING_ID)?.state === "on";
    const poolTemperature = Number(BeastHaSocket.getState(POOL_TEMPERATURE_ID)?.state);
    host.innerHTML = `
      <div class="beast-ov-fill">
        <div class="beast-ov-clock-time">${h}<span class="beast-ov-clock-colon">:</span>${m}</div>
        <div class="beast-ov-clock-date">${escapeHtml(BeastCore.formatDate(now))}</div>
        <div class="beast-ov-clock-planner">
          <section class="beast-ov-planner-section">
            <div class="beast-ov-planner-title">${BeastCore.icon("calendar", { size: 14 })}<span>Næste aftaler</span></div>
            <div class="beast-ov-calendar-list">
              ${calendarItems.slice(0, 8).map((item) => `
                <div class="beast-ov-calendar-item">
                  <span>${escapeHtml(formatCompactDate(item.date))}</span>
                  <b>${escapeHtml(item.label)}</b>
                </div>
              `).join("") || `<div class="beast-ov-planner-empty">Ingen kommende aftaler</div>`}
            </div>
          </section>
          <section class="beast-ov-planner-section beast-ov-waste-section">
            <div class="beast-ov-planner-title">${BeastCore.icon("grid", { size: 14 })}<span>Affald</span></div>
            ${nextWaste ? `
              <div class="beast-ov-waste-next">
                <div><b>${escapeHtml(nextWaste.name)}</b><span>Næste afhentning</span></div>
                <strong>${nextWaste.days === 0 ? "I dag" : nextWaste.days}<small>${nextWaste.days === 0 ? "afhentes" : (nextWaste.days === 1 ? "dag" : "dage")}</small></strong>
              </div>
            ` : `<div class="beast-ov-planner-empty">Ingen afhentning fundet</div>`}
          </section>
        </div>
        <div class="beast-ov-home-quick">
          <button type="button" class="beast-ov-car-compact" id="beastOvCarCompact">
            <span class="beast-ov-car-icon">${BeastCore.icon(carCharging ? "bolt" : "car", { size: 19 })}</span>
            <span><b>Energitte</b><small>${carCharging ? "Lader" : "Bilbatteri"}</small></span>
            <strong>${Number.isFinite(carBattery) ? Math.round(carBattery) + "%" : "–"}<small>${Number.isFinite(carRange) ? Math.round(carRange) + " km" : ""}</small></strong>
            <i style="--car-pct:${Number.isFinite(carBattery) ? Math.max(0, Math.min(100, carBattery)) : 0}%"></i>
          </button>
          <button type="button" class="beast-ov-car-compact beast-ov-pool-compact" id="beastOvPoolCompact">
            <span class="beast-ov-car-icon">${BeastCore.icon("droplet", { size: 19 })}</span>
            <span><b>Pool</b><small>Vandtemperatur</small></span>
            <strong>${Number.isFinite(poolTemperature) ? poolTemperature.toFixed(1) + "°" : "–"}<small>${Number.isFinite(poolTemperature) ? (poolTemperature >= 26 ? "Badevenlig" : "Kølig") : ""}</small></strong>
          </button>
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
    document.getElementById("beastOvCarCompact")?.addEventListener("click", (event) => {
      event.stopPropagation();
      document.querySelector('.beast-rail-btn[data-section="car"]')?.click();
    });
    document.getElementById("beastOvPoolCompact")?.addEventListener("click", (event) => {
      event.stopPropagation();
      document.querySelector('.beast-rail-btn[data-section="pool"]')?.click();
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

  function printerImages() {
    refreshPrinterImageRole("protect", PRINTER_BANNER_CAMERA_ID);
    refreshPrinterImageRole("indbygget", PRINTER_CAMERA_IMAGE_ID);
    return {
      protect: printerImageCache.protect?.url || null,
      indbygget: printerImageCache.indbygget?.url || null
    };
  }

  const PRINTER_ACTIVE_STATES = ["running", "prepare", "slicing", "pause"];

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
        icon: "bell", image: images.indkorsel, images
      });
    }

    if (featureEnabled("printerBanner") && PRINTER_STATUS_ID) {
      const status = BeastHaSocket.getState(PRINTER_STATUS_ID)?.state;
      if (PRINTER_ACTIVE_STATES.includes(status)) {
        const images = printerImages();
        const progress = Number(BeastHaSocket.getState(PRINTER_PROGRESS_ID)?.state);
        const remaining = Number(BeastHaSocket.getState(PRINTER_REMAINING_ID)?.state);
        const task = validText(BeastHaSocket.getState(PRINTER_TASK_ID)?.state);
        const progressLabel = Number.isFinite(progress) ? `${Math.round(progress)}%` : "";
        banners.push({
          type: "printer", title: status === "pause" ? "Printer på pause" : "Printer kører",
          detail: [progressLabel, task].filter(Boolean).join(" · ") || "Ingen data endnu",
          icon: "printer", image: images.protect || images.indbygget, images,
          progress: Number.isFinite(progress) ? progress : null,
          remaining: Number.isFinite(remaining) ? remaining : null,
          task
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
      const doorScheduleOk = !BeastConfig.get("banners.doorScheduleEnabled") ||
        isWithinBannerSchedule(BeastConfig.get("banners.doorScheduleStart"), BeastConfig.get("banners.doorScheduleEnd"));
      const lockScheduleOk = !BeastConfig.get("banners.lockScheduleEnabled") ||
        isWithinBannerSchedule(BeastConfig.get("banners.lockScheduleStart"), BeastConfig.get("banners.lockScheduleEnd"));
      const longOpen = doorScheduleOk ? DOOR_IDS.map((id) => {
        const state = BeastHaSocket.getState(id);
        if (state?.state !== "on" || !tooLong(state)) return null;
        return BeastEntityPicker.friendlyName(id);
      }).filter(Boolean) : [];
      const longUnlocked = lockScheduleOk ? LOCKS.filter((entry) => {
        const state = BeastHaSocket.getState(entry.id);
        const value = state?.state;
        return value && !["locked", "unknown", "unavailable"].includes(value) && tooLong(state);
      }).map((entry) => entry.label) : [];
      if (longOpen.length || longUnlocked.length) {
        const rows = [
          ...longOpen.map((label) => `${label} — åben`),
          ...longUnlocked.map((label) => `${label} — ulåst`)
        ];
        banners.push({
          type: "doors", title: `${rows.length} ${rows.length === 1 ? "indgang har" : "indgange har"} stået åbne/ulåste længe`,
          detail: rows.join(" · "), icon: "unlock", image: null, rows, compact: true
        });
      }
    }

    return banners;
  }

  function snoozedNotifications() {
    try { return JSON.parse(localStorage.getItem(NOTIFICATION_SNOOZE_KEY) || "{}"); } catch (_) { return {}; }
  }

  function visibleBanners() {
    const snoozed = snoozedNotifications();
    const now = Date.now();
    return activeBanners().filter((banner) => Number(snoozed[banner.type] || 0) < now);
  }

  function renderBanners() {
    const container = document.getElementById("beastOvBanners");
    if (!container) return;
    const banners = visibleBanners();
    const activeTypes = new Set(banners.map((banner) => banner.type));
    container.querySelectorAll("[data-banner-type]").forEach((el) => {
      if (!activeTypes.has(el.dataset.bannerType)) el.remove();
    });
    banners.forEach((banner) => {
      let host = container.querySelector(`[data-banner-type="${banner.type}"]`);
      if (!host) {
        host = document.createElement("div");
        host.className = "beast-ov-mail-banner";
        host.dataset.bannerType = banner.type;
        container.appendChild(host);
      }
      host.classList.toggle("has-image", Boolean(banner.image));
      host.classList.toggle("is-compact", Boolean(banner.compact));
      host.innerHTML = banner.compact
        ? `
          <span class="beast-ov-mail-banner-drag" aria-hidden="true"></span>
          <div class="beast-ov-mail-banner-row">
            <span class="beast-ov-mail-banner-icon-sm">${BeastCore.icon(banner.icon, { size: 18 })}</span>
            <div><strong>${escapeHtml(banner.title)}</strong><small>${escapeHtml(banner.detail)}</small></div>
          </div>
        `
        : `
          <span class="beast-ov-mail-banner-drag" aria-hidden="true"></span>
          ${banner.image ? `<img class="beast-ov-mail-banner-photo" src="${escapeHtml(banner.image)}" alt="">` : `<span class="beast-ov-mail-banner-icon">${BeastCore.icon(banner.icon, { size: 32 })}</span>`}
          <div><strong>${escapeHtml(banner.title)}</strong><small>${escapeHtml(banner.detail)}</small></div>
        `;
      host.onclick = (event) => {
        event.stopPropagation();
        if (Date.now() < (bannerDraggedUntil[banner.type] || 0)) return;
        openBannerDetail(banner);
      };
      wireBannerDrag(host, banner.type);
    });
    stackDefaultBanners(container, banners);
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
          <button type="button" class="beast-btn" data-snooze>Skjul 30 min.</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
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
      if (event.target.closest("[data-snooze]")) {
        snoozeBanner("mail");
        close();
        renderBanners();
      }
    });
  }

  const PRINTER_CAMERA_LABELS = { protect: "Kamera", indbygget: "Indbygget" };

  function openPrinterDetail(banner, activeCamera = "protect") {
    document.getElementById("beastOvBannerModal")?.remove();
    const images = banner.images || printerImages();
    const available = Object.entries(images).filter(([, url]) => url);
    const current = available.length ? (images[activeCamera] ? activeCamera : available[0][0]) : null;
    const overlay = document.createElement("div");
    overlay.id = "beastOvBannerModal";
    overlay.className = "beast-modal-overlay";
    const remainingLabel = Number.isFinite(banner.remaining) ? `${banner.remaining.toFixed(1)} t tilbage` : "";
    const progress = Math.max(0, Math.min(100, banner.progress || 0));
    overlay.innerHTML = `<div class="beast-modal beast-ov-mail-modal" role="dialog" aria-modal="true">
      <div class="beast-modal-header"><div><h3>3D-printer</h3><p>${escapeHtml(banner.task || banner.title)}</p></div><button type="button" class="beast-modal-close" data-close>${BeastCore.icon("close", { size: 22 })}</button></div>
      <div class="beast-modal-body">
        ${current ? `<div class="beast-ov-mail-modal-image"><img src="${escapeHtml(images[current])}" alt=""></div>` : ""}
        ${available.length > 1 ? `<div class="beast-ov-mail-modal-switch">${available.map(([key]) => `<button type="button" data-camera="${key}"${key === current ? " class=\"is-active\"" : ""}>${escapeHtml(PRINTER_CAMERA_LABELS[key] || key)}</button>`).join("")}</div>` : ""}
        <div class="beast-ov-printer-modal-progress"><div class="beast-ov-printer-modal-bar" style="width:${progress}%"></div></div>
        <p class="beast-ov-printer-modal-meta">${Math.round(progress)}%${remainingLabel ? ` · ${remainingLabel}` : ""}</p>
        <div class="beast-ov-mail-modal-actions">
          <button type="button" class="beast-btn beast-btn-primary" data-open-printer>${BeastCore.icon("printer", { size: 17 })}<span>Åbn 3D-printer</span></button>
          <button type="button" class="beast-btn" data-snooze>Skjul 30 min.</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) { close(); return; }
      const cameraButton = event.target.closest("[data-camera]");
      if (cameraButton) { openPrinterDetail(banner, cameraButton.dataset.camera); return; }
      if (event.target.closest("[data-open-printer]")) { close(); document.querySelector('.beast-rail-btn[data-section="printer"]')?.click(); return; }
      if (event.target.closest("[data-snooze]")) {
        snoozeBanner("printer");
        close();
        renderBanners();
      }
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
          <button type="button" class="beast-btn" data-snooze>Skjul 30 min.</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) { close(); return; }
      if (event.target.closest("[data-open-security]")) { close(); document.querySelector('.beast-rail-btn[data-section="security"]')?.click(); return; }
      if (event.target.closest("[data-snooze]")) {
        snoozeBanner("doors");
        close();
        renderBanners();
      }
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
      if (!autoFocusEnabled() || overviewEditing || !zoneEl?.closest(".beast-section")?.classList.contains("is-active")) return;
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
    zoneEl.classList.toggle("is-editing", overviewEditing);
    zoneEl.querySelectorAll("[data-card]").forEach((card) => {
      if (dynamic) {
        const configured = card.dataset.card === "clock" || card.dataset.card === "security" || card.dataset.card === "cameras"
          || BeastConfig.isPanelConfigured(card.dataset.card);
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
      if (!overviewEditing) return;
      const label = document.createElement("div");
      label.className = "beast-ov-edit-label";
      label.innerHTML = `${BeastCore.icon("grid", { size: 15 })}<span>Kan flyttes</span>`;
      card.appendChild(label);
    });
  }

  function openOverviewEditor() {
    overviewEditing = true;
    applyOverviewLayout();
    document.getElementById("beastOvEditorModal")?.remove();
    const layout = savedOverviewLayout();
    const overlay = document.createElement("div");
    overlay.id = "beastOvEditorModal";
    overlay.className = "beast-modal-overlay";
    const columnLayouts = [
      ["compact-wide-camera", "Tid · Vejr · Kamera"], ["compact-camera-wide", "Tid · Kamera · Vejr"],
      ["wide-compact-camera", "Vejr · Tid · Kamera"], ["wide-camera-compact", "Vejr · Kamera · Tid"],
      ["camera-compact-wide", "Kamera · Tid · Vejr"], ["camera-wide-compact", "Kamera · Vejr · Tid"]
    ];
    overlay.innerHTML = `<div class="beast-modal beast-ov-editor-modal" role="dialog" aria-modal="true"><div class="beast-modal-header"><div><h3>Rediger hele forsiden</h3><p>Alle områder kan flyttes. Vejr, energi og kameraer bliver altid på forsiden.</p></div><button type="button" class="beast-modal-close" data-close>${BeastCore.icon("close", { size: 22 })}</button></div><div class="beast-ov-editor-section"><strong>Placering af kolonner</strong><div class="beast-ov-layout-options">${columnLayouts.map(([value,label]) => `<button type="button" data-layout-field="columns" data-layout-value="${value}" class="${layout.columns === value ? "is-active" : ""}">${BeastCore.icon("grid", { size: 18 })}<span>${label}</span></button>`).join("")}</div></div><div class="beast-ov-editor-section"><strong>Det smalle område</strong><div class="beast-ov-layout-options is-two"><button type="button" data-layout-field="compactOrder" data-layout-value="clock-first" class="${layout.compactOrder === "clock-first" ? "is-active" : ""}">Tid over sikkerhed</button><button type="button" data-layout-field="compactOrder" data-layout-value="security-first" class="${layout.compactOrder === "security-first" ? "is-active" : ""}">Sikkerhed over tid</button></div></div><div class="beast-ov-editor-section"><strong>Det brede område</strong><div class="beast-ov-layout-options is-two"><button type="button" data-layout-field="wideOrder" data-layout-value="weather-first" class="${layout.wideOrder === "weather-first" ? "is-active" : ""}">Vejr over energi</button><button type="button" data-layout-field="wideOrder" data-layout-value="energy-first" class="${layout.wideOrder === "energy-first" ? "is-active" : ""}">Energi over vejr</button></div></div><button type="button" class="beast-btn beast-btn-primary" data-done>Færdig</button></div>`;
    document.body.appendChild(overlay);
    const close = () => { overviewEditing = false; applyOverviewLayout(); overlay.remove(); };
    overlay.addEventListener("click", (event) => { if (event.target === overlay || event.target.closest("[data-close],[data-done]")) close(); });
    overlay.querySelectorAll("[data-layout-field]").forEach((button) => button.addEventListener("click", () => {
      const next = savedOverviewLayout();
      next[button.dataset.layoutField] = button.dataset.layoutValue;
      delete next.order;
      localStorage.setItem(OVERVIEW_LAYOUT_KEY, JSON.stringify(next));
      overlay.querySelectorAll(`[data-layout-field="${button.dataset.layoutField}"]`).forEach((item) => item.classList.toggle("is-active", item === button));
      applyOverviewLayout();
    }));
  }

  function wireOverviewChrome() {
    const menu = document.getElementById("beastOvCameraMenu");
    const toggle = document.getElementById("beastOvCameraMenuToggle");
    const closeMenu = () => {
      if (menu) menu.hidden = true;
      toggle?.setAttribute("aria-expanded", "false");
    };
    document.querySelector(".beast-ov-camera-header")?.addEventListener("click", (event) => event.stopPropagation());
    toggle?.addEventListener("click", (event) => {
      event.stopPropagation();
      const opening = menu?.hidden !== false;
      if (menu) menu.hidden = !opening;
      toggle.setAttribute("aria-expanded", String(opening));
    });
    menu?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.target.closest("button")) closeMenu();
    });
    document.addEventListener("click", closeMenu);
    document.getElementById("beastOvEdit")?.addEventListener("click", (event) => { event.stopPropagation(); closeMenu(); openOverviewEditor(); });
    applyOverviewLayout();
  }

  function formatCompactDate(date) {
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return `i dag ${date.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" })}`;
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    if (date.toDateString() === tomorrow.toDateString()) return `i morgen ${date.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" })}`;
    return date.toLocaleDateString("da-DK", { weekday: "short", day: "numeric" });
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
    const state = BeastHaSocket.getState(WEATHER_ENTITY_ID);
    if (!state) {
      host.innerHTML = `<p class="beast-music-empty">Intet vejrdata.</p>`;
      return;
    }
    const meta = BeastCore.weatherMeta(state.state);
    const temp = Number.isFinite(Number(state.attributes.temperature)) ? Math.round(Number(state.attributes.temperature)) : "–";
    const feelsLike = Number.isFinite(Number(state.attributes.apparent_temperature)) ? Math.round(Number(state.attributes.apparent_temperature)) : null;
    const humidity = Number.isFinite(Number(state.attributes.humidity)) ? Math.round(Number(state.attributes.humidity)) : null;
    const wind = Number.isFinite(Number(state.attributes.wind_speed)) ? Math.round(Number(state.attributes.wind_speed)) : null;
    const pressure = Number.isFinite(Number(state.attributes.pressure)) ? Math.round(Number(state.attributes.pressure)) : null;
    const visibility = Number.isFinite(Number(state.attributes.visibility)) ? Number(state.attributes.visibility).toFixed(0) : null;
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
              <span>${escapeHtml(date.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" }))}</span>
              <span>${BeastCore.animatedWeatherIcon(entryMeta.mood, 25)}</span>
              <b>${Number.isFinite(Number(entry.temperature)) ? Math.round(Number(entry.temperature)) + "°" : "–"}</b>
              <small>${Number.isFinite(rain) ? Math.round(rain) + "%" : ""}</small>
            </div>`;
          }).join("") || `<i>Henter timevejret…</i>`}
        </div>
        <div class="beast-ov-week-title"><span>Næste 7 dage</span><small>${getSunSummary()}</small></div>
        <div class="beast-ov-week">
          ${dailyForecast.slice(0, 7).map((entry) => {
            const entryMeta = BeastCore.weatherMeta(entry.condition);
            const date = new Date(entry.datetime);
            const rain = Number(entry.precipitation_probability);
            return `<div class="beast-ov-week-day">
              <span>${escapeHtml(date.toLocaleDateString("da-DK", { weekday: "short" }).replace(".", ""))}</span>
              ${BeastCore.animatedWeatherIcon(entryMeta.mood, 36)}
              <small class="beast-ov-week-condition">${escapeHtml(entryMeta.label || entry.condition || "Ukendt")}</small>
              <div><b>${Number.isFinite(Number(entry.temperature)) ? Math.round(Number(entry.temperature)) + "°" : "–"}</b><small>${Number.isFinite(Number(entry.templow)) ? Math.round(Number(entry.templow)) + "°" : "–"}</small></div>
              <em>${Number.isFinite(rain) ? Math.round(rain) + "%" : "–"}</em>
            </div>`;
          }).join("") || `<span class="beast-ov-week-empty">${dailyForecast.length ? "Ingen gyldige vejrdata" : "Henter ugeudsigten fra Home Assistant…"}</span>`}
        </div>
      </div>
    `;
  }

  async function loadWeatherForecast() {
    try {
      const fetchForecast = (type) => BeastAuth.haFetch("/api/services/weather/get_forecasts?return_response", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_id: WEATHER_ENTITY_ID, type })
      });
      const [dailyResult, hourlyResult] = await Promise.all([fetchForecast("daily"), fetchForecast("hourly")]);
      const extract = (result) => {
        const response = result?.service_response || result;
        const entityResult = response?.[WEATHER_ENTITY_ID] || response;
        return Array.isArray(entityResult?.forecast) ? entityResult.forecast : [];
      };
      dailyForecast = extract(dailyResult);
      hourlyForecast = extract(hourlyResult);
      renderWeather();
    } catch (error) {
      const fallback = BeastHaSocket.getState(WEATHER_ENTITY_ID)?.attributes?.forecast;
      dailyForecast = Array.isArray(fallback) ? fallback : [];
      BeastCore.log(`Oversigt: kunne ikke hente ugevejr (${error.message}).`);
      renderWeather();
    }
  }

  function getSunSummary() {
    const sun = BeastHaSocket.getState("sun.sun");
    if (!sun) return "Dag / nat · regnchance";
    const rising = new Date(sun.attributes.next_rising);
    const setting = new Date(sun.attributes.next_setting);
    const format = (date) => Number.isNaN(date.getTime()) ? "–" : date.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });
    return `Sol op ${format(rising)} · ned ${format(setting)}`;
  }

  function renderCameras() {
    const host = document.getElementById("beastOvCameras");
    if (!host || !window.BeastCameras) return;
    const allCameras = window.BeastCameras.getAllCameras();
    if (!allCameras.length) {
      host.innerHTML = `<p class="beast-music-empty">Ingen kameraer.</p>`;
      return;
    }
    const cameraBySlug = new Map(allCameras.map((camera) => [camera.slug, camera]));
    let selectedSlugs = [];
    try {
      const stored = JSON.parse(localStorage.getItem(OVERVIEW_CAMERA_KEY) || "[]");
      if (Array.isArray(stored)) selectedSlugs = stored.filter((slug) => cameraBySlug.has(slug)).slice(0, OVERVIEW_CAMERA_LIMIT);
    } catch (error) {
      selectedSlugs = [];
    }
    if (!selectedSlugs.length) selectedSlugs = allCameras.slice(0, OVERVIEW_CAMERA_LIMIT).map((camera) => camera.slug);
    let cameras = selectedSlugs.map((slug) => cameraBySlug.get(slug)).filter(Boolean);
    if (autoFocusEnabled() && motionFocusSlug && cameraBySlug.has(motionFocusSlug)) {
      cameras = [cameraBySlug.get(motionFocusSlug), ...cameras.filter((camera) => camera.slug !== motionFocusSlug)].slice(0, OVERVIEW_CAMERA_LIMIT);
    }
    host.innerHTML = `
      <div class="beast-ov-camera-strip" data-count="${cameras.length}">${cameras.map((camera) => `
        <div class="beast-ov-camera-thumb${camera.motion ? " has-motion" : ""}" data-slug="${camera.slug}">
          ${camera.streamName
            ? `<iframe class="beast-ov-camera-live" src="./camera-player.html?v=11&transport=mse&sub=1&src=${encodeURIComponent(camera.streamName)}" title="${escapeHtml(camera.label)} livekamera" frameborder="0" allow="autoplay"></iframe>`
            : `<img class="beast-ov-camera-snapshot" alt="${escapeHtml(camera.label)}">`}
          ${camera.motion ? `<em>${BeastCore.icon("bolt", { size: 12 })} Bevægelse nu</em>` : ""}
        </div>
      `).join("")}</div>
    `;
    cameras.filter((camera) => !camera.streamName && camera.entityPicture).forEach((camera) => {
      const img = host.querySelector(`.beast-ov-camera-thumb[data-slug="${camera.slug}"] img`);
      if (img) BeastAuth.setAuthedImageSrc(img, camera.entityPicture);
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
          <div class="beast-ov-camera-order">
            <strong>Rækkefølge på forsiden</strong>
            <div id="beastOvCameraOrder"></div>
          </div>
          <div class="beast-ov-camera-options">
            ${cameras.map((camera) => `
              <button type="button" class="beast-ov-camera-option${selected.includes(camera.slug) ? " is-selected" : ""}" data-camera-slug="${camera.slug}">
                <img${camera.streamName ? ` src="${window.BeastCameras.snapshotUrl(camera.streamName)}"` : ""} data-camera-picture="${camera.streamName ? "" : escapeHtml(camera.entityPicture || "")}" alt="">
                <span>${escapeHtml(camera.label)}</span>
                <i>${BeastCore.icon("check", { size: 18 })}</i>
              </button>
            `).join("")}
          </div>
          <button type="button" class="beast-btn beast-ov-camera-picker-done" data-close>Færdig</button>
        </div>
      </div>
    `;

    function saveAndRender() {
      localStorage.setItem(OVERVIEW_CAMERA_KEY, JSON.stringify(selected));
      renderCameras();
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
    overlay.querySelectorAll("[data-close]").forEach((button) => {
      button.addEventListener("click", () => {
        saveAndRender();
        overlay.remove();
      });
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        saveAndRender();
        overlay.remove();
      }
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
    const cams = window.BeastCameras.getAllCameras();
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
    const allCameras = window.BeastCameras.getAllCameras();
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
        badge.innerHTML = `${BeastCore.icon("bolt", { size: 12 })} Bevægelse nu`;
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

  // x maps to real minutes-since-midnight over a fixed 1440-minute (full
  // day) axis — like Home Assistant's own history graphs, which show the
  // whole day's timeline and just let the data stop wherever "now" is,
  // rather than stretching whatever's been recorded so far to fill the
  // full width (that made the chart's shape change size/meaning every time
  // it redrew, and never looked like a real "today" graph).
  function buildOverviewUsageLine(points) {
    if (!points.length) return "";
    const width = 600;
    const height = 100;
    const padY = 8;
    const values = points.map((item) => item.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const coordinates = points.map((item, index) => [
      (item.minutes / 1440) * width,
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
    return `<div class="beast-ov-utility-line-wrap">
      <svg class="beast-ov-utility-line" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Forbrug fra midnat til nu">
        <defs>
          <linearGradient id="beastOvUtilityFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#4fb8ff" stop-opacity=".45"></stop>
            <stop offset="100%" stop-color="#4fb8ff" stop-opacity="0"></stop>
          </linearGradient>
          <clipPath id="beastOvUtilityAreaClip"><rect x="0" y="0" width="${width}" height="${height}"></rect></clipPath>
          <clipPath id="beastOvUtilityLineClip"><rect x="0" y="0" width="${width}" height="${lowestY.toFixed(1)}"></rect></clipPath>
        </defs>
        <path class="beast-ov-utility-line-area" fill="url(#beastOvUtilityFill)" d="${area}" clip-path="url(#beastOvUtilityAreaClip)"></path>
        <path class="beast-ov-utility-line-path" d="${line}" clip-path="url(#beastOvUtilityLineClip)"></path>
      </svg>
      <span class="beast-ov-utility-dot" style="left:${dotLeftPct.toFixed(2)}%;top:${dotTopPct.toFixed(2)}%"></span>
    </div>`;
  }

  // Fixed full-day markers — accurate now that buildOverviewUsageLine plots
  // against a real 1440-minute axis instead of stretching whatever's been
  // recorded so far to fill the width.
  const UTILITY_AXIS_LABELS = ["00:00", "06:00", "12:00", "18:00", "24:00"];

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
        <div class="beast-ov-utility-chart">
          ${utilityHistory.length ? buildOverviewUsageLine(utilityHistory) : `<i>${utilityHistoryLoading ? "Henter dagsgraf…" : "Ingen historik"}</i>`}
        </div>
        <div class="beast-ov-chart-axis">${UTILITY_AXIS_LABELS.map((label) => `<span>${label}</span>`).join("")}</div>
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

  function renderGenericWidgets() {
    const config = BeastConfig.getAll();
    const definitions = {
      car: { label:"Bil", entity:config.panels?.car?.battery, suffix:"%", icon:"car", detail:"Batteri" },
      pool: { label:"Pool", entity:config.panels?.pool?.waterTemp, suffix:"°", icon:"droplet", detail:"Vandtemperatur" },
      robots: { label:"Robotter", entity:[...(config.panels?.robots?.vacuums || []),...(config.panels?.robots?.mowers || [])][0], suffix:"", icon:"robot", detail:"Aktuel status" },
      printer: { label:"3D-printer", entity:config.panels?.printer?.statusSensor, suffix:"", icon:"printer", detail:"Printstatus" }
    };
    document.querySelectorAll("[data-widget] .beastOvGeneric").forEach((host) => {
      const card = host.closest("[data-widget]"), type = card.dataset.widget;
      const definition = definitions[type] || { label:card.dataset.label || "Home Assistant", entity:card.dataset.entity, suffix:"", icon:"grid", detail:"Aktuel værdi" };
      const state = BeastHaSocket.getState(definition.entity);
      const unavailable = !state || ["unknown","unavailable"].includes(state.state);
      const label = card.dataset.label || definition.label;
      host.innerHTML = `<div class="beast-ov-generic-content"><span>${BeastCore.icon(definition.icon,{size:31})}</span><small>${escapeHtml(label)}</small><strong>${escapeHtml(unavailable ? "Ikke tilgængelig" : `${state.state}${definition.suffix}`)}</strong><em>${escapeHtml(state?.attributes?.friendly_name || definition.detail)}</em></div>`;
      card.classList.toggle("is-unavailable", unavailable);
    });
  }

  function init(root) {
    applyConfig();
    zoneEl = root;
    stableMusicRender = BeastCore.stableUpdater(zoneEl, renderMusic, 250);
    renderAll();
    wireOverviewChrome();
    document.addEventListener("beast:overview-player-setting-changed", () => stableMusicRender());

    BeastHaSocket.onStatusChange((status) => {
      if (status !== "connected") return;
      renderAll();
      loadWeatherForecast();
      loadUtilityHistory();
    });

    window.clearInterval(clockTimerId);
    clockTimerId = window.setInterval(renderClock, 30000);

    window.clearInterval(cameraRefreshTimerId);
    cameraRefreshTimerId = window.setInterval(refreshCameraSnapshots, 8000);

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
    // The "open/unlocked too long" door banner is duration-based, not just
    // state-based -- a door that's been open past the threshold needs its
    // banner to appear even without a NEW state change firing this second.
    window.setInterval(renderBanners, 60000);
    let bannerResizeTimerId = null;
    window.addEventListener("resize", () => {
      window.clearTimeout(bannerResizeTimerId);
      bannerResizeTimerId = window.setTimeout(renderBanners, 150);
    });
    [CAR_BATTERY_ID, CAR_RANGE_ID, CAR_CHARGING_ID, POOL_TEMPERATURE_ID].filter(Boolean).forEach((id) => BeastHaSocket.subscribeEntity(id, renderClock));
    BeastHaSocket.subscribeDomain("calendar", renderClock);
    BeastHaSocket.subscribeDomain("light", renderSecurity);
    BeastHaSocket.subscribeDomain("media_player", () => { stableMusicRender(); renderSecurity(); });
    BeastHaSocket.subscribeDomain("binary_sensor", (entityId) => {
      if (entityId.endsWith("_motion")) updateOverviewCameraMotion();
    });
  }

  BeastCore.registerPanel("overviewWidgets", "beastOverviewZone", init);

  window.BeastOverview = { isFloatingPlayerEnabled, setFloatingPlayerEnabled };
})();
