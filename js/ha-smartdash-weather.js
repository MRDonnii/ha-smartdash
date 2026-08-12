(function () {
  function weatherEntityId() { return BeastConfig.get("panels.weather.entity"); }
  const RADAR_LAYERS = [
    { id: "precipitation", label: "Nedbør & Lyn", icon: "cloud-rain", source: "Windy.com", overlay: "radar" },
    { id: "satellite", label: "Sky", icon: "cloud", source: "Windy.com", overlay: "satellite" },
    { id: "wind", label: "Vind", icon: "wind", source: "Windy.com", overlay: "wind" }
  ];

  let rootEl = null;
  let hourly = [];
  let daily = [];
  let radarLayer = "precipitation";
  let location = null;
  let retryTimerId = null;
  let loadInFlight = false;
  let lastKnownReady = 0;

  function number(value, suffix = "", digits = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? `${parsed.toFixed(digits)}${suffix}` : "–";
  }

  // Same animated sun/cloud/rain icons as the Overview glance card — one
  // shared implementation (BeastCore.animatedWeatherIcon) so the whole app
  // agrees on what weather looks like, not just what it's called.
  function icon(condition, size = 28) {
    return BeastCore.animatedWeatherIcon(BeastCore.weatherMeta(condition).mood, size);
  }

  async function forecast(type) {
    const weatherId = weatherEntityId();
    const payload = await BeastAuth.haFetch("/api/services/weather/get_forecasts?return_response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_id: weatherId, type })
    });
    return payload?.service_response?.[weatherId]?.forecast || payload?.[weatherId]?.forecast || [];
  }

  function currentMarkup() {
    const state = BeastHaSocket.getState(weatherEntityId());
    const a = state?.attributes || {};
    const current = BeastCore.weatherMeta(state?.state);
    return `
      <section class="beast-weather-current">
        <div class="beast-weather-current-main">
          <span class="beast-weather-current-icon">${BeastCore.animatedWeatherIcon(current.mood, 78)}</span>
          <div><small>Lige nu</small><strong>${number(a.temperature, "°", 1)}</strong><span>${current.label}</span></div>
        </div>
        <div class="beast-weather-detail-grid">
          <div>${BeastCore.icon("droplet", { size: 22 })}<span>Fugtighed</span><strong>${number(a.humidity, "%")}</strong></div>
          <div>${BeastCore.icon("wind", { size: 22 })}<span>Vind</span><strong>${number(a.wind_speed, ` ${a.wind_speed_unit || "km/t"}`)}</strong></div>
          <div>${BeastCore.icon("grid", { size: 22 })}<span>Lufttryk</span><strong>${number(a.pressure, ` ${a.pressure_unit || "hPa"}`)}</strong></div>
          <div>${BeastCore.icon("eye", { size: 22 })}<span>Sigtbarhed</span><strong>${number(a.visibility, ` ${a.visibility_unit || "km"}`)}</strong></div>
        </div>
      </section>
    `;
  }

  function hourlyMarkup() {
    const hours = Number(BeastNativePageEditor.option("weather", "summary", "hours", 12));
    return `<section class="beast-weather-hourly"><header><strong>Næste ${hours} timer</strong><small>Temperatur · nedbør · vind</small></header><div>
      ${hourly.slice(0, hours).map((item) => {
        const date = new Date(item.datetime);
        return `<article><time>${date.toLocaleTimeString(window.HASmartdashI18n?.locale || "da-DK", { hour: "2-digit", minute: "2-digit" })}</time>${icon(item.condition)}
          <strong>${number(item.temperature, "°")}</strong><span>${BeastCore.icon("droplet", { size: 13 })}${number(item.precipitation_probability, "%")}</span>
          <small>${number(item.wind_speed, " km/t")}</small></article>`;
      }).join("") || "<p>Henter timeudsigt…</p>"}
    </div></section>`;
  }

  function dailyMarkup() {
    const days = Number(BeastNativePageEditor.option("weather", "week", "days", 7));
    return `<section class="beast-weather-week"><header><strong>De næste ${days} dage</strong><small>Dag / nat og risiko for regn</small></header><div>
      ${daily.slice(0, days).map((item, index) => {
        const date = new Date(item.datetime);
        const day = index === 0 ? "I dag" : date.toLocaleDateString(window.HASmartdashI18n?.locale || "da-DK", { weekday: "long" });
        return `<article><time>${day}</time>${icon(item.condition, 34)}<span>${BeastCore.weatherMeta(item.condition).label}</span>
          <div><strong>${number(item.temperature, "°")}</strong><small>${number(item.templow, "°")}</small></div>
          <b>${BeastCore.icon("droplet", { size: 14 })}${number(item.precipitation_probability, "%")}</b></article>`;
      }).join("") || "<p>Henter ugeudsigt…</p>"}
    </div></section>`;
  }

  function radarMarkup() {
    return `<section class="beast-weather-radar">
      <header>
        <div><strong>Radar</strong><small id="beastRadarSource">Windy.com</small></div>
      </header>
      <div class="beast-radar-layer-tabs">
        ${RADAR_LAYERS.map((l) => `<button type="button" class="beast-radar-layer-btn${l.id === radarLayer ? " is-active" : ""}" data-layer="${l.id}">${BeastCore.icon(l.icon, { size: 15 })}<span>${l.label}</span></button>`).join("")}
      </div>
      <div class="beast-radar-map" id="beastRadarMap"></div>
    </section>`;
  }

  function render() {
    if (!rootEl) return;
    if (!rootEl.querySelector(".beast-weather-dashboard")) {
      rootEl.innerHTML = `<button type="button" class="beast-page-edit-trigger" id="beastWeatherLayoutEdit" aria-label="Rediger vejrlayout">⋮</button><div class="beast-weather-dashboard"><div class="beast-weather-left">${currentMarkup()}${hourlyMarkup()}</div>${radarMarkup()}${dailyMarkup()}</div>`;
      rootEl.querySelectorAll("[data-layer]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (btn.dataset.layer === radarLayer) return;
          radarLayer = btn.dataset.layer;
          updateRadarTabs();
          drawRadar();
        });
      });
      drawRadar();
      wireWeatherLayout();
      return;
    }
    const current = rootEl.querySelector(".beast-weather-current");
    const hourlySection = rootEl.querySelector(".beast-weather-hourly");
    const weekly = rootEl.querySelector(".beast-weather-week");
    if (current) current.outerHTML = currentMarkup();
    if (hourlySection) hourlySection.outerHTML = hourlyMarkup();
    if (weekly) weekly.outerHTML = dailyMarkup();
    wireWeatherLayout();
  }

  function wireWeatherLayout() {
    const layout = BeastConfig.get("pageLayouts.weather.weatherLayout") || {};
    const hidden = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
    const selectors = { current: ".beast-weather-current", hourly: ".beast-weather-hourly", week: ".beast-weather-week", radar: ".beast-weather-radar" };
    Object.entries(selectors).forEach(([id, selector]) => rootEl.querySelector(selector)?.classList.toggle("is-layout-hidden", hidden.has(id)));
    const button = rootEl.querySelector("#beastWeatherLayoutEdit");
    if (button) BeastNativePageEditor.mount({ section:"weather", label:"Vejr", root:()=>rootEl, host:()=>rootEl.querySelector(".beast-weather-dashboard"), trigger:"#beastWeatherLayoutEdit", onSave:()=>render(), cards:()=>[
      { id:"summary", label:"Aktuelt vejr og timeudsigt", selector:".beast-weather-left", enabled:!hidden.has("current") || !hidden.has("hourly"), desktop:{x:1,y:1,w:5,h:9}, options:{hours:12}, controls:[{key:"hours",label:"Timer i udsigten",min:3,max:24,step:1,default:12}] },
      { id:"radar", label:"Vejrradar", selector:".beast-weather-radar", titleSelector:"header strong", enabled:!hidden.has("radar"), desktop:{x:6,y:1,w:7,h:9} },
      { id:"week", label:"Ugeudsigt", selector:".beast-weather-week", titleSelector:"header strong", enabled:!hidden.has("week"), desktop:{x:1,y:10,w:12,h:3}, options:{days:7}, controls:[{key:"days",label:"Dage i udsigten",min:1,max:10,step:1,default:7}] }
    ] });
  }

  function openWeatherLayout(layout) {
    const hidden = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
    const items = [["current","Aktuelt vejr"],["hourly","Timeudsigt"],["week","Ugeudsigt"],["radar","Radar"]];
    const overlay = document.createElement("div"); overlay.className = "beast-modal-overlay";
    overlay.innerHTML = `<div class="beast-modal"><div class="beast-modal-header"><h3>Rediger vejrlayout</h3><button type="button" class="beast-modal-close" data-close>×</button></div><div class="beast-modal-body"><div class="beast-weather-layout-list">${items.map(([id,label]) => `<label><input type="checkbox" data-weather-section="${id}" ${hidden.has(id)?"":"checked"}><strong>${label}</strong></label>`).join("")}</div><button type="button" class="beast-btn beast-btn-primary" data-save-weather-layout>Gem layout</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (event) => { if (event.target===overlay || event.target.closest("[data-close]")) return overlay.remove(); if (!event.target.closest("[data-save-weather-layout]")) return; const nextHidden=items.filter(([id])=>!overlay.querySelector(`[data-weather-section="${id}"]`).checked).map(([id])=>id); BeastConfig.set("pageLayouts.weather.weatherLayout", {...layout,hidden:nextHidden}); overlay.remove(); wireWeatherLayout(); });
  }

  function updateRadarTabs() {
    rootEl.querySelectorAll("[data-layer]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.layer === radarLayer);
    });
    const source = document.getElementById("beastRadarSource");
    if (source) source.textContent = RADAR_LAYERS.find((l) => l.id === radarLayer)?.source || "";
  }

  function windyEmbedUrl(overlay) {
    const params = new URLSearchParams({
      type: "map",
      location: "coordinates",
      metricRain: "mm",
      metricTemp: "°C",
      metricWind: "m/s",
      zoom: "11",
      overlay,
      product: "ecmwf",
      level: "surface",
      lat: location.latitude.toFixed(3),
      lon: location.longitude.toFixed(3),
      detailLat: location.latitude.toFixed(3),
      detailLon: location.longitude.toFixed(3),
      marker: "true",
      message: "true"
    });
    return `https://embed.windy.com/embed.html?${params.toString()}`;
  }

  function drawRadar() {
    const map = document.getElementById("beastRadarMap");
    if (!map) return;
    const layer = RADAR_LAYERS.find((l) => l.id === radarLayer);
    const src = location ? windyEmbedUrl(layer.overlay) : null;
    if (!src) {
      map.innerHTML = `<div class="beast-radar-empty">${BeastCore.icon("cloud-rain", { size: 30 })}<strong>Henter kortdata…</strong><span>Venter på husets placering fra Home Assistant.</span></div>`;
      return;
    }
    const existing = map.querySelector("iframe");
    if (existing && existing.dataset.layer === radarLayer) return;
    map.innerHTML = `<iframe class="beast-radar-iframe" data-layer="${radarLayer}" src="${src}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allow="geolocation" allowfullscreen></iframe>`;
  }

  function scheduleRetry(delay = 5000) {
    window.clearTimeout(retryTimerId);
    retryTimerId = window.setTimeout(() => {
      retryTimerId = null;
      load();
    }, delay);
  }

  async function load() {
    if (!weatherEntityId() || loadInFlight) return;
    loadInFlight = true;
    const jobs = [
      forecast("hourly").then((items) => { hourly = items; }),
      forecast("daily").then((items) => { daily = items; }),
      BeastAuth.haFetch("/api/config").then((config) => {
        location = { latitude: Number(config.latitude), longitude: Number(config.longitude) };
      })
    ];
    const results = await Promise.allSettled(jobs);
    loadInFlight = false;
    const weatherState = BeastHaSocket.getState(weatherEntityId());
    const ready = results.every((result) => result.status === "fulfilled") && Boolean(weatherState);
    if (ready) {
      lastKnownReady = Date.now();
      render();
      drawRadar();
      return;
    }
    render();
    drawRadar();
    scheduleRetry(lastKnownReady ? 12000 : 5000);
  }

  function init(root) {
    rootEl = root;
    rootEl.classList.add("beast-weather-panel");
    if (!weatherEntityId()) {
      rootEl.innerHTML = BeastCore.notConfiguredMarkup("Vejr", "Vælg en vejr-entity i Administration for at aktivere dette panel.");
      BeastCore.wireNotConfiguredLinks(rootEl);
      return;
    }
    render();
    load();
    BeastHaSocket.onStatusChange((status) => {
      if (status === "connected") load();
      else if (status === "connecting") scheduleRetry(4000);
    });
    BeastHaSocket.subscribeEntity(weatherEntityId(), BeastCore.stableUpdater(rootEl, () => {
      load();
    }, 800));
  }

  BeastCore.registerPanel("weather", "beastWeatherZone", init);
})();
