const BeastLocalSettings = (() => {
  const STORAGE_KEY = "beast_machine_settings_v1";
  const DEFAULTS = {
    hiddenSections: [],
    defaultSection: "overview",
    density: "comfortable",
    favoriteSections: [],
    kioskScreenLight: null,
    screensaver: { enabled: true, schedule: "custom", startTime: "23:00", endTime: "05:30", offAfterMinutes: 5 }
  };
  function readRaw() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); }
    catch (_) { return {}; }
  }
  function read() {
    const stored = readRaw();
    return { ...DEFAULTS, ...stored, screensaver: { ...DEFAULTS.screensaver, ...(stored.screensaver || {}) } };
  }
  function get(path, fallback = null) {
    const value = path.split(".").reduce((node, key) => node == null ? undefined : node[key], readRaw());
    return value === undefined || value === null ? fallback : value;
  }
  function set(path, value) {
    const next = read();
    const keys = path.split(".");
    let node = next;
    for (let index = 0; index < keys.length - 1; index += 1) {
      if (!node[keys[index]] || typeof node[keys[index]] !== "object") node[keys[index]] = {};
      node = node[keys[index]];
    }
    node[keys[keys.length - 1]] = value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    document.dispatchEvent(new CustomEvent("beast:local-settings-changed", { detail: { path, value } }));
    return { success: true };
  }
  function replaceAll(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return { success: false };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULTS, ...value, screensaver: { ...DEFAULTS.screensaver, ...(value.screensaver || {}) } }));
    document.dispatchEvent(new CustomEvent("beast:local-settings-changed", { detail: { path: "*", value } }));
    return { success: true };
  }
  return { get, set, getAll: read, replaceAll };
})();
