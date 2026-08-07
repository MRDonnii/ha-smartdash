(() => {
  "use strict";

  const en = {
    "Overblik": "Overview", "Rum": "Rooms", "Vejr": "Weather", "Energi": "Energy",
    "Musik": "Music", "Varme": "Heating", "Varmestyring": "Heating", "Sikkerhed": "Security",
    "Kameraer": "Cameras", "Robotter": "Robots", "Printer": "Printer", "Pool": "Pool",
    "Bil": "Car", "Tesla": "Car", "Affald": "Waste", "Indstillinger": "Settings",
    "Mere info": "More info", "Luk": "Close", "Tilbage": "Back", "Gem": "Save",
    "Annuller": "Cancel", "Opdater": "Refresh", "Ikke valgt": "Not selected",
    "Ingen live data": "No live data", "Vælg entity": "Select entity", "Søg entities": "Search entities",
    "Forbind til Home Assistant": "Connect to Home Assistant", "Home Assistant-adresse": "Home Assistant address",
    "Fortsæt": "Continue", "Log ind med Home Assistant": "Sign in with Home Assistant",
    "Åbn admin": "Open admin", "Administration": "Administration", "Grundindstillinger": "General settings",
    "Paneler": "Panels", "Backup & gendannelse": "Backup & restore", "Om HA Smartdash": "About HA Smartdash",
    "Dashboardets navn": "Dashboard title", "Favicon": "Favicon", "Forhåndsvisning": "Preview",
    "Skjulte sider": "Hidden pages", "Visuel forsidebygger": "Visual overview builder",
    "Tilføj kort": "Add card", "Gem og anvend forside": "Save and apply overview",
    "Installationsprofil": "Installation profile", "Eksportér HA Smartdash-profil": "Export HA Smartdash profile",
    "Gendan HA Smartdash-profil": "Restore HA Smartdash profile", "Ingen enhed valgt": "No device selected",
    "Vælg en enhed": "Select a device", "Aktiv": "Active", "Inaktiv": "Inactive",
    "Tænd": "Turn on", "Sluk": "Turn off", "Låst": "Locked", "Ulåst": "Unlocked",
    "Åben": "Open", "Lukket": "Closed", "Oplader": "Charging", "Tilsluttet": "Connected",
    "Ikke tilsluttet": "Disconnected", "Utilgængelig": "Unavailable", "I dag": "Today",
    "I morgen": "Tomorrow", "Næste": "Next", "Hjem": "Home", "Start": "Start", "Stop": "Stop",
    "Pause": "Pause", "Genoptag": "Resume", "Rengør": "Clean", "Klip": "Mow",
    "Temperatur": "Temperature", "Luftfugtighed": "Humidity", "Forbrug": "Usage",
    "Effekt": "Power", "Pris": "Price", "Batteri": "Battery", "Rækkevidde": "Range",
    "Live kamera": "Live camera", "Kommende begivenheder": "Upcoming events", "Ingen begivenheder": "No events"
  };

  // Administration has far more surface area than the dashboard, so its
  // strings live in their own object purely to keep this file readable —
  // both are merged into one lookup below.
  const adminEn = {
    "+ Tilføj gruppe": "+ Add group", "+ Tilføj kort": "+ Add card",
    ". Genåbn derefter denne fane.": ". Then reopen this tab.",
    ". Skrivbare shares dukker automatisk op under Placering; SMB-brugernavn og adgangskode gemmes aldrig i dashboardet.": ". Writable shares appear automatically under Location; SMB username and password are never stored in the dashboard.",
    "0 % fjerner rammerne, mens knapper og styring bevares": "0% removes the frames while buttons and controls remain",
    "3D Printer": "3D Printer", "AMS-bakker": "AMS trays", "AMS-fugtighed": "AMS humidity",
    "Adgang & pinkode": "Access & PIN", "Adgang til administration": "Access to Administration",
    "Administrér skærmlås, gendannelse og adgangen til adminpanelet samlet ét sted.": "Manage screen lock, recovery, and access to the admin panel in one place.",
    "Affaldssensorer": "Waste sensors", "Aktiv AMS-bakke": "Active AMS tray", "Aktuelt lag": "Current layer",
    "Aktuelt trin": "Current step", "Alle alarmsystemer": "All alarm systems", "Alle enheder": "All devices",
    "Altid": "Always", "Antal lag": "Layer count", "Antal post (valgfri)": "Mail count (optional)",
    "Automatisk backup": "Automatic backup", "Automatisk backup og SMB": "Automatic backup and SMB",
    "Automatisk lås": "Automatic lock", "Automatisk varmestyring": "Automatic heating control",
    "Avanceret MQTT-styring og enhedskommandoer. Kan ignoreres på almindelige tablets.": "Advanced MQTT control and device commands. Can be ignored on regular tablets.",
    "Backup og opdatering": "Backup and update",
    "Backups fra både den lokale mappe og monterede SMB-shares kan hentes direkte herfra.": "Backups from both the local folder and mounted SMB shares can be downloaded directly here.",
    "Bekræft din identitet med en ny Home Assistant-login og opret derefter en ny kode.": "Confirm your identity with a new Home Assistant login, then set a new code.",
    "Bestem om genvejen vises i dashboardet. Adminpanelet er altid tilgængeligt på": "Decide whether the shortcut appears in the dashboard. The admin panel is always available at",
    "Bestemt tidsrum": "Set time range", "Bil": "Car", "Bil / integration": "Car / integration",
    "Billede til 1. robotstøvsuger (valgfri, erstatter standardbilledet)": "Image for 1st robot vacuum (optional, replaces the default image)",
    "Billede til robotplæneklipperen (valgfri, erstatter standardbilledet)": "Image for the robot mower (optional, replaces the default image)",
    "Bredde": "Width", "Brug denne før og efter en GitHub-opdatering.": "Use this before and after a GitHub update.",
    "Byg dit dashboard": "Build your dashboard", "Custom topic-prefix": "Custom topic prefix",
    "Dagligt": "Daily", "Dantherm-sensorer": "Dantherm sensors", "Dashboard på denne skærm": "Dashboard on this screen",
    "Dashboard-sprog": "Dashboard language", "Denne installation": "This installation", "Denne skærm": "This screen",
    "Der er ikke lavet nogen serverbackups endnu.": "No server backups have been made yet.",
    "Det holder netværkslogin uden for browseren og gør backup kompatibel med Unraid, Docker og almindelig Linux. Den fulde vejledning findes i": "This keeps network logins out of the browser and makes backups compatible with Unraid, Docker, and plain Linux. The full guide is in",
    "Diagnostik og session": "Diagnostics and session", "Dyse-måltemperatur": "Nozzle target temperature",
    "Dysetemperatur": "Nozzle temperature", "Dæktryk · bag højre": "Tire pressure · rear right",
    "Dæktryk · bag venstre": "Tire pressure · rear left", "Dæktryk · for højre": "Tire pressure · front right",
    "Dæktryk · for venstre": "Tire pressure · front left", "Døre åbne": "Doors open",
    "Dørkamera (valgfri)": "Doorbell camera (optional)", "Dørklokke (binary_sensor)": "Doorbell (binary_sensor)",
    "Dørklokke (event, valgfri)": "Doorbell (event, optional)", "Dørlås": "Door lock", "Dørlåse": "Door locks",
    "Eksportér HA Smartdash-profil": "Export HA Smartdash profile",
    "Eksportér en installationsprofil, opdatér programfilerne og gendan opsætningen uden at lægge tokens eller loginoplysninger i backupfilen.": "Export an installation profile, update the app files, and restore the setup without putting tokens or login details in the backup file.",
    "Eksportér lokale skærmvalg": "Export local screen settings", "Elpris nu": "Electricity price now",
    "Energi i dag": "Energy today", "Entities i cache": "Entities in cache", "Entity-cache": "Entity cache",
    "Entity-listen nedenfor begrænses til den valgte enhed.": "The entity list below is limited to the selected device.",
    "Et personligt projekt": "A personal project", "Favicon-adresse": "Favicon address", "Fjern": "Remove",
    "Fjern gruppe": "Remove group", "Fjern kort": "Remove card", "Fjernvarme-sensorer": "District heating sensors",
    "Flydende afspiller": "Floating player", "Flyt kort ned": "Move card down", "Flyt kort op": "Move card up",
    "Flyt ned": "Move down", "Flyt op": "Move up", "Forbind Home Assistant": "Connect Home Assistant",
    "Forbindelsesstatus og elementer, som kun påvirker den aktuelle kiosk eller browser.": "Connection status and elements that only affect the current kiosk or browser.",
    "Fortsæt-knap": "Continue button", "Forventet færdigopladning": "Expected charge completion",
    "Fra": "Off", "Fremdrift": "Progress", "Gear-/kørestatus": "Gear / driving status",
    "Gem MQTT": "Save MQTT", "Gem adgangsindstilling": "Save access setting", "Gem auto-backup": "Save auto-backup",
    "Gem browserfane": "Save browser tab", "Gem denne skærm": "Save this screen",
    "Gem kiosk & dørklokke": "Save kiosk & doorbell", "Gem kioskfunktioner": "Save kiosk features",
    "Gem lokalt eller på en SMB-share, som værten har monteret under": "Save locally or to an SMB share the host has mounted under",
    "Gem og anvend forside": "Save and apply overview", "Gem pauseskærm": "Save screensaver",
    "Gem synlige sider": "Save visible pages",
    "Gemmes lokalt på denne maskine, så hver skærm kan have sin egen navigation.": "Saved locally on this machine, so each screen can have its own navigation.",
    "Gemte backups": "Saved backups", "Gendan HA Smartdash-profil": "Restore HA Smartdash profile",
    "Gendan denne version": "Restore this version", "Genindlæs admin i browseren": "Reload admin in the browser",
    "Glemt pinkode?": "Forgot your PIN?", "Gruppenavn": "Group name", "HA-forbindelse": "HA connection",
    "Hent": "Download", "Henter backups…": "Loading backups…", "Henter status…": "Loading status…",
    "Henter versioner…": "Loading versions…", "Henter ændringslog…": "Loading changelog…",
    "Home Assistant-adresse": "Home Assistant address", "Hovedmåler (effekt)": "Main meter (power)",
    "Hurtigscenarier på dashboardet": "Quick scenes on the dashboard",
    "Hver udvidelse kan aktiveres eller deaktiveres uafhængigt.": "Each extension can be turned on or off independently.",
    "Højde": "Height", "I morgen tilgængelig (valgfri)": "Available tomorrow (optional)", "Indhold": "Content",
    "Ingen HA Smartdash-cloud, tracking eller telemetri. Opsætningen ligger på din egen server, mens maskinspecifikke valg gemmes i browseren.": "No HA Smartdash cloud, tracking, or telemetry. The setup lives on your own server, while machine-specific choices are stored in the browser.",
    "Ingen fejl fundet i de konfigurerede entity-felter.": "No errors found in the configured entity fields.",
    "Ingen matchende enheder fundet.": "No matching devices found.",
    "Ingen tidligere versioner gemt endnu. De dukker op her, efterhånden som dashboardet opdateres.": "No previous versions saved yet. They'll appear here as the dashboard is updated.",
    "Ingen valg": "No selection", "Ingen ændringslog fundet.": "No changelog found.",
    "Installationsprofil": "Installation profile", "Interval": "Interval",
    "Kalender & affald": "Calendar & waste", "Kalendere": "Calendars", "Kamera-entities": "Camera entities",
    "Kamerabillede": "Camera image", "Kameraer": "Cameras", "Kilometertæller": "Odometer",
    "Kiosk & dørklokke": "Kiosk & doorbell", "Kiosk entity-prefix": "Kiosk entity prefix",
    "Kiosk-skærm (lokal på denne maskine)": "Kiosk screen (local to this machine)",
    "Kioskfunktioner": "Kiosk features", "Kioskintegration": "Kiosk integration", "Kiosknavn": "Kiosk name",
    "Knappen er skjult. Åbn admin manuelt ved at skrive": "The button is hidden. Open admin manually by typing",
    "Kompakt": "Compact", "Konfigurationskontrol": "Configuration check",
    "Kunne ikke hente versionshistorik.": "Could not load version history.",
    "Kunne ikke hente ændringslog.": "Could not load changelog.", "Køretid i dag": "Runtime today",
    "Ladeeffekt": "Charging power", "Ladekabel tilsluttet": "Charging cable connected",
    "Lav backup nu": "Back up now", "Let kioskvisning": "Light kiosk view",
    "Lodret/mobil · 1 kolonne": "Portrait/mobile · 1 column", "Lokal backupmappe": "Local backup folder",
    "Lokalt og privat": "Local and private", "Lokation": "Location", "Luftig": "Airy",
    "Lås denne skærm": "Lock this screen", "Lås nu": "Lock now", "MQTT & kioskstyring": "MQTT & kiosk control",
    "MQTT-mål": "MQTT target",
    "Montér netværksdrevet på serveren eller som et Docker-bind mount. Eksempel:": "Mount the network drive on the server or as a Docker bind mount. Example:",
    "Navn & browserikon": "Name & browser icon", "Nulstil med HA-login": "Reset with HA login",
    "Nuværende version": "Current version", "Nyt kort": "New card", "Opdatering": "Update",
    "Opdatér entities fra HA": "Refresh entities from HA", "Opdatér liste": "Refresh list",
    "Oplader": "Charging", "PNG, SVG, ICO eller WebP · højst 256 KB": "PNG, SVG, ICO, or WebP · 256 KB max",
    "Pauseknap": "Pause button", "Person i vandet": "Person in water", "Pinkode": "PIN",
    "Pinkode og skærmlås": "PIN and screen lock",
    "Pinkoden gemmes kun på denne maskine og følger ikke med centrale backups.": "The PIN is stored on this machine only and is not included in central backups.",
    "Placering": "Location", "Plade-måltemperatur": "Bed target temperature", "Pladetemperatur": "Bed temperature",
    "Poolautomatik": "Pool automation", "Poolpumpe": "Pool pump",
    "Post registreret (valgfri)": "Mail registered (optional)", "Postbeskrivelse (valgfri)": "Mail description (optional)",
    "Primært alarmsystem": "Primary alarm system", "Printer / integration": "Printer / integration",
    "Printjobbets navn": "Print job name", "Printstatus": "Print status", "Pris i dag": "Price today",
    "Prisprognose (valgfri)": "Price forecast (optional)",
    "Projektet leveres uden garanti for alle HA-installationer. Andre er velkomne til at tilpasse, fejlrette og bygge videre på det.": "The project ships without a guarantee it fits every HA install. Others are welcome to adapt, fix, and build on it.",
    "Pumpens driftstatus": "Pump operating status", "Resterende tid": "Time remaining",
    "Robotplæneklippere": "Robot mowers", "Robotstøvsugere": "Robot vacuums",
    "Rumtermostater": "Room thermostats", "Samlet driftstid": "Total runtime", "Scenarier": "Scenes",
    "Send test": "Send test",
    "Seneste lokale hændelser samt mulighed for at logge Home Assistant-sessionen ud.": "Recent local events, plus the option to sign out of the Home Assistant session.",
    "Sensorer til de tre indgangskort (øvrige åbninger opdages automatisk)": "Sensors for the three entry cards (other openings are detected automatically)",
    "Separat kopi af lokale valg til netop denne browser eller kiosk.": "A separate copy of local choices for this specific browser or kiosk.",
    "Sideadresse": "Page address", "Sikkerhed og adgang": "Security and access",
    "Skjul genvejen på kiosker, hvor almindelige brugere ikke skal se den.": "Hide the shortcut on kiosks where regular users shouldn't see it.",
    "Slukker helt efter (minutter)": "Turns off completely after (minutes)", "Sluttidspunkt": "End time",
    "Smal/tablet · 2 kolonner": "Narrow/tablet · 2 columns", "Standard-payload": "Default payload",
    "Standardfane": "Default tab", "Starttidspunkt": "Start time", "Stopknap": "Stop button",
    "Stor skærm · 12 kolonner": "Large screen · 12 columns", "Store kortområder": "Large card areas",
    "Store trykfelter": "Large tap targets", "Synlige Home Assistant-områder": "Visible Home Assistant areas",
    "Synlige sider": "Visible pages", "Sådan tilføjes en SMB-share": "How to add an SMB share",
    "Søg efter HA-enhed…": "Search for HA device…", "Søg efter enhed, producent eller integration…": "Search by device, brand, or integration…",
    "Søg efter entity…": "Search for entity…", "Søg…": "Search…",
    "Tekst i browserfanen": "Text in the browser tab", "Temperatur inde": "Indoor temperature",
    "Temperatur ude": "Outdoor temperature", "Tidsrum": "Time range", "Til": "On",
    "Tilføj, fjern og flyt kort. Angiv størrelse separat for stor, smal og lodret skærm.": "Add, remove, and move cards. Set size separately for large, narrow, and portrait screens.",
    "Tilført energi": "Energy added",
    "Tilpas hvornår denne kiosk dæmpes, og hvornår skærmen slukkes helt.": "Adjust when this kiosk dims and when the screen turns off completely.",
    "Tilpas skærmen uden genindlæsning": "Adjust the screen without reloading",
    "Tilpas teksten og ikonet, der vises i browserfanen.": "Customize the text and icon shown in the browser tab.",
    "Titel": "Title", "Udseende": "Appearance", "Udseende & denne enhed": "Appearance & this device",
    "Udseende & enhed": "Appearance & device", "Ugentligt": "Weekly",
    "Valgbare robotrum (valgfri)": "Selectable robot rooms (optional)", "Valgfri titel": "Optional title",
    "Valgfrit — styrer skærm-sluk om natten og et automatisk dørkamera-overlay.": "Optional — controls screen-off at night and an automatic doorbell camera overlay.",
    "Vandflow nu (valgfri)": "Water flow now (optional)", "Vandforbrug i dag (valgfri)": "Water usage today (optional)",
    "Vandtemperatur": "Water temperature", "Varmeeffekt til forsiden (valgfri)": "Heating power for the overview (optional)",
    "Varmeenergi i dag (valgfri)": "Heating energy today (optional)", "Varmepumper": "Heat pumps",
    "Vejr-entity": "Weather entity",
    "Versionen der kører lige nu, og hvad der senest er ændret.": "The version running right now, and what's changed most recently.",
    "Versionshistorik": "Version history", "Vigtig information": "Important information",
    "Vinduer åbne": "Windows open", "Vis Administration-knappen": "Show the Administration button",
    "Vis alle HA-enheder, hvis den ikke blev fundet automatisk": "Show all HA devices, if it wasn't found automatically",
    "Vis teknisk log": "Show technical log", "Visningstæthed": "Display density",
    "Visuel forsidebygger": "Visual overview builder",
    "Visuelle valg og maskinspecifik adfærd er opdelt nedenfor. De fleste valg gemmes kun i denne browser.": "Visual choices and machine-specific behavior are split out below. Most choices are stored only in this browser.",
    "Vælg favicon-fil": "Choose favicon file",
    "Vælg først den konkrete enhed og gem. Derefter viser felterne kun entities, som HA har knyttet til den valgte enhed.": "First select the specific device and save. The fields will then only show entities HA has linked to that device.",
    "Vælg kun scenes, som er sikre at aktivere fra en kiosk.": "Only choose scenes that are safe to trigger from a kiosk.",
    "Vælg relevante HA-enheder, skjul sider, tilpas forsiden og brug samme design med både få og mange entities.": "Choose the relevant HA devices, hide pages, customize the overview, and use the same design with few or many entities.",
    "efter dashboardets adresse.": "after the dashboard's address.",
    "entities hentet fra Home Assistant": "entities fetched from Home Assistant",
    "go2rtc streamnavn": "go2rtc stream name", "go2rtc-adresse": "go2rtc address",
    "sider synlige i dashboardet": "pages visible in the dashboard",
    "standardsider konfigureret": "default pages configured", "Åbn Beast": "Open dashboard",
    "Åbn dashboard": "Open dashboard", "— Ikke valgt —": "— Not selected —", "— Vælg enhed —": "— Select device —",
    "fx ": "e.g. "
  };
  Object.assign(en, adminEn);

  function currentLanguage() {
    const stored = typeof BeastLocalSettings !== "undefined" ? BeastLocalSettings.get("language", "en") : "en";
    return stored === "da" ? "da" : "en";
  }

  function translateText(value) {
    const leading = value.match(/^\s*/)?.[0] || "";
    const trailing = value.match(/\s*$/)?.[0] || "";
    const core = value.trim();
    return en[core] ? `${leading}${en[core]}${trailing}` : value;
  }

  function translate(root = document.body) {
    if (!root || currentLanguage() !== "en") return;
    document.documentElement.lang = "en";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      if (node.parentElement?.closest("script,style,textarea")) return;
      const next = translateText(node.nodeValue || "");
      if (next !== node.nodeValue) node.nodeValue = next;
    });
    root.querySelectorAll?.("[placeholder],[title],[aria-label]").forEach((element) => {
      ["placeholder", "title", "aria-label"].forEach((attribute) => {
        const value = element.getAttribute(attribute);
        if (value && en[value]) element.setAttribute(attribute, en[value]);
      });
    });
  }

  window.HASmartdashI18n = { get language() { return currentLanguage(); }, translate };

  document.addEventListener("DOMContentLoaded", () => {
    let activeLanguage = currentLanguage();
    document.documentElement.lang = activeLanguage;
    translate();
    let queued = false;
    new MutationObserver(() => {
      if (queued || currentLanguage() !== "en") return;
      queued = true;
      requestAnimationFrame(() => { queued = false; translate(); });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });

    // Danish text is baked into the app's own render output and English is
    // produced by one-way DOM mutation, so a language change (from this tab
    // or another, e.g. the Admin topbar picker) can't be un-translated live
    // — a reload is the only reliable way to re-render in the new language.
    document.addEventListener("beast:local-settings-changed", (event) => {
      if (event.detail?.path !== "language" && event.detail?.path !== "*") return;
      const next = currentLanguage();
      if (next !== activeLanguage) { activeLanguage = next; window.location.reload(); }
    });
  });
})();
