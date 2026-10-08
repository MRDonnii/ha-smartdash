(function () {
  function weatherEntityId() { return BeastConfig.get("panels.weather.entity"); }
  // Optional: an image entity (e.g. a national radar with lightning) shown
  // instead of the web precipitation and lightning maps.
  function radarImageId() { return BeastConfig.get("panels.weather.radarImage") || null; }
  // Optional: a sensor whose `varsler`/`warnings` attribute lists warnings.
  function warningsId() { return BeastConfig.get("panels.weather.warnings") || null; }
  const WEB_LAYERS = [
    { id: "precipitation", label: "Nedbør", icon: "cloud-rain", source: "Windy.com", overlay: "radar" },
    { id: "satellite", label: "Sky", icon: "cloud", source: "Windy.com", overlay: "satellite" },
    { id: "wind", label: "Vind", icon: "wind", source: "Windy.com", overlay: "wind" },
    { id: "lightning", label: "Lyn", icon: "bolt", source: "Blitzortung.org", overlay: null }
  ];
  function radarLayers() {
    if (!radarImageId()) return WEB_LAYERS;
    const name = BeastHaSocket.getState(radarImageId())?.attributes?.friendly_name || "Radarbillede";
    return [{ id: "precipitation", label: "Nedbør og lyn", icon: "cloud-rain", source: name, image: true }, ...WEB_LAYERS.filter((l) => l.id === "satellite" || l.id === "wind")];
  }
  // Extra measurement groups, each a multi-select of sensors in Administration.
  const DETAIL_GROUPS = [
    ["detailNow", "Målt nu", "thermometer"], ["detailPrecip", "Nedbør og lyn", "cloud-rain"],
    ["detailRisk", "Risiko", "shield"], ["detailToday", "I dag", "calendar"], ["detailWater", "Vand og hav", "droplet"]
  ];
  function detailGroups() {
    return DETAIL_GROUPS.map(([key, label, icon]) => ({ key, label, icon, ids: (BeastConfig.get(`panels.weather.${key}`) || []).filter(Boolean) })).filter((g) => g.ids.length);
  }
  let detailTab = null;

  let rootEl = null;
  let hourly = [];
  let daily = [];
  let radarLayer = "precipitation";
  let location = null;

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

  function esc(value) {
    return String(value ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
  }

  function when(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const locale = window.HASmartdashI18n?.locale || "da-DK";
    return `${d.toLocaleDateString(locale, { weekday: "short" })} ${d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
  }

  function warningsMarkup() {
    const state = warningsId() ? BeastHaSocket.getState(warningsId()) : null;
    if (!state || state.state === "unavailable") return "";
    const list = state.attributes?.varsler || state.attributes?.warnings || [];
    if (!list.length) return `<div class="beast-weather-warn-none">${BeastCore.icon("shield", { size: 15 })}<span>Ingen aktive vejrvarsler</span></div>`;
    return `<div class="beast-weather-warnings">${list.map((w) => {
      const level = Math.min(4, Math.max(2, Number(w.niveau ?? w.level) || 2));
      const span = [w.start || w.onset, w.slut || w.expires].map(when).filter(Boolean).join(" – ");
      return `<div class="beast-weather-warning is-level-${level}">${BeastCore.icon("bell", { size: 20 })}<div><strong>${esc(w.overskrift || w.headline || w.type || w.event || "Varsel")}</strong><small>${esc(span)}</small>${w.beskrivelse || w.description ? `<p>${esc(w.beskrivelse || w.description)}</p>` : ""}</div></div>`;
    }).join("")}</div>`;
  }

  function currentMarkup() {
    const state = BeastHaSocket.getState(weatherEntityId());
    const a = state?.attributes || {};
    const current = BeastCore.weatherMeta(state?.state);
    return `
      <section class="beast-weather-current">
        ${warningsMarkup()}
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

  function detailValue(state) {
    if (!state || ["unknown", "unavailable"].includes(state.state)) return "–";
    const a = state.attributes || {};
    if (a.device_class === "timestamp") return when(state.state) || state.state;
    const number = Number(state.state);
    const unit = a.unit_of_measurement ? ` ${a.unit_of_measurement}` : "";
    if (!Number.isFinite(number)) return `${state.state}${unit}`;
    const digits = Math.abs(number) >= 100 ? 0 : 1;
    return `${number.toLocaleString(window.HASmartdashI18n?.locale || "da-DK", { maximumFractionDigits: digits })}${unit}`;
  }

  function detailNote(state) {
    const a = state?.attributes || {};
    if (a.station) return `${a.station}${Number.isFinite(Number(a.afstand_km)) ? ` · ${Math.round(Number(a.afstand_km))} km` : ""}`;
    if (a["i_går"] !== undefined && a["i_går"] !== null) return `I går ${Number(a["i_går"]).toLocaleString(window.HASmartdashI18n?.locale || "da-DK", { maximumFractionDigits: 1 })}${a.unit_of_measurement ? ` ${a.unit_of_measurement}` : ""}`;
    if (a["næste_6_timer"] !== undefined && a["næste_6_timer"] !== null) return `Næste 6 t: ${a["næste_6_timer"]} %`;
    if (a.niveau_cm !== undefined) return `${Math.round(Number(a.niveau_cm))} cm`;
    return "";
  }

  function detailName(id) {
    const name = BeastHaSocket.getState(id)?.attributes?.friendly_name || id;
    // Sensors of a weather integration usually repeat its device name.
    const device = BeastHaSocket.getState(weatherEntityId())?.attributes?.friendly_name;
    return device && name.startsWith(`${device} `) ? name.slice(device.length + 1) : name;
  }

  function detailsMarkup() {
    const groups = detailGroups();
    if (!groups.length) return "";
    const active = groups.find((g) => g.key === detailTab) || groups[0];
    detailTab = active.key;
    return `<section class="beast-weather-details">
      <header><div><strong>Målinger</strong><small>${esc(active.label)}</small></div></header>
      <div class="beast-weather-detail-tabs">${groups.map((g) => `<button type="button" class="beast-radar-layer-btn${g.key === active.key ? " is-active" : ""}" data-detail-tab="${g.key}">${BeastCore.icon(g.icon, { size: 14 })}<span>${esc(g.label)}</span></button>`).join("")}</div>
      <div class="beast-weather-detail-rows">${active.ids.map((id) => {
        const state = BeastHaSocket.getState(id);
        const value = detailValue(state);
        const note = detailNote(state);
        return `<div class="beast-weather-detail-row${value === "–" ? " is-off" : ""}" data-entity-id="${esc(id)}"><span>${esc(detailName(id))}${note ? `<small>${esc(note)}</small>` : ""}</span><strong>${esc(value)}</strong></div>`;
      }).join("")}</div>
    </section>`;
  }

  function wireDetails() {
    rootEl.querySelectorAll("[data-detail-tab]").forEach((btn) => btn.addEventListener("click", () => {
      detailTab = btn.dataset.detailTab;
      renderDetails();
    }));
  }

  function renderDetails() {
    const section = rootEl?.querySelector(".beast-weather-details");
    if (!section) return;
    section.outerHTML = detailsMarkup();
    wireDetails();
    wireWeatherLayout();
  }

  function radarMarkup() {
    return `<section class="beast-weather-radar">
      <header>
        <div><strong>Radar</strong><small id="beastRadarSource">${esc((radarLayers().find((l) => l.id === radarLayer) || radarLayers()[0]).source)}</small></div>
      </header>
      <div class="beast-radar-layer-tabs">
        ${radarLayers().map((l) => `<button type="button" class="beast-radar-layer-btn${l.id === radarLayer ? " is-active" : ""}" data-layer="${l.id}">${BeastCore.icon(l.icon, { size: 15 })}<span>${l.label}</span></button>`).join("")}
      </div>
      <div class="beast-radar-map" id="beastRadarMap"></div>
    </section>`;
  }

  // Every panel section is its own <section>, so on data updates we can swap
  // just that section's markup instead of rebuilding the whole page — the
  // radar section holds a live embedded iframe (Windy/Blitzortung) that must
  // never be touched by unrelated updates (e.g. the weather entity ticking
  // its temperature), or it reloads and loses the user's pan/zoom/timeline.
  function render() {
    if (!rootEl) return;
    if (!rootEl.querySelector(".beast-weather-dashboard")) {
      rootEl.innerHTML = `<button type="button" class="beast-page-edit-trigger" id="beastWeatherLayoutEdit" aria-label="Rediger vejrlayout">⋮</button><div class="beast-weather-dashboard${detailGroups().length ? " has-details" : ""}"><div class="beast-weather-left">${currentMarkup()}${hourlyMarkup()}</div>${radarMarkup()}${detailsMarkup()}${dailyMarkup()}</div>`;
      wireDetails();
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
    rootEl.querySelector(".beast-weather-current").outerHTML = currentMarkup();
    rootEl.querySelector(".beast-weather-hourly").outerHTML = hourlyMarkup();
    rootEl.querySelector(".beast-weather-week").outerHTML = dailyMarkup();
    renderDetails();
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
      { id:"week", label:"Ugeudsigt", selector:".beast-weather-week", titleSelector:"header strong", enabled:!hidden.has("week"), desktop:{x:1,y:10,w:12,h:3}, options:{days:7}, controls:[{key:"days",label:"Dage i udsigten",min:1,max:10,step:1,default:7}] },
      // Only offered when measurement groups are configured, so layouts of
      // installations without them stay exactly as they were.
      ...(detailGroups().length ? [{ id:"details", label:"Målinger", selector:".beast-weather-details", titleSelector:"header strong", enabled:!hidden.has("details"), desktop:{x:1,y:13,w:12,h:4} }] : [])
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
    if (source) source.textContent = radarLayers().find((l) => l.id === radarLayer)?.source || "";
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

  // Same embed params as the "Lyn" tab already configured in the real HA
  // dashboard (energi-overblik → Vejret): Cookies=0/Advertisment=0 strip the
  // consent banner and ads, and the #zoom/lat/lon hash centers on home.
  function blitzortungEmbedUrl() {
    const params = new URLSearchParams({
      interactive: "1",
      NavigationControl: "1",
      FullScreenControl: "0",
      Cookies: "0",
      InfoDiv: "0",
      MenuButtonDiv: "0",
      ScaleControl: "0",
      LinksCheckboxChecked: "1",
      LinksRangeValue: "10",
      MapStyle: "2",
      MapStyleRangeValue: "10",
      Advertisment: "0"
    });
    return `https://map.blitzortung.org/index.php?${params.toString()}#7/${location.latitude.toFixed(3)}/${location.longitude.toFixed(3)}`;
  }

  function drawRadar() {
    const map = document.getElementById("beastRadarMap");
    if (!map) return;
    const layer = radarLayers().find((l) => l.id === radarLayer) || radarLayers()[0];
    if (layer.image) {
      const picture = BeastHaSocket.getState(radarImageId())?.attributes?.entity_picture;
      let img = map.querySelector("img.beast-radar-image");
      if (!img) {
        map.innerHTML = `<img class="beast-radar-image" alt="Radarkort">`;
        img = map.querySelector("img");
      }
      if (picture && img.dataset.picture !== picture) {
        img.dataset.picture = picture;
        BeastAuth.setAuthedImageSrc(img, picture);
      }
      return;
    }
    const src = location ? (layer.overlay ? windyEmbedUrl(layer.overlay) : blitzortungEmbedUrl()) : null;
    if (!src) {
      map.innerHTML = `<div class="beast-radar-empty">${BeastCore.icon("cloud-rain", { size: 30 })}<strong>Henter kortdata…</strong><span>Venter på husets placering fra Home Assistant.</span></div>`;
      return;
    }
    const existing = map.querySelector("iframe");
    if (existing && existing.dataset.layer === radarLayer) return;
    map.innerHTML = `<iframe class="beast-radar-iframe" data-layer="${radarLayer}" src="${src}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allow="geolocation" allowfullscreen></iframe>`;
  }

  async function load() {
    if (!weatherEntityId()) return;
    const jobs = [
      forecast("hourly").then((items) => { hourly = items; }),
      forecast("daily").then((items) => { daily = items; }),
      BeastAuth.haFetch("/api/config").then((config) => {
        location = { latitude: Number(config.latitude), longitude: Number(config.longitude) };
      })
    ];
    await Promise.allSettled(jobs);
    render();
    drawRadar();
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
    // render() at mount only has whatever's already cached — if the panel is
    // opened before the initial get_states snapshot lands (or before the
    // weather entity's first state arrives), "current conditions" renders
    // empty and previously had nothing to wake it back up, since a weather
    // condition can go a long time between state_changed events. Re-render
    // once the socket confirms the snapshot is actually in.
    BeastHaSocket.onStatusChange((status) => { if (status === "connected") render(); });
    BeastHaSocket.subscribeEntity(weatherEntityId(), BeastCore.stableUpdater(rootEl, render, 800));
    if (warningsId()) BeastHaSocket.subscribeEntity(warningsId(), BeastCore.stableUpdater(rootEl, render, 800));
    // The radar image only swaps its picture; the iframe layers are untouched.
    if (radarImageId()) BeastHaSocket.subscribeEntity(radarImageId(), () => drawRadar());
    const detailUpdate = BeastCore.stableUpdater(rootEl, renderDetails, 1500);
    detailGroups().forEach((g) => g.ids.forEach((id) => BeastHaSocket.subscribeEntity(id, detailUpdate)));
  }

  BeastCore.registerPanel("weather", "beastWeatherZone", init);
})();
