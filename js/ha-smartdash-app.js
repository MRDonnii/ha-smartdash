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

const SMARTDASH_APP_ROOT = new URL("../", document.currentScript?.src || window.location.href);
const smartdashLocalUrl = (path) => new URL(String(path || "").replace(/^\//, ""), SMARTDASH_APP_ROOT).href;

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

// Default matches the dashboard's original fixed behavior (always on,
// 3 minutes, back to Oversigt); all three are configurable under
// Admin -> Advarsler.
function AUTO_RETURN_ENABLED() { return BeastConfig.get("appEntities.autoReturnEnabled") !== false; }
function AUTO_RETURN_SECTION() { return BeastConfig.get("appEntities.autoReturnSection") || "overview"; }
function AUTO_RETURN_MS() { return Math.max(1, Math.min(60, Number(BeastConfig.get("appEntities.autoReturnMinutes")) || 3)) * 60 * 1000; }
function AUTO_RETURN_SCHEDULE_OK() {
  if (BeastConfig.get("appEntities.autoReturnScheduleEnabled") !== true) return true;
  const minutes = new Date().getHours() * 60 + new Date().getMinutes();
  const start = parseTimeToMinutes(BeastConfig.get("appEntities.autoReturnScheduleStart"), 8 * 60);
  const end = parseTimeToMinutes(BeastConfig.get("appEntities.autoReturnScheduleEnd"), 22 * 60);
  if (start === end) return true;
  if (start > end) return minutes >= start || minutes < end;
  return minutes >= start && minutes < end;
}
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
// How long the HA connection has to have been down before a reconnect
// triggers a full page reload instead of trying to patch every widget's
// stale state back to life individually (cameras, images, timers, ...).
// Short enough to self-heal well within a typical HA restart, long enough
// that an ordinary few-second network blip never causes an unnecessary
// reload.
const CONNECTION_RECOVERY_RELOAD_AFTER_MS = 90 * 1000;
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
// Default matches the dashboard's original fixed behavior; both the mode
// and the minute count are configurable under Admin -> Kiosk & dørklokke.
function DOORBELL_VIEW_MODE() { return BeastConfig.get("appEntities.doorbellViewMode") === "manual" ? "manual" : "timeout"; }
function DOORBELL_VIEW_MS() { return Math.max(1, Math.min(60, Number(BeastConfig.get("appEntities.doorbellViewMinutes")) || 3)) * 60 * 1000; }
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
let lastDoorbellEventAt = 0;
// A ring older than this is history, not something to interrupt the screen
// for -- guards against a page reload or reconnect snapshot replaying the
// last real ring long after the fact.
const DOORBELL_EVENT_MAX_AGE_MS = 60 * 1000;
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

document.addEventListener("beast:alarm-screen-off", () => {
  hideAmbientMode();
  window.clearTimeout(ambientModeTimerId);
  window.clearTimeout(screenOffTimerId);
  setKioskScreenPower(false);
});

function doorbellCameraStream() {
  const cameras = window.BeastCameras?.getAllCameras?.() || [];
  const configuredCameraId = BeastConfig.get("appEntities.doorbellCamera");
  // Resolve the explicitly selected entity outside the Cameras page's
  // allowlist. Doorbell and camera-page selections are independent.
  let camera = configuredCameraId ? window.BeastCameras?.resolveCamera?.(configuredCameraId) : null;
  if (!camera) camera = cameras.find((item) => /fordør|fordor|hoveddør|hoveddor/i.test(`${item.slug} ${item.label} ${item.streamName}`));
  if (!camera) {
    const state = Array.from(BeastHaSocket.getAllStates().values()).find((item) => item?.entity_id?.startsWith("camera.") && /fordør|fordor|hoveddør|hoveddor|front.?door|doorbell/i.test(`${item.entity_id} ${item.attributes?.friendly_name || ""}`));
    if (state) camera = window.BeastCameras?.resolveCamera?.(state.entity_id);
  }
  return camera || null;
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
  // Doorbell camera focus is configured independently under Kiosk &
  // doorbell. It must not be disabled by the generic eventFocus switch,
  // which only controls the smaller alarm/pool/car/printer event banners.
  if (!DOORBELL_BINARY_ID() && !DOORBELL_EVENT_ID()) return;
  const now = Date.now();
  if (now - lastDoorbellAt < 5000) return;
  lastDoorbellAt = now;
  setKioskScreenPower(true);
  hideAmbientMode();
  window.clearTimeout(ambientModeTimerId);
  window.clearTimeout(screenOffTimerId);
  // A ring while the view is already open just extends the close timer --
  // rebuilding the overlay from scratch on every repeat ring tore down and
  // restarted the camera stream each time, which looked like flicker.
  window.clearTimeout(doorbellTimerId);
  if (DOORBELL_VIEW_MODE() !== "manual") doorbellTimerId = window.setTimeout(closeDoorbellView, DOORBELL_VIEW_MS());
  if (document.getElementById("beastDoorbellView")) return;
  const overlay = document.createElement("div");
  overlay.id = "beastDoorbellView";
  overlay.className = "beast-doorbell-view";
  const camera = doorbellCameraStream();
  const useStream = camera && window.BeastCameras?.hasGo2rtc?.() && (camera.resolvedStreamName || camera.streamName);
  const cameraMarkup = useStream
    ? `<iframe src="./camera-player.html?v=19&base=${encodeURIComponent(BeastConfig.get("panels.cameras.go2rtcBaseUrl") || "")}&transport=webrtc&src=${encodeURIComponent(camera.resolvedStreamName || camera.streamName)}" title="Fordør livekamera" frameborder="0" allow="autoplay"></iframe>`
    : camera?.haStreamUrl
      ? `<img class="beast-doorbell-ha-camera" src="${camera.haStreamUrl}" data-doorbell-picture="${camera.entityPicture || ""}" alt="Fordør livekamera">`
      : `<img class="beast-doorbell-ha-camera" data-doorbell-picture="${camera?.entityPicture || ""}" alt="Fordør kamera">`;
  overlay.innerHTML = `${cameraMarkup}<div class="beast-doorbell-head"><span>${BeastCore.icon("bell", { size: 25 })}</span><div><strong>Det ringer på</strong><small>Fordør · kamera</small></div></div><button type="button" class="beast-doorbell-close" aria-label="Luk dørkamera">${BeastCore.icon("close", { size: 24 })}<span>Luk</span></button><div class="beast-doorbell-live"><i></i> Live</div>`;
  document.body.appendChild(overlay);
  const fallbackImage = overlay.querySelector("[data-doorbell-picture]");
  if (fallbackImage?.dataset.doorbellPicture && !fallbackImage.getAttribute("src")) BeastAuth.setAuthedImageSrc(fallbackImage, fallbackImage.dataset.doorbellPicture);
  fallbackImage?.addEventListener("error", () => BeastAuth.setAuthedImageSrc(fallbackImage, fallbackImage.dataset.doorbellPicture), { once:true });
  document.body.classList.add("beast-doorbell-active");
  overlay.querySelector(".beast-doorbell-close")?.addEventListener("click", (event) => { event.stopPropagation(); closeDoorbellView(); });
}

function handleDoorbellBinary() {
  const state = BeastHaSocket.getState(DOORBELL_BINARY_ID())?.state || "off";
  // Only a real press -- a clean "off" -> "on" edge. Coming back from
  // "unavailable"/"unknown" (integration restart, connectivity blip) is not
  // a ring even when the sensor restores as "on", but it is still a
  // transition into "on", so it used to open the doorbell view on its own.
  // Those states are recorded so the next genuine press is still detected,
  // they just don't count as the edge themselves.
  if (state === "on" && lastDoorbellBinaryState === "off") showDoorbellView();
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
    if (window.BeastCameras?.hasGo2rtc?.() && camera.streamName) {
      const src = `./camera-player.html?v=19&base=${encodeURIComponent(BeastConfig.get("panels.cameras.go2rtcBaseUrl") || "")}&transport=webrtc&src=${encodeURIComponent(camera.resolvedStreamName || camera.streamName)}`;
      return `<div class="beast-ambient-camera-tile"><iframe class="beast-ambient-camera-tile-frame" src="${src}" allow="autoplay"></iframe></div>`;
    }
    if (camera.haStreamUrl) {
      return `<div class="beast-ambient-camera-tile"><img class="beast-ambient-camera-tile-frame" src="${camera.haStreamUrl}" data-ambient-camera-picture="${camera.entityPicture || ""}" alt=""></div>`;
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
  // Rebuilds everything except the persistent weather-overlay canvas (see
  // its comment in the shell markup above) -- innerHTML would tear that
  // canvas down and force a full re-init of its animation state every
  // time the screensaver opens again.
  overlay.querySelectorAll(":scope > *:not(#beastAmbientWeatherFx)").forEach((el) => el.remove());
  overlay.insertAdjacentHTML("beforeend", `<div class="beast-ambient-main"><div class="beast-ambient-time${clockSizeClass}">${now.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" })}</div><div class="beast-ambient-date">${now.toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long" })}</div><div class="beast-ambient-summary"><span>${BeastCore.icon("cloud", { size: 26 })}<b>${weather.temperature}</b>${weather.label}</span><span>${BeastCore.icon(unlocked || openDoors ? "unlock" : "shield", { size: 25 })}<b>${unlocked || openDoors ? `${openDoors} åbne · ${unlocked} ulåste` : "Huset er sikret"}</b></span>${ambientBannerPillsMarkup()}</div>${ambientBrightnessMarkup(config)}</div><div class="beast-ambient-bottom${cameraRowHtml ? " has-cameras" : ""}">${cameraRowHtml}<small>Tryk på skærmen for at åbne dashboardet</small></div>`);
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
let pendingUpdateContainerManaged = false;
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

// Same {da, en}-per-line pattern and t(da, en) fallback as admin.js -- the
// update banner shows up directly on the kiosk, so it needs to follow the
// dashboard's own language setting too, not just Admin's.
function updateBannerT(da, en) {
  return BeastLocalSettings.get("language", "en") === "da" ? da : en;
}
function updateChangelogLineText(change) {
  if (typeof change === "string") return change;
  if (!change || typeof change !== "object") return "";
  const lang = BeastLocalSettings.get("language", "en");
  return change[lang] || change.en || change.da || "";
}

function renderUpdateBanner() {
  if (updateBannerEl || !pendingUpdateVersion) return;
  const changes = pendingUpdateChangelog.flatMap((entry) => Array.isArray(entry.changes) ? entry.changes : []);
  const el = document.createElement("div");
  el.className = "beast-update-banner";
  el.innerHTML = `
    <div class="beast-update-banner-head">
      <span>${BeastCore.icon("sparkles", { size: 20 })}</span>
      <div><strong>${updateBannerT("Ny version er klar", "New version ready")}</strong><small>${updateBannerT("Hent og installer den nyeste version fra GitHub", "Download and install the latest version from GitHub")}</small></div>
    </div>
    ${changes.length ? `<ul class="beast-update-banner-list">${changes.slice(0, 8).map((change) => `<li>${overviewEscape(updateChangelogLineText(change))}</li>`).join("")}</ul>` : ""}
    <div class="beast-update-banner-status" hidden></div>
    <div class="beast-update-banner-actions">
      <button type="button" class="beast-update-skip">${updateBannerT("Spring over", "Skip")}</button>
      <button type="button" class="beast-update-apply">${pendingUpdateContainerManaged ? updateBannerT("Opdater via platform", "Update via platform") : updateBannerT("Opdater nu", "Update now")}</button>
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
  if (pendingUpdateContainerManaged) {
    const statusEl = el.querySelector(".beast-update-banner-status");
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = updateBannerT(
        "Åbn Docker, Unraid eller Home Assistant for at opdatere containeren. Din /data-konfiguration bevares.",
        "Open Docker, Unraid or Home Assistant to update the container. Your /data configuration is preserved."
      );
    }
    return;
  }
  updateInstallInFlight = true;
  const statusEl = el.querySelector(".beast-update-banner-status");
  const applyBtn = el.querySelector(".beast-update-apply");
  const skipBtn = el.querySelector(".beast-update-skip");
  applyBtn.disabled = true;
  skipBtn.disabled = true;
  applyBtn.textContent = updateBannerT("Installerer…", "Installing…");
  if (statusEl) { statusEl.hidden = false; statusEl.textContent = updateBannerT("Henter den nyeste version fra GitHub…", "Downloading the latest version from GitHub…"); }
  try {
    const response = await fetch(smartdashLocalUrl("api/update.php"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "install", tag: pendingUpdateTag || undefined, channel: BeastConfig.get("updateChannel") === "beta" ? "beta" : "stable" }) });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
    if (pendingUpdateVersion && payload.installedVersion !== pendingUpdateVersion) {
      throw new Error(updateBannerT(`Serveren beholdt build ${payload.installedVersion || "ukendt"}`, `The server kept build ${payload.installedVersion || "unknown"}`));
    }
    if (statusEl) statusEl.textContent = updateBannerT("✓ Installeret — genindlæser…", "✓ Installed — reloading…");
    window.setTimeout(() => {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("dashboardUpdate", payload.installedVersion || String(Date.now()));
      window.location.replace(nextUrl.href);
    }, 900);
  } catch (error) {
    updateInstallInFlight = false;
    applyBtn.disabled = false;
    skipBtn.disabled = false;
    applyBtn.textContent = updateBannerT("Opdater nu", "Update now");
    if (statusEl) statusEl.textContent = updateBannerT(`Kunne ikke installere: ${error.message}`, `Could not install: ${error.message}`);
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
    const response = await fetch(smartdashLocalUrl("api/update.php"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check", channel: BeastConfig.get("updateChannel") === "beta" ? "beta" : "stable" }), cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (!data.updateAvailable || !data.remoteVersion) return;
    const targetVersion = data.remoteVersion;
    if (targetVersion === skippedUpdateVersion() || targetVersion === pendingUpdateVersion) return;
    pendingUpdateVersion = targetVersion;
    pendingUpdateTag = data.tag || null;
    pendingUpdateContainerManaged = data.containerManaged === true;
    pendingUpdateChangelog = await loadChangelogNewerThan(currentBuildId());
    if (!pendingUpdateChangelog.length && data.releaseNotes) {
      pendingUpdateChangelog = [{ version: targetVersion, changes: String(data.releaseNotes).split("\n").map((line) => line.replace(/^[-*]\s*/, "").trim()).filter(Boolean) }];
    }
    renderUpdateBanner();
    // skipAutoInstall means this exact build is one we (or a rollback)
    // previously moved away from -- still shown/installable via the manual
    // "Opdater nu" button above, just not silently reinstalled while idle.
    if (pendingUpdateVersion && !pendingUpdateContainerManaged && !skippedUpdateVersion() && !data.skipAutoInstall && Date.now() - lastUserActivityAt > UPDATE_IDLE_AUTOAPPLY_MS) {
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

// Alert-banner cameras are deliberately exempt, the same way the banner's
// own detail modal already is by accident (it's appended to <body>, so it
// has no .beast-section ancestor and never matched this selector -- which
// is exactly why that modal has always played smoothly while the banner
// flickered, on the very same stream).
//
// The watchdog's recovery is a full iframe reload, and a reloading iframe
// paints a blank frame before its new document renders. That's the right
// trade for a big always-on camera view that has genuinely died. For a
// small banner thumbnail it isn't: camera-player.js already reconnects
// itself internally (without ever blanking, since it keeps the last good
// poster frame), so the outer reload adds nothing but the visible flash --
// and against a source that reconnects often, it fires repeatedly.
function visibleCameraFrames() {
  return Array.from(document.querySelectorAll('iframe[src*="camera-player.html"]'))
    .filter((frame) => frame.closest(".beast-section.is-active") && !frame.closest("#beastOvBanners"));
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
        // Never reload the whole dashboard for a camera failure: that loses
        // the active view, scroll position and in-progress touch work. The
        // affected frame has already been restarted above; refresh HA and
        // ask every visible player to reconnect as the broader recovery.
        BeastHaSocket.connect?.(true);
        reconnectVisibleCameraPlayers();
        BeastCore.log("Kamera-watchdog: bred lokal reconnect uden sidegenindlæsning.");
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
  // An always-on kiosk never gets the fresh start a manual reload gives.
  // Reconciling every individual widget's stale state after a real outage
  // (an HA restart routinely takes well past a minute) is a losing game --
  // camera streams, authenticated images, and anything cached in a
  // module-level variable can all be left stuck. Once the connection comes
  // back after being down a while, just reload -- the same recovery a
  // manual refresh already provides, done automatically.
  BeastHaSocket.onStatusChange((status, detail) => {
    if (status !== "connected" || !(detail?.downMs > CONNECTION_RECOVERY_RELOAD_AFTER_MS)) return;
    BeastCore.log(`HA-socket: var nede i ${Math.round(detail.downMs / 1000)}s -- genindlæser siden for en frisk start.`);
    window.setTimeout(() => window.location.reload(), 1500);
  });
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
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const address = addressInput.value.trim();
    if (!addressInput.reportValidity()) return;
    BeastAuth.setHaBaseUrl(address);
    loginButton.disabled = true;
    loginButton.textContent = "Kontrollerer forbindelse…";
    try {
      await BeastAuth.prepareLogin();
    } catch (error) {
      renderLoginScreen(root, error.userMessage || "Kunne ikke kontrollere Home Assistant-forbindelsen.");
    }
  });
  card.appendChild(form);
  const tokenDetails = BeastCore.el("details", "beast-login-details");
  tokenDetails.innerHTML = `<summary>Log ind med token</summary><form class="beast-login-form beast-token-login-form"><label>Long-Lived Access Token<textarea rows="4" autocomplete="off" spellcheck="false" placeholder="Indsæt token fra din Home Assistant-profil" required></textarea></label><small>Tokenet gemmes kun i denne browser og medtages aldrig i fejlloggen.</small><button type="submit" class="beast-btn beast-btn-primary">Kontrollér token og log ind</button></form>`;
  tokenDetails.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!addressInput.reportValidity()) return;
    BeastAuth.setHaBaseUrl(addressInput.value.trim());
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    button.textContent = "Kontrollerer token…";
    try {
      await BeastAuth.loginWithToken(event.currentTarget.querySelector("textarea").value);
      window.location.reload();
    } catch (error) {
      renderLoginScreen(root, error.userMessage || "Token-login mislykkedes.");
    }
  });
  card.appendChild(tokenDetails);
  const diagnostics = BeastAuth.getDiagnostics();
  const diagnosticDetails = BeastCore.el("details", "beast-login-details beast-login-diagnostics");
  if (diagnostics.length) diagnosticDetails.open = true;
  diagnosticDetails.innerHTML = `<summary>Fejllog og forbindelsesdetaljer</summary><pre>${overviewEscape(diagnostics.length ? JSON.stringify(diagnostics, null, 2) : "Ingen loginfejl registreret i denne browserfane.")}</pre><div><button type="button" class="beast-btn" data-copy-login-log>Kopiér fejllog</button><button type="button" class="beast-btn" data-clear-login-log>Ryd log</button></div>`;
  diagnosticDetails.querySelector("[data-copy-login-log]").addEventListener("click", async () => {
    const text = diagnosticDetails.querySelector("pre").textContent;
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else window.prompt("Kopiér fejlloggen:", text);
  });
  diagnosticDetails.querySelector("[data-clear-login-log]").addEventListener("click", () => {
    BeastAuth.clearDiagnostics();
    renderLoginScreen(root, message);
  });
  card.appendChild(diagnosticDetails);
  screen.appendChild(card);
  root.appendChild(screen);
}

function overviewEscape(value) { const el = document.createElement("span"); el.textContent = String(value || ""); return el.innerHTML; }
// A dedicated phone-width check, separate from BeastNativePageEditor's own
// "mobile" profile (<=820px) -- that threshold overlaps with an iPad held
// in portrait, which must keep the existing tablet layout untouched here.
// 600px is comfortably below any tablet's narrowest dimension and above
// realistic phone portrait widths.
function isMobileOverviewViewport() {
  const widths = [window.innerWidth, document.documentElement?.clientWidth]
    .map(Number).filter((value) => Number.isFinite(value) && value > 0);
  const measured = Math.max(0, ...widths);
  // Same guard as BeastNativePageEditor.viewportWidth(): a kiosk refresh can
  // briefly report a near-zero viewport, which must not be mistaken for a
  // phone on a large display.
  if (measured < 480 && Number(window.screen?.availWidth) >= 1180) return false;
  return (measured || Number(window.screen?.availWidth) || 1920) <= 600;
}
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
  const genericNav = slot.type === "custom" ? "overview" : slot.type === "heatpump" ? "heating" : slot.type;
  return `<section class="beast-panel beast-ov-card ${position} beast-ov-card--generic"${size} data-nav="${genericNav}" data-card="generic" data-widget="${overviewEscape(slot.type)}" data-entity="${overviewEscape(slot.entity)}" data-label="${overviewEscape(slot.label)}"><div class="beastOvGeneric"></div></section>`;
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

// A genuinely separate template for real phone widths, not a CSS
// adaptation of the desktop/tablet grid -- the grid's column system,
// per-card --desktop-w/-h sizing and drag/resize editor don't translate to
// a phone, and forcing them to would risk leaking into the tablet
// breakpoints this dashboard already carefully tunes. Same host element
// ids as the desktop grid (#beastOvWeather, #beastOvClock, ...) so the
// existing render functions (renderWeather, renderClock, ...) populate it
// with zero changes -- only the surrounding markup and the camera strip's
// own behavior (see renderCameras' mobile branch) differ.
function mobileOverviewMarkup() {
  return `
    <div class="beast-overview-mobile" id="beastOverviewZone">
      <div id="beastOvBanners"></div>
      <section class="beast-panel beast-ov-m-card beast-ov-m-card--cameras" data-nav="cameras" aria-label="Kameraer"><div id="beastOvCameras"></div></section>
      <section class="beast-panel beast-ov-m-card" data-nav="overview" aria-label="Tid, kalender og affald"><div id="beastOvClock"></div></section>
      <section class="beast-panel beast-ov-m-card" data-nav="weather" aria-label="Vejr"><div id="beastOvWeather"></div></section>
      <section class="beast-panel beast-ov-m-card" data-nav="security" aria-label="Sikkerhed"><div id="beastOvSecurity"></div></section>
      <section class="beast-panel beast-ov-m-card" data-nav="energy" aria-label="Energi"><div id="beastOvEnergy"></div></section>
      <div id="beastOvClockMusic" data-card-editor-anchor></div>
    </div>
  `;
}

function renderOverviewSection() {
  if (isMobileOverviewViewport()) return mobileOverviewMarkup();
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
      <div id="beastOvClockMusic" data-card-editor-anchor></div>
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
  return `<div class="beast-ov-camera-actions" hidden>
      ${hasCameras ? `<button type="button" id="beastOvCameraPicker">Vælg kameraer</button>` : ""}
      <button type="button" id="beastOvEdit">Rediger forsiden</button>
      <button type="button" id="beastOvStartScreensaver">Start pauseskærm</button>
    </div>`;
}

function renderSectionMarkup(item) {
  if (item.id === "overview") return renderOverviewSection();
  if (item.id.startsWith("custom_")) return `<div class="beast-panel beast-panel-fill beast-custom-page-zone" id="beastCustomZone_${item.id}"></div>`;
  const zoneId = MOUNTED_SECTION_ZONES[item.id];
  if (zoneId) return `<div class="beast-panel beast-panel-fill" id="${zoneId}"></div>`;
  return `
    <section class="beast-panel beast-panel-fill">
      <div class="beast-placeholder-panel">Kommer snart.</div>
    </section>
  `;
}

function renderAppShell(root) {
  const brandHtml = `<button type="button" class="beast-rail-page-edit" id="beastRailPageEdit" aria-label="Rediger den aktuelle side" title="Rediger den aktuelle side"><span class="beast-rail-page-edit-icon">${BeastCore.icon("grid", { size: 19 })}</span><span class="beast-rail-page-edit-label">Rediger</span></button>`;

  const pageRailItems = window.BeastPageManager?.buildRailItems(RAIL_ITEMS) || RAIL_ITEMS;
  const favoriteSections = featureEnabled("localFavorites") ? BeastLocalSettings.get("favoriteSections", []) : [];
  const orderedRailItems = favoriteSections.length ? [...pageRailItems].sort((a, b) => {
    if (["overview", "settings"].includes(a.id) || ["overview", "settings"].includes(b.id)) return a.id === "overview" ? -1 : b.id === "overview" ? 1 : a.id === "settings" ? 1 : b.id === "settings" ? -1 : 0;
    const ai = favoriteSections.indexOf(a.id), bi = favoriteSections.indexOf(b.id);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  }) : pageRailItems;
  const hiddenSections = BeastLocalSettings.get("hiddenSections", []);
  const visibleRailItems = orderedRailItems
    .filter((item) => ["overview", "settings"].includes(item.id) || !hiddenSections.includes(item.id))
    .filter((item) => item.id !== "settings" || BeastConfig.get("showAdminButton") !== false);
  const railButtonsHtml = visibleRailItems.filter((item) => item.id !== "settings").map((item) => `
    <button type="button" class="beast-rail-btn" data-section="${item.id}">
      ${BeastCore.icon(item.icon, { size: 24 })}
      <span>${item.label}</span>
    </button>
  `).join("");
  const adminItem = visibleRailItems.find((item) => item.id === "settings");
  const adminRailHtml = adminItem ? `<a href="${smartdashLocalUrl("admin/")}" class="beast-rail-btn beast-rail-admin">${BeastCore.icon(adminItem.icon, { size: 24 })}<span class="beast-rail-admin-label"><span class="beast-rail-admin-label-full">${adminItem.label}</span><span class="beast-rail-admin-label-short">Admin</span></span></a>` : "";

  const sectionsHtml = visibleRailItems.filter((item) => item.id !== "settings").map((item) => `
    <div class="beast-section" data-section="${item.id}">
      ${renderSectionMarkup(item)}
    </div>
  `).join("");

  root.innerHTML = `
    <canvas class="beast-weather-fx" id="beastWeatherFx" aria-hidden="true"></canvas>
    <div class="beast-app">
      <span class="beast-status-dot-fixed" id="beastStatusDot" data-state="connecting" title="Forbinder…"></span>
      <div class="beast-body">
        <nav class="beast-rail" id="beastRail"><div class="beast-rail-pages">${railButtonsHtml}</div><div class="beast-rail-tools">${brandHtml}${adminRailHtml}</div></nav>
        <main class="beast-content" id="beastContent">${sectionsHtml}</main>
      </div>
    </div>
    <div class="beast-ambient-mode" id="beastAmbientMode" aria-hidden="true"><canvas class="beast-ambient-weather-fx" id="beastAmbientWeatherFx" aria-hidden="true"></canvas></div>
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
  // Attach the shared entity-card editor after page panels have rendered.
  // A short delay also lets panels that start in a loading state finish their
  // first markup pass before the editor adds its persistent host.
  window.setTimeout(() => window.BeastPageEditor?.mountAll(), 80);
  document.addEventListener("beast:navigate", () => window.setTimeout(() => window.BeastPageEditor?.mountAll(), 80));
  BeastHaSocket.connect();
  BeastWeatherFx.mount();
  setupChartTypeToggles();
  setupEventFocus();
  window.BeastScreenLock?.init();
  lastDoorbellBinaryState = BeastHaSocket.getState(DOORBELL_BINARY_ID())?.state || null;
  if (DOORBELL_BINARY_ID()) BeastHaSocket.subscribeEntity(DOORBELL_BINARY_ID(), handleDoorbellBinary);
  // HA event entities also emit a state change when they briefly go
  // "unavailable" (integration restart, connectivity blip) -- reacting to
  // every update instead of only genuine rings opened the view for those
  // too, and since they're spaced well past the 5s re-trigger guard below,
  // each one re-armed its own close timer on top of whatever was pending.
  // An event entity keeps its last event's attributes (event_type: "ring")
  // even while its *state* is "unknown"/"unavailable" -- so matching on
  // event_type alone fired on every integration restart or connectivity
  // blip, which is what opened the doorbell view when nobody had rung.
  // The state itself is the event's ISO timestamp; a genuine new ring is a
  // parseable timestamp that differs from the one seen before. The
  // freshness check additionally stops a page reload (or reconnect
  // snapshot) from replaying the last real ring from hours ago.
  lastDoorbellEventAt = Date.parse(BeastHaSocket.getState(DOORBELL_EVENT_ID())?.state || "") || 0;
  if (DOORBELL_EVENT_ID()) BeastHaSocket.subscribeEntity(DOORBELL_EVENT_ID(), (entityId, nextState) => {
    if (nextState?.attributes?.event_type !== "ring") return;
    const firedAt = Date.parse(nextState?.state || "");
    if (!Number.isFinite(firedAt) || firedAt === lastDoorbellEventAt) return;
    const isFresh = Date.now() - firedAt < DOORBELL_EVENT_MAX_AGE_MS;
    lastDoorbellEventAt = firedAt;
    if (isFresh) showDoorbellView();
  });
}

function applyDashboardBranding() {
  document.title = BeastConfig.get("dashboardTitle") || "HA Smartdash";
  const favicon = document.querySelector('link[rel="icon"]') || document.head.appendChild(document.createElement("link"));
  favicon.rel = "icon";
  favicon.href = BeastConfig.get("faviconUrl") || "./favicon.svg";
}

// One delegated listener for every line/bars switch in the dashboard (see
// BeastCore.chartTypeToggleMarkup). Delegation rather than per-panel wiring
// because these graphs are re-rendered constantly -- a listener bound to
// the button itself would be lost on the next redraw, and every panel would
// have to remember to re-bind it. The panels only decide *when* to show the
// control; reacting to it is the same everywhere.
function setupChartTypeToggles() {
  // Colour panel: opening it, and closing it again when the press lands
  // anywhere else. Colours are one shared setting, so only one panel is
  // ever open at a time.
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-chart-colors]");
    const insidePanel = event.target.closest("[data-chart-colors-panel]");
    if (!insidePanel) {
      document.querySelectorAll("[data-chart-colors-panel]").forEach((panel) => {
        if (trigger && panel === trigger.parentElement.querySelector("[data-chart-colors-panel]")) return;
        panel.hidden = true;
        panel.parentElement.querySelector("[data-chart-colors]")?.setAttribute("aria-expanded", "false");
      });
    }
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    const panel = trigger.parentElement.querySelector("[data-chart-colors-panel]");
    if (!panel) return;
    panel.hidden = !panel.hidden;
    trigger.setAttribute("aria-expanded", String(!panel.hidden));
  });

  // "change" rather than "input": a colour picker fires input continuously
  // while dragging, and each save triggers a redraw that would replace the
  // panel mid-pick. change fires once, when the value is settled.
  document.addEventListener("change", (event) => {
    const panel = event.target.closest("[data-chart-colors-panel]");
    if (!panel) return;
    const mode = panel.querySelector("[data-chart-color-mode]")?.value === "usage" ? "usage" : "static";
    BeastConfig.set("chartColors", {
      mode,
      static: panel.querySelector("[data-chart-color-static]")?.value || "#4fb8ff",
      steps: Array.from(panel.querySelectorAll("[data-chart-color-step]"))
        .sort((a, b) => Number(a.dataset.chartColorStep) - Number(b.dataset.chartColorStep))
        .map((input) => input.value)
    });
    document.dispatchEvent(new CustomEvent("beast:chart-type-changed", { detail: { key: "*" } }));
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-chart-type]");
    if (!button) return;
    const key = button.closest("[data-chart-type-key]")?.dataset.chartTypeKey;
    if (!key) return;
    // These sit inside cards that navigate on click and, in edit mode,
    // inside draggable cards -- neither should trigger from this press.
    event.preventDefault();
    event.stopPropagation();
    if (BeastCore.chartType(key) === button.dataset.chartType) return;
    BeastCore.setChartType(key, button.dataset.chartType);
    // Reflect the choice on the buttons straight away. Saving is a network
    // round-trip, and the owning panel may redraw the whole group a moment
    // later -- without this the control looks unresponsive in between,
    // which reads as the press not registering at all.
    button.closest("[data-chart-type-key]")?.querySelectorAll("[data-chart-type]")
      .forEach((item) => item.classList.toggle("is-active", item === button));
    // Panels own their own graphs, so they redraw themselves rather than
    // this handler reaching into each one. Nothing listens to
    // beast:config-changed for this, so a dedicated event keeps it explicit.
    document.dispatchEvent(new CustomEvent("beast:chart-type-changed", { detail: { key } }));
  });
}

function setupNavigation() {
  const rail = document.getElementById("beastRail");
  const content = document.getElementById("beastContent");
  const railButtons = Array.from(rail.querySelectorAll("[data-section]"));
  const sections = Array.from(content.querySelectorAll("[data-section]"));
  // Which page was open is remembered across a reload, so refreshing (or a
  // kiosk's own automatic recovery reload) comes back to where you were
  // rather than jumping to the front page. sessionStorage, not
  // localStorage, is deliberate: it survives a refresh but not closing the
  // tab, so a freshly opened dashboard still starts on the front page.
  const ACTIVE_SECTION_KEY = "beast_active_section_v1";

  function rememberedSection() {
    try {
      const saved = sessionStorage.getItem(ACTIVE_SECTION_KEY);
      return saved && sections.some((section) => section.dataset.section === saved) ? saved : null;
    } catch (_) { return null; }
  }

  let activeSectionId = rememberedSection() || "overview";
  let autoReturnTimerId = null;

  function scheduleAutoReturn() {
    window.clearTimeout(autoReturnTimerId);
    if (!AUTO_RETURN_ENABLED() || !AUTO_RETURN_SCHEDULE_OK() || document.hidden || activeSectionId === AUTO_RETURN_SECTION()) return;
    autoReturnTimerId = window.setTimeout(() => activate(AUTO_RETURN_SECTION()), AUTO_RETURN_MS());
  }

  function activate(sectionId) {
    activeSectionId = sectionId;
    try { sessionStorage.setItem(ACTIVE_SECTION_KEY, sectionId); } catch (_) {}
    railButtons.forEach((btn) => btn.classList.toggle("is-active", btn.dataset.section === sectionId));
    sections.forEach((section) => section.classList.toggle("is-active", section.dataset.section === sectionId));
    document.dispatchEvent(new CustomEvent("beast:sectionchange", { detail: { section: sectionId } }));
    scheduleAutoReturn();
  }

  document.addEventListener("beast:navigate", (event) => activate(event.detail?.section || "overview"));

  railButtons.forEach((btn) => btn.addEventListener("click", () => activate(btn.dataset.section)));
  // Delegated instead of wired per-element: any page's live card editor
  // (js/ha-smartdash-card-editor.js) adds/removes/rebuilds [data-nav]
  // cards on the fly, so a one-time forEach would silently miss any card
  // added after the initial mount. window.beastCardEditorActive/
  // beastCardDraggedUntil (set by the card editor) let edit mode suppress
  // navigation while active or right after a drag, the same drag-vs-click
  // pattern already used for banner dragging.
  content.addEventListener("click", (event) => {
    if (window.beastCardEditorActive) return;
    if (Date.now() < (window.beastCardDraggedUntil || 0)) return;
    const el = event.target.closest("[data-nav]");
    if (el) activate(el.dataset.nav);
  });

  const adminLink = rail.querySelector("a.beast-rail-admin");
  adminLink?.addEventListener("click", (event) => {
    if (!window.BeastScreenLock?.hasPin()) return;
    event.preventDefault();
    window.BeastScreenLock.requestPinVerification((ok) => {
      if (!ok) return;
      window.BeastScreenLock.grantAdminVerification();
      window.location.href = smartdashLocalUrl("admin/");
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

  // A remembered page (from a reload) wins over the configured start page:
  // the start page is where a *fresh* session begins, not somewhere a
  // refresh should throw you back to.
  const configuredSection = featureEnabled("localFavorites") ? BeastLocalSettings.get("defaultSection", "overview") : "overview";
  const preferredSection = rememberedSection() || configuredSection;
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

function mountPageActionMenus() {
  if (document.documentElement.dataset.pageActionMenus === "true") return;
  document.documentElement.dataset.pageActionMenus = "true";
  const close = () => document.getElementById("beastPageActionMenu")?.remove();
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest(".beast-page-edit-trigger, #beastRailPageEdit");
    if (!trigger) { if (!event.target.closest("#beastPageActionMenu")) close(); return; }
    if (trigger.dataset.menuBypass === "true") { delete trigger.dataset.menuBypass; return; }
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); close();
    const section = trigger.id === "beastRailPageEdit"
      ? document.querySelector(".beast-section.is-active[data-section]")
      : trigger.closest(".beast-section[data-section]");
    if (!section) return;
    const pageTrigger = trigger.id === "beastRailPageEdit"
      ? (section.dataset.section === "overview" ? section.querySelector("#beastOvEdit") : section.querySelector(".beast-page-edit-trigger"))
      : trigger;
    const menu = document.createElement("div"); menu.id = "beastPageActionMenu"; menu.className = "beast-page-action-menu";
    const isOverview = section.dataset.section === "overview";
    menu.innerHTML = `<button type="button" data-page-action="edit"><i>${BeastCore.icon("settings",{size:21})}</i><span><strong>Rediger side</strong><small>Flyt, ændr og tilføj kort</small></span></button><button type="button" data-page-action="fit"><i>${BeastCore.icon("grid",{size:21})}</i><span><strong>Tilpas side</strong><small>Fordel kortene til denne skærm</small></span></button>${isOverview ? `<button type="button" data-page-action="cameras"><i>${BeastCore.icon("camera",{size:21})}</i><span><strong>Vælg kameraer</strong><small>Vælg hvilke kameraer der vises på forsiden</small></span></button><button type="button" data-page-action="screensaver"><i>${BeastCore.icon("moon",{size:21})}</i><span><strong>Start pauseskærm</strong><small>Vis nattens pauseskærm med det samme</small></span></button>` : ""}<button type="button" data-page-action="reload"><i>${BeastCore.icon("refresh",{size:21})}</i><span><strong>Genindlæs dashboard</strong><small>Genstart siden og alle forbindelser</small></span></button>`;
    document.body.appendChild(menu);
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const edge = 10;
    const railIsBottom = triggerRect.top > window.innerHeight * .65;
    const left = Math.max(edge, Math.min(window.innerWidth - menuRect.width - edge, triggerRect.right + edge));
    const top = railIsBottom
      ? Math.max(edge, triggerRect.top - menuRect.height - edge)
      : Math.max(edge, Math.min(window.innerHeight - menuRect.height - edge, triggerRect.top));
    menu.style.left = `${Math.round(left)}px`; menu.style.top = `${Math.round(top)}px`;
    menu.querySelector('[data-page-action="edit"]').disabled = !pageTrigger;
    menu.querySelector('[data-page-action="edit"]').addEventListener("click", () => { if (!pageTrigger) return; close(); pageTrigger.dataset.menuBypass = "true"; pageTrigger.click(); });
    menu.querySelector('[data-page-action="fit"]').addEventListener("click", async (actionEvent) => { const button=actionEvent.currentTarget; button.disabled=true; button.classList.add("is-busy"); await window.BeastPageEditor?.fit?.(section.dataset.section); close(); });
    menu.querySelector('[data-page-action="cameras"]')?.addEventListener("click", () => { close(); document.getElementById("beastOvCameraPicker")?.click(); });
    menu.querySelector('[data-page-action="screensaver"]')?.addEventListener("click", () => { close(); document.getElementById("beastOvStartScreensaver")?.click(); });
    menu.querySelector('[data-page-action="reload"]').addEventListener("click", () => {
      close();
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("dashboardReload", String(Date.now()));
      window.location.replace(nextUrl.href);
    });
  }, true);
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
    mountPageActionMenus();
    startKioskWatchdogs();
  } else {
    renderLoginScreen(root);
  }
});
