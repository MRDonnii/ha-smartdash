(() => {
  "use strict";

  const en = {
    "Overblik": "Overview", "Rum": "Rooms", "Vejr": "Weather", "Energi": "Energy",
    "Musik": "Music", "Varme": "Heating", "Varmestyring": "Heating", "Sikkerhed": "Security",
    "Kameraer": "Cameras", "Robotter": "Robots", "Printer": "Printer", "Pool": "Pool",
    "Bil": "Car", "Tesla": "Car", "Affald": "Waste", "Indstillinger": "Settings",
    "Mere info": "More info", "Rediger": "Edit", "Luk": "Close", "Tilbage": "Back", "Gem": "Save",
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
    "Tjekker…": "Checking…", "Tjek for opdateringer": "Check for updates",
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
    "Pinkoden gemmes i serverkonfigurationen og gælder på alle skærme.": "The PIN is stored in the server configuration and applies to every screen.",
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
    "Sider og navigation": "Pages and navigation", "Enheder og datakilder": "Devices and data sources",
    "Forbindelser & kiosk": "Connections & kiosk", "Vedligeholdelse": "Maintenance", "Skærm": "Screen",
    "Opret og organiser dashboardets sider ét samlet sted.": "Create and organise the dashboard pages in one place.",
    "Forbind Home Assistant-data til dashboardets funktioner. Layout redigeres på selve dashboard-siden.": "Connect Home Assistant data to dashboard features. Edit layout directly on the dashboard page.",
    "Enheder og datakilder": "Devices and data sources", "Klima og forbrug": "Climate and usage",
    "Hus og sikkerhed": "Home and security", "Udstyr og medier": "Equipment and media",
    "Åbn kun den del, du vil forbinde eller ændre.": "Open only the section you want to connect or change.",
    "Konfigureret": "Configured", "Mangler opsætning": "Needs setup", "Alle enheder": "All devices",
    "Sider og navigation": "Pages and navigation", "aktive sider": "active pages", "egne sider": "custom pages",
    "skjulte eller fjernede": "hidden or removed", "Tilføj eller administrer sider": "Add or manage pages",
    "Opret, fjern, gendan, omdøb og flyt rækkefølge": "Create, remove, restore, rename, and reorder",
    "Sidehåndtering ligger nu kun her i Admin. Layoutet på en side redigeres fortsat via de tre prikker på selve siden.": "Page management now lives only here in Admin. Continue editing a page layout from the three-dot menu on that page.",
    "Opret sider, gendan standardsider, omdøb dem og bestem rækkefølgen i dashboardets navigation.": "Create pages, restore standard pages, rename them, and set their order in dashboard navigation.",
    "Vælg hvilke Home Assistant-enheder der leverer data. Kort, størrelse og placering redigeres direkte på den enkelte dashboard-side.": "Choose which Home Assistant devices provide data. Edit cards, size, and placement directly on each dashboard page.",
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
  const dashboardEn = {
    "Oversigt": "Overview", "Kalender": "Calendar", "Sider": "Pages", "Dansk": "Danish",
    "Rediger side": "Edit page", "Tilpas side": "Fit page", "Rediger forsiden": "Edit overview",
    "Nulstil layout": "Reset layout", "Kun dette view og denne skærmstørrelse": "Only this view and this screen size",
    "Nulstil layoutet for dette view på denne skærmstørrelse?": "Reset the layout for this view at this screen size?",
    "Flyt, ændr og tilføj kort": "Move, resize, and add cards", "Fordel kortene til denne skærm": "Fit cards to this screen",
    "Redigerer forsiden": "Editing overview", "Redigerer Kameraer": "Editing Cameras", "Redigerer Vejr": "Editing Weather", "Redigerer energikort": "Editing energy cards", "Redigerer sikkerhedskort": "Editing security cards",
    "Redigerer Musik": "Editing Music", "Redigerer Robotter": "Editing Robots", "Redigerer 3D Printer": "Editing 3D Printer",
    "Navne og størrelse": "Names and size", "Navn": "Name", "Venstre": "Left", "Top": "Top", "Bredde": "Width", "Højde": "Height",
    "Annullér": "Cancel", "Anvend": "Apply", "Gem kort": "Save card", "Gem layout": "Save layout", "Gem sider": "Save pages",
    "Indbyggede kort": "Built-in cards", "Ændringer gemmes kun til profilen": "Changes are saved only for the profile",
    "De andre skærmstørrelser beholder deres eget layout.": "Other screen sizes keep their own layout.",
    "Dashboard": "Dashboard", "Tablet": "Tablet", "Mobil": "Mobile",
    "Tilføj kort": "Add card", "Nyt kort": "New card", "Indstil kort": "Configure card", "Indhold i kortet": "Card content",
    "Korttype": "Card type", "Navn på kort": "Card name", "Ikon": "Icon", "Entity / sensor": "Entity / sensor",
    "Statistik": "Statistics", "Touch-knap": "Touch button", "Graf": "Graph", "Kamera": "Camera", "Medieafspiller": "Media player",
    "Valgfrit navn": "Optional name", "Vis kortet i normal visning": "Show card in normal view",
    "Søg i alle entities…": "Search all entities…", "Brug standard eller vælg entity": "Use default or select entity",
    "Brug serverstandard": "Use server default", "Størrelsen ændres direkte med håndtaget i kortets nederste højre hjørne.": "Resize directly with the handle in the card's lower-right corner.",
    "Skabelongalleri": "Template gallery", "Alle": "All", "Basis": "Basic", "Valgfri entity": "Custom entity",
    "Kortbibliotek": "Card library", "Vælg en skabelon": "Choose a template", "Søg efter kort…": "Search cards…",
    "Specialkort": "Special cards", "Originalt funktionskort fra denne side": "Original functional card from this page",
    "Ingen skabeloner er tilgængelige på denne side.": "No templates are available on this page.",
    "← Tilbage til galleriet": "← Back to gallery", "Tilbage til galleriet": "Back to gallery",
    "Byg et enkelt kort fra enhver HA-entity": "Build a simple card from any HA entity",
    "Rumtemperatur": "Room temperature", "Stor temperatur med aktuel værdi": "Large temperature with current value",
    "Lysstyring": "Light control", "Stor touchknap til lys eller lysgruppe": "Large touch button for a light or light group",
    "Termostat": "Thermostat", "Status og hurtig styring af varme": "Heating status and quick controls",
    "Varmestatus": "Heating status", "Temperatur eller varmepumpedata": "Temperature or heat-pump data",
    "Dør eller vindue": "Door or window", "Tydelig åben/lukket status": "Clear open/closed status",
    "Lås": "Lock", "Touchvenlig låsestyring": "Touch-friendly lock control", "Sikkerhedsstatus": "Security status",
    "Alarm- eller sikkerhedssensor": "Alarm or security sensor", "Livekamera": "Live camera",
    "Kamera i korrekt format uden beskæring": "Camera in the correct aspect ratio without cropping",
    "Forbrug lige nu": "Current usage", "Aktuelt strømforbrug som nøgletal": "Current power usage as a key figure",
    "Forbrugsgraf": "Usage graph", "Udvikling for en energisensor": "History for an energy sensor",
    "Strømpris": "Electricity price", "Pris eller tariffer som graf": "Price or tariffs as a graph",
    "Pooltemperatur": "Pool temperature", "Poolstyring": "Pool control", "Bilbatteri": "Car battery",
    "Opladning": "Charging", "Status eller styring af opladning": "Charging status or control",
    "Aktuelt nummer og afspillerstatus": "Current track and player status", "Komplet medieafspiller": "Full media player",
    "Albumcover, transport og touchvenlig lydstyrke": "Album cover, transport, and touch-friendly volume",
    "Næste aftale": "Next event", "Kommende kalenderbegivenhed": "Upcoming calendar event", "Næste afhentning": "Next collection",
    "Affaldstype eller dage til afhentning": "Waste type or days until collection", "Vejr nu": "Weather now",
    "Aktuel vejrstatus eller temperatur": "Current weather status or temperature", "Detaljeret vejrkort": "Detailed weather card",
    "Temperatur, fugt, vind og vejrtilstand samlet": "Temperature, humidity, wind, and conditions combined",
    "Robotstatus": "Robot status", "Robotstyring": "Robot control", "Status, batteri samt start, pause og hjem": "Status, battery, start, pause, and home",
    "Printstatus": "Print status", "Printjob og styring": "Print job and controls", "Printerkamera": "Printer camera",
    "Printertemperatur": "Printer temperature", "Tid og næste aftale": "Time and next event", "Vejrkort": "Weather card",
    "Sikkerhedsoverblik": "Security overview", "Energioverblik": "Energy overview", "Rumkort": "Room card",
    "Varmepumpe": "Heat pump", "Fjernvarme": "District heating", "Døre og vinduer": "Doors and windows",
    "Samlet sikkerhedsstatus": "Overall security status", "Alarmsystemer": "Alarm systems", "Indgange og låse": "Entrances and locks",
    "Elpris time for time": "Hourly electricity price", "Forbrug 24 timer": "24-hour usage", "Energiassistent": "Energy assistant",
    "Enhedsforbrug": "Device usage", "Temperaturhistorik": "Temperature history", "Poolstatus og styring": "Pool status and controls",
    "Poolkamera": "Pool camera", "Dæktryk": "Tire pressure", "Bilstatus": "Car status", "Timeudsigt": "Hourly forecast",
    "Radar eller vejrbillede": "Radar or weather image", "Kalenderoversigt": "Calendar overview",
    "Stort livekamera": "Large live camera", "Kameravælger": "Camera selector", "Billedtilpasning": "Image fit",
    "Fyld kortet": "Fill card", "Vis hele billedet": "Show full image", "Antal kameraer": "Number of cameras",
    "Aktuelt vejr og timeudsigt": "Current weather and hourly forecast", "Vejrradar": "Weather radar", "Ugeudsigt": "Weekly forecast",
    "Timer i udsigten": "Forecast hours", "Dage i udsigten": "Forecast days", "Afspiller og højttalere": "Player and speakers",
    "Bibliotek, søgning og album": "Library, search, and albums", "Vis højttalervælger": "Show speaker selector",
    "Elementer ad gangen": "Items per page", "Højttalere": "Speakers", "Afspiller nu": "Now playing", "Playlister": "Playlists",
    "Albummer": "Albums", "Radio": "Radio", "Se numre": "View tracks", "Vis flere": "Show more",
    "Nøgletal": "Key figures", "Pris-dage": "Price days", "Vis prisnøgletal": "Show price key figures",
    "Vis forbrugsnøgletal": "Show usage key figures", "Prisprognose": "Price forecast", "Aktuel pris": "Current price",
    "Aktuel effekt": "Current power", "Hovedmåler": "Main meter", "Målt total": "Measured total", "Umålt": "Unmeasured",
    "Direkte styring": "Direct control", "Indgange, låse og åbninger": "Entrances, locks, and openings",
    "Vis højst åbne sensorer": "Maximum open sensors", "Lås alle": "Lock all", "Alle lukkede": "All closed",
    "Ingen åbne døre eller vinduer": "No open doors or windows", "Kræver opmærksomhed": "Needs attention",
    "Huset er sikret": "Home is secure", "Klar til tilkobling": "Ready to arm", "Systemer online": "Systems online",
    "Komplet styring": "Full controls", "Kompakt status": "Compact status", "Kun billede eller kort": "Image or map only",
    "Kun status og styring": "Status and controls only", "Hurtige enhedsknapper": "Quick device buttons",
    "Printerkameraer": "Printer cameras", "Printstatus og styring": "Print status and controls", "Livekamera": "Live camera",
    "Statuskamera": "Status camera", "Ikke valgt": "Not selected", "Alt indhold": "All content",
    "Kompakt status og styring": "Compact status and controls", "Kun status og målinger": "Status and measurements only",
    "Vis billeder af emnet": "Show model images", "Maks. billeder": "Maximum images", "Billeder af emnet": "Model images",
    "Lys i printeren": "Printer light", "Resterende": "Remaining", "Lag": "Layer", "Dyse": "Nozzle", "Byggeplade": "Build plate",
    "Navigation og views": "Navigation and views", "Administrer sider": "Manage pages",
    "Træk i håndtaget for at ændre rækkefølgen. Standardsider kan altid gendannes fra biblioteket.": "Drag the handle to change the order. Standard pages can always be restored from the library.",
    "Opret side": "Create page", "Navn på ny side": "New page name", "Tom side": "Empty page",
    "Fjernede standardsider": "Removed standard pages", "Opret igen": "Create again", "Fjern": "Remove",
    "Fjern siden fra navigationen? Standardsider kan altid gendannes.": "Remove the page from navigation? Standard pages can always be restored.",
    "Layout-historik": "Layout history", "Gendan tidligere layout": "Restore previous layout", "Gemte layout": "Saved layout",
    "Ryd egne kort": "Clear custom cards", "Eksportér": "Export", "Importér": "Import", "Nulstil": "Reset", "Gendan": "Restore",
    "Åbn kameramenu": "Open camera menu", "Vælg kameraer": "Select cameras", "Start pauseskærm": "Start screensaver",
    "Livekvalitet": "Live quality", "Lyd fra": "Sound off", "Lyd til": "Sound on", "Vælg kamerakvalitet": "Select camera quality"
    ,"Rediger kameralayout": "Edit camera layout", "Rediger vejrlayout": "Edit weather layout", "Rediger musiklayout": "Edit music layout",
    "Rediger sikkerhedslayout": "Edit security layout", "Rediger kalenderlayout": "Edit calendar layout",
    "Indbyggede kort · Dashboard": "Built-in cards · Dashboard", "Indbyggede kort · Tablet": "Built-in cards · Tablet", "Indbyggede kort · Mobil": "Built-in cards · Mobile",
    "Rediger Kameraer": "Edit Cameras", "Rediger Vejr": "Edit Weather", "Rediger Musik": "Edit Music",
    "Ændringer gemmes kun til profilen Dashboard. De andre skærmstørrelser beholder deres eget layout.": "Changes are saved only for the Dashboard profile. Other screen sizes keep their own layout.",
    "Ændringer gemmes kun til profilen Tablet. De andre skærmstørrelser beholder deres eget layout.": "Changes are saved only for the Tablet profile. Other screen sizes keep their own layout.",
    "Ændringer gemmes kun til profilen Mobil. De andre skærmstørrelser beholder deres eget layout.": "Changes are saved only for the Mobile profile. Other screen sizes keep their own layout.",
    "Lige nu": "Right now", "Skyet": "Cloudy", "Solrigt": "Sunny", "Delvist skyet": "Partly cloudy",
    "Regn": "Rain", "Nedbør": "Precipitation", "Sky": "Clouds", "Vind": "Wind", "Lyn": "Lightning",
    "Fugtighed": "Humidity", "Lufttryk": "Pressure", "Sigtbarhed": "Visibility", "Temperatur · nedbør · vind": "Temperature · precipitation · wind",
    "Dag / nat og risiko for regn": "Day / night and rain risk", "Henter timeudsigt…": "Loading hourly forecast…", "Henter ugeudsigt…": "Loading weekly forecast…",
    "Forbrug og priser": "Usage and prices", "Nu": "Now", "Forbrug nu": "Usage now", "Forbrug i dag": "Usage today",
    "Lav belastning": "Low load", "Normal belastning": "Normal load", "Høj belastning": "High load",
    "Gennemsnit": "Average", "Billigst": "Cheapest", "Dyrest": "Most expensive", "Bedste 3 timer": "Best 3 hours",
    "Forbrug seneste 24 timer": "Usage over the last 24 hours", "Snit": "Average", "Bund": "Low", "24 t siden": "24 hours ago",
    "Planlæg større forbrug": "Schedule larger loads", "Normalt prisniveau": "Normal price level", "Billig": "Cheap", "Dyr": "Expensive", "Normal": "Normal",
    "Tre timer": "Three hours", "over snit": "above average", "under snit": "below average",
    "Døre låst": "Doors locked", "Åbne lige nu": "Open now", "Hjemme": "Home", "Ude": "Away", "Fuld tilkobling": "Arm away",
    "Fuld tilkobling låser automatisk dashboardet": "Arming away automatically locks the dashboard", "Integrationer": "Integrations",
    "Sikkerhedssystem": "Security system", "Døren er lukket · låst": "Door is closed · locked", "Døren er åben · låst": "Door is open · locked",
    "Døren er lukket · ulåst": "Door is closed · unlocked", "Døren er åben · ulåst": "Door is open · unlocked",
    "Afspil på": "Play on", "i gruppen": "in group", "Lydstyrke": "Volume", "Dit musikbibliotek": "Your music library",
    "Søg efter musik, album eller radio…": "Search for music, albums, or radio…", "Henter playlister…": "Loading playlists…",
    "Docket": "Docked", "Beholder klar": "Bin ready", "Send i dock": "Send to dock", "Tøm beholder": "Empty bin",
    "Flyt knapper": "Move buttons", "Ryd valg": "Clear selection", "Hele huset": "Whole house", "Start rengøring": "Start cleaning", "rum valgt": "rooms selected",
    "Sugestyrke": "Suction power", "Vand": "Water", "Moppetype": "Mop type", "Klar": "Ready", "Slukket": "Off", "Forbundet": "Connected",
    "Printer nu": "Printing now", "Printjob": "Print job", "Fortsæt": "Resume", "Stop print": "Stop print",
    "Filament": "Filament", "Plads 1": "Slot 1", "Plads 2": "Slot 2", "Plads 3": "Slot 3", "Plads 4": "Slot 4", "▶  Fortsæt": "▶  Resume", "■  Stop print": "■  Stop print",
    "3D Printer · Livekamera": "3D Printer · Live camera", "Bambu Lab P1S · Statuskamera": "Bambu Lab P1S · Status camera"
  };
  Object.assign(en, dashboardEn);
  Object.assign(en, adminEn);

  function currentLanguage() {
    const stored = typeof BeastLocalSettings !== "undefined" ? BeastLocalSettings.get("language", "en") : "en";
    return stored === "da" ? "da" : "en";
  }

  function translateText(value) {
    const leading = value.match(/^\s*/)?.[0] || "";
    const trailing = value.match(/\s*$/)?.[0] || "";
    const core = value.trim();
    if (en[core]) return `${leading}${en[core]}${trailing}`;
    const patterns = [
      [/^Næste (\d+) timer$/, "Next $1 hours"], [/^De næste (\d+) dage$/, "Next $1 days"],
      [/^(\d+) rum valgt$/, "$1 rooms selected"], [/^(\d+) åbne$/, "$1 open"],
      [/^(\d+) dage$/, "$1 days"], [/^1 billede$/, "1 image"], [/^(\d+) billeder$/, "$1 images"],
      [/^Vis flere · (\d+) tilbage$/, "Show more · $1 remaining"],
      [/^(\d+) entityfelt · (.+)$/, "$1 entity field · $2"], [/^(\d+) entityfelter · (.+)$/, "$1 entity fields · $2"],
      [/^(\d+) krævet · (\d+) felter i alt$/, "$1 required · $2 fields total"],
      [/^(\d+(?:[.,]\d+)?) km\/t$/, "$1 km/h"], [/^(\d+) t (\d+) min$/, "$1 h $2 min"],
      [/^−(\d+) t$/, "−$1 h"], [/^(\d+) t drift$/, "$1 h runtime"],
      [/^(\d+) i gruppen$/, "$1 in group"], [/^(\d+) rum valgt$/, "$1 rooms selected"],
      [/^(\d+) åbne døre eller vinduer · (\d+) ulåste · (\d+\/\d+) systemer online$/, "$1 open doors or windows · $2 unlocked · $3 systems online"],
      [/^(\d+) dør- og vinduessensorer overvåges$/, "$1 door and window sensors monitored"],
      [/^Planlæg større forbrug fra (.+)$/, "Schedule larger loads from $1"],
      [/^Tre timer til ca\. (.+)$/, "Three hours at about $1"],
      [/^Normal · (\d+)% over snit$/, "Normal · $1% above average"],
      [/^Normal · (\d+)% under snit$/, "Normal · $1% below average"],
      [/^Billigst kl\. (.+)$/, "Cheapest at $1"], [/^Dyrest kl\. (.+)$/, "Most expensive at $1"],
      [/^Snit (.+)$/, "Average $1"], [/^Bund (.+)$/, "Low $1"], [/^(\d+) % fugt · (.+) drift$/, "$1% humidity · $2 runtime"],
      [/^Rediger (.+)$/, "Edit $1"], [/^Redigerer (.+)$/, "Editing $1"]
    ];
    for (const [pattern, replacement] of patterns) if (pattern.test(core)) return `${leading}${core.replace(pattern, replacement)}${trailing}`;
    return value;
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

  window.HASmartdashI18n = {
    get language() { return currentLanguage(); },
    get locale() { return currentLanguage() === "da" ? "da-DK" : "en-GB"; },
    t(value) { return currentLanguage() === "en" ? translateText(String(value)).trim() : String(value); },
    translate
  };

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
