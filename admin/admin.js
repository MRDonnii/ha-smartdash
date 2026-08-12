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
  const GITHUB_REPO = "MRDonnii/ha-smartdash";
  // Inlined (not <img src="...">) specifically so the two text elements
  // can be styled with the page's own theme tokens via CSS -- the SVG file
  // itself hardcodes near-white fill for both, which was unreadable
  // against the light-theme sidebar/cards. The icon mark's own colors stay
  // fixed (it's a consistent brand mark, not something meant to invert).
  // idSuffix keeps each instance's gradient <defs> id unique, since this
  // renders more than once on the same admin page (sidebar + About card).
  function brandLogoMarkup(idSuffix) {
    return `<svg class="beast-brand-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 88" role="img" aria-label="HA Smartdash">
      <defs>
        <linearGradient id="logo-bg-${idSuffix}" x1="4" y1="4" x2="80" y2="84" gradientUnits="userSpaceOnUse"><stop stop-color="#172a37"/><stop offset=".52" stop-color="#123c3a"/><stop offset="1" stop-color="#0b171e"/></linearGradient>
        <linearGradient id="logo-accent-${idSuffix}" x1="17" y1="20" x2="69" y2="69" gradientUnits="userSpaceOnUse"><stop stop-color="#72f4d0"/><stop offset="1" stop-color="#27aee4"/></linearGradient>
      </defs>
      <rect x="4" y="4" width="80" height="80" rx="24" fill="url(#logo-bg-${idSuffix})"/>
      <rect x="5.5" y="5.5" width="77" height="77" rx="22.5" fill="none" stroke="#b7fff0" stroke-opacity=".16" stroke-width="3"/>
      <path d="M17 42 44 19l27 23v25a5 5 0 0 1-5 5H22a5 5 0 0 1-5-5z" fill="none" stroke="url(#logo-accent-${idSuffix})" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M27 54h9l4.5-10 7.5 18 5-8h8" fill="none" stroke="#f4fffc" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="69" cy="20" r="6" fill="#72f4d0"/>
      <text x="104" y="42" class="beast-brand-logo-title" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="31" font-weight="780" letter-spacing="-.7">HA Smartdash</text>
      <text x="106" y="65" class="beast-brand-logo-subtitle" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="12" font-weight="700" letter-spacing="2.3">HOME ASSISTANT DASHBOARD</text>
    </svg>`;
  }
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
    ["car","Bil"],["pool","Pool"],["robots","Robotter"],["printer","3D-printer"],["heatpump","Varmepumpe"],["custom","Valgfri HA-entity"]
  ];
  // Order matters here beyond just labeling: when overviewCards is still
  // empty and this list gets synthesized into freeform cards below, dense
  // grid packing places items in this exact order. This specific order is
  // the one that reconstructs the legacy fixed layout (clock/weather top,
  // camera right spanning both rows, security/energy bottom) -- reordering
  // it changes what the preview (and a fresh save) actually produces.
  const OVERVIEW_SLOTS = [["compactTop","Venstre øverst"],["wideTop","Midte øverst"],["main","Stor plads"],["compactBottom","Venstre nederst"],["wideBottom","Midte nederst"]];

  const PANELS = [
    { id: "weather", title: "Vejr", description: "Vejrudsigt og aktuelle vejrdata.", fields: [
      { key: "entity", label: "Vejr-entity", type: "single", domain: "weather" }
    ]},
    { id: "waste", title: t("Kalender & affald", "Calendar & waste"), description: t("Kalendere og affaldssensorer. Om de vises på forsiden styres under Forside.", "Calendars and waste sensors. Front-page visibility is controlled under Overview."), fields: [
      { key: "calendars", label: t("Kalendere (bruges også af forsidens \"Næste aftaler\" -- tomt viser alle kalendere)", "Calendars (also used by the overview's \"Next events\" -- empty shows every calendar)"), type: "multi", domain: "calendar" },
      { key: "sensors", label: t("Affaldssensorer", "Waste sensors"), type: "multi", domain: "sensor", hints: ["affald", "waste", "trash", "bin"] },
      { key: "scheduleCalendars", label: t("Skoleskema-kalendere (ét kort pr. valgt kalender, fx AULA)", "School schedule calendars (one card per selected calendar, e.g. AULA)"), type: "multi", domain: "calendar", hints: ["skole", "skema", "aula"] }
    ]},
    { id: "music", title: "Musik", description: "Music Assistant-integration til bibliotek og søgning.", fields: [
      { key: "configEntryId", label: "Music Assistant config entry-id", type: "text", placeholder: "fx 01KK8RSBAW369PSMQMG6CE5HGB" },
      { key: "visiblePlayers", label: t("Synlige afspillere i musikvinduet", "Players visible in the Music view"), type: "multi", domain: "media_player", musicAssistantOnly: true, defaultAllWhenUnset: true }
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
      { key: "heatPowerSensor", label: "Aktuel varmeeffekt", type: "single", domain: "sensor", hints: ["varme", "heat", "power", "effekt", "kamstrup"], filterHints: true },
      { key: "heatEnergyTodaySensor", label: "Varmeforbrug i dag", type: "single", domain: "sensor", hints: ["varme", "heat", "energy", "energi", "today", "dag"], filterHints: true },
      { key: "heatEnergyMonthSensor", label: "Varmeforbrug denne måned", type: "single", domain: "sensor", hints: ["varme", "heat", "energy", "energi", "month", "måned"], filterHints: true },
      { key: "districtSensors", label: "Fjernvarme-sensorer", type: "multi", domain: "sensor", hints: ["kamstrup", "multical"], filterHints: true },
      { key: "districtPlacement", label: "Placering af fjernvarme", type: "select", choices: [["sidebar", "Højre side"], ["pumps", "Ved varmepumper"]] },
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
      { key: "cameraEntity", label: "Poolkamera", type: "single", domain: "camera", hints: ["pool", "terrasse", "have"] },
      { key: "cameraStream", label: "go2rtc streamnavn (kun fallback)", type: "text", placeholder: "Terrasse_syd" }
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
      { key: "cameraDisplay", label: "Kameravisning", type: "select", choices: [["printer", "Kun printerens eget kamera"], ["live", "Kun ekstra livekamera"], ["both", "Begge kameraer"]] },
      { key: "liveCamera", label: "Livekamera (vælg fra kameraer)", type: "single", domain: "camera" },
      { key: "liveStream", label: "go2rtc streamnavn (kun hvis kameraet ikke kan vælges ovenfor)", type: "text", placeholder: "3dprinter" }
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
      { key: "showHeatOnOverview", label: "Vis Varme-graf på forsiden", type: "boolean" },
      { key: "waterUsageSensor", label: "Vandforbrug i dag (valgfri)", type: "single", domain: "sensor" },
      { key: "waterFlowSensor", label: "Vandflow nu (valgfri)", type: "single", domain: "sensor" },
      { key: "showWaterOnOverview", label: "Vis Vand-graf på forsiden", type: "boolean" },
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
  const requestedView = window.location.hash.replace(/^#/, "");
  let activeView = requestedView || "overview";
  let currentConnState = "connecting";
  let currentMqttState = "connecting";
  let mqttWatchdogTimerId = null;
  let screensaverPreviewTimerId = null;
  let overviewVisualPreviewTimerId = null;
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
      hints: field.hints || [],
      musicAssistantOnly: field.musicAssistantOnly === true
    });
    if (!entityCandidateCache.has(cacheKey)) {
      let items = BeastEntityPicker.candidates({
        domain: field.domain,
        deviceClasses: field.deviceClasses,
        keywordHints: field.hints
      });
      if (field.musicAssistantOnly) {
        items = items.filter((item) => BeastHaSocket.getState(item.id)?.attributes?.app_id === "music_assistant");
      }
      entityCandidateCache.set(cacheKey, items);
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
      <div class="admin-picker-meta" data-picker-meta="${id}"><span>${items.length} muligheder</span><strong>${selectedIds.length} valgt</strong></div>
      <input class="admin-filter" type="search" placeholder="Søg på navn, entity-id eller enhed…" data-filter-list="${id}">
      <div class="admin-check-list" id="${id}">
        ${renderCheckListRows(id)}
      </div>`;
  }

  function renderCheckListRows(id, query = "") {
    const items = checkListSources.get(id) || [];
    const selected = checkListSelections.get(id) || new Set();
    const normalizedQuery = query.trim().toLowerCase();
    const searchText = (item) => {
      const meta = BeastRegistry.getEntityMeta(item.id);
      const device = meta?.deviceId ? BeastRegistry.getDevice(meta.deviceId) : null;
      return `${item.name} ${item.id} ${device?.name || ""} ${meta?.platform || ""}`.toLowerCase();
    };
    const matches = normalizedQuery
      ? items.filter((item) => searchText(item).includes(normalizedQuery))
      : items;
    const visible = [];
    const added = new Set();
    items.filter((item) => selected.has(item.id)).forEach((item) => {
      if (!normalizedQuery || searchText(item).includes(normalizedQuery)) {
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
    const rows = visible.map((item) => {
      const meta = BeastRegistry.getEntityMeta(item.id);
      const device = meta?.deviceId ? BeastRegistry.getDevice(meta.deviceId) : null;
      const context = [device?.name, meta?.platform].filter(Boolean).join(" · ");
      return `
      <label class="admin-check" data-search="${escapeHtml(searchText(item))}">
        <input type="checkbox" value="${escapeHtml(item.id)}"${selected.has(item.id) ? " checked" : ""}>
        <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(context ? `${context} · ${item.id}` : item.id)}</small></span>
      </label>`;
    }).join("");
    const remaining = Math.max(0, matches.length - visible.length);
    return `${rows}${remaining ? `<div class="admin-list-hint">Skriv i søgefeltet for at finde de øvrige ${remaining} entities.</div>` : ""}`;
  }

  function renderSelectOptions(id, selected, query = "") {
    const items = selectSources.get(id) || [];
    const normalizedQuery = query.trim().toLowerCase();
    const itemText = (item) => {
      const meta = BeastRegistry.getEntityMeta(item.id);
      const device = meta?.deviceId ? BeastRegistry.getDevice(meta.deviceId) : null;
      return `${item.name} ${item.id} ${device?.name || ""} ${meta?.platform || ""}`.toLowerCase();
    };
    const matches = normalizedQuery
      ? items.filter((item) => itemText(item).includes(normalizedQuery))
      : items;
    const visible = matches.slice(0, CHECK_LIST_RENDER_LIMIT);
    if (selected && !visible.some((item) => item.id === selected)) {
      const selectedItem = items.find((item) => item.id === selected);
      if (selectedItem) visible.unshift(selectedItem);
    }
    return `<option value=""${selected ? "" : " selected"}>— Ikke valgt —</option>${visible.map((item) => {
      const meta = BeastRegistry.getEntityMeta(item.id);
      const device = meta?.deviceId ? BeastRegistry.getDevice(meta.deviceId) : null;
      const context = device?.name ? ` · ${device.name}` : "";
      return `<option value="${escapeHtml(item.id)}"${item.id === selected ? " selected" : ""}>${escapeHtml(item.name)}${escapeHtml(context)} — ${escapeHtml(item.id)}</option>`;
    }).join("")}`;
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
    if (field.type === "boolean") {
      const checked = selected !== false;
      return `<select id="${fieldId(panel.id, field.key)}"><option value="1"${checked ? " selected" : ""}>Til</option><option value="0"${checked ? "" : " selected"}>Fra</option></select>`;
    }
    if (field.type === "select") {
      return `<select id="${fieldId(panel.id, field.key)}">${(field.choices || []).map(([value, label]) => `<option value="${escapeHtml(value)}"${selected === value ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`;
    }
    if (field.type === "areas") {
      const ids = Array.isArray(selected) ? selected : [];
      const areas = BeastRegistry.getAllAreas().map((area) => ({ id: area.area_id, name: area.name || area.area_id }));
      return renderCheckList(panel, field, ids, areas);
    }
    if (field.type === "multi") {
      const available = baseCandidates(field);
      const ids = Array.isArray(selected) ? selected : (field.defaultAllWhenUnset ? available.map((item) => item.id) : []);
      const id = fieldId(panel.id, field.key);
      const scope = entityDeviceScope(panel, field, ids);
      const base = available;
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
    const selectedName = selected ? BeastEntityPicker.friendlyName(selected) : "Ikke valgt";
    return `
      ${renderEntityDeviceScope(id, scope)}
      <div class="admin-picker-meta" data-picker-meta="${id}"><span>${scopedItems.length} ${escapeHtml(field.domain || "")} entities</span><strong>${escapeHtml(selectedName)}</strong></div>
      <input class="admin-filter" type="search" placeholder="Søg på navn, entity-id eller enhed…" data-filter-select="${id}">
      <select id="${id}" size="6">
        ${renderSelectOptions(id, selected)}
      </select>${entityPreviewHtml(id, selected)}`;
  }

  const ROOM_EXTRA_DOMAINS = new Set(["light", "climate", "sensor", "binary_sensor", "cover", "lock", "switch", "fan", "media_player", "input_boolean", "input_select", "automation", "valve", "vacuum"]);

  function roomMappingId(areaId, suffix) {
    return `admin_rooms_map_${String(areaId).replace(/[^a-z0-9_-]/gi, "_")}_${suffix}`;
  }

  function roomSensorItems(areaId, deviceClass, selected) {
    const items = Array.from(BeastHaSocket.getAllStates().entries())
      .filter(([entityId, state]) => entityId.startsWith("sensor.") && Number.isFinite(Number(state?.state)))
      .map(([entityId, state]) => {
        const meta = BeastRegistry.getEntityMeta(entityId);
        let score = state?.attributes?.device_class === deviceClass ? 20 : 0;
        if (meta?.areaId === areaId) score += 10;
        if (entityId === selected) score += 100;
        return { id: entityId, name: BeastEntityPicker.friendlyName(entityId), score };
      })
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "da"));
    if (selected && !items.some((item) => item.id === selected)) items.unshift({ id: selected, name: BeastEntityPicker.friendlyName(selected), score: 100 });
    return items;
  }

  function roomExtraEntityItems(areaId, selectedIds) {
    const selected = new Set(selectedIds || []);
    return Array.from(BeastHaSocket.getAllStates().keys())
      .filter((entityId) => ROOM_EXTRA_DOMAINS.has(entityId.split(".")[0]))
      .map((entityId) => ({
        id: entityId,
        name: BeastEntityPicker.friendlyName(entityId),
        score: selected.has(entityId) ? 100 : BeastRegistry.getEntityMeta(entityId)?.areaId === areaId ? 20 : 0
      }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "da"));
  }

  function roomSinglePicker(id, items, selected, label) {
    selectSources.set(id, items);
    return `<div class="admin-room-map-field"><span>${escapeHtml(label)}</span><div class="admin-picker-meta" data-picker-meta="${id}"><span>${items.length} sensors</span><strong>${escapeHtml(selected ? BeastEntityPicker.friendlyName(selected) : "Automatisk")}</strong></div><input class="admin-filter" type="search" placeholder="Søg på navn, entity-id eller enhed…" data-filter-select="${id}"><select id="${id}" size="5">${renderSelectOptions(id, selected)}</select></div>`;
  }

  function renderRoomsEntityMappings(current) {
    const areaIds = Array.isArray(current.areaIds) ? current.areaIds : [];
    if (!areaIds.length) return `<div class="admin-room-mappings"><div class="admin-card-head"><div><h2>Entities pr. rum</h2><p>Vælg og gem først mindst ét synligt HA-område.</p></div></div></div>`;
    const rows = areaIds.map((areaId) => {
      const area = BeastRegistry.getArea(areaId);
      if (!area) return "";
      const climate = Array.isArray(current.climateSensors?.[areaId]) ? current.climateSensors[areaId] : [];
      const extras = Array.isArray(current.entityOverrides?.[areaId]) ? current.entityOverrides[areaId] : [];
      const tempId = roomMappingId(areaId, "temperature");
      const humidityId = roomMappingId(areaId, "humidity");
      const extrasId = roomMappingId(areaId, "extras");
      const extraItems = roomExtraEntityItems(areaId, extras);
      checkListSources.set(extrasId, extraItems);
      checkListSelections.set(extrasId, new Set(extras));
      const assignedCount = BeastRegistry.getAreaEntityIds(areaId).length;
      const extrasPicker = `<div class="admin-picker-meta" data-picker-meta="${extrasId}"><span>${extraItems.length} muligheder</span><strong>${extras.length} valgt</strong></div><input class="admin-filter" type="search" placeholder="Søg på navn, entity-id eller enhed…" data-filter-list="${extrasId}"><div class="admin-check-list" id="${extrasId}">${renderCheckListRows(extrasId)}</div>`;
      return `<article class="admin-room-mapping" data-room-mapping="${escapeHtml(areaId)}" data-temp-picker="${tempId}" data-humidity-picker="${humidityId}" data-extras-picker="${extrasId}"><header><div><h3>${escapeHtml(area.name || areaId)}</h3><p>${assignedCount} entities er allerede tilknyttet området i Home Assistant.</p></div><span>${extras.length} ekstra</span></header><div class="admin-room-map-sensors">${roomSinglePicker(tempId, roomSensorItems(areaId, "temperature", climate[0]), climate[0], "Temperatursensor")}${roomSinglePicker(humidityId, roomSensorItems(areaId, "humidity", climate[1]), climate[1], "Fugtighedssensor")}</div><div class="admin-room-map-extras"><span>Ekstra entities uden for HA-rummet</span><p>Disse lægges oven i de entities, som allerede er placeret i rummet i Home Assistant.</p>${extrasPicker}</div></article>`;
    }).join("");
    return `<div class="admin-room-mappings"><div class="admin-card-head"><div><h2>Entities pr. rum</h2><p>Automatiske HA-entities og valg herunder bruges sammen. Temperatur og fugtighed kan tilsidesættes særskilt.</p></div><button type="button" class="beast-btn" data-refresh-rooms>Genindlæs rum fra Home Assistant</button></div><div class="admin-room-mapping-grid">${rows}</div><span class="admin-save-state" data-refresh-rooms-state></span></div>`;
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

  function renderThemeView() {
    return `
      <section class="admin-view${activeView === "theme" ? " is-active" : ""}" data-admin-view="theme">
        <div class="admin-settings-intro"><div><h2>Tema og design</h2><p>Farve, stil og lystilstand for hele dashboardet. Ændringer virker med det samme og gemmes kun i denne browser.</p></div></div>
        <div class="admin-card admin-settings-group admin-settings-theme">${window.BeastTheme?.renderPanel() || ""}</div>
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
        <button type="button" class="admin-section-back" data-view="devices">${BeastCore.icon("chevron-right", { size: 17 })}<span>Alle enheder</span></button>
        <div class="admin-card">
          <div class="admin-card-head"><div><h2>${escapeHtml(panel.title)}</h2><p>${escapeHtml(panel.description)}</p></div></div>
          ${panel.fields.some((field) => field.type === "device") ? `<div class="admin-scope-banner">Vælg først den konkrete enhed og gem. Derefter viser felterne kun entities, som HA har knyttet til den valgte enhed.</div>` : ""}
          <div class="admin-grid">
            ${panel.fields.map((field) => `<div class="admin-field"><span class="admin-field-heading"><b>${escapeHtml(field.label)}</b>${field.domain ? `<em>${escapeHtml(field.domain)}</em>` : ""}</span>${renderField(panel, field, current)}</div>`).join("")}
          </div>
          ${panel.id === "rooms" ? renderRoomsEntityMappings(current) : ""}
          <div class="admin-actions"><button class="admin-save" type="button" data-save-panel="${panel.id}">Gem ${escapeHtml(panel.title)}</button><span class="admin-save-state" data-save-state="${panel.id}"></span></div>
        </div>
      </section>`;
  }

  function renderDevicesView() {
    const groups = [
      ["Klima og forbrug", ["weather", "energy", "heating", "pool"]],
      ["Hus og sikkerhed", ["rooms", "security", "cameras", "waste"]],
      ["Udstyr og medier", ["music", "car", "robots", "printer"]]
    ];
    const icons = { weather:"cloud", energy:"bolt", heating:"thermometer", pool:"droplet", rooms:"grid", security:"shield", cameras:"camera", waste:"calendar", music:"music", car:"car", robots:"robot", printer:"printer" };
    return `<section class="admin-view${activeView === "devices" ? " is-active" : ""}" data-admin-view="devices">
      <div class="admin-settings-intro"><span>${BeastCore.icon("grid", { size: 29 })}</span><div><h2>Enheder og datakilder</h2><p>Vælg hvilke Home Assistant-enheder der leverer data. Kort, størrelse og placering redigeres direkte på den enkelte dashboard-side.</p></div></div>
      ${groups.map(([title, ids]) => `<div class="admin-card admin-device-group"><div class="admin-card-head"><div><h2>${title}</h2><p>Åbn kun den del, du vil forbinde eller ændre.</p></div></div><div class="admin-device-hub">${ids.map((id) => { const panel=PANELS.find((item)=>item.id===id); const configured=BeastConfig.isPanelConfigured(id); return `<button type="button" data-view="${id}"><i>${BeastCore.icon(icons[id] || "grid", { size: 24 })}</i><span><strong>${escapeHtml(panel.title)}</strong><small>${escapeHtml(panel.description)}</small></span><em class="${configured ? "is-ready" : ""}">${configured ? "Konfigureret" : "Mangler opsætning"}</em>${BeastCore.icon("chevron-right", { size: 18 })}</button>`; }).join("")}</div></div>`).join("")}
    </section>`;
  }

  function renderPagesView() {
    const manifest = BeastConfig.get("pages") || {};
    const removed = new Set(manifest.removed || []);
    const standard = window.BeastPageManager?.standardPages?.() || [];
    const custom = Array.isArray(manifest.custom) ? manifest.custom : [];
    const activeCount = standard.filter((page) => !removed.has(page.id)).length + custom.filter((page) => !removed.has(page.id)).length;
    return `<section class="admin-view${activeView === "pages" ? " is-active" : ""}" data-admin-view="pages">
      <div class="admin-settings-intro"><span>${BeastCore.icon("grid", { size: 29 })}</span><div><h2>Sider og navigation</h2><p>Opret sider, gendan standardsider, omdøb dem og bestem rækkefølgen i dashboardets navigation.</p></div></div>
      <div class="admin-summary"><div><strong>${activeCount}</strong><span>aktive sider</span></div><div><strong>${custom.length}</strong><span>egne sider</span></div><div><strong>${removed.size}</strong><span>skjulte eller fjernede</span></div></div>
      <div class="admin-card admin-pages-card"><div class="admin-card-head"><div><h2>Administrer sider</h2><p>Tilføjelse, fjernelse og rækkefølge styres kun her. Layoutet på den aktuelle side åbnes med Rediger-knappen i dashboardets navigation.</p></div></div><button type="button" class="admin-primary-action" data-open-page-manager>${BeastCore.icon("plus", { size: 22 })}<span><strong>Tilføj eller administrer sider</strong><small>Opret, fjern, gendan, omdøb og flyt rækkefølge</small></span>${BeastCore.icon("chevron-right", { size: 20 })}</button></div>
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
            ${brandLogoMarkup("about")}
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
    return `
      <section class="admin-view${activeView === "setup" ? " is-active" : ""}" data-admin-view="setup">
        <div class="admin-card">
          <div class="admin-card-head"><div><h2>Navn & browserikon</h2><p>Tilpas teksten og ikonet, der vises i browserfanen.</p></div></div>
          <div class="admin-branding-grid">
            <label class="admin-field"><span>Home Assistant-adresse</span><input type="url" id="adminHaBaseUrl" value="${escapeHtml(BeastConfig.get("haBaseUrl") || BeastAuth.getHaBaseUrl() || "")}" placeholder="http://homeassistant.local:8123"></label>
            <label class="admin-field"><span>Tekst i browserfanen</span><input type="text" id="adminDashboardTitle" value="${escapeHtml(BeastConfig.get("dashboardTitle") || "HA Smartdash")}"></label>
            <label class="admin-field"><span>Favicon-adresse</span><input type="text" id="adminFaviconUrl" value="${escapeHtml(BeastConfig.get("faviconUrl") || "/favicon.svg")}" placeholder="/favicon.svg eller https://…"></label>
            <label class="admin-field admin-favicon-upload"><span>Vælg favicon-fil</span><input type="file" id="adminFaviconFile" accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/webp"><small>PNG, SVG, ICO eller WebP · højst 256 KB</small></label>
            <div class="admin-favicon-preview"><img id="adminFaviconPreview" src="${escapeHtml(BeastConfig.get("faviconUrl") || "/favicon.svg")}" alt="Forhåndsvisning"><span>Forhåndsvisning</span></div>
          </div>
          <div class="admin-actions"><button class="admin-save" type="button" data-save-title>Gem browserfane</button><span class="admin-save-state" data-save-state="title"></span></div>
        </div>
        ${renderFeaturePanel()}
        <div class="admin-card">
          <div class="admin-card-head"><div><h2>Kiosk & dørklokke</h2><p>Valgfrit — styrer skærm-sluk om natten og et automatisk dørkamera-overlay.</p></div></div>
          <div class="admin-grid">
            <label class="admin-field"><span>Kiosk-skærm (lokal på denne maskine)</span>${BeastEntityPicker.selectHtml({ id: "adminKioskLight", domain: "light", keywordHints: ["kiosk", "screen", "skaerm", "tablet"], selected: BeastLocalSettings.get("kioskScreenLight", BeastConfig.get("appEntities.kioskScreenLight")) })}</label>
            <label class="admin-field"><span>Dørklokke (binary_sensor)</span>${BeastEntityPicker.selectHtml({ id: "adminDoorbellBinary", domain: "binary_sensor", keywordHints: ["doorbell", "dørklokke", "ring"], selected: BeastConfig.get("appEntities.doorbellBinarySensor") })}</label>
            <label class="admin-field"><span>Dørklokke (event, valgfri)</span>${BeastEntityPicker.selectHtml({ id: "adminDoorbellEvent", domain: "event", keywordHints: ["doorbell", "dørklokke", "ring"], selected: BeastConfig.get("appEntities.doorbellEvent") })}</label>
            <label class="admin-field"><span>Dørkamera (valgfri)</span>${BeastEntityPicker.selectHtml({ id: "adminDoorbellCamera", domain: "camera", keywordHints: ["doorbell", "dørklokke", "front", "hoveddor", "fordor"], selected: BeastConfig.get("appEntities.doorbellCamera") })}</label>
            <label class="admin-field"><span>Dørkamera-visning lukker</span>
              <select id="adminDoorbellViewMode">
                <option value="timeout" ${BeastConfig.get("appEntities.doorbellViewMode") !== "manual" ? "selected" : ""}>Automatisk efter et antal minutter</option>
                <option value="manual" ${BeastConfig.get("appEntities.doorbellViewMode") === "manual" ? "selected" : ""}>Kun når jeg selv lukker den</option>
              </select>
            </label>
            <label class="admin-field" id="adminDoorbellViewMinutesField"><span>Antal minutter før automatisk luk</span><input type="number" id="adminDoorbellViewMinutes" min="1" max="60" value="${Number(BeastConfig.get("appEntities.doorbellViewMinutes")) || 3}"></label>
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
    const legacyDefaults = { main:{type:"cameras"}, compactTop:{type:"clock"}, compactBottom:{type:"security"}, wideTop:{type:"weather"}, wideBottom:{type:"energy"} };
    const legacy = { ...legacyDefaults, ...(BeastConfig.get("overviewSlots") || {}) };
    // Desktop widths out of 12; tablet widths out of the 2-column tablet
    // grid. Only "main" used to get the full 2 tablet columns -- every
    // other card, including the wide weather/energy ones (desktop w:5),
    // collapsed to the same single narrow column as the compact clock/
    // security cards, losing all size differentiation on tablet.
    // Every one of these bundles more content than a single 220px tablet/
    // portrait row-unit can fit (clock also carries next-appointments and
    // waste; security also carries the lock list and alarm-system status;
    // weather and energy each pack in several stat tiles plus a chart or
    // forecast strip) -- h:1 defaults previously squeezed all of them into
    // one row-unit, which is what caused entries to overlap instead of
    // just being tight. Camera keeps full height everywhere since it's
    // the tallest content regardless.
    const legacySizes = {
      main:        { w:4, h:2, tabletW:2, tabletH:2, portraitH:2 },
      compactTop:  { w:3, h:1, tabletW:1, tabletH:2, portraitH:2 },
      compactBottom:{ w:3, h:1, tabletW:1, tabletH:2, portraitH:2 },
      wideTop:     { w:5, h:1, tabletW:2, tabletH:2, portraitH:2 },
      wideBottom:  { w:5, h:1, tabletW:2, tabletH:2, portraitH:2 },
    };
    const cards = (BeastConfig.get("overviewCards") || []).length ? BeastConfig.get("overviewCards") : OVERVIEW_SLOTS.map(([key]) => { const size = legacySizes[key]; return { id:key, ...(legacy[key] || {type:"empty"}), desktop:{w:size.w,h:size.h}, tablet:{w:size.tabletW,h:size.tabletH}, portrait:{w:1,h:size.portraitH} }; }).filter((card) => card.type !== "empty");
    const sizeOptions = (selected,max) => Array.from({length:max},(_,i)=>`<option value="${i+1}"${Number(selected)===i+1?" selected":""}>${i+1}</option>`).join("");
    const row = (card,index) => {
        const key = card.id || `card_${index}`;
        const entitySelectId = `admin_overview_card_${key}_entity`;
        const entitySource = card.type === "heatpump" ? allEntities.filter((entity) => entity.id.startsWith("climate.")) : allEntities;
        selectSources.set(entitySelectId, entitySource);
        entityFieldBaseSources.set(entitySelectId, entitySource);
        const needsEntity = card.type === "custom" || card.type === "heatpump";
        const entityLabel = card.type === "heatpump" ? "Vælg varmepumpe" : "Vælg entity";
        return `<div class="admin-overview-slot admin-overview-card-row" draggable="true" data-overview-card="${escapeHtml(key)}"><div class="admin-overview-row-head"><span class="admin-overview-drag-handle" data-overview-drag-handle aria-label="Træk for at flytte kort" title="Træk for at flytte">${BeastCore.icon("grip", { size: 18 })}</span><strong>Kort ${index+1}</strong><div class="admin-icon-actions"><button class="admin-icon-action" type="button" data-overview-move="up" aria-label="Flyt kort op" title="Flyt op">${BeastCore.icon("chevron-up", { size: 18 })}</button><button class="admin-icon-action" type="button" data-overview-move="down" aria-label="Flyt kort ned" title="Flyt ned">${BeastCore.icon("chevron-down", { size: 18 })}</button><button class="admin-icon-action is-danger" type="button" data-overview-remove aria-label="Fjern kort" title="Fjern kort">${BeastCore.icon("close", { size: 18 })}</button></div></div><label>Indhold<select data-overview-type>${OVERVIEW_SLOT_OPTIONS.filter(([value])=>value!=="empty").map(([value,name]) => `<option value="${value}"${card.type === value ? " selected" : ""}>${name}</option>`).join("")}</select></label><label>Titel<input type="text" data-overview-label value="${escapeHtml(card.label || "")}" placeholder="Valgfri titel"></label><div class="admin-overview-custom"${needsEntity ? "" : " hidden"}><strong data-overview-entity-label>${entityLabel}</strong><input class="admin-filter" type="search" placeholder="Søg efter entity…" data-filter-select="${entitySelectId}"><select id="${entitySelectId}" data-overview-entity size="5">${renderSelectOptions(entitySelectId, card.entity)}</select></div><div class="admin-overview-sizes"><fieldset><legend>Stor skærm · 12 kolonner</legend><label>Bredde<select data-size="desktop.w">${sizeOptions(card.desktop?.w || 4,12)}</select></label><label>Højde<select data-size="desktop.h">${sizeOptions(Math.min(card.desktop?.h || 1,2),2)}</select></label></fieldset><fieldset><legend>Smal/tablet · 2 kolonner</legend><label>Bredde<select data-size="tablet.w">${sizeOptions(card.tablet?.w || 1,2)}</select></label><label>Højde<select data-size="tablet.h">${sizeOptions(card.tablet?.h || 1,3)}</select></label></fieldset><fieldset><legend>Lodret/mobil · 1 kolonne</legend><label>Højde<select data-size="portrait.h">${sizeOptions(card.portrait?.h || 1,3)}</select></label></fieldset></div></div>`;
      };
    return `<div class="admin-card"><div class="admin-card-head"><div><h2>Visuel forsidebygger</h2><p>Træk kortene for at flytte dem rundt. Skift indhold, titel og størrelse nedenfor — forhåndsvisningerne opdateres med det samme.</p></div></div><div class="admin-overview-visual-preview" id="adminOverviewVisualPreview"></div><div class="admin-overview-preview" id="adminOverviewPreview"></div><div class="admin-overview-builder" data-overview-card-list>${cards.map(row).join("")}</div><div class="admin-actions"><button type="button" class="beast-btn" data-add-overview-card>+ Tilføj kort</button><button class="admin-save" type="button" data-save-overview-cards>Gem og anvend forside</button><span class="admin-save-state" data-save-state="overviewCards"></span></div></div>`;
  }

  const QUICK_TILE_OPTIONS = [["", "Skjult"], ["car", "Bil"], ["pool", "Pool"], ["robots", "Robotter"], ["printer", "3D-printer"]];

  // Everything that controls what's visible in the clock card (top-left of
  // the front page) lives together here, rather than split across the
  // panels that happen to own the underlying data -- "what shows on the
  // front page" and "which entities feed it" are different questions, and
  // keeping the former all in one place (Forside) is what makes it findable.
  function renderQuickTileSettings() {
    const tiles = BeastConfig.get("overviewQuickTiles");
    const [tile1 = "", tile2 = ""] = Array.isArray(tiles) ? tiles : [];
    const waste = BeastConfig.get("panels.waste") || {};
    const select = (id, selected) => `<select id="${id}">${QUICK_TILE_OPTIONS.map(([value, label]) => `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`).join("")}</select>`;
    const toggle = (id, checked) => `<select id="${id}"><option value="1"${checked ? " selected" : ""}>${t("Til", "On")}</option><option value="0"${checked ? "" : " selected"}>${t("Fra", "Off")}</option></select>`;
    return `<div class="admin-card admin-settings-group"><div class="admin-card-head"><div><h2>${t("Urkortet", "The clock card")}</h2><p>${t("Hvad der vises i kortet med ur, kalender og affald øverst på forsiden. Kalendere og affaldssensorer vælges under Kalender & affald.", "What shows in the clock/calendar/waste card at the top of the front page. Calendars and waste sensors are picked under Calendar & waste.")}</p></div></div><div class="beast-mqtt-config">
      <label><span>${t("Vis \"Næste aftaler\"", "Show \"Next appointments\"")}</span>${toggle("adminShowCalendarCard", waste.showCalendarCard !== false)}</label>
      <label><span>${t("Vis \"Affald\"", "Show \"Waste\"")}</span>${toggle("adminShowWasteCard", waste.showWasteCard !== false)}</label>
      <label><span>${t("Venstre ur-widget", "Left clock tile")}</span>${select("adminQuickTile1", tile1)}</label>
      <label><span>${t("Højre ur-widget", "Right clock tile")}</span>${select("adminQuickTile2", tile2)}</label>
      </div><div class="admin-actions"><button type="button" class="admin-save" data-save-quick-tiles>${t("Gem urkortet", "Save the clock card")}</button><span class="admin-save-state" data-save-state="quickTiles"></span></div></div>`;
  }

  function renderForsideView() {
    return `<section class="admin-view${activeView === "forside" ? " is-active" : ""}" data-admin-view="forside">
      <div class="admin-settings-intro"><div><h2>${t("Forside", "Front page")}</h2><p>${t("Byg og forhåndsvis Oversigt-fanen — kortene, deres størrelser og hvad de viser.", "Build and preview the Overview tab — its cards, their sizes, and what they show.")}</p></div></div>
      ${renderOverviewBuilder()}
      ${renderQuickTileSettings()}
    </section>`;
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
    // Mirrors .beast-overview-grid.is-freeform on the real dashboard exactly:
    // dense packing, and every card's height is hard-clamped to 2 rows
    // there (`grid-row: span min(var(--desktop-h), 2)`), so the preview
    // has to apply the same clamp to actually match what ships.
    previewEl.innerHTML = cards.length ? `<div class="admin-overview-preview-grid">${cards.map((card) => `<div class="admin-overview-preview-card" style="grid-column: span ${Math.max(1, Math.min(12, card.desktop.w))}; grid-row: span ${Math.max(1, Math.min(2, card.desktop.h))};"><strong>${escapeHtml(card.label || typeNames.get(card.type) || card.type)}</strong></div>`).join("")}</div>` : `<p class="admin-empty">Ingen kort endnu.</p>`;
    refreshVisualOverviewPreview(cards);
  }

  const OVERVIEW_CARD_ICONS = { cameras: "camera", clock: "calendar", weather: "cloud", security: "shield", energy: "bolt", heatpump: "wind", custom: "grid" };
  const OVERVIEW_CARD_LABELS = { cameras: "Live kameraer", clock: "Tid, kalender og affald", weather: "Vejr", security: "Sikkerhed", energy: "Energi", heatpump: "Varmepumpe" };
  const WEATHER_ICON_MAP = { sunny: "sun", "clear-night": "moon", partlycloudy: "cloud", cloudy: "cloud", rainy: "cloud-rain", pouring: "cloud-rain", snowy: "cloud", fog: "cloud", windy: "wind", "windy-variant": "wind", lightning: "cloud-rain", "lightning-rainy": "cloud-rain" };

  function overviewCardVisualMarkup(card) {
    const icon = OVERVIEW_CARD_ICONS[card.type] || "grid";
    const kicker = card.label || OVERVIEW_CARD_LABELS[card.type] || card.type;
    const style = `grid-column: span ${Math.max(1, Math.min(12, card.desktop.w))}; grid-row: span ${Math.max(1, Math.min(2, card.desktop.h))};`;
    const kickerHtml = `<span class="admin-ov-preview-kicker">${BeastCore.icon(icon, { size: 12 })}${escapeHtml(kicker)}</span>`;
    if (card.type === "cameras") {
      // A live iframe (like the screensaver preview's camera tiles), not a
      // static snapshot -- "den rigtige side" means it should actually
      // look/behave like the real one. Absolute path: this markup is used
      // from /admin/, where "./camera-player.html" would 404.
      const camera = (window.BeastCameras?.getAllCameras?.() || [])[0];
      let media = "";
      if (camera?.streamName) {
        const src = `/camera-player.html?v=14&transport=mse&sub=1&src=${encodeURIComponent(camera.streamName)}`;
        media = `<iframe class="admin-ov-preview-camera-img" src="${src}" allow="autoplay"></iframe>`;
      } else if (camera?.entityPicture) {
        media = `<img class="admin-ov-preview-camera-img" data-preview-camera-picture="${escapeHtml(camera.entityPicture)}" alt="">`;
      }
      return `<div class="admin-ov-preview-card is-camera" data-card-type="cameras" style="${style}">${kickerHtml}${media}<div class="admin-ov-preview-body">${camera ? escapeHtml(camera.label || "") : t("Intet kamera valgt endnu", "No camera picked yet")}</div></div>`;
    }
    let body;
    if (card.type === "weather") {
      const data = screensaverPreviewData();
      const state = BeastHaSocket.getState(BeastConfig.get("panels.weather.entity"));
      const weatherIcon = WEATHER_ICON_MAP[state?.state] || "cloud";
      body = `<div class="admin-ov-preview-hero">${BeastCore.icon(weatherIcon, { size: 34 })}<div><strong class="admin-ov-preview-weather-temp">${data.weatherTemp}</strong><span class="admin-ov-preview-weather-label">${escapeHtml(data.weatherLabel)}</span></div></div>`;
    } else if (card.type === "security") {
      const data = screensaverPreviewData();
      const secured = data.securityText === t("Huset er sikret", "House is secured");
      body = `<div class="admin-ov-preview-hero${secured ? " is-good" : " is-warning"}">${BeastCore.icon(secured ? "shield" : "unlock", { size: 34 })}<div><strong class="admin-ov-preview-security-text">${escapeHtml(data.securityText)}</strong></div></div>`;
    } else if (card.type === "clock") {
      const now = new Date();
      body = `<div class="admin-ov-preview-clock"><div class="admin-ov-preview-clock-time">${now.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" })}</div><div class="admin-ov-preview-clock-date">${escapeHtml(BeastCore.formatDate(now))}</div></div>`;
    } else if (card.type === "energy") {
      const powerState = BeastHaSocket.getState(BeastConfig.get("panels.energy.powerSensor"));
      const watts = Number(powerState?.state);
      const label = Number.isFinite(watts) ? `${(watts / 1000).toFixed(1)} kW` : t("Ingen data endnu", "No data yet");
      body = `<div class="admin-ov-preview-hero">${BeastCore.icon("bolt", { size: 34 })}<div><strong>${escapeHtml(label)}</strong><span>${t("Forbrug nu", "Usage now")}</span></div></div>`;
    } else if (card.type === "heatpump") {
      const pumpId = card.entity || (BeastConfig.get("panels.heating.heatPumps") || [])[0];
      const pump = BeastHaSocket.getState(pumpId);
      const current = Number(pump?.attributes?.current_temperature);
      const target = Number(pump?.attributes?.temperature);
      const value = Number.isFinite(current) ? `${current.toFixed(1)}°` : t("Ingen data endnu", "No data yet");
      const detail = Number.isFinite(target) ? `${t("Mål", "Target")} ${target.toFixed(1)}°` : (pump?.state || "");
      body = `<div class="admin-ov-preview-hero">${BeastCore.icon("wind", { size: 34 })}<div><strong>${escapeHtml(value)}</strong><span>${escapeHtml(detail)}</span></div></div>`;
    } else if (card.type === "custom" && card.entity) {
      const state = BeastHaSocket.getState(card.entity);
      body = `<div class="admin-ov-preview-hero">${BeastCore.icon("grid", { size: 34 })}<div><strong>${escapeHtml(state?.state ?? "–")}</strong><span>${escapeHtml(state?.attributes?.friendly_name || card.entity)}</span></div></div>`;
    } else {
      body = `<div class="admin-ov-preview-hero"><div><strong>${escapeHtml(kicker)}</strong></div></div>`;
    }
    return `<div class="admin-ov-preview-card" data-card-type="${escapeHtml(card.type)}" style="${style}">${kickerHtml}<div class="admin-ov-preview-body">${body}</div></div>`;
  }

  // Refreshes just the text that changes on its own on the real dashboard
  // (clock tick, weather/security state) without rebuilding the whole
  // preview -- a full rebuild would tear down and restart the camera
  // iframe above on every tick, same reasoning as the screensaver preview
  // (see updateScreensaverPreviewClock).
  function updateVisualOverviewPreviewLiveBits() {
    const host = document.getElementById("adminOverviewVisualPreview");
    if (!host) return;
    const timeEl = host.querySelector(".admin-ov-preview-clock-time");
    const dateEl = host.querySelector(".admin-ov-preview-clock-date");
    if (timeEl || dateEl) {
      const now = new Date();
      if (timeEl) timeEl.textContent = now.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" });
      if (dateEl) dateEl.textContent = BeastCore.formatDate(now);
    }
    if (host.querySelector(".admin-ov-preview-weather-temp, .admin-ov-preview-security-text")) {
      const data = screensaverPreviewData();
      const tempEl = host.querySelector(".admin-ov-preview-weather-temp");
      const labelEl = host.querySelector(".admin-ov-preview-weather-label");
      if (tempEl) tempEl.textContent = data.weatherTemp;
      if (labelEl) labelEl.textContent = data.weatherLabel;
      const securityEl = host.querySelector(".admin-ov-preview-security-text");
      if (securityEl) securityEl.textContent = data.securityText;
    }
  }

  // A second, visually-real preview alongside the abstract labeled-box one
  // above -- same fixed-canvas-plus-transform:scale trick as the
  // screensaver preview, reusing the dashboard's own card chrome (see the
  // CSS comment in admin.css) instead of a from-scratch mockup.
  function refreshVisualOverviewPreview(cards) {
    const host = document.getElementById("adminOverviewVisualPreview");
    if (!host) return;
    host.innerHTML = `<div class="admin-overview-visual-canvas">${cards.map(overviewCardVisualMarkup).join("")}</div>`;
    document.querySelectorAll("[data-preview-camera-picture]").forEach((img) => {
      window.BeastAuth?.setAuthedImageSrc?.(img, img.dataset.previewCameraPicture);
    });
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
    const currentUpdateChannel = BeastConfig.get("updateChannel") === "beta" ? "beta" : "stable";
    return `<section class="admin-view${activeView === "updates" ? " is-active" : ""}" data-admin-view="updates">
      <div class="admin-card"><div class="admin-card-head"><div><h2>${t("Denne installation", "This installation")}</h2><p>${t("Versionen der kører lige nu, og hvad der senest er ændret.", "The version currently running and its latest changes.")}</p></div><div style="display:flex; align-items:center; gap:10px;"><div class="admin-channel-switch" role="group" aria-label="${t("Opdateringskanal", "Update channel")}"><button type="button" class="admin-channel-btn${currentUpdateChannel === "stable" ? " is-active" : ""}" data-update-channel="stable">Stable</button><button type="button" class="admin-channel-btn${currentUpdateChannel === "beta" ? " is-active" : ""}" data-update-channel="beta">Beta</button></div><button type="button" class="beast-btn" data-check-updates>${t("Tjek for opdateringer", "Check for updates")}</button></div></div>
        <div class="beast-stat-grid">${BeastCore.statTile({ icon: "sparkles", label: t("Nuværende version", "Current version"), value: t("Henter…", "Loading…"), meta: "…", id: "adminCurrentVersionTile" })}</div>
        <div class="admin-update-status" id="adminUpdateStatus" data-state="checking"><span class="admin-update-status-dot"></span><span id="adminUpdateStatusText">${t("Tjekker…", "Checking…")}</span></div>
        ${currentUpdateChannel === "beta" ? `<p class="admin-field-hint" style="margin:8px 0 0;">${t("Du følger Beta-kanalen — kan indeholde ændringer der endnu ikke er færdigtestede.", "You're following the Beta channel -- may include changes that haven't finished testing yet.")}</p>` : ""}
        <div id="adminInstallLatest" class="admin-install-latest-slot"><p class="admin-empty">${t("Henter…", "Loading…")}</p></div>
        <div id="adminUpdateSkipNote"></div>
        <details class="admin-changelog-details">
          <summary>${t("Vis ændringer og release notes", "Show changes and release notes")}</summary>
          <div class="admin-changelog-list" id="adminChangelogList"><p class="admin-empty">${t("Henter ændringslog…", "Loading changelog…")}</p></div>
        </details>
      </div>
      <div class="admin-card"><div class="admin-card-head"><div><h2>${t("Versionshistorik", "Version history")}</h2><p>${t("Du kan altid installere den nyeste version, eller vælge en ældre at gendanne. Den nuværende version gemmes altid først, så det kan fortrydes.", "You can always install the latest version or restore an older one. The current version is saved first so the change can be undone.")}</p></div><button type="button" class="beast-btn" data-reload-versions>${t("Opdatér liste", "Refresh list")}</button></div>
        <div id="adminVersionSection">
          <div class="admin-old-versions">
            <span class="admin-field-label">${t("Tidligere versioner", "Previous versions")}</span>
            <div class="admin-old-versions-row">
              <select id="adminOldVersionSelect" disabled><option value="">${t("Henter…", "Loading…")}</option></select>
              <button type="button" class="beast-btn" id="adminOldVersionRestoreBtn" data-rollback-version="" data-is-newer="false" data-is-latest="false" disabled>${t("Gendan valgte version", "Restore selected version")}</button>
            </div>
          </div>
          <div class="admin-old-versions admin-manual-install">
            <span class="admin-field-label">${t("Installer bestemt version fra GitHub", "Install a specific version from GitHub")}</span>
            <p class="admin-field-hint">${t("Til hvis auto-tjek ikke virker, eller du vil have en bestemt version. Indsæt et GitHub release-link eller bare versionsnummeret, fx v0.5.9.", "For when auto-check isn't working, or you want a specific version. Paste a GitHub release link or just the version number, e.g. v0.5.9.")}</p>
            <div class="admin-old-versions-row">
              <input type="text" id="adminManualTagInput" placeholder="v0.5.9 eller https://github.com/${escapeHtml(GITHUB_REPO)}/releases/tag/v0.5.9">
              <button type="button" class="beast-btn" id="adminManualInstallBtn" data-rollback-version="" data-install-source="github" data-install-tag="" data-is-newer="false" data-is-latest="false" disabled>${t("Installer denne version", "Install this version")}</button>
            </div>
            <span class="admin-save-state" id="adminManualTagState"></span>
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

  // Changelog entries from before this existed are plain strings (rendered
  // as-is regardless of language -- no practical way to retranslate years
  // of history). Newer entries store {da, en} per line so the changelog
  // actually follows the dashboard's language setting like everything else
  // in Admin, instead of always showing whatever language it happened to
  // be written in.
  function changelogLineText(change) {
    if (typeof change === "string") return change;
    if (!change || typeof change !== "object") return "";
    const lang = BeastLocalSettings.get("language", "en");
    return change[lang] || change.en || change.da || "";
  }

  function renderChangelogEntries(entries) {
    if (!entries.length) return `<p class="admin-empty">${t("Ingen ændringslog fundet.", "No changelog found.")}</p>`;
    return entries.map((entry) => `
      <article class="admin-changelog-entry">
        <header><strong>${escapeHtml(entry.tag || entry.version)}</strong><span>${escapeHtml(entry.date || "")}</span></header>
        ${Array.isArray(entry.changes) && entry.changes.length ? `<ul>${entry.changes.map((change) => `<li>${escapeHtml(changelogLineText(change))}</li>`).join("")}</ul>` : ""}
      </article>
    `).join("");
  }

  function setUpdateStatus(state, text) {
    const statusEl = document.getElementById("adminUpdateStatus");
    const textEl = document.getElementById("adminUpdateStatusText");
    if (statusEl) statusEl.dataset.state = state;
    if (textEl) textEl.textContent = text;
  }

  function compareBuildIds(left, right) {
    const a = String(left || "").match(/^(\d{8})-(\d+)$/);
    const b = String(right || "").match(/^(\d{8})-(\d+)$/);
    if (a && b) {
      const dateCompare = a[1].localeCompare(b[1]);
      return dateCompare || (Number(a[2]) - Number(b[2]));
    }
    return String(left || "").localeCompare(String(right || ""), undefined, { numeric: true });
  }

  async function loadUpdatesSettings(forceGithubRefresh = false) {
    const tile = document.getElementById("adminCurrentVersionTile");
    const changelogEl = document.getElementById("adminChangelogList");
    const installLatestEl = document.getElementById("adminInstallLatest");
    const oldSelect = document.getElementById("adminOldVersionSelect");
    const oldRestoreBtn = document.getElementById("adminOldVersionRestoreBtn");
    if (!tile && !changelogEl && !installLatestEl) return;
    setUpdateStatus("checking", t("Tjekker…", "Checking…"));
    try {
      const [versionsRes, changelogRes, githubRes] = await Promise.all([
        fetch("/api/versions.php", { cache: "no-store" }),
        fetch(`/changelog.json?_=${Date.now()}`, { cache: "no-store" }),
        fetch("/api/update.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check", force: Boolean(forceGithubRefresh), channel: BeastConfig.get("updateChannel") === "beta" ? "beta" : "stable" }) }).catch(() => null)
      ]);
      if (!versionsRes.ok) throw new Error(`HTTP ${versionsRes.status}`);
      const versionsPayload = await versionsRes.json();
      const changelog = changelogRes.ok ? await changelogRes.json() : [];
      const github = githubRes && githubRes.ok ? await githubRes.json() : null;
      const current = versionsPayload.currentVersion || "ukendt";
      const currentTag = versionsPayload.currentTag || null;
      const valueEl = tile?.querySelector(".beast-stat-tile-value");
      const metaEl = tile?.querySelector(".beast-stat-tile-meta");
      if (valueEl) valueEl.textContent = currentTag ? `HA Smartdash ${currentTag}` : formatVersionLabel(current);
      if (metaEl) metaEl.textContent = currentTag ? current : "";
      if (changelogEl) changelogEl.innerHTML = renderChangelogEntries(Array.isArray(changelog) ? changelog : []);

      const versions = versionsPayload.versions || [];
      // GitHub (for the currently selected channel) is the ONLY source for
      // "is there a new version" -- it used to be compared against the local
      // snapshot list too, but that list has no concept of channel at all
      // (a snapshot is just whatever this exact server has run before, e.g.
      // an earlier local test build). Letting it win when it was numerically
      // ahead of GitHub's channel-aware answer meant Stable could get
      // offered while on the Beta channel, or a stale local build could
      // shadow a real, newer release. Local snapshots are now used purely
      // for rollback (going backward to something older than "current"),
      // never for deciding what's new.
      const updateAvailable = Boolean(github?.updateAvailable && github?.remoteVersion);
      const latestVersion = updateAvailable ? github.remoteVersion : current;

      if (installLatestEl) {
        if (updateAvailable) {
          const changesContent = github.releaseNotes ? `<p class="admin-install-latest-notes">${escapeHtml(String(github.releaseNotes)).slice(0, 600)}</p>` : "";
          const changesHtml = changesContent
            ? `<details class="admin-install-latest-details"><summary>${t("Vis ændringer", "Show changes")}</summary>${changesContent}</details>`
            : "";
          const latestLabel = github.tag ? `HA Smartdash ${github.tag}` : formatVersionLabel(latestVersion);
          const betaBadge = github?.prerelease ? ` · Beta` : "";
          installLatestEl.innerHTML = `<div class="admin-install-latest"><div><strong>${t("Ny version klar", "New version ready")}${betaBadge}</strong><span>${escapeHtml(latestLabel)}</span></div><button type="button" class="beast-btn beast-btn-primary" data-rollback-version="${escapeHtml(latestVersion)}" data-is-newer="true" data-is-latest="true" data-install-source="github" data-install-tag="${escapeHtml(github.tag || "")}">${t("Installer ny version", "Install new version")}</button>${changesHtml}</div>`;
        } else {
          installLatestEl.innerHTML = `<p class="admin-empty">${t("Du kører den nyeste version.", "You're on the latest version.")}</p>`;
        }
      }
      const skipNoteEl = document.getElementById("adminUpdateSkipNote");
      if (skipNoteEl) {
        skipNoteEl.innerHTML = github?.skipAutoInstall
          ? `<p class="admin-field-hint">${t("Automatisk idle-installation er sat på pause for denne version — typisk fordi den blev rullet tilbage fra for nylig. \"Installer ny version\" ovenfor virker stadig manuelt.", "Idle auto-install is paused for this version -- usually because it was recently rolled back from. The manual \"Install new version\" button above still works.")} <button type="button" class="beast-btn" id="adminClearUpdateSkip" style="margin-left:8px;">${t("Fjern pause", "Clear pause")}</button></p>`
          : "";
      }
      const oldVersions = versions.filter((item) => item.version !== current && item.version !== latestVersion);
      if (oldSelect) {
        oldSelect.disabled = !oldVersions.length;
        oldSelect.innerHTML = oldVersions.length
          ? oldVersions.map((item) => {
            const size = item.sizeKb < 1024 ? `${item.sizeKb} KB` : `${(item.sizeKb / 1024).toFixed(1)} MB`;
            const label = item.tag || formatVersionLabel(item.version);
            return `<option value="${escapeHtml(item.version)}">${escapeHtml(label)} · ${size}</option>`;
          }).join("")
          : `<option value="">${t("Ingen andre versioner gemt", "No other versions saved")}</option>`;
      }
      if (oldRestoreBtn) {
        oldRestoreBtn.disabled = !oldVersions.length;
        oldRestoreBtn.dataset.rollbackVersion = oldVersions.length ? oldVersions[0].version : "";
        oldRestoreBtn.dataset.installSource = "local";
      }
      if (!versionsPayload.hasCurrentSnapshot) {
        await fetch("/api/versions.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "snapshot" }) });
      }
      const checkedAt = new Date().toLocaleTimeString();
      if (updateAvailable) {
        const latestStatusLabel = github.tag || latestVersion;
        const betaSuffix = github?.prerelease ? " (beta)" : "";
        setUpdateStatus("outdated", t(`Ny version tilgængelig: ${latestStatusLabel}${betaSuffix} · tjekket ${checkedAt}`, `New version available: ${latestStatusLabel}${betaSuffix} · checked ${checkedAt}`));
      } else if (!github) {
        setUpdateStatus("current", t(`Du kører den nyeste version (kunne ikke tjekke GitHub) · tjekket ${checkedAt}`, `You're on the latest version (couldn't reach GitHub) · checked ${checkedAt}`));
      } else {
        setUpdateStatus("current", t(`Du kører den nyeste version · tjekket ${checkedAt}`, `You're on the latest version · checked ${checkedAt}`));
      }
    } catch (error) {
      if (changelogEl) changelogEl.innerHTML = `<p class="admin-empty">${t("Kunne ikke hente ændringslog.", "Could not load the changelog.")}</p>`;
      if (installLatestEl) installLatestEl.innerHTML = `<p class="admin-empty">${t("Kunne ikke hente versionshistorik.", "Could not load version history.")}</p>`;
      setUpdateStatus("error", t("Kunne ikke tjekke for opdateringer", "Could not check for updates"));
    }
  }

  async function rollbackToVersion(version) {
    const response = await fetch("/api/versions.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rollback", version }) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function installFromGithub(tag) {
    const response = await fetch("/api/update.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "install", tag: tag || undefined }) });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
    return payload;
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
    return `
      <section class="admin-view${activeView === "settings" ? " is-active" : ""}" data-admin-view="settings">
        <div class="admin-settings-intro"><div><h2>Denne enhed</h2><p>Maskinspecifik adfærd for netop denne kiosk eller browser. Visuelle valg (tema, farver, stil) findes under Tema og design.</p></div></div>
        <div class="admin-card admin-settings-group"><div class="admin-card-head"><div><h2>Dashboard på denne skærm</h2><p>Forbindelsesstatus og elementer, som kun påvirker den aktuelle kiosk eller browser.</p></div></div><div class="beast-stat-grid">
          ${BeastCore.statTile({ icon: "check", label: "HA-forbindelse", value: CONN_STATUS_LABELS[currentConnState] || currentConnState, id: "adminConnTile" })}
          ${BeastCore.statTile({ icon: "grid", label: "Entities i cache", value: String(BeastHaSocket.getAllStates().size), id: "adminCountTile" })}
          ${BeastCore.statTile({
            icon: "music", label: "Flydende afspiller", value: floatingPlayerOn ? "Vises på forsiden" : "Skjult",
            id: "adminFloatingPlayerTile",
            extra: `<div class="beast-stat-tile-actions"><button type="button" class="beast-security-action-btn${floatingPlayerOn ? " is-disarm" : ""}" id="adminFloatingPlayerBtn">${floatingPlayerOn ? "Slå fra" : "Slå til"}</button></div>`
          })}
        </div></div>
        <div class="admin-card admin-settings-group"><div class="admin-card-head"><div><h2>Kioskintegration</h2><p>Avanceret MQTT-styring og enhedskommandoer. Kan ignoreres på almindelige tablets.</p></div></div>${renderMqttPanel()}</div>
        <div class="admin-card admin-settings-group admin-diagnostics"><div class="admin-card-head"><div><h2>Diagnostik og session</h2><p>Seneste lokale hændelser samt mulighed for at logge Home Assistant-sessionen ud.</p></div></div><details><summary>Vis teknisk log</summary><pre class="beast-debug-log" id="adminDebugLog"></pre></details><button type="button" class="beast-btn" id="adminLogout">Log ud</button></div>
      </section>
    `;
  }

  const WEATHER_CONDITION_LABELS = {
    sunny: ["Solrigt", "Sunny"], partlycloudy: ["Delvist skyet", "Partly cloudy"], cloudy: ["Skyet", "Cloudy"],
    rainy: ["Regn", "Rainy"], pouring: ["Kraftig regn", "Pouring"], fog: ["Tåget", "Foggy"],
    windy: ["Blæsende", "Windy"], "windy-variant": ["Blæsende", "Windy"], lightning: ["Torden", "Thunder"],
    "lightning-rainy": ["Tordenbyger", "Thunderstorm"], snowy: ["Sne", "Snowy"], "clear-night": ["Klart", "Clear"]
  };

  function screensaverPreviewData() {
    const now = new Date();
    const weatherState = BeastHaSocket.getState(BeastConfig.get("panels.weather.entity"));
    const condition = weatherState && !["unknown", "unavailable"].includes(weatherState.state) ? weatherState.state : "";
    const temperature = Number(weatherState?.attributes?.temperature);
    const security = BeastConfig.get("panels.security") || {};
    const openDoors = (security.openingSensors || []).filter((id) => BeastHaSocket.getState(id)?.state === "on").length;
    const unlocked = (security.locks || []).filter((id) => {
      const value = BeastHaSocket.getState(id)?.state;
      return value && !["locked", "unknown", "unavailable"].includes(value);
    }).length;
    const conditionLabels = WEATHER_CONDITION_LABELS[condition];
    return {
      time: now.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" }),
      date: now.toLocaleDateString("da-DK", { weekday: "long", day: "numeric", month: "long" }),
      weatherLabel: conditionLabels ? t(conditionLabels[0], conditionLabels[1]) : condition || t("Aktuelt vejr", "Current weather"),
      weatherTemp: Number.isFinite(temperature) ? `${Math.round(temperature)}°` : "–",
      securityText: (unlocked || openDoors) ? t(`${openDoors} åbne · ${unlocked} ulåste`, `${openDoors} open · ${unlocked} unlocked`) : t("Huset er sikret", "House is secured"),
      hasWeatherData: Number.isFinite(temperature)
    };
  }

  // A checkbox grid (matching the "Synlige sider" pattern) instead of a
  // native <select multiple> -- ctrl/cmd-click to multi-select isn't
  // discoverable, especially for picking as few as 0-3 items.
  function cameraCheckboxListHtml(id, selectedIds) {
    const cameras = BeastEntityPicker.candidates({ domain: "camera" });
    if (!cameras.length) return `<p class="admin-empty">${t("Ingen kamera-entities fundet.", "No camera entities found.")}</p>`;
    const selected = new Set(selectedIds || []);
    return `<div class="admin-checkbox-grid" id="${id}">${cameras.map((camera) => `<label${selected.size >= 3 && !selected.has(camera.id) ? " class=\"is-disabled\"" : ""}><input type="checkbox" value="${escapeHtml(camera.id)}"${selected.has(camera.id) ? " checked" : ""}${selected.size >= 3 && !selected.has(camera.id) ? " disabled" : ""}><span>${escapeHtml(camera.name)}</span></label>`).join("")}</div>`;
  }

  // Mirrors app.js's ambientCameraMarkup() -- duplicated rather than shared
  // since admin/index.html and beast.html are separate script contexts.
  // Absolute-path camera-player.html src (not "./") since this markup is
  // used from /admin/.
  function ambientPreviewCameraMarkup(config) {
    const ids = (config.cameraEntities || []).filter(Boolean).slice(0, 3);
    if (!ids.length) return "";
    // resolveCamera(), not getAllCameras().find() -- see the matching
    // comment in app.js's ambientCameraMarkup().
    const tiles = ids.map((id) => {
      const camera = window.BeastCameras?.resolveCamera?.(id);
      if (!camera) return "";
      if (camera.streamName) {
        const src = `/camera-player.html?v=14&transport=mse&sub=1&src=${encodeURIComponent(camera.streamName)}`;
        return `<div class="beast-ambient-camera-tile"><iframe class="beast-ambient-camera-tile-frame" src="${src}" allow="autoplay"></iframe></div>`;
      }
      if (camera.entityPicture) {
        return `<div class="beast-ambient-camera-tile"><img class="beast-ambient-camera-tile-frame" data-ambient-preview-picture="${camera.entityPicture}" alt=""></div>`;
      }
      return "";
    }).filter(Boolean).join("");
    return tiles ? `<div class="beast-ambient-camera-row">${tiles}</div>` : "";
  }

  // A scaled, real replica of the actual ambient screen (same
  // .beast-ambient-* classes/CSS as the live kiosk overlay, inside a fixed
  // 1280x720 canvas transformed down to fit the preview box) rather than a
  // simplified mockup, so background/clock size/camera genuinely show what
  // it'll look like. The camera iframe is only rebuilt when this whole
  // function re-runs (view switch or after Save) -- the 1s preview tick
  // only patches the clock text, so a live feed doesn't restart every
  // second (see updateScreensaverPreviewClock).
  function renderScreensaverPreview() {
    const data = screensaverPreviewData();
    const screensaver = BeastLocalSettings.get("screensaver", BeastConfig.get("screensaver")) || {};
    const clockSizeClass = screensaver.clockSize && screensaver.clockSize !== "medium" ? ` is-size-${screensaver.clockSize}` : "";
    const hasBg = Boolean(screensaver.backgroundImageUrl || screensaver.backgroundColor);
    const bgStyle = screensaver.backgroundImageUrl
      ? ` style="background-image:url('${escapeHtml(screensaver.backgroundImageUrl)}')"`
      : screensaver.backgroundColor ? ` style="background-color:${escapeHtml(screensaver.backgroundColor)}"` : "";
    const cameraRowHtml = ambientPreviewCameraMarkup(screensaver);
    return `<div class="admin-ambient-preview">
      <div class="admin-ambient-preview-canvas">
        <div class="beast-ambient-mode is-visible${hasBg ? " has-custom-background" : ""}${cameraRowHtml ? " has-camera-row" : ""}"${bgStyle}>
          <div class="beast-ambient-main">
            <div class="beast-ambient-time${clockSizeClass}">${data.time}</div>
            <div class="beast-ambient-date">${escapeHtml(data.date)}</div>
            <div class="beast-ambient-summary">
              <span>${BeastCore.icon("cloud", { size: 26 })}<b>${data.weatherTemp}</b>${escapeHtml(data.weatherLabel)}</span>
              <span>${BeastCore.icon("shield", { size: 25 })}<b>${escapeHtml(data.securityText)}</b></span>
            </div>
            ${screensaver.brightnessEnabled ? `<div class="beast-ambient-brightness">${BeastCore.icon("sun", { size: 16 })}<span>${Number(screensaver.brightnessPercent) || 80}%</span></div>` : ""}
          </div>
          <div class="beast-ambient-bottom${cameraRowHtml ? " has-cameras" : ""}">${cameraRowHtml}<small>${t("Tryk på skærmen for at åbne dashboardet", "Tap the screen to open the dashboard")}</small></div>
        </div>
      </div>
    </div>
    ${data.hasWeatherData ? "" : `<p class="admin-screensaver-preview-warning">${t("Ingen vejrdata endnu — tjek at Vejr-entity er valgt under Opsætning → Vejr.", "No weather data yet — check that a weather entity is selected under Setup → Weather.")}</p>`}`;
  }

  function updateScreensaverPreviewClock() {
    const host = document.getElementById("adminScreensaverPreviewHost");
    if (!host) return;
    const data = screensaverPreviewData();
    const timeEl = host.querySelector(".beast-ambient-time");
    const dateEl = host.querySelector(".beast-ambient-date");
    if (timeEl) timeEl.textContent = data.time;
    if (dateEl) dateEl.textContent = data.date;
  }

  function renderScreensaverView() {
    const screensaver = BeastLocalSettings.get("screensaver", BeastConfig.get("screensaver")) || { enabled: true, schedule: "custom", startTime: "23:00", endTime: "05:30", offAfterMinutes: 5 };
    return `<section class="admin-view${activeView === "screensaver" ? " is-active" : ""}" data-admin-view="screensaver">
      <div class="admin-settings-intro"><div><h2>${t("Pauseskærm", "Screensaver")}</h2><p>${t("Styrer denne skærm/browser alene — hver kiosk kan have sin egen tidsplan og kan slås helt fra uden at påvirke andre skærme.", "Controls this screen/browser only — each kiosk can have its own schedule and can be turned off entirely without affecting other screens.")}</p></div></div>
      <div class="admin-card admin-settings-group"><div class="admin-card-head"><div><h2>${t("Tidsplan", "Schedule")}</h2><p>${t("Bestem hvornår pauseskærmen må vise sig, og om den skal være aktiv overhovedet.", "Decide when the screensaver is allowed to show, and whether it's active at all.")}</p></div></div><div class="beast-mqtt-config">
        <label><span>${t("Pauseskærm", "Screensaver")}</span>
          <select id="adminScreensaverEnabled">
            <option value="1" ${screensaver.enabled ? "selected" : ""}>${t("Til", "On")}</option>
            <option value="0" ${!screensaver.enabled ? "selected" : ""}>${t("Fra — aldrig aktiv", "Off — never active")}</option>
          </select>
        </label>
        <label><span>${t("Tidsrum", "Time window")}</span>
          <select id="adminScreensaverSchedule">
            <option value="custom" ${screensaver.schedule !== "always" ? "selected" : ""}>${t("Bestemt tidsrum", "Specific time window")}</option>
            <option value="always" ${screensaver.schedule === "always" ? "selected" : ""}>${t("Altid, når skærmen er i ro", "Always, whenever the screen is idle")}</option>
          </select>
        </label>
        <label><span>${t("Starttidspunkt", "Start time")}</span><input type="time" id="adminScreensaverStart" value="${escapeHtml(screensaver.startTime || "23:00")}"></label>
        <label><span>${t("Sluttidspunkt", "End time")}</span><input type="time" id="adminScreensaverEnd" value="${escapeHtml(screensaver.endTime || "05:30")}"></label>
        <label><span>${t("Slukker helt efter (minutter)", "Turns off completely after (minutes)")}</span><input type="number" min="1" max="60" id="adminScreensaverOffAfter" value="${Number(screensaver.offAfterMinutes) || 5}"></label>
      </div></div>
      <div class="admin-card admin-settings-group"><div class="admin-card-head"><div><h2>${t("Design", "Design")}</h2><p>${t("Et billede har forrang frem for farven, hvis begge er sat.", "An image takes priority over the color if both are set.")}</p></div></div><div class="admin-bg-section">
        <div class="admin-bg-row">
          <label class="admin-field admin-bg-url"><span>${t("Baggrundsbillede — adresse", "Background image — address")}</span><input type="text" id="adminScreensaverBgUrl" value="${escapeHtml(screensaver.backgroundImageUrl || "")}" placeholder="https://…"></label>
          <label class="admin-bg-upload-btn"><span>${t("Vælg fil", "Choose file")}</span><input type="file" id="adminScreensaverBgFile" accept="image/png,image/jpeg,image/webp"></label>
        </div>
        <p class="admin-field-hint">${t("PNG, JPEG eller WebP · højst 1 MB", "PNG, JPEG or WebP · max 1 MB")}</p>
        <div class="admin-bg-color-row">
          <label class="admin-bg-color-toggle"><input type="checkbox" id="adminScreensaverBgColorEnabled"${screensaver.backgroundColor ? " checked" : ""}><span>${t("Brug baggrundsfarve", "Use background color")}</span></label>
          <input type="color" class="admin-bg-color-swatch" id="adminScreensaverBgColor" value="${escapeHtml(screensaver.backgroundColor || "#03060c")}">
          <button type="button" class="beast-btn admin-bg-clear" id="adminScreensaverBgClear">${t("Ryd baggrund", "Clear background")}</button>
        </div>
        <label class="admin-field admin-clock-size"><span>${t("Urets størrelse", "Clock size")}</span>
          <select id="adminScreensaverClockSize">
            <option value="small" ${screensaver.clockSize === "small" ? "selected" : ""}>${t("Lille", "Small")}</option>
            <option value="medium" ${!screensaver.clockSize || screensaver.clockSize === "medium" ? "selected" : ""}>${t("Mellem", "Medium")}</option>
            <option value="large" ${screensaver.clockSize === "large" ? "selected" : ""}>${t("Stor", "Large")}</option>
          </select>
        </label>
        <div class="admin-field-full"><span>${t("Kameraer i bunden (op til 3)", "Cameras at the bottom (up to 3)")}</span>${cameraCheckboxListHtml("adminScreensaverCameraEntities", screensaver.cameraEntities || [])}</div>
        <p class="admin-field-hint">${t("Vælg 0-3 kameraer — vises som små felter i bunden af pauseskærmen (1 kamera vises centreret, uden kamera vises uret centreret på skærmen som normalt).", "Pick 0-3 cameras — shown as small tiles at the bottom of the screensaver (1 camera is centered, with none the clock is centered on screen as normal).")}</p>
        <label class="admin-field admin-clock-size"><span>${t("Lysstyrke-skyder på pauseskærmen", "Brightness slider on the screensaver")}</span>
          <select id="adminScreensaverBrightnessEnabled">
            <option value="0" ${screensaver.brightnessEnabled ? "" : "selected"}>${t("Fra", "Off")}</option>
            <option value="1" ${screensaver.brightnessEnabled ? "selected" : ""}>${t("Til — styrer kioskskærmens egen light-entity (sat op under Grundindstillinger → Kiosk & dørklokke)", "On — controls the kiosk screen's own light entity (set up under Basic settings → Kiosk & doorbell)")}</option>
          </select>
        </label>
      </div></div>
      <div class="admin-save-bar">
        <button type="button" class="beast-btn beast-btn-primary" id="adminScreensaverSave">${t("Gem pauseskærm", "Save screensaver")}</button>
        <span class="admin-save-bar-hint">${t("Gemmer tidsplan, design og lysstyrke ovenfor samlet.", "Saves the schedule, design and brightness above together.")}</span>
        <span class="admin-save-state" data-save-state="screensaver"></span>
      </div>
      <div class="admin-card admin-settings-group"><div class="admin-card-head"><div><h2>${t("Forhåndsvisning", "Preview")}</h2><p>${t("Sådan ser pauseskærmen ud lige nu, med rigtige data — nyttigt til at tjekke at vejret, kamera og design rent faktisk vises.", "How the screensaver looks right now, with real data — useful for checking the weather, camera and design actually show.")}</p></div></div>
        <div id="adminScreensaverPreviewHost">${renderScreensaverPreview()}</div>
      </div>
    </section>`;
  }

  function renderAdvarslerView() {
    const features = BeastConfig.get("features") || {};
    const app = BeastConfig.get("appEntities") || {};
    const banners = BeastConfig.get("banners") || {};
    const printer = BeastConfig.get("panels.printer") || {};
    const security = BeastConfig.get("panels.security") || {};
    const printerConfigured = Boolean(printer.statusSensor);
    const doorsConfigured = Boolean((security.locks || []).length || (security.openingSensors || []).length);
    return `<section class="admin-view${activeView === "advarsler" ? " is-active" : ""}" data-admin-view="advarsler">
      <div class="admin-settings-intro"><div><h2>${t("Advarsler", "Alerts")}</h2><p>${t("Samlet sted for dashboardets banner-advarsler. Flere kan være synlige på samme tid, hver kan trækkes rundt på skærmen og huskes hver for sig.", "One place for the dashboard's banner alerts. Several can be visible at once, each can be dragged around the screen and remembers its own position.")}</p></div></div>
      <div class="admin-card admin-settings-group"><div class="admin-card-head"><div><h2>${t("Visning", "Layout")}</h2><p>${t("Vælg om flere samtidige advarsler vises som separate kort, eller stakket i ét fælles kort.", "Choose whether several alerts at once show as separate cards, or stacked in one shared card.")}</p></div></div><div class="beast-mqtt-config">
        <label><span>${t("Advarsel-layout", "Alert layout")}</span>
          <select id="adminAdvarslerLayoutMode">
            <option value="separate" ${banners.layoutMode !== "stacked" ? "selected" : ""}>${t("Separate kort", "Separate cards")}</option>
            <option value="stacked" ${banners.layoutMode === "stacked" ? "selected" : ""}>${t("Ét samlet kort", "One combined card")}</option>
          </select>
        </label>
      </div></div>
      <div class="admin-card admin-settings-group"><div class="admin-card-head"><div><h2>${t("Post-banner", "Post banner")}</h2><p>${t("Viser et billede af postkassen og en kort beskrivelse, når der registreres post.", "Shows a picture of the mailbox and a short description when post is registered.")}</p></div></div><div class="beast-mqtt-config">
        <label><span>${t("Post-banner", "Post banner")}</span>
          <select id="adminAdvarslerPostBanner">
            <option value="1" ${features.postBanner !== false ? "selected" : ""}>${t("Til", "On")}</option>
            <option value="0" ${features.postBanner === false ? "selected" : ""}>${t("Fra — vises aldrig", "Off — never shown")}</option>
          </select>
        </label>
        <label><span>${t("Post registreret (valgfri)", "Post registered (optional)")}</span>${BeastEntityPicker.selectHtml({ id: "adminAdvarslerMailPresent", domain: "input_boolean", keywordHints: ["post", "mail"], selected: app.mailPresent })}</label>
        <label><span>${t("Antal post (valgfri)", "Post count (optional)")}</span>${BeastEntityPicker.selectHtml({ id: "adminAdvarslerMailCount", domain: "sensor", keywordHints: ["post", "mail"], selected: app.mailCount })}</label>
        <label><span>${t("Postbeskrivelse (valgfri)", "Post description (optional)")}</span>${BeastEntityPicker.selectHtml({ id: "adminAdvarslerMailDescription", domain: "sensor", keywordHints: ["post", "mail"], selected: app.mailDescription })}</label>
        <label><span>${t("Postkasse-billede · Indkørsel (primær, valgfri)", "Mailbox picture · Driveway (primary, optional)")}</span>${BeastEntityPicker.selectHtml({ id: "adminAdvarslerMailImage", domain: "input_text", keywordHints: ["indkorsel", "indkørsel", "post", "mail", "billede", "snapshot", "foto", "postkasse"], selected: app.mailImage })}</label>
        <label><span>${t("Postkasse-billede · Carport (valgfri)", "Mailbox picture · Carport (optional)")}</span>${BeastEntityPicker.selectHtml({ id: "adminAdvarslerMailImageCarport", domain: "input_text", keywordHints: ["carport", "post", "mail", "billede", "snapshot", "foto", "postkasse"], selected: app.mailImageCarport })}</label>
        <label><span>${t("Postkasse-billede · Forhaven (valgfri)", "Mailbox picture · Front yard (optional)")}</span>${BeastEntityPicker.selectHtml({ id: "adminAdvarslerMailImageForhaven", domain: "input_text", keywordHints: ["forhaven", "post", "mail", "billede", "snapshot", "foto", "postkasse"], selected: app.mailImageForhaven })}</label>
      </div></div>
      <div class="admin-card admin-settings-group"><div class="admin-card-head"><div><h2>${t("3D-printer", "3D printer")}</h2><p>${t("Viser printerens kamerabillede og fremgang, mens den printer eller er på pause.", "Shows the printer's camera image and progress while it's printing or paused.")}</p></div></div><div class="beast-mqtt-config">
        <label><span>${t("3D-printer-banner", "3D printer banner")}</span>
          <select id="adminAdvarslerPrinterBanner">
            <option value="1" ${features.printerBanner !== false ? "selected" : ""}>${t("Til", "On")}</option>
            <option value="0" ${features.printerBanner === false ? "selected" : ""}>${t("Fra — vises aldrig", "Off — never shown")}</option>
          </select>
        </label>
        <label><span>${t("Printer-kamera (valgfri override)", "Printer camera (optional override)")}</span>${BeastEntityPicker.selectHtml({ id: "adminAdvarslerPrinterCamera", domain: "camera", keywordHints: ["printer", "3d", "bambu"], selected: BeastConfig.get("banners.printerCameraOverride") })}</label>
        <p class="admin-field-hint">${t("Bruges i stedet for printerens eget kamerabillede, hvis valgt — fx et separat Protect-kamera rettet mod printeren.", "Used instead of the printer's own built-in camera image, if set — e.g. a separate Protect camera pointed at the printer.")}</p>
        ${printerConfigured ? "" : `<p class="admin-field-hint">${t("Ingen printer-entities fundet endnu — sæt printeren op under Indstillinger → 3D Printer, så virker banneret automatisk.", "No printer entities found yet — set the printer up under Settings → 3D Printer, and the banner will work automatically.")}</p>`}
      </div></div>
      <div class="admin-card admin-settings-group"><div class="admin-card-head"><div><h2>${t("Døre, vinduer & låse", "Doors, windows & locks")}</h2><p>${t("Viser en kompakt advarsel, hvis en dør, et vindue eller en lås fra Sikkerhed har stået åben/ulåst længere end angivet.", "Shows a compact warning if a door, window or lock from Security has been open/unlocked longer than the time set below.")}</p></div></div><div class="beast-mqtt-config">
        <label><span>${t("Døre, vinduer & låse-banner", "Doors, windows & locks banner")}</span>
          <select id="adminAdvarslerDoorBanner">
            <option value="1" ${features.doorBanner !== false ? "selected" : ""}>${t("Til", "On")}</option>
            <option value="0" ${features.doorBanner === false ? "selected" : ""}>${t("Fra — vises aldrig", "Off — never shown")}</option>
          </select>
        </label>
        <label><span>${t("Advar efter (minutter)", "Warn after (minutes)")}</span><input type="number" min="1" max="720" id="adminAdvarslerDoorMinutes" value="${Number(banners.doorOpenTooLongMinutes) || 15}"></label>
        ${doorsConfigured ? "" : `<p class="admin-field-hint">${t("Ingen døre/låse fundet endnu — sæt dem op under Sikkerhed, så virker banneret automatisk.", "No doors/locks found yet — set them up under Security, and the banner will work automatically.")}</p>`}
      </div>
        <label class="admin-security-toggle admin-schedule-toggle"><span><strong>${t("Kun advar i et bestemt tidsrum", "Only warn within a time window")}</strong><small>${t("Fx kun om natten — ellers vises advarslen når som helst tærsklen er nået.", "E.g. overnight only — otherwise the warning shows any time the threshold is reached.")}</small></span><input type="checkbox" id="adminAdvarslerScheduleEnabled"${banners.scheduleEnabled ? " checked" : ""}></label>
        <div class="admin-schedule-fields" id="adminAdvarslerScheduleFields"${banners.scheduleEnabled ? "" : " hidden"}>
          <label><span>${t("Fra", "From")}</span><input type="time" id="adminAdvarslerScheduleStart" value="${escapeHtml(banners.scheduleStart || "22:00")}"></label>
          <label><span>${t("Til", "To")}</span><input type="time" id="adminAdvarslerScheduleEnd" value="${escapeHtml(banners.scheduleEnd || "06:00")}"></label>
        </div>
      </div>
      <div class="admin-card admin-settings-group"><div class="admin-card-head"><div><h2>${t("AULA", "AULA")}</h2><p>${t("Skole-besked og kommende lektioner fra de skoleskema-kalendere der er valgt under Kalender & affald.", "School messages and upcoming lessons from the schedule calendars picked under Calendar & waste.")}</p></div></div><div class="beast-mqtt-config">
        <label><span>${t("AULA-besked-banner", "AULA message banner")}</span>
          <select id="adminAdvarslerAulaMessageBanner">
            <option value="1" ${features.aulaMessageBanner === true ? "selected" : ""}>${t("Til", "On")}</option>
            <option value="0" ${features.aulaMessageBanner !== true ? "selected" : ""}>${t("Fra — vises aldrig", "Off — never shown")}</option>
          </select>
        </label>
        <label><span>${t("Lektions-banner", "Lesson banner")}</span>
          <select id="adminAdvarslerAulaLessonBanner">
            <option value="1" ${features.aulaLessonBanner === true ? "selected" : ""}>${t("Til", "On")}</option>
            <option value="0" ${features.aulaLessonBanner !== true ? "selected" : ""}>${t("Fra — vises aldrig", "Off — never shown")}</option>
          </select>
        </label>
        <label><span>${t("Advar før lektion (minutter)", "Warn before lesson (minutes)")}</span><input type="number" min="1" max="60" id="adminAdvarslerAulaMinutes" value="${Number(banners.aulaLessonMinutes) || 10}"></label>
        <label><span>${t("AULA besked-sensor (valgfri)", "AULA message sensor (optional)")}</span>${BeastEntityPicker.selectHtml({ id: "adminAdvarslerAulaMessage", domain: "binary_sensor", keywordHints: ["aula", "besked", "message"], selected: app.aulaMessageSensor })}</label>
        <p class="admin-field-hint">${t("Kræver mindst én skoleskema-kalender valgt under Kalender & affald.", "Requires at least one schedule calendar picked under Calendar & waste.")}</p>
      </div></div>
      <div class="admin-actions"><button type="button" class="beast-btn beast-btn-primary" id="adminAdvarslerSave">${t("Gem advarsler", "Save alerts")}</button><span class="admin-save-state" data-save-state="advarsler"></span></div>
    </section>`;
  }

  function renderSecurityView() {
    const hasPin = window.BeastScreenLock?.hasPin();
    const autoLockOn = window.BeastScreenLock?.isAutoLockEnabled();
    const alarmScreenOffOn = window.BeastScreenLock?.isAlarmScreenOffEnabled();
    const selectedLockAlarm = BeastConfig.get("screenLock.alarmEntity") || BeastConfig.get("panels.security.primaryAlarm");
    const alarmUnlockMode = BeastConfig.get("screenLock.alarmUnlockMode") === "disarm" ? "disarm" : "pin";
    const showAdminButton = BeastConfig.get("showAdminButton") !== false;
    return `<section class="admin-view${activeView === "security-settings" ? " is-active" : ""}" data-admin-view="security-settings">
      <div class="admin-security-hero"><span>${BeastCore.icon("shield", { size: 30 })}</span><div><h2>${t("Sikkerhed og adgang", "Security and access")}</h2><p>${t("Administrér skærmlås, gendannelse og adgangen til adminpanelet samlet ét sted.", "Manage screen locking, recovery and Admin access in one place.")}</p></div></div>
      <div class="admin-card admin-settings-group"><div class="admin-card-head"><div><h2>${t("Pinkode og skærmlås", "PIN and screen lock")}</h2><p>${t("Pinkoden gemmes i serverkonfigurationen og gælder på alle skærme.", "The PIN is stored in the server configuration and applies to every screen.")}</p></div></div><div class="beast-stat-grid">
        ${BeastCore.statTile({ icon:"lock", label:t("Pinkode", "PIN"), value:hasPin ? t("Aktiveret", "Enabled") : t("Ikke oprettet", "Not configured"), id:"adminPinTile", extra:`<div class="beast-stat-tile-actions"><button type="button" class="beast-security-action-btn" id="adminPinSet">${hasPin ? t("Skift pinkode", "Change PIN") : t("Opret pinkode", "Create PIN")}</button>${hasPin ? `<button type="button" class="beast-security-action-btn is-disarm" id="adminPinRemove">${t("Fjern", "Remove")}</button>` : ""}</div>` })}
        ${BeastCore.statTile({ icon:"shield", label:t("Automatisk lås", "Automatic lock"), value:autoLockOn ? t("Til ved fuld sikring", "On when fully armed") : t("Fra", "Off"), id:"adminAutoLockTile", extra:`<div class="beast-stat-tile-actions"><button type="button" class="beast-security-action-btn${autoLockOn ? " is-disarm" : ""}" id="adminAutoLockBtn" ${hasPin ? "" : "disabled"}>${autoLockOn ? t("Slå fra", "Turn off") : t("Slå til", "Turn on")}</button></div>` })}
        ${BeastCore.statTile({ icon:"moon", label:t("Skærm ved alarm", "Display after alarm"), value:alarmScreenOffOn ? t("Sluk efter lås", "Switch off after lock") : t("Forbliv tændt", "Stay on"), id:"adminAlarmScreenOffTile", extra:`<div class="beast-stat-tile-actions"><button type="button" class="beast-security-action-btn${alarmScreenOffOn ? " is-disarm" : ""}" id="adminAlarmScreenOffBtn" ${hasPin ? "" : "disabled"}>${alarmScreenOffOn ? t("Behold skærmen tændt", "Keep display on") : t("Sluk skærmen", "Switch display off")}</button></div>` })}
        ${BeastCore.statTile({ icon:"lock", label:t("Lås denne skærm", "Lock this screen"), value:hasPin ? t("Klar", "Ready") : t("Kræver pinkode", "PIN required"), id:"adminLockNowTile", extra:`<div class="beast-stat-tile-actions"><button type="button" class="beast-security-action-btn" id="adminLockNowBtn" ${hasPin ? "" : "disabled"}>${t("Lås nu", "Lock now")}</button></div>` })}
      </div><div class="admin-security-alarm-rule"><label class="admin-field"><span>${t("Alarm der låser kiosken", "Alarm that locks the kiosk")}</span>${BeastEntityPicker.selectHtml({ id:"adminLockAlarmEntity", domain:"alarm_control_panel", selected:selectedLockAlarm })}<small>${t("Listen viser udelukkende alarm-enheder fra Home Assistant.", "Only Home Assistant alarm entities are shown.")}</small></label><label class="admin-field"><span>${t("Når alarmen frakobles", "When the alarm is disarmed")}</span><select id="adminAlarmUnlockMode"><option value="pin"${alarmUnlockMode === "pin" ? " selected" : ""}>${t("Behold låsen · kræv PIN ved første brug", "Keep lock · require PIN on first use")}</option><option value="disarm"${alarmUnlockMode === "disarm" ? " selected" : ""}>${t("Fjern låsen · følg normal presence-styring", "Remove lock · resume presence control")}</option></select></label><div><strong>${t("Ved fuld sikring", "When fully armed")}</strong><small>${t("Dashboardet låses, og den valgte kioskskærm kan slukkes bagefter.", "The dashboard locks and the selected kiosk display can switch off afterwards.")}</small><button type="button" class="beast-security-action-btn" id="adminSaveAlarmLockRule">${t("Gem alarmregel", "Save alarm rule")}</button></div></div>${hasPin ? `<div class="admin-security-recovery"><div><strong>${t("Glemt din pinkode?", "Forgot your PIN?")}</strong><p>${t("Bekræft din identitet med et nyt Home Assistant-login, og opret derefter en ny kode.", "Confirm your identity with a new Home Assistant login, then set a new code.")}</p></div><button type="button" class="beast-security-action-btn" id="adminPinRecover">${t("Nulstil med HA-login", "Reset with HA login")}</button></div>` : ""}</div>
      <div class="admin-card admin-settings-group"><div class="admin-card-head"><div><h2>${t("Adgang til administration", "Access to Administration")}</h2><p>${t("Bestem om genvejen vises i dashboardet. Adminpanelet er altid tilgængeligt på", "Choose whether the shortcut appears in the dashboard. The Admin panel is always available at")} <code>/admin/</code>.</p></div></div>
        <label class="admin-security-toggle"><span><strong>${t("Vis Administration-knappen", "Show the Administration button")}</strong><small>${t("Skjul genvejen på kiosker, hvor almindelige brugere ikke skal se den.", "Hide the shortcut on kiosks where regular users should not see it.")}</small></span><input type="checkbox" id="adminShowAdminButton"${showAdminButton ? " checked" : ""}></label>
        <div class="admin-security-warning"${showAdminButton ? " hidden" : ""} id="adminHiddenAccessNote">${t("Knappen er skjult. Åbn Admin manuelt ved at skrive", "The button is hidden. Open Admin manually by entering")} <strong>/admin/</strong> ${t("efter dashboardets adresse.", "after the dashboard address.")}</div>
        <div class="admin-actions"><button class="admin-save" type="button" data-save-admin-access>${t("Gem adgangsindstilling", "Save access setting")}</button><span class="admin-save-state" data-save-state="adminAccess"></span></div>
      </div></section>`;
  }

  function renderActiveView() {
    if (activeView === "overview") return renderOverview();
    if (activeView === "pages") return renderPagesView();
    if (activeView === "devices") return renderDevicesView();
    if (activeView === "setup") return renderSetupOverview();
    if (activeView === "forside") return renderForsideView();
    if (activeView === "theme") return renderThemeView();
    if (activeView === "settings") return renderSettingsView();
    if (activeView === "security-settings") return renderSecurityView();
    if (activeView === "screensaver") return renderScreensaverView();
    if (activeView === "advarsler") return renderAdvarslerView();
    if (activeView === "backup") return renderBackupView();
    if (activeView === "updates") return renderUpdatesView();
    const panel = PANELS.find((item) => item.id === activeView);
    return panel ? renderPanel(panel) : renderOverview();
  }

  function adminViewTitle() {
    const panel = PANELS.find((item) => item.id === activeView);
    if (panel) return panel.title;
    return ({ overview:"Overblik", pages:"Sider og navigation", devices:"Enheder og datakilder", setup:"Forbindelser & kiosk", theme:"Tema og design", settings:"Denne enhed", "security-settings":"Sikkerhed", screensaver:t("Pauseskærm", "Screensaver"), advarsler:t("Advarsler", "Alerts"), backup:"Backup & gendannelse", updates:"Opdatering" })[activeView] || "Administration";
  }

  function adminViewDescription() {
    if (PANELS.some((panel) => panel.id === activeView) || activeView === "devices") return "Forbind Home Assistant-data til dashboardets funktioner. Layout redigeres på selve dashboard-siden.";
    return ({ pages:"Opret og organiser dashboardets sider ét samlet sted.", setup:"Serverforbindelse, kioskfunktioner og hændelser.", theme:"Farve, stil og lystilstand for hele dashboardet.", settings:"Maskinspecifik adfærd for netop denne kiosk eller browser.", updates:"Se hvad der er nyt, og gendan en tidligere version om nødvendigt.", "security-settings":"Lokal adgang, pinkode og beskyttelse af adminpanelet.", screensaver:t("Styrer denne skærm/browser — hver kiosk kan have sin egen tidsplan.", "Controls this screen/browser only — each kiosk can have its own schedule."), advarsler:t("Alt om post-banneret samlet ét sted — slå til/fra og vælg entities.", "Everything about the post banner in one place — turn it on/off and pick entities.") })[activeView] || "Konfigurationen gemmes centralt på serveren.";
  }

  function renderShell(options = {}) {
    const contentScrollTop = window.scrollY;
    const sidebarScrollTop = document.querySelector(".admin-nav")?.scrollTop || 0;
    const dashboardLanguage = BeastLocalSettings.get("language", "en");
    root.innerHTML = `
      <div class="admin-shell">
        <aside class="admin-sidebar">
          <div class="admin-brand">${brandLogoMarkup("sidebar")}<strong>Administration</strong></div>
          <nav class="admin-nav">
            <button class="${activeView === "overview" ? "is-active" : ""}" type="button" data-view="overview">Overblik</button>
            <p class="admin-nav-section">Dashboard</p>
            <button class="${activeView === "pages" ? "is-active" : ""}" type="button" data-view="pages">Sider og navigation</button>
            <button class="${activeView === "devices" || PANELS.some((panel) => panel.id === activeView) ? "is-active" : ""}" type="button" data-view="devices">Enheder og datakilder</button>
            <p class="admin-nav-section">System</p>
            <button class="${activeView === "setup" ? "is-active" : ""}" type="button" data-view="setup">Forbindelser & kiosk</button>
            <p class="admin-nav-section">Skærm</p>
            <button class="${activeView === "theme" ? "is-active" : ""}" type="button" data-view="theme">Tema og design</button>
            <button class="${activeView === "settings" ? "is-active" : ""}" type="button" data-view="settings">Denne enhed</button>
            <button class="${activeView === "screensaver" ? "is-active" : ""}" type="button" data-view="screensaver">${t("Pauseskærm", "Screensaver")}</button>
            <button class="${activeView === "advarsler" ? "is-active" : ""}" type="button" data-view="advarsler">${t("Advarsler", "Alerts")}</button>
            <p class="admin-nav-section">Sikkerhed</p>
            <button class="${activeView === "security-settings" ? "is-active" : ""}" type="button" data-view="security-settings">Sikkerhed</button>
            <p class="admin-nav-section">Vedligeholdelse</p>
            <button class="${activeView === "backup" ? "is-active" : ""}" type="button" data-view="backup">Backup & gendannelse</button>
            <button class="${activeView === "updates" ? "is-active" : ""}" type="button" data-view="updates">Opdatering</button>
          </nav>
          <div class="admin-sidebar-foot"><a class="admin-back" href="/">Åbn dashboard</a></div>
        </aside>
        <main class="admin-main">
          <header class="admin-topbar"><div><h1>${adminViewTitle()}</h1><p>${adminViewDescription()}</p></div><div class="admin-topbar-tools"><label class="admin-language-picker"><span>${BeastCore.icon("globe", { size: 15 })}</span><select id="adminLanguageSelect" aria-label="Dashboard-sprog"><option value="en"${dashboardLanguage !== "da" ? " selected" : ""}>English</option><option value="da"${dashboardLanguage === "da" ? " selected" : ""}>Dansk</option></select></label><span class="admin-status" id="adminHaStatus" data-state="${connected ? "connected" : "connecting"}">${connected ? "Home Assistant forbundet" : "Forbinder til Home Assistant…"}</span></div></header>
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
      } else if (field.type === "boolean") {
        patch[field.key] = document.getElementById(id)?.value !== "0";
      } else {
        patch[field.key] = document.getElementById(id)?.value.trim() || null;
      }
    });
    if (panel.id === "rooms") {
      const current = BeastConfig.get("panels.rooms") || {};
      const climateSensors = { ...(current.climateSensors || {}) };
      const entityOverrides = { ...(current.entityOverrides || {}) };
      document.querySelectorAll("[data-room-mapping]").forEach((row) => {
        const areaId = row.dataset.roomMapping;
        const temperature = document.getElementById(row.dataset.tempPicker)?.value || null;
        const humidity = document.getElementById(row.dataset.humidityPicker)?.value || null;
        const extras = Array.from(checkListSelections.get(row.dataset.extrasPicker) || []);
        if (temperature || humidity) climateSensors[areaId] = [temperature, humidity];
        else delete climateSensors[areaId];
        if (extras.length) entityOverrides[areaId] = extras;
        else delete entityOverrides[areaId];
      });
      patch.climateSensors = climateSensors;
      patch.entityOverrides = entityOverrides;
    }
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
      window.history.replaceState(null, "", `#${activeView}`);
      hasUnsavedPanelChanges = false;
      renderShell({ resetContent: true });
    }));
    document.querySelector("[data-open-page-manager]")?.addEventListener("click", () => {
      if (typeof window.BeastPageManager?.open === "function") window.BeastPageManager.open();
      else showToast("Sideadministrationen kunne ikke indlæses. Genindlæs Admin og prøv igen.", "error");
    });
    document.getElementById("adminLanguageSelect")?.addEventListener("change", (event) => {
      BeastLocalSettings.set("language", event.target.value);
    });
    if (activeView === "backup") loadBackupSettings();
    if (activeView === "updates") loadUpdatesSettings();
    if (screensaverPreviewTimerId) { window.clearInterval(screensaverPreviewTimerId); screensaverPreviewTimerId = null; }
    if (activeView === "screensaver") {
      document.querySelectorAll("[data-ambient-preview-picture]").forEach((img) => {
        window.BeastAuth?.setAuthedImageSrc?.(img, img.dataset.ambientPreviewPicture);
      });
      screensaverPreviewTimerId = window.setInterval(updateScreensaverPreviewClock, 1000);
    }
    if (overviewVisualPreviewTimerId) { window.clearInterval(overviewVisualPreviewTimerId); overviewVisualPreviewTimerId = null; }
    if (activeView === "forside") {
      overviewVisualPreviewTimerId = window.setInterval(updateVisualOverviewPreviewLiveBits, 1000);
    }
    document.querySelector("[data-reload-backups]")?.addEventListener("click", loadBackupSettings);
    document.querySelector("[data-reload-versions]")?.addEventListener("click", () => loadUpdatesSettings(true));
    document.querySelector("[data-check-updates]")?.addEventListener("click", () => loadUpdatesSettings(true));
    document.querySelectorAll("[data-update-channel]").forEach((button) => {
      button.addEventListener("click", async () => {
        const channel = button.dataset.updateChannel === "beta" ? "beta" : "stable";
        if (channel === (BeastConfig.get("updateChannel") === "beta" ? "beta" : "stable")) return;
        if (channel === "beta") {
          const accepted = window.confirm(t(
            "Beta-kanalen henter udgivelser der endnu ikke er markeret stabile. De kan indeholde ændringer der ikke er færdigtestede.\n\nDenne installation vil fremover selv opdage og installere Beta-udgivelser, både her og i baggrunden.\n\nAccepterer du det, og vil du skifte til Beta?",
            "The Beta channel installs releases that have not yet been marked stable. They may contain changes that have not finished testing.\n\nThis installation will discover and install Beta releases here and in the background.\n\nDo you accept this and want to switch to Beta?"
          ));
          if (!accepted) return;
        }
        await BeastConfig.set("updateChannel", channel);
        renderShell();
      });
    });
    document.getElementById("adminUpdateSkipNote")?.addEventListener("click", async (event) => {
      if (!event.target.closest("#adminClearUpdateSkip")) return;
      await fetch("/api/update.php", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clearSkip" }) }).catch(() => {});
      loadUpdatesSettings();
    });
    document.getElementById("adminOldVersionSelect")?.addEventListener("change", (event) => {
      const restoreBtn = document.getElementById("adminOldVersionRestoreBtn");
      if (restoreBtn) restoreBtn.dataset.rollbackVersion = event.target.value;
    });
    document.getElementById("adminManualTagInput")?.addEventListener("input", (event) => {
      const installBtn = document.getElementById("adminManualInstallBtn");
      const stateEl = document.getElementById("adminManualTagState");
      const raw = event.target.value.trim();
      // Accepts either a bare tag ("v0.5.9", "0.5.9") or a full GitHub
      // release URL -- pulls the tag segment out of the URL if present.
      const urlMatch = raw.match(/\/releases\/tag\/([^/?#]+)/);
      const candidate = urlMatch ? decodeURIComponent(urlMatch[1]) : raw;
      const tag = /^v?\d+\.\d+\.\d+$/.test(candidate) ? candidate : "";
      if (installBtn) {
        installBtn.disabled = !tag;
        installBtn.dataset.rollbackVersion = tag;
        installBtn.dataset.installTag = tag;
      }
      if (stateEl) stateEl.textContent = raw && !tag ? t("Kunne ikke genkende et versionsnummer i det du indsatte.", "Couldn't recognize a version number in what you pasted.") : "";
    });
    // The latest-version action lives in the top "Denne installation" card,
    // while rollback/manual actions live in "Versionshistorik" below. Bind
    // their shared handler to the complete Updates view so moving a button
    // between those cards cannot silently disconnect it again.
    document.querySelector('[data-admin-view="updates"]')?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-rollback-version]");
      if (!button) return;
      const version = button.dataset.rollbackVersion;
      if (!version) return;
      const isNewer = button.dataset.isNewer === "true";
      const isLatest = button.dataset.isLatest === "true";
      const fromGithub = button.dataset.installSource === "github";
      const installTag = button.dataset.installTag || "";
      const stateEl = document.getElementById("adminRollbackState");
      const progressEl = document.getElementById("adminRollbackProgress");
      const fillEl = document.getElementById("adminRollbackProgressFill");
      const pendingText = fromGithub
        ? t(`Henter version ${version} fra GitHub…`, `Downloading version ${version} from GitHub…`)
        : isLatest ? t(`Installerer version ${version}…`, `Installing version ${version}…`) : isNewer ? t(`Opdaterer til version ${version}…`, `Updating to version ${version}…`) : t(`Gendanner version ${version}…`, `Restoring version ${version}…`);
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
        if (fromGithub) await installFromGithub(installTag);
        else await rollbackToVersion(version);
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
    document.querySelectorAll("select[id]").forEach((select) => select.addEventListener("change", () => {
      updateEntityPreview(select.id, select.value);
      const meta = document.querySelector(`[data-picker-meta="${select.id}"] strong`);
      if (meta) meta.textContent = select.value ? BeastEntityPicker.friendlyName(select.value) : "Ikke valgt";
    }));
    document.querySelectorAll("[data-overview-type]").forEach((select) => select.addEventListener("change", () => {
      const row = select.closest("[data-overview-card]");
      const custom = row.querySelector(".admin-overview-custom");
      const needsEntity = select.value === "custom" || select.value === "heatpump";
      custom.hidden = !needsEntity;
      if (!needsEntity) return;
      const picker = row.querySelector("[data-overview-entity]");
      const source = select.value === "heatpump" ? allOverviewEntities().filter((entity) => entity.id.startsWith("climate.")) : allOverviewEntities();
      selectSources.set(picker.id, source); entityFieldBaseSources.set(picker.id, source);
      row.querySelector("[data-overview-entity-label]").textContent = select.value === "heatpump" ? "Vælg varmepumpe" : "Vælg entity";
      picker.innerHTML = renderSelectOptions(picker.id, picker.value);
    }));
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
    document.querySelector("[data-refresh-rooms]")?.addEventListener("click", async (event) => {
      if (hasUnsavedPanelChanges && !window.confirm("Ikke-gemte valg på siden bliver nulstillet. Genindlæs rum alligevel?")) return;
      const button = event.currentTarget;
      const state = document.querySelector("[data-refresh-rooms-state]");
      button.disabled = true;
      if (state) state.textContent = "Henter rum, områder og entities…";
      try {
        await BeastHaSocket.refreshSnapshot();
        await BeastRegistry.refresh();
        entityCandidateCache.clear();
        checkListSources.clear();
        checkListSelections.clear();
        selectSources.clear();
        entityFieldBaseSources.clear();
        hasUnsavedPanelChanges = false;
        renderShell();
      } catch (error) {
        button.disabled = false;
        if (state) state.textContent = `Genindlæsning fejlede: ${error.message}`;
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
      if (haBaseUrl) BeastAuth.setHaBaseUrl(haBaseUrl);
      const result = await BeastConfig.setMany({
        haBaseUrl: haBaseUrl || null,
        dashboardTitle: document.getElementById("adminDashboardTitle").value.trim() || "HA Smartdash",
        faviconUrl: document.getElementById("adminFaviconUrl").value.trim() || "/favicon.svg"
      });
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
      const patch = { features };
      if (features.quickScenarios) patch.appEntities = { ...BeastConfig.get("appEntities"), quickScenes: Array.from(checkListSelections.get("admin_features_quickScenes") || []) };
      const result = await BeastConfig.setMany(patch);
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
    const doorbellViewModeSelect = document.getElementById("adminDoorbellViewMode");
    const doorbellViewMinutesField = document.getElementById("adminDoorbellViewMinutesField");
    const syncDoorbellViewMinutesField = () => doorbellViewMinutesField?.classList.toggle("is-hidden", doorbellViewModeSelect?.value === "manual");
    syncDoorbellViewMinutesField();
    doorbellViewModeSelect?.addEventListener("change", syncDoorbellViewMinutesField);
    document.querySelector("[data-save-app-entities]")?.addEventListener("click", (event) => save(event.currentTarget, "appEntities", async () => {
      BeastLocalSettings.set("kioskScreenLight", document.getElementById("adminKioskLight").value || null);
      return BeastConfig.set("appEntities", {
        ...BeastConfig.get("appEntities"),
        doorbellBinarySensor: document.getElementById("adminDoorbellBinary").value || null,
        doorbellEvent: document.getElementById("adminDoorbellEvent").value || null,
        doorbellCamera: document.getElementById("adminDoorbellCamera").value || null,
        doorbellViewMode: document.getElementById("adminDoorbellViewMode").value === "manual" ? "manual" : "timeout",
        doorbellViewMinutes: Math.max(1, Math.min(60, Number(document.getElementById("adminDoorbellViewMinutes").value) || 3))
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
    document.querySelectorAll("button[data-theme-style]").forEach((button) => {
      button.addEventListener("click", () => { window.BeastTheme?.setStyle(button.dataset.themeStyle); renderShell(); });
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
    document.querySelector("[data-save-quick-tiles]")?.addEventListener("click", (event) => save(event.currentTarget, "quickTiles", () => {
      const tiles = [document.getElementById("adminQuickTile1")?.value, document.getElementById("adminQuickTile2")?.value].filter(Boolean);
      const panels = {
        ...(BeastConfig.get("panels") || {}),
        waste: {
          ...(BeastConfig.get("panels.waste") || {}),
          showCalendarCard: document.getElementById("adminShowCalendarCard")?.value !== "0",
          showWasteCard: document.getElementById("adminShowWasteCard")?.value !== "0"
        }
      };
      return BeastConfig.setMany({ overviewQuickTiles: tiles, panels });
    }));
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
    document.getElementById("adminAlarmScreenOffBtn")?.addEventListener("click", () => {
      const enabled = window.BeastScreenLock?.isAlarmScreenOffEnabled();
      window.BeastScreenLock.setAlarmScreenOffEnabled(!enabled);
      renderShell();
    });
    document.getElementById("adminSaveAlarmLockRule")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      await BeastConfig.set("screenLock", {
        ...(BeastConfig.get("screenLock") || {}),
        alarmEntity: document.getElementById("adminLockAlarmEntity")?.value || null,
        alarmUnlockMode: document.getElementById("adminAlarmUnlockMode")?.value === "disarm" ? "disarm" : "pin"
      });
      button.textContent = t("Gemt · genindlæs dashboardet", "Saved · reload the dashboard");
      window.setTimeout(() => { button.disabled = false; button.textContent = t("Gem alarmregel", "Save alarm rule"); }, 1800);
    });
    document.getElementById("adminLockNowBtn")?.addEventListener("click", () => { window.BeastScreenLock.lockNow(); });
    document.getElementById("adminScreensaverBgFile")?.addEventListener("change", (event) => {
      const file = event.currentTarget.files?.[0];
      if (!file) return;
      const state = document.querySelector('[data-save-state="screensaver"]');
      if (file.size > 1024 * 1024) { if (state) state.textContent = t("Filen må højst fylde 1 MB", "The file must be at most 1 MB"); event.currentTarget.value = ""; return; }
      const reader = new FileReader();
      reader.onload = () => { document.getElementById("adminScreensaverBgUrl").value = reader.result; };
      reader.readAsDataURL(file);
    });
    document.getElementById("adminScreensaverBgClear")?.addEventListener("click", () => {
      document.getElementById("adminScreensaverBgUrl").value = "";
      document.getElementById("adminScreensaverBgFile").value = "";
      document.getElementById("adminScreensaverBgColorEnabled").checked = false;
      document.getElementById("adminScreensaverBgColor").value = "#03060c";
    });
    document.getElementById("adminScreensaverCameraEntities")?.addEventListener("change", (event) => {
      const grid = event.currentTarget;
      const boxes = Array.from(grid.querySelectorAll("input[type=checkbox]"));
      const checkedCount = boxes.filter((box) => box.checked).length;
      boxes.forEach((box) => {
        const disable = checkedCount >= 3 && !box.checked;
        box.disabled = disable;
        box.closest("label")?.classList.toggle("is-disabled", disable);
      });
    });
    document.getElementById("adminScreensaverSave")?.addEventListener("click", () => {
      BeastLocalSettings.set("screensaver", {
        ...(BeastLocalSettings.get("screensaver", BeastConfig.get("screensaver")) || {}),
        enabled: document.getElementById("adminScreensaverEnabled").value === "1",
        schedule: document.getElementById("adminScreensaverSchedule").value,
        startTime: document.getElementById("adminScreensaverStart").value || "23:00",
        endTime: document.getElementById("adminScreensaverEnd").value || "05:30",
        offAfterMinutes: Math.max(1, Number(document.getElementById("adminScreensaverOffAfter").value) || 5),
        backgroundImageUrl: document.getElementById("adminScreensaverBgUrl").value.trim() || null,
        backgroundColor: document.getElementById("adminScreensaverBgColorEnabled").checked ? document.getElementById("adminScreensaverBgColor").value : null,
        clockSize: document.getElementById("adminScreensaverClockSize").value || "medium",
        cameraEntities: Array.from(document.querySelectorAll("#adminScreensaverCameraEntities input:checked")).map((box) => box.value).slice(0, 3),
        brightnessEnabled: document.getElementById("adminScreensaverBrightnessEnabled").value === "1"
      });
      renderShell();
    });
    document.getElementById("adminAdvarslerScheduleEnabled")?.addEventListener("change", (event) => {
      document.getElementById("adminAdvarslerScheduleFields")?.toggleAttribute("hidden", !event.currentTarget.checked);
    });
    document.getElementById("adminAdvarslerSave")?.addEventListener("click", (event) => save(event.currentTarget, "advarsler", async () => {
      const features = {
        ...(BeastConfig.get("features") || {}),
        postBanner: document.getElementById("adminAdvarslerPostBanner").value === "1",
        printerBanner: document.getElementById("adminAdvarslerPrinterBanner").value === "1",
        doorBanner: document.getElementById("adminAdvarslerDoorBanner").value === "1",
        aulaMessageBanner: document.getElementById("adminAdvarslerAulaMessageBanner").value === "1",
        aulaLessonBanner: document.getElementById("adminAdvarslerAulaLessonBanner").value === "1"
      };
      const appEntities = {
        ...(BeastConfig.get("appEntities") || {}),
        mailPresent: document.getElementById("adminAdvarslerMailPresent").value || null,
        mailCount: document.getElementById("adminAdvarslerMailCount").value || null,
        mailDescription: document.getElementById("adminAdvarslerMailDescription").value || null,
        mailImage: document.getElementById("adminAdvarslerMailImage").value || null,
        mailImageCarport: document.getElementById("adminAdvarslerMailImageCarport").value || null,
        mailImageForhaven: document.getElementById("adminAdvarslerMailImageForhaven").value || null,
        aulaMessageSensor: document.getElementById("adminAdvarslerAulaMessage").value || null
      };
      const banners = {
        ...(BeastConfig.get("banners") || {}),
        doorOpenTooLongMinutes: Math.max(1, Number(document.getElementById("adminAdvarslerDoorMinutes").value) || 15),
        printerCameraOverride: document.getElementById("adminAdvarslerPrinterCamera").value || null,
        scheduleEnabled: document.getElementById("adminAdvarslerScheduleEnabled").checked,
        scheduleStart: document.getElementById("adminAdvarslerScheduleStart").value || "22:00",
        scheduleEnd: document.getElementById("adminAdvarslerScheduleEnd").value || "06:00",
        layoutMode: document.getElementById("adminAdvarslerLayoutMode").value === "stacked" ? "stacked" : "separate",
        aulaLessonMinutes: Math.max(1, Number(document.getElementById("adminAdvarslerAulaMinutes").value) || 10)
      };
      const result = await BeastConfig.setMany({ features, appEntities, banners });
      return { success: result?.success !== false };
    }));
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
    const meta = document.querySelector(`[data-picker-meta="${list.id}"] strong`);
    if (meta) meta.textContent = `${selected.size} valgt`;
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
    const diagnostics = BeastAuth.getDiagnostics();
    const diagnosticText = diagnostics.length ? JSON.stringify(diagnostics, null, 2) : "Ingen loginfejl registreret i denne browserfane.";
    root.innerHTML = `<div class="admin-login"><div class="admin-login-card"><div class="admin-login-logo">${brandLogoMarkup("login")}</div><small>Administration</small><h1>Forbind Home Assistant</h1><p class="admin-login-message">${escapeHtml(message || "Vælg almindeligt Home Assistant-login eller brug et Long-Lived Access Token. Oplysninger gemmes kun i denne browser.")}</p><form id="adminLoginForm"><input type="url" id="adminHaUrl" value="${escapeHtml(BeastAuth.getHaBaseUrl() || `${window.location.origin}/ha`)}" placeholder="Home Assistant-adresse" required><button type="submit">Log ind med Home Assistant</button></form><details class="admin-token-login"><summary>Log ind med token</summary><form id="adminTokenLoginForm"><label>Long-Lived Access Token<textarea id="adminHaToken" rows="4" autocomplete="off" spellcheck="false" placeholder="Indsæt token fra din Home Assistant-profil" required></textarea></label><small>Tokenet valideres mod Home Assistant og gemmes kun lokalt i browseren. Det vises aldrig i fejlloggen.</small><button type="submit">Kontrollér token og log ind</button></form></details><details class="admin-login-diagnostics"${diagnostics.length ? " open" : ""}><summary>Fejllog og forbindelsesdetaljer</summary><pre id="adminLoginDiagnosticText">${escapeHtml(diagnosticText)}</pre><div><button type="button" id="adminCopyLoginDiagnostics">Kopiér fejllog</button><button type="button" id="adminClearLoginDiagnostics">Ryd log</button></div></details></div></div>`;
    document.getElementById("adminLoginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      BeastAuth.setHaBaseUrl(document.getElementById("adminHaUrl").value);
      const button = event.currentTarget.querySelector("button[type=submit]");
      button.disabled = true;
      button.textContent = "Kontrollerer forbindelse…";
      try {
        await BeastAuth.prepareLogin();
      } catch (error) {
        renderLogin(error.userMessage || "Kunne ikke kontrollere Home Assistant-forbindelsen.");
      }
    });
    document.getElementById("adminTokenLoginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const address = document.getElementById("adminHaUrl");
      if (!address.reportValidity()) return;
      BeastAuth.setHaBaseUrl(address.value);
      const button = event.currentTarget.querySelector("button[type=submit]");
      button.disabled = true;
      button.textContent = "Kontrollerer token…";
      try {
        await BeastAuth.loginWithToken(document.getElementById("adminHaToken").value);
        window.location.reload();
      } catch (error) {
        renderLogin(error.userMessage || "Token-login mislykkedes.");
      }
    });
    document.getElementById("adminCopyLoginDiagnostics").addEventListener("click", async () => {
      const text = document.getElementById("adminLoginDiagnosticText").textContent;
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else window.prompt("Kopiér fejlloggen:", text);
    });
    document.getElementById("adminClearLoginDiagnostics").addEventListener("click", () => {
      BeastAuth.clearDiagnostics();
      renderLogin(message);
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
    const alreadyVerifiedForAdmin = window.BeastScreenLock?.consumeAdminVerification?.() === true;
    if (window.BeastScreenLock?.hasPin() && !pinRecoveryPending && !alreadyVerifiedForAdmin) {
      const verified = await new Promise((resolve) => window.BeastScreenLock.requestPinVerification(resolve));
      if (!verified) { window.location.href = "/"; return; }
    }
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
