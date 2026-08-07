(function () {
  // Denne installation migrerer panel for panel fra det oprindelige,
  // hardcodede HA Smartdash — kun paneller der faktisk er koblet til
  // BeastConfig optræder her, ellers ville admin vise felter der ikke gør
  // noget endnu. Nye entries tilføjes i takt med at hvert panel migreres.
  const PAGES = [
    ["weather", "Vejr"], ["rooms", "Rum"], ["cameras", "Kameraer"], ["security", "Sikkerhed"],
    ["music", "Musik"], ["energy", "Energi"], ["heating", "Varme"], ["car", "Bil"],
    ["pool", "Pool"], ["waste", "Kalender"], ["robots", "Robotter"], ["printer", "3D Printer"]
  ];
  const FEATURE_OPTIONS = [
    ["eventFocus", "Automatisk fokusvisning", "Vis vigtige hændelser som alarm, pool, opladning og printer midlertidigt."],
    ["dynamicOverview", "Dynamisk kortlayout", "Skjul tomme kort og lad de øvrige kort overtage pladsen."],
    ["localFavorites", "Favoritter pr. skærm", "Lokal standardfane, rækkefølge og kompakthed på hver kiosk."],
    ["dataQuality", "Datakvalitet", "Markér live, forsinkede og utilgængelige HA-data."],
    ["quickScenarios", "Hurtigscenarier", "Vis sikre genveje til valgte Home Assistant-scenes."],
    ["idleMode", "Tomgangstilstand", "Vis rolig klokke-, vejr- og sikkerhedsvisning efter inaktivitet."],
    ["adminPreview", "Admin-forhåndsvisning", "Vis den valgte entitys aktuelle navn, værdi og datastatus."],
    ["configAudit", "Konfigurationskontrol", "Find manglende, forkerte og utilgængelige entities."]
  ];
  const OVERVIEW_SLOT_OPTIONS = [
    ["empty","Tom plads"],["cameras","Kameraer"],["clock","Ur, kalender og affald"],["weather","Vejr"],["security","Sikkerhed"],["energy","Energi"],
    ["car","Bil"],["pool","Pool"],["robots","Robotter"],["printer","3D-printer"],["custom","Valgfri HA-entity"]
  ];
  const OVERVIEW_SLOTS = [["main","Stor plads"],["compactTop","Venstre øverst"],["compactBottom","Venstre nederst"],["wideTop","Midte øverst"],["wideBottom","Midte nederst"]];

  const PANELS = [
    { id: "weather", title: "Vejr", description: "Vejrudsigt og aktuelle vejrdata.", fields: [
      { key: "entity", label: "Vejr-entity", type: "single", domain: "weather" }
    ]},
    { id: "waste", title: "Kalender & affald", description: "Kalendere og affaldssensorer.", fields: [
      { key: "calendars", label: "Kalendere", type: "multi", domain: "calendar" },
      { key: "sensors", label: "Affaldssensorer", type: "multi", domain: "sensor", hints: ["affald", "waste", "trash", "bin"] }
    ]},
    { id: "music", title: "Musik", description: "Music Assistant-integration til bibliotek og søgning.", fields: [
      { key: "configEntryId", label: "Music Assistant config entry-id", type: "text", placeholder: "fx 01KK8RSBAW369PSMQMG6CE5HGB" }
    ]},
    { id: "rooms", title: "Rum", description: "Rumkort, klima, lys, åbninger og øvrige kontroller. Områderne bestemmer hvilke rum der vises; de nuværende rum er valgt på forhånd.", fields: [
      { key: "areaIds", label: "Synlige Home Assistant-områder", type: "areas" }
    ]},
    { id: "cameras", title: "Kameraer", description: "Kameraoversigt med snapshots, livevisning og bevægelsesstatus.", fields: [
      { key: "go2rtcBaseUrl", label: "go2rtc-adresse", type: "text", placeholder: "http://server:1984" },
      { key: "cameraEntities", label: "Kamera-entities", type: "multi", domain: "camera" }
    ]},
    { id: "security", title: "Sikkerhed", description: "Alarmpaneler, dørlåse og sensorer for døre og vinduer.", fields: [
      { key: "primaryAlarm", label: "Primært alarmsystem", type: "single", domain: "alarm_control_panel" },
      { key: "alarmPanels", label: "Alle alarmsystemer", type: "multi", domain: "alarm_control_panel" },
      { key: "locks", label: "Dørlåse", type: "multi", domain: "lock" },
      { key: "openingSensors", label: "Sensorer til de tre indgangskort (øvrige åbninger opdages automatisk)", type: "multi", domain: "binary_sensor", deviceClasses: ["door", "window", "garage_door", "opening"] }
    ]},
    { id: "heating", title: "Varme", description: "Rumtermostater, varmepumper, fjernvarmemåler og Dantherm-ventilation.", fields: [
      { key: "rooms", label: "Rumtermostater", type: "multi", domain: "climate" },
      { key: "heatPumps", label: "Varmepumper", type: "multi", domain: "climate" },
      { key: "automation", label: "Automatisk varmestyring", type: "single", domain: "input_boolean", hints: ["varme", "heat", "calefa"], filterHints: true },
      { key: "districtSensors", label: "Fjernvarme-sensorer", type: "multi", domain: "sensor", hints: ["kamstrup", "multical"], filterHints: true },
      { key: "ventilationSensors", label: "Dantherm-sensorer", type: "multi", domain: "sensor", hints: ["dantherm", "hch5"], filterHints: true }
    ]},
    { id: "car", title: "Bil", description: "Energitte: batteri, opladning, lås, lokation, temperatur og dæktryk.", fields: [
      { key: "sourceDevice", label: "Bil / integration", type: "device", sourceDomains: ["sensor", "binary_sensor", "device_tracker", "lock"], deviceHints: ["tesla", "car", "bil", "energitte"] },
      { key: "battery", label: "Batteri", type: "single", domain: "sensor", relatedTo: ["battery"] }, { key: "range", label: "Rækkevidde", type: "single", domain: "sensor", relatedTo: ["battery"] },
      { key: "shiftState", label: "Gear-/kørestatus", type: "single", domain: "sensor" },
      { key: "charging", label: "Oplader", type: "single", domain: "binary_sensor" }, { key: "pluggedIn", label: "Ladekabel tilsluttet", type: "single", domain: "binary_sensor" },
      { key: "lock", label: "Dørlås", type: "single", domain: "lock" }, { key: "locationTracker", label: "Lokation", type: "single", domain: "device_tracker" },
      { key: "odometer", label: "Kilometertæller", type: "single", domain: "sensor" }, { key: "doorsOpen", label: "Døre åbne", type: "single", domain: "binary_sensor" },
      { key: "windowsOpen", label: "Vinduer åbne", type: "single", domain: "binary_sensor" }, { key: "insideTemp", label: "Temperatur inde", type: "single", domain: "sensor" },
      { key: "outsideTemp", label: "Temperatur ude", type: "single", domain: "sensor" }, { key: "chargerPower", label: "Ladeeffekt", type: "single", domain: "sensor" },
      { key: "chargingFinishAt", label: "Forventet færdigopladning", type: "single", domain: "sensor" },
      { key: "energyAdded", label: "Tilført energi", type: "single", domain: "sensor" },
      { key: "tpmsFl", label: "Dæktryk · for venstre", type: "single", domain: "sensor" }, { key: "tpmsFr", label: "Dæktryk · for højre", type: "single", domain: "sensor" },
      { key: "tpmsRl", label: "Dæktryk · bag venstre", type: "single", domain: "sensor" }, { key: "tpmsRr", label: "Dæktryk · bag højre", type: "single", domain: "sensor" }
    ]},
    { id: "pool", title: "Pool", description: "Vandtemperatur, pumpe, driftstid, automatik, badende og livekamera.", fields: [
      { key: "waterTemp", label: "Vandtemperatur", type: "single", domain: "sensor", hints: ["pool", "bassin"], filterHints: true }, { key: "pumpSwitch", label: "Poolpumpe", type: "single", domain: "switch", hints: ["pool", "pumpe"], filterHints: true },
      { key: "pumpStatus", label: "Pumpens driftstatus", type: "single", domain: "sensor", hints: ["pool", "pumpe"], filterHints: true }, { key: "runtime", label: "Køretid i dag", type: "single", domain: "sensor", hints: ["pool", "pumpe"], filterHints: true },
      { key: "personInWater", label: "Person i vandet", type: "single", domain: "binary_sensor", hints: ["pool", "bassin"], filterHints: true }, { key: "automationToggle", label: "Poolautomatik", type: "single", domain: "input_boolean", hints: ["pool", "bassin"], filterHints: true },
      { key: "cameraStream", label: "go2rtc streamnavn", type: "text", placeholder: "Terrasse_syd" }
    ]},
    { id: "robots", title: "Robotter", description: "Vælg blot robot-entities. HA Smartdash finder automatisk batteri, kort, knapper, sensorer og indstillinger, som den valgte robots HA-device eksponerer. Listen kan være tom eller indeholde vilkårligt mange robotter og modeller.", fields: [
      { key: "vacuums", label: "Robotstøvsugere", type: "multi", domain: "vacuum" },
      { key: "mowers", label: "Robotplæneklippere", type: "multi", domain: "lawn_mower" }
      ,{ key: "roomSelectors", label: "Valgbare robotrum (valgfri)", type: "multi", domain: "input_boolean", hints: ["vacuum", "room", "rum"] }
      ,{ key: "leonoraImage", label: "Billede til 1. robotstøvsuger (valgfri, erstatter standardbilledet)", type: "single", domain: "image" }
      ,{ key: "poulImage", label: "Billede til robotplæneklipperen (valgfri, erstatter standardbilledet)", type: "single", domain: "image" }
    ]},
    { id: "printer", title: "3D Printer", description: "Bambu P1S-job, temperaturer, lag, AMS, kamera og betjeningsknapper.", fields: [
      { key: "sourceDevice", label: "Printer / integration", type: "device", sourceDomains: ["sensor", "image", "button"], deviceHints: ["bambu", "printer", "p1s", "prusa", "klipper"] },
      { key: "statusSensor", label: "Printstatus", type: "single", domain: "sensor", relatedTo: ["statusSensor"] }, { key: "stageSensor", label: "Aktuelt trin", type: "single", domain: "sensor", relatedTo: ["statusSensor"] },
      { key: "progressSensor", label: "Fremdrift", type: "single", domain: "sensor" }, { key: "remainingSensor", label: "Resterende tid", type: "single", domain: "sensor" },
      { key: "nozzleTemp", label: "Dysetemperatur", type: "single", domain: "sensor" }, { key: "nozzleTarget", label: "Dyse-måltemperatur", type: "single", domain: "sensor" },
      { key: "bedTemp", label: "Pladetemperatur", type: "single", domain: "sensor" }, { key: "bedTarget", label: "Plade-måltemperatur", type: "single", domain: "sensor" },
      { key: "currentLayer", label: "Aktuelt lag", type: "single", domain: "sensor" }, { key: "totalLayers", label: "Antal lag", type: "single", domain: "sensor" },
      { key: "taskName", label: "Printjobbets navn", type: "single", domain: "sensor" }, { key: "cameraImage", label: "Kamerabillede", type: "single", domain: "image" },
      { key: "pauseButton", label: "Pauseknap", type: "single", domain: "button" }, { key: "resumeButton", label: "Fortsæt-knap", type: "single", domain: "button" },
      { key: "stopButton", label: "Stopknap", type: "single", domain: "button" }, { key: "traySensors", label: "AMS-bakker", type: "multi", domain: "sensor", hints: ["bambu", "tray"] },
      { key: "activeTray", label: "Aktiv AMS-bakke", type: "single", domain: "sensor" }, { key: "amsHumidity", label: "AMS-fugtighed", type: "single", domain: "sensor" },
      { key: "totalUsage", label: "Samlet driftstid", type: "single", domain: "sensor" },
      { key: "liveStream", label: "go2rtc streamnavn", type: "text", placeholder: "3dprinter" }
    ]},
    { id: "energy", title: "Energi", description: "Hovedmåler, elpris og dagens totaler.", fields: [
      { key: "powerSensor", label: "Hovedmåler (effekt)", type: "single", domain: "sensor", deviceClasses: ["power"], hints: ["main", "total", "house", "hoved"] },
      { key: "priceSensor", label: "Elpris nu", type: "single", domain: "sensor", deviceClasses: ["monetary"], hints: ["price", "pris"] },
      { key: "priceForecastSensor", label: "Prisprognose (valgfri)", type: "single", domain: "sensor", hints: ["forecast", "prognose", "pris"] },
      { key: "tomorrowAvailableSensor", label: "I morgen tilgængelig (valgfri)", type: "single", domain: "binary_sensor", hints: ["tomorrow", "morgen"] },
      { key: "totalEnergySensor", label: "Energi i dag", type: "single", domain: "sensor", deviceClasses: ["energy"] },
      { key: "totalCostSensor", label: "Pris i dag", type: "single", domain: "sensor", deviceClasses: ["monetary"] },
      { key: "nowMeasuredSensor", label: "\"Nu\" · målt total (valgfri)", type: "single", domain: "sensor", hints: ["malt", "total", "measured"] },
      { key: "nowUnmeasuredSensor", label: "\"Nu\" · umålt forbrug (valgfri)", type: "single", domain: "sensor", hints: ["umalt", "unmeasured"] },
      { key: "heatPowerSensor", label: "Varmeeffekt til forsiden (valgfri)", type: "single", domain: "sensor" },
      { key: "heatEnergySensor", label: "Varmeenergi i dag (valgfri)", type: "single", domain: "sensor" },
      { key: "waterUsageSensor", label: "Vandforbrug i dag (valgfri)", type: "single", domain: "sensor" },
      { key: "waterFlowSensor", label: "Vandflow nu (valgfri)", type: "single", domain: "sensor" },
      { key: "nowGroups", label: "\"Nu\"-visning · grupper pr. el-kreds", type: "groups" }
    ]}
  ];

  const MQTT_CONFIG_KEY = "beast_mqtt_settings_v1";
  const MQTT_TARGETS = [
    { id: "zigbee2mqtt", label: "Zigbee2MQTT", prefix: "zigbee2mqtt" },
    { id: "kiosk_8400t", label: "8400T kiosk", prefix: "kiosk_8400t" },
    { id: "touchkio", label: "TouchKio", prefix: "touchkio" },
    { id: "homehub", label: "HomeHub", prefix: "homehub/buttons" },
    { id: "homeassistant", label: "Home Assistant", prefix: "homeassistant" },
    { id: "custom", label: "Custom", prefix: "" }
  ];
  // ha-smartdash-overview.js (which normally owns this key) isn't loaded on the
  // admin page, so this mirrors its tiny get/set directly against the same
  // localStorage key rather than pulling in the whole panel file. Written
  // here takes effect the next time the dashboard tab loads or re-reads it
  // — there's no live cross-tab push, since this is a separate document.
  const FLOATING_PLAYER_ENABLED_KEY = "beast_overview_player_enabled_v1";
  function isFloatingPlayerEnabled() {
    return localStorage.getItem(FLOATING_PLAYER_ENABLED_KEY) !== "0";
  }
  function setFloatingPlayerEnabled(enabled) {
    localStorage.setItem(FLOATING_PLAYER_ENABLED_KEY, enabled ? "1" : "0");
  }

  const CONN_STATUS_LABELS = {
    connecting: "Forbinder…",
    connected: "Live",
    "auth-failed": "Login udløbet"
  };

  const root = document.getElementById("beastAdminRoot");
  let connected = false;
  let activeView = "overview";
  let currentConnState = "connecting";
  let currentMqttState = "connecting";
  let mqttWatchdogTimerId = null;
  let mqttCheckRunning = false;
  let pendingKioskAction = null;
  let registryUiHydrated = false;
  let hasUnsavedPanelChanges = false;
  const entityCandidateCache = new Map();
  const checkListSources = new Map();
  const checkListSelections = new Map();
  const selectSources = new Map();
  const entityFieldBaseSources = new Map();
  const CHECK_LIST_RENDER_LIMIT = 80;
  let dynamicGroupRowSequence = 0;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  // Dynamic status strings (with interpolated versions/timestamps) can't be
  // caught by the DOM-text dictionary in ha-smartdash-i18n.js, since it only
  // matches exact static phrases — so these pick their language directly.
  function t(da, en) {
    return BeastLocalSettings.get("language", "en") === "da" ? da : en;
  }

  function fieldId(panelId, key) { return `admin_${panelId}_${key}`; }

  function baseCandidates(field) {
    const cacheKey = JSON.stringify({
      domain: field.domain || "",
      deviceClasses: field.deviceClasses || [],
      hints: field.hints || []
    });
    if (!entityCandidateCache.has(cacheKey)) {
      entityCandidateCache.set(cacheKey, BeastEntityPicker.candidates({
        domain: field.domain,
        deviceClasses: field.deviceClasses,
        keywordHints: field.hints
      }));
    }
    return entityCandidateCache.get(cacheKey).slice();
  }

  function deviceSearchText(device) {
    const entityText = BeastRegistry.getDeviceEntityIds(device.id).map((id) => {
      const meta = BeastRegistry.getEntityMeta(id);
      return `${id} ${meta?.name || ""} ${meta?.originalName || ""} ${meta?.platform || ""}`;
    }).join(" ");
    return `${device.name || ""} ${device.manufacturer || ""} ${device.model || ""} ${entityText}`.toLowerCase();
  }

  function deviceCandidates(field, selectedId) {
    const hints = (field.deviceHints || []).map((hint) => hint.toLowerCase());
    const devices = BeastRegistry.getAllDevices().filter((device) => {
      const entityIds = BeastRegistry.getDeviceEntityIds(device.id);
      const hasExpectedDomain = (field.sourceDomains || []).some((domain) => entityIds.some((id) => id.startsWith(`${domain}.`)));
      return hasExpectedDomain;
    });
    return devices.map((device) => ({
      id: device.id,
      name: device.name || device.id,
      detail: [device.manufacturer, device.model].filter(Boolean).join(" · ") || "Home Assistant-enhed",
      likely: device.id === selectedId || hints.some((hint) => deviceSearchText(device).includes(hint))
    })).sort((a, b) => Number(b.likely) - Number(a.likely) || a.name.localeCompare(b.name, "da"));
  }

  function candidates(panel, field, current, selectedIds = []) {
    let list = baseCandidates(field);
    const implicitRelatedKeys = panel.id === "car" ? ["battery"] : (panel.id === "printer" ? ["statusSensor"] : []);
    const relatedEntityIds = [...new Set([...(field.relatedTo || []), ...implicitRelatedKeys])].flatMap((key) => {
      const value = current[key];
      return Array.isArray(value) ? value : [value];
    }).filter(Boolean);
    const relatedDeviceIds = new Set(relatedEntityIds.map((id) => BeastRegistry.getEntityMeta(id)?.deviceId).filter(Boolean));
    if (current.sourceDevice && field.key !== "sourceDevice") relatedDeviceIds.add(current.sourceDevice);
    if (relatedDeviceIds.size) {
      list = list.filter((item) => relatedDeviceIds.has(BeastRegistry.getEntityMeta(item.id)?.deviceId));
    }
    if (field.filterHints && field.hints?.length) {
      const hints = field.hints.map((hint) => hint.toLowerCase());
      list = list.filter((item) => {
        const meta = BeastRegistry.getEntityMeta(item.id);
        const text = `${item.id} ${item.name} ${meta?.name || ""} ${meta?.originalName || ""} ${meta?.platform || ""}`.toLowerCase();
        return hints.some((hint) => text.includes(hint));
      });
    }
    const seen = new Set(list.map((item) => item.id));
    selectedIds.filter(Boolean).forEach((id) => {
      if (!seen.has(id)) list.unshift({ id, name: BeastEntityPicker.friendlyName(id), score: 99 });
    });
    return list;
  }

  function entityDeviceScope(panel, field, selectedIds = []) {
    if (!field.domain || !["single", "multi"].includes(field.type) || panel.fields.some((item) => item.type === "device")) return null;
    const base = baseCandidates(field);
    const eligibleIds = new Set(base.map((item) => item.id));
    const devices = BeastRegistry.getAllDevices().filter((device) =>
      BeastRegistry.getDeviceEntityIds(device.id).some((entityId) => eligibleIds.has(entityId))
    );
    if (!devices.length) return null;
    const selectedDeviceIds = new Set(selectedIds.map((id) => BeastRegistry.getEntityMeta(id)?.deviceId).filter(Boolean));
    const selectedDeviceId = selectedDeviceIds.size === 1 ? Array.from(selectedDeviceIds)[0] : "";
    return { devices, selectedDeviceId };
  }

  function renderEntityDeviceScope(fieldElId, scope) {
    if (!scope) return "";
    const selectId = `${fieldElId}_device_scope`;
    return `<div class="admin-entity-device-scope">
      <input class="admin-filter" type="search" placeholder="Søg efter HA-enhed…" data-filter-entity-device="${selectId}">
      <select id="${selectId}" data-entity-device-scope="${fieldElId}">
        <option value="">Alle enheder</option>
        ${scope.devices.map((device) => `<option value="${escapeHtml(device.id)}" data-search="${escapeHtml(deviceSearchText(device))}"${device.id === scope.selectedDeviceId ? " selected" : ""}>${escapeHtml(device.name)}${device.model ? ` — ${escapeHtml(device.model)}` : ""}</option>`).join("")}
      </select>
      <small>Entity-listen nedenfor begrænses til den valgte enhed.</small>
    </div>`;
  }

  function scopedEntityItems(fieldElId, deviceId) {
    const base = entityFieldBaseSources.get(fieldElId) || [];
    if (!deviceId) return base.slice();
    return base.filter((item) => BeastRegistry.getEntityMeta(item.id)?.deviceId === deviceId);
  }

  function renderCheckList(panel, field, selectedIds, items) {
    const id = fieldId(panel.id, field.key);
    checkListSources.set(id, items);
    if (!checkListSelections.has(id)) checkListSelections.set(id, new Set(selectedIds));
    return `
      <input class="admin-filter" type="search" placeholder="Søg…" data-filter-list="${id}">
      <div class="admin-check-list" id="${id}">
        ${renderCheckListRows(id)}
      </div>`;
  }

  function renderCheckListRows(id, query = "") {
    const items = checkListSources.get(id) || [];
    const selected = checkListSelections.get(id) || new Set();
    const normalizedQuery = query.trim().toLowerCase();
    const matches = normalizedQuery
      ? items.filter((item) => `${item.name} ${item.id}`.toLowerCase().includes(normalizedQuery))
      : items;
    const visible = [];
    const added = new Set();
    items.filter((item) => selected.has(item.id)).forEach((item) => {
      if (!normalizedQuery || `${item.name} ${item.id}`.toLowerCase().includes(normalizedQuery)) {
        visible.push(item);
        added.add(item.id);
      }
    });
    matches.some((item) => {
      if (!added.has(item.id)) {
        visible.push(item);
        added.add(item.id);
      }
      return visible.length >= CHECK_LIST_RENDER_LIMIT;
    });
    if (!visible.length) return `<div class="admin-empty">Ingen matchende enheder fundet.</div>`;
    const rows = visible.map((item) => `
      <label class="admin-check" data-search="${escapeHtml(`${item.name} ${item.id}`.toLowerCase())}">
        <input type="checkbox" value="${escapeHtml(item.id)}"${selected.has(item.id) ? " checked" : ""}>
        <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.id)}</small></span>
      </label>`).join("");
    const remaining = Math.max(0, matches.length - visible.length);
    return `${rows}${remaining ? `<div class="admin-list-hint">Skriv i søgefeltet for at finde de øvrige ${remaining} entities.</div>` : ""}`;
  }

  function renderSelectOptions(id, selected, query = "") {
    const items = selectSources.get(id) || [];
    const normalizedQuery = query.trim().toLowerCase();
    const matches = normalizedQuery
      ? items.filter((item) => `${item.name} ${item.id}`.toLowerCase().includes(normalizedQuery))
      : items;
    const visible = matches.slice(0, CHECK_LIST_RENDER_LIMIT);
    if (selected && !visible.some((item) => item.id === selected)) {
      const selectedItem = items.find((item) => item.id === selected);
      if (selectedItem) visible.unshift(selectedItem);
    }
    return `<option value=""${selected ? "" : " selected"}>— Ikke valgt —</option>${visible.map((item) =>
      `<option value="${escapeHtml(item.id)}"${item.id === selected ? " selected" : ""}>${escapeHtml(item.name)} — ${escapeHtml(item.id)}</option>`
    ).join("")}`;
  }

  function entityPreviewHtml(id, entityId) {
    if (BeastConfig.get("features.adminPreview") !== true) return "";
    const state = entityId ? BeastHaSocket.getState(entityId) : null;
    const unavailable = !state || ["unknown", "unavailable"].includes(state.state);
    const updated = state ? new Date(state.last_updated || state.last_changed || 0) : null;
    return `<div class="admin-entity-preview" data-entity-preview="${id}" data-quality="${unavailable ? "unavailable" : "live"}"><span>${unavailable ? "Ingen live data" : "Live"}</span><strong>${escapeHtml(state?.attributes?.friendly_name || entityId || "Ikke valgt")}</strong><small>${escapeHtml(state ? stateValue(entityId) : "Vælg en entity for at se den her")}${updated && !Number.isNaN(updated.getTime()) ? ` · ${updated.toLocaleTimeString("da-DK", {hour:"2-digit",minute:"2-digit"})}` : ""}</small></div>`;
  }

  function updateEntityPreview(id, entityId) {
    const current = document.querySelector(`[data-entity-preview="${id}"]`);
    if (current) current.outerHTML = entityPreviewHtml(id, entityId);
  }

  function groupRowHtml(fieldElId, index, group, dynamic = false) {
    const rowId = dynamic ? `${fieldElId}_new_${dynamicGroupRowSequence++}` : `${fieldElId}_${index}`;
    const ids = Array.isArray(group?.ids) ? group.ids : [];
    const sensors = baseCandidates({ domain: "sensor" });
    const seen = new Set(sensors.map((item) => item.id));
    ids.filter((sensorId) => !seen.has(sensorId)).forEach((sensorId) => sensors.unshift({ id: sensorId, name: BeastEntityPicker.friendlyName(sensorId) }));
    checkListSources.set(rowId, sensors);
    if (!checkListSelections.has(rowId)) checkListSelections.set(rowId, new Set(ids));
    return `
      <div class="admin-group-row" data-group-row data-selection-id="${rowId}">
        <div class="admin-group-row-head">
          <input type="text" class="admin-group-name" placeholder="Gruppenavn" value="${escapeHtml(group?.name || "")}">
          <button type="button" class="admin-group-remove" data-remove-group>Fjern gruppe</button>
        </div>
        <input class="admin-filter" type="search" placeholder="Søg…" data-filter-list="${rowId}">
        <div class="admin-check-list" id="${rowId}">
          ${renderCheckListRows(rowId)}
        </div>
      </div>`;
  }

  function renderField(panel, field, current) {
    const selected = current[field.key];
    if (field.type === "device") {
      const items = deviceCandidates(field, selected);
      return `
        <input class="admin-filter" type="search" placeholder="Søg efter enhed, producent eller integration…" data-filter-select="${fieldId(panel.id, field.key)}">
        <select id="${fieldId(panel.id, field.key)}" data-device-select size="${Math.min(8, Math.max(3, items.filter((item) => item.likely).length + 1))}">
          <option value=""${selected ? "" : " selected"}>— Vælg enhed —</option>
          ${items.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === selected ? " selected" : ""} data-likely="${item.likely}" data-search="${escapeHtml(`${item.name} ${item.detail}`.toLowerCase())}"${item.likely ? "" : " hidden"}>${escapeHtml(item.name)} — ${escapeHtml(item.detail)}</option>`).join("")}
        </select>
        <label class="admin-show-all"><input type="checkbox" data-show-all-devices="${fieldId(panel.id, field.key)}"> Vis alle HA-enheder, hvis den ikke blev fundet automatisk</label>`;
    }
    if (field.type === "text") {
      return `<input type="text" id="${fieldId(panel.id, field.key)}" value="${escapeHtml(selected || "")}" placeholder="${escapeHtml(field.placeholder || "")}">`;
    }
    if (field.type === "areas") {
      const ids = Array.isArray(selected) ? selected : [];
      const areas = BeastRegistry.getAllAreas().map((area) => ({ id: area.area_id, name: area.name || area.area_id }));
      return renderCheckList(panel, field, ids, areas);
    }
    if (field.type === "multi") {
      const ids = Array.isArray(selected) ? selected : [];
      const id = fieldId(panel.id, field.key);
      const scope = entityDeviceScope(panel, field, ids);
      const base = baseCandidates(field);
      const seen = new Set(base.map((item) => item.id));
      ids.filter(Boolean).forEach((entityId) => { if (!seen.has(entityId)) base.unshift({ id: entityId, name: BeastEntityPicker.friendlyName(entityId) }); });
      entityFieldBaseSources.set(id, base);
      const items = scope?.selectedDeviceId ? scopedEntityItems(id, scope.selectedDeviceId) : candidates(panel, field, current, ids);
      return `${renderEntityDeviceScope(id, scope)}${renderCheckList(panel, field, ids, items)}`;
    }
    if (field.type === "groups") {
      const groups = Array.isArray(selected) ? selected : [];
      const id = fieldId(panel.id, field.key);
      return `
        <div class="admin-groups" id="${id}" data-groups-field="${id}">
          ${groups.map((group, index) => groupRowHtml(id, index, group)).join("")}
        </div>
        <button type="button" class="admin-add-group" data-add-group="${id}">+ Tilføj gruppe</button>`;
    }
    const items = candidates(panel, field, current, selected ? [selected] : []);
    const id = fieldId(panel.id, field.key);
    const scope = entityDeviceScope(panel, field, selected ? [selected] : []);
    const base = baseCandidates(field);
    if (selected && !base.some((item) => item.id === selected)) base.unshift({ id: selected, name: BeastEntityPicker.friendlyName(selected) });
    entityFieldBaseSources.set(id, base);
    const scopedItems = scope?.selectedDeviceId ? scopedEntityItems(id, scope.selectedDeviceId) : items;
    selectSources.set(id, scopedItems);
    return `
      ${renderEntityDeviceScope(id, scope)}
      <input class="admin-filter" type="search" placeholder="Søg i ${escapeHtml(field.label.toLowerCase())}…" data-filter-select="${id}">
      <select id="${id}" size="8">
        ${renderSelectOptions(id, selected)}
      </select>${entityPreviewHtml(id, selected)}`;
  }

  function getMqttConfig() {
    try {
      return { target: "kiosk_8400t", customPrefix: "homehub/buttons", payload: "PRESS", kioskName: "8400T kiosk", kioskPrefix: "kiosk_8400t", ...JSON.parse(localStorage.getItem(MQTT_CONFIG_KEY) || "{}") };
    } catch (error) {
      return { target: "kiosk_8400t", customPrefix: "homehub/buttons", payload: "PRESS", kioskName: "8400T kiosk", kioskPrefix: "kiosk_8400t" };
    }
  }

  function normalizePrefix(value) {
    const prefix = String(value || "kiosk_8400t").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    return prefix === "8400t_kiosk" ? "kiosk_8400t" : (prefix || "kiosk_8400t");
  }

  function getKioskIds() {
    const prefix = normalizePrefix(getMqttConfig().kioskPrefix);
    const configured = BeastConfig.get("appEntities.kioskEntities") || {};
    if (Object.keys(configured).length) return configured;
    const entity = (domain, suffix) => `${domain}.${prefix}_${suffix}`;
    return {
      reboot: entity("button", "reboot"), refresh: entity("button", "refresh"), shutdown: entity("button", "shutdown"),
      screenshotButton: entity("button", "screenshot"), display: entity("light", "display"), zoom: entity("number", "page_zoom"),
      volume: entity("number", "volume"), kiosk: entity("select", "kiosk"), theme: entity("select", "theme"),
      url: entity("text", "page_url"), heartbeat: entity("sensor", "heartbeat"), uptime: entity("sensor", "up_time"),
      cpu: entity("sensor", "processor_usage"), temperature: entity("sensor", "processor_temperature"),
      memory: entity("sensor", "memory_usage"), errors: entity("sensor", "errors"), upgrades: entity("sensor", "package_upgrades"),
      network: entity("sensor", "network_address"), model: entity("sensor", "model"), version: entity("sensor", "version"), host: entity("sensor", "host_name")
    };
  }

  function stateValue(entityId) {
    const state = BeastHaSocket.getState(entityId);
    if (!state || ["unknown", "unavailable"].includes(state.state)) return "–";
    return `${state.state}${state.attributes.unit_of_measurement ? ` ${state.attributes.unit_of_measurement}` : ""}`;
  }

  function callService(domain, service, data) {
    return BeastAuth.haFetch(`/api/services/${domain}/${service}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
    });
  }

  function mqttCommandAction(kind) {
    return { refresh: "refresh", hard: "hard-reload", chrome: "restart-chrome", shot: "screenshot", reboot: "reboot", shutdown: "shutdown" }[kind] || kind;
  }

  function publishDirectKioskCommand(kind) {
    return callService("mqtt", "publish", {
      topic: "dashboard/kiosk/command",
      payload: JSON.stringify({ action: mqttCommandAction(kind), source: "beast-admin", layout: "beast", url: window.location.href, timestamp: new Date().toISOString() }),
      qos: 0,
      retain: false
    });
  }

  async function checkMqttConnection() {
    if (mqttCheckRunning || currentConnState !== "connected" || navigator.onLine === false) return;
    mqttCheckRunning = true;
    try {
      await callService("mqtt", "publish", { topic: "dashboard/beast/status", payload: JSON.stringify({ state: "online", timestamp: new Date().toISOString() }), qos: 0, retain: true });
      currentMqttState = "connected";
    } catch (error) {
      currentMqttState = "connecting";
    } finally {
      mqttCheckRunning = false;
      updateMqttStatus();
    }
  }

  function updateMqttStatus() {
    const status = document.getElementById("adminMqttStatus");
    if (!status) return;
    status.innerHTML = `${BeastCore.icon(currentMqttState === "connected" ? "check" : "settings", { size: 14 })} ${currentMqttState === "connected" ? "MQTT live" : "Forbinder MQTT…"}`;
  }

  function startMqttWatchdog() {
    if (mqttWatchdogTimerId) return;
    mqttWatchdogTimerId = window.setInterval(checkMqttConnection, 30000);
    window.addEventListener("online", () => window.setTimeout(checkMqttConnection, 1000));
  }

  function buildSelectControl(label, entityId) {
    const state = BeastHaSocket.getState(entityId);
    const options = Array.isArray(state?.attributes?.options) ? state.attributes.options : [];
    return `<div class="beast-mqtt-control"><span>${label}</span><strong>${escapeHtml(stateValue(entityId))}</strong><div class="beast-mqtt-options">${options.map((option) => `<button type="button" data-kiosk-action="select" data-entity="${entityId}" data-value="${escapeHtml(option)}" class="${state?.state === option ? "is-active" : ""}">${escapeHtml(option)}</button>`).join("") || "<i>Ingen valg</i>"}</div></div>`;
  }

  function buildNumberControl(label, entityId, step = 5) {
    const state = BeastHaSocket.getState(entityId);
    return `<div class="beast-mqtt-control"><span>${label}</span><strong>${escapeHtml(stateValue(entityId))}</strong><div class="beast-mqtt-stepper"><button type="button" data-kiosk-action="number" data-entity="${entityId}" data-delta="-${step}">−</button><button type="button" data-kiosk-action="number" data-entity="${entityId}" data-delta="${step}">+</button></div></div>`;
  }

  function renderMqttPanel() {
    const config = getMqttConfig();
    const ids = getKioskIds();
    const commands = [
      [ids.refresh, "Refresh", "refresh"], [ids.hardReload, "Hard reload", "hard"], [ids.restartChrome, "Genstart Chrome", "chrome"],
      [ids.screenshotButton, "Screenshot", "shot"], [ids.reboot, "Genstart kiosk", "reboot"], [ids.shutdown, "Luk kiosk", "shutdown"]
    ].filter(([entityId]) => entityId);
    const metrics = [
      ["Heartbeat", ids.heartbeat], ["Uptime", ids.uptime], ["CPU", ids.cpu], ["Temperatur", ids.temperature],
      ["Hukommelse", ids.memory], ["Fejl", ids.errors], ["Opdateringer", ids.upgrades], ["Netværk", ids.network],
      ["Model", ids.model], ["Version", ids.version], ["Host", ids.host]
    ];
    return `
      <div class="beast-settings-section-head"><div><p class="beast-panel-title">MQTT & kioskstyring</p></div><span class="beast-mqtt-live" id="adminMqttStatus">${BeastCore.icon(currentMqttState === "connected" ? "check" : "settings", { size: 14 })} ${currentMqttState === "connected" ? "MQTT live" : "Forbinder MQTT…"}</span></div>
      <div class="beast-mqtt-config">
        <label><span>MQTT-mål</span><select id="beastMqttTarget">${MQTT_TARGETS.map((target) => `<option value="${target.id}" ${config.target === target.id ? "selected" : ""}>${target.label}</option>`).join("")}</select></label>
        <label><span>Custom topic-prefix</span><input id="beastMqttCustom" value="${escapeHtml(config.customPrefix)}"></label>
        <label><span>Standard-payload</span><input id="beastMqttPayload" value="${escapeHtml(config.payload)}"></label>
        <label><span>Kiosknavn</span><input id="beastKioskName" value="${escapeHtml(config.kioskName)}"></label>
        <label><span>Kiosk entity-prefix</span><input id="beastKioskPrefix" value="${escapeHtml(config.kioskPrefix)}"></label>
        <button type="button" class="beast-btn beast-btn-primary" id="beastMqttSave">Gem MQTT</button>
        <button type="button" class="beast-btn" id="beastMqttTest">Send test</button>
      </div>
      <div class="beast-mqtt-device-head"><div><strong>${escapeHtml(config.kioskName)}</strong><span>${escapeHtml(config.kioskPrefix)}</span></div><button type="button" class="beast-mqtt-display ${["on"].includes(BeastHaSocket.getState(ids.display)?.state) ? "is-on" : ""}" data-kiosk-action="toggle" data-entity="${ids.display}">${BeastCore.icon("sun", { size: 17 })} Skærm</button></div>
      <div class="beast-mqtt-command-grid">${commands.map(([entityId, label, kind]) => {
        const entityState = BeastHaSocket.getState(entityId);
        const available = Boolean(entityState && !["unknown", "unavailable"].includes(entityState.state));
        return `<button type="button" data-kiosk-action="press" data-kind="${kind}" data-entity="${entityId}" data-entity-available="${available}" class="${kind === "shutdown" ? "is-danger" : ""}">${BeastCore.icon(kind === "shutdown" ? "close" : "settings", { size: 18 })}<strong>${label}</strong><small>${available ? "HA-entitet" : "Direkte MQTT"}</small></button>`;
      }).join("")}</div>
      <div class="beast-mqtt-controls">${buildNumberControl("Zoom", ids.zoom)}${buildNumberControl("Lyd", ids.volume)}${buildSelectControl("Kiosktilstand", ids.kiosk)}${buildSelectControl("Tema", ids.theme)}</div>
      <div class="beast-mqtt-url"><span>Sideadresse</span><code>${escapeHtml(stateValue(ids.url))}</code><button type="button" data-kiosk-action="url" data-entity="${ids.url}" data-value="${escapeHtml(new URL("/beast.html", window.location.origin).href)}">Åbn Beast</button></div>
      <div class="beast-mqtt-metrics">${metrics.map(([label, entityId]) => `<div><span>${label}</span><strong>${escapeHtml(stateValue(entityId))}</strong></div>`).join("")}</div>
      <p class="beast-mqtt-feedback" id="beastMqttFeedback"></p>
    `;
  }

  function renderThemePanel() {
    const theme = window.BeastTheme?.getSettings() || { mode: "auto", palette: "aurora", resolved: "dark" };
    const modes = [
      ["auto", "settings", "Auto", "Følger skærmen"],
      ["light", "sun", "Lys", "Lyst og tydeligt"],
      ["dark", "moon", "Mørk", "Behageligt om aftenen"]
    ];
    const palettes = [
      ["aurora", "Aurora", "Violet · cyan"],
      ["ocean", "Ocean", "Blå · turkis"],
      ["ember", "Ember", "Orange · pink"],
      ["sage", "Salvie", "Rolig grøn · hav"],
      ["sand", "Sand", "Varm beige · kobber"],
      ["slate", "Skifer", "Neutral blågrå"]
    ];
    return `
      <section class="beast-theme-settings" aria-label="Udseende">
        <div class="beast-settings-section-head">
          <div><p class="beast-panel-title">Udseende</p><span>Tilpas skærmen uden genindlæsning</span></div>
          <span class="beast-theme-current">${theme.mode === "auto" ? `Auto · ${theme.resolved === "light" ? "lys" : "mørk"}` : theme.mode === "light" ? "Lys" : "Mørk"}</span>
        </div>
        <div class="beast-theme-mode-grid">
          ${modes.map(([id, icon, title, subtitle]) => `<button type="button" data-theme-mode="${id}" class="${theme.mode === id ? "is-active" : ""}" aria-pressed="${theme.mode === id}">
            ${BeastCore.icon(icon, { size: 22 })}<span><strong>${title}</strong><small>${subtitle}</small></span>
          </button>`).join("")}
        </div>
        <div class="beast-theme-palette-grid">
          ${palettes.map(([id, title, subtitle]) => `<button type="button" data-theme-palette="${id}" class="${theme.palette === id ? "is-active" : ""}" aria-pressed="${theme.palette === id}">
            <i class="beast-theme-swatch is-${id}"></i><span><strong>${title}</strong><small>${subtitle}</small></span>${theme.palette === id ? BeastCore.icon("check", { size: 18 }) : ""}
          </button>`).join("")}
        </div>
        <label class="beast-theme-opacity">
          <span class="beast-theme-opacity-icon">${BeastCore.icon("grid", { size: 21 })}</span>
          <span><strong>Store kortområder</strong><small>0 % fjerner rammerne, mens knapper og styring bevares</small></span>
          <input type="range" id="beastThemeOpacity" min="0" max="100" step="1" value="${theme.cardOpacity ?? 92}">
          <output id="beastThemeOpacityValue">${theme.cardOpacity ?? 92}%</output>
        </label>
      </section>
    `;
  }

  async function handleKioskAction(button) {
    const action = button.dataset.kioskAction;
    const entityId = button.dataset.entity;
    const kind = button.dataset.kind || action;
    const feedback = document.getElementById("beastMqttFeedback");
    if (["shutdown", "reboot"].includes(kind) && pendingKioskAction !== `${kind}:${entityId}`) {
      pendingKioskAction = `${kind}:${entityId}`;
      if (feedback) feedback.textContent = `Tryk igen for at bekræfte ${kind === "shutdown" ? "nedlukning" : "genstart"}.`;
      window.setTimeout(() => { pendingKioskAction = null; }, 3500);
      return;
    }
    pendingKioskAction = null;
    button.disabled = true;
    try {
      if (action === "press") {
        if (button.dataset.entityAvailable === "true") {
          try {
            await callService("button", "press", { entity_id: entityId });
            if (feedback) feedback.textContent = `Kommando sendt via ${entityId}.`;
          } catch (error) {
            await publishDirectKioskCommand(kind);
            if (feedback) feedback.textContent = "HA-entiteten fejlede – kommando sendt direkte via MQTT.";
          }
        } else {
          await publishDirectKioskCommand(kind);
          if (feedback) feedback.textContent = "Kommando sendt direkte til dashboard/kiosk/command.";
        }
      } else if (action === "toggle") {
        const domain = entityId.split(".")[0] === "switch" ? "switch" : "light";
        await callService(domain, "toggle", { entity_id: entityId });
      } else if (action === "select") {
        await callService("select", "select_option", { entity_id: entityId, option: button.dataset.value });
      } else if (action === "number") {
        const state = BeastHaSocket.getState(entityId);
        const current = Number(state?.state);
        const delta = Number(button.dataset.delta);
        const min = Number(state?.attributes?.min);
        const max = Number(state?.attributes?.max);
        const raw = (Number.isFinite(current) ? current : 0) + delta;
        const value = Math.min(Number.isFinite(max) ? max : raw, Math.max(Number.isFinite(min) ? min : raw, raw));
        await callService("number", "set_value", { entity_id: entityId, value });
      } else if (action === "url") {
        await callService("text", "set_value", { entity_id: entityId, value: button.dataset.value });
      }
      if (feedback && action !== "press") feedback.textContent = "Kommando sendt.";
      window.setTimeout(renderShell, 450);
    } catch (error) {
      if (feedback) feedback.textContent = `Kommando fejlede: ${error.message}`;
      button.disabled = false;
    }
  }

  function renderPanel(panel) {
    const current = BeastConfig.get(`panels.${panel.id}`) || {};
    return `
      <section class="admin-view${activeView === panel.id ? " is-active" : ""}" data-admin-view="${panel.id}">
        <div class="admin-card">
          <div class="admin-card-head"><div><h2>${escapeHtml(panel.title)}</h2><p>${escapeHtml(panel.description)}</p></div></div>
          ${panel.fields.some((field) => field.type === "device") ? `<div class="admin-scope-banner">Vælg først den konkrete enhed og gem. Derefter viser felterne kun entities, som HA har knyttet til den valgte enhed.</div>` : ""}
          <div class="admin-grid">
            ${panel.fields.map((field) => `<div class="admin-field"><span>${escapeHtml(field.label)}</span>${renderField(panel, field, current)}</div>`).join("")}
          </div>
          <div class="admin-actions"><button class="admin-save" type="button" data-save-panel="${panel.id}">Gem ${escapeHtml(panel.title)}</button><span class="admin-save-state" data-save-state="${panel.id}"></span></div>
        </div>
      </section>`;
  }

  function renderOverview() {
    const hidden = BeastLocalSettings.get("hiddenSections", BeastConfig.get("hiddenSections") || []);
    const entityCount = BeastHaSocket.getAllStates().size;
    const configured = PANELS.filter((panel) => BeastConfig.isPanelConfigured(panel.id)).length;
    return `
      <section class="admin-view${activeView === "overview" ? " is-active" : ""}" data-admin-view="overview">
        <div class="admin-summary">
          <div><strong>${entityCount}</strong><span>entities hentet fra Home Assistant</span></div>
          <div><strong>${configured}/${PANELS.length}</strong><span>standardsider konfigureret</span></div>
          <div><strong>${PAGES.length - hidden.length}</strong><span>sider synlige i dashboardet</span></div>
        </div>
        <div class="admin-card admin-project-intro">
          <div class="admin-project-heading">
            <img src="/assets/ha-smartdash-logo.svg" alt="HA Smartdash">
            <div><h2>Om HA Smartdash</h2><p>Et lokalt, konfigurationsdrevet kiosk-dashboard til Home Assistant, oprindeligt bygget til en privat installation og udviklet med hjælp fra AI.</p></div>
          </div>
          <div class="admin-project-grid">
            <article><strong>Byg dit dashboard</strong><p>Vælg relevante HA-enheder, skjul sider, tilpas forsiden og brug samme design med både få og mange entities.</p></article>
            <article><strong>Let kioskvisning</strong><p>På mange kiosk-pc’er og tablets vil HA Smartdash opleves hurtigere og bruge færre ressourcer end Home Assistants fulde brugerflade. Dashboardet henter entity-listen én gang, cacher den lokalt og undgår unødvendige genindlæsninger.</p></article>
            <article><strong>Lokalt og privat</strong><p>Ingen HA Smartdash-cloud, tracking eller telemetri. Opsætningen ligger på din egen server, mens maskinspecifikke valg gemmes i browseren.</p></article>
            <article><strong>Backup og opdatering</strong><p>Eksportér en installationsprofil, opdatér programfilerne og gendan opsætningen uden at lægge tokens eller loginoplysninger i backupfilen.</p></article>
            <article><strong>Et personligt projekt</strong><p>Projektet leveres uden garanti for alle HA-installationer. Andre er velkomne til at tilpasse, fejlrette og bygge videre på det.</p></article>
          </div>
          <details class="admin-project-details"><summary>Vigtig information</summary><p>HA Smartdash kommunikerer med den Home Assistant-installation, du selv vælger. Eksterne kameraer, vejrkort, mediekilder og HA-integrationer kan bruge internettet, hvis du konfigurerer dem til det. Projektets fulde installations-, sikkerheds- og privatlivsbeskrivelse følger med i GitHub-pakkens README.</p></details>
        </div>
        <div class="admin-card">
          <div class="admin-card-head"><div><h2>Entity-cache</h2><p>Listen hentes én gang, når siden åbnes, og genbruges derefter lokalt. Brug kun knappen, når der er tilføjet, fjernet eller omdøbt entities i Home Assistant.</p></div></div>
          <div class="admin-actions"><button class="admin-save" type="button" data-refresh-entities>Opdatér entities fra HA</button><button type="button" class="beast-btn" data-refresh-browser>Genindlæs admin i browseren</button><span class="admin-save-state" data-refresh-entities-state></span></div>
        </div>
      </section>`;
  }


  function renderSetupOverview() {
    const hidden = BeastLocalSettings.get("hiddenSections", BeastConfig.get("hiddenSections") || []);
    return `
      <section class="admin-view${activeView === "setup" ? " is-active" : ""}" data-admin-view="setup">
        <div class="admin-card">
          <div class="admin-card-head"><div><h2>Navn & browserikon</h2><p>Tilpas teksten og ikonet, der vises i browserfanen.</p></div></div>
          <div class="admin-branding-grid">
            <label class="admin-field"><span>Home Assistant-adresse</span><input type="url" id="adminHaBaseUrl" value="${escapeHtml(BeastConfig.get("haBaseUrl") || BeastAuth.getHaBaseUrl() || "")}" placeholder="http://homeassistant.local:8123"></label>
            <label class="admin-field"><span>Tekst i browserfanen</span><input type="text" id="adminDashboardTitle" value="${escapeHtml(BeastConfig.get("dashboardTitle") || "HA Smartdash")}"></label>
            <label class="admin-field"><span>Favicon-adresse</span><input type="text" id="adminFaviconUrl" value="${escapeHtml(BeastConfig.get("faviconUrl") || "./favicon.svg")}" placeholder="./favicon.svg eller https://…"></label>
            <label class="admin-field admin-favicon-upload"><span>Vælg favicon-fil</span><input type="file" id="adminFaviconFile" accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/webp"><small>PNG, SVG, ICO eller WebP · højst 256 KB</small></label>
            <div class="admin-favicon-preview"><img id="adminFaviconPreview" src="${escapeHtml(BeastConfig.get("faviconUrl") || "./favicon.svg")}" alt="Forhåndsvisning"><span>Forhåndsvisning</span></div>
          </div>
          <div class="admin-actions"><button class="admin-save" type="button" data-save-title>Gem browserfane</button><span class="admin-save-state" data-save-state="title"></span></div>
        </div>
        <div class="admin-card">
          <div class="admin-card-head"><div><h2>Synlige sider</h2><p>Gemmes lokalt på denne maskine, så hver skærm kan have sin egen navigation.</p></div></div>
          <div class="admin-page-grid">${PAGES.map(([id, label]) => `<label class="admin-page-toggle"><input type="checkbox" data-page="${id}"${hidden.includes(id) ? "" : " checked"}><span>${escapeHtml(label)}</span></label>`).join("")}</div>
          <div class="admin-actions"><button class="admin-save" type="button" data-save-pages>Gem synlige sider</button><span class="admin-save-state" data-save-state="pages"></span></div>
        </div>
        ${renderOverviewBuilder()}
        ${renderFeaturePanel()}
        <div class="admin-card">
          <div class="admin-card-head"><div><h2>Kiosk & dørklokke</h2><p>Valgfrit — styrer skærm-sluk om natten og et automatisk dørkamera-overlay.</p></div></div>
          <div class="admin-grid">
            <label class="admin-field"><span>Kiosk-skærm (lokal på denne maskine)</span>${BeastEntityPicker.selectHtml({ id: "adminKioskLight", domain: "light", keywordHints: ["kiosk", "screen", "skaerm", "tablet"], selected: BeastLocalSettings.get("kioskScreenLight", BeastConfig.get("appEntities.kioskScreenLight")) })}</label>
            <label class="admin-field"><span>Dørklokke (binary_sensor)</span>${BeastEntityPicker.selectHtml({ id: "adminDoorbellBinary", domain: "binary_sensor", keywordHints: ["doorbell", "dørklokke", "ring"], selected: BeastConfig.get("appEntities.doorbellBinarySensor") })}</label>
            <label class="admin-field"><span>Dørklokke (event, valgfri)</span>${BeastEntityPicker.selectHtml({ id: "adminDoorbellEvent", domain: "event", keywordHints: ["doorbell", "dørklokke", "ring"], selected: BeastConfig.get("appEntities.doorbellEvent") })}</label>
            <label class="admin-field"><span>Dørkamera (valgfri)</span>${BeastEntityPicker.selectHtml({ id: "adminDoorbellCamera", domain: "camera", keywordHints: ["doorbell", "dørklokke", "front", "hoveddor", "fordor"], selected: BeastConfig.get("appEntities.doorbellCamera") })}</label>
            <label class="admin-field"><span>Post registreret (valgfri)</span>${BeastEntityPicker.selectHtml({ id: "adminMailPresent", domain: "input_boolean", keywordHints: ["post", "mail"], selected: BeastConfig.get("appEntities.mailPresent") })}</label>
            <label class="admin-field"><span>Antal post (valgfri)</span>${BeastEntityPicker.selectHtml({ id: "adminMailCount", domain: "sensor", keywordHints: ["post", "mail"], selected: BeastConfig.get("appEntities.mailCount") })}</label>
            <label class="admin-field"><span>Postbeskrivelse (valgfri)</span>${BeastEntityPicker.selectHtml({ id: "adminMailDescription", domain: "sensor", keywordHints: ["post", "mail"], selected: BeastConfig.get("appEntities.mailDescription") })}</label>
          </div>
          <div class="admin-actions"><button class="admin-save" type="button" data-save-app-entities>Gem kiosk & dørklokke</button><span class="admin-save-state" data-save-state="appEntities"></span></div>
        </div>
      </section>`;
  }

  function allOverviewEntities() {
    return Array.from(BeastHaSocket.getAllStates().values()).map((state) => ({ id: state.entity_id, name: state.attributes?.friendly_name || state.entity_id })).sort((a,b) => a.name.localeCompare(b.name,"da"));
  }

  function renderOverviewBuilder() {
    const allEntities = allOverviewEntities();
    const legacy = BeastConfig.get("overviewSlots") || {};
    const legacySizes = { main:[4,2], compactTop:[3,1], compactBottom:[3,1], wideTop:[5,1], wideBottom:[5,1] };
    const cards = (BeastConfig.get("overviewCards") || []).length ? BeastConfig.get("overviewCards") : OVERVIEW_SLOTS.map(([key]) => ({ id:key, ...(legacy[key] || {type:"empty"}), desktop:{w:legacySizes[key][0],h:legacySizes[key][1]}, tablet:{w:key === "main" ? 2 : 1,h:1}, portrait:{w:1,h:1} })).filter((card) => card.type !== "empty");
    const sizeOptions = (selected,max) => Array.from({length:max},(_,i)=>`<option value="${i+1}"${Number(selected)===i+1?" selected":""}>${i+1}</option>`).join("");
    const row = (card,index) => {
        const key = card.id || `card_${index}`;
        const entitySelectId = `admin_overview_card_${key}_entity`;
        selectSources.set(entitySelectId, allEntities);
        entityFieldBaseSources.set(entitySelectId, allEntities);
        return `<div class="admin-overview-slot admin-overview-card-row" draggable="true" data-overview-card="${escapeHtml(key)}"><div class="admin-overview-row-head"><span class="admin-overview-drag-handle" data-overview-drag-handle aria-label="Træk for at flytte kort" title="Træk for at flytte">${BeastCore.icon("grip", { size: 18 })}</span><strong>Kort ${index+1}</strong><div class="admin-icon-actions"><button class="admin-icon-action" type="button" data-overview-move="up" aria-label="Flyt kort op" title="Flyt op">${BeastCore.icon("chevron-up", { size: 18 })}</button><button class="admin-icon-action" type="button" data-overview-move="down" aria-label="Flyt kort ned" title="Flyt ned">${BeastCore.icon("chevron-down", { size: 18 })}</button><button class="admin-icon-action is-danger" type="button" data-overview-remove aria-label="Fjern kort" title="Fjern kort">${BeastCore.icon("close", { size: 18 })}</button></div></div><label>Indhold<select data-overview-type>${OVERVIEW_SLOT_OPTIONS.filter(([value])=>value!=="empty").map(([value,name]) => `<option value="${value}"${card.type === value ? " selected" : ""}>${name}</option>`).join("")}</select></label><label>Titel<input type="text" data-overview-label value="${escapeHtml(card.label || "")}" placeholder="Valgfri titel"></label><div class="admin-overview-custom"${card.type === "custom" ? "" : " hidden"}><input class="admin-filter" type="search" placeholder="Søg efter entity…" data-filter-select="${entitySelectId}"><select id="${entitySelectId}" data-overview-entity size="5">${renderSelectOptions(entitySelectId, card.entity)}</select></div><div class="admin-overview-sizes"><fieldset><legend>Stor skærm · 12 kolonner</legend><label>Bredde<select data-size="desktop.w">${sizeOptions(card.desktop?.w || 4,12)}</select></label><label>Højde<select data-size="desktop.h">${sizeOptions(card.desktop?.h || 1,6)}</select></label></fieldset><fieldset><legend>Smal/tablet · 2 kolonner</legend><label>Bredde<select data-size="tablet.w">${sizeOptions(card.tablet?.w || 1,2)}</select></label><label>Højde<select data-size="tablet.h">${sizeOptions(card.tablet?.h || 1,4)}</select></label></fieldset><fieldset><legend>Lodret/mobil · 1 kolonne</legend><label>Højde<select data-size="portrait.h">${sizeOptions(card.portrait?.h || 1,4)}</select></label></fieldset></div></div>`;
      };
    return `<div class="admin-card"><div class="admin-card-head"><div><h2>Visuel forsidebygger</h2><p>Træk kortene for at flytte dem rundt. Skift indhold, titel og størrelse nedenfor — forhåndsvisningen opdateres med det samme.</p></div></div><div class="admin-overview-preview" id="adminOverviewPreview"></div><div class="admin-overview-builder" data-overview-card-list>${cards.map(row).join("")}</div><div class="admin-actions"><button type="button" class="beast-btn" data-add-overview-card>+ Tilføj kort</button><button class="admin-save" type="button" data-save-overview-cards>Gem og anvend forside</button><span class="admin-save-state" data-save-state="overviewCards"></span></div></div>`;
  }

  function renderFeaturePanel() {
    const features = BeastConfig.get("features") || {};
    return `<div class="admin-card">
      <div class="admin-card-head"><div><h2>Kioskfunktioner</h2><p>Hver udvidelse kan aktiveres eller deaktiveres uafhængigt.</p></div></div>
      <div class="admin-feature-grid">
        ${FEATURE_OPTIONS.map(([key, label, description]) => `<label class="admin-feature-toggle"><input type="checkbox" data-feature="${key}"${features[key] ? " checked" : ""}><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(description)}</small></span></label>`).join("")}
      </div>
      <div class="admin-actions"><button class="admin-save" type="button" data-save-features>Gem kioskfunktioner</button><span class="admin-save-state" data-save-state="features"></span></div>
      ${features.localFavorites ? renderLocalFavoriteSettings() : ""}
      ${features.quickScenarios ? renderScenarioSettings() : ""}
      ${features.configAudit ? `<div id="adminConfigAudit">${renderConfigAudit()}</div>` : ""}
    </div>`;
  }

  function collectOverviewCards() {
    return Array.from(document.querySelectorAll("[data-overview-card]")).map((row, index) => {
      const value = (path, fallback) => Number(row.querySelector(`[data-size="${path}"]`)?.value) || fallback;
      return {
        id: row.dataset.overviewCard || `card_${Date.now()}_${index}`,
        type: row.querySelector("[data-overview-type]")?.value || "custom",
        label: row.querySelector("[data-overview-label]")?.value.trim() || "",
        entity: row.querySelector("[data-overview-entity]")?.value || null,
        desktop: { w:value("desktop.w",4), h:value("desktop.h",1) },
        tablet: { w:value("tablet.w",1), h:value("tablet.h",1) },
        portrait: { w:1, h:value("portrait.h",1) }
      };
    });
  }

  function refreshOverviewPreview() {
    const previewEl = document.getElementById("adminOverviewPreview");
    if (!previewEl) return;
    const typeNames = new Map(OVERVIEW_SLOT_OPTIONS);
    const cards = collectOverviewCards();
    previewEl.innerHTML = cards.length ? `<div class="admin-overview-preview-grid">${cards.map((card) => `<div class="admin-overview-preview-card" style="grid-column: span ${Math.max(1, Math.min(12, card.desktop.w))}; grid-row: span ${Math.max(1, card.desktop.h)};"><strong>${escapeHtml(card.label || typeNames.get(card.type) || card.type)}</strong></div>`).join("")}</div>` : `<p class="admin-empty">Ingen kort endnu.</p>`;
  }

  function renderScenarioSettings() {
    const selected = BeastConfig.get("appEntities.quickScenes") || [];
    const panel = { id: "features" }, field = { key: "quickScenes", label: "Scenarier", type: "multi", domain: "scene" };
    return `<div class="admin-scenario-settings"><strong>Hurtigscenarier på dashboardet</strong><p>Vælg kun scenes, som er sikre at aktivere fra en kiosk.</p>${renderCheckList(panel, field, selected, baseCandidates(field))}</div>`;
  }

  function renderLocalFavoriteSettings() {
    const selected = BeastLocalSettings.get("favoriteSections", []);
    const selectedSet = new Set(selected);
    const orderedPages = [...PAGES].sort((a, b) => {
      const ai = selected.indexOf(a[0]), bi = selected.indexOf(b[0]);
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    });
    return `<div class="admin-local-favorites"><strong>Denne skærm</strong><div class="admin-grid">
      <label class="admin-field"><span>Standardfane</span><select id="adminDefaultSection">${[["overview","Oversigt"],...PAGES].map(([id,label]) => `<option value="${id}"${BeastLocalSettings.get("defaultSection","overview") === id ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label>
      <label class="admin-field"><span>Visningstæthed</span><select id="adminDensity"><option value="comfortable"${BeastLocalSettings.get("density","comfortable") === "comfortable" ? " selected" : ""}>Luftig</option><option value="compact"${BeastLocalSettings.get("density") === "compact" ? " selected" : ""}>Kompakt</option><option value="large"${BeastLocalSettings.get("density") === "large" ? " selected" : ""}>Store trykfelter</option></select></label>
    </div><div class="admin-favorite-list">${orderedPages.map(([id,label]) => `<label data-favorite-row="${id}"><input type="checkbox" data-favorite-section="${id}"${selectedSet.has(id) ? " checked" : ""}><span>${escapeHtml(label)}</span><button class="admin-icon-action" type="button" data-favorite-move="up" aria-label="Flyt ${escapeHtml(label)} op" title="Flyt op">${BeastCore.icon("chevron-up", { size: 16 })}</button><button class="admin-icon-action" type="button" data-favorite-move="down" aria-label="Flyt ${escapeHtml(label)} ned" title="Flyt ned">${BeastCore.icon("chevron-down", { size: 16 })}</button></label>`).join("")}</div><button type="button" class="admin-save" data-save-local-favorites>Gem denne skærm</button></div>`;
  }

  function renderConfigAudit() {
    const states = BeastHaSocket.getAllStates();
    const issues = [];
    const usage = new Map();
    PANELS.forEach((panel) => {
      const current = BeastConfig.get(`panels.${panel.id}`) || {};
      panel.fields.filter((field) => ["single", "multi"].includes(field.type)).forEach((field) => {
        const value = current[field.key];
        const ids = Array.isArray(value) ? value : (value ? [value] : []);
        ids.forEach((id) => {
          if (!usage.has(id)) usage.set(id, []);
          usage.get(id).push(`${panel.title} · ${field.label}`);
          const state = states.get(id);
          if (!state) issues.push({ level: "error", text: `${panel.title} · ${field.label}: ${id} findes ikke` });
          else if (!id.startsWith(`${field.domain}.`)) issues.push({ level: "error", text: `${panel.title} · ${field.label}: forkert entity-type` });
          else if (["unknown", "unavailable"].includes(state.state)) issues.push({ level: "warning", text: `${panel.title} · ${field.label}: ${id} er ${state.state}` });
        });
      });
    });
    usage.forEach((locations, id) => { if (locations.length > 1) issues.push({ level: "warning", text: `${id} bruges ${locations.length} steder: ${locations.join(", ")}` }); });
    return `<div class="admin-audit"><strong>Konfigurationskontrol</strong>${issues.length ? issues.slice(0, 40).map((issue) => `<p class="is-${issue.level}">${escapeHtml(issue.text)}</p>`).join("") : `<p class="is-ok">Ingen fejl fundet i de konfigurerede entity-felter.</p>`}</div>`;
  }

  function renderBackupView() {
    return `<section class="admin-view${activeView === "backup" ? " is-active" : ""}" data-admin-view="backup">
      <div class="admin-card"><div class="admin-card-head"><div><h2>Installationsprofil</h2><p>Profilen kan importeres i en frisk HA Smartdash-version fra GitHub. Den indeholder central opsætning og entity-valg — aldrig HA-login, tokens, pinkode eller lokale maskinvalg.</p></div></div>
        <div class="admin-backup-tools"><div><button type="button" data-export-config>Eksportér HA Smartdash-profil</button><label>Gendan HA Smartdash-profil<input type="file" accept="application/json,.json" data-import-backup></label></div><small>Brug denne før og efter en GitHub-opdatering.</small></div>
      </div>
      <div class="admin-card"><div class="admin-card-head"><div><h2>Denne skærm</h2><p>Separat kopi af lokale valg til netop denne browser eller kiosk.</p></div></div>
        <div class="admin-backup-tools"><div><button type="button" data-export-local>Eksportér lokale skærmvalg</button></div></div>
      </div>
      <div class="admin-card"><div class="admin-card-head"><div><h2>Automatisk backup og SMB</h2><p>Gem lokalt eller på en SMB-share, som værten har monteret under <code>/config/backup-targets/&lt;navn&gt;</code>. Skrivbare shares dukker automatisk op under Placering; SMB-brugernavn og adgangskode gemmes aldrig i dashboardet.</p></div></div>
        <div class="admin-grid"><label class="admin-field"><span>Automatisk backup</span><select id="adminBackupEnabled"><option value="0">Fra</option><option value="1">Til</option></select></label><label class="admin-field"><span>Interval</span><select id="adminBackupFrequency"><option value="daily">Dagligt</option><option value="weekly">Ugentligt</option></select></label><label class="admin-field"><span>Placering</span><select id="adminBackupTarget"><option value="local">Lokal backupmappe</option></select></label></div>
        <div class="admin-actions"><button class="admin-save" type="button" data-save-backup>Gem auto-backup</button><button type="button" data-run-backup>Lav backup nu</button><span class="admin-save-state" data-backup-state>Henter status…</span></div>
      </div>
      <div class="admin-card"><div class="admin-card-head"><div><h2>Gemte backups</h2><p>Backups fra både den lokale mappe og monterede SMB-shares kan hentes direkte herfra.</p></div><button type="button" class="beast-btn" data-reload-backups>Opdatér liste</button></div><div class="admin-backup-list" id="adminBackupList"><p class="admin-empty">Henter backups…</p></div></div>
      <div class="admin-card admin-smb-help"><div class="admin-card-head"><div><h2>Sådan tilføjes en SMB-share</h2><p>Montér netværksdrevet på serveren eller som et Docker-bind mount. Eksempel: <code>//NAS/Smartdash</code> → <code>/config/backup-targets/nas</code>. Genåbn derefter denne fane.</p></div></div><p>Det holder netværkslogin uden for browseren og gør backup kompatibel med Unraid, Docker og almindelig Linux. Den fulde vejledning findes i <code>deploy/SMB-BACKUP.md</code>.</p></div>
    </section>`;
  }

  function renderUpdatesView() {
    return `<section class="admin-view${activeView === "updates" ? " is-active" : ""}" data-admin-view="updates">
      <div class="admin-card"><div class="admin-card-head"><div><h2>Denne installation</h2><p>Versionen der kører lige nu, og hvad der senest er ændret.</p></div><button type="button" class="beast-btn" data-check-updates>Tjek for opdateringer</button></div>
        <div class="beast-stat-grid">${BeastCore.statTile({ icon: "sparkles", label: "Nuværende version", value: "Henter…", meta: "…", id: "adminCurrentVersionTile" })}</div>
        <div class="admin-update-status" id="adminUpdateStatus" data-state="checking"><span class="admin-update-status-dot"></span><span id="adminUpdateStatusText">Tjekker…</span></div>
        <div class="admin-changelog-list" id="adminChangelogList"><p class="admin-empty">Henter ændringslog…</p></div>
      </div>
      <div class="admin-card"><div class="admin-card-head"><div><h2>Versionshistorik</h2><p>Du kan altid installere den nyeste version, eller vælge en ældre at gendanne. Den nuværende version gemmes altid først, så det kan fortrydes.</p></div><button type="button" class="beast-btn" data-reload-versions>Opdatér liste</button></div>
        <div id="adminVersionSection">
          <div id="adminInstallLatest"><p class="admin-empty">Henter…</p></div>
          <div class="admin-old-versions">
            <span class="admin-field-label">Tidligere versioner</span>
            <div class="admin-old-versions-row">
              <select id="adminOldVersionSelect" disabled><option value="">Henter…</option></select>
              <button type="button" class="beast-btn" id="adminOldVersionRestoreBtn" data-rollback-version="" data-is-newer="false" data-is-latest="false" disabled>Gendan valgte version</button>
            </div>
          </div>
        </div>
        <div class="admin-progress-track" id="adminRollbackProgress" hidden><div class="admin-progress-fill" id="adminRollbackProgressFill"></div></div>
        <div class="admin-save-state" id="adminRollbackState"></div>
      </div>
    </section>`;
  }

  function formatVersionLabel(version) {
    const match = /^(\d{4})(\d{2})(\d{2})-(\d+)$/.exec(version || "");
    if (!match) return version || "—";
    const [, year, month, day, build] = match;
    return `${year}-${month}-${day} · build ${Number(build)}`;
  }

  function renderChangelogEntries(entries) {
    if (!entries.length) return `<p class="admin-empty">Ingen ændringslog fundet.</p>`;
    return entries.map((entry) => `
      <article class="admin-changelog-entry">
        <header><strong>${escapeHtml(entry.version)}</strong><span>${escapeHtml(entry.date || "")}</span></header>
        ${Array.isArray(entry.changes) && entry.changes.length ? `<ul>${entry.changes.map((change) => `<li>${escapeHtml(change)}</li>`).join("")}</ul>` : ""}
      </article>
    `).join("");
  }

  function setUpdateStatus(state, text) {
    const statusEl = document.getElementById("adminUpdateStatus");
    const textEl = document.getElementById("adminUpdateStatusText");
    if (statusEl) statusEl.dataset.state = state;
    if (textEl) textEl.textContent = text;
  }

  async function loadUpdatesSettings() {
    const tile = document.getElementById("adminCurrentVersionTile");
    const changelogEl = document.getElementById("adminChangelogList");
    const installLatestEl = document.getElementById("adminInstallLatest");
    const oldSelect = document.getElementById("adminOldVersionSelect");
    const oldRestoreBtn = document.getElementById("adminOldVersionRestoreBtn");
    if (!tile && !changelogEl && !installLatestEl) return;
    setUpdateStatus("checking", t("Tjekker…", "Checking…"));
    try {
      const [versionsRes, changelogRes] = await Promise.all([
        fetch("/api/versions.php", { cache: "no-store" }),
        fetch(`/changelog.json?_=${Date.now()}`, { cache: "no-store" })
      ]);
      if (!versionsRes.ok) throw new Error(`HTTP ${versionsRes.status}`);
      const versionsPayload = await versionsRes.json();
      const changelog = changelogRes.ok ? await changelogRes.json() : [];
      const current = versionsPayload.currentVersion || "ukendt";
      const valueEl = tile?.querySelector(".beast-stat-tile-value");
      const metaEl = tile?.querySelector(".beast-stat-tile-meta");
      if (valueEl) valueEl.textContent = formatVersionLabel(current);
      if (metaEl) metaEl.textContent = current;
      if (changelogEl) changelogEl.innerHTML = renderChangelogEntries(Array.isArray(changelog) ? changelog : []);
      if (installLatestEl || oldSelect) {
        const versions = versionsPayload.versions || [];
        const latestVersion = versions.length ? versions.map((item) => item.version).sort().at(-1) : null;
        const latestEntry = versions.find((item) => item.version === latestVersion);
        if (installLatestEl) {
          installLatestEl.innerHTML = (latestVersion && latestVersion !== current && latestEntry)
            ? `<div class="admin-install-latest"><div><strong>${t("Ny version klar", "New version ready")}</strong><span>${escapeHtml(formatVersionLabel(latestVersion))}</span>${latestEntry.changes?.length ? `<ul>${latestEntry.changes.slice(0, 4).map((change) => `<li>${escapeHtml(change)}</li>`).join("")}</ul>` : ""}</div><button type="button" class="beast-btn beast-btn-primary" data-rollback-version="${escapeHtml(latestVersion)}" data-is-newer="true" data-is-latest="true">${t("Installer ny version", "Install new version")}</button></div>`
            : `<p class="admin-empty">${t("Du kører den nyeste version.", "You're on the latest version.")}</p>`;
        }
        const oldVersions = versions.filter((item) => item.version !== current && item.version !== latestVersion);
        if (oldSelect) {
          oldSelect.disabled = !oldVersions.length;
          oldSelect.innerHTML = oldVersions.length
            ? oldVersions.map((item) => {
              const size = item.sizeKb < 1024 ? `${item.sizeKb} KB` : `${(item.sizeKb / 1024).toFixed(1)} MB`;
              return `<option value="${escapeHtml(item.version)}">${escapeHtml(formatVersionLabel(item.version))} · ${size}</option>`;
            }).join("")
            : `<option value="">${t("Ingen andre versioner gemt", "No other versions saved")}</option>`;
        }
        if (oldRestoreBtn) {
          oldRestoreBtn.disabled = !oldVersions.length;
          oldRestoreBtn.dataset.rollbackVersion = oldVersions.length ? oldVersions[0].version : "";
        }
      }
      if (!versionsPayload.hasCurrentSnapshot) {
        await fetch("/api/versions.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "snapshot" }) });
      }
      const newestVersion = Array.isArray(changelog) && changelog.length
        ? changelog.map((entry) => entry.version).sort().at(-1)
        : current;
      const checkedAt = new Date().toLocaleTimeString();
      if (newestVersion && newestVersion > current) {
        setUpdateStatus("outdated", t(`Ny version tilgængelig: ${newestVersion} · tjekket ${checkedAt}`, `New version available: ${newestVersion} · checked ${checkedAt}`));
      } else {
        setUpdateStatus("current", t(`Du kører den nyeste version · tjekket ${checkedAt}`, `You're on the latest version · checked ${checkedAt}`));
      }
    } catch (error) {
      if (changelogEl) changelogEl.innerHTML = `<p class="admin-empty">${t("Kunne ikke hente ændringslog.", "Could not load the changelog.")}</p>`;
      if (listEl) listEl.innerHTML = `<p class="admin-empty">${t("Kunne ikke hente versionshistorik.", "Could not load version history.")}</p>`;
      setUpdateStatus("error", t("Kunne ikke tjekke for opdateringer", "Could not check for updates"));
    }
  }

  async function rollbackToVersion(version) {
    const response = await fetch("/api/versions.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rollback", version }) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = filename; link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function portableProfile() {
    return { type: "ha-smartdash-profile", schemaVersion: 3, exportedAt: new Date().toISOString(), data: BeastConfig.getAll() };
  }

  async function loadBackupSettings() {
    const state = document.querySelector("[data-backup-state]");
    if (!state) return;
    try {
      const response = await fetch("/api/backup.php", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const settings = payload.settings || {};
      const target = document.getElementById("adminBackupTarget");
      target.innerHTML = (payload.targets || []).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)}</option>`).join("");
      document.getElementById("adminBackupEnabled").value = settings.enabled ? "1" : "0";
      document.getElementById("adminBackupFrequency").value = settings.frequency || "daily";
      target.value = settings.target || "local";
      state.textContent = settings.lastBackup ? `Seneste: ${new Date(settings.lastBackup).toLocaleString("da-DK")}` : "Ingen serverbackup endnu";
      const list = document.getElementById("adminBackupList");
      if (list) list.innerHTML = (payload.backups || []).length ? payload.backups.map((item) => {
        const size = item.size < 1024 ? `${item.size} B` : item.size < 1048576 ? `${Math.round(item.size / 1024)} KB` : `${(item.size / 1048576).toFixed(1)} MB`;
        const url = `/api/backup.php?action=download&target=${encodeURIComponent(item.target)}&file=${encodeURIComponent(item.filename)}`;
        return `<article><div><strong>${escapeHtml(item.filename)}</strong><span>${escapeHtml(item.targetLabel)} · ${escapeHtml(new Date(item.createdAt).toLocaleString("da-DK"))} · ${size}</span></div><a class="admin-save" href="${url}" download>Hent</a></article>`;
      }).join("") : `<p class="admin-empty">Der er ikke lavet nogen serverbackups endnu.</p>`;
    } catch (error) { state.textContent = "Backup-backend kunne ikke læses"; }
  }

  async function backupRequest(payload) {
    const response = await fetch("/api/backup.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function renderSettingsView() {
    const floatingPlayerOn = isFloatingPlayerEnabled();
    const screensaver = BeastLocalSettings.get("screensaver", BeastConfig.get("screensaver")) || { enabled: true, schedule: "custom", startTime: "23:00", endTime: "05:30", offAfterMinutes: 5 };
    return `
      <section class="admin-view${activeView === "settings" ? " is-active" : ""}" data-admin-view="settings">
        <div class="admin-settings-intro"><div><h2>Udseende & denne enhed</h2><p>Visuelle valg og maskinspecifik adfærd er opdelt nedenfor. De fleste valg gemmes kun i denne browser.</p></div></div>
        <div class="admin-card admin-settings-group admin-settings-theme">${renderThemePanel()}</div>
        <div class="admin-card admin-settings-group"><div class="admin-card-head"><div><h2>Dashboard på denne skærm</h2><p>Forbindelsesstatus og elementer, som kun påvirker den aktuelle kiosk eller browser.</p></div></div><div class="beast-stat-grid">
          ${BeastCore.statTile({ icon: "check", label: "HA-forbindelse", value: CONN_STATUS_LABELS[currentConnState] || currentConnState, id: "adminConnTile" })}
          ${BeastCore.statTile({ icon: "grid", label: "Entities i cache", value: String(BeastHaSocket.getAllStates().size), id: "adminCountTile" })}
          ${BeastCore.statTile({
            icon: "music", label: "Flydende afspiller", value: floatingPlayerOn ? "Vises på forsiden" : "Skjult",
            id: "adminFloatingPlayerTile",
            extra: `<div class="beast-stat-tile-actions"><button type="button" class="beast-security-action-btn${floatingPlayerOn ? " is-disarm" : ""}" id="adminFloatingPlayerBtn">${floatingPlayerOn ? "Slå fra" : "Slå til"}</button></div>`
          })}
        </div></div>
        <div class="admin-card admin-settings-group"><div class="admin-card-head"><div><h2>Pauseskærm</h2><p>Tilpas hvornår denne kiosk dæmpes, og hvornår skærmen slukkes helt.</p></div></div><div class="beast-mqtt-config">
          <label><span>Pauseskærm</span>
            <select id="adminScreensaverEnabled">
              <option value="1" ${screensaver.enabled ? "selected" : ""}>Til</option>
              <option value="0" ${!screensaver.enabled ? "selected" : ""}>Fra</option>
            </select>
          </label>
          <label><span>Tidsrum</span>
            <select id="adminScreensaverSchedule">
              <option value="custom" ${screensaver.schedule !== "always" ? "selected" : ""}>Bestemt tidsrum</option>
              <option value="always" ${screensaver.schedule === "always" ? "selected" : ""}>Altid</option>
            </select>
          </label>
          <label><span>Starttidspunkt</span><input type="time" id="adminScreensaverStart" value="${escapeHtml(screensaver.startTime || "23:00")}"></label>
          <label><span>Sluttidspunkt</span><input type="time" id="adminScreensaverEnd" value="${escapeHtml(screensaver.endTime || "05:30")}"></label>
          <label><span>Slukker helt efter (minutter)</span><input type="number" min="1" max="60" id="adminScreensaverOffAfter" value="${Number(screensaver.offAfterMinutes) || 5}"></label>
          <button type="button" class="beast-btn beast-btn-primary" id="adminScreensaverSave">Gem pauseskærm</button>
        </div></div>
        <div class="admin-card admin-settings-group"><div class="admin-card-head"><div><h2>Kioskintegration</h2><p>Avanceret MQTT-styring og enhedskommandoer. Kan ignoreres på almindelige tablets.</p></div></div>${renderMqttPanel()}</div>
        <div class="admin-card admin-settings-group admin-diagnostics"><div class="admin-card-head"><div><h2>Diagnostik og session</h2><p>Seneste lokale hændelser samt mulighed for at logge Home Assistant-sessionen ud.</p></div></div><details><summary>Vis teknisk log</summary><pre class="beast-debug-log" id="adminDebugLog"></pre></details><button type="button" class="beast-btn" id="adminLogout">Log ud</button></div>
      </section>
    `;
  }

  function renderSecurityView() {
    const hasPin = window.BeastScreenLock?.hasPin();
    const autoLockOn = window.BeastScreenLock?.isAutoLockEnabled();
    const showAdminButton = BeastConfig.get("showAdminButton") !== false;
    return `<section class="admin-view${activeView === "security-settings" ? " is-active" : ""}" data-admin-view="security-settings">
      <div class="admin-security-hero"><span>${BeastCore.icon("shield", { size: 30 })}</span><div><h2>Sikkerhed og adgang</h2><p>Administrér skærmlås, gendannelse og adgangen til adminpanelet samlet ét sted.</p></div></div>
      <div class="admin-card admin-settings-group"><div class="admin-card-head"><div><h2>Pinkode og skærmlås</h2><p>Pinkoden gemmes kun på denne maskine og følger ikke med centrale backups.</p></div></div><div class="beast-stat-grid">
        ${BeastCore.statTile({ icon:"lock", label:"Pinkode", value:hasPin ? "Aktiveret" : "Ikke oprettet", id:"adminPinTile", extra:`<div class="beast-stat-tile-actions"><button type="button" class="beast-security-action-btn" id="adminPinSet">${hasPin ? "Skift pinkode" : "Opret pinkode"}</button>${hasPin ? `<button type="button" class="beast-security-action-btn is-disarm" id="adminPinRemove">Fjern</button>` : ""}</div>` })}
        ${BeastCore.statTile({ icon:"shield", label:"Automatisk lås", value:autoLockOn ? "Til ved aktiveret alarm" : "Fra", id:"adminAutoLockTile", extra:`<div class="beast-stat-tile-actions"><button type="button" class="beast-security-action-btn${autoLockOn ? " is-disarm" : ""}" id="adminAutoLockBtn" ${hasPin ? "" : "disabled"}>${autoLockOn ? "Slå fra" : "Slå til"}</button></div>` })}
        ${BeastCore.statTile({ icon:"lock", label:"Lås denne skærm", value:hasPin ? "Klar" : "Kræver pinkode", id:"adminLockNowTile", extra:`<div class="beast-stat-tile-actions"><button type="button" class="beast-security-action-btn" id="adminLockNowBtn" ${hasPin ? "" : "disabled"}>Lås nu</button></div>` })}
      </div>${hasPin ? `<div class="admin-security-recovery"><div><strong>Glemt pinkode?</strong><p>Bekræft din identitet med en ny Home Assistant-login og opret derefter en ny kode.</p></div><button type="button" class="beast-security-action-btn" id="adminPinRecover">Nulstil med HA-login</button></div>` : ""}</div>
      <div class="admin-card admin-settings-group"><div class="admin-card-head"><div><h2>Adgang til administration</h2><p>Bestem om genvejen vises i dashboardet. Adminpanelet er altid tilgængeligt på <code>/admin/</code>.</p></div></div>
        <label class="admin-security-toggle"><span><strong>Vis Administration-knappen</strong><small>Skjul genvejen på kiosker, hvor almindelige brugere ikke skal se den.</small></span><input type="checkbox" id="adminShowAdminButton"${showAdminButton ? " checked" : ""}></label>
        <div class="admin-security-warning"${showAdminButton ? " hidden" : ""} id="adminHiddenAccessNote">Knappen er skjult. Åbn admin manuelt ved at skrive <strong>/admin/</strong> efter dashboardets adresse.</div>
        <div class="admin-actions"><button class="admin-save" type="button" data-save-admin-access>Gem adgangsindstilling</button><span class="admin-save-state" data-save-state="adminAccess"></span></div>
      </div></section>`;
  }

  function renderActiveView() {
    if (activeView === "overview") return renderOverview();
    if (activeView === "setup") return renderSetupOverview();
    if (activeView === "settings") return renderSettingsView();
    if (activeView === "security-settings") return renderSecurityView();
    if (activeView === "backup") return renderBackupView();
    if (activeView === "updates") return renderUpdatesView();
    const panel = PANELS.find((item) => item.id === activeView);
    return panel ? renderPanel(panel) : renderOverview();
  }

  function renderShell(options = {}) {
    const contentScrollTop = window.scrollY;
    const sidebarScrollTop = document.querySelector(".admin-nav")?.scrollTop || 0;
    const dashboardLanguage = BeastLocalSettings.get("language", "en");
    root.innerHTML = `
      <div class="admin-shell">
        <aside class="admin-sidebar">
          <div class="admin-brand"><img src="/assets/ha-smartdash-logo.svg" alt="HA Smartdash"><strong>Administration</strong></div>
          <nav class="admin-nav">
            <button class="${activeView === "overview" ? "is-active" : ""}" type="button" data-view="overview">Overblik</button>
            <p class="admin-nav-section">Opsætning</p>
            <button class="${activeView === "setup" ? "is-active" : ""}" type="button" data-view="setup">Grundindstillinger</button>
            ${PANELS.map((panel) => `<button class="${activeView === panel.id ? "is-active" : ""}" type="button" data-view="${panel.id}">${escapeHtml(panel.title)}</button>`).join("")}
            <p class="admin-nav-section">Indstillinger</p>
            <button class="${activeView === "settings" ? "is-active" : ""}" type="button" data-view="settings">Udseende & enhed</button>
            <button class="${activeView === "security-settings" ? "is-active" : ""}" type="button" data-view="security-settings">Adgang & pinkode</button>
            <button class="${activeView === "backup" ? "is-active" : ""}" type="button" data-view="backup">Backup & gendannelse</button>
            <button class="${activeView === "updates" ? "is-active" : ""}" type="button" data-view="updates">Opdatering</button>
          </nav>
          <div class="admin-sidebar-foot"><a class="admin-back" href="/">Åbn dashboard</a></div>
        </aside>
        <main class="admin-main">
          <header class="admin-topbar"><div><h1>${activeView === "updates" ? "Opdatering" : activeView === "backup" ? "Backup & gendannelse" : activeView === "security-settings" ? "Sikkerhed" : activeView === "settings" ? "Udseende & enhed" : activeView === "overview" ? "Overblik" : "Opsætning"}</h1><p>${activeView === "updates" ? "Se hvad der er nyt, og gendan en tidligere version om nødvendigt." : activeView === "security-settings" ? "Lokal adgang, pinkode og beskyttelse af adminpanelet." : "Konfigurationen gemmes centralt på serveren."}</p></div><div class="admin-topbar-tools"><label class="admin-language-picker"><span>${BeastCore.icon("globe", { size: 15 })}</span><select id="adminLanguageSelect" aria-label="Dashboard-sprog"><option value="en"${dashboardLanguage !== "da" ? " selected" : ""}>English</option><option value="da"${dashboardLanguage === "da" ? " selected" : ""}>Dansk</option></select></label><span class="admin-status" id="adminHaStatus" data-state="${connected ? "connected" : "connecting"}">${connected ? "Home Assistant forbundet" : "Forbinder til Home Assistant…"}</span></div></header>
          ${renderActiveView()}
        </main>
      </div>`;
    wireUi();
    window.requestAnimationFrame(() => {
      const nav = document.querySelector(".admin-nav");
      if (nav) nav.scrollTop = sidebarScrollTop;
      window.scrollTo({ top: options.resetContent ? 0 : contentScrollTop, behavior: "instant" });
    });
  }

  function collectPanel(panel) {
    const patch = {};
    panel.fields.forEach((field) => {
      const id = fieldId(panel.id, field.key);
      if (field.type === "multi" || field.type === "areas") {
        patch[field.key] = Array.from(checkListSelections.get(id) || []);
      } else if (field.type === "groups") {
        const container = document.getElementById(id);
        patch[field.key] = Array.from(container?.querySelectorAll("[data-group-row]") || [])
          .map((row) => ({
            name: row.querySelector(".admin-group-name").value.trim() || "Gruppe",
            ids: Array.from(checkListSelections.get(row.dataset.selectionId) || [])
          }))
          .filter((group) => group.ids.length);
      } else {
        patch[field.key] = document.getElementById(id)?.value.trim() || null;
      }
    });
    return patch;
  }

  async function save(button, stateKey, operation) {
    const state = document.querySelector(`[data-save-state="${stateKey}"]`);
    button.disabled = true;
    if (state) state.textContent = "Gemmer…";
    const result = await operation();
    button.disabled = false;
    if (result?.success === false) {
      if (state) state.textContent = "Kunne ikke gemme i backend";
      return;
    }
    if (state) state.textContent = "Gemt";
    window.setTimeout(() => { if (state) state.textContent = ""; }, 2200);
  }

  function wireUi() {
    document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
      activeView = button.dataset.view;
      hasUnsavedPanelChanges = false;
      renderShell({ resetContent: true });
    }));
    document.getElementById("adminLanguageSelect")?.addEventListener("change", (event) => {
      BeastLocalSettings.set("language", event.target.value);
    });
    if (activeView === "backup") loadBackupSettings();
    if (activeView === "updates") loadUpdatesSettings();
    document.querySelector("[data-reload-backups]")?.addEventListener("click", loadBackupSettings);
    document.querySelector("[data-reload-versions]")?.addEventListener("click", loadUpdatesSettings);
    document.querySelector("[data-check-updates]")?.addEventListener("click", loadUpdatesSettings);
    document.getElementById("adminOldVersionSelect")?.addEventListener("change", (event) => {
      const restoreBtn = document.getElementById("adminOldVersionRestoreBtn");
      if (restoreBtn) restoreBtn.dataset.rollbackVersion = event.target.value;
    });
    document.getElementById("adminVersionSection")?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-rollback-version]");
      if (!button) return;
      const version = button.dataset.rollbackVersion;
      if (!version) return;
      const isNewer = button.dataset.isNewer === "true";
      const isLatest = button.dataset.isLatest === "true";
      const stateEl = document.getElementById("adminRollbackState");
      const progressEl = document.getElementById("adminRollbackProgress");
      const fillEl = document.getElementById("adminRollbackProgressFill");
      const pendingText = isLatest ? t(`Installerer version ${version}…`, `Installing version ${version}…`) : isNewer ? t(`Opdaterer til version ${version}…`, `Updating to version ${version}…`) : t(`Gendanner version ${version}…`, `Restoring version ${version}…`);
      const successText = isLatest ? t(`✓ Version ${version} installeret`, `✓ Version ${version} installed`) : isNewer ? t(`✓ Opdateret til version ${version}`, `✓ Updated to version ${version}`) : t(`✓ Version ${version} gendannet`, `✓ Version ${version} restored`);
      const errorText = isLatest ? t(`Kunne ikke installere version ${version}`, `Could not install version ${version}`) : isNewer ? t(`Kunne ikke opdatere til version ${version}`, `Could not update to version ${version}`) : t(`Kunne ikke gendanne version ${version}`, `Could not restore version ${version}`);
      const confirmText = isLatest
        ? t(`Installer version ${version}?`, `Install version ${version}?`)
        : isNewer
        ? t(`Opdater til version ${version}?`, `Update to version ${version}?`)
        : t(`Gendan version ${version}? Den nuværende version gemmes automatisk først, så dette kan fortrydes.`, `Restore version ${version}? The current version is saved automatically first, so this can be undone.`);
      if (!window.confirm(confirmText)) return;
      document.querySelectorAll("[data-rollback-version]").forEach((btn) => { btn.disabled = true; });
      button.textContent = pendingText;
      if (progressEl && fillEl) {
        progressEl.hidden = false;
        progressEl.dataset.state = "pending";
        fillEl.style.width = "8%";
      }
      if (stateEl) { stateEl.dataset.state = "pending"; stateEl.textContent = pendingText; }
      // The file copy is fast but the PHP endpoint doesn't stream real
      // progress, so ease the bar toward 90% while the request is in
      // flight and only snap to 100% once it actually succeeds.
      let fakeProgress = 8;
      const progressTimer = window.setInterval(() => {
        fakeProgress = Math.min(90, fakeProgress + (90 - fakeProgress) * 0.25);
        if (fillEl) fillEl.style.width = `${fakeProgress}%`;
      }, 150);
      try {
        await rollbackToVersion(version);
        window.clearInterval(progressTimer);
        if (fillEl) fillEl.style.width = "100%";
        if (progressEl) progressEl.dataset.state = "success";
        if (stateEl) { stateEl.dataset.state = "success"; stateEl.textContent = successText; }
        window.setTimeout(() => {
          sessionStorage.setItem("beast_admin_return_view_v1", "updates");
          window.location.reload();
        }, 1800);
      } catch (error) {
        window.clearInterval(progressTimer);
        if (progressEl) { progressEl.hidden = true; progressEl.dataset.state = "error"; }
        document.querySelectorAll("[data-rollback-version]").forEach((btn) => { btn.disabled = false; });
        button.textContent = isLatest ? t("Installer ny version", "Install new version") : isNewer ? t("Opdater til denne version", "Update to this version") : t("Gendan denne version", "Restore this version");
        if (stateEl) { stateEl.dataset.state = "error"; stateEl.textContent = `${errorText}: ${error.message}`; }
      }
    });
    document.querySelector("[data-refresh-browser]")?.addEventListener("click", () => window.location.reload());
    document.querySelectorAll("[data-filter-select]").forEach((input) => input.addEventListener("input", () => {
      const select = document.getElementById(input.dataset.filterSelect);
      const query = input.value.trim().toLowerCase();
      if (selectSources.has(select.id)) {
        const selected = select.value;
        select.innerHTML = renderSelectOptions(select.id, selected, query);
        return;
      }
      Array.from(select.options).forEach((option, index) => {
        if (!index) return;
        const outsideSearch = Boolean(query && !option.dataset.search.includes(query));
        const outsideLikely = select.hasAttribute("data-device-select") && select.dataset.showAll !== "true" && option.dataset.likely !== "true";
        option.hidden = outsideSearch || outsideLikely;
      });
    }));
    document.querySelectorAll("select[id]").forEach((select) => select.addEventListener("change", () => updateEntityPreview(select.id, select.value)));
    document.querySelectorAll("[data-overview-type]").forEach((select) => select.addEventListener("change", () => { const custom = select.closest("[data-overview-card]").querySelector(".admin-overview-custom"); custom.hidden = select.value !== "custom"; }));
    document.querySelectorAll("[data-filter-overview-device]").forEach((input) => input.addEventListener("input", () => { const select = document.getElementById(input.dataset.filterOverviewDevice), query = input.value.trim().toLowerCase(); Array.from(select.options).forEach((option,index) => { option.hidden = Boolean(index && query && !option.dataset.search.includes(query)); }); }));
    document.querySelectorAll("[data-overview-device]").forEach((deviceSelect) => deviceSelect.addEventListener("change", () => {
      const entitySelect = document.getElementById(deviceSelect.dataset.targetEntity), selected = entitySelect.value;
      const items = scopedEntityItems(entitySelect.id, deviceSelect.value);
      if (selected && !items.some((item) => item.id === selected)) items.unshift({id:selected,name:BeastEntityPicker.friendlyName(selected)});
      selectSources.set(entitySelect.id, items); entitySelect.innerHTML = renderSelectOptions(entitySelect.id, selected);
    }));
    document.querySelectorAll("[data-show-all-devices]").forEach((checkbox) => checkbox.addEventListener("change", () => {
      const select = document.getElementById(checkbox.dataset.showAllDevices);
      select.dataset.showAll = String(checkbox.checked);
      document.querySelector(`[data-filter-select="${select.id}"]`)?.dispatchEvent(new Event("input"));
    }));
    document.querySelectorAll("[data-filter-entity-device]").forEach((input) => input.addEventListener("input", () => {
      const select = document.getElementById(input.dataset.filterEntityDevice);
      const query = input.value.trim().toLowerCase();
      Array.from(select.options).forEach((option, index) => {
        option.hidden = Boolean(index && query && !option.dataset.search.includes(query));
      });
    }));
    document.querySelectorAll("[data-entity-device-scope]").forEach((select) => select.addEventListener("change", () => {
      const fieldElId = select.dataset.entityDeviceScope;
      const items = scopedEntityItems(fieldElId, select.value);
      if (checkListSources.has(fieldElId)) {
        const selected = checkListSelections.get(fieldElId) || new Set();
        selected.forEach((entityId) => {
          if (!items.some((item) => item.id === entityId)) items.unshift({ id: entityId, name: BeastEntityPicker.friendlyName(entityId) });
        });
        checkListSources.set(fieldElId, items);
        const list = document.getElementById(fieldElId);
        if (list) list.innerHTML = renderCheckListRows(fieldElId);
      } else if (selectSources.has(fieldElId)) {
        const entitySelect = document.getElementById(fieldElId);
        const selected = entitySelect.value;
        if (selected && !items.some((item) => item.id === selected)) items.unshift({ id: selected, name: BeastEntityPicker.friendlyName(selected) });
        selectSources.set(fieldElId, items);
        entitySelect.innerHTML = renderSelectOptions(fieldElId, selected);
      }
    }));
    document.querySelector("[data-refresh-entities]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const state = document.querySelector("[data-refresh-entities-state]");
      button.disabled = true;
      if (state) state.textContent = "Henter…";
      try {
        await BeastHaSocket.refreshSnapshot();
        await BeastRegistry.refresh();
        entityCandidateCache.clear();
        checkListSources.clear();
        checkListSelections.clear();
        selectSources.clear();
        entityFieldBaseSources.clear();
        if (state) state.textContent = `${BeastHaSocket.getAllStates().size} entities opdateret`;
        window.setTimeout(renderShell, 900);
      } catch (error) {
        button.disabled = false;
        if (state) state.textContent = `Opdatering fejlede: ${error.message}`;
      }
    });
    document.getElementById("adminFaviconUrl")?.addEventListener("input", (event) => {
      const preview = document.getElementById("adminFaviconPreview");
      if (preview) preview.src = event.currentTarget.value.trim() || "/favicon.svg";
    });
    document.getElementById("adminFaviconFile")?.addEventListener("change", (event) => {
      const file = event.currentTarget.files?.[0];
      if (!file) return;
      const state = document.querySelector('[data-save-state="title"]');
      if (file.size > 256 * 1024) { if (state) state.textContent = "Filen må højst fylde 256 KB"; event.currentTarget.value = ""; return; }
      const reader = new FileReader();
      reader.onload = () => {
        document.getElementById("adminFaviconUrl").value = reader.result;
        document.getElementById("adminFaviconPreview").src = reader.result;
        hasUnsavedPanelChanges = true;
      };
      reader.readAsDataURL(file);
    });
    document.querySelector("[data-save-title]")?.addEventListener("click", (event) => save(event.currentTarget, "title", async () => {
      const haBaseUrl = document.getElementById("adminHaBaseUrl").value.trim();
      await BeastConfig.set("haBaseUrl", haBaseUrl || null);
      if (haBaseUrl) BeastAuth.setHaBaseUrl(haBaseUrl);
      await BeastConfig.set("dashboardTitle", document.getElementById("adminDashboardTitle").value.trim() || "HA Smartdash");
      const result = await BeastConfig.set("faviconUrl", document.getElementById("adminFaviconUrl").value.trim() || "./favicon.svg");
      document.title = BeastConfig.get("dashboardTitle") || "HA Smartdash";
      const favicon = document.querySelector('link[rel="icon"]');
      if (favicon) favicon.href = BeastConfig.get("faviconUrl") || "/favicon.svg";
      return result;
    }));
    document.querySelector("[data-save-pages]")?.addEventListener("click", (event) => save(event.currentTarget, "pages", () => {
      const hidden = PAGES.map(([id]) => id).filter((id) => !document.querySelector(`[data-page="${id}"]`).checked);
      return BeastLocalSettings.set("hiddenSections", hidden);
    }));
    document.querySelector("[data-save-features]")?.addEventListener("click", (event) => save(event.currentTarget, "features", async () => {
      const features = {};
      FEATURE_OPTIONS.forEach(([key]) => { features[key] = Boolean(document.querySelector(`[data-feature="${key}"]`)?.checked); });
      const result = await BeastConfig.set("features", features);
      if (features.quickScenarios) await BeastConfig.set("appEntities", { ...BeastConfig.get("appEntities"), quickScenes: Array.from(checkListSelections.get("admin_features_quickScenes") || []) });
      window.setTimeout(renderShell, 350);
      return result;
    }));
    document.querySelector("[data-save-overview-cards]")?.addEventListener("click", (event) => save(event.currentTarget, "overviewCards", async () => {
      const cards = collectOverviewCards();
      const fixed = cards.map((card) => card.type).filter((type) => ["cameras","clock","weather","security","energy"].includes(type));
      if (new Set(fixed).size !== fixed.length) { window.alert("Kameraer, Ur, Vejr, Sikkerhed og Energi kan kun tilføjes én gang hver."); return { success:false }; }
      return BeastConfig.set("overviewCards", cards);
    }));
    document.querySelector("[data-add-overview-card]")?.addEventListener("click", async () => {
      const cards = collectOverviewCards();
      cards.push({ id:`card_${Date.now()}`, type:"custom", label:"Nyt kort", entity:null, desktop:{w:3,h:1}, tablet:{w:1,h:1}, portrait:{w:1,h:1} });
      await BeastConfig.set("overviewCards", cards); renderShell();
    });
    document.querySelectorAll("[data-overview-remove]").forEach((button) => button.addEventListener("click", () => { button.closest("[data-overview-card]")?.remove(); refreshOverviewPreview(); }));
    document.querySelectorAll("[data-overview-move]").forEach((button) => button.addEventListener("click", () => {
      const row = button.closest("[data-overview-card]"), list = row.parentElement;
      if (button.dataset.overviewMove === "up" && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
      if (button.dataset.overviewMove === "down" && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
      refreshOverviewPreview();
    }));
    {
      const cardList = document.querySelector("[data-overview-card-list]");
      let draggedRow = null;
      cardList?.addEventListener("input", refreshOverviewPreview);
      cardList?.addEventListener("change", refreshOverviewPreview);
      cardList?.addEventListener("dragstart", (event) => {
        const row = event.target.closest("[data-overview-card]");
        if (!row) return;
        draggedRow = row;
        row.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
      });
      cardList?.addEventListener("dragover", (event) => {
        if (!draggedRow) return;
        event.preventDefault();
        const overRow = event.target.closest("[data-overview-card]");
        if (!overRow || overRow === draggedRow) return;
        const rect = overRow.getBoundingClientRect();
        const before = event.clientY - rect.top < rect.height / 2;
        cardList.insertBefore(draggedRow, before ? overRow : overRow.nextElementSibling);
      });
      cardList?.addEventListener("dragend", () => {
        draggedRow?.classList.remove("is-dragging");
        draggedRow = null;
        refreshOverviewPreview();
      });
      refreshOverviewPreview();
    }
    document.querySelector("[data-save-local-favorites]")?.addEventListener("click", (event) => save(event.currentTarget, "features", () => {
      BeastLocalSettings.set("defaultSection", document.getElementById("adminDefaultSection").value);
      BeastLocalSettings.set("density", document.getElementById("adminDensity").value);
      BeastLocalSettings.set("favoriteSections", Array.from(document.querySelectorAll("[data-favorite-row]")).filter((row) => row.querySelector("[data-favorite-section]").checked).map((row) => row.dataset.favoriteRow));
      return { success: true };
    }));
    document.querySelectorAll("[data-favorite-move]").forEach((button) => button.addEventListener("click", () => {
      const row = button.closest("[data-favorite-row]");
      if (button.dataset.favoriteMove === "up" && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
      if (button.dataset.favoriteMove === "down" && row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row);
    }));
    document.querySelector("[data-export-config]")?.addEventListener("click", () => downloadJson(`ha-smartdash-profile-${new Date().toISOString().slice(0,10)}.json`, portableProfile()));
    document.querySelector("[data-export-local]")?.addEventListener("click", () => downloadJson(`beast-screen-${new Date().toISOString().slice(0,10)}.json`, { type: "beast-local", version: 1, data: BeastLocalSettings.getAll() }));
    document.querySelector("[data-import-backup]")?.addEventListener("change", async (event) => {
      const file = event.currentTarget.files?.[0];
      if (!file) return;
      try {
        const payload = JSON.parse(await file.text());
        if (!payload?.data || !["ha-smartdash-profile", "beast-profile", "beast-central", "beast-local"].includes(payload.type)) throw new Error("Ukendt backupformat");
        const isCentral = ["ha-smartdash-profile", "beast-profile", "beast-central"].includes(payload.type);
        if (!window.confirm(`Gendan ${isCentral ? "HA Smartdash-profilen og alle centrale entity-valg" : "denne skærms lokale valg"} fra ${file.name}?`)) return;
        if (isCentral) await BeastConfig.replaceAll(payload.data);
        else BeastLocalSettings.replaceAll(payload.data);
        renderShell();
      } catch (error) { window.alert(`Backup kunne ikke importeres: ${error.message}`); }
    });
    document.querySelector("[data-save-backup]")?.addEventListener("click", async () => {
      const state = document.querySelector("[data-backup-state]");
      if (state) state.textContent = "Gemmer…";
      try {
        await backupRequest({ action: "settings", enabled: document.getElementById("adminBackupEnabled").value === "1", frequency: document.getElementById("adminBackupFrequency").value, target: document.getElementById("adminBackupTarget").value });
        await loadBackupSettings();
      } catch (error) { if (state) state.textContent = "Kunne ikke gemme backupindstillinger"; }
    });
    document.querySelector("[data-run-backup]")?.addEventListener("click", async () => {
      const state = document.querySelector("[data-backup-state]");
      if (state) state.textContent = "Laver backup…";
      try {
        const result = await backupRequest({ action: "run" });
        if (state) state.textContent = `Gemt: ${result.filename} · ${result.target}`;
      } catch (error) { if (state) state.textContent = "Backup mislykkedes"; }
    });
    document.querySelector("[data-save-app-entities]")?.addEventListener("click", (event) => save(event.currentTarget, "appEntities", async () => {
      BeastLocalSettings.set("kioskScreenLight", document.getElementById("adminKioskLight").value || null);
      return BeastConfig.set("appEntities", {
        ...BeastConfig.get("appEntities"),
        doorbellBinarySensor: document.getElementById("adminDoorbellBinary").value || null,
        doorbellEvent: document.getElementById("adminDoorbellEvent").value || null,
        doorbellCamera: document.getElementById("adminDoorbellCamera").value || null,
        mailPresent: document.getElementById("adminMailPresent").value || null,
        mailCount: document.getElementById("adminMailCount").value || null,
        mailDescription: document.getElementById("adminMailDescription").value || null
      });
    }));
    document.querySelectorAll("[data-save-panel]").forEach((button) => button.addEventListener("click", async () => {
      const panel = PANELS.find((item) => item.id === button.dataset.savePanel);
      if (!panel) return;
      await save(button, panel.id, () => BeastConfig.setPanel(panel.id, collectPanel(panel)));
      hasUnsavedPanelChanges = false;
      renderShell();
    }));

    document.querySelectorAll("button[data-theme-mode]").forEach((button) => {
      button.addEventListener("click", () => { window.BeastTheme?.setMode(button.dataset.themeMode); renderShell(); });
    });
    document.querySelectorAll("button[data-theme-palette]").forEach((button) => {
      button.addEventListener("click", () => { window.BeastTheme?.setPalette(button.dataset.themePalette); renderShell(); });
    });
    document.getElementById("beastThemeOpacity")?.addEventListener("input", (event) => {
      const value = Number(event.currentTarget.value);
      const output = document.getElementById("beastThemeOpacityValue");
      if (output) output.textContent = `${value}%`;
      window.BeastTheme?.setCardOpacity(value);
    });
    document.getElementById("adminFloatingPlayerBtn")?.addEventListener("click", () => {
      const floatingPlayerOn = isFloatingPlayerEnabled();
      setFloatingPlayerEnabled(!floatingPlayerOn);
      renderShell();
    });
    document.getElementById("adminShowAdminButton")?.addEventListener("change", (event) => {
      if (!event.currentTarget.checked) {
        const accepted = window.confirm("Hvis Administration-knappen skjules, skal adminpanelet fremover åbnes manuelt ved at skrive /admin/ efter dashboardets adresse.\n\nEksempel: http://din-adresse/admin/\n\nVil du fortsætte?");
        if (!accepted) event.currentTarget.checked = true;
      }
      const note = document.getElementById("adminHiddenAccessNote");
      if (note) note.hidden = event.currentTarget.checked;
    });
    document.querySelector("[data-save-admin-access]")?.addEventListener("click", (event) => save(event.currentTarget, "adminAccess", () => BeastConfig.set("showAdminButton", Boolean(document.getElementById("adminShowAdminButton")?.checked))));
    document.getElementById("adminPinSet")?.addEventListener("click", () => { window.BeastScreenLock.startSetPin(() => renderShell()); });
    document.getElementById("adminPinRemove")?.addEventListener("click", () => { window.BeastScreenLock.startRemovePin(() => renderShell()); });
    document.getElementById("adminPinRecover")?.addEventListener("click", () => {
      sessionStorage.setItem("beast_panel_pin_recovery_pending_v1", "1");
      BeastAuth.startLogin({ forceLogin: true });
    });
    document.getElementById("adminAutoLockBtn")?.addEventListener("click", () => {
      const autoLockOn = window.BeastScreenLock?.isAutoLockEnabled();
      window.BeastScreenLock.setAutoLockEnabled(!autoLockOn);
      renderShell();
    });
    document.getElementById("adminLockNowBtn")?.addEventListener("click", () => { window.BeastScreenLock.lockNow(); });
    document.getElementById("adminScreensaverSave")?.addEventListener("click", () => {
      BeastLocalSettings.set("screensaver", {
        enabled: document.getElementById("adminScreensaverEnabled").value === "1",
        schedule: document.getElementById("adminScreensaverSchedule").value,
        startTime: document.getElementById("adminScreensaverStart").value || "23:00",
        endTime: document.getElementById("adminScreensaverEnd").value || "05:30",
        offAfterMinutes: Math.max(1, Number(document.getElementById("adminScreensaverOffAfter").value) || 5)
      });
      renderShell();
    });
    document.getElementById("beastMqttSave")?.addEventListener("click", () => {
      const next = {
        target: document.getElementById("beastMqttTarget").value,
        customPrefix: document.getElementById("beastMqttCustom").value.trim(),
        payload: document.getElementById("beastMqttPayload").value.trim() || "PRESS",
        kioskName: document.getElementById("beastKioskName").value.trim() || "Kiosk",
        kioskPrefix: normalizePrefix(document.getElementById("beastKioskPrefix").value)
      };
      localStorage.setItem(MQTT_CONFIG_KEY, JSON.stringify(next));
      renderShell();
    });
    document.getElementById("beastMqttTest")?.addEventListener("click", async () => {
      const config = getMqttConfig();
      const target = MQTT_TARGETS.find((item) => item.id === config.target) || MQTT_TARGETS[0];
      const prefix = config.target === "custom" ? config.customPrefix : target.prefix;
      const feedback = document.getElementById("beastMqttFeedback");
      try {
        await callService("mqtt", "publish", { topic: `${String(prefix).replace(/\/+$/g, "")}/test`, payload: config.payload, qos: 0, retain: false });
        if (feedback) feedback.textContent = `Test sendt til ${prefix}/test`;
      } catch (error) {
        if (feedback) feedback.textContent = `MQTT-test fejlede: ${error.message}`;
      }
    });
    document.querySelectorAll("[data-kiosk-action]").forEach((button) => {
      button.addEventListener("click", () => handleKioskAction(button));
    });
    document.getElementById("adminLogout")?.addEventListener("click", () => {
      BeastAuth.logout();
      window.location.href = "../";
    });

    const logEl = document.getElementById("adminDebugLog");
    if (logEl) {
      logEl.textContent = BeastCore.getDebugLog().slice(-60).join("\n");
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  // Attached once, here, rather than inside wireUi() — wireUi() re-runs on
  // every renderShell() (root.innerHTML replace), so a listener attached
  // there would accumulate on document across re-renders. Delegation also
  // means dynamically inserted group rows (added group / removed group)
  // work without needing to be individually re-wired.
  // A checkbox click is observed in capture phase because the browser fires
  // `input`/`change` only after the click's default action. Registry hydration
  // can finish in that small window; marking the form dirty here prevents its
  // completion callback from replacing the panel before the check is applied.
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-admin-view] input, [data-admin-view] select, [data-admin-view] textarea")) {
      hasUnsavedPanelChanges = true;
    }
  }, true);
  document.addEventListener("input", (event) => {
    if (event.target.closest("[data-admin-view]") && PANELS.some((panel) => panel.id === activeView)) {
      hasUnsavedPanelChanges = true;
    }
    const checkbox = event.target.closest(".admin-check-list input[type=checkbox]");
    if (checkbox) {
      syncCheckListSelection(checkbox);
      return;
    }
    const input = event.target.closest("[data-filter-list]");
    if (!input) return;
    const query = input.value.trim().toLowerCase();
    if (checkListSources.has(input.dataset.filterList)) {
      const list = document.getElementById(input.dataset.filterList);
      if (list) list.innerHTML = renderCheckListRows(input.dataset.filterList, query);
      return;
    }
    document.querySelectorAll(`#${input.dataset.filterList} [data-search]`).forEach((row) => { row.hidden = Boolean(query && !row.dataset.search.includes(query)); });
  });
  document.addEventListener("change", (event) => {
    if (event.target.closest("[data-admin-view]") && PANELS.some((panel) => panel.id === activeView)) {
      hasUnsavedPanelChanges = true;
    }
    const checkbox = event.target.closest(".admin-check-list input[type=checkbox]");
    if (checkbox) syncCheckListSelection(checkbox);
  });
  function syncCheckListSelection(checkbox) {
    const list = checkbox.closest(".admin-check-list");
    if (!list || !checkListSelections.has(list.id)) return;
    const selected = checkListSelections.get(list.id);
    if (checkbox.checked) selected.add(checkbox.value);
    else selected.delete(checkbox.value);
  }
  document.addEventListener("click", (event) => {
    const addBtn = event.target.closest("[data-add-group]");
    if (addBtn) {
      hasUnsavedPanelChanges = true;
      const container = document.getElementById(addBtn.dataset.addGroup);
      if (container) container.insertAdjacentHTML("beforeend", groupRowHtml(addBtn.dataset.addGroup, container.children.length, { name: "", ids: [] }, true));
      return;
    }
    const removeBtn = event.target.closest("[data-remove-group]");
    if (removeBtn) {
      hasUnsavedPanelChanges = true;
      const row = removeBtn.closest("[data-group-row]");
      const selectionId = row?.dataset.selectionId;
      if (selectionId) {
        checkListSources.delete(selectionId);
        checkListSelections.delete(selectionId);
      }
      row?.remove();
    }
  });

  function renderLogin(message) {
    root.innerHTML = `<div class="admin-login"><div class="admin-login-card"><img class="admin-login-logo" src="/assets/ha-smartdash-logo.svg" alt="HA Smartdash"><small>Administration</small><h1>Forbind Home Assistant</h1><p>${escapeHtml(message || "Admin bruger din Home Assistant-login til at hente områder og entities. Login-oplysninger gemmes kun i browseren.")}</p><form id="adminLoginForm"><input type="url" id="adminHaUrl" value="${escapeHtml(BeastAuth.getHaBaseUrl() || `${window.location.origin}/ha`)}" placeholder="Home Assistant-adresse" required><button type="submit">Log ind med Home Assistant</button></form></div></div>`;
    document.getElementById("adminLoginForm").addEventListener("submit", (event) => {
      event.preventDefault();
      BeastAuth.setHaBaseUrl(document.getElementById("adminHaUrl").value);
      BeastAuth.startLogin();
    });
  }

  async function boot() {
    const callback = await BeastAuth.handleAuthCallback();
    const pinRecoveryPending = sessionStorage.getItem("beast_panel_pin_recovery_pending_v1") === "1";
    if (callback?.type === "error") {
      if (pinRecoveryPending) sessionStorage.removeItem("beast_panel_pin_recovery_pending_v1");
      renderLogin(callback.message);
      return;
    }
    await BeastConfig.init();
    if (!BeastAuth.getHaBaseUrl() && BeastConfig.get("haBaseUrl")) BeastAuth.setHaBaseUrl(BeastConfig.get("haBaseUrl"));
    if (pinRecoveryPending && !callback) { BeastAuth.startLogin({ forceLogin: true }); return; }
    if (!BeastAuth.hasSession()) { renderLogin(); return; }
    const returnView = sessionStorage.getItem("beast_admin_return_view_v1");
    if (returnView) { activeView = returnView; sessionStorage.removeItem("beast_admin_return_view_v1"); }
    renderShell();
    backupRequest({ action: "maybe" }).catch(() => null);
    if (callback?.type === "success" && pinRecoveryPending) {
      sessionStorage.removeItem("beast_panel_pin_recovery_pending_v1");
      window.setTimeout(() => {
        window.BeastScreenLock.resetPinAfterTrustedLogin(() => renderShell());
      }, 0);
    }
    startMqttWatchdog();
    document.addEventListener("beast:log", () => {
      const logEl = document.getElementById("adminDebugLog");
      if (logEl) {
        logEl.textContent = BeastCore.getDebugLog().slice(-60).join("\n");
        logEl.scrollTop = logEl.scrollHeight;
      }
    });
    BeastHaSocket.onStatusChange(async (status) => {
      currentConnState = status;
      const statusEl = document.getElementById("adminHaStatus");
      if (statusEl) { statusEl.dataset.state = status; statusEl.textContent = status === "connected" ? "Home Assistant forbundet" : (status === "auth-failed" ? "Login udløbet" : "Forbinder til Home Assistant…"); }
      if (status !== "connected") { currentMqttState = "connecting"; return; }
      connected = true;
      window.setTimeout(checkMqttConnection, 700);
      if (!registryUiHydrated) {
        registryUiHydrated = true;
        await BeastRegistry.ensureLoaded().catch(() => null);
        entityCandidateCache.clear();
        if (!hasUnsavedPanelChanges) renderShell();
      }
    });
    BeastHaSocket.connect();
  }

  boot().catch((error) => renderLogin(`Admin kunne ikke starte: ${error.message}`));
})();
