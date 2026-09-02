// Shared library of "standard" card types any page's live card editor
// (js/ha-smartdash-card-editor.js) can offer alongside its own
// page-specific types, so a new page doesn't mean reinventing "pick an
// entity, show its value" from scratch every time.
//
// Usage from a page's BeastCardEditor.attach(options):
//   cardTypes: [...BeastStandardCards.types, ...myOwnTypes],
//   entityPickerTypes: [...BeastStandardCards.entityPickerTypes, ...myOwnEntityTypes],
//   renderCardMarkup: (card) => BeastStandardCards.isStandardType(card.type)
//     ? BeastStandardCards.renderMarkup(card)
//     : myOwnRenderCardMarkup(card),
//   allEntities: BeastCardEditor.allEntities,
//   onAfterRender: (cards) => { BeastStandardCards.wire(zoneEl); myOwnAfterRender(cards); },
window.BeastStandardCards = (function () {
  const historyCache = new Map();
  const TYPES = [
    ["stat", "Statistik"],
    ["toggle", "Touch-knap"],
    ["graph", "Graf"],
    ["camera", "Kamera"],
    ["media", "Medieafspiller"],
    ["calendar", "Kalender"],
    ["custom", "Valgfri HA-entity"],
  ];
  const ENTITY_PICKER_TYPES = TYPES.map(([value]) => value);

  function escape(value) {
    const el = document.createElement("span");
    el.textContent = String(value ?? "");
    return el.innerHTML;
  }

  function isStandardType(type) {
    return ENTITY_PICKER_TYPES.includes(type);
  }

  function formatState(state, fallback = "Ikke tilgængelig") {
    if (!state || ["unknown", "unavailable"].includes(state.state)) return fallback;
    const number = Number(state.state); if (!Number.isFinite(number)) return state.state;
    const requested = Number(state.attributes?.suggested_display_precision);
    const precision = Number.isFinite(requested) ? Math.max(0, Math.min(3, requested)) : (Math.abs(number) >= 100 ? 0 : Math.abs(number) >= 10 ? 1 : 2);
    return number.toLocaleString(window.HASmartdashI18n?.locale || "da-DK", { minimumFractionDigits: 0, maximumFractionDigits: precision });
  }

  async function historyPoints(entityId) {
    const cached = historyCache.get(entityId); if (cached?.points && Date.now() - cached.at < 5 * 60 * 1000) return cached.points;
    if (cached?.promise) return cached.promise;
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const promise = BeastAuth.haFetch(`/api/history/period/${encodeURIComponent(start)}?filter_entity_id=${encodeURIComponent(entityId)}&minimal_response&no_attributes`).then((payload) => {
      const values = (Array.isArray(payload?.[0]) ? payload[0] : []).map((item) => Number(item.state)).filter(Number.isFinite);
      const stride = Math.max(1, Math.ceil(values.length / 120)); const points = values.filter((_, index) => index % stride === 0);
      historyCache.set(entityId, { points, at: Date.now() }); return points;
    }).catch(() => { historyCache.set(entityId, { points: [], at: Date.now() }); return []; });
    historyCache.set(entityId, { promise, at: Date.now() }); return promise;
  }

  function templatePriceValues(bindings) {
    const states = [bindings.forecast, bindings.tomorrow, bindings.price].filter(Boolean).map((id) => BeastHaSocket.getState(id)).filter(Boolean);
    for (const state of states) {
      for (const value of Object.values(state.attributes || {})) {
        const list = Array.isArray(value?.value) ? value.value : (Array.isArray(value) ? value : null);
        if (!list) continue;
        const prices = list.map((entry) => Number(typeof entry === "number" ? entry : entry?.price ?? entry?.value)).filter(Number.isFinite);
        if (prices.length >= 4) return prices.slice(0, 24);
      }
    }
    return [];
  }

  function renderPriceTemplate(host, card, bindings) {
    const current = BeastHaSocket.getState(bindings.price);
    const prices = templatePriceValues(bindings);
    const currentValue = Number(current?.state);
    const max = Math.max(...prices, 1);
    host.innerHTML = `<div class="beast-template-energy-price"><header><div><small>Energi</small><strong>${escape(card.dataset.label || "Elpris time for time")}</strong></div><b>${Number.isFinite(currentValue) ? `${currentValue.toFixed(2)} kr/kWh` : "–"}</b></header>${prices.length ? `<div class="beast-template-energy-bars">${prices.map((price, index) => `<i style="--h:${Math.max(8, price / max * 100)}%;--c:${price < 1.5 ? "var(--success)" : price < 3 ? "var(--warning)" : "var(--danger)"}" title="${index}:00 · ${price.toFixed(2)} kr/kWh"></i>`).join("")}</div>` : `<em>Ingen prisprognose på den valgte entity</em>`}</div>`;
  }

  function renderUsageTemplate(host, card, bindings) {
    const power = BeastHaSocket.getState(bindings.power);
    const energy = BeastHaSocket.getState(bindings.energy);
    const cost = BeastHaSocket.getState(bindings.cost);
    host.innerHTML = `<div class="beast-template-energy-usage"><header><div><small>Energi</small><strong>${escape(card.dataset.label || "Forbrug 24 timer")}</strong></div><span><b>${escape(formatState(power, "–"))}</b> ${escape(power?.attributes?.unit_of_measurement || "")}</span></header><div class="beast-template-energy-usage-metrics"><span>I dag <b>${escape(formatState(energy, "–"))} ${escape(energy?.attributes?.unit_of_measurement || "")}</b></span><span>Pris <b>${escape(formatState(cost, "–"))} ${escape(cost?.attributes?.unit_of_measurement || "")}</b></span></div><div class="beast-standard-graph-history"><em>Henter historik…</em></div></div>`;
    const historyHost = host.querySelector(".beast-standard-graph-history");
    if (bindings.power) historyPoints(bindings.power).then((points) => { if (!historyHost?.isConnected) return; historyHost.innerHTML = points.length > 1 ? BeastCore.sparkline(points, { color: "var(--accent-b)", height: 100, chartKey: `card.${card.id || bindings.power}` }) : "<em>Ingen historik endnu</em>"; });
  }

  function bound(bindings, key) { const id = bindings[key]; return id ? BeastHaSocket.getState(id) : null; }
  function isOn(state) { return ["on","open","unlocked","playing","cleaning","mowing"].includes(state?.state); }
  function boundValue(bindings, key, fallback = "–") { return formatState(bound(bindings, key), fallback); }
  async function service(entityId, serviceName, data = {}) {
    if (!entityId || !serviceName) return;
    const domain = entityId.split(".")[0];
    const control = document.activeElement?.closest?.("button");
    control?.classList.add("is-busy"); if (control) control.disabled = true;
    try {
      const result = await BeastAuth.haFetch(`/api/services/${domain}/${serviceName}`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({entity_id:entityId,...data}) });
      control?.classList.add("is-command-ok"); window.setTimeout(() => control?.classList.remove("is-command-ok"), 700);
      return result;
    } catch (error) {
      control?.classList.add("is-command-error"); window.setTimeout(() => control?.classList.remove("is-command-error"), 1800);
      BeastCore.log(`Styring af ${entityId} fejlede: ${error.message}`);
      return null;
    } finally {
      control?.classList.remove("is-busy"); if (control) control.disabled = false;
    }
  }
  function missingMarkup(template, bindings) {
    const missing = (template?.fields || []).filter((field) => field.required && !bindings[field.key]);
    return missing.length ? `<div class="beast-template-warning">${BeastCore.icon("settings",{size:16})}<span>Mangler ${missing.map((field)=>escape(field.label)).join(", ")}</span></div>` : "";
  }
  function renderClimateTemplate(host, card, bindings, template) {
    const entityId = bindings.climate || card.dataset.entity; const climate = BeastHaSocket.getState(entityId);
    const current = bound(bindings,"temperature") || climate; const humidity = bound(bindings,"humidity");
    const target = Number(climate?.attributes?.temperature); const targetLabel = Number.isFinite(target) ? target.toFixed(1) : "–";
    host.innerHTML = `<div class="beast-template-climate"><header><span>${BeastCore.icon("thermometer",{size:25})}</span><div><small>Varme</small><strong>${escape(card.dataset.label || template.title)}</strong></div><b>${escape(current?.state || "–")}°</b></header><div class="beast-template-climate-target"><button data-climate-step="-0.5">−</button><span><small>Mål</small><strong>${targetLabel}°</strong></span><button data-climate-step="0.5">+</button></div><footer><span>${escape(climate?.attributes?.hvac_action || climate?.state || "Ikke tilgængelig")}</span><span>${humidity ? `${escape(formatState(humidity))}% fugt` : ""}</span></footer>${missingMarkup(template,bindings)}</div>`;
    host.querySelectorAll("[data-climate-step]").forEach((button)=>button.addEventListener("click",()=>{if(!entityId||!Number.isFinite(target))return;service(entityId,"set_temperature",{temperature:target+Number(button.dataset.climateStep)});}));
  }
  function renderSecurityTemplate(host, card, bindings, template) {
    const alarms = Object.keys(bindings).filter((key)=>key.startsWith("alarm")).map((key)=>({id:bindings[key],state:bound(bindings,key)}));
    const locks = Object.keys(bindings).filter((key)=>key.startsWith("lock")).map((key)=>({id:bindings[key],state:bound(bindings,key)}));
    const openings = Object.keys(bindings).filter((key)=>key.startsWith("opening")||key.startsWith("entry")).map((key)=>bound(bindings,key)).filter(Boolean);
    const open = openings.filter(isOn).length, unlocked = locks.filter((item)=>item.state?.state!=="locked").length;
    host.innerHTML = `<div class="beast-template-security"><header><span>${BeastCore.icon(open||unlocked?"unlock":"shield",{size:27})}</span><div><small>Sikkerhed</small><strong>${escape(card.dataset.label||template.title)}</strong></div><b class="${open||unlocked?"is-warning":"is-safe"}">${open||unlocked?"Opmærksomhed":"Sikret"}</b></header><div class="beast-template-security-metrics"><span><small>Åbne</small><strong>${open}</strong></span><span><small>Ulåste</small><strong>${unlocked}</strong></span><span><small>Systemer</small><strong>${alarms.filter((item)=>item.state&&!['unknown','unavailable'].includes(item.state.state)).length}/${alarms.length}</strong></span></div>${locks.length?`<div class="beast-template-security-actions">${locks.slice(0,4).map((item)=>`<button data-lock="${escape(item.id)}" data-locked="${item.state?.state==='locked'}">${BeastCore.icon(item.state?.state==='locked'?"lock":"unlock",{size:16})}${escape(item.state?.attributes?.friendly_name||"Lås")}</button>`).join("")}</div>`:""}${missingMarkup(template,bindings)}</div>`;
    host.querySelectorAll("[data-lock]").forEach((button)=>button.addEventListener("click",()=>service(button.dataset.lock,button.dataset.locked==="true"?"unlock":"lock")));
  }
  function renderRoomTemplate(host, card, bindings, template) {
    const light = bound(bindings,"light"), presence = bound(bindings,"presence");
    host.innerHTML = `<div class="beast-template-room"><header><span>${BeastCore.icon("home",{size:26})}</span><div><small>Rum</small><strong>${escape(card.dataset.label||template.title)}</strong></div>${presence?`<i class="${isOn(presence)?"is-on":""}">${isOn(presence)?"Aktiv":"Tomt"}</i>`:""}</header><div class="beast-template-room-values"><span><small>Temperatur</small><strong>${escape(boundValue(bindings,"temperature"))}°</strong></span><span><small>Fugtighed</small><strong>${escape(boundValue(bindings,"humidity"))}%</strong></span></div>${bindings.light?`<button class="beast-template-room-light" data-room-light="${escape(bindings.light)}" data-on="${isOn(light)}">${BeastCore.icon("bolt",{size:18})}${isOn(light)?"Sluk lys":"Tænd lys"}</button>`:""}${missingMarkup(template,bindings)}</div>`;
    host.querySelector("[data-room-light]")?.addEventListener("click",(event)=>service(event.currentTarget.dataset.roomLight,event.currentTarget.dataset.on==="true"?"turn_off":"turn_on"));
  }
  function renderMediaTemplate(host, card, bindings, template) {
    const entityId = bindings.player || card.dataset.entity; const state = BeastHaSocket.getState(entityId); const a=state?.attributes||{}; const playing=state?.state==="playing";
    host.innerHTML = `<div class="beast-template-media-player"><div class="beast-template-media-art">${a.entity_picture?`<img data-ha-path="${escape(a.entity_picture)}" alt="">`:BeastCore.icon("music",{size:42})}</div><div class="beast-template-media-copy"><small>${escape(a.friendly_name||card.dataset.label||template.title)}</small><strong>${escape(a.media_title||"Ingen afspilning")}</strong><span>${escape(a.media_artist||a.media_album_name||"")}</span></div><div class="beast-template-media-controls"><button data-media-service="media_previous_track">${BeastCore.icon("skip-back",{size:19})}</button><button data-media-service="${playing?"media_pause":"media_play"}" class="is-primary">${BeastCore.icon(playing?"pause":"play",{size:23})}</button><button data-media-service="media_next_track">${BeastCore.icon("skip-forward",{size:19})}</button><button data-media-volume="-0.05">−</button><b>${Math.round((Number(a.volume_level)||0)*100)}%</b><button data-media-volume="0.05">+</button></div>${missingMarkup(template,bindings)}</div>`;
    const img=host.querySelector("img[data-ha-path]");if(img)BeastAuth.setAuthedImageSrc(img,img.dataset.haPath);
    host.querySelectorAll("[data-media-service]").forEach((button)=>button.addEventListener("click",()=>service(entityId,button.dataset.mediaService)));
    host.querySelectorAll("[data-media-volume]").forEach((button)=>button.addEventListener("click",()=>service(entityId,"volume_set",{volume_level:Math.max(0,Math.min(1,(Number(a.volume_level)||0)+Number(button.dataset.mediaVolume)))})));
  }
  function renderPoolTemplate(host, card, bindings, template) {
    const pump=bound(bindings,"pump"), automation=bound(bindings,"automation");
    host.innerHTML=`<div class="beast-template-pool"><header><span>${BeastCore.icon("droplet",{size:28})}</span><div><small>Pool</small><strong>${escape(card.dataset.label||template.title)}</strong></div><b>${escape(boundValue(bindings,"temperature"))}°</b></header><div class="beast-template-pool-actions">${[["pump",pump,"Pumpe"],["automation",automation,"Automatik"]].filter(([key])=>bindings[key]).map(([key,item,label])=>`<button data-pool-entity="${escape(bindings[key])}" data-on="${isOn(item)}" class="${isOn(item)?"is-on":""}"><small>${label}</small><strong>${isOn(item)?"Aktiv":"Fra"}</strong></button>`).join("")}</div><footer>Køretid <b>${escape(boundValue(bindings,"runtime"))}</b></footer>${missingMarkup(template,bindings)}</div>`;
    host.querySelectorAll("[data-pool-entity]").forEach((button)=>button.addEventListener("click",()=>service(button.dataset.poolEntity,button.dataset.on==="true"?"turn_off":"turn_on")));
  }
  function renderCarTemplate(host, card, bindings, template) {
    const battery=Number(bound(bindings,"battery")?.state), lock=bound(bindings,"lock"), charging=isOn(bound(bindings,"charging"));
    host.innerHTML=`<div class="beast-template-car"><header><span>${BeastCore.icon("car",{size:28})}</span><div><small>Bil</small><strong>${escape(card.dataset.label||template.title)}</strong></div><b>${Number.isFinite(battery)?battery.toFixed(0):"–"}%</b></header><div class="beast-template-car-battery"><i style="width:${Number.isFinite(battery)?clampNumber(battery,0,100):0}%"></i></div><div class="beast-template-car-meta"><span>Rækkevidde <b>${escape(boundValue(bindings,"range"))}</b></span><span>${charging?"Oplader":"Ikke opladning"}</span>${bindings.lock?`<button data-car-lock="${escape(bindings.lock)}" data-locked="${lock?.state==='locked'}">${lock?.state==='locked'?"Låst":"Lås bilen"}</button>`:""}</div>${missingMarkup(template,bindings)}</div>`;
    host.querySelector("[data-car-lock]")?.addEventListener("click",(event)=>service(event.currentTarget.dataset.carLock,event.currentTarget.dataset.locked==="true"?"unlock":"lock"));
  }
  function clampNumber(value,min,max){return Math.max(min,Math.min(max,value));}
  function renderTpmsTemplate(host,card,bindings,template){
    host.innerHTML=`<div class="beast-template-tpms"><header><span>${BeastCore.icon("car",{size:25})}</span><div><small>Bil</small><strong>${escape(card.dataset.label||template.title)}</strong></div></header><div>${[["frontLeft","Foran V"],["frontRight","Foran H"],["rearLeft","Bag V"],["rearRight","Bag H"]].map(([key,label])=>`<span><i></i><small>${label}</small><strong>${escape(boundValue(bindings,key))}</strong></span>`).join("")}</div>${missingMarkup(template,bindings)}</div>`;
  }
  function renderRobotTemplate(host,card,bindings,template){
    const entityId=bindings.robot||card.dataset.entity,state=BeastHaSocket.getState(entityId),battery=bound(bindings,"battery"); const domain=entityId?.split('.')[0];
    host.innerHTML=`<div class="beast-template-robot"><header><span>${BeastCore.icon("grid",{size:27})}</span><div><small>Robot</small><strong>${escape(card.dataset.label||state?.attributes?.friendly_name||template.title)}</strong></div><b>${escape(battery?.state||state?.attributes?.battery_level||"–")}%</b></header><div class="beast-template-robot-status">${escape(state?.state||"Ikke tilgængelig")}</div><div class="beast-template-robot-actions"><button data-robot-service="start">Start</button><button data-robot-service="pause">Pause</button><button data-robot-service="${domain==='vacuum'?"return_to_base":"dock"}">Hjem</button></div>${missingMarkup(template,bindings)}</div>`;
    host.querySelectorAll("[data-robot-service]").forEach((button)=>button.addEventListener("click",()=>service(entityId,button.dataset.robotService)));
  }
  function renderPrinterTemplate(host,card,bindings,template){
    const progress=Number(bound(bindings,"progress")?.state);host.innerHTML=`<div class="beast-template-printer"><header><span>${BeastCore.icon("printer",{size:27})}</span><div><small>3D Printer</small><strong>${escape(card.dataset.label||template.title)}</strong></div><b>${Number.isFinite(progress)?progress.toFixed(0):"–"}%</b></header><div class="beast-template-printer-progress"><i style="width:${Number.isFinite(progress)?clampNumber(progress,0,100):0}%"></i></div><div class="beast-template-printer-metrics"><span>Status <b>${escape(boundValue(bindings,"status"))}</b></span><span>Resterende <b>${escape(boundValue(bindings,"remaining"))}</b></span><span>Dyse <b>${escape(boundValue(bindings,"nozzle"))}</b></span><span>Plade <b>${escape(boundValue(bindings,"bed"))}</b></span></div><div class="beast-template-printer-actions">${[["pause","Pause"],["resume","Fortsæt"],["stop","Stop"]].filter(([key])=>bindings[key]).map(([key,label])=>`<button data-printer-button="${escape(bindings[key])}">${label}</button>`).join("")}</div>${missingMarkup(template,bindings)}</div>`;host.querySelectorAll("[data-printer-button]").forEach((button)=>button.addEventListener("click",()=>service(button.dataset.printerButton,"press")));
  }
  function renderWeatherTemplate(host,card,bindings,template){const weather=bound(bindings,"weather")||BeastHaSocket.getState(card.dataset.entity),a=weather?.attributes||{};const temp=bound(bindings,"temperature")?.state??a.temperature??"–",humidity=bound(bindings,"humidity")?.state??a.humidity??"–";host.innerHTML=`<div class="beast-template-weather"><header><span>${BeastCore.icon(String(weather?.state||"").includes("rain")?"cloud-rain":"cloud",{size:42})}</span><div><small>Vejr</small><strong>${escape(card.dataset.label||template.title)}</strong><em>${escape(weather?.state||"Ikke tilgængelig")}</em></div><b>${escape(temp)}°</b></header><div><span>Fugt <b>${escape(humidity)}%</b></span><span>Vind <b>${escape(a.wind_speed??"–")} ${escape(a.wind_speed_unit||"")}</b></span><span>Tryk <b>${escape(a.pressure??"–")} ${escape(a.pressure_unit||"")}</b></span></div>${missingMarkup(template,bindings)}</div>`;}

  // Every BeastCardEditor renderCardMarkup() must produce a single root
  // element carrying data-builder-card="id" plus the sizing custom
  // properties -- same contract the front page's overviewCardMarkup()
  // already follows.
  function renderMarkup(card) {
    // --desktop-w/-h are emitted pre-multiplied by BEAST_GRID_UNIT_MULTIPLIER
    // (ha-smartdash-core.js) to match the freeform grid's desktop
    // resolution -- see ha-smartdash-layout.css.
    const size = ` data-builder-card="${escape(card.id)}" style="--desktop-w:${(Number(card.desktop?.w) || 3) * BEAST_GRID_UNIT_MULTIPLIER};--desktop-h:${(Number(card.desktop?.h) || 1) * BEAST_GRID_UNIT_MULTIPLIER};--tablet-w:${Number(card.tablet?.w) || 1};--tablet-h:${Number(card.tablet?.h) || 1};--portrait-h:${Number(card.portrait?.h) || 1};"`;
    const meta = ` data-template-id="${escape(card.templateId || "")}" data-bindings="${encodeURIComponent(JSON.stringify(card.bindings || {}))}" data-action="${encodeURIComponent(JSON.stringify(card.action || {}))}" data-visibility="${encodeURIComponent(JSON.stringify(card.visibility || {}))}" data-label="${escape(card.label || "")}" data-icon="${escape(card.icon || "grid")}"`;
    if (card.type === "stat") {
      return `<div class="beast-panel beast-panel-fill beast-ov-card beast-ov-card--stat"${size}${meta} data-standard-card="stat" data-entity="${escape(card.entity)}"><div class="beastStandardCardBody"></div></div>`;
    }
    if (card.type === "toggle") {
      return `<section class="beast-panel beast-ov-card beast-ov-card--generic beast-standard-toggle-card"${size}${meta} data-standard-card="toggle" data-entity="${escape(card.entity)}"><div class="beastStandardCardBody"></div></section>`;
    }
    if (["graph", "camera", "media", "calendar"].includes(card.type)) return `<section class="beast-panel beast-ov-card beast-standard-${escape(card.type)}-card"${size}${meta} data-standard-card="${escape(card.type)}" data-entity="${escape(card.entity)}"><div class="beastStandardCardBody"></div></section>`;
    return `<section class="beast-panel beast-ov-card beast-ov-card--generic"${size}${meta} data-standard-card="custom" data-entity="${escape(card.entity)}"><div class="beastOvGeneric"></div></section>`;
  }

  // Populates live entity values into every standard-card shell inside
  // zoneEl -- call after every DOM rebuild (from the page's
  // onAfterRender), mirroring how the front page repaints its own
  // generic widgets on every render.
  function wire(zoneEl) {
    if (!zoneEl) return;
    zoneEl.querySelectorAll('[data-standard-card="stat"] .beastStandardCardBody, [data-standard-card="toggle"] .beastStandardCardBody, [data-standard-card="graph"] .beastStandardCardBody, [data-standard-card="camera"] .beastStandardCardBody, [data-standard-card="media"] .beastStandardCardBody, [data-standard-card="calendar"] .beastStandardCardBody, [data-standard-card="custom"] .beastOvGeneric').forEach((host) => {
      const card = host.closest("[data-standard-card]");
      let bindings = {}; try { bindings = JSON.parse(decodeURIComponent(card.dataset.bindings || "%7B%7D")); } catch (_) { bindings = {}; }
      let action = {}; try { action = JSON.parse(decodeURIComponent(card.dataset.action || "%7B%7D")); } catch (_) { action = {}; }
      let visibility = {}; try { visibility = JSON.parse(decodeURIComponent(card.dataset.visibility || "%7B%7D")); } catch (_) { visibility = {}; }
      const template = window.BeastCardTemplates?.get?.(card.dataset.templateId);
      const entityId = card.dataset.entity;
      const state = entityId ? BeastHaSocket.getState(entityId) : null;
      const unavailable = !state || ["unknown", "unavailable"].includes(state.state);
      const label = card.dataset.label || state?.attributes?.friendly_name || entityId || "Ikke valgt";
      const value = formatState(state);
      const icon = card.dataset.icon || "grid";
      const visibilityState = visibility.entity ? BeastHaSocket.getState(visibility.entity) : null;
      const visibilityMatches = !visibility.entity || (!!visibilityState && (!visibility.state || visibilityState.state === visibility.state));
      card.classList.toggle("is-visibility-hidden", !visibilityMatches && !card.closest(".is-editing"));
      const boundFields = template?.fields?.filter((field) => bindings[field.key]) || [];
      if (template?.id === "energy-price-card") {
        renderPriceTemplate(host, card, bindings); card.classList.toggle("is-unavailable", !bindings.price); return;
      }
      if (template?.id === "energy-usage-card") {
        renderUsageTemplate(host, card, bindings); card.classList.toggle("is-unavailable", !bindings.power); return;
      }
      if (["climate-control","heatpump-card"].includes(template?.id)) { renderClimateTemplate(host,card,bindings,template); return; }
      if (["overview-security","security-command-card","security-systems-card","security-entries-card","security-entry-list"].includes(template?.id)) { renderSecurityTemplate(host,card,bindings,template); return; }
      if (template?.id === "room-card") { renderRoomTemplate(host,card,bindings,template); return; }
      if (template?.id === "music-player-card") { renderMediaTemplate(host,card,bindings,template); return; }
      if (template?.id === "pool-status-card") { renderPoolTemplate(host,card,bindings,template); return; }
      if (["car-overview-card","car-range"].includes(template?.id)) { renderCarTemplate(host,card,bindings,template); return; }
      if (template?.id === "car-tpms") { renderTpmsTemplate(host,card,bindings,template); return; }
      if (template?.id === "robot-control-card") { renderRobotTemplate(host,card,bindings,template); return; }
      if (template?.id === "printer-control-card") { renderPrinterTemplate(host,card,bindings,template); return; }
      if (template?.id === "weather-current-card") { renderWeatherTemplate(host,card,bindings,template); return; }
      if (boundFields.length > 1) {
        host.innerHTML = `<div class="beast-template-composite"><header><span>${BeastCore.icon(icon, { size: 23 })}</span><div><small>${escape(template.category || "Skabelon")}</small><strong>${escape(card.dataset.label || template.title)}</strong></div></header><div class="beast-template-composite-grid">${boundFields.map((field) => { const boundId = bindings[field.key]; const boundState = BeastHaSocket.getState(boundId); const missing = !boundState || ["unknown","unavailable"].includes(boundState.state); const unit = boundState?.attributes?.unit_of_measurement || ""; return `<article class="${missing ? "is-unavailable" : ""}"><small>${escape(field.label)}</small><strong>${escape(missing ? "–" : formatState(boundState))}${unit ? ` <em>${escape(unit)}</em>` : ""}</strong><span>${escape(boundState?.attributes?.friendly_name || boundId)}</span></article>`; }).join("")}</div></div>`;
        card.classList.toggle("is-unavailable", boundFields.every((field) => { const item = BeastHaSocket.getState(bindings[field.key]); return !item || ["unknown","unavailable"].includes(item.state); }));
        return;
      }
      if (card.dataset.standardCard === "stat") {
        host.innerHTML = BeastCore.statTile({ icon, label, value, meta: unavailable ? "" : (state.attributes?.unit_of_measurement || "") });
      } else if (card.dataset.standardCard === "toggle") {
        const domain = entityId?.split(".")[0] || "switch";
        const active = state?.state === "on" || state?.state === "open" || state?.state === "unlocked";
        host.innerHTML = `<button type="button" class="beast-standard-toggle" data-entity="${escape(entityId || "")}" data-domain="${escape(domain)}" data-active="${active}"><span class="beast-standard-toggle-icon">${BeastCore.icon(active ? "check" : "bolt", { size: 23 })}</span><span><small>${escape(label)}</small><strong>${active ? "Tændt" : "Slukket"}</strong></span></button>`;
        host.querySelector("button")?.addEventListener("click", async (event) => {
          if (!entityId || unavailable) return;
          const automaticService = domain === "lock" ? (active ? "unlock" : "lock") : domain === "cover" ? (active ? "close_cover" : "open_cover") : (active ? "turn_off" : "turn_on");
          const service = action.service && action.service !== "auto" ? action.service : automaticService;
          if (action.confirm && !window.confirm(`Vil du udføre “${label}”?`)) return;
          const button = event.currentTarget; button.disabled = true; button.classList.add("is-busy");
          try {
            await BeastAuth.haFetch(`/api/services/${domain}/${service}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity_id: entityId }) });
          } catch (error) {
            BeastCore.log(`Kortstyring fejlede: ${error.message}`);
          } finally {
            button.disabled = false; button.classList.remove("is-busy");
          }
        });
      } else if (card.dataset.standardCard === "graph") {
        host.innerHTML = `<div class="beast-standard-graph"><small>${escape(label)}</small><strong>${escape(value)} ${escape(state?.attributes?.unit_of_measurement || "")}</strong><div class="beast-standard-graph-history"><em>Henter historik…</em></div></div>`;
        const historyHost = host.querySelector(".beast-standard-graph-history");
        if (entityId) historyPoints(entityId).then((points) => { if (!historyHost?.isConnected) return; historyHost.innerHTML = points.length > 1 ? BeastCore.sparkline(points, { color: "var(--accent)", height: 86, chartKey: `card.${card.id || entityId}` }) : "<em>Ingen historik endnu</em>"; });
      } else if (card.dataset.standardCard === "camera") {
        const cameraGroup = window.BeastCameras?.resolveGroup?.(entityId);
        const activeCamera = cameraGroup || (state ? { entityId, entityPicture: state.attributes?.entity_picture || "", label, variants: [] } : null);
        const path = activeCamera?.entityPicture || "";
        const cameraLabel = activeCamera?.label || label;
        const qualityOptions = activeCamera?.qualityOptions || [];
        host.innerHTML = `<div class="beast-standard-camera"><div class="beast-standard-camera-frame">${path ? `<img data-ha-path="${escape(path)}" alt="${escape(cameraLabel)}">` : BeastCore.icon("camera", { size: 34 })}${qualityOptions.length > 1 ? `<div class="beast-standard-camera-quality"><button type="button" data-standard-camera-menu aria-label="Vælg kvalitet" aria-expanded="false">⋮</button><div hidden>${qualityOptions.map((option) => `<button type="button" data-standard-camera-quality="${escape(option.quality)}" class="${option.quality === activeCamera.selectedQuality ? "is-active" : ""}"><span>${escape(option.label)}</span>${option.quality === activeCamera.selectedQuality ? BeastCore.icon("check", { size: 15 }) : ""}</button>`).join("")}</div></div>` : ""}</div><strong>${escape(cameraLabel)}</strong></div>`;
        const image = host.querySelector("img[data-ha-path]"); if (image) BeastAuth.setAuthedImageSrc(image, image.dataset.haPath);
        const menu = host.querySelector("[data-standard-camera-menu]");
        menu?.addEventListener("click", (event) => { event.stopPropagation(); const popover = menu.nextElementSibling; const open = menu.getAttribute("aria-expanded") === "true"; menu.setAttribute("aria-expanded", String(!open)); popover.hidden = open; });
        host.querySelector(".beast-standard-camera-quality > div")?.addEventListener("click", (event) => { const button = event.target.closest("[data-standard-camera-quality]"); if (!button || !cameraGroup) return; event.stopPropagation(); BeastCameras.setQuality(cameraGroup.slug, button.dataset.standardCameraQuality); window.setTimeout(() => wire(zoneEl), 40); });
      } else if (card.dataset.standardCard === "media") {
        host.innerHTML = `<div class="beast-standard-media"><span>${BeastCore.icon("music", { size: 30 })}</span><div><small>${escape(label)}</small><strong>${escape(state?.attributes?.media_title || value)}</strong><em>${escape(state?.attributes?.media_artist || "")}</em></div></div>`;
      } else if (card.dataset.standardCard === "calendar") {
        host.innerHTML = `<div class="beast-standard-calendar"><span>${BeastCore.icon("calendar", { size: 28 })}</span><div><small>${escape(label)}</small><strong>${escape(state?.attributes?.message || value)}</strong><em>${escape(state?.attributes?.start_time || "Ingen tidspunkt")}</em></div></div>`;
      } else {
        host.innerHTML = `<div class="beast-ov-generic-content"><span>${BeastCore.icon(icon, { size: 31 })}</span><small>${escape(label)}</small><strong>${escape(value)}</strong><em>${escape(entityId || "")}</em></div>`;
      }
      card.classList.toggle("is-unavailable", unavailable);
    });
  }

  return { types: TYPES, entityPickerTypes: ENTITY_PICKER_TYPES, isStandardType, renderMarkup, wire };
})();
