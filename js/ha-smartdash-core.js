const BeastCore = (() => {
  const CORE_SCRIPT_URL = document.currentScript?.src || window.location.href;
  const APP_ROOT_URL = new URL("../", CORE_SCRIPT_URL);
  const appUrl = (path = "") => new URL(String(path).replace(/^\//, ""), APP_ROOT_URL).href;
  const panels = [];
  const debugLog = [];
  const DEBUG_LOG_MAX = 200;

  function registerPanel(name, zoneId, initFn) {
    panels.push({ name, zoneId, initFn });
  }

  function mountPanels() {
    panels.forEach(({ name, zoneId, initFn }) => {
      const container = document.getElementById(zoneId);
      if (!container) {
        log(`Panel "${name}": zone "${zoneId}" ikke fundet.`);
        return;
      }
      try {
        initFn(container);
      } catch (error) {
        log(`Panel "${name}" failed to init: ${error.message}`);
        console.error(`[BeastCore] panel "${name}" init failed`, error);
      }
    });
  }

  function log(message) {
    const line = `${formatClock(new Date())} — ${message}`;
    debugLog.push(line);
    if (debugLog.length > DEBUG_LOG_MAX) debugLog.shift();
    document.dispatchEvent(new CustomEvent("beast:log", { detail: line }));
  }

  function formatClock(date) {
    return date.toLocaleTimeString(window.HASmartdashI18n?.locale || "da-DK", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function formatDate(date) {
    return date.toLocaleDateString(window.HASmartdashI18n?.locale || "da-DK", { weekday: "long", day: "numeric", month: "long" });
  }

  function el(tag, className, children) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach((child) => {
        if (child === null || child === undefined) return;
        if (typeof child === "string") node.appendChild(document.createTextNode(child));
        else node.appendChild(child);
      });
    }
    return node;
  }

  function debounce(fn, delayMs) {
    let timerId = null;
    return (...args) => {
      window.clearTimeout(timerId);
      timerId = window.setTimeout(() => fn(...args), delayMs);
    };
  }

  let pointerIsDown = false;
  let interactionUntil = 0;
  const scrollPositions = new Map();
  const scrollSelectors = [
    ".beast-content", ".beast-section", ".beast-panel-fill", ".beast-rooms-grid",
    ".beast-modal-body", ".beast-energy-now-groups", ".beast-printer-panel",
    ".beast-security-panel", ".beast-robots-panel", ".beast-settings-panel"
  ];

  function markUserInteraction(delay = 850) {
    interactionUntil = Math.max(interactionUntil, Date.now() + delay);
  }

  function isUserInteracting() {
    const focused = document.activeElement;
    const editing = focused && focused.matches?.("input:not([type='button']):not([type='submit']), textarea");
    // Card editing is a long-running interaction. Treat the entire edit
    // session as busy so HA state events cannot repaint the panel, remove
    // its editor host and discard an in-progress drag/resize operation.
    return pointerIsDown || editing || window.beastCardEditorActive === true || Date.now() < interactionUntil;
  }

  function whenUserIdle(callback) {
    const wait = () => {
      if (isUserInteracting()) window.setTimeout(wait, 180);
      else callback();
    };
    window.setTimeout(wait, 180);
  }

  function isPanelVisible(container) {
    const section = container?.closest?.(".beast-section");
    return !section || section.classList.contains("is-active");
  }

  function stableUpdater(container, callback, delayMs = 350) {
    let timerId = null;
    let dirty = false;
    let running = false;

    const flush = () => {
      if (!dirty || running || !isPanelVisible(container)) return;
      if (isUserInteracting()) {
        window.clearTimeout(timerId);
        timerId = window.setTimeout(flush, 220);
        return;
      }
      dirty = false;
      running = true;
      try {
        callback();
      } finally {
        running = false;
      }
    };

    const request = () => {
      dirty = true;
      if (!isPanelVisible(container)) return;
      window.clearTimeout(timerId);
      timerId = window.setTimeout(flush, delayMs);
    };

    document.addEventListener("beast:sectionchange", (event) => {
      const section = container?.closest?.(".beast-section");
      if (section?.dataset?.section === event.detail?.section && dirty) request();
    });
    return request;
  }

  function scrollIdentity(element) {
    if (!(element instanceof Element)) return null;
    const selector = scrollSelectors.find((candidate) => element.matches(candidate));
    if (!selector) return null;
    const section = element.closest(".beast-section");
    const scope = section || document;
    const index = Array.from(scope.querySelectorAll(selector)).indexOf(element);
    return `${section?.dataset?.section || "global"}|${selector}|${Math.max(0, index)}`;
  }

  function restoreKnownScrollPositions() {
    scrollPositions.forEach((position, key) => {
      const [sectionName, selector, indexText] = key.split("|");
      const scope = sectionName === "global" ? document : document.querySelector(`.beast-section[data-section="${sectionName}"]`);
      const element = scope?.querySelectorAll(selector)?.[Number(indexText)];
      if (!element) return;
      if (Math.abs(element.scrollTop - position.top) > 1) element.scrollTop = position.top;
      if (Math.abs(element.scrollLeft - position.left) > 1) element.scrollLeft = position.left;
    });
  }

  document.addEventListener("pointerdown", () => { pointerIsDown = true; markUserInteraction(); }, true);
  document.addEventListener("pointermove", () => { if (pointerIsDown) markUserInteraction(); }, true);
  ["pointerup", "pointercancel"].forEach((eventName) => document.addEventListener(eventName, () => {
    pointerIsDown = false;
    markUserInteraction(900);
  }, true));
  document.addEventListener("wheel", () => markUserInteraction(600), { capture: true, passive: true });
  document.addEventListener("scroll", (event) => {
    markUserInteraction(650);
    const element = event.target === document ? document.scrollingElement : event.target;
    const key = scrollIdentity(element);
    if (key) scrollPositions.set(key, { top: element.scrollTop, left: element.scrollLeft });
  }, true);

  let restoreFrame = null;
  new MutationObserver(() => {
    window.cancelAnimationFrame(restoreFrame);
    restoreFrame = window.requestAnimationFrame(restoreKnownScrollPositions);
  }).observe(document.documentElement, { childList: true, subtree: true });

  // Small hand-drawn line-icon set (Feather-style: 24x24, stroke-based) so the UI
  // never has to fall back to emoji glyphs, which render inconsistently and read as "generic".
  const ICONS = {
    play: '<polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5c0-4-4-7.3-9-7.3Z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="8.5" r="1.2" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>',
    power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
    fan: '<path d="M12 11C8.3 9.4 8.5 3 12 3s3.7 6.4 0 8Z" fill="currentColor" stroke="none"/><path d="M13 12c1.6-3.7 8-3.5 8 0s-6.4 3.7-8 0Z" fill="currentColor" stroke="none"/><path d="M12 13c3.7 1.6 3.5 8 0 8s-3.7-6.4 0-8Z" fill="currentColor" stroke="none"/><path d="M11 12c-1.6 3.7-8 3.5-8 0s6.4-3.7 8 0Z" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="2" fill="var(--surface-solid,#111827)" stroke="currentColor"/>',
    "skip-back": '<polygon points="19 20 9 12 19 4 19 20" fill="currentColor" stroke="none"/><line x1="5" y1="19" x2="5" y2="5"/>',
    "skip-forward": '<polygon points="5 4 15 12 5 20 5 4" fill="currentColor" stroke="none"/><line x1="19" y1="5" x2="19" y2="19"/>',
    volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19.5 5.5a9 9 0 0 1 0 13"/>',
    "volume-mute": '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"/><line x1="17" y1="9" x2="23" y2="15"/><line x1="23" y1="9" x2="17" y2="15"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
    close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    "chevron-down": '<polyline points="6 9 12 15 18 9"/>',
    "chevron-up": '<polyline points="18 15 12 9 6 15"/>',
    grip: '<circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.2-2.4"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    sun: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    bolt: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor" stroke="none"/>',
    flame: '<path d="M12 22c4.4 0 8-3.2 8-7.7 0-3.1-1.7-5.9-4.8-8.6.1 2.1-.7 3.7-2 4.7.1-3.4-1.8-6.4-5-8.4.4 3.5-4.2 6.8-4.2 12.3C4 18.8 7.6 22 12 22z"/><path d="M9.2 17.2c0 1.6 1.2 2.8 2.8 2.8s2.8-1.2 2.8-2.8c0-1.5-.9-2.8-2.7-4.2.1 1-.3 1.8-.9 2.4-.2-1.2-.9-2.2-2-3.1.2 1.8 0 3.1 0 4.9z" fill="currentColor" stroke="none"/>',
    snowflake: '<line x1="12" y1="2" x2="12" y2="22"/><line x1="4.93" y1="6" x2="19.07" y2="18"/><line x1="4.93" y1="18" x2="19.07" y2="6"/><polyline points="9 4 12 7 15 4"/><polyline points="9 20 12 17 15 20"/><polyline points="5.5 9 9.5 9 9 5.5"/><polyline points="18.5 15 14.5 15 15 18.5"/><polyline points="5.5 15 9.5 15 9 18.5"/><polyline points="18.5 9 14.5 9 15 5.5"/>',
    car: '<path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11"/><rect x="3" y="11" width="18" height="6" rx="2"/><circle cx="7.5" cy="17" r="1.5"/><circle cx="16.5" cy="17" r="1.5"/>',
    droplet: '<path d="M12 2s6 7 6 12a6 6 0 0 1-12 0c0-5 6-12 6-12z"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    robot: '<rect x="4" y="8" width="16" height="12" rx="2"/><circle cx="9" cy="14" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1.5" fill="currentColor" stroke="none"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1" fill="currentColor" stroke="none"/>',
    printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="currentColor" stroke="none"/><path d="M19 3l.6 1.7L21 5l-1.4.6L19 7l-.6-1.4L17 5l1.4-.3z" fill="currentColor" stroke="none"/>',
    globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    "chevron-right": '<polyline points="9 6 15 12 9 18"/>',
    thermometer: '<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>',
    blinds: '<rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="16" width="18" height="4" rx="1"/>',
    cloud: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
    "cloud-rain": '<path d="M20 15.5A5 5 0 0 0 18 6h-1.26A8 8 0 1 0 6 15"/><line x1="8" y1="19" x2="8" y2="22"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="16" y1="19" x2="16" y2="22"/>',
    wind: '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
    eye: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82A1.65 1.65 0 0 0 3 13.09H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    backspace: '<path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>'
  };

  function icon(name, options = {}) {
    const size = options.size || 20;
    const strokeWidth = options.strokeWidth || 2;
    const path = ICONS[name];
    if (!path) return "";
    return `<svg class="beast-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  }

  let sparklineIdCounter = 0;

  // Catmull-Rom -> cubic-bezier conversion so the line reads as a smooth
  // curve instead of a jagged polyline of straight segments.
  function buildSmoothPath(pts) {
    if (pts.length < 3) return `M${pts.map((p) => `${p[0]},${p[1]}`).join(" L")}`;
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
      const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
      const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
      const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  }

  // Shared by every small history graph in the dashboard (pool temperature,
  // the entity cards' own history, ...). `chartKey` names the individual
  // graph so each can be switched between line and bars independently --
  // see chartType()/setChartType() below; `type` overrides that lookup for
  // callers that already know which they want.
  function sparkline(points, options = {}) {
    const type = options.type || (options.chartKey ? chartType(options.chartKey) : "line");
    if (type === "bars") return sparklineBars(points, options);
    const width = options.width || 600;
    const height = options.height || 120;
    const color = options.color || "currentColor";
    if (!points.length) return "";
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const pad = height * 0.08;
    const stepX = width / Math.max(1, points.length - 1);
    const pts = points.map((v, i) => [i * stepX, pad + (height - pad * 2) - ((v - min) / range) * (height - pad * 2)]);
    const linePath = buildSmoothPath(pts);
    const areaPath = `${linePath} L${width},${height} L0,${height} Z`;
    const gradId = `beast-spark-grad-${sparklineIdCounter++}`;
    return `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="beast-sparkline">
        <defs>
          <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.4"></stop>
            <stop offset="100%" stop-color="${color}" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        <path d="${areaPath}" class="beast-sparkline-area" fill="url(#${gradId})"></path>
        <path d="${linePath}" class="beast-sparkline-line" style="stroke:${color};" fill="none"></path>
      </svg>
    `;
  }

  // Bars variant of sparkline(): same data, scale and box, drawn as
  // columns coloured by how high each value sits in the series' own range
  // (calm green at the bottom through amber to red at the top), matching
  // the energy and price charts elsewhere so every graph reads the same.
  function sparklineBars(points, options = {}) {
    if (!points.length) return "";
    const width = options.width || 600;
    const height = options.height || 120;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const pad = height * 0.08;
    const barCount = Math.min(options.maxBars || 48, points.length);
    const bucketed = Array.from({ length: barCount }, (_, index) => {
      const start = Math.floor((index * points.length) / barCount);
      const end = Math.max(start + 1, Math.floor(((index + 1) * points.length) / barCount));
      const bucket = points.slice(start, end);
      return bucket.reduce((sum, value) => sum + value, 0) / bucket.length;
    });
    const slot = width / barCount;
    const barWidth = Math.max(1.5, slot * 0.68);
    const bars = bucketed.map((value, index) => {
      const ratio = (value - min) / range;
      const barHeight = Math.max(1, ratio * (height - pad * 2) + pad);
      const x = slot * index + (slot - barWidth) / 2;
      const fill = chartColorForRatio(ratio);
      return `<rect x="${x.toFixed(1)}" y="${(height - barHeight).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="${Math.min(2, barWidth / 2).toFixed(1)}" style="fill:${fill}"></rect>`;
    }).join("");
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="beast-sparkline beast-sparkline-bars">${bars}</svg>`;
  }

  // One shared place for "should this graph be a line or bars", keyed per
  // graph so each can differ, falling back to the Administration-set
  // default (panels.energy.usageChartType) until a graph is given its own.
  // How a graph is coloured, shared by lines and bars so both react the
  // same way. "static" is the original single colour; "usage" splits the
  // series' own range into four bands, so the same shape reads as calm or
  // alarming at a glance. Four rather than a continuous ramp because a
  // handful of distinct steps is far easier to recognise -- and to pick
  // colours for -- than an infinite gradient.
  const CHART_COLOR_DEFAULTS = { mode: "static", static: "#4fb8ff", steps: ["#3ddc84", "#ffd166", "#ff9f43", "#ef4444"] };

  function chartColorSettings() {
    const saved = BeastConfig.get("chartColors") || {};
    const steps = Array.isArray(saved.steps) && saved.steps.length === 4 ? saved.steps : CHART_COLOR_DEFAULTS.steps;
    return {
      mode: saved.mode === "usage" ? "usage" : "static",
      static: saved.static || CHART_COLOR_DEFAULTS.static,
      steps
    };
  }

  // ratio is the value's position within its own series (0 = lowest,
  // 1 = highest), not an absolute consumption -- what counts as "high" in
  // one household is ordinary in another.
  function hexToRgb(hex) {
    const value = String(hex || "").trim().replace("#", "");
    const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
    const int = Number.parseInt(full, 16);
    return Number.isFinite(int) && full.length === 6
      ? [(int >> 16) & 255, (int >> 8) & 255, int & 255]
      : [79, 184, 255];
  }

  // The four colours are anchors, not buckets: a value lands *between* two
  // of them and gets the blend. Hard steps produced visible vertical bands
  // where a line (and the fill under it) jumped from one colour straight to
  // the next, which read as a rendering fault rather than as a scale.
  function chartColorForRatio(ratio, settings = chartColorSettings()) {
    if (settings.mode !== "usage") return settings.static;
    const safe = Math.max(0, Math.min(1, Number(ratio) || 0));
    const steps = settings.steps;
    const scaled = safe * (steps.length - 1);
    const index = Math.min(steps.length - 2, Math.floor(scaled));
    const blend = scaled - index;
    const from = hexToRgb(steps[index]);
    const to = hexToRgb(steps[index + 1]);
    const mixed = from.map((channel, i) => Math.round(channel + (to[i] - channel) * blend));
    return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
  }

  // A line can't be one flat colour if it's meant to show level, so it is
  // stroked with a gradient whose stops follow the data: each point
  // contributes its own colour at its own x position. Returns null when a
  // plain colour will do, so callers can skip the extra <defs>.
  // Always returns something to stroke with, so a line is never left on
  // whatever colour its stylesheet happens to set: in "static" mode that's
  // the chosen single colour (which is the whole point of the picker), and
  // in "usage" mode it's the value-following gradient below.
  function chartLineStroke(coordinates, values, options = {}) {
    const settings = chartColorSettings();
    const gradient = chartLineGradient(coordinates, values, options);
    return gradient || { id: null, defs: "", stroke: settings.static };
  }

  // The area under a line has to follow the same colours as the line, or a
  // green-to-red curve sits on top of a flat blue wash and the two read as
  // unrelated. Two gradients are needed because SVG gradients only run in
  // one direction: one across (the value colours) and one down (the fade
  // to nothing at the bottom), combined with a mask.
  // Colour follows *height*, not position along the series. A gradient tied
  // to each point's x meant two neighbouring samples of very different value
  // put unrelated colours side by side, so a spiky trace flickered red and
  // yellow with no readable meaning. Anchoring the gradient to the y axis
  // instead gives fixed bands -- green along the bottom, then amber, orange,
  // red only at the top -- so a spike is red at its tip and green at its
  // base, and the fill beneath agrees automatically. userSpaceOnUse pins the
  // bands to the plot area rather than each path's own bounding box, which
  // is what keeps line and fill aligned with each other and with the axis.
  function chartBandStops(settings, opacity) {
    const alpha = opacity === undefined ? "" : ` stop-opacity="${opacity}"`;
    return settings.steps
      .map((color, index) => ({ offset: (1 - index / (settings.steps.length - 1)) * 100, color }))
      .sort((a, b) => a.offset - b.offset)
      .map(({ offset, color }) => `<stop offset="${offset.toFixed(1)}%" stop-color="${color}"${alpha}></stop>`)
      .join("");
  }

  function chartPlotBounds(options) {
    return { top: options.top ?? 0, bottom: options.bottom ?? (options.height || 1) };
  }

  // Fill under a line, coloured by the same vertical bands as the line
  // itself so the two always agree: red only where the line is high, green
  // along the bottom. Anchored to the plot area with userSpaceOnUse rather
  // than each path's bounding box -- a tall spike and the flat trace beside
  // it must show the same colour at the same height, which a per-path box
  // would break.
  function chartAreaFill(coordinates, values, options = {}) {
    const settings = chartColorSettings();
    const id = `beast-chart-area-${sparklineIdCounter++}`;
    const maskId = `${id}-mask`;
    const { top, bottom } = chartPlotBounds(options);
    const topOpacity = options.topOpacity ?? 0.38;
    const stops = settings.mode === "usage"
      ? chartBandStops(settings, topOpacity)
      : `<stop offset="0%" stop-color="${settings.static}" stop-opacity="${topOpacity}"></stop><stop offset="100%" stop-color="${settings.static}" stop-opacity="${topOpacity}"></stop>`;
    // A second, vertical fade so the fill dissolves toward the baseline
    // instead of ending in a hard edge.
    const defs = `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${top}" x2="0" y2="${bottom}">${stops}</linearGradient>
      <linearGradient id="${maskId}-grad" gradientUnits="userSpaceOnUse" x1="0" y1="${top}" x2="0" y2="${bottom}">
        <stop offset="0%" stop-color="#fff" stop-opacity="1"></stop>
        <stop offset="100%" stop-color="#fff" stop-opacity="0.5"></stop>
      </linearGradient>
      <mask id="${maskId}"><rect x="0" y="0" width="${options.width || 1}" height="${options.height || 1}" fill="url(#${maskId}-grad)"></rect></mask>`;
    return { defs, fill: `url(#${id})`, mask: `url(#${maskId})` };
  }

  function chartLineGradient(coordinates, values, options = {}) {
    const settings = chartColorSettings();
    if (settings.mode !== "usage" || !values.length) return null;
    const { top, bottom } = chartPlotBounds(options);
    const id = `beast-chart-grad-${sparklineIdCounter++}`;
    return {
      id,
      defs: `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${top}" x2="0" y2="${bottom}">${chartBandStops(settings)}</linearGradient>`,
      stroke: `url(#${id})`
    };
  }

  function chartType(key) {
    const types = BeastConfig.get("chartTypes") || {};
    const value = types[key] || BeastConfig.get("panels.energy.usageChartType");
    return value === "bars" ? "bars" : "line";
  }

  function setChartType(key, type) {
    return BeastConfig.set("chartTypes", {
      ...(BeastConfig.get("chartTypes") || {}),
      [key]: type === "bars" ? "bars" : "line"
    });
  }

  // Standard markup for the line/bars switch. Callers decide when to show
  // it (edit mode) and wire the clicks; keeping the markup here means every
  // one of them looks and behaves the same.
  function chartTypeToggleMarkup(key, label) {
    const current = chartType(key);
    const colors = chartColorSettings();
    // The colour panel is folded away behind its own button rather than
    // shown inline: shape is a per-graph choice, colour is one shared
    // setting for every graph, so putting them side by side would suggest
    // the colours only applied to this one.
    return `<div class="beast-chart-type" data-chart-type-key="${String(key).replace(/"/g, "&quot;")}">
      ${label ? `<span>${String(label).replace(/[<>&]/g, "")}</span>` : ""}
      <button type="button" data-chart-type="line" class="${current === "line" ? "is-active" : ""}">Linje</button>
      <button type="button" data-chart-type="bars" class="${current === "bars" ? "is-active" : ""}">Søjler</button>
      <button type="button" class="beast-chart-colors-btn" data-chart-colors aria-expanded="false" title="Farver">${icon("palette", { size: 15 })}</button>
      <div class="beast-chart-colors" data-chart-colors-panel hidden>
        <label><span>Farvelægning</span>
          <select data-chart-color-mode>
            <option value="static" ${colors.mode === "static" ? "selected" : ""}>Fast farve</option>
            <option value="usage" ${colors.mode === "usage" ? "selected" : ""}>Efter forbrug</option>
          </select>
        </label>
        <label class="beast-chart-color-row"><span>Fast farve</span><input type="color" data-chart-color-static value="${colors.static}"></label>
        <div class="beast-chart-color-steps" ${colors.mode === "usage" ? "" : "hidden"}>
          <span>Lavt forbrug → højt</span>
          <div>${colors.steps.map((color, index) => `<input type="color" data-chart-color-step="${index}" value="${color}" title="Trin ${index + 1}">`).join("")}</div>
        </div>
        <small>Farverne gælder alle grafer.</small>
      </div>
    </div>`;
  }

  function barChart(bars, options = {}) {
    const height = options.height || 80;
    const gap = options.gap ?? 3;
    return `
      <div class="beast-bar-chart" style="height:${height}px;">
        ${bars.map((bar) => {
          const color = bar.color || "var(--accent-a)";
          return `
          <div class="beast-bar-chart-col" style="flex:1; margin: 0 ${gap / 2}px;">
            <div class="beast-bar-chart-bar${bar.active ? " is-active" : ""}" style="height:${Math.max(6, bar.pct)}%; background:linear-gradient(180deg, rgba(255,255,255,0.3), rgba(255,255,255,0) 55%), ${color}; box-shadow: 0 0 10px -2px ${color};" title="${bar.title || ""}"></div>
          </div>
        `;
        }).join("")}
      </div>
    `;
  }

  function statTile({ icon: iconName, label, value, meta, wide, id, extra }) {
    return `
      <div class="beast-stat-tile${wide ? " is-wide" : ""}"${id ? ` id="${id}"` : ""}>
        ${iconName ? `<span class="beast-stat-tile-icon">${icon(iconName, { size: 18 })}</span>` : ""}
        <span class="beast-stat-tile-label">${label}</span>
        <span class="beast-stat-tile-value">${value}</span>
        ${meta ? `<span class="beast-stat-tile-meta">${meta}</span>` : ""}
        ${extra || ""}
      </div>
    `;
  }

  // Every genericized panel shows the same "not set up yet" card when its
  // BeastConfig entities are unset, instead of crashing on an undefined
  // entity lookup — one shared markup builder + click wiring so all ~12
  // panels behave identically and only need to call this once.
  function notConfiguredMarkup(panelLabel, description) {
    return `
      <div class="beast-not-configured">
        ${icon("sparkles", { size: 34 })}
        <strong>${panelLabel} er ikke sat op endnu</strong>
        <span>${description || "Vælg de rigtige entities i Opsætning for at aktivere dette panel."}</span>
        <button type="button" data-goto-setup>${icon("chevron-right", { size: 16 })} Gå til Opsætning</button>
      </div>
    `;
  }

  function wireNotConfiguredLinks(root) {
    root.querySelectorAll("[data-goto-setup]").forEach((button) => {
      button.addEventListener("click", () => {
        window.location.href = appUrl("admin/");
      });
    });
  }

  // Shared condition -> {icon, label, mood} table. Single source of truth so
  // the Overview glance card, the full Vejr page, and any future weather
  // widget always agree on what a condition looks like and is called.
  const WEATHER_CONDITIONS = {
    "clear-night": { icon: "moon", label: "Klart", mood: "clear" },
    sunny: { icon: "sun", label: "Solrigt", mood: "clear" },
    partlycloudy: { icon: "cloud", label: "Delvist skyet", mood: "cloudy" },
    cloudy: { icon: "cloud", label: "Skyet", mood: "cloudy" },
    fog: { icon: "cloud", label: "Tåget", mood: "cloudy" },
    windy: { icon: "wind", label: "Blæsende", mood: "cloudy" },
    "windy-variant": { icon: "wind", label: "Blæsende", mood: "cloudy" },
    rainy: { icon: "cloud-rain", label: "Regn", mood: "rainy" },
    pouring: { icon: "cloud-rain", label: "Skybrud", mood: "rainy" },
    lightning: { icon: "cloud-rain", label: "Torden", mood: "rainy" },
    "lightning-rainy": { icon: "cloud-rain", label: "Tordenbyger", mood: "rainy" },
    hail: { icon: "cloud-rain", label: "Hagl", mood: "rainy" },
    snowy: { icon: "cloud-rain", label: "Sne", mood: "rainy" },
    "snowy-rainy": { icon: "cloud-rain", label: "Slud", mood: "rainy" }
  };

  function weatherMeta(condition) {
    return WEATHER_CONDITIONS[condition] || { icon: "cloud", label: String(condition || "Ukendt"), mood: "cloudy" };
  }

  // Hand-drawn animated SVG weather icons (spinning/pulsing sun, drifting
  // cloud, falling rain drops) — used anywhere a weather condition is shown
  // so the whole app reads as one consistent, alive piece of UI rather than
  // static line icons in some spots and motion in others.
  function animatedWeatherIcon(mood, size) {
    if (mood === "clear") {
      return `<svg class="beast-weather-svg is-clear" width="${size}" height="${size}" viewBox="-6 -6 76 76" aria-hidden="true">
        <g class="beast-weather-rays">
          <path d="M32 4v8M32 52v8M4 32h8M52 32h8M12.2 12.2l5.7 5.7M46.1 46.1l5.7 5.7M51.8 12.2l-5.7 5.7M17.9 46.1l-5.7 5.7"/>
        </g>
        <circle class="beast-weather-sun-core" cx="32" cy="32" r="13"/>
      </svg>`;
    }
    const rain = mood === "rainy" ? `
      <g class="beast-weather-drops">
        <path d="M22 48l-3 8"/><path d="M34 48l-3 8"/><path d="M46 48l-3 8"/>
      </g>` : "";
    return `<svg class="beast-weather-svg ${mood === "rainy" ? "is-rainy" : "is-cloudy"}" width="${size}" height="${size}" viewBox="-6 -8 76 80" aria-hidden="true">
      <g class="beast-weather-cloud-shape">
        <path class="beast-weather-cloud-back" d="M18 42h31a10 10 0 0 0 1-20 17 17 0 0 0-32-1A11 11 0 0 0 18 42z"/>
        <path class="beast-weather-cloud-front" d="M13 46h34a9 9 0 0 0 0-18 14 14 0 0 0-26-2A10 10 0 0 0 13 46z"/>
      </g>
      ${rain}
    </svg>`;
  }

  // Straight-line polyline through the same coordinate format catmullRomPath
  // takes. Home Assistant's own history graphs draw real data this way —
  // sharp corners, genuine spikes — rather than smoothing it into a curve,
  // so charts meant to read as "real telemetry" (Energy panel, Overview
  // utility sparkline) use this instead of the spline below.
  function linearPath(coordinates) {
    return coordinates.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  }

  // Shared by every SVG line/area chart in the app so a jagged
  // straight-segment polyline never has to be the default — a Catmull-Rom
  // spline through the same points renders as a smooth, natural-looking
  // curve instead. Reach for this only where "smoothed trend" is the
  // intent, not "matches real recorded data" (see linearPath above).
  function catmullRomPath(coordinates) {
    if (coordinates.length < 3) {
      return coordinates.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    }
    const d = [`M${coordinates[0][0].toFixed(1)} ${coordinates[0][1].toFixed(1)}`];
    for (let i = 0; i < coordinates.length - 1; i += 1) {
      const p0 = coordinates[i === 0 ? 0 : i - 1];
      const p1 = coordinates[i];
      const p2 = coordinates[i + 1];
      const p3 = coordinates[i + 2 < coordinates.length ? i + 2 : i + 1];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d.push(`C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`);
    }
    return d.join(" ");
  }

  // Small centered moving average — rounds off remaining bucket-to-bucket
  // noise before catmullRomPath turns the series into a curve, so short
  // spikes read as gentle bumps instead of sharp teeth.
  function smoothSeries(values, radius) {
    if (values.length < radius * 2 + 1) return values;
    return values.map((_, index) => {
      const from = Math.max(0, index - radius);
      const to = Math.min(values.length - 1, index + radius);
      let sum = 0;
      for (let i = from; i <= to; i += 1) sum += values[i];
      return sum / (to - from + 1);
    });
  }

  return {
    appUrl,
    registerPanel,
    mountPanels,
    log,
    getDebugLog: () => debugLog.slice(),
    formatClock,
    formatDate,
    el,
    debounce,
    isUserInteracting,
    whenUserIdle,
    isPanelVisible,
    stableUpdater,
    icon,
    statTile,
    notConfiguredMarkup,
    wireNotConfiguredLinks,
    sparkline,
    chartColorSettings,
    chartColorForRatio,
    chartLineGradient,
    chartLineStroke,
    chartAreaFill,
    chartType,
    setChartType,
    chartTypeToggleMarkup,
    barChart,
    weatherMeta,
    animatedWeatherIcon,
    catmullRomPath,
    linearPath,
    smoothSeries
  };
})();
