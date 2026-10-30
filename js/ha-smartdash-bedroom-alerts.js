// Screensaver camera alert for bedside devices (bedroomView): while the dimmed
// clock screensaver shows, activity in the house's alarm zones pops up a live
// camera on top of it. Signals and cameras come from panels.bedroom
// (alertZoneLog, alertSensors, alertCameras, alertSeconds, alertWhen).
window.BeastBedroomAlerts = (() => {
  const DEFAULT_SECONDS = 45;
  const MAX_EVENT_AGE_MS = 2 * 60 * 1000;
  // A bedside clock a little behind Home Assistant's would otherwise see
  // brand-new entries as coming from the future.
  const MAX_CLOCK_SKEW_MS = 60 * 1000;
  const VIEW_MAX_MS = 3 * 60 * 1000;
  const VIEW_SOURCE = "bedroom-alert-camera";
  const SENSOR_SUFFIX = /_(?:(?:person|vehicle|car|animal|pet|face|license_plate|package|motion|occupancy|presence|moving)(?:_detected|_detection)?|detected|detection)$/;
  const STILL_CAMERA = /snapshot|still|foto|photo|picture|image/i;
  const WHAT_LABELS = { person: "Person", vehicle: "Bil", animal: "Dyr", motion: "Bevægelse" };
  const WHAT_ALIASES = { person: "person", human: "person", face: "person", vehicle: "vehicle", car: "vehicle", licenseplate: "vehicle", license_plate: "vehicle", animal: "animal", pet: "animal" };
  const ICONS = {
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    corners: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'
  };

  let wiredSignature = "";
  let unsubscribers = [];
  let lastZoneEntryAt = 0;
  const sensorStates = new Map();
  let alert = null;
  let view = null;

  function t(da, vars) {
    const text = window.HASmartdashI18n ? window.HASmartdashI18n.t(da) : da;
    return vars ? text.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match)) : text;
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function icon(name, size) {
    return `<svg class="bda-i" width="${size}" height="${size}" viewBox="0 0 24 24" stroke-width="${(36 / size).toFixed(2)}" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;
  }

  function hm(at) {
    const date = new Date(at);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  function cfg() { return BeastConfig.get("panels.bedroom") || {}; }
  function list(value) {
    if (Array.isArray(value)) return value.filter((item) => typeof item === "string" && item.includes("."));
    return typeof value === "string" && value.includes(".") ? [value] : [];
  }
  function state(id) { return id ? BeastHaSocket.getState(id) : null; }
  function enabledHere() { return BeastLocalSettings.get("bedroomView", false) === true; }
  function alertMs() {
    const seconds = Number(cfg().alertSeconds);
    return Math.max(5, Math.min(600, Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_SECONDS)) * 1000;
  }
  function go2rtcBase() { return String(BeastConfig.get("panels.cameras.go2rtcBaseUrl") || "").replace(/\/+$/, ""); }
  function ambientOverlay() {
    const overlay = document.getElementById("beastAmbientMode");
    return overlay && document.body.classList.contains("beast-is-ambient") && overlay.classList.contains("is-visible") ? overlay : null;
  }
  function screenLocked() { return Boolean(document.querySelector(".beast-lock-overlay.is-open, .beast-screen-lock")); }

  // The bedroom's own alarm decides; without one, any alarm the dashboard
  // watches. With no alarm configured anywhere the restriction cannot apply.
  function alarmAllows() {
    if (cfg().alertWhen !== "armed") return true;
    const own = list(cfg().alarm);
    const ids = own.length ? own : list(BeastConfig.get("panels.security.alarmPanels"));
    if (!ids.length) return true;
    return ids.some((id) => /^(armed_|triggered$|pending$)/.test(String(state(id)?.state || "")));
  }

  function isFresh(at, now = Date.now()) {
    return Number.isFinite(at) && now - at <= MAX_EVENT_AGE_MS && at - now <= MAX_CLOCK_SKEW_MS;
  }

  // ---------------------------------------------------------------------------
  // Signals
  // ---------------------------------------------------------------------------
  // "zone|ISO time|what|alarm name;..." newest first. input_text caps the
  // length, so the oldest entry is often cut off mid-way; anything that does
  // not parse is skipped.
  function parseZoneLog(text) {
    return String(text || "").split(";").map((raw) => {
      const parts = raw.split("|");
      if (parts.length < 2) return null;
      const zone = parts[0].trim().toLowerCase();
      const at = Date.parse(parts[1].trim());
      if (!/^[a-z0-9_]+$/.test(zone) || !Number.isFinite(at)) return null;
      return { zone, at, what: String(parts[2] || "").trim(), name: parts.slice(3).join("|").trim() };
    }).filter(Boolean);
  }

  function onZoneLog(st) {
    if (!st || ["unknown", "unavailable"].includes(st.state)) return;
    const entries = parseZoneLog(st.state);
    if (!entries.length) return;
    const unseen = entries.filter((entry) => entry.at > lastZoneEntryAt);
    lastZoneEntryAt = Math.max(lastZoneEntryAt, ...entries.map((entry) => entry.at));
    const now = Date.now();
    unseen.filter((entry) => isFresh(entry.at, now)).sort((a, b) => a.at - b.at).forEach((entry) => {
      trigger({ key: entry.zone, slug: entry.zone, what: whatKind(entry.what), name: zoneName(entry.name), at: entry.at });
    });
  }

  function zoneName(name) {
    return String(name || "").replace(/^\s*zone\s*[-–—:·|]\s*/i, "").trim();
  }

  function whatKind(value) {
    const key = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    return WHAT_ALIASES[key] || WHAT_ALIASES[key.replace(/_/g, "")] || "motion";
  }

  function sensorSlug(id) {
    return id.split(".")[1].replace(SENSOR_SUFFIX, "");
  }

  function sensorWhat(id) {
    const match = id.split(".")[1].match(/_(person|face|vehicle|car|license_plate|animal|pet)(?:_detected|_detection)?$/);
    return match ? whatKind(match[1]) : "motion";
  }

  // Only a clean off -> on edge counts; coming back from unavailable or a
  // reconnect snapshot that still says "on" is not a new detection.
  function onSensor(id, st) {
    const previous = sensorStates.get(id);
    const next = st?.state;
    sensorStates.set(id, next);
    if (next !== "on" || previous !== "off") return;
    const changedAt = Date.parse(st.last_changed || "");
    if (Number.isFinite(changedAt) && !isFresh(changedAt)) return;
    trigger({ key: sensorSlug(id), sensor: id, slug: sensorSlug(id), what: sensorWhat(id), name: "", at: Number.isFinite(changedAt) ? changedAt : Date.now() });
  }

  // ---------------------------------------------------------------------------
  // Event -> camera
  // ---------------------------------------------------------------------------
  function cameraInfo(id) {
    const st = state(id);
    if (!st || st.state === "unavailable" || STILL_CAMERA.test(id)) return null;
    return window.BeastCameras?.resolveCamera?.(id) || null;
  }

  function liveCameras() {
    const cameras = [];
    BeastHaSocket.getAllStates().forEach((st, id) => {
      if (!id.startsWith("camera.")) return;
      const info = cameraInfo(id);
      if (info) cameras.push(info);
    });
    return cameras;
  }

  const QUALITY_RANK = { medium: 0, high: 1, low: 2, standard: 3 };
  function bestOf(cameras) {
    return cameras.slice().sort((a, b) => (QUALITY_RANK[a.quality] ?? 9) - (QUALITY_RANK[b.quality] ?? 9))[0] || null;
  }

  function camerasForSlug(cameras, slug) {
    const exact = cameras.filter((camera) => camera.slug === slug);
    if (exact.length) return exact;
    const prefixed = cameras.filter((camera) => camera.entityId.startsWith(`camera.${slug}_`));
    if (!prefixed.length) return [];
    const shortest = prefixed.reduce((best, camera) => (camera.slug.length < best.slug.length ? camera : best)).slug;
    return prefixed.filter((camera) => camera.slug === shortest);
  }

  // A top-level const in its own script, so not a window property.
  function registry() { return typeof BeastRegistry === "undefined" ? null : BeastRegistry; }

  function camerasForSensor(cameras, sensorId) {
    const deviceId = registry()?.isLoaded() ? registry().getEntityMeta(sensorId)?.deviceId : null;
    if (!deviceId) return [];
    const ids = new Set(registry().getDeviceEntityIds(deviceId, "camera"));
    return cameras.filter((camera) => ids.has(camera.entityId));
  }

  function cameraForEvent(event) {
    const cameras = liveCameras();
    let matches = event.sensor ? camerasForSensor(cameras, event.sensor) : [];
    if (!matches.length) matches = camerasForSlug(cameras, event.slug);
    const allowed = list(cfg().alertCameras).map((id) => cameraInfo(id)).filter(Boolean);
    if (allowed.length) {
      const slugs = new Set(allowed.map((camera) => camera.slug));
      matches = matches.filter((camera) => slugs.has(camera.slug));
      if (!matches.length) return allowed[0];
    }
    return bestOf(matches);
  }

  // Same choice as the bedroom tiles: a medium/low sibling entity for HA's
  // own WebRTC, the matching go2rtc variant as the fallback.
  function streamSpec(camera, wantHigh = false) {
    const siblings = liveCameras().filter((item) => item.slug === camera.slug);
    const order = wantHigh ? ["high", "standard", "medium", "low"] : ["medium", "low", "standard", "high"];
    const pick = (items) => order.map((quality) => items.find((item) => item.quality === quality)).find(Boolean);
    const ha = pick(siblings) || camera;
    const variants = camera.streamVariants || [];
    return { slug: camera.slug, ha, g2r: pick(variants) || variants[0] || null, label: camera.label };
  }

  function streamMarkup(spec) {
    return `<beast-ha-camera-stream data-entity-id="${esc(spec.ha.entityId)}" data-camera-picture="${esc(spec.ha.entityPicture || "")}" data-camera-label="${esc(spec.label)}" data-go2rtc-base="${esc(go2rtcBase())}" data-go2rtc-source="${esc(spec.g2r?.streamName || "")}"></beast-ha-camera-stream>`;
  }

  // ---------------------------------------------------------------------------
  // Pop-up over the screensaver
  // ---------------------------------------------------------------------------
  function trigger(event) {
    if (!enabledHere() || !alarmAllows()) return;
    const overlay = ambientOverlay();
    if (!overlay || screenLocked()) return;
    const camera = cameraForEvent(event);
    if (!camera) return;
    show(overlay, event, camera);
  }

  function show(overlay, event, camera) {
    const now = Date.now();
    const windowMs = alertMs();
    if (!alert) {
      alert = { slug: null, element: null, observer: null, timerId: null, tickId: null, recent: new Map() };
    }
    alert.recent.set(event.key, now);
    alert.recent.forEach((at, key) => { if (now - at > windowMs) alert.recent.delete(key); });
    alert.event = event;
    alert.windowMs = windowMs;
    alert.deadline = now + windowMs;
    if (!alert.element || !alert.element.isConnected) mount(overlay);
    if (alert.slug !== camera.slug) {
      alert.slug = camera.slug;
      alert.camera = camera;
      mountStream(streamSpec(camera));
    }
    renderHead();
    restartCountdown();
    moveClock(overlay, true);
  }

  // ---------------------------------------------------------------------------
  // The screensaver clock steps aside for the pop-up: it shrinks into the top
  // left corner (date beneath it) and grows back when the pop-up closes. Only
  // transform/opacity animate (see the alerts stylesheet); the positions are
  // measured once from the clock's resting place, not every frame.
  // ---------------------------------------------------------------------------
  const CLOCK_EDGE = { x: 32, y: 26 };
  const CLOCK_FONT_PX = 72;
  const DATE_FONT_PX = 17;

  function clockParts(overlay) {
    return [overlay?.querySelector(".beast-ambient-time"), overlay?.querySelector(".beast-ambient-date")];
  }

  function moveClock(overlay, on, { remeasure = false } = {}) {
    if (!overlay) return;
    const [time, date] = clockParts(overlay);
    const wasOn = overlay.classList.contains("has-bd-alert");
    overlay.classList.toggle("has-bd-alert", on);
    if (!on) {
      [time, date].forEach((element) => { if (element) element.style.transform = ""; });
      return;
    }
    if (!time || (wasOn && !remeasure && time.style.transform)) return;
    // Measure the resting layout (no transform), then animate to the corner;
    // a re-measure (rotation, resize) jumps straight to the new spot.
    [time, date].forEach((element) => { if (element) { element.style.transition = "none"; element.style.transform = ""; } });
    const box = overlay.getBoundingClientRect();
    const timeRect = time.getBoundingClientRect();
    const scale = Math.min(1, CLOCK_FONT_PX / (parseFloat(getComputedStyle(time).fontSize) || timeRect.height));
    const edgeY = box.height > box.width ? CLOCK_EDGE.y + 2 : CLOCK_EDGE.y;
    const targets = [[time, CLOCK_EDGE.x - (timeRect.left - box.left), edgeY - (timeRect.top - box.top), scale]];
    if (date) {
      const dateRect = date.getBoundingClientRect();
      const dateScale = Math.min(1, DATE_FONT_PX / (parseFloat(getComputedStyle(date).fontSize) || dateRect.height));
      targets.push([date, CLOCK_EDGE.x + 3 - (dateRect.left - box.left), edgeY + timeRect.height * scale + 10 - (dateRect.top - box.top), dateScale]);
    }
    void time.offsetWidth;
    targets.forEach(([element, x, y, factor]) => {
      if (!remeasure) element.style.transition = "";
      element.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${factor.toFixed(4)})`;
    });
    if (remeasure) {
      void time.offsetWidth;
      targets.forEach(([element]) => { element.style.transition = ""; });
    }
  }

  let resizeTimerId = null;
  function onResize() {
    window.clearTimeout(resizeTimerId);
    resizeTimerId = window.setTimeout(() => {
      const overlay = ambientOverlay();
      if (alert && overlay?.classList.contains("has-bd-alert")) moveClock(overlay, true, { remeasure: true });
    }, 120);
  }

  function mount(overlay) {
    const element = document.createElement("div");
    element.className = "beast-bedroom-alert";
    element.innerHTML = `<div class="bda-card" role="alertdialog" aria-live="assertive">
        <div class="bda-head">
          <span class="bda-dot" aria-hidden="true"></span>
          <div class="bda-title"><b class="bda-what"></b><span class="bda-name"></span></div>
          <span class="bda-more" hidden></span>
          <span class="bda-time"></span>
          <button type="button" class="bda-close" data-bda="close" aria-label="${esc(t("Luk"))}">${icon("x", 20)}</button>
        </div>
        <div class="bda-media" role="button" tabindex="0" data-bda="open">
          <div class="bda-stream"></div>
          <div class="bda-scrim" aria-hidden="true"></div>
          <span class="bda-live" data-live="connecting">${esc(t("Forbinder"))}</span>
          <span class="bda-cam"></span>
          <span class="bda-expand" aria-hidden="true">${icon("corners", 16)}</span>
        </div>
        <div class="bda-bar" aria-hidden="true"><i></i></div>
      </div>`;
    // The screensaver wakes on any pointerdown that reaches it (and the
    // document); the card handles its own taps so closing it keeps the
    // screensaver up.
    element.addEventListener("pointerdown", (pointerEvent) => { if (pointerEvent.target.closest(".bda-card")) pointerEvent.stopPropagation(); });
    element.addEventListener("click", onCardClick);
    element.addEventListener("keydown", (keyEvent) => {
      if ((keyEvent.key === "Enter" || keyEvent.key === " ") && keyEvent.target.matches(".bda-media")) { keyEvent.preventDefault(); openFromAlert(); }
      if (keyEvent.key === "Escape") close();
    });
    overlay.appendChild(element);
    alert.element = element;
    alert.slug = null;
  }

  function mountStream(spec) {
    const element = alert.element;
    alert.observer?.disconnect();
    alert.spec = spec;
    element.querySelector(".bda-stream").innerHTML = streamMarkup(spec);
    element.querySelector(".bda-cam").textContent = spec.label;
    element.querySelector(".bda-media").setAttribute("aria-label", t("Vis {name} i fuld skærm", { name: spec.label }));
    const stream = element.querySelector("beast-ha-camera-stream");
    alert.observer = new MutationObserver(updateLive);
    alert.observer.observe(stream, { attributes: true, attributeFilter: ["class"], childList: true });
    updateLive();
  }

  function updateLive() {
    const element = alert?.element;
    if (!element) return;
    const stream = element.querySelector("beast-ha-camera-stream");
    const live = Boolean(stream && (stream.classList.contains("is-ready") || stream.querySelector("iframe")?.dataset.health === "playing"));
    const pill = element.querySelector(".bda-live");
    if (pill.dataset.live === (live ? "live" : "connecting")) return;
    pill.dataset.live = live ? "live" : "connecting";
    pill.textContent = live ? "LIVE" : t("Forbinder");
  }

  function onPlayerMessage(event) {
    if (event.origin !== window.location.origin || !["camera-player-ready", "camera-player-health"].includes(event.data?.type)) return;
    const frame = alert?.element?.querySelector(".bda-stream iframe");
    if (!frame || frame.contentWindow !== event.source) return;
    frame.dataset.health = event.data.type === "camera-player-ready" ? "playing" : String(event.data.state || "");
    updateLive();
  }

  function renderHead() {
    const { element, event, spec } = alert;
    const others = [...alert.recent.keys()].filter((key) => key !== event.key).length;
    element.querySelector(".bda-what").textContent = t(WHAT_LABELS[event.what] || WHAT_LABELS.motion);
    const name = event.name || spec.label;
    element.querySelector(".bda-name").textContent = name;
    element.querySelector(".bda-cam").hidden = name.toLocaleLowerCase() === spec.label.toLocaleLowerCase();
    element.querySelector(".bda-time").textContent = hm(event.at);
    const more = element.querySelector(".bda-more");
    more.hidden = !others;
    more.textContent = others ? t(others === 1 ? "+{n} zone" : "+{n} zoner", { n: others }) : "";
    element.querySelector(".bda-card").setAttribute("aria-label", `${element.querySelector(".bda-what").textContent} · ${element.querySelector(".bda-name").textContent}`);
  }

  // Stepped once a second rather than one long transition: the low power
  // profile zeroes transition durations, which would empty the bar at once.
  function restartCountdown() {
    window.clearTimeout(alert.timerId);
    window.clearInterval(alert.tickId);
    const bar = alert.element.querySelector(".bda-bar i");
    bar.classList.add("is-reset");
    bar.style.transform = "scaleX(1)";
    void bar.offsetWidth;
    bar.classList.remove("is-reset");
    const tick = () => {
      if (!alert) return;
      const left = Math.max(0, alert.deadline - Date.now());
      bar.style.transform = `scaleX(${Math.max(0, (left - 1000) / alert.windowMs).toFixed(4)})`;
    };
    tick();
    alert.tickId = window.setInterval(tick, 1000);
    alert.timerId = window.setTimeout(close, alert.deadline - Date.now());
  }

  // The card fades out while the clock glides back to the middle; the
  // stream is torn down at once (the card only lingers as a picture).
  function close() {
    if (!alert) return;
    window.clearTimeout(alert.timerId);
    window.clearInterval(alert.tickId);
    alert.observer?.disconnect();
    const element = alert.element;
    alert = null;
    moveClock(document.getElementById("beastAmbientMode"), false);
    if (!element) return;
    element.querySelector(".bda-stream")?.replaceChildren();
    if (!element.isConnected || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) { element.remove(); return; }
    element.classList.add("is-leaving");
    element.style.pointerEvents = "none";
    window.setTimeout(() => element.remove(), 360);
  }

  function onCardClick(event) {
    const target = event.target.closest("[data-bda]");
    if (!target) return;
    event.stopPropagation();
    if (target.dataset.bda === "close") close();
    else if (target.dataset.bda === "open") openFromAlert();
  }

  // ---------------------------------------------------------------------------
  // Tap: leave the screensaver and show the camera full screen
  // ---------------------------------------------------------------------------
  function openFromAlert() {
    const camera = alert?.camera;
    close();
    if (typeof window.noteUserActivity === "function") window.noteUserActivity();
    else window.hideAmbientMode?.();
    if (!camera) return;
    const bedroom = window.BeastBedroom;
    const pageIds = (bedroom?.cameraIds?.() || []).filter((id) => state(id) && state(id).state !== "unavailable");
    const index = pageIds.findIndex((id) => window.BeastCameras?.resolveCamera?.(id)?.slug === camera.slug);
    if (index >= 0 && bedroom?.isActive?.()) bedroom.openCameraView(index);
    else openView(camera);
  }

  // Same look as the bedroom page's own full-screen camera, for a camera
  // that is not one of the page's tiles.
  function openView(camera) {
    closeView();
    const spec = streamSpec(camera, true);
    const element = document.createElement("div");
    element.className = "beast-bedroom-camview";
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-modal", "true");
    element.setAttribute("aria-label", spec.label);
    element.innerHTML = `<div class="bd-cv-media">${streamMarkup(spec)}</div>
      <div class="bd-cv-top"><span class="bd-cv-name">${esc(spec.label)}</span><button type="button" class="bd-cv-close" aria-label="${esc(t("Luk"))}">${icon("x", 22)}</button></div>`;
    element.addEventListener("click", closeView);
    document.body.appendChild(element);
    view = { element, timerId: window.setTimeout(closeView, VIEW_MAX_MS) };
    document.dispatchEvent(new CustomEvent("beast:dashboard-cover", { detail: { source: VIEW_SOURCE, on: true } }));
  }

  function closeView() {
    if (!view) return;
    window.clearTimeout(view.timerId);
    view.element.remove();
    view = null;
    document.dispatchEvent(new CustomEvent("beast:dashboard-cover", { detail: { source: VIEW_SOURCE, on: false } }));
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  // Bedroom devices get their own (larger, Amber) screensaver clock; the
  // class keeps those rules away from every other kiosk.
  function markDevice() {
    document.documentElement.classList.toggle("beast-bedroom-device", enabledHere());
  }

  function sync() {
    markDevice();
    const config = cfg();
    const zoneLog = list(config.alertZoneLog)[0] || null;
    const sensors = list(config.alertSensors);
    const signature = enabledHere() && (zoneLog || sensors.length) ? JSON.stringify([zoneLog, sensors]) : "";
    if (signature !== wiredSignature) {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unsubscribers = [];
      wiredSignature = signature;
      sensorStates.clear();
      if (!signature) { close(); closeView(); return; }
      if (zoneLog) unsubscribers.push(BeastHaSocket.subscribeEntity(zoneLog, (id, next) => onZoneLog(next)));
      sensors.forEach((id) => unsubscribers.push(BeastHaSocket.subscribeEntity(id, onSensor)));
      if (sensors.length) registry()?.ensureLoaded().catch(() => {});
      if (go2rtcBase()) window.BeastCameras?.ensureStreamDiscovery?.(go2rtcBase());
    }
    if (!signature) return;
    if (zoneLog) onZoneLog(state(zoneLog));
    sensors.forEach((id) => onSensor(id, state(id)));
  }

  BeastHaSocket.onStatusChange((status) => { if (status === "connected") sync(); });
  document.addEventListener("beast:config-changed", sync);
  document.addEventListener("beast:local-settings-changed", sync);
  document.addEventListener("beast:ambientchange", (event) => {
    if (!event.detail?.on) { close(); return; }
    closeView();
    // Reopening the screensaver rebuilds its content; a pop-up still inside
    // its window goes back on top.
    const overlay = ambientOverlay();
    if (alert && overlay && !alert.element?.isConnected && Date.now() < alert.deadline) {
      const { event, camera } = alert;
      close();
      show(overlay, event, camera);
    } else if (alert && !alert.element?.isConnected) close();
  });
  document.addEventListener("beast:sectionchange", closeView);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeView(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) closeView(); });
  window.addEventListener("message", onPlayerMessage);
  window.addEventListener("resize", onResize);
  markDevice();

  return { parseZoneLog, close, isShowing: () => Boolean(alert) };
})();
