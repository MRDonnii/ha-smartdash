// Bedroom page ("Soveværelse"): an opt-in, fixed-dark bedside page for one
// device (BeastLocalSettings deviceType "bedroom"). Every entity comes from
// panels.bedroom; a card whose fields are unset is left out and the grid
// closes up around it. The sleep/CPAP module and the full-screen menu live in
// ha-smartdash-bedroom-sleep.js and ha-smartdash-bedroom-menu.js.
window.BeastBedroom = (() => {
  const ZONE_ID = "beastBedroomZone";
  const SECTION_ID = "bedroom";
  const DEFAULT_TITLE = "Soveværelse";
  // Warm hues only (no blue light at night): one per configured calendar, in order.
  const CALENDAR_COLORS = ["#E8A85A", "#D4795A", "#CDB38A", "#C98A8A", "#A8B07A", "#8C9A86"];
  const CALENDAR_REFRESH_MS = 5 * 60 * 1000;
  const CAMERA_VIEW_MAX_MS = 3 * 60 * 1000;
  const POSTER_REFRESH_MS = 10 * 60 * 1000;
  const GOODNIGHT_COUNTDOWN_S = 3;
  // AlarmControlPanelEntityFeature bits, in the order the buttons are shown.
  const ALARM_MODES = [["home", 1, "Hjemme"], ["night", 4, "Nat"], ["away", 2, "Ude"]];
  const ALARM_STATE_LABELS = {
    disarmed: "Frakoblet", armed_home: "Hjemme", armed_away: "Ude", armed_night: "Nat", armed_vacation: "Ferie",
    armed_custom_bypass: "Tilpasset", arming: "Aktiverer…", pending: "Afventer…", disarming: "Frakobler…", triggered: "Udløst"
  };
  const AIR_QUALITY_LABELS = { excellent: "Fremragende", good: "God", fair: "Moderat", moderate: "Moderat", poor: "Dårlig", bad: "Dårlig", very_poor: "Meget dårlig", unhealthy: "Usund" };

  // ---------------------------------------------------------------------------
  // Shared helpers (also used by the sleep and menu modules)
  // ---------------------------------------------------------------------------
  const translations = new Map();
  // Every Danish string here has an English entry in ha-smartdash-i18n.js;
  // {name} placeholders are filled after the lookup, so one key covers every
  // value. The language only changes with a reload, so lookups are cached.
  function t(da, vars) {
    let text = translations.get(da);
    if (text === undefined) {
      text = window.HASmartdashI18n ? window.HASmartdashI18n.t(da) : da;
      translations.set(da, text);
    }
    return vars ? text.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match)) : text;
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  const ICONS = {
    home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
    camera: '<rect x="2.75" y="6.5" width="13.5" height="11" rx="2.5"/><path d="m16.25 10.5 4.75-2.6v8.2l-4.75-2.6"/>',
    rooms: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M3.5 12.5h6.5M10 3.5v5M10 12.5v8M14 12.5h6.5"/>',
    shield: '<path d="M12 3.25 19 6v5.6c0 4.2-2.9 7.6-7 9.15-4.1-1.55-7-4.95-7-9.15V6Z"/><path d="m9.2 12.2 2 2 3.8-3.9"/>',
    music: '<path d="M9 17.5V6.2l10-2v11.3"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/><path d="M9 9.6l10-2"/>',
    bolt: '<path d="M13.2 3 5.5 13.3h6l-1 7.7 8-10.6h-6Z"/>',
    thermo: '<path d="M10 14.2V5.5a2 2 0 0 1 4 0v8.7a4 4 0 1 1-4 0Z"/><path d="M12 10.5v6.2"/><path d="M17 6h2.5M17 9.5h2.5"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/>',
    weather: '<path d="M7.5 19h9.25a3.75 3.75 0 0 0 .4-7.48A5.25 5.25 0 0 0 7.1 10.6 4.25 4.25 0 0 0 7.5 19Z"/><path d="M15.5 4.3A3.8 3.8 0 0 0 20.2 9"/>',
    car: '<path d="M4 16.5v-3.7c0-.4.1-.8.3-1.1L6.4 7.3A2 2 0 0 1 8.2 6.2h7.6a2 2 0 0 1 1.8 1.1l2.1 4.4c.2.3.3.7.3 1.1v3.7Z"/><path d="M5.5 11.5h13"/><path d="M6.5 16.5v2M17.5 16.5v2"/><path d="M7.5 14h1M15.5 14h1"/>',
    pool: '<path d="M12 3.5s-5 5.6-5 9.3a5 5 0 0 0 10 0c0-3.7-5-9.3-5-9.3Z"/><path d="M9.6 14.2a2.6 2.6 0 0 0 2.4 1.8"/>',
    robot: '<circle cx="12" cy="12.5" r="8"/><circle cx="12" cy="12.5" r="3"/><path d="M8 6.5h8"/>',
    printer: '<path d="M4 20.5h16M5.5 20.5V5.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v15"/><path d="M8.5 7.5h7l-2 3h-3Z"/><path d="M9 16.5h6"/>',
    page: '<rect x="4.5" y="3.5" width="15" height="17" rx="2.5"/><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4"/>',
    bed: '<path d="M3 18.5v-12"/><path d="M3 14.5h18v4"/><path d="M21 14.5v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11.5" r="1.75"/>',
    bulb: '<path d="M9.25 17.5h5.5M10 20.5h4"/><path d="M12 3.5a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1v1.1h5v-1.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3.5Z"/>',
    expand: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><rect x="9" y="9.5" width="6" height="5" rx="1.2"/>',
    corners: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
    scene: '<path d="m11 3.5 1.7 4.8 4.8 1.7-4.8 1.7L11 16.5l-1.7-4.8L4.5 10l4.8-1.7Z"/><path d="m18 14.5.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8Z"/>',
    moon: '<path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1Z"/>',
    dim: '<circle cx="12" cy="12" r="3.75"/><path d="M12 4.5v.01M12 19.5v.01M4.5 12h.01M19.5 12h.01M6.7 6.7h.01M17.3 17.3h.01M6.7 17.3h.01M17.3 6.7h.01"/>',
    reload: '<path d="M19.5 12a7.5 7.5 0 1 1-2.3-5.4"/><path d="M19.5 4v4h-4"/>',
    sliders: '<path d="M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9"/><circle cx="15" cy="7.5" r="2"/><circle cx="9" cy="16.5" r="2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.75 13.6 5l2.7-.6.7 2.7 2.5 1.2-1 2.6 1.6 2.3-2.4 1.4.1 2.8-2.8.2-1.4 2.4-2.6-1-2.3 1.6-1.6-2.3-2.7.4-.4-2.8-2.3-1.6 1.2-2.5L3 9.2l2.5-1.3.4-2.8 2.8.3Z"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    chev: '<path d="m9.5 6 6 6-6 6"/>',
    "chev-left": '<path d="m14.5 6-6 6 6 6"/>',
    lock: '<rect x="5" y="11" width="14" height="9.5" rx="2.5"/><path d="M8.5 11V7.8a3.5 3.5 0 0 1 7 0V11"/>',
    unlock: '<rect x="5" y="11" width="14" height="9.5" rx="2.5"/><path d="M8.5 11V7.6a3.5 3.5 0 0 1 6.8-1.2"/>',
    key: '<circle cx="7.5" cy="12" r="3.75"/><path d="M11.25 12h9.25M17.5 12v3"/>',
    power: '<path d="M12 3.5v7.5"/><path d="M7.1 6.6a7.3 7.3 0 1 0 9.8 0"/>',
    play: '<path d="M8 5.5v13l10-6.5Z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6.5" y="5" width="3.8" height="14" rx="1.1" fill="currentColor" stroke="none"/><rect x="13.7" y="5" width="3.8" height="14" rx="1.1" fill="currentColor" stroke="none"/>',
    tv: '<rect x="2.5" y="4.5" width="19" height="13" rx="2.2"/><path d="M8.5 20.5h7"/>',
    fan: '<circle cx="12" cy="12" r="1.6"/><path d="M12 10.4c-.6-2.6.2-5.9 2.6-6.4 2.2-.4 3.2 2.4 1.4 4.1-1 .9-2.4 1.6-4 2.3Z"/><path d="M13.4 12.8c2.5.8 4.9 3.2 4.1 5.5-.7 2.1-3.6 1.6-4-.8-.2-1.3 0-2.9-.1-4.7Z"/><path d="M10.6 12.8c-1.9 1.8-5.2 2.7-6.8.9-1.4-1.7.5-4 2.8-3.2 1.3.4 2.6 1.4 4 2.3Z"/>',
    speaker: '<rect x="6" y="3.5" width="12" height="17" rx="2.5"/><circle cx="12" cy="14" r="3"/><path d="M12 7.5h.01"/>'
  };

  // Strokes always land at 1.5 px on screen, whatever the icon size.
  function icon(name, size = 20, className = "") {
    const path = ICONS[name];
    if (!path) return "";
    return `<svg class="bd-i${className ? ` ${className}` : ""}" width="${size}" height="${size}" viewBox="0 0 24 24" stroke-width="${(36 / size).toFixed(2)}" aria-hidden="true" focusable="false">${path}</svg>`;
  }

  function locale() { return window.HASmartdashI18n?.locale || "da-DK"; }

  const numberFormats = new Map();
  function fmt(value, digits = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "–";
    const key = `${locale()}|${digits}`;
    if (!numberFormats.has(key)) numberFormats.set(key, new Intl.NumberFormat(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }));
    return numberFormats.get(key).format(number);
  }

  const pad2 = (value) => String(value).padStart(2, "0");
  // Always "22:47": da-DK would give "22.47".
  function hm(date) { return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`; }
  function capitalize(text) { return text ? text.charAt(0).toLocaleUpperCase(locale()) + text.slice(1) : text; }
  function dateKey(date) { return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`; }
  // A bare YYYY-MM-DD parses as UTC midnight; noon local time keeps it on the right day.
  function parseDateKey(key) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
    return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12) : null;
  }
  function addDays(date, days) { const next = new Date(date); next.setDate(next.getDate() + days); return next; }
  function startOfDay(date = new Date()) { const day = new Date(date); day.setHours(0, 0, 0, 0); return day; }
  function shortDate(date) { return date.toLocaleDateString(locale(), { day: "numeric", month: "short" }).replace(/\.$/, ""); }
  function shortWeekdayDate(date) { return date.toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" }).replace(/\.$/, ""); }
  function weekdayName(date) { return date.toLocaleDateString(locale(), { weekday: "long" }); }
  function duration(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    return t("{h} t {m} min", { h: Math.floor(total / 60), m: pad2(total % 60) });
  }

  function cfg() { return BeastConfig.get("panels.bedroom") || {}; }
  function list(value) {
    const items = Array.isArray(value) ? value : value ? [value] : [];
    return items.filter((id, index) => typeof id === "string" && /^[a-z_]+\.[\w-]+$/i.test(id) && items.indexOf(id) === index);
  }
  function single(value) { return list(value)[0] || null; }
  function state(id) { return id ? BeastHaSocket.getState(id) : null; }
  function unavailable(st) { return !st || st.state === "unavailable" || st.state === "unknown"; }
  function numberState(id) {
    const st = state(id);
    if (!st || st.state === "" || st.state == null) return null;
    const value = Number(st.state);
    return Number.isFinite(value) ? value : null;
  }
  // A title left at the default name follows the dashboard language.
  function roomTitle() { return t(String(cfg().title || "").trim() || DEFAULT_TITLE); }

  let overridesSource = null;
  let overridesMap = new Map();
  function overrides() {
    const raw = String(cfg().displayNames || "");
    if (raw !== overridesSource) {
      overridesSource = raw;
      overridesMap = new Map(raw.split(/[;\n]+/).map((part) => {
        const index = part.indexOf("=");
        return index > 0 ? [part.slice(0, index).trim(), part.slice(index + 1).trim()] : null;
      }).filter((entry) => entry && entry[0] && entry[1]));
    }
    return overridesMap;
  }

  function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // "Soveværelse loft" -> "Loft": the room word adds nothing on the room's own page.
  function stripRoom(name) {
    const words = [...new Set([String(cfg().title || "").trim(), DEFAULT_TITLE, t(DEFAULT_TITLE)].filter(Boolean))]
      .map((word) => `${escapeRegExp(word)}(?:et|t)?`);
    let out = name;
    let previous;
    do {
      previous = out;
      words.forEach((word) => {
        out = out.replace(new RegExp(`^${word}[\\s:·|–—-]+`, "i"), "").replace(new RegExp(`[\\s:·|–—-]+${word}$`, "i"), "").trim();
      });
    } while (out && out !== previous);
    return out ? capitalize(out) : name;
  }

  function displayName(id) {
    if (!id) return "";
    const override = overrides().get(id);
    if (override) return override;
    const raw = String(state(id)?.attributes?.friendly_name || window.BeastEntityPicker?.friendlyName?.(id) || id.split(".")[1].replaceAll("_", " ")).trim();
    return stripRoom(raw) || raw;
  }

  // A rejected command keeps HA's own message (e.g. a wrong alarm code); the
  // REST fallback is only for a socket that isn't up yet.
  async function callService(domain, service, entityId, data = {}) {
    try {
      return await BeastHaSocket.sendCommand("call_service", { domain, service, service_data: data, target: { entity_id: entityId } });
    } catch (error) {
      if (error?.message !== "SOCKET_NOT_OPEN") throw error;
      return BeastAuth.haFetch(`/api/services/${domain}/${service}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity_id: entityId, ...data })
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Module state
  // ---------------------------------------------------------------------------
  let zone = null;
  let root = null;
  let active = false;
  let configSignature = "";
  let flags = {};
  let unsubscribers = [];
  let requestRender = () => {};
  const blockSignatures = new Map();
  const pending = new Map();
  let clockTimerId = null;
  let secondTimerId = null;
  let calendarTimerId = null;
  let connectedTimerId = null;
  let calendarEvents = null;
  let calendarFetchedAt = 0;
  let calendarRequest = 0;
  let calendarResizeObserver = null;
  let cameraObservers = [];
  let posterRefreshedAt = 0;
  let lightDrag = null;
  const lastBrightness = new Map();
  let alarmFeedback = null;
  const lockFeedback = new Map();
  let goodnight = { phase: "idle", count: 0, timerId: null, doneAt: 0 };
  let cameraView = null;
  let layerKind = null;
  let layerCleanup = null;

  function isActive() { return Boolean(zone?.closest(".beast-section")?.classList.contains("is-active")); }

  // Forces every block to repaint except the camera tiles: rebuilding those
  // would tear their live streams down.
  function invalidateBlocks() {
    [...blockSignatures.keys()].forEach((key) => { if (key !== "cams") blockSignatures.delete(key); });
  }

  function setPending(id, value, ms = 6000) {
    pending.set(id, { ...value, at: Date.now(), until: Date.now() + ms });
  }
  function pendingFor(id) {
    const entry = pending.get(id);
    if (!entry) return null;
    if (Date.now() > entry.until) { pending.delete(id); return null; }
    return entry;
  }

  // ---------------------------------------------------------------------------
  // Layout: which cards exist and how the grid closes up around missing ones
  // ---------------------------------------------------------------------------
  function computeFlags() {
    const c = cfg();
    const sleep = window.BeastBedroom?.sleep;
    return {
      cams: list(c.cameras).length > 0,
      sleep: Boolean(sleep?.configured()),
      cal: list(c.calendars).length > 0,
      sec: list(c.locks).length > 0 || Boolean(single(c.alarm)),
      ctrl: [c.lights, c.scenes, c.scripts, c.comfort, c.comfortBooleans, c.fans, c.media].some((value) => list(value).length > 0),
      night: goodnightPlan().any
    };
  }

  // Rows are [size, cellsPerColumn]; identical neighbouring rows merge so a
  // missing card never leaves an empty track (and its gap) behind.
  function gridTemplate(columns, rows) {
    const merged = [];
    rows.forEach(([size, cells]) => {
      const text = cells.join(" ");
      const previous = merged[merged.length - 1];
      if (previous && previous.text === text) {
        if (/fr/.test(size)) previous.size = size;
        return;
      }
      merged.push({ size, text });
    });
    return {
      cols: columns.join(" "),
      rows: merged.map((row) => row.size).join(" "),
      areas: merged.map((row) => `"${row.text}"`).join(" ")
    };
  }

  // A column of up to two cards over three rows: the first card takes the
  // first row(s), the second the rest. Which rows depends on which card sizes
  // itself (see the row sizes below).
  function stackCells(first, second, firstRows) {
    if (first && second) return [0, 1, 2].map((index) => (index < firstRows ? first : second));
    const only = first || second;
    return only ? [only, only, only] : null;
  }

  // Landscape (Amber): cameras over security on the left, sleep over the
  // calendar in the middle, all controls on the right. Rows: the sleep card's
  // own height, the flexible rest, the security card's own height. The
  // cameras fill rows 1-2 and the calendar rows 2-3, so both take what the
  // two content-sized cards leave.
  function landscapeLayout(f) {
    const columns = [];
    const cells = [];
    const weights = { A: 440, B: 286, C: 286 };
    const add = (name, column) => { if (column) { columns.push(name); cells.push(column); } };
    add("A", stackCells(f.cams && "cams", f.sec && "sec", 2));
    add("B", stackCells(f.sleep && "sleep", f.cal && "cal", 1));
    add("C", f.ctrl ? ["ctrl", "ctrl", "ctrl"] : null);
    if (!columns.length) return null;
    // Without cameras and controls the two remaining cards share the width.
    if (columns.length === 1) weights[columns[0]] = 1;
    const head = Array(columns.length).fill("head");
    const row = (index) => cells.map((column) => column[index]);
    const rows = [["auto", head], ["auto", row(0)], ["minmax(0, 1fr)", row(1)], ["auto", row(2)]];
    return gridTemplate(columns.map((name) => `minmax(0, ${weights[name]}fr)`), rows);
  }

  // Portrait (Amber): cameras side by side, then sleep over the calendar on
  // the left and security over the controls on the right. Rows: security's
  // height, the rest of the sleep card, the flexible rest.
  function portraitLayout(f) {
    let left = stackCells(f.sleep && "sleep", f.cal && "cal", 2);
    let right = stackCells(f.sec && "sec", f.ctrl && "ctrl", 1);
    if (!left) left = right;
    if (!right) right = left;
    const rows = [["auto", ["head", "head"]]];
    if (f.cams) rows.push(["auto", ["cams", "cams"]]);
    if (left) {
      const pair = (index) => [left[index], right[index]];
      rows.push(["auto", pair(0)], ["auto", pair(1)], ["minmax(0, 1fr)", pair(2)]);
    } else if (f.cams) {
      rows.push(["minmax(0, 1fr)", [".", "."]]);
    }
    return gridTemplate(["minmax(0, 1fr)", "minmax(0, 1fr)"], rows);
  }

  // ---------------------------------------------------------------------------
  // Skeleton
  // ---------------------------------------------------------------------------
  function panelMarkup(name, inner) { return `<section class="bd-panel bd-${name}" data-bd-area="${name}">${inner}</section>`; }

  function skeletonMarkup() {
    const f = flags;
    const any = f.cams || f.sleep || f.cal || f.sec || f.ctrl;
    const landscape = any ? landscapeLayout(f) : null;
    const portrait = any ? portraitLayout(f) : null;
    const style = landscape ? ` style="--bd-cols-l:${landscape.cols};--bd-rows-l:${landscape.rows};--bd-areas-l:${esc(landscape.areas)};--bd-cols-p:${portrait.cols};--bd-rows-p:${portrait.rows};--bd-areas-p:${esc(portrait.areas)}"` : "";
    const sleepModule = window.BeastBedroom.sleep;
    // Godnat sits in the header, top right, next to the menu button.
    const parts = [`<header class="bd-head${f.night ? " has-night" : ""}" data-bd-area="head"><div class="bd-clock" data-bd-clock></div><div class="bd-climate" data-bd-climate></div>${f.night ? `<button type="button" class="bd-night" data-bd-action="goodnight"></button>` : ""}<button type="button" class="bd-menu-btn" data-bd-action="menu" aria-label="${esc(t("Vis menu"))}">${icon("grid", 18)}</button></header>`];
    if (!any) {
      parts.push(`<div class="bd-empty"><strong>${esc(t("Soveværelset er ikke sat op endnu"))}</strong><span>${esc(t("Vælg enheder i Administration → Soveværelse"))}</span></div>`);
    }
    if (f.cams) parts.push(`<section class="bd-cams" data-bd-area="cams"><div class="bd-cams-inner"></div></section>`);
    if (f.sleep) parts.push(panelMarkup("sleep", sleepModule.panelMarkup()));
    if (f.ctrl) parts.push(panelMarkup("ctrl", `<div class="bd-block" data-bd-block="lights" hidden></div><div class="bd-block" data-bd-block="scenes" hidden></div><div class="bd-block" data-bd-block="comfort" hidden></div><div class="bd-block" data-bd-block="media" hidden></div>`));
    if (f.cal) parts.push(panelMarkup("cal", `<div class="bd-eyebrow"><b>${esc(t("Kalender"))}</b><span class="bd-meta" data-bd-cal-meta></span></div><div class="bd-cal-list" data-bd-cal-list></div>`));
    if (f.sec) parts.push(panelMarkup("sec", ""));
    const shape = [f.cams && "cams", f.sec && "sec", f.sleep && "sleep", f.cal && "cal", f.ctrl && "ctrl"].filter(Boolean).join(" ");
    return `<div class="bd-page${any ? "" : " is-empty"}" data-shape="${shape}"${style}>${parts.join("")}</div><div class="bd-layer" data-bd-layer hidden></div>`;
  }

  function build() {
    if (!root) return;
    closeLayer();
    closeCameraView();
    unmountCameras();
    flags = computeFlags();
    blockSignatures.clear();
    root.innerHTML = skeletonMarkup();
    observeCalendarSize();
    resubscribe();
  }

  // ---------------------------------------------------------------------------
  // Header: clock, date, room title, climate strip
  // ---------------------------------------------------------------------------
  function climateCells() {
    const c = cfg();
    const cells = [];
    const valueCell = (id, digits, label, unitFallback) => {
      const st = state(id);
      if (!id) return;
      const value = numberState(id);
      const unit = st?.attributes?.unit_of_measurement || unitFallback;
      cells.push({ value: value == null ? "–" : fmt(value, digits), unit, label: t(label), dim: value == null });
    };
    valueCell(single(c.temperature), 1, "Temperatur", "°C");
    valueCell(single(c.humidity), 0, "Fugt", "%");
    const co2Id = single(c.co2);
    if (co2Id) {
      const co2 = numberState(co2Id);
      cells.push({ value: co2 == null ? "–" : fmt(co2, 0), unit: "ppm", label: co2 > 1400 ? t("Luft ud") : "CO₂", warn: co2 > 1400 ? "bad" : co2 > 1000, dim: co2 == null });
    }
    const airId = single(c.airQuality);
    const pmId = single(c.pm25);
    if (airId || pmId) {
      const pm = pmId ? numberState(pmId) : null;
      const pmText = pm == null ? "" : `PM2.5 ${fmt(pm, 0)}`;
      if (airId) {
        const raw = String(state(airId)?.state || "");
        const numeric = Number(raw);
        const known = AIR_QUALITY_LABELS[raw.toLowerCase()];
        const value = unavailable(state(airId)) ? "–" : known ? t(known) : Number.isFinite(numeric) && raw !== "" ? fmt(numeric, 0) : capitalize(raw.replaceAll("_", " "));
        const tone = ["excellent", "good"].includes(raw.toLowerCase()) ? "ok" : ["poor", "bad", "very_poor", "unhealthy"].includes(raw.toLowerCase()) ? "warn" : "";
        cells.push({ value, label: pmText ? `${t("Luft")} · ${pmText}` : t("Luft"), dot: tone, optional: true });
      } else {
        cells.push({ value: pm == null ? "–" : fmt(pm, 0), unit: "µg/m³", label: "PM2.5", optional: true });
      }
    }
    const windowId = single(c.window);
    if (windowId) {
      const st = state(windowId);
      const open = st?.state === "on";
      cells.push({ value: unavailable(st) ? "–" : open ? t("Åben") : t("Lukket"), label: t("Vindue"), warn: open });
    }
    return cells;
  }

  function renderHeader() {
    const head = root?.querySelector(".bd-head");
    if (!head) return;
    const now = new Date();
    const cells = climateCells();
    const signature = JSON.stringify([hm(now), now.getDate(), roomTitle(), cells]);
    if (blockSignatures.get("head") === signature) return;
    blockSignatures.set("head", signature);
    const [hours, minutes] = hm(now).split(":");
    const clock = head.querySelector("[data-bd-clock]");
    const climate = head.querySelector("[data-bd-climate]");
    if (clock) clock.innerHTML = `<div class="bd-time" aria-label="${esc(hm(now))}">${hours}<i>:</i>${minutes}</div><div class="bd-date"><span class="bd-d2">${esc(roomTitle())}</span><span class="bd-d1">${esc(capitalize(now.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" })))}</span></div>`;
    if (climate) {
      climate.hidden = !cells.length;
      climate.innerHTML = cells.map((cell) => `<div class="bd-cl${cell.optional ? " is-optional" : ""}${cell.dot ? ` is-tone-${cell.dot}` : ""}${cell.warn ? ` is-${cell.warn === "bad" ? "bad" : "warn"}` : ""}${cell.dim ? " is-dim" : ""}"><span class="bd-cl-v">${cell.dot ? `<i class="bd-dot is-${cell.dot}"></i>` : ""}<span class="bd-cl-n">${esc(cell.value)}</span>${cell.unit ? `<small>${esc(cell.unit)}</small>` : ""}</span><span class="bd-cl-k">${esc(cell.label)}</span></div>`).join("");
    }
  }

  // ---------------------------------------------------------------------------
  // Cameras: two live tiles, created only while the page is active
  // ---------------------------------------------------------------------------
  function go2rtcBase() { return String(BeastConfig.get("panels.cameras.go2rtcBaseUrl") || "").replace(/\/+$/, ""); }

  function cameraSpec(entityId, wantHigh = false) {
    const cam = window.BeastCameras?.resolveCamera?.(entityId);
    if (!cam) return null;
    const siblings = [];
    BeastHaSocket.getAllStates().forEach((st, id) => {
      if (!id.startsWith("camera.")) return;
      const info = window.BeastCameras.resolveCamera(id);
      if (info && info.slug === cam.slug) siblings.push(info);
    });
    const pick = (items, quality) => items.find((item) => item.quality === quality);
    const order = wantHigh ? ["high", "standard", "medium", "low"] : ["medium", "low", "standard", "high"];
    const ha = order.map((quality) => pick(siblings, quality)).find(Boolean) || cam;
    const variants = cam.streamVariants || [];
    const g2r = order.map((quality) => pick(variants, quality)).find(Boolean) || variants[0] || null;
    return { cam, ha, g2r, label: overrides().get(entityId) || cam.label };
  }

  function streamMarkup(spec) {
    return `<beast-ha-camera-stream data-entity-id="${esc(spec.ha.entityId)}" data-camera-picture="${esc(spec.ha.entityPicture || "")}" data-camera-label="${esc(spec.label)}" data-go2rtc-base="${esc(go2rtcBase())}" data-go2rtc-source="${esc(spec.g2r?.streamName || "")}"></beast-ha-camera-stream>`;
  }

  function cameraIds() { return list(cfg().cameras).slice(0, 2); }

  let streamDiscoveryVersion = 0;
  // Rebuilding a tile tears its stream down, so this only happens when a
  // camera's availability or the go2rtc stream list changes.
  function mountCameras() {
    const host = root?.querySelector(".bd-cams-inner");
    if (!host || !active) return;
    const ids = cameraIds();
    const statesReady = BeastHaSocket.getAllStates().size > 0;
    const signature = JSON.stringify([statesReady, streamDiscoveryVersion, go2rtcBase(), ids.map((id) => state(id) ? (state(id).state === "unavailable" ? "x" : "1") : "0")]);
    if (blockSignatures.get("cams") === signature) { updateCameraOverlays(); return; }
    blockSignatures.set("cams", signature);
    const specs = ids.map((id) => {
      const st = state(id);
      if (!statesReady) return { id, wait: true };
      if (!st || st.state === "unavailable") return { id, unavailable: true, label: overrides().get(id) || window.BeastCameras?.resolveCamera?.(id)?.label || displayName(id) };
      return { id, spec: cameraSpec(id) };
    });
    disconnectCameraObservers();
    host.innerHTML = specs.map((item, index) => {
      if (item.wait || !item.spec) {
        return `<div class="bd-cam is-unavailable"><span class="bd-cam-empty">${item.wait ? "" : icon("camera", 22)}<span>${esc(item.wait ? t("Forbinder…") : t("Kamera utilgængeligt"))}</span></span>${item.label ? `<span class="bd-cam-top"><span class="bd-cam-name">${esc(item.label)}</span></span>` : ""}</div>`;
      }
      return `<div class="bd-cam" role="button" tabindex="0" data-bd-action="camera-view" data-index="${index}" aria-label="${esc(t("Vis {name} i fuld skærm", { name: item.spec.label }))}">
        <div class="bd-cam-media">${streamMarkup(item.spec)}</div>
        <div class="bd-cam-scrim"></div>
        <span class="bd-cam-top"><span class="bd-cam-name">${esc(item.spec.label)}</span><span class="bd-cam-live" data-live="connecting">${esc(t("Forbinder"))}</span><span class="bd-cam-time"></span></span>
        <span class="bd-cam-expand">${icon("corners", 16)}</span>
      </div>`;
    }).join("");
    host.querySelectorAll("beast-ha-camera-stream").forEach((element) => {
      const observer = new MutationObserver(() => updateCameraOverlays());
      observer.observe(element, { attributes: true, attributeFilter: ["class"], childList: true });
      cameraObservers.push(observer);
    });
    posterRefreshedAt = Date.now();
    updateCameraOverlays();
  }

  // The go2rtc fallback player is its own document; it reports its health
  // with postMessage, so the LIVE pill only shows once video really plays.
  function onPlayerMessage(event) {
    if (event.origin !== window.location.origin || !["camera-player-ready", "camera-player-health"].includes(event.data?.type)) return;
    const frame = [...(root?.querySelectorAll(".bd-cam iframe") || [])].find((item) => item.contentWindow === event.source);
    if (!frame) return;
    frame.dataset.health = event.data.type === "camera-player-ready" ? "playing" : String(event.data.state || "");
    updateCameraOverlays();
  }

  function updateCameraOverlays() {
    root?.querySelectorAll(".bd-cam[data-index]").forEach((tile) => {
      const element = tile.querySelector("beast-ha-camera-stream");
      const live = Boolean(element && (element.classList.contains("is-ready") || element.querySelector("iframe")?.dataset.health === "playing"));
      const pill = tile.querySelector(".bd-cam-live");
      if (pill && pill.dataset.live !== (live ? "live" : "connecting")) {
        pill.dataset.live = live ? "live" : "connecting";
        pill.textContent = live ? "LIVE" : t("Forbinder");
      }
      tile.classList.toggle("is-live", live);
      const time = tile.querySelector(".bd-cam-time");
      if (time) time.textContent = hm(new Date());
    });
  }

  function refreshCameraPosters() {
    if (Date.now() - posterRefreshedAt < POSTER_REFRESH_MS) return;
    posterRefreshedAt = Date.now();
    root?.querySelectorAll(".bd-cam beast-ha-camera-stream").forEach((element) => {
      const poster = element.querySelector(".beast-ha-camera-poster");
      const picture = state(element.dataset.entityId)?.attributes?.entity_picture || element.dataset.cameraPicture;
      if (poster && picture) BeastAuth.setAuthedImageSrc(poster, picture);
    });
  }

  function disconnectCameraObservers() {
    cameraObservers.forEach((observer) => observer.disconnect());
    cameraObservers = [];
  }

  function unmountCameras() {
    disconnectCameraObservers();
    const host = root?.querySelector(".bd-cams-inner");
    if (host) host.innerHTML = "";
    blockSignatures.delete("cams");
  }

  // Full-screen camera: a body-level view (it has to cover the whole viewport
  // and keep playing while the dashboard's own streams are paused under it).
  function openCameraView(index = 0) {
    const ids = cameraIds().filter((id) => state(id) && state(id).state !== "unavailable");
    if (!ids.length) return;
    closeLayer();
    const current = Math.max(0, Math.min(ids.length - 1, index));
    const spec = cameraSpec(ids[current], true);
    if (!spec) return;
    if (!cameraView) {
      const view = document.createElement("div");
      view.className = "beast-bedroom-camview";
      view.setAttribute("role", "dialog");
      view.setAttribute("aria-modal", "true");
      document.body.appendChild(view);
      view.addEventListener("click", (event) => {
        const step = event.target.closest("[data-bd-cam-step]");
        if (step) { event.stopPropagation(); openCameraView(cameraView.index + Number(step.dataset.bdCamStep)); return; }
        closeCameraView();
      });
      cameraView = { element: view, index: current, timerId: null };
      document.dispatchEvent(new CustomEvent("beast:dashboard-cover", { detail: { source: "bedroom-camera", on: true } }));
    }
    cameraView.index = (current + ids.length) % ids.length;
    cameraView.element.setAttribute("aria-label", spec.label);
    cameraView.element.innerHTML = `<div class="bd-cv-media">${streamMarkup(spec)}</div>
      <div class="bd-cv-top"><span class="bd-cv-name">${esc(spec.label)}</span><button type="button" class="bd-cv-close" aria-label="${esc(t("Luk"))}">${icon("x", 22)}</button></div>
      ${ids.length > 1 ? `<button type="button" class="bd-cv-step is-prev" data-bd-cam-step="-1" aria-label="${esc(t("Forrige kamera"))}">${icon("chev-left", 26)}</button><button type="button" class="bd-cv-step is-next" data-bd-cam-step="1" aria-label="${esc(t("Næste kamera"))}">${icon("chev", 26)}</button>` : ""}`;
    window.clearTimeout(cameraView.timerId);
    cameraView.timerId = window.setTimeout(closeCameraView, CAMERA_VIEW_MAX_MS);
  }

  function closeCameraView() {
    if (!cameraView) return;
    window.clearTimeout(cameraView.timerId);
    cameraView.element.remove();
    cameraView = null;
    document.dispatchEvent(new CustomEvent("beast:dashboard-cover", { detail: { source: "bedroom-camera", on: false } }));
  }

  // ---------------------------------------------------------------------------
  // Calendar: today, tomorrow and the next days, whole rows until it is full
  // ---------------------------------------------------------------------------
  function parseEventTime(value) {
    if (!value) return null;
    if (value.dateTime) {
      const at = Date.parse(value.dateTime);
      return Number.isFinite(at) ? { at, allDay: false } : null;
    }
    const day = parseDateKey(value.date);
    if (!day) return null;
    day.setHours(0, 0, 0, 0);
    return { at: day.getTime(), allDay: true };
  }

  async function loadCalendar() {
    const ids = list(cfg().calendars);
    if (!ids.length) return;
    const request = ++calendarRequest;
    const start = startOfDay();
    const end = addDays(start, 8);
    const results = await Promise.all(ids.map((id, index) => BeastAuth.haFetch(`/api/calendars/${encodeURIComponent(id)}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`)
      .then((events) => (Array.isArray(events) ? events : []).map((event) => {
        const from = parseEventTime(event.start);
        const to = parseEventTime(event.end);
        if (!from) return null;
        return { title: String(event.summary || "").trim() || t("Uden titel"), start: from.at, end: to ? to.at : from.at + 3600000, allDay: from.allDay, calendar: id, color: CALENDAR_COLORS[index % CALENDAR_COLORS.length] };
      }).filter(Boolean))
      .catch(() => [])));
    if (request !== calendarRequest) return;
    const seen = new Set();
    calendarEvents = results.flat().filter((event) => {
      const key = `${event.title}|${event.start}|${event.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    calendarFetchedAt = Date.now();
    blockSignatures.delete("cal");
    renderCalendar();
  }

  function calendarRows(now = Date.now()) {
    const today = startOfDay(new Date(now));
    const todayKey = dateKey(today);
    const tomorrowKey = dateKey(addDays(today, 1));
    const rows = (calendarEvents || []).filter((event) => event.end > now).map((event) => {
      const day = new Date(Math.max(event.start, today.getTime()));
      const ongoing = event.start <= now;
      return { ...event, ongoing, day: dateKey(day), dayDate: day };
    });
    rows.sort((a, b) => a.day.localeCompare(b.day)
      || (a.ongoing && !a.allDay ? 0 : a.allDay ? 2 : 1) - (b.ongoing && !b.allDay ? 0 : b.allDay ? 2 : 1)
      || a.start - b.start || a.title.localeCompare(b.title));
    const groups = [];
    rows.forEach((row) => {
      let group = groups[groups.length - 1];
      if (!group || group.key !== row.day) {
        const label = row.day === todayKey
          ? (new Date(now).getHours() >= 17 ? t("I aften") : t("I dag"))
          : row.day === tomorrowKey ? t("I morgen · {day}", { day: weekdayName(row.dayDate) }) : capitalize(weekdayName(row.dayDate));
        group = { key: row.day, label, rows: [] };
        groups.push(group);
      }
      group.rows.push(row);
    });
    return { groups, tomorrowKey };
  }

  function eventRowMarkup(event, now) {
    const endDate = new Date(event.end);
    const sameDay = dateKey(endDate) === dateKey(new Date(now)) || (event.allDay && event.end - now <= 86400000);
    let time;
    if (event.ongoing && !event.allDay) time = `<span class="bd-ev-tm is-now">${esc(t("Nu"))}</span>`;
    else if (event.allDay) time = `<span class="bd-ev-tm is-all">${esc(t("Heldag"))}</span>`;
    else time = `<span class="bd-ev-tm">${hm(new Date(event.start))}</span>`;
    let right;
    if (event.ongoing && !event.allDay) {
      right = `<span class="bd-ev-until">${esc(sameDay ? t("til {time}", { time: hm(endDate) }) : t("til {day} {time}", { day: endDate.toLocaleDateString(locale(), { weekday: "short" }).replace(/\.$/, ""), time: hm(endDate) }))}</span>`;
    } else {
      right = `<span class="bd-ev-src">${esc(displayName(event.calendar))}</span>`;
    }
    return `<div class="bd-ev${event.ongoing && !event.allDay ? " is-now" : ""}" data-bd-ev>${time}<span class="bd-ev-ti" style="--c:${event.color}">${esc(event.title)}</span>${right}</div>`;
  }

  function renderCalendar() {
    const panel = root?.querySelector(".bd-cal");
    const host = panel?.querySelector("[data-bd-cal-list]");
    if (!host || !active) return;
    const now = Date.now();
    const { groups, tomorrowKey } = calendarRows(now);
    const boundary = groups.flatMap((group) => group.rows).map((row) => (row.ongoing ? row.end : row.start)).filter((at) => at > now).sort((a, b) => a - b)[0] || 0;
    const signature = JSON.stringify([calendarFetchedAt, host.clientHeight, host.clientWidth, new Date(now).getHours() >= 17, dateKey(new Date(now)), boundary > now ? boundary : 0, Math.floor(now / 3600000)]);
    if (blockSignatures.get("cal") === signature) return;
    blockSignatures.set("cal", signature);
    const meta = panel.querySelector("[data-bd-cal-meta]");
    if (calendarEvents === null) {
      host.innerHTML = `<p class="bd-quiet">${esc(t("Henter kalender…"))}</p>`;
      if (meta) meta.textContent = "";
      return;
    }
    if (!groups.length) {
      host.innerHTML = `<p class="bd-quiet">${esc(t("Intet i kalenderen de næste dage"))}</p>`;
      if (meta) meta.textContent = t("I dag og i morgen");
      return;
    }
    host.innerHTML = groups.map((group) => `<div class="bd-day" data-bd-day>${esc(group.label)}</div>${group.rows.map((row) => eventRowMarkup(row, now)).join("")}`).join("") + `<div class="bd-more" data-bd-more hidden></div>`;
    fitCalendar(host);
    const shownDays = [...host.querySelectorAll("[data-bd-day]")].length;
    const lastShown = groups[Math.max(0, shownDays - 1)]?.key || "";
    if (meta) meta.textContent = lastShown && lastShown > tomorrowKey ? t("De næste dage") : t("I dag og i morgen");
  }

  // Whole rows only: drop rows (and a day header left without rows) from the
  // end until the list fits, then say how many were left out.
  function fitCalendar(host) {
    const limit = host.clientHeight;
    if (!limit) return;
    const rows = [...host.querySelectorAll("[data-bd-ev]")];
    const more = host.querySelector("[data-bd-more]");
    const fits = () => host.scrollHeight <= limit + 1;
    if (fits()) return;
    let hidden = 0;
    more.hidden = false;
    while (rows.length && !fits()) {
      rows.pop().remove();
      hidden += 1;
      more.textContent = t("+{n} mere", { n: hidden });
      const last = more.previousElementSibling;
      if (last?.matches("[data-bd-day]")) last.remove();
    }
  }

  function observeCalendarSize() {
    calendarResizeObserver?.disconnect();
    const host = root?.querySelector("[data-bd-cal-list]");
    if (!host || typeof ResizeObserver === "undefined") return;
    let lastSize = "";
    calendarResizeObserver = new ResizeObserver(() => {
      const size = `${host.clientWidth}x${host.clientHeight}`;
      if (size === lastSize) return;
      lastSize = size;
      blockSignatures.delete("cal");
      // Synchronously: the list's own size never depends on its rows, so
      // refitting here cannot loop.
      renderCalendar();
    });
    calendarResizeObserver.observe(host);
  }

  // ---------------------------------------------------------------------------
  // Lights
  // ---------------------------------------------------------------------------
  function dimmable(st) {
    const modes = st?.attributes?.supported_color_modes;
    if (Array.isArray(modes)) return modes.some((mode) => mode !== "onoff");
    return st?.attributes?.brightness != null;
  }

  function lightModel(id) {
    const st = state(id);
    const name = displayName(id);
    if (unavailable(st)) return { id, name, unavailable: true, stateText: t("Utilgængelig"), pct: 0 };
    const pend = pendingFor(id);
    let on = st.state === "on";
    let pct = on ? Math.max(1, Math.round((Number(st.attributes.brightness) || 0) / 2.55)) : 0;
    if (on && st.attributes.brightness != null) lastBrightness.set(id, pct);
    if (pend && "on" in pend) on = pend.on;
    if (pend && pend.pct != null) pct = pend.pct;
    if (!on) pct = 0;
    else if (!pct) pct = lastBrightness.get(id) || 100;
    const members = Array.isArray(st.attributes.entity_id) ? st.attributes.entity_id : null;
    const canDim = dimmable(st);
    let stateText;
    if (!on) stateText = t("Slukket");
    else if (members && members.length > 1) stateText = t("Tændt · {on} af {n}", { on: Math.max(1, members.filter((member) => state(member)?.state === "on").length), n: members.length });
    else if (canDim) stateText = `${fmt(pct, 0)} %`;
    else stateText = t("Tændt");
    return { id, name, on, pct, canDim, stateText, members };
  }

  // A row that is also the dimmer: tap toggles, a sideways drag anywhere on
  // the row sets the brightness. The warm fill behind the text shows the
  // level; its handle runs along the bottom edge so it never crosses the name.
  function lightTileMarkup(model, sub = null) {
    const lamps = model.members && model.members.length > 1 ? t("{n} lamper", { n: model.members.length }) : "";
    if (model.unavailable) {
      return `<div class="bd-light is-unavailable" data-light="${esc(model.id)}"><div class="bd-light-tap"><span class="bd-light-ic">${icon("bulb", 18)}</span><span class="bd-light-text"><span class="bd-light-name">${esc(model.name)}</span><span class="bd-light-sub">${esc(t("Utilgængelig"))}</span></span></div></div>`;
    }
    const pend = pendingFor(model.id);
    const busy = Boolean(pend && Date.now() - pend.at < 3000);
    const value = busy ? "…" : !model.on ? t("Fra") : model.canDim ? `${fmt(model.pct, 0)} %` : t("Til");
    let subText = sub ? sub.text : "";
    if (!subText) subText = model.members && model.members.length > 1 ? (model.on ? model.stateText : lamps) : model.on ? t("Tændt") : t("Slukket");
    return `<div class="bd-light${model.on ? " is-on" : ""}${model.canDim ? " can-dim" : ""}${busy ? " is-busy" : ""}" data-light="${esc(model.id)}"${model.canDim ? ` data-bd-dimmer="${esc(model.id)}" role="group" aria-label="${esc(t("Lysstyrke {name}", { name: model.name }))}" aria-valuenow="${model.pct}"` : ""} style="--b:${model.pct}%">
      ${model.canDim ? `<span class="bd-light-fill"></span><span class="bd-light-rail"><span class="bd-light-knob"></span></span>` : ""}
      <button type="button" class="bd-light-tap" data-bd-action="light-toggle" data-entity="${esc(model.id)}" aria-pressed="${model.on}"><span class="bd-light-ic">${icon("bulb", 18)}</span><span class="bd-light-text"><span class="bd-light-name">${esc(model.name)}</span><span class="bd-light-sub${sub?.tone ? ` is-${sub.tone}` : ""}">${esc(subText)}</span></span><span class="bd-light-val">${esc(value)}</span></button>
    </div>`;
  }

  // Motion sensor (e.g. under the bed): the bit of its name before the
  // motion word, and its state as a short line.
  function motionInfo() {
    const id = single(cfg().motion);
    if (!id) return null;
    const st = state(id);
    const raw = overrides().get(id) || String(displayName(id)).replace(/\s+(occupancy|motion|presence|bevægelse|tilstedeværelse)$/i, "").replace(/^(motion|bevægelse)\s+/i, "").trim();
    const name = capitalize(raw) || t("Bevægelse");
    if (unavailable(st)) return { name, short: t("Ingen data"), line: t("{name}: ingen data", { name }) };
    return st.state === "on"
      ? { name, short: t("Bevægelse nu"), line: t("{name}: bevægelse nu", { name }), tone: "gold" }
      : { name, short: t("Ingen bevægelse"), line: t("{name}: ingen bevægelse", { name }) };
  }

  function lightIds() { return list(cfg().lights); }

  // The room's "all lights" group: a configured light group that contains at
  // least two of the other configured lights. It becomes the pill in the
  // block heading instead of a row.
  function roomGroupId(ids) {
    return ids.find((id) => {
      const members = state(id)?.attributes?.entity_id;
      return Array.isArray(members) && ids.filter((other) => other !== id && members.includes(other)).length >= 2;
    }) || null;
  }

  function renderLights() {
    const block = root?.querySelector('[data-bd-block="lights"]');
    if (!block || lightDrag) return;
    const all = lightIds();
    const groupId = all.length > 2 ? roomGroupId(all) : null;
    const ids = all.filter((id) => id !== groupId).slice(0, 4);
    block.hidden = !all.length;
    if (!all.length) return;
    const models = ids.map(lightModel);
    const group = groupId ? lightModel(groupId) : null;
    const motion = motionInfo();
    const norm = (text) => String(text || "").toLocaleLowerCase(locale()).trim();
    const motionRow = motion ? models.find((model) => norm(model.name) === norm(motion.name)) : null;
    const signature = JSON.stringify([models, group, motion, motionRow?.id, ids.map((id) => pendingFor(id) ? 1 : 0)]);
    if (blockSignatures.get("lights") === signature) return;
    blockSignatures.set("lights", signature);
    const pill = group && !group.unavailable
      ? `<button type="button" class="bd-pill${group.on ? " is-on" : ""}" data-bd-action="light-toggle" data-entity="${esc(group.id)}" aria-pressed="${group.on}"><i></i><span>${esc(group.on ? t("{name} tændt", { name: group.name }) : t("{name} slukket", { name: group.name }))}</span></button>`
      : motion && !motionRow ? `<span class="bd-meta${motion.tone ? ` is-${motion.tone}` : ""}">${esc(motion.line)}</span>` : "";
    block.innerHTML = `<div class="bd-blockhead"><b>${esc(t("Lys"))}</b>${pill}</div><div class="bd-lights" data-n="${models.length}">${models.map((model) => lightTileMarkup(model, model === motionRow ? { text: motion.short, tone: motion.tone } : null)).join("")}</div>`;
  }

  function toggleLight(id) {
    const model = lightModel(id);
    if (model.unavailable) return;
    const next = !model.on;
    setPending(id, { on: next, pct: next ? null : 0 }, 5000);
    renderLightsEverywhere();
    callService("light", next ? "turn_on" : "turn_off", id).catch((error) => {
      pending.delete(id);
      BeastCore.log(`Soveværelse: lys fejlede (${error.message}).`);
      renderLightsEverywhere();
    });
  }

  function commitBrightness(id, pct) {
    setPending(id, { on: pct > 0, pct }, 5000);
    renderLightsEverywhere();
    const request = pct > 0 ? callService("light", "turn_on", id, { brightness_pct: pct }) : callService("light", "turn_off", id);
    request.catch((error) => {
      pending.delete(id);
      BeastCore.log(`Soveværelse: lysstyrke fejlede (${error.message}).`);
      renderLightsEverywhere();
    });
  }

  function renderLightsEverywhere() {
    blockSignatures.delete("lights");
    renderLights();
    if (layerKind === "lights") renderLightsSheet();
    window.BeastBedroom.menu?.refresh?.();
  }

  function previewDimmer(row, pct) {
    row.style.setProperty("--b", `${pct}%`);
    row.classList.toggle("is-on", pct > 0);
    row.setAttribute("aria-valuenow", String(pct));
    const value = row.querySelector(".bd-light-val");
    if (value) value.textContent = pct > 0 ? `${fmt(pct, 0)} %` : t("Fra");
    const sub = row.querySelector(".bd-light-sub");
    if (sub && [t("Slukket"), t("Tændt")].includes(sub.textContent)) sub.textContent = pct > 0 ? t("Tændt") : t("Slukket");
  }

  // Sideways drag on a dimmable row. Brightness follows the finger relative
  // to where it started (no jump on touch-down); the light gets at most one
  // command every 250 ms while dragging plus one on release. A drag never
  // toggles: the click that follows it is swallowed.
  const DRAG_START_PX = 8;
  const DRAG_SEND_MS = 250;
  let suppressClickUntil = 0;

  function onDimmerDown(event) {
    const row = event.target.closest("[data-bd-dimmer]");
    if (!row || !root.contains(row) || event.button > 0 || lightDrag) return;
    const id = row.dataset.bdDimmer;
    const startPct = Number(row.getAttribute("aria-valuenow")) || 0;
    const startX = event.clientX;
    const startY = event.clientY;
    const width = Math.max(1, row.getBoundingClientRect().width);
    let dragging = false;
    let sentAt = 0;
    let sendTimer = null;
    let pct = startPct;
    const send = () => {
      sentAt = Date.now();
      sendTimer = null;
      const request = pct > 0 ? callService("light", "turn_on", id, { brightness_pct: pct }) : callService("light", "turn_off", id);
      request.catch(() => {});
    };
    const move = (moveEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const dx = moveEvent.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) < DRAG_START_PX || Math.abs(dx) < Math.abs(moveEvent.clientY - startY)) return;
        dragging = true;
        lightDrag = { id, row };
        row.setPointerCapture?.(event.pointerId);
        row.classList.add("is-dragging");
      }
      moveEvent.preventDefault();
      pct = Math.max(0, Math.min(100, Math.round(startPct + (dx / width) * 100)));
      previewDimmer(row, pct);
      if (Date.now() - sentAt >= DRAG_SEND_MS) send();
      else if (!sendTimer) sendTimer = window.setTimeout(send, DRAG_SEND_MS - (Date.now() - sentAt));
    };
    const finish = (endEvent) => {
      if (endEvent.pointerId !== event.pointerId) return;
      row.removeEventListener("pointermove", move);
      row.removeEventListener("pointerup", finish);
      row.removeEventListener("pointercancel", finish);
      if (!dragging) return;
      window.clearTimeout(sendTimer);
      row.releasePointerCapture?.(endEvent.pointerId);
      row.classList.remove("is-dragging");
      lightDrag = null;
      suppressClickUntil = Date.now() + 400;
      if (endEvent.type === "pointercancel") renderLightsEverywhere();
      else commitBrightness(id, pct);
    };
    row.addEventListener("pointermove", move);
    row.addEventListener("pointerup", finish);
    row.addEventListener("pointercancel", finish);
  }

  function onDimmerKey(event) {
    const row = event.target.closest?.("[data-bd-dimmer]");
    if (!row || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const current = Number(row.getAttribute("aria-valuenow")) || 0;
    const pct = Math.max(0, Math.min(100, current + (["ArrowRight", "ArrowUp"].includes(event.key) ? 10 : -10)));
    commitBrightness(row.dataset.bdDimmer, pct);
  }

  // ---------------------------------------------------------------------------
  // Scenes and scripts
  // ---------------------------------------------------------------------------
  function sceneIds() { return [...list(cfg().scenes), ...list(cfg().scripts)]; }

  function activatedAt(id) {
    const st = state(id);
    if (!st) return 0;
    const raw = id.startsWith("script.") ? st.attributes?.last_triggered : st.state;
    const at = Date.parse(raw || "");
    return Number.isFinite(at) ? at : 0;
  }

  // "Senest aktiveret": the most recently activated scene, and only while it
  // is younger than activeSceneMinutes.
  function activeSceneId(ids) {
    const raw = cfg().activeSceneMinutes;
    const minutes = raw === "" || raw == null || !Number.isFinite(Number(raw)) ? 30 : Math.max(0, Number(raw));
    const cutoff = Date.now() - minutes * 60000;
    let best = null;
    let bestAt = 0;
    ids.forEach((id) => {
      const at = activatedAt(id);
      if (at > cutoff && at > bestAt && at <= Date.now() + 60000) { best = id; bestAt = at; }
    });
    return best;
  }

  function sceneChipMarkup(id, activeId) {
    const st = state(id);
    const pend = pendingFor(id);
    const classes = ["bd-chip"];
    if (id === activeId) classes.push("is-on");
    if (pend?.scene === "running") classes.push("is-confirm");
    if (pend?.scene === "error") classes.push("is-error");
    const off = !st || st.state === "unavailable";
    return `<button type="button" class="${classes.join(" ")}" data-bd-action="scene" data-entity="${esc(id)}"${off ? " disabled" : ""}${id === activeId ? ` aria-label="${esc(`${displayName(id)} · ${t("senest aktiveret")}`)}"` : ""}><span>${esc(displayName(id))}</span></button>`;
  }

  function renderScenes() {
    const block = root?.querySelector('[data-bd-block="scenes"]');
    if (!block) return;
    const ids = sceneIds().slice(0, 5);
    block.hidden = !ids.length;
    if (!ids.length) return;
    const activeId = activeSceneId(sceneIds());
    const markup = ids.map((id) => sceneChipMarkup(id, activeId)).join("");
    const signature = `${markup}|${state(ids[0]) ? "1" : "0"}`;
    if (blockSignatures.get("scenes") === signature) return;
    blockSignatures.set("scenes", signature);
    block.innerHTML = `<div class="bd-blockhead"><b>${esc(t("Stemninger"))}</b></div><div class="bd-scenes" data-n="${ids.length}">${markup}</div>`;
  }

  function activateScene(id) {
    const domain = id.split(".")[0];
    setPending(id, { scene: "running" }, 1600);
    renderScenesEverywhere();
    callService(domain, "turn_on", id).then(() => {
      window.setTimeout(renderScenesEverywhere, 1700);
    }).catch((error) => {
      setPending(id, { scene: "error" }, 2500);
      BeastCore.log(`Soveværelse: scene fejlede (${error.message}).`);
      renderScenesEverywhere();
      window.setTimeout(renderScenesEverywhere, 2600);
    });
  }

  function renderScenesEverywhere() {
    blockSignatures.delete("scenes");
    renderScenes();
    if (layerKind === "scenes") renderScenesSheet();
  }

  // ---------------------------------------------------------------------------
  // Comfort toggles (switches and fans) and media
  // ---------------------------------------------------------------------------
  // Komfort: switches and fans as tiles with an icon well; the whole tile
  // toggles. Fans that report a speed show it.
  function comfortIcon(id) {
    if (id.startsWith("fan.")) return "fan";
    return /sleep|søvn|sove|night|nat/i.test(`${id} ${displayName(id)}`) ? "moon" : "power";
  }

  function renderComfort() {
    const block = root?.querySelector('[data-bd-block="comfort"]');
    if (!block) return;
    const ids = [...list(cfg().comfort), ...list(cfg().comfortBooleans), ...list(cfg().fans)];
    block.hidden = !ids.length;
    if (!ids.length) return;
    const items = ids.map((id) => {
      const st = state(id);
      const pend = pendingFor(id);
      const on = pend && "on" in pend ? pend.on : st?.state === "on";
      const speed = id.startsWith("fan.") && on && !pend ? Number(st?.attributes?.percentage) : NaN;
      const sub = unavailable(st) ? t("Utilgængelig") : on ? (Number.isFinite(speed) && speed > 0 ? t("Hastighed {pct} %", { pct: fmt(speed, 0) }) : t("Tændt")) : t("Slukket");
      return { id, name: displayName(id), on, off: unavailable(st), sub, glyph: comfortIcon(id) };
    });
    const signature = JSON.stringify(items);
    if (blockSignatures.get("comfort") === signature) return;
    blockSignatures.set("comfort", signature);
    block.innerHTML = `<div class="bd-blockhead"><b>${esc(t("Komfort"))}</b></div><div class="bd-toggles" data-n="${items.length}">${items.map((item) => `<button type="button" class="bd-tog${item.on ? " is-on" : ""}${item.off ? " is-off" : ""}" role="switch" aria-checked="${item.on}" data-bd-action="toggle" data-entity="${esc(item.id)}"${item.off ? " disabled" : ""}><span class="bd-tog-ic">${icon(item.glyph, 18)}</span><span class="bd-tog-text"><span class="bd-tog-name">${esc(item.name)}</span><span class="bd-tog-sub">${esc(item.sub)}</span></span></button>`).join("")}</div>`;
  }

  function toggleEntity(id) {
    const st = state(id);
    if (unavailable(st)) return;
    const domain = id.split(".")[0];
    const next = !(pendingFor(id)?.on ?? st.state === "on");
    setPending(id, { on: next }, 5000);
    blockSignatures.delete("comfort");
    renderComfort();
    callService(domain, next ? "turn_on" : "turn_off", id).catch((error) => {
      pending.delete(id);
      BeastCore.log(`Soveværelse: kontakt fejlede (${error.message}).`);
      blockSignatures.delete("comfort");
      renderComfort();
    });
  }

  const MEDIA_FEATURES = { PAUSE: 1, TURN_ON: 128, TURN_OFF: 256, PLAY: 16384 };
  function mediaModel(id) {
    const st = state(id);
    const name = displayName(id);
    if (unavailable(st)) return { id, name, unavailable: true };
    const a = st.attributes || {};
    const features = Number(a.supported_features) || 0;
    const pend = pendingFor(id);
    const status = pend?.status || st.state;
    const isTv = a.device_class === "tv";
    const on = !["off", "standby", "unavailable", "unknown"].includes(status);
    const title = String(a.media_title || "").trim();
    const app = String(a.app_name || a.source || "").trim();
    let verb = "";
    let rest = "";
    if (!on) rest = t("Slukket");
    else if (status === "playing") { verb = t("Afspiller"); rest = title || app; }
    else if (status === "paused") { verb = t("Pause"); rest = title || app; }
    else { verb = app || t("Tændt"); rest = app ? t("tændt") : ""; }
    let action = null;
    if (isTv && (features & (MEDIA_FEATURES.TURN_ON | MEDIA_FEATURES.TURN_OFF))) action = on ? "turn_off" : "turn_on";
    else if (["playing", "paused"].includes(status) && (features & (MEDIA_FEATURES.PLAY | MEDIA_FEATURES.PAUSE))) action = "media_play_pause";
    else if (features & (MEDIA_FEATURES.TURN_ON | MEDIA_FEATURES.TURN_OFF)) action = on ? "turn_off" : "turn_on";
    let progress = null;
    const durationS = Number(a.media_duration);
    const position = Number(a.media_position);
    if (status === "playing" || status === "paused") {
      if (durationS > 0 && Number.isFinite(position)) {
        const updated = Date.parse(a.media_position_updated_at || "") || Date.now();
        const elapsed = status === "playing" ? (Date.now() - updated) / 1000 : 0;
        progress = Math.max(0, Math.min(100, ((position + elapsed) / durationS) * 100));
      }
    }
    return { id, name, on, isTv, verb, rest, action, title, playing: status === "playing", paused: status === "paused", progress: progress == null ? null : Math.round(progress * 2) / 2 };
  }

  // Playing something with a title: the title leads and the device follows
  // (as on a lock screen); otherwise the device name and its state.
  function mediaRowMarkup(model) {
    if (model.unavailable) {
      return `<div class="bd-mrow is-unavailable"><span class="bd-art">${icon("speaker", 18)}</span><span class="bd-mtext"><span class="bd-m1">${esc(model.name)}</span><span class="bd-m2">${esc(t("Utilgængelig"))}</span></span></div>`;
    }
    const button = model.action === "media_play_pause"
      ? `<button type="button" class="bd-ib${model.playing ? " is-on" : ""}" data-bd-action="media" data-service="media_play_pause" data-entity="${esc(model.id)}" aria-label="${esc(model.playing ? t("Pause") : t("Afspil"))}">${icon(model.playing ? "pause" : "play", 16)}</button>`
      : model.action ? `<button type="button" class="bd-ib" data-bd-action="media" data-service="${model.action}" data-entity="${esc(model.id)}" aria-label="${esc(model.on ? t("Sluk") : t("Tænd"))}">${icon("power", 17)}</button>` : "";
    const titled = (model.playing || model.paused) && model.title;
    let line1 = model.name;
    let line2;
    if (titled) {
      line1 = model.title;
      line2 = `${esc(model.name)}${model.paused ? ` · ${esc(t("Pause"))}` : ""}`;
    } else {
      const verb = model.paused ? esc(model.verb) : `<b>${esc(model.verb)}</b>`;
      line2 = model.verb ? `${verb}${model.rest ? ` · ${esc(model.rest)}` : ""}` : esc(model.rest);
    }
    return `<div class="bd-mrow${model.on ? " is-on" : ""}${model.playing ? " is-playing" : ""}"><span class="bd-art">${icon(model.isTv ? "tv" : model.playing ? "music" : "speaker", 18)}</span><span class="bd-mtext"><span class="bd-m1">${esc(line1)}</span><span class="bd-m2">${line2}</span>${model.progress != null ? `<span class="bd-mprog"><i style="width:${model.progress}%"></i></span>` : ""}</span>${button}</div>`;
  }

  function renderMedia() {
    const block = root?.querySelector('[data-bd-block="media"]');
    if (!block) return;
    const ids = list(cfg().media).slice(0, 2);
    block.hidden = !ids.length;
    if (!ids.length) return;
    const models = ids.map(mediaModel);
    const signature = JSON.stringify(models);
    if (blockSignatures.get("media") === signature) return;
    blockSignatures.set("media", signature);
    block.innerHTML = `<div class="bd-blockhead"><b>${esc(t("Medier"))}</b></div><div class="bd-media">${models.map(mediaRowMarkup).join("")}</div>`;
  }

  function mediaAction(id, service) {
    const st = state(id);
    if (unavailable(st)) return;
    const optimistic = service === "turn_off" ? "off" : service === "turn_on" ? "on" : st.state === "playing" ? "paused" : "playing";
    setPending(id, { status: optimistic }, 5000);
    blockSignatures.delete("media");
    renderMedia();
    callService("media_player", service, id).catch((error) => {
      pending.delete(id);
      BeastCore.log(`Soveværelse: medie fejlede (${error.message}).`);
      blockSignatures.delete("media");
      renderMedia();
    });
  }

  // ---------------------------------------------------------------------------
  // Security: locks (lock = one tap, unlock = PIN/confirm) and the alarm
  // ---------------------------------------------------------------------------
  function lockModel(id) {
    const st = state(id);
    const name = displayName(id);
    if (!st || st.state === "unavailable" || st.state === "unknown") return { id, name, kind: "unavailable" };
    const pend = pendingFor(id);
    const feedback = lockFeedback.get(id);
    if (feedback && Date.now() > feedback.until) lockFeedback.delete(id);
    let kind = st.state === "locked" ? "locked" : st.state === "jammed" ? "jammed" : ["locking", "unlocking"].includes(st.state) ? st.state : st.state === "open" || st.state === "opening" ? "open" : "unlocked";
    if (pend?.lock && !["locking", "unlocking"].includes(kind)) kind = pend.lock === "lock" ? "locking" : "unlocking";
    return { id, name, kind, error: lockFeedback.get(id)?.text || "" };
  }

  // A lock is a tile: tap an unlocked (or jammed) door to lock it at once;
  // tapping a locked door asks for the code/PIN before it unlocks.
  function lockRowMarkup(model) {
    const labels = { locked: "Låst", unlocked: "Ulåst", open: "Åben", jammed: "Fejl", locking: "Låser…", unlocking: "Låser op…", unavailable: "Utilgængelig" };
    const tone = ["unlocked", "open"].includes(model.kind) ? "warn" : model.kind === "jammed" ? "bad" : model.kind === "locked" ? "ok" : "";
    let action = "";
    let hint = "";
    if (["unlocked", "open", "jammed"].includes(model.kind)) { action = "lock"; hint = t("Lås {name}", { name: model.name }); }
    else if (model.kind === "locked") { action = "unlock"; hint = t("Lås {name} op?", { name: model.name }); }
    const busy = ["locking", "unlocking"].includes(model.kind);
    const stateText = model.error || t(labels[model.kind]);
    const attrs = action ? ` data-bd-action="${action}" data-entity="${esc(model.id)}" aria-label="${esc(`${model.name}: ${stateText}. ${hint}`)}"` : " disabled";
    return `<button type="button" class="bd-lock is-${model.kind}${tone ? ` is-${tone}` : ""}${busy ? " is-busy" : ""}"${attrs}><span class="bd-lock-ic">${icon(model.kind === "locked" || model.kind === "locking" ? "lock" : "unlock", 17)}</span><span class="bd-lock-nm"><span class="bd-lock-name">${esc(model.name)}</span><span class="bd-lock-state${model.error ? " is-bad" : ""}">${esc(stateText)}</span></span></button>`;
  }

  function alarmModel() {
    const id = single(cfg().alarm);
    if (!id) return null;
    const st = state(id);
    const name = overrides().get(id) || t("Alarm");
    if (unavailable(st)) return { id, name, unavailable: true, modes: [] };
    const a = st.attributes || {};
    const features = Number(a.supported_features) || 0;
    const modes = ALARM_MODES.filter(([, bit]) => features & bit);
    const pend = pendingFor(id);
    let status = st.state;
    if (pend?.alarm && !["arming", "pending", "disarming"].includes(status) && (status === "disarmed") === (pend.alarm !== "disarm")) status = pend.alarm === "disarm" ? "disarming" : "arming";
    const target = String(a.next_state || pend?.target || "").replace(/^armed_/, "");
    // Panels that publish their exit delay (an end time, e.g. Alarmo's
    // "expiration", or a length in seconds) get a live countdown; others
    // just say "Aktiverer…".
    let countdown = "";
    if (status === "arming" || status === "pending") {
      let left = null;
      const expires = Date.parse(a.expiration || a.expires_at || "");
      if (Number.isFinite(expires)) left = (expires - Date.now()) / 1000;
      else {
        const total = Number(a.arming_time ?? a.exit_delay ?? a.delay_time ?? a.delay);
        if (Number.isFinite(total) && total > 0) left = total - (Date.now() - (Date.parse(st.last_changed || "") || Date.now())) / 1000;
      }
      if (left != null) {
        const seconds = Math.max(0, Math.ceil(left));
        countdown = `${Math.floor(seconds / 60)}:${pad2(seconds % 60)}`;
      }
    }
    return { id, name, status, modes, target, countdown, feedback: alarmFeedback && Date.now() < alarmFeedback.until ? alarmFeedback.text : "" };
  }

  function alarmLabel(model) {
    return model.feedback || (model.status === "arming" && model.countdown ? `${t("Aktiverer…")} ${model.countdown}` : t(ALARM_STATE_LABELS[model.status] || model.status));
  }

  // Status block, a segmented Hjemme | Nat | Ude control (only the modes the
  // panel supports) and a dashed "Frakobl" that always goes via code/PIN.
  function alarmMarkup(model) {
    if (!model) return "";
    if (model.unavailable) return `<div class="bd-alarm is-unavailable"><span class="bd-alarm-st"><span class="bd-shield">${icon("shield", 16)}</span><span class="bd-alarm-tx"><b>${esc(model.name)}</b><small>${esc(t("Utilgængelig"))}</small></span></span></div>`;
    const armed = model.status.startsWith("armed_");
    const busy = ["arming", "pending", "disarming"].includes(model.status);
    const triggered = model.status === "triggered";
    const label = alarmLabel(model);
    const buttons = model.modes.map(([mode, , text]) => {
      const current = model.status === `armed_${mode}`;
      const arming = busy && model.status !== "disarming" && model.target === mode;
      return `<button type="button" class="bd-arm${current ? " is-on" : ""}${arming ? " is-arming" : ""}" data-bd-action="arm" data-mode="${mode}"${busy || current ? " disabled" : ""}${current ? ' aria-pressed="true"' : ""}>${esc(arming ? "…" : t(text))}</button>`;
    }).join("");
    const canDisarm = (armed || busy || triggered) && model.status !== "disarming";
    const tone = triggered || model.feedback ? " is-bad" : armed || busy ? " is-armed" : "";
    return `<div class="bd-alarm${armed || busy ? " is-armed" : ""}"><span class="bd-alarm-st"><span class="bd-shield">${icon("shield", 16)}</span><span class="bd-alarm-tx"><b>${esc(model.name)}</b><small class="${tone.trim()}${busy ? " is-busy" : ""}">${esc(label)}</small></span></span>
      ${model.modes.length ? `<div class="bd-seg" style="--n:${model.modes.length}">${buttons}</div>` : ""}<button type="button" class="bd-disarm${canDisarm ? " is-ready" : ""}" data-bd-action="disarm"${canDisarm ? "" : " disabled"}>${icon("key", 15)}<span>${esc(t("Frakobl"))}</span></button></div>`;
  }

  function renderSecurity() {
    const panel = root?.querySelector(".bd-sec");
    if (!panel) return;
    const locks = list(cfg().locks).map(lockModel);
    const alarm = alarmModel();
    const signature = JSON.stringify([locks, alarm]);
    if (blockSignatures.get("sec") === signature) return;
    blockSignatures.set("sec", signature);
    const unlocked = locks.filter((lock) => ["unlocked", "open"].includes(lock.kind)).length;
    const jammed = locks.some((lock) => lock.kind === "jammed");
    let meta = "";
    if (jammed) meta = `<b class="is-bad">${esc(t("Lås fastlåst"))}</b>`;
    else if (unlocked) meta = `<b class="is-warn">${esc(unlocked === 1 ? t("1 dør ulåst") : t("{n} døre ulåst", { n: unlocked }))}</b><span class="bd-sec-hint"> · ${esc(t("tryk for at låse"))}</span>`;
    else if (locks.length && locks.every((lock) => lock.kind === "locked")) meta = `<b class="is-ok">${esc(locks.length === 1 ? t("Døren er låst") : t("Alle døre låst"))}</b>`;
    // Portrait has no room for the alarm's status block: its state joins the meta line instead.
    const alarmMeta = alarm && !alarm.unavailable && locks.length ? `<span class="bd-sec-alarm"> · ${esc(t("alarm {state}", { state: alarmLabel(alarm).toLocaleLowerCase(locale()) }))}</span>` : "";
    panel.innerHTML = `<div class="bd-eyebrow"><b>${esc(t("Sikring"))}</b><span class="bd-meta">${meta}${alarmMeta}</span></div>${locks.length ? `<div class="bd-locks" data-n="${locks.length}">${locks.map(lockRowMarkup).join("")}</div>` : ""}${alarmMarkup(alarm)}`;
    panel.classList.toggle("has-locks", locks.length > 0);
    panel.classList.toggle("is-triggered", alarm?.status === "triggered");
    manageSecondTicker(alarm);
  }

  // The arming countdown is the only thing that ticks every second, and only while it runs.
  function manageSecondTicker(alarm) {
    const needed = active && alarm && alarm.countdown && ["arming", "pending"].includes(alarm.status);
    if (needed && !secondTimerId) secondTimerId = window.setInterval(() => { blockSignatures.delete("sec"); renderSecurity(); }, 1000);
    if (!needed && secondTimerId) { window.clearInterval(secondTimerId); secondTimerId = null; }
  }

  function screenLock() { return window.BeastScreenLock || null; }

  function askCode(st, title, onCode) {
    const lockApi = screenLock();
    if (!lockApi || lockApi.isLocked()) return;
    if (String(st?.attributes?.code_format || "").toLowerCase() === "text") {
      const code = window.prompt(title);
      if (code) onCode(code);
      return;
    }
    lockApi.requestCode({ title, subtitle: t("Koden sendes direkte og gemmes ikke"), variableLength: true, minLength: 4, maxLength: 10 }, (code) => {
      if (typeof code === "string" && code) onCode(code);
    });
  }

  // Unlocking and disarming are never one tap: the device's own code when it
  // has one, otherwise the dashboard PIN, otherwise an explicit confirm.
  function confirmSensitive({ st, title, confirmLabel }, run) {
    const lockApi = screenLock();
    if (st?.attributes?.code_format) { askCode(st, title, run); return; }
    if (lockApi?.isLocked()) return;
    if (lockApi?.hasPin()) {
      lockApi.requestPinVerification((ok) => { if (ok) run(); });
      return;
    }
    openConfirm({ title, confirmLabel }, () => run());
  }

  // One tap, unless the lock itself wants a code for locking too.
  function lockDoor(id) {
    const st = state(id);
    const run = (code) => {
      setPending(id, { lock: "lock" }, 20000);
      blockSignatures.delete("sec");
      renderSecurity();
      callService("lock", "lock", id, typeof code === "string" ? { code } : {}).catch((error) => lockFailed(id, t("Kunne ikke låse"), error));
    };
    if (st?.attributes?.code_format) askCode(st, t("Lås {name}", { name: displayName(id) }), run);
    else run();
  }

  function unlockDoor(id) {
    const st = state(id);
    confirmSensitive({ st, title: t("Lås {name} op?", { name: displayName(id) }), confirmLabel: t("Lås op") }, (code) => {
      setPending(id, { lock: "unlock" }, 20000);
      blockSignatures.delete("sec");
      renderSecurity();
      callService("lock", "unlock", id, typeof code === "string" ? { code } : {}).catch((error) => lockFailed(id, t("Kunne ikke låse op"), error));
    });
  }

  function lockFailed(id, text, error) {
    pending.delete(id);
    lockFeedback.set(id, { text, until: Date.now() + 5000 });
    BeastCore.log(`Soveværelse: lås fejlede (${error?.message || error}).`);
    blockSignatures.delete("sec");
    renderSecurity();
    window.setTimeout(() => { blockSignatures.delete("sec"); renderSecurity(); }, 5100);
  }

  function alarmFailed(error, text) {
    const message = String(error?.message || "");
    alarmFeedback = { text: /code|kode/i.test(message) ? t("Forkert kode") : text, until: Date.now() + 5000 };
    BeastCore.log(`Soveværelse: alarm fejlede (${message}).`);
    blockSignatures.delete("sec");
    renderSecurity();
    window.setTimeout(() => { blockSignatures.delete("sec"); renderSecurity(); }, 5100);
  }

  function armAlarm(mode) {
    const id = single(cfg().alarm);
    const st = state(id);
    if (!id || unavailable(st)) return;
    const service = `alarm_arm_${mode}`;
    const a = st.attributes || {};
    const run = (code) => {
      setPending(id, { alarm: service, target: mode }, 15000);
      alarmFeedback = null;
      blockSignatures.delete("sec");
      renderSecurity();
      callService("alarm_control_panel", service, id, code ? { code } : {}).catch((error) => { pending.delete(id); alarmFailed(error, t("Kunne ikke tilkoble")); });
    };
    if (a.code_format && a.code_arm_required !== false) {
      askCode(st, t("Tilkobl alarmen · {mode}", { mode: t(ALARM_MODES.find(([key]) => key === mode)?.[2] || mode) }), run);
      return;
    }
    // Same rule as the security page: arming away auto-locks the dashboard
    // with its PIN, so one has to exist first.
    if (service === "alarm_arm_away" && id === BeastConfig.get("panels.security.primaryAlarm") && screenLock() && !screenLock().hasPin()) {
      screenLock().startSetPin((created) => { if (created) run(); });
      return;
    }
    run();
  }

  function disarmAlarm() {
    const id = single(cfg().alarm);
    const st = state(id);
    if (!id || unavailable(st)) return;
    confirmSensitive({ st, title: t("Frakobl alarmen?"), confirmLabel: t("Frakobl") }, (code) => {
      setPending(id, { alarm: "disarm" }, 15000);
      alarmFeedback = null;
      blockSignatures.delete("sec");
      renderSecurity();
      callService("alarm_control_panel", "alarm_disarm", id, typeof code === "string" ? { code } : {}).catch((error) => { pending.delete(id); alarmFailed(error, t("Kunne ikke frakoble")); });
    });
  }

  // ---------------------------------------------------------------------------
  // Godnat: a 3 s countdown that a second tap cancels, then the routine
  // ---------------------------------------------------------------------------
  // A built-in routine: lock the chosen doors (all bedroom locks unless a
  // subset is chosen), optionally turn chosen lights off, then the optional
  // script and scene. Lights are only turned off when chosen: ambient
  // automations re-light rooms at night, so a default would just flicker.
  function goodnightPlan() {
    const c = cfg();
    const chosenLocks = list(c.goodnightLocks);
    const locks = chosenLocks.length ? chosenLocks : list(c.locks);
    const lightsOff = list(c.goodnightLightsOff);
    const script = single(c.goodnightScript);
    const scene = single(c.goodnightScene);
    return { locks, lightsOff, script, scene, any: Boolean(locks.length || lightsOff.length || script || scene) };
  }

  function goodnightSummary(plan) {
    const parts = [];
    if (plan.locks.length === 1) parts.push(t("Låser {name}", { name: displayName(plan.locks[0]) }));
    else if (plan.locks.length) parts.push(t("Låser {n} døre", { n: plan.locks.length }));
    if (plan.lightsOff.length === 1) parts.push(t("slukker {name}", { name: displayName(plan.lightsOff[0]) }));
    else if (plan.lightsOff.length) parts.push(t("slukker {n} lys", { n: plan.lightsOff.length }));
    if (plan.script) parts.push(displayName(plan.script));
    if (plan.scene) parts.push(displayName(plan.scene));
    return capitalize(parts.join(" · "));
  }

  function renderNight() {
    const button = root?.querySelector(".bd-night");
    if (!button) return;
    const label = String(cfg().goodnightLabel || "").trim() || goodnightSummary(goodnightPlan());
    const phase = goodnight.phase;
    let title = t("Godnat");
    let sub = label;
    if (phase === "countdown") { title = t("Godnat om {n}…", { n: goodnight.count }); sub = t("Tryk for at annullere"); }
    else if (phase === "running") sub = t("Kører…");
    else if (phase === "done") sub = t("Godnat · {time}", { time: hm(new Date(goodnight.doneAt)) });
    else if (phase === "error") sub = t("Kunne ikke køre — prøv igen");
    const signature = JSON.stringify([phase, title, sub]);
    if (blockSignatures.get("night") === signature) return;
    blockSignatures.set("night", signature);
    button.className = `bd-night is-${phase}`;
    button.setAttribute("aria-label", `${title}. ${sub}`);
    button.innerHTML = `<span class="bd-night-mo">${phase === "countdown" ? `<b>${goodnight.count}</b>` : icon("moon", 16)}</span><span class="bd-night-text"><span class="bd-g1">${esc(title)}</span><span class="bd-g2">${esc(sub)}</span></span>`;
  }

  function setGoodnight(phase, extra = {}) {
    window.clearTimeout(goodnight.timerId);
    goodnight = { ...goodnight, ...extra, phase, timerId: null };
    renderNight();
  }

  function tickGoodnight() {
    if (goodnight.phase !== "countdown") return;
    if (goodnight.count <= 1) { runGoodnight(); return; }
    setGoodnight("countdown", { count: goodnight.count - 1 });
    goodnight.timerId = window.setTimeout(tickGoodnight, 1000);
  }

  async function runGoodnight() {
    const plan = goodnightPlan();
    if (!plan.any) { setGoodnight("idle"); return; }
    setGoodnight("running");
    let failed = false;
    const attempt = (request, what) => request.catch((error) => {
      failed = true;
      BeastCore.log(`Soveværelse: godnat fejlede ved ${what} (${error.message}).`);
    });
    const toLock = plan.locks.filter((id) => !["locked", "locking"].includes(state(id)?.state));
    toLock.forEach((id) => setPending(id, { lock: "lock" }, 20000));
    if (toLock.length) { blockSignatures.delete("sec"); renderSecurity(); }
    await Promise.all(toLock.map((id) => attempt(callService("lock", "lock", id).catch((error) => {
      pending.delete(id);
      blockSignatures.delete("sec");
      renderSecurity();
      throw error;
    }), id)));
    if (plan.lightsOff.length) await attempt(callService("light", "turn_off", plan.lightsOff), "lys");
    if (plan.script) await attempt(callService("script", "turn_on", plan.script), plan.script);
    if (plan.scene) await attempt(callService("scene", "turn_on", plan.scene), plan.scene);
    if (failed) {
      setGoodnight("error");
      goodnight.timerId = window.setTimeout(() => setGoodnight("idle"), 6000);
      return;
    }
    setGoodnight("done", { doneAt: Date.now() });
    goodnight.timerId = window.setTimeout(() => setGoodnight("idle"), 10000);
  }

  function onGoodnightTap() {
    if (goodnight.phase === "running") return;
    if (goodnight.phase === "countdown") { setGoodnight("idle"); return; }
    setGoodnight("countdown", { count: GOODNIGHT_COUNTDOWN_S });
    goodnight.timerId = window.setTimeout(tickGoodnight, 1000);
  }

  // ---------------------------------------------------------------------------
  // Layer: the menu page and the full-screen sheets share one host
  // ---------------------------------------------------------------------------
  function layer() { return root?.querySelector("[data-bd-layer]"); }

  function openLayer(kind, markup, cleanup) {
    const host = layer();
    if (!host) return null;
    closeLayer(true);
    layerKind = kind;
    layerCleanup = cleanup || null;
    host.hidden = false;
    host.dataset.kind = kind;
    host.innerHTML = markup;
    document.documentElement.classList.add("beast-bedroom-layer-open");
    return host;
  }

  function closeLayer(instant = false) {
    const host = layer();
    const kind = layerKind;
    if (!host || !kind) return;
    const cleanup = layerCleanup;
    layerKind = null;
    layerCleanup = null;
    cleanup?.();
    document.documentElement.classList.remove("beast-bedroom-layer-open");
    const finish = () => { if (!layerKind) { host.hidden = true; host.innerHTML = ""; delete host.dataset.kind; } };
    if (instant || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) { finish(); return; }
    host.classList.add("is-leaving");
    window.setTimeout(() => { host.classList.remove("is-leaving"); finish(); }, 140);
  }

  function sheetMarkup(kind, title, body) {
    return `<div class="bd-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}" data-sheet="${kind}">
      <header class="bd-sheet-head"><div class="bd-sheet-title"><span class="bd-sheet-eyebrow">${esc(roomTitle())}</span><strong>${esc(title)}</strong></div>
      <button type="button" class="bd-back" data-bd-action="close-layer" aria-label="${esc(t("Tilbage til soveværelset"))}"><span>${esc(t("Tilbage til soveværelset"))}</span><span class="bd-back-x">${icon("x", 20)}</span></button></header>
      <div class="bd-sheet-body" data-sheet-body>${body}</div></div>`;
  }

  function openLightsSheet() {
    openLayer("lights", sheetMarkup("lights", t("Alt lys"), ""));
    renderLightsSheet();
  }

  function renderLightsSheet() {
    const body = layer()?.querySelector('[data-sheet="lights"] [data-sheet-body]');
    if (!body || lightDrag) return;
    const models = lightIds().map(lightModel);
    body.innerHTML = models.length ? `<div class="bd-lights is-sheet" data-n="${models.length}">${models.map(lightTileMarkup).join("")}</div>` : `<p class="bd-quiet">${esc(t("Ingen lys valgt"))}</p>`;
  }

  function openScenesSheet() {
    openLayer("scenes", sheetMarkup("scenes", t("Scener"), ""));
    renderScenesSheet();
  }

  function renderScenesSheet() {
    const body = layer()?.querySelector('[data-sheet="scenes"] [data-sheet-body]');
    if (!body) return;
    const ids = sceneIds();
    const activeId = activeSceneId(ids);
    body.innerHTML = ids.length ? `<div class="bd-scenes is-sheet">${ids.map((id) => sceneChipMarkup(id, activeId)).join("")}</div>${activeId ? `<p class="bd-quiet">${esc(t("Senest aktiveret: {name}", { name: displayName(activeId) }))}</p>` : ""}` : `<p class="bd-quiet">${esc(t("Ingen scener valgt"))}</p>`;
  }

  function openConfirm({ title, confirmLabel }, onConfirm) {
    const host = root?.querySelector(".bd-confirm-host") || root?.appendChild(Object.assign(document.createElement("div"), { className: "bd-confirm-host" }));
    if (!host) return;
    host.innerHTML = `<div class="bd-confirm" role="alertdialog" aria-modal="true" aria-label="${esc(title)}"><div class="bd-confirm-card"><strong>${esc(title)}</strong><div class="bd-confirm-actions"><button type="button" data-confirm="no">${esc(t("Annullér"))}</button><button type="button" class="is-danger" data-confirm="yes">${esc(confirmLabel)}</button></div></div></div>`;
    const close = () => { host.innerHTML = ""; };
    host.querySelector(".bd-confirm").addEventListener("click", (event) => {
      const choice = event.target.closest("[data-confirm]")?.dataset.confirm;
      if (!choice && event.target.closest(".bd-confirm-card")) return;
      close();
      if (choice === "yes") onConfirm();
    });
    host.querySelector('[data-confirm="no"]')?.focus();
  }

  // ---------------------------------------------------------------------------
  // Rendering and lifecycle
  // ---------------------------------------------------------------------------
  function renderAll() {
    if (!root || !active) return;
    renderHeader();
    mountCameras();
    window.BeastBedroom.sleep?.render(root.querySelector(".bd-sleep"));
    renderLights();
    renderScenes();
    renderComfort();
    renderMedia();
    // The first visible block's heading doubles as the panel title.
    const blocks = [...root.querySelectorAll(".bd-ctrl > .bd-block")];
    const lead = blocks.find((block) => !block.hidden);
    blocks.forEach((block) => block.classList.toggle("is-lead", block === lead));
    renderCalendar();
    renderSecurity();
    renderNight();
    if (layerKind === "lights") renderLightsSheet();
    if (layerKind === "scenes") renderScenesSheet();
    window.BeastBedroom.sleep?.renderDetail?.();
  }

  function onMinute() {
    blockSignatures.delete("media");
    renderHeader();
    updateCameraOverlays();
    renderScenes();
    renderMedia();
    renderCalendar();
    window.BeastBedroom.sleep?.render(root?.querySelector(".bd-sleep"));
    window.BeastBedroom.menu?.tickClock?.();
  }

  function scheduleClock() {
    window.clearTimeout(clockTimerId);
    if (!active) return;
    const now = new Date();
    clockTimerId = window.setTimeout(() => { onMinute(); scheduleClock(); }, (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 40);
  }

  function relevantIds() {
    const c = cfg();
    const ids = new Set([
      ...list(c.cameras).slice(0, 2), ...list(c.calendars), ...list(c.lights), ...list(c.scenes), ...list(c.scripts),
      ...list(c.comfort), ...list(c.comfortBooleans), ...list(c.fans), ...list(c.media).slice(0, 2), ...list(c.locks),
      ...list(c.goodnightLocks), ...list(c.goodnightLightsOff),
      ...["temperature", "humidity", "co2", "airQuality", "pm25", "window", "motion", "alarm", "goodnightScript", "goodnightScene"].map((key) => single(c[key]))
    ].filter(Boolean));
    list(c.lights).forEach((id) => (state(id)?.attributes?.entity_id || []).forEach((member) => typeof member === "string" && ids.add(member)));
    (window.BeastBedroom.sleep?.entityIds() || []).forEach((id) => ids.add(id));
    return [...ids];
  }

  let calendarChangeTimerId = null;
  function onEntityChange(entityId, newState, oldState) {
    const entry = pending.get(entityId);
    if (entry && Date.now() - entry.at > 250 && !entry.scene) pending.delete(entityId);
    if (list(cfg().calendars).includes(entityId) && newState?.state !== oldState?.state && Date.now() - calendarFetchedAt > 60000) {
      window.clearTimeout(calendarChangeTimerId);
      calendarChangeTimerId = window.setTimeout(() => { if (active) loadCalendar(); }, 2000);
    }
    window.BeastBedroom.sleep?.onEntityChange?.(entityId, newState, oldState);
    requestRender();
  }

  function resubscribe() {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    unsubscribers = relevantIds().map((id) => BeastHaSocket.subscribeEntity(id, onEntityChange));
  }

  function activate() {
    if (!root) return;
    const wasActive = active;
    active = true;
    applyDim();
    if (!wasActive) {
      blockSignatures.clear();
      if (JSON.stringify(computeFlags()) !== JSON.stringify(flags)) build();
    }
    renderAll();
    scheduleClock();
    refreshCameraPosters();
    if (list(cfg().calendars).length) {
      if (!calendarFetchedAt || Date.now() - calendarFetchedAt > CALENDAR_REFRESH_MS) loadCalendar();
      window.clearInterval(calendarTimerId);
      calendarTimerId = window.setInterval(() => { if (active) loadCalendar(); }, CALENDAR_REFRESH_MS);
    }
    window.BeastBedroom.sleep?.onActivate?.();
  }

  function deactivate() {
    active = false;
    window.clearTimeout(clockTimerId);
    window.clearInterval(calendarTimerId);
    window.clearInterval(secondTimerId);
    secondTimerId = null;
    if (goodnight.phase === "countdown") setGoodnight("idle");
    closeLayer(true);
    closeCameraView();
    root?.querySelector(".bd-confirm-host")?.replaceChildren();
    unmountCameras();
    applyDim();
  }

  function applyDim() {
    const on = BeastLocalSettings.get("bedroomDim", false) === true;
    document.documentElement.classList.toggle("beast-bedroom-dim", on);
    if (on && !document.querySelector(".beast-bedroom-dim-layer")) {
      const dim = document.createElement("div");
      dim.className = "beast-bedroom-dim-layer";
      dim.setAttribute("aria-hidden", "true");
      document.body.appendChild(dim);
    }
  }

  function setDim(on) {
    BeastLocalSettings.set("bedroomDim", Boolean(on));
  }

  function onClick(event) {
    const target = event.target.closest("[data-bd-action]");
    if (!target || !root.contains(target) || target.disabled) return;
    const id = target.dataset.entity;
    switch (target.dataset.bdAction) {
      case "menu": window.BeastBedroom.menu?.open(target); break;
      case "close-layer": closeLayer(); break;
      case "light-toggle": if (Date.now() > suppressClickUntil) toggleLight(id); break;
      case "scene": activateScene(id); break;
      case "toggle": toggleEntity(id); break;
      case "media": mediaAction(id, target.dataset.service); break;
      case "lock": lockDoor(id); break;
      case "unlock": unlockDoor(id); break;
      case "arm": armAlarm(target.dataset.mode); break;
      case "disarm": disarmAlarm(); break;
      case "goodnight": onGoodnightTap(); break;
      case "camera-view": openCameraView(Number(target.dataset.index) || 0); break;
      default: window.BeastBedroom.sleep?.onAction?.(target, event);
    }
  }

  function onKeydown(event) {
    if (event.key === "Escape" && layerKind && !document.querySelector(".beast-lock-overlay.is-open")) {
      if (layerKind === "menu") window.BeastBedroom.menu?.close(); else closeLayer();
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && event.target.matches?.(".bd-cam[data-bd-action]")) {
      event.preventDefault();
      openCameraView(Number(event.target.dataset.index) || 0);
      return;
    }
    onDimmerKey(event);
  }

  function init(container) {
    if (container.dataset.bedroomMounted === "true") return;
    container.dataset.bedroomMounted = "true";
    zone = container;
    root = document.createElement("div");
    root.className = "bd-root";
    zone.appendChild(root);
    configSignature = JSON.stringify(cfg());
    build();
    requestRender = BeastCore.stableUpdater(zone, renderAll, 300);
    root.addEventListener("click", onClick);
    root.addEventListener("pointerdown", onDimmerDown);
    document.addEventListener("keydown", (event) => { if (active) onKeydown(event); });
    document.addEventListener("beast:sectionchange", (event) => {
      if (event.detail?.section === SECTION_ID) activate();
      else if (active) deactivate();
    });
    document.addEventListener("beast:ambientchange", (event) => {
      if (!event.detail?.on) return;
      closeCameraView();
      if (layerKind) closeLayer(true);
    });
    document.addEventListener("beast:local-settings-changed", (event) => {
      if (["*", "bedroomDim"].includes(event.detail?.path)) applyDim();
    });
    document.addEventListener("beast:config-changed", () => {
      const next = JSON.stringify(cfg());
      if (next === configSignature) return;
      configSignature = next;
      build();
      if (active) activate();
    });
    BeastHaSocket.onStatusChange((status) => {
      if (status !== "connected") return;
      resubscribe();
      invalidateBlocks();
      if (active) {
        if (JSON.stringify(computeFlags()) !== JSON.stringify(flags)) build();
        renderAll();
        if (list(cfg().calendars).length) loadCalendar();
      }
      window.clearTimeout(connectedTimerId);
      connectedTimerId = window.setTimeout(() => { if (active) window.BeastBedroom.sleep?.onReconnected?.(); }, 30000);
    });
    window.addEventListener("message", onPlayerMessage);
    if (go2rtcBase()) window.BeastCameras?.ensureStreamDiscovery?.(go2rtcBase()).then(() => { streamDiscoveryVersion += 1; if (active) mountCameras(); });
    if (isActive()) activate();
    else applyDim();
  }

  BeastCore.registerPanel(SECTION_ID, ZONE_ID, init);

  return {
    util: {
      t, esc, icon, fmt, hm, pad2, capitalize, dateKey, parseDateKey, addDays, startOfDay, shortDate, shortWeekdayDate, weekdayName,
      duration, cfg, list, single, state, unavailable, numberState, displayName, roomTitle, callService, locale
    },
    get root() { return root; },
    isActive: () => active,
    openLayer,
    closeLayer,
    layerKind: () => layerKind,
    sheetMarkup,
    openLightsSheet,
    openScenesSheet,
    openCameraView,
    closeCameraView,
    cameraIds,
    lightModel,
    lightIds,
    sceneIds,
    activeSceneId,
    setDim,
    dimOn: () => BeastLocalSettings.get("bedroomDim", false) === true,
    rerender: () => { invalidateBlocks(); renderAll(); },
    renderSleep: () => {
      if (!active) return;
      window.BeastBedroom.sleep?.render(root?.querySelector(".bd-sleep"));
      window.BeastBedroom.sleep?.renderDetail?.();
    }
  };
})();
