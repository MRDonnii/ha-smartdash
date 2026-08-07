(() => {
  "use strict";

  const KEY = "ha-smartdash-language";
  const supported = new Set(["en", "da"]);
  const initial = localStorage.getItem(KEY) || "en";
  let language = supported.has(initial) ? initial : "en";

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

  function translateText(value) {
    if (language !== "en") return value;
    const leading = value.match(/^\s*/)?.[0] || "";
    const trailing = value.match(/\s*$/)?.[0] || "";
    const core = value.trim();
    return en[core] ? `${leading}${en[core]}${trailing}` : value;
  }

  function translate(root = document.body) {
    if (!root) return;
    document.documentElement.lang = language;
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
        if (value && en[value] && language === "en") element.setAttribute(attribute, en[value]);
      });
    });
  }

  function mountSelector() {
    if (!document.body || document.querySelector(".ha-language-picker")) return;
    const label = document.createElement("label");
    label.className = "ha-language-picker";
    label.innerHTML = `<span>Language</span><select aria-label="Language"><option value="en">EN</option><option value="da">DA</option></select>`;
    label.querySelector("select").value = language;
    label.querySelector("select").addEventListener("change", (event) => {
      localStorage.setItem(KEY, event.target.value);
      location.reload();
    });
    document.body.appendChild(label);
  }

  const style = document.createElement("style");
  style.textContent = `.ha-language-picker{position:fixed;right:14px;bottom:14px;z-index:10020;display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid rgba(255,255,255,.16);border-radius:10px;background:rgba(7,10,14,.82);backdrop-filter:blur(12px);color:#d8e1ea;font:600 11px/1 system-ui}.ha-language-picker select{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer}.ha-language-picker option{background:#111820}.ha-language-picker span{opacity:.7}@media(max-width:700px){.ha-language-picker{right:8px;bottom:8px}.ha-language-picker span{display:none}}`;
  document.head.appendChild(style);

  window.HASmartdashI18n = { get language() { return language; }, translate };
  document.addEventListener("DOMContentLoaded", () => {
    mountSelector();
    translate();
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; translate(); mountSelector(); });
    }).observe(document.body, { childList: true, subtree: true });
  });
})();
