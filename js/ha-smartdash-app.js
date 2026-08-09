const RAIL_ITEMS = [
  { id: "overview", label: "Oversigt", icon: "home" },
  { id: "weather", label: "Vejr", icon: "cloud" },
  { id: "rooms", label: "Rum", icon: "grid" },
  { id: "cameras", label: "Kameraer", icon: "camera" },
  { id: "security", label: "Sikkerhed", icon: "shield" },
  { id: "music", label: "Musik", icon: "music" },
  { id: "energy", label: "Energi", icon: "bolt" },
  { id: "heating", label: "Varme", icon: "thermometer" },
  { id: "car", label: "Bil", icon: "car" },
  { id: "pool", label: "Pool", icon: "droplet" },
  { id: "waste", label: "Kalender", icon: "calendar" },
  { id: "robots", label: "Robotter", icon: "robot" },
  { id: "printer", label: "3D Printer", icon: "printer" },
  { id: "settings", label: "Administration", icon: "settings" }
];

const MOUNTED_SECTION_ZONES = {
  weather: "beastWeatherZone",
  rooms: "beastRoomsZone",
  cameras: "beastCamerasZone",
  security: "beastSecurityZone",
  music: "beastMusicZone",
  energy: "beastEnergyZone",
  heating: "beastHeatingZone",
  car: "beastCarZone",
  pool: "beastPoolZone",
  waste: "beastWasteZone",
  robots: "beastRobotsZone",
  printer: "beastPrinterZone"
};

const AUTO_RETURN_TO_OVERVIEW_MS = 3 * 60 * 1000;
// Checks GitHub Releases for a new build. Safe to poll fairly often
// despite GitHub's unauthenticated 60 requests/hour-per-IP limit (shared
// by every kiosk and admin tab on this network): api/update.php caches
// its own GitHub-derived answer for 5 minutes server-side, so any number
// of clients polling this often only cost GitHub one real request per
// cache window, not one per poll. This used to be 12 hours, which meant
// an always-on kiosk that's never manually refreshed could sit on a stale
// build for most of a day after a new release shipped -- 10 minutes
// means the idle auto-install (UPDATE_IDLE_AUTOAPPLY_MS below) actually
// gets a chance to run soon after a release goes out, not the next time
// someone happens to touch the screen and reload it themselves.
const BUILD_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const CAMERA_HEALTH_CHECK_INTERVAL_MS = 10 * 1000;
const CAMERA_RECONNECT_AFTER_MS = 20 * 1000;
const CAMERA_RELOAD_AFTER_MS = 48 * 1000;
const FULL_RECOVERY_COOLDOWN_MS = 10 * 60 * 1000;
const AMBIENT_MODE_AFTER_MS = 5 * 60 * 1000;
function screensaverConfig() {
  return BeastLocalSettings.get("screensaver", BeastConfig.get("screensaver")) || { enabled: true, schedule: "custom", startTime: "23:00", endTime: "05:30", offAfterMinutes: 5 };
}
function parseTimeToMinutes(value, fallbackMinutes) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return fallbackMinutes;
  return Number(match[1]) * 60 + Number(match[2]);
}
function KIOSK_SCREEN_ENTITY_ID() { return BeastLocalSettings.get("kioskScreenLight", BeastConfig.get("appEntities.kioskScreenLight")); }
function DOORBELL_BINARY_ID() { return BeastConfig.get("appEntities.doorbellBinarySensor"); }
function DOORBELL_EVENT_ID() { return BeastConfig.get("appEntities.doorbellEvent"); }
const DOORBELL_VIEW_MS = 3 * 60 * 1000;
let lastUserActivityAt = Date.now();
let buildCheckTimerId = null;
let cameraHealthTimerId = null;
let ambientModeTimerId = null;
let ambientClockTimerId = null;
let ambientBrightnessDebounceId = null;
let screenOffTimerId = null;
let morningWakeTimerId = null;
let nightStartTimerId = null;
let kioskScreenIsOff = false;
let doorbellTimerId = null;
let lastDoorbellAt = 0;
let lastDoorbellBinaryState = null;
let eventFocusTimerId = null;
const cameraHealth = new Map();

function noteUserActivity() {
  lastUserActivityAt = Date.now();
  if (kioskScreenIsOff) setKioskScreenPower(true);
  hideAmbientMode();
  scheduleAmbientMode();
}

function setKioskScreenPower(on) {
  if (!window.BeastAuth?.haFetch) return;
  kioskScreenIsOff = !on;
  BeastAuth.haFetch(`/api/services/light/turn_${on ? "on" : "off"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entity_id: KIOSK_SCREEN_ENTITY_ID() })
  }).catch((error) => {
    kioskScreenIsOff = false;
    BeastCore.log(`Skærmstyring: kunne ikke ${on ? "tænde" : "slukke"} kioskskærmen (${error.message}).`);
  });
}

function doorbellCameraStream() {
  const cameras = window.BeastCameras?.getAllCameras?.() || [];
  const configuredCameraId = BeastConfig.get("appEntities.doorbellCamera");
  let camera = configuredCameraId ? cameras.find((item) => item.entityId === configuredCameraId) : null;
  if (!camera) camera = cameras.find((item) => /fordør|fordor|hoveddør|hoveddor/i.test(`${item.slug} ${item.label} ${item.streamName}`));
  return camera?.streamName || "Fordor";
}

function closeDoorbellView() {
  window.clearTimeout(doorbellTimerId);
  document.getElementById("beastDoorbellView")?.remove();
  document.body.classList.remove("beast-doorbell-active");
  scheduleAmbientMode();
}

function featureEnabled(key) { return BeastConfig.get(`features.${key}`) === true; }

function showEventFocus({ title, detail, section, icon = "bell", priority = "normal" }) {
  if (!featureEnabled("eventFocus") || document.querySelector(".beast-doorbell-view")) return;
  document.getElementById("beastEventFocus")?.remove();
  const banner = document.createElement("button");
  banner.type = "button";
  banner.id = "beastEventFocus";
  banner.className = "beast-event-focus";
  banner.dataset.priority = priority;
  banner.innerHTML = `<span>${BeastCore.icon(icon, { size: 23 })}</span><div><strong>${title}</strong><small>${detail}</small></div><b>Åbn</b>`;
  document.body.appendChild(banner);
  banner.addEventListener("click", () => { document.dispatchEvent(new CustomEvent("beast:navigate", { detail: { section } })); banner.remove(); });
  window.clearTimeout(eventFocusTimerId);
  eventFocusTimerId = window.setTimeout(() => banner.remove(), priority === "critical" ? 45000 : 25000);
}

function setupEventFocus() {
  const watch = (entityId, handler) => { if (entityId) BeastHaSocket.subscribeEntity(entityId, (id, next, previous) => handler(next, previous)); };
  const security = BeastConfig.get("panels.security") || {};
  (security.alarmPanels || []).forEach((id) => watch(id, (next, previous) => {
    if (next?.state === "triggered" && previous?.state !== "triggered") showEventFocus({ title: "Alarm aktiveret", detail: next.attributes?.friendly_name || "Kontrollér sikkerhedssystemet", section: "security", icon: "shield", priority: "critical" });
  }));
  watch(BeastConfig.get("panels.pool.personInWater"), (next, previous) => { if (next?.state === "on" && previous?.state !== "on") showEventFocus({ title: "Person i poolen", detail: "Pumpen er stoppet · åbn poolvisningen", section: "pool", icon: "droplet", priority: "important" }); });
  watch(BeastConfig.get("panels.car.charging"), (next, previous) => { if (next?.state === "on" && previous?.state !== "on") showEventFocus({ title: "Bilen lader", detail: "Batteristatus og forventet sluttid er opdateret", section: "car", icon: "bolt" }); });
  watch(BeastConfig.get("panels.printer.statusSensor"), (next, previous) => {
    const value = String(next?.state || "").toLowerCase();
    if (next?.state === previous?.state) return;
    if (/(finish|complete|idle)/.test(value) && /(print|run|busy)/.test(String(previous?.state || "").toLowerCase())) showEventFocus({ title: "Print færdigt", detail: "3D-printeren er klar", section: "printer", icon: "printer" });
    if (/(fail|error|pause)/.test(value)) showEventFocus({ title: "Printer kræver opmærksomhed", detail: `Status: ${next.state}`, section: "printer", icon: "printer", priority: "important" });
  });
}

function quickScenarioMarkup() {
  if (!featureEnabled("quickScenarios")) return "";
  const scenes = BeastConfig.get("appEntities.quickScenes") || [];
  if (!scenes.length) return "";
  return `<div class="beast-quick-scenarios" id="beastQuickScenarios"><button type="button" aria-expanded="false" data-scenario-toggle>${BeastCore.icon("bolt", { size:22 })}<span>Scenarier</span></button><div hidden>${scenes.map((id) => `<button type="button" data-scene="${id}">${(BeastHaSocket.getState(id)?.attributes?.friendly_name || id.split(".")[1] || id).replaceAll("_"," ")}</button>`).join("")}</div></div>`;
}

function setupQuickScenarios() {
  const host = document.getElementById("beastQuickScenarios"); if (!host) return;
  const menu = host.querySelector("div"), toggle = host.querySelector("[data-scenario-toggle]");
  toggle.addEventListener("click", () => { menu.hidden = !menu.hidden; toggle.setAttribute("aria-expanded", String(!menu.hidden)); });
  host.querySelectorAll("[data-scene]").forEach((button) => button.addEventListener("click", async () => {
    const label = button.textContent.trim();
    if (!window.confirm(`Aktivér scenariet “${label}”?`)) return;
    button.disabled = true;
    await BeastAuth.haFetch("/api/services/scene/turn_on", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({entity_id:button.dataset.scene}) }).catch((error) => BeastCore.log(`Scenario fejlede: ${error.message}`));
    menu.hidden = true; button.disabled = false;
  }));
}

function setupDataQuality() {
  if (!featureEnabled("dataQuality")) return;
  let pending = null;
  const collectIds = (value, result = []) => { if (typeof value === "string" && /^[a-z_]+\.[a-z0-9_]+$/i.test(value)) result.push(value); else if (Array.isArray(value)) value.forEach((item) => collectIds(item, result)); else if (value && typeof value === "object") Object.values(value).forEach((item) => collectIds(item, result)); return result; };
  const update = () => {
    pending = null;
    Object.entries(MOUNTED_SECTION_ZONES).forEach(([section, zoneId]) => {
      const zone = document.getElementById(zoneId); if (!zone) return;
      zone.querySelector(":scope > .beast-section-quality")?.remove();
      const ids = [...new Set(collectIds(BeastConfig.get(`panels.${section}`) || {}))];
      if (!ids.length) return;
      const states = ids.map((id) => BeastHaSocket.getState(id));
      const missing = states.filter((state) => !state || ["unknown","unavailable"].includes(state.state)).length;
      const newest = Math.max(0, ...states.filter(Boolean).map((state) => new Date(state.last_updated || state.last_changed || 0).getTime()));
      const quality = missing ? "unavailable" : (newest && Date.now() - newest > 2 * 3600000 ? "stale" : "live");
      const badge = document.createElement("span"); badge.className = "beast-section-quality"; badge.dataset.quality = quality; badge.textContent = quality === "unavailable" ? `${missing} uden data` : quality === "stale" ? "Seneste kendte data" : "Live data"; zone.prepend(badge);
    });
  };
  const schedule = () => { if (!pending) pending = window.setTimeout(update, 1200); };
  BeastHaSocket.subscribeAll(schedule); BeastHaSocket.onStatusChange((status) => { if (status === "connected") schedule(); }); schedule();
}

function showDoorbellView() {
  if (!featureEnabled("eventFocus")) return;
  const now = Date.now();
  if (now - lastDoorbellAt < 5000) return;
  lastDoorbellAt = now;
  setKioskScreenPower(true);
  hideAmbientMode();
  window.clearTimeout(ambientModeTimerId);
  window.clearTimeout(screenOffTimerId);
  document.getElementById("beastDoorbellView")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "beastDoorbellView";
  overlay.className = "beast-doorbell-view";
  const stream = doorbellCameraStream();
  overlay.innerHTML = `<iframe src="./camera-player.html?v=7&src=${encodeURIComponent(stream)}" title="Fordør livekamera" frameborder="0" allow="autoplay"></iframe><div class="beast-doorbell-head"><span>${BeastCore.icon("bell", { size: 25 })}</span><div><strong>Det ringer på</strong><small>Fordør · livekamera</small></div></div><button type="button" class="beast-doorbell-close" aria-label="Luk dørkamera">${BeastCore.icon("close", { size: 24 })}<span>Luk</span></button><div class="beast-doorbell-live"><i></i> Live</div>`;
  document.body.appendChild(overlay);
  document.body.classList.add("beast-doorbell-active");
  overlay.querySelector(".beast-doorbell-close")?.addEventListener("click", (event) => { event.stopPropagation(); closeDoorbellView(); });
  doorbellTimerId = window.setTimeout(closeDoorbellView, DOORBELL_VIEW_MS);
}

function handleDoorbellBinary() {
  const state = BeastHaSocket.getState(DOORBELL_BINARY_ID())?.state || "off";
  if (state === "on" && lastDoorbellBinaryState !== "on") showDoorbellView();
  lastDoorbellBinaryState = state;
}

function ambientWeather() {
  // BeastHaSocket/BeastConfig are top-level `const` bindings in their own
  // script files, not window properties -- window.BeastHaSocket is always
  // undefined, so this silently fell back to empty state and "-" every
  // time regardless of whether weather data was actually available.
  const allStates = Array.from(BeastHaSocket.getAllStates().values());
  let state = BeastHaSocket.getState(BeastConfig.get("panels.weather.entity"));
  if (!state || ["unknown", "unavailable"].includes(state.state)) {
    state = allStates.find((item) => item.entity_id?.startsWith("weather.") && !["unknown", "unavailable"].includes(item.state));
  }
  let temperature = Number(state?.attributes?.temperature);
  if (!Number.isFinite(temperature)) {
    const fallback = allStates.find((item) => item.entity_id?.startsWith("sensor.") && /ude|outdoor/i.test(`${item.entity_id} ${item.attributes?.friendly_name || ""}`) && Number.isFinite(Number(item.state)) && /°c|c/i.test(item.attributes?.unit_of_measurement || ""));
    temperature = Number(fallback?.state);
  }
  const labels = { sunny: "Solrigt", partlycloudy: "Delvist skyet", cloudy: "Skyet", rainy: "Regn", pouring: "Kraftig regn", fog: "Tåget", windy: "Blæsende", "windy-variant": "Blæsende", lightning: "Torden", "lightning-rainy": "Tordenbyger", snowy: "Sne", "clear-night": "Klart" };
  const condition = state && !["unknown", "unavailable"].includes(state.state) ? state.state : "";
  return { label: labels[condition] || condition || "Aktuelt vejr", temperature: Number.isFinite(temperature) ? `${Math.round(temperature)}°` : "–" };
}

function hideAmbientMode() {
  window.clearTimeout(screenOffTimerId);
  window.clearInterval(ambientClockTimerId);
  ambientClockTimerId = null;
  const overlay = document.getElementById("beastAmbientMode");
  const wasShowing = Boolean(overlay?.classList.contains("is-visible"));
  overlay?.classList.remove("is-visible");
  document.body.classList.remove("beast-is-ambient");
  // Waking from the screensaver should land back on Overview, not
  // whatever section happened to be open before the kiosk went idle --
  // setupNavigation()'s own 3-minute auto-return timer is meant to handle
  // this, but it gets cancelled the moment the page goes hidden (see its
  // visibilitychange listener) and isn't rescheduled until the *next*
  // activity, by which point the just-woken screen has already shown the
  // stale section for a moment. hideAmbientMode() runs on every tap
  // (noteUserActivity() calls it defensively even when nothing was
  // showing), so this only fires for a genuine wake, not every tap.
  if (wasShowing) document.dispatchEvent(new CustomEvent("beast:navigate", { detail: { section: "overview" } }));
}

// Reuses the same active-banner detection/snooze/schedule logic as the
// overview page's own banners (exposed via BeastOverview) rather than
// duplicating it -- the overview page itself is hidden while ambient mode
// is showing, so this is the only way its alerts (post arrived, printer
// done, door open too long) stay visible while the kiosk is idle.
function ambientBannerPillsMarkup() {
  const banners = window.BeastOverview?.activeBannerSummaries?.() || [];
  return banners.map((banner) => `<span data-ambient-banner="${banner.type}">${BeastCore.icon(banner.icon, { size: 22 })}<b>${banner.title}</b></span>`).join("");
}

function updateAmbientClock() {
  const overlay = document.getElementById("beastAmbientMode");
  if (!overlay || !overlay.classList.contains("is-visible")) return;
  const now = new Date();
  const timeEl = overlay.querySelector(".beast-ambient-time");
  const dateEl = overlay.querySelector(".beast-ambient-date");
  if (timeEl) timeEl.textContent = now.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });
  if (dateEl) dateEl.textContent = now.toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long" });
  const summary = overlay.querySelector(".beast-ambient-summary");
  if (summary) {
    summary.querySelectorAll("[data-ambient-banner]").forEach((el) => el.remove());
    summary.insertAdjacentHTML("beforeend", ambientBannerPillsMarkup());
  }
  // Camera tiles without a go2rtc stream fall back to a snapshot fetch via
  // HA's own camera_proxy (see ambientCameraMarkup) -- that only ever ran
  // once, when the screen first went idle; if that single fetch hiccuped
  // (or the entity's signed proxy token had already rotated), the tile
  // stayed blank for the rest of the idle period. Retrying here re-uses
  // the same img element/src rather than rebuilding it, so this can't
  // disturb a tile that's already showing something.
  overlay.querySelectorAll("[data-ambient-camera-picture]").forEach((img) => {
    if (!img.getAttribute("src")) window.BeastAuth?.setAuthedImageSrc?.(img, img.dataset.ambientCameraPicture);
  });
}

// Small tiles in a row at the bottom, not a full-screen background -- the
// ambient screen's own look (gradient, centered clock/summary) stays
// exactly as designed regardless of whether/how many cameras are picked.
// Up to 3; a row with a single centered tile (or two, or three) falls out
// of justify-content:center for free, no per-count layout branching
// needed. Only (re)built when the ambient screen is first shown, not on
// the clock's periodic tick -- otherwise a live feed would restart its
// video stream every 30s along with the clock text.
function ambientCameraMarkup(config) {
  const ids = (config.cameraEntities || []).filter(Boolean).slice(0, 3);
  if (!ids.length) return "";
  // resolveCamera(), not getAllCameras().find() -- the latter is filtered
  // down to the "Kameraer" panel's own allowlist (Administration ->
  // Kameraer -> Kamera-entities), which is a separate, independent
  // selection from the screensaver's own camera picker. A camera picked
  // here but not also in that other allowlist would otherwise silently
  // fail to render.
  const tiles = ids.map((id) => {
    const camera = window.BeastCameras?.resolveCamera?.(id);
    if (!camera) return "";
    if (camera.streamName) {
      const src = `./camera-player.html?v=11&transport=mse&sub=1&src=${encodeURIComponent(camera.streamName)}`;
      return `<div class="beast-ambient-camera-tile"><iframe class="beast-ambient-camera-tile-frame" src="${src}" allow="autoplay"></iframe></div>`;
    }
    if (camera.entityPicture) {
      return `<div class="beast-ambient-camera-tile"><img class="beast-ambient-camera-tile-frame" data-ambient-camera-picture="${camera.entityPicture}" alt=""></div>`;
    }
    return "";
  }).filter(Boolean).join("");
  return tiles ? `<div class="beast-ambient-camera-row">${tiles}</div>` : "";
}

function ambientBrightnessMarkup(config) {
  if (!config.brightnessEnabled || !KIOSK_SCREEN_ENTITY_ID()) return "";
  return `<div class="beast-ambient-brightness"><label>${BeastCore.icon("sun", { size: 16 })}<input type="range" min="5" max="100" value="${Number(config.brightnessPercent) || 80}"></label></div>`;
}

function wireAmbientBrightness(overlay) {
  const input = overlay.querySelector(".beast-ambient-brightness input");
  if (!input) return;
  input.addEventListener("input", (event) => {
    const pct = Number(event.target.value);
    window.clearTimeout(ambientBrightnessDebounceId);
    ambientBrightnessDebounceId = window.setTimeout(() => {
      BeastLocalSettings.set("screensaver", { ...screensaverConfig(), brightnessPercent: pct });
      const kioskLight = KIOSK_SCREEN_ENTITY_ID();
      if (!kioskLight || !window.BeastAuth?.haFetch) return;
      BeastAuth.haFetch("/api/services/light/turn_on", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity_id: kioskLight, brightness_pct: pct })
      }).catch(() => {});
    }, 250);
  });
}

function isNightScreenPeriod(date = new Date()) {
  const config = screensaverConfig();
  if (!config.enabled) return false;
  if (config.schedule === "always") return true;
  const minutes = date.getHours() * 60 + date.getMinutes();
  const start = parseTimeToMinutes(config.startTime, 23 * 60);
  const end = parseTimeToMinutes(config.endTime, 5 * 60 + 30);
  if (start === end) return true;
  if (start > end) return minutes >= start || minutes < end;
  return minutes >= start && minutes < end;
}

function scheduleMorningWake() {
  window.clearTimeout(morningWakeTimerId);
  const config = screensaverConfig();
  if (!config.enabled || config.schedule === "always") return;
  const now = new Date();
  const end = parseTimeToMinutes(config.endTime, 5 * 60 + 30);
  const wake = new Date(now);
  wake.setHours(Math.floor(end / 60), end % 60, 0, 0);
  if (wake <= now) wake.setDate(wake.getDate() + 1);
  morningWakeTimerId = window.setTimeout(() => {
    setKioskScreenPower(true);
    hideAmbientMode();
    document.querySelector('.beast-rail-btn[data-section="overview"]')?.click();
    lastUserActivityAt = Date.now();
    scheduleAmbientMode();
    scheduleMorningWake();
  }, wake.getTime() - now.getTime());
}

function scheduleNightStart() {
  window.clearTimeout(nightStartTimerId);
  const config = screensaverConfig();
  if (!config.enabled || config.schedule === "always") return;
  const now = new Date();
  const start = parseTimeToMinutes(config.startTime, 23 * 60);
  const night = new Date(now);
  night.setHours(Math.floor(start / 60), start % 60, 0, 0);
  if (night <= now) night.setDate(night.getDate() + 1);
  nightStartTimerId = window.setTimeout(() => {
    scheduleAmbientMode();
    scheduleNightStart();
  }, night.getTime() - now.getTime());
}

// force=true skips the schedule check (isNightScreenPeriod/enabled) --
// used by the manual "Start pauseskærm" button in the overview camera
// menu, so someone can preview the screensaver on demand regardless of
// its configured time window.
function showAmbientMode(force = false) {
  const overlay = document.getElementById("beastAmbientMode");
  if ((!force && !isNightScreenPeriod()) || !overlay || document.hidden || document.querySelector(".beast-screen-lock")) return;
  const now = new Date();
  const weather = ambientWeather();
  const securityConfig = BeastConfig.get("panels.security") || {};
  const openDoors = (securityConfig.openingSensors || []).filter((id) => BeastHaSocket.getState(id)?.state === "on").length;
  const unlocked = (securityConfig.locks || []).filter((id) => {
    const value = BeastHaSocket.getState(id)?.state;
    return value && !["locked", "unknown", "unavailable"].includes(value);
  }).length;
  const config = screensaverConfig();
  const clockSizeClass = config.clockSize && config.clockSize !== "medium" ? ` is-size-${config.clockSize}` : "";
  overlay.classList.toggle("has-custom-background", Boolean(config.backgroundImageUrl || config.backgroundColor));
  overlay.style.backgroundImage = config.backgroundImageUrl ? `url("${config.backgroundImageUrl}")` : "";
  overlay.style.backgroundColor = !config.backgroundImageUrl && config.backgroundColor ? config.backgroundColor : "";
  const cameraRowHtml = ambientCameraMarkup(config);
  overlay.classList.toggle("has-camera-row", Boolean(cameraRowHtml));
  overlay.innerHTML = `<div class="beast-ambient-main"><div class="beast-ambient-time${clockSizeClass}">${now.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" })}</div><div class="beast-ambient-date">${now.toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long" })}</div><div class="beast-ambient-summary"><span>${BeastCore.icon("cloud", { size: 26 })}<b>${weather.temperature}</b>${weather.label}</span><span>${BeastCore.icon(unlocked || openDoors ? "unlock" : "shield", { size: 25 })}<b>${unlocked || openDoors ? `${openDoors} åbne · ${unlocked} ulåste` : "Huset er sikret"}</b></span>${ambientBannerPillsMarkup()}</div>${ambientBrightnessMarkup(config)}</div><div class="beast-ambient-bottom${cameraRowHtml ? " has-cameras" : ""}">${cameraRowHtml}<small>Tryk på skærmen for at åbne dashboardet</small></div>`;
  document.querySelectorAll("[data-ambient-camera-picture]").forEach((img) => {
    window.BeastAuth?.setAuthedImageSrc?.(img, img.dataset.ambientCameraPicture);
  });
  wireAmbientBrightness(overlay);
  overlay.classList.add("is-visible");
  document.body.classList.add("beast-is-ambient");
  window.clearTimeout(screenOffTimerId);
  const offAfterMs = Math.max(1, Number(config.offAfterMinutes) || 5) * 60 * 1000;
  screenOffTimerId = window.setTimeout(() => {
    if (document.body.classList.contains("beast-is-ambient") && !document.hidden) setKioskScreenPower(false);
  }, offAfterMs);
  window.clearInterval(ambientClockTimerId);
  ambientClockTimerId = window.setInterval(updateAmbientClock, 30000);
}

function scheduleAmbientMode() {
  window.clearTimeout(ambientModeTimerId);
  window.clearTimeout(screenOffTimerId);
  if (!featureEnabled("idleMode") || !isNightScreenPeriod()) return;
  const idleFor = Date.now() - lastUserActivityAt;
  ambientModeTimerId = window.setTimeout(showAmbientMode, Math.max(0, AMBIENT_MODE_AFTER_MS - idleFor));
}

function currentBuildId() {
  return document.querySelector('meta[name="beast-build"]')?.content || "legacy";
}

// Per-device on purpose — "I already saw this one, don't ask again" is a
// preference about this specific screen, not something to sync centrally.
const UPDATE_SKIP_KEY = "beast_skipped_update_version_v1";
// Long enough that an update banner never yanks the screen away from
// someone actively using it; short enough that an unattended kiosk still
// self-heals within a work day even if nobody ever taps "Opdater nu".
const UPDATE_IDLE_AUTOAPPLY_MS = 30 * 60 * 1000;
let pendingUpdateVersion = null;
let pendingUpdateChangelog = [];
let updateBannerEl = null;

function skippedUpdateVersion() {
  return localStorage.getItem(UPDATE_SKIP_KEY);
}

async function loadChangelogNewerThan(fromVersion) {
  try {
    const response = await fetch(`./changelog.json?_=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return [];
    const entries = await response.json();
    if (!Array.isArray(entries)) return [];
    // Build IDs are date-based (YYYYMMDD-NN), so a plain string compare
    // already sorts them chronologically — no need to parse them.
    return entries
      .filter((entry) => entry && entry.version && (!fromVersion || entry.version > fromVersion))
      .sort((a, b) => String(b.version).localeCompare(String(a.version)));
  } catch (error) {
    return [];
  }
}

function dismissUpdateBanner() {
  if (!updateBannerEl) return;
  const el = updateBannerEl;
  updateBannerEl = null;
  el.classList.remove("is-visible");
  window.setTimeout(() => el.remove(), 300);
}

let pendingUpdateTag = null;
let updateInstallInFlight = false;

function renderUpdateBanner() {
  if (updateBannerEl || !pendingUpdateVersion) return;
  const changes = pendingUpdateChangelog.flatMap((entry) => Array.isArray(entry.changes) ? entry.changes : []);
  const el = document.createElement("div");
  el.className = "beast-update-banner";
  el.innerHTML = `
    <div class="beast-update-banner-head">
      <span>${BeastCore.icon("sparkles", { size: 20 })}</span>
      <div><strong>Ny version er klar</strong><small>Hent og installer den nyeste version fra GitHub</small></div>
    </div>
    ${changes.length ? `<ul class="beast-update-banner-list">${changes.slice(0, 8).map((change) => `<li>${overviewEscape(change)}</li>`).join("")}</ul>` : ""}
    <div class="beast-update-banner-status" hidden></div>
    <div class="beast-update-banner-actions">
      <button type="button" class="beast-update-skip">Spring over</button>
      <button type="button" class="beast-update-apply">Opdater nu</button>
    </div>
  `;
  document.body.appendChild(el);
  updateBannerEl = el;
  window.requestAnimationFrame(() => el.classList.add("is-visible"));
  el.querySelector(".beast-update-apply").addEventListener("click", () => installPendingUpdate(el));
  el.querySelector(".beast-update-skip").addEventListener("click", () => {
    localStorage.setItem(UPDATE_SKIP_KEY, pendingUpdateVersion);
    dismissUpdateBanner();
  });
}

async function installPendingUpdate(el) {
  if (updateInstallInFlight) return;
  updateInstallInFlight = true;
  const statusEl = el.querySelector(".beast-update-banner-status");
  const applyBtn = el.querySelector(".beast-update-apply");
  const skipBtn = el.querySelector(".beast-update-skip");
  applyBtn.disabled = true;
  skipBtn.disabled = true;
  applyBtn.textContent = "Installerer…";
  if (statusEl) { statusEl.hidden = false; statusEl.textContent = "Henter den nyeste version fra GitHub…"; }
  try {
    const response = await fetch("/api/update.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "install", tag: pendingUpdateTag || undefined }) });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
    if (statusEl) statusEl.textContent = "✓ Installeret — genindlæser…";
    window.setTimeout(() => window.location.reload(), 900);
  } catch (error) {
    updateInstallInFlight = false;
    applyBtn.disabled = false;
    skipBtn.disabled = false;
    applyBtn.textContent = "Opdater nu";
    if (statusEl) statusEl.textContent = `Kunne ikke installere: ${error.message}`;
    BeastCore.log(`Opdateringsinstallation: ${error.message}`);
  }
}

// The dashboard used to compare its own beast.html against itself on the
// same server, which only ever reflected a hand-pushed change already on
// disk — an install that never received one (or a browser tab that just
// caught this same page mid-deploy) had nothing meaningful to detect.
// GitHub Releases is now the single source of truth, matching the same
// check Administration's Update panel uses.
async function checkForDashboardUpdate() {
  try {
    const response = await fetch("/api/update.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check" }), cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (!data.updateAvailable || !data.remoteVersion) return;
    const targetVersion = data.remoteVersion;
    if (targetVersion === skippedUpdateVersion() || targetVersion === pendingUpdateVersion) return;
    pendingUpdateVersion = targetVersion;
    pendingUpdateTag = data.tag || null;
    pendingUpdateChangelog = await loadChangelogNewerThan(currentBuildId());
    if (!pendingUpdateChangelog.length && data.releaseNotes) {
      pendingUpdateChangelog = [{ version: targetVersion, changes: String(data.releaseNotes).split("\n").map((line) => line.replace(/^[-*]\s*/, "").trim()).filter(Boolean) }];
    }
    renderUpdateBanner();
    // skipAutoInstall means this exact build is one we (or a rollback)
    // previously moved away from -- still shown/installable via the manual
    // "Opdater nu" button above, just not silently reinstalled while idle.
    if (pendingUpdateVersion && !skippedUpdateVersion() && !data.skipAutoInstall && Date.now() - lastUserActivityAt > UPDATE_IDLE_AUTOAPPLY_MS) {
      installPendingUpdate(updateBannerEl);
    }
  } catch (error) {
    BeastCore.log(`Opdateringskontrol: ${error.message}`);
  }
}

function reloadCameraFrame(frame, reason) {
  const url = new URL(frame.src, window.location.href);
  url.searchParams.set("recover", String(Date.now()));
  frame.dataset.cameraReloads = String(Number(frame.dataset.cameraReloads || 0) + 1);
  frame.src = url.href;
  cameraHealth.set(frame, { lastProgressAt: Date.now(), lastReconnectAt: 0 });
  BeastCore.log(`Kamera-watchdog: genstarter videorammen (${reason}).`);
  document.dispatchEvent(new CustomEvent("beast:camerahealth", { detail: { state: "recovering", reason } }));
}

function visibleCameraFrames() {
  return Array.from(document.querySelectorAll('iframe[src*="camera-player.html"]'))
    .filter((frame) => frame.closest(".beast-section.is-active"));
}

function runCameraHealthCheck() {
  if (document.hidden) return;
  const now = Date.now();
  visibleCameraFrames().forEach((frame) => {
    const health = cameraHealth.get(frame) || { lastProgressAt: now, lastReconnectAt: 0 };
    cameraHealth.set(frame, health);
    const silentFor = now - health.lastProgressAt;
    if (silentFor > CAMERA_RELOAD_AFTER_MS) {
      reloadCameraFrame(frame, "ingen live-data");
      const reloads = Number(frame.dataset.cameraReloads || 0);
      const lastFullRecovery = Number(sessionStorage.getItem("beast_last_camera_full_recovery") || 0);
      if (reloads >= 3 && now - lastUserActivityAt > 60000 && now - lastFullRecovery > FULL_RECOVERY_COOLDOWN_MS) {
        sessionStorage.setItem("beast_last_camera_full_recovery", String(now));
        window.location.reload();
      }
    } else if (silentFor > CAMERA_RECONNECT_AFTER_MS && now - health.lastReconnectAt > CAMERA_RECONNECT_AFTER_MS) {
      health.lastReconnectAt = now;
      try { frame.contentWindow?.postMessage({ type: "camera-player-reconnect" }, window.location.origin); } catch (_) {}
    }
  });
}

function startKioskWatchdogs() {
  if (!buildCheckTimerId) {
    buildCheckTimerId = window.setInterval(checkForDashboardUpdate, BUILD_CHECK_INTERVAL_MS);
    window.setTimeout(checkForDashboardUpdate, 5000);
  }
  if (!cameraHealthTimerId) cameraHealthTimerId = window.setInterval(runCameraHealthCheck, CAMERA_HEALTH_CHECK_INTERVAL_MS);
  if (!isNightScreenPeriod()) setKioskScreenPower(true);
  scheduleAmbientMode();
  scheduleMorningWake();
  scheduleNightStart();
  document.addEventListener("beast:config-changed", () => {
    scheduleAmbientMode();
    scheduleMorningWake();
    scheduleNightStart();
    if (!screensaverConfig().enabled) {
      hideAmbientMode();
      if (kioskScreenIsOff) setKioskScreenPower(true);
    }
  });
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || !["camera-player-ready", "camera-player-health"].includes(event.data?.type)) return;
    const frame = Array.from(document.querySelectorAll('iframe[src*="camera-player.html"]')).find((item) => item.contentWindow === event.source);
    if (!frame) return;
    const healthy = event.data.type === "camera-player-ready" || event.data.state === "playing";
    const previous = cameraHealth.get(frame) || {};
    cameraHealth.set(frame, { ...previous, lastProgressAt: healthy ? Date.now() : (previous.lastProgressAt || Date.now()), lastState: event.data.state || "ready" });
    if (healthy) frame.dataset.cameraReloads = "0";
    if (healthy) document.dispatchEvent(new CustomEvent("beast:camerahealth", { detail: { state: "live" } }));
  });
}

function placeholderPanel(title, note) {
  return `
    <p class="beast-panel-title">${title}</p>
    <div class="beast-placeholder-panel">${note}</div>
  `;
}

function renderLoginScreen(root, message) {
  root.innerHTML = "";
  const screen = BeastCore.el("div", "beast-login-screen");
  const card = BeastCore.el("div", "beast-login-card", [
    BeastCore.el("h2", null, "HA Smartdash"),
    BeastCore.el("p", null, "Vælg selv den Home Assistant-adresse, denne skærm skal logge ind på."),
    message ? BeastCore.el("p", null, message) : null
  ]);
  const form = BeastCore.el("form", "beast-login-form");
  const label = BeastCore.el("label", null, "Home Assistant-adresse");
  const addressInput = BeastCore.el("input");
  addressInput.type = "url";
  addressInput.name = "haBaseUrl";
  addressInput.placeholder = "http://homeassistant.local:8123";
  addressInput.autocomplete = "url";
  addressInput.required = true;
  addressInput.value = BeastAuth.getHaBaseUrl() || `${window.location.origin}/ha`;
  label.appendChild(addressInput);
  const loginButton = BeastCore.el("button", "beast-btn beast-btn-primary", "Log ind");
  loginButton.type = "submit";
  form.append(label, loginButton);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const address = addressInput.value.trim();
    if (!addressInput.reportValidity()) return;
    BeastAuth.setHaBaseUrl(address);
    BeastAuth.startLogin();
  });
  card.appendChild(form);
  screen.appendChild(card);
  root.appendChild(screen);
}

function overviewEscape(value) { const el = document.createElement("span"); el.textContent = String(value || ""); return el.innerHTML; }
// Shared by the initial mount (renderOverviewSection) and the live
// front-page editor (ha-smartdash-overview.js's edit mode) so both render
// a card from exactly the same markup -- position/size are passed in
// separately since legacy 5-slot cards and freeform cards compute them
// differently (see overviewCardMarkup for the freeform case).
function overviewSlotMarkup(slot, position, size) {
  if (slot.type === "empty") return "";
  if (slot.type === "cameras") return `<section class="beast-panel beast-ov-card ${position} beast-ov-card--flush"${size} data-nav="cameras" data-card="cameras" data-fixed="true" aria-label="Åbn alle kameraer">
      <div id="beastOvCameras"></div>
    </section>`;
  const builtins = {
    clock:["overview","beastOvClock","Tid, kalender og affald"], weather:["weather","beastOvWeather","Vejr"], security:["security","beastOvSecurity","Sikkerhed"], energy:["energy","beastOvEnergy","Energi"]
  };
  if (builtins[slot.type]) { const [nav,id,label] = builtins[slot.type]; return `<section class="beast-panel beast-ov-card ${position}"${size} data-nav="${nav}" data-card="${slot.type}" aria-label="${overviewEscape(slot.label || label)}"><div id="${id}"></div></section>`; }
  return `<section class="beast-panel beast-ov-card ${position} beast-ov-card--generic"${size} data-nav="${slot.type === "custom" ? "overview" : slot.type}" data-card="generic" data-widget="${overviewEscape(slot.type)}" data-entity="${overviewEscape(slot.entity)}" data-label="${overviewEscape(slot.label)}"><div class="beastOvGeneric"></div></section>`;
}

// A freeform card (overviewCards entry) always computes its own position
// class from its own type and carries builder/sizing attributes -- unlike
// a legacy 5-slot card, whose position class comes from its fixed slot key
// and which has no per-card sizing at all.
function overviewCardMarkup(card) {
  const position = `beast-ov-card--${card.type}`;
  const size = ` data-builder-card="${overviewEscape(card.id)}" style="--desktop-w:${Number(card.desktop?.w)||4};--desktop-h:${Number(card.desktop?.h)||1};--tablet-w:${Number(card.tablet?.w)||1};--tablet-h:${Number(card.tablet?.h)||1};--portrait-h:${Number(card.portrait?.h)||1};"`;
  return overviewSlotMarkup(card, position, size);
}

function renderOverviewSection() {
  const defaults = { main:{type:"cameras"}, compactTop:{type:"clock"}, compactBottom:{type:"security"}, wideTop:{type:"weather"}, wideBottom:{type:"energy"} };
  const slots = { ...defaults, ...(BeastConfig.get("overviewSlots") || {}) };
  const configuredCards = BeastConfig.get("overviewCards") || [];
  const freeform = Array.isArray(configuredCards) && configuredCards.length > 0;
  const positionClasses = { main:"beast-ov-card--wide", compactTop:"beast-ov-card--clock", compactBottom:"beast-ov-card--security", wideTop:"beast-ov-card--weather", wideBottom:"beast-ov-card--energy" };
  const widget = (keyOrCard) => {
    const isCard = typeof keyOrCard === "object";
    if (isCard) return overviewCardMarkup(keyOrCard);
    const key = keyOrCard;
    const slot = slots[key] || {type:"empty"};
    return overviewSlotMarkup(slot, positionClasses[key], "");
  };
  const hasEmptySlots = !freeform && Object.values(slots).some((slot) => slot?.type === "empty");
  const hasCameras = freeform ? configuredCards.some((card) => card.type === "cameras") : Object.values(slots).some((slot) => slot?.type === "cameras");
  return `
    <div class="beast-overview-grid is-configurable${freeform ? " is-freeform" : ""}${hasEmptySlots ? " has-empty-slots" : ""}" id="beastOverviewZone">
      <div id="beastOvBanners"></div>
      ${(freeform ? configuredCards : ["main","compactTop","compactBottom","wideTop","wideBottom"]).map(widget).join("")}
      ${overviewCameraMenuMarkup(hasCameras)}
      <div id="beastOvClockMusic"></div>
    </div>
  `;
}

// A standalone element, not nested inside the cameras card -- it used to be
// an overlay/reserved column inside that card, which either covered part of
// the live picture or ate into its width depending on how it was built.
// Positioned relative to .beast-overview-grid itself (see CSS) so it stays
// in the same screen corner regardless of where the cameras card is placed
// or resized, and the picture underneath can use the card's full space.
function overviewCameraMenuMarkup(hasCameras) {
  if (!hasCameras) return "";
  return `<div class="beast-ov-camera-header">
      <div class="beast-ov-camera-menu">
        <button type="button" class="beast-ov-camera-menu-toggle" id="beastOvCameraMenuToggle" aria-label="Åbn kameramenu" aria-expanded="false">⋮</button>
        <div class="beast-ov-camera-menu-popover" id="beastOvCameraMenu" hidden>
          <button type="button" id="beastOvCameraPicker">${BeastCore.icon("camera", { size: 17 })}<span>Vælg kameraer</span></button>
          <button type="button" id="beastOvEdit">${BeastCore.icon("settings", { size: 17 })}<span>Rediger forsiden</span></button>
          <button type="button" id="beastOvStartScreensaver">${BeastCore.icon("moon", { size: 17 })}<span>Start pauseskærm</span></button>
        </div>
      </div>
    </div>`;
}

function renderSectionMarkup(item) {
  if (item.id === "overview") return renderOverviewSection();
  const zoneId = MOUNTED_SECTION_ZONES[item.id];
  if (zoneId) return `<div class="beast-panel beast-panel-fill" id="${zoneId}"></div>`;
  return `
    <section class="beast-panel beast-panel-fill">
      <div class="beast-placeholder-panel">Kommer snart.</div>
    </section>
  `;
}

function renderAppShell(root) {
  const dashboardTitle = BeastConfig.get("dashboardTitle") || "HA Smartdash";
  const titleEl = document.createElement("div");
  titleEl.textContent = dashboardTitle;
  const brandHtml = `<div class="beast-rail-brand">${titleEl.innerHTML}</div>`;

  const favoriteSections = featureEnabled("localFavorites") ? BeastLocalSettings.get("favoriteSections", []) : [];
  const orderedRailItems = favoriteSections.length ? [...RAIL_ITEMS].sort((a, b) => {
    if (["overview", "settings"].includes(a.id) || ["overview", "settings"].includes(b.id)) return a.id === "overview" ? -1 : b.id === "overview" ? 1 : a.id === "settings" ? 1 : b.id === "settings" ? -1 : 0;
    const ai = favoriteSections.indexOf(a.id), bi = favoriteSections.indexOf(b.id);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  }) : RAIL_ITEMS;
  const hiddenSections = BeastLocalSettings.get("hiddenSections", []);
  const visibleRailItems = orderedRailItems
    .filter((item) => ["overview", "settings"].includes(item.id) || !hiddenSections.includes(item.id))
    .filter((item) => item.id !== "settings" || BeastConfig.get("showAdminButton") !== false);
  const railButtonsHtml = visibleRailItems.map((item) => item.id === "settings" ? `
    <a href="/admin/" class="beast-rail-btn">
      ${BeastCore.icon(item.icon, { size: 24 })}
      <span>${item.label}</span>
    </a>
  ` : `
    <button type="button" class="beast-rail-btn" data-section="${item.id}">
      ${BeastCore.icon(item.icon, { size: 24 })}
      <span>${item.label}</span>
    </button>
  `).join("");

  const sectionsHtml = visibleRailItems.filter((item) => item.id !== "settings").map((item) => `
    <div class="beast-section" data-section="${item.id}">
      ${renderSectionMarkup(item)}
    </div>
  `).join("");

  root.innerHTML = `
    <div class="beast-app">
      <span class="beast-status-dot-fixed" id="beastStatusDot" data-state="connecting" title="Forbinder…"></span>
      <div class="beast-body">
        <nav class="beast-rail" id="beastRail">${brandHtml}${railButtonsHtml}</nav>
        <main class="beast-content" id="beastContent">${sectionsHtml}</main>
      </div>
    </div>
    <div class="beast-ambient-mode" id="beastAmbientMode" aria-hidden="true"></div>
    ${quickScenarioMarkup()}
  `;
  document.documentElement.dataset.density = featureEnabled("localFavorites") ? BeastLocalSettings.get("density", "comfortable") : "comfortable";

  const statusDot = document.getElementById("beastStatusDot");
  const STATUS_LABELS = {
    connecting: "Forbinder…",
    connected: "Live",
    "auth-failed": "Login udløbet"
  };

  BeastHaSocket.onStatusChange((state) => {
    statusDot.dataset.state = state === "connected" ? "connected" : (state === "auth-failed" ? "error" : "connecting");
    statusDot.title = STATUS_LABELS[state] || state;
    if (state === "auth-failed") {
      BeastAuth.logout();
      renderLoginScreen(root, "Din session er udløbet. Log ind igen.");
    }
  });

  setupNavigation();
  setupQuickScenarios();
  setupDataQuality();
  BeastCore.mountPanels();
  BeastHaSocket.connect();
  setupEventFocus();
  window.BeastScreenLock?.init();
  lastDoorbellBinaryState = BeastHaSocket.getState(DOORBELL_BINARY_ID())?.state || null;
  if (DOORBELL_BINARY_ID()) BeastHaSocket.subscribeEntity(DOORBELL_BINARY_ID(), handleDoorbellBinary);
  if (DOORBELL_EVENT_ID()) BeastHaSocket.subscribeEntity(DOORBELL_EVENT_ID(), showDoorbellView);
}

function applyDashboardBranding() {
  document.title = BeastConfig.get("dashboardTitle") || "HA Smartdash";
  const favicon = document.querySelector('link[rel="icon"]') || document.head.appendChild(document.createElement("link"));
  favicon.rel = "icon";
  favicon.href = BeastConfig.get("faviconUrl") || "./favicon.svg";
}

function setupNavigation() {
  const rail = document.getElementById("beastRail");
  const content = document.getElementById("beastContent");
  const railButtons = Array.from(rail.querySelectorAll("[data-section]"));
  const sections = Array.from(content.querySelectorAll("[data-section]"));
  let activeSectionId = "overview";
  let autoReturnTimerId = null;

  function scheduleAutoReturn() {
    window.clearTimeout(autoReturnTimerId);
    if (document.hidden || activeSectionId === "overview") return;
    autoReturnTimerId = window.setTimeout(() => activate("overview"), AUTO_RETURN_TO_OVERVIEW_MS);
  }

  function activate(sectionId) {
    activeSectionId = sectionId;
    railButtons.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.section === sectionId));
    sections.forEach((section) => section.classList.toggle("is-active", section.dataset.section === sectionId));
    document.dispatchEvent(new CustomEvent("beast:sectionchange", { detail: { section: sectionId } }));
    scheduleAutoReturn();
  }

  document.addEventListener("beast:navigate", (event) => activate(event.detail?.section || "overview"));

  railButtons.forEach((btn) => btn.addEventListener("click", () => activate(btn.dataset.section)));
  // Delegated instead of wired per-element: the front page's live edit
  // mode (ha-smartdash-overview.js) adds/removes/rebuilds [data-nav] cards
  // on the fly, so a one-time forEach would silently miss any card added
  // after the initial mount. window.beastOverviewEditing/
  // beastOverviewCardDraggedUntil let edit mode suppress navigation while
  // active or right after a drag, the same drag-vs-click pattern already
  // used for banner dragging.
  content.addEventListener("click", (event) => {
    if (window.beastOverviewEditing) return;
    if (Date.now() < (window.beastOverviewCardDraggedUntil || 0)) return;
    const el = event.target.closest("[data-nav]");
    if (el) activate(el.dataset.nav);
  });

  const adminLink = rail.querySelector('a.beast-rail-btn[href="/admin/"]');
  adminLink?.addEventListener("click", (event) => {
    if (!window.BeastScreenLock?.hasPin()) return;
    event.preventDefault();
    window.BeastScreenLock.requestPinVerification((ok) => {
      if (ok) window.location.href = "/admin/";
    });
  });

  ["pointerdown", "keydown", "input", "wheel"].forEach((eventName) => {
    document.addEventListener(eventName, () => {
      noteUserActivity();
      scheduleAutoReturn();
    }, { passive: true });
  });
  // The tap that dismisses the screensaver was also landing as a real
  // click on whatever card/rail-button happened to be underneath it (e.g.
  // the Energy card), immediately re-navigating away from Overview right
  // after noteUserActivity() had just returned there. Cause: the generic
  // pointerdown listener above removes .is-visible (and with it, pointer-
  // events:auto) synchronously, but the browser computes the *following*
  // click event's target via a fresh hit-test at pointerup time -- with
  // pointer-events already back to none, that hit-test finds the newly-
  // exposed element beneath instead of the overlay. preventDefault() here
  // suppresses that synthetic click for this one gesture; only matters
  // while the overlay actually has pointer-events:auto (i.e. is visible),
  // so normal dashboard taps elsewhere are untouched.
  document.getElementById("beastAmbientMode")?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    noteUserActivity();
    scheduleAutoReturn();
  }, { passive: false });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) window.clearTimeout(autoReturnTimerId);
    else scheduleAutoReturn();
  });

  const preferredSection = featureEnabled("localFavorites") ? BeastLocalSettings.get("defaultSection", "overview") : "overview";
  activate(railButtons.some((button) => button.dataset.section === preferredSection) ? preferredSection : "overview");
}

function syncCameraPlayers() {
  document.querySelectorAll('iframe[src*="camera-player.html"]').forEach((frame) => {
    const section = frame.closest(".beast-section");
    const active = !section || section.classList.contains("is-active");
    try {
      frame.contentWindow?.postMessage({ type: active ? "camera-player-resume" : "camera-player-pause" }, window.location.origin);
    } catch (error) {
      BeastCore.log("Kamera-watchdog: kunne ikke kontakte en videoramme.");
    }
  });
}

function reconnectVisibleCameraPlayers() {
  document.querySelectorAll('iframe[src*="camera-player.html"]').forEach((frame) => {
    if (!frame.closest(".beast-section.is-active") && frame.closest(".beast-section")) return;
    try { frame.contentWindow?.postMessage({ type: "camera-player-reconnect" }, window.location.origin); } catch (_) {}
  });
}

window.addEventListener("online", () => window.setTimeout(reconnectVisibleCameraPlayers, 500));
window.addEventListener("pageshow", () => window.setTimeout(syncCameraPlayers, 500));
document.addEventListener("beast:sectionchange", () => window.setTimeout(syncCameraPlayers, 150));

document.addEventListener("DOMContentLoaded", async () => {
  const root = document.getElementById("beastRoot");
  const callbackResult = await BeastAuth.handleAuthCallback();
  if (callbackResult && callbackResult.type === "error") {
    renderLoginScreen(root, callbackResult.message);
    return;
  }

  if (BeastAuth.hasSession()) {
    await BeastConfig.init();
    if (!BeastAuth.getHaBaseUrl() && BeastConfig.get("haBaseUrl")) BeastAuth.setHaBaseUrl(BeastConfig.get("haBaseUrl"));
    applyDashboardBranding();
    document.addEventListener("beast:config-changed", () => {
      applyDashboardBranding();
    });
    renderAppShell(root);
    startKioskWatchdogs();
  } else {
    renderLoginScreen(root);
  }
});
