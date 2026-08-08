// User-editable entity/dashboard configuration, backing the Administration
// panel. System-level settings (dashboard name, hidden pages, screensaver,
// kiosk/doorbell entities) live here now; the migrated data-panel entity
// mappings (Vejr, Affald, Musik, ...) join them as each panel moves over.
//
// Backed by a small PHP endpoint (api/config.php) rather than only
// localStorage, so the setup belongs to the dashboard rather than the
// browser/device it happened to be configured from — important for
// handing this to someone else to run on their own kiosk. localStorage is
// still used as an offline read/write fallback if the backend is briefly
// unreachable, and as the source for the synchronous get()/set() calls
// every panel already uses (populated once, eagerly, by init() before any
// panel mounts).
const BeastConfig = (() => {
  const STORAGE_KEY = "beast_panel_entity_config_v1";
  // Resolve from this script's own URL so the same config client also works
  // from nested pages such as /hearth/admin/.
  const API_URL = new URL("../api/config.php", document.currentScript?.src || window.location.href).href;

  // Every panel's config lives here, keyed by panel id, matching the
  // BeastCore.registerPanel(id, ...) name each panel already uses. All
  // fields default to null/empty — that's the "not set up yet" state a
  // panel checks for before rendering real content.
  const DEFAULT_PANELS = {
    weather: { entity: null },
    energy: {
      powerSensor: null, priceSensor: null, priceForecastSensor: null, tomorrowAvailableSensor: null,
      totalEnergySensor: null, totalCostSensor: null, nowMeasuredSensor: null, nowUnmeasuredSensor: null,
      heatPowerSensor: null, heatEnergySensor: null, waterUsageSensor: null, waterFlowSensor: null,
      nowGroups: []
    },
    rooms: { areaIds: [], climateSensors: {}, entityOverrides: {} },
    pool: {
      waterTemp: null, pumpSwitch: null, pumpStatus: null, runtime: null,
      personInWater: null, automationToggle: null, cameraStream: null
    },
    car: {
      sourceDevice: null, battery: null, range: null, shiftState: null, chargerPower: null,
      charging: null, pluggedIn: null, lock: null, locationTracker: null, odometer: null,
      doorsOpen: null, windowsOpen: null, insideTemp: null, outsideTemp: null,
      chargingFinishAt: null, energyAdded: null, tpmsFl: null, tpmsFr: null, tpmsRl: null, tpmsRr: null
    },
    security: {
      alarmPanels: [], primaryAlarm: null, locks: [], openingSensors: []
    },
    cameras: {
      go2rtcBaseUrl: null, cameraEntities: []
    },
    printer: {
      sourceDevice: null, statusSensor: null, stageSensor: null, progressSensor: null, remainingSensor: null,
      nozzleTemp: null, nozzleTarget: null, bedTemp: null, bedTarget: null, currentLayer: null, totalLayers: null,
      taskName: null, cameraImage: null, pauseButton: null, resumeButton: null, stopButton: null,
      activeTray: null, traySensors: [], amsHumidity: null, totalUsage: null, liveStream: null
    },
    robots: {
      vacuums: [], mowers: [], roomSelectors: [], leonoraImage: null, poulImage: null
    },
    waste: { sensors: [], calendars: [] },
    heating: {
      rooms: [], heatPumps: [], heatPumpUnits: {}, automation: null, districtSensors: [], ventilationSensors: []
    },
    music: { configEntryId: null, stereoGroups: {} }
  };

  const DEFAULTS = {
    dashboardTitle: "HA Smartdash",
    haBaseUrl: null,
    faviconUrl: "./favicon.svg",
    showAdminButton: true,
    features: {
      eventFocus: false,
      dynamicOverview: false,
      localFavorites: false,
      dataQuality: false,
      quickScenarios: false,
      idleMode: true,
      adminPreview: false,
      configAudit: false,
      postBanner: true,
    },
    overviewSlots: {
      main: { type: "cameras", entity: null, label: "" },
      compactTop: { type: "clock", entity: null, label: "" },
      compactBottom: { type: "security", entity: null, label: "" },
      wideTop: { type: "weather", entity: null, label: "" },
      wideBottom: { type: "energy", entity: null, label: "" }
    },
    overviewCards: [],
    hiddenSections: [],
    appEntities: { kioskScreenLight: null, kioskEntities: {}, doorbellBinarySensor: null, doorbellEvent: null, doorbellCamera: null, mailPresent: null, mailCount: null, mailDescription: null, mailImage: null, mailImageCarport: null, mailImageForhaven: null, quickScenes: [] },
    screensaver: { enabled: true, schedule: "custom", startTime: "23:00", endTime: "05:30", offAfterMinutes: 5 },
    screenLock: { pinHash: null, autoLockEnabled: false },
    panels: DEFAULT_PANELS
  };

  let cache = null;
  let readyPromise = null;

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  // Arrays and primitives from `override` always win outright; plain objects
  // merge key-by-key so a stored config missing a brand-new panel field
  // (added in a later version of this file) still gets that field's
  // default instead of silently ending up undefined.
  function deepMerge(base, override) {
    if (!isPlainObject(base) || !isPlainObject(override)) {
      return override !== undefined ? override : base;
    }
    const result = { ...base };
    Object.keys(override).forEach((key) => {
      result[key] = deepMerge(base[key], override[key]);
    });
    return result;
  }

  function readLocalFallback() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (error) {
      return {};
    }
  }

  function writeLocalFallback(config) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (error) {
      console.error("[BeastConfig] kunne ikke skrive lokal cache", error);
    }
  }

  function hasMeaningfulValue(value) {
    if (Array.isArray(value)) return value.length > 0;
    if (isPlainObject(value)) return Object.values(value).some(hasMeaningfulValue);
    return value !== null && value !== undefined && value !== "";
  }

  function applyLegacyPanelDefaults(config, remote) {
    ["rooms", "pool", "car", "security", "cameras", "printer", "robots", "heating"].forEach((panelId) => {
      if (!hasMeaningfulValue(remote?.panels?.[panelId])) {
        config.panels[panelId] = JSON.parse(JSON.stringify(DEFAULT_PANELS[panelId]));
      }
    });
    return config;
  }

  // Called once at boot, before any panel mounts, so every later get() call
  // is a plain synchronous object read — panels never need to know config
  // is backed by a network request.
  function init() {
    if (readyPromise) return readyPromise;
    readyPromise = fetch(API_URL)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .catch((error) => {
        console.warn("[BeastConfig] backend utilgængelig, bruger lokal cache", error);
        return readLocalFallback();
      })
      .then((remote) => {
        cache = deepMerge(DEFAULTS, remote || {});
        writeLocalFallback(cache);
        return cache;
      });
    return readyPromise;
  }

  // Defensive fallback for any get()/set() call that somehow runs before
  // init() resolves — shouldn't happen since the boot sequence awaits it,
  // but a stale local cache beats throwing.
  function ensureLoaded() {
    if (!cache) cache = deepMerge(DEFAULTS, readLocalFallback());
    return cache;
  }

  function save(next) {
    cache = next;
    writeLocalFallback(next);
    const request = fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next)
    }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }).catch((error) => {
      console.error("[BeastConfig] kunne ikke gemme til backend", error);
      return { success: false };
    });
    document.dispatchEvent(new CustomEvent("beast:config-changed"));
    return request;
  }

  function get(path) {
    const config = ensureLoaded();
    if (!path) return config;
    return path.split(".").reduce((node, key) => (node == null ? null : node[key]), config);
  }

  function set(path, value) {
    const config = ensureLoaded();
    const clone = JSON.parse(JSON.stringify(config));
    const keys = path.split(".");
    let node = clone;
    for (let i = 0; i < keys.length - 1; i += 1) {
      if (!isPlainObject(node[keys[i]])) node[keys[i]] = {};
      node = node[keys[i]];
    }
    node[keys[keys.length - 1]] = value;
    return save(clone);
  }

  function setPanel(panelId, patch) {
    const config = ensureLoaded();
    const nextPanel = deepMerge(config.panels[panelId] || {}, patch);
    return save({ ...config, panels: { ...config.panels, [panelId]: nextPanel } });
  }

  // "Configured" = at least one field has a real value. Panels use this to
  // decide between rendering real content and a friendly empty state.
  function isPanelConfigured(panelId) {
    const panel = get(`panels.${panelId}`);
    if (!panel) return false;
    return Object.values(panel).some((value) => {
      if (Array.isArray(value)) return value.length > 0;
      if (isPlainObject(value)) return Object.keys(value).length > 0;
      return value !== null && value !== undefined && value !== "";
    });
  }

  function isSectionHidden(sectionId) {
    const local = window.BeastLocalSettings?.get("hiddenSections", null);
    return (Array.isArray(local) ? local : (get("hiddenSections") || [])).includes(sectionId);
  }

  function reset() {
    cache = null;
    readyPromise = null;
    localStorage.removeItem(STORAGE_KEY);
    fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
    document.dispatchEvent(new CustomEvent("beast:config-changed"));
  }

  function replaceAll(nextConfig) {
    if (!isPlainObject(nextConfig)) return Promise.resolve({ success: false });
    return save(deepMerge(DEFAULTS, nextConfig));
  }

  return {
    init,
    get,
    set,
    setPanel,
    isPanelConfigured,
    isSectionHidden,
    getAll: ensureLoaded,
    replaceAll,
    reset,
    PANEL_IDS: Object.keys(DEFAULT_PANELS)
  };
})();
