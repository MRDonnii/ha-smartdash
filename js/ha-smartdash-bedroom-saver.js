// Screensaver content on bedroom devices: the screensaver is the bedside
// screen's Nat view, and what it shows under the clock follows the bedroom's
// time-of-day mode (BeastBedroomModes, incl. Godnat -> Nat):
//   Nat    calm pills (locks/alarm, first event of the day, room climate),
//          an amber card with a Lås button for unlocked doors, a Sluk/Pause
//          line for a player that is on
//   Morgen last night's CPAP, the next event, the weather, the locks
//   Dag    the weather and the next event
//   Aften  locks/alarm (amber card when a door is unlocked), what is
//          playing, the first event tomorrow
// Buttons here act without waking the screen (see onSaverPointerDown in
// ha-smartdash-bedroom-alerts.js); any other tap wakes to the bedroom page.
// A mode's card switches (Tilstande) apply here too. Only opacity changes
// are animated, and nothing renders while the camera pop-up is up.
window.BeastBedroomSaver = (() => {
  const B = window.BeastBedroom;
  const { t, esc, icon, fmt, pad2, cfg, list, single, state, numberState, displayName, locale } = B.util;
  // A tap that lands as the screensaver appears must not press the button
  // that appears under the finger.
  const BUTTON_GUARD_MS = 400;
  const RENDER_DELAY_MS = 250;

  let host = null;
  let shownAt = 0;
  let signature = "";
  let unsubscribers = [];
  let renderTimerId = null;
  let minuteTimerId = null;
  let classObserver = null;

  function enabledHere() { return BeastLocalSettings.isBedroomDevice(); }
  function overlayEl() {
    const overlay = document.getElementById("beastAmbientMode");
    return overlay && overlay.classList.contains("is-visible") ? overlay : null;
  }
  function api() { return B.saver; }

  // ---------------------------------------------------------------------------
  // Content
  // ---------------------------------------------------------------------------
  function pill({ iconName = "", html, tone = "" }) {
    return `<span class="bdv-pill${tone ? ` is-${tone}` : ""}">${iconName ? icon(iconName, 16) : ""}<span class="bdv-pill-tx">${html}</span></span>`;
  }

  function weatherPill() {
    const weather = typeof window.ambientWeather === "function" ? window.ambientWeather() : null;
    if (!weather || weather.temperature === "–") return "";
    return pill({ iconName: "weather", html: `<b>${esc(weather.temperature)}</b> ${esc(t(weather.label))}` });
  }

  function eventPill(event) {
    if (!event) return "";
    return pill({ iconName: "cal", html: `<em>${esc(event.day)} ·</em> <b>${esc(event.time)}</b> <span class="bdv-ev">${esc(event.title)}</span>` });
  }

  function climatePill() {
    const c = cfg();
    const temp = numberState(single(c.temperature));
    const humidity = numberState(single(c.humidity));
    const text = [temp == null ? "" : `${fmt(temp, 1)}°`, humidity == null ? "" : `${fmt(humidity, 0)} %`].filter(Boolean).join(" · ");
    return text ? pill({ iconName: "thermo", html: esc(text), tone: "quiet" }) : "";
  }

  function windowPill() {
    return state(single(cfg().window))?.state === "on" ? pill({ iconName: "unlock", tone: "warn", html: `<b>${esc(t("Vindue åbent"))}</b>` }) : "";
  }

  // "83 myAir · 5:19 t · Godt arbejde", only for last night's fresh data.
  function cpapPill() {
    const sleep = B.sleep;
    if (!sleep?.configured?.() || !api().sleepFresh() || !sleep.model) return "";
    const m = sleep.model();
    if (m.allDown || m.stale) return "";
    const parts = [];
    if (m.values.score != null) parts.push(`<b>${esc(fmt(m.values.score, 0))}</b> myAir`);
    if (m.values.usage != null) {
      const minutes = Math.max(0, Math.round(m.values.usage));
      parts.push(`${Math.floor(minutes / 60)}:${pad2(minutes % 60)} ${esc(t("t"))}`);
    }
    if (m.title) parts.push(`<span class="bdv-verdict">${esc(m.title)}</span>`);
    return parts.length ? pill({ iconName: "moon", html: parts.join(" · "), tone: "sleep" }) : "";
  }

  function securityModel() {
    const S = api();
    const locks = list(cfg().locks);
    const alarm = S.alarmModel();
    return { locks, alarm: alarm && !alarm.unavailable ? alarm : null, open: S.unlockedDoors() };
  }

  function alarmState(alarm) { return api().alarmLabel(alarm).toLocaleLowerCase(locale()); }

  // Everything locked: "Alt er låst · alarm nat". At night a disarmed alarm
  // gets an amber pill of its own instead of the suffix.
  function lockedPills(sec, mode) {
    const pills = [];
    if (!sec.locks.length && !sec.alarm) return pills;
    const disarmedAtNight = mode === "nat" && sec.alarm?.status === "disarmed";
    const suffix = sec.alarm && !disarmedAtNight ? `<em> · ${esc(t("alarm {state}", { state: alarmState(sec.alarm) }))}</em>` : "";
    if (sec.locks.length) pills.push(pill({ iconName: "check", html: `<b>${esc(t("Alt er låst"))}</b>${suffix}` }));
    else if (!disarmedAtNight) pills.push(pill({ iconName: "shield", html: `<b>${esc(t("Alarm"))}</b>${suffix}` }));
    if (disarmedAtNight) pills.push(pill({ iconName: "shield", tone: "warn", html: `<b>${esc(t("Alarm frakoblet"))}</b>` }));
    return pills;
  }

  // Morgen: unlocked doors are no alarm, just the state.
  function openDoorsPill(open) {
    const text = open.length === 1 ? t("{name} er ulåst", { name: displayName(open[0]) }) : t("{n} døre ulåst", { n: open.length });
    return pill({ iconName: "unlock", html: `<b>${esc(text)}</b>` });
  }

  function doorsCard(sec) {
    const { open, alarm } = sec;
    const S = api();
    const busy = open.some((id) => S.lockPending(id));
    const title = open.length === 1 ? t("{name} er ulåst", { name: displayName(open[0]) }) : t("{n} døre er ulåst", { n: open.length });
    const subs = [];
    if (open.length === 1) {
      const at = Date.parse(state(open[0])?.last_changed || "");
      if (Number.isFinite(at)) { const date = new Date(at); subs.push(t("Låst op {time}", { time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}` })); }
    } else subs.push(open.map(displayName).join(", "));
    if (alarm) subs.push(alarm.status.startsWith("armed_") ? t("alarm {state} er aktiv", { state: alarmState(alarm) }) : t("alarm frakoblet"));
    const label = busy ? t("Låser…") : open.length === 1 ? t("Lås {name}", { name: displayName(open[0]) }) : t("Lås {n} døre", { n: open.length });
    return `<div class="bdv-card"><span class="bdv-card-ic">${icon("unlock", 20)}</span><span class="bdv-card-tx"><b>${esc(title)}</b><small>${esc(subs.join(" · "))}</small></span><button type="button" class="bdv-card-btn${busy ? " is-busy" : ""}" data-bdv="lock"${busy ? " disabled" : ""}>${icon("lock", 17)}<span>${esc(label)}</span></button></div>`;
  }

  function mediaLines() {
    const S = api();
    return S.mediaIds().filter(S.mediaIsOn).map((id) => {
      const model = S.mediaModel(id);
      if (model.unavailable || !model.on) return "";
      const line = model.title && (model.playing || model.paused) ? model.title : model.verb || t("Tændt");
      const service = model.isTv || !(model.playing || model.paused) ? "turn_off" : "media_play_pause";
      const label = service === "turn_off" ? t("Sluk") : model.paused ? t("Afspil") : t("Pause");
      return `<div class="bdv-line"><span class="bdv-line-ic">${icon(model.isTv ? "tv" : "speaker", 18)}</span><span class="bdv-line-tx"><b>${esc(model.name)}</b><small>${esc(line)}</small></span><button type="button" class="bdv-line-btn" data-bdv="media" data-service="${service}" data-entity="${esc(id)}">${esc(label)}</button></div>`;
    }).join("");
  }

  function compose() {
    const info = B.modeInfo();
    const mode = info.mode;
    const S = api();
    const on = (card) => info.settings.cards[mode]?.[card] !== false;
    const sec = on("sec") ? securityModel() : null;
    const hasSec = Boolean(sec && (sec.locks.length || sec.alarm));
    const cal = on("cal") && S.hasCalendars();
    const pills = [];
    let card = "";
    let lines = "";
    if (mode === "morgen") {
      if (on("sleep")) pills.push(cpapPill());
      if (cal) pills.push(eventPill(S.upcomingEvent()));
      pills.push(weatherPill());
      if (hasSec) pills.push(...(sec.open.length ? [openDoorsPill(sec.open)] : lockedPills(sec, mode)));
    } else if (mode === "dag") {
      pills.push(weatherPill());
      if (cal) pills.push(eventPill(S.upcomingEvent()));
    } else {
      if (hasSec) {
        if (sec.open.length) card = doorsCard(sec);
        else pills.push(...lockedPills(sec, mode));
      }
      if (cal) pills.push(eventPill(S.comingDayEvent()));
      if (mode === "nat") pills.push(climatePill(), windowPill());
      if (on("media")) lines = mediaLines();
    }
    return { mode, pills: pills.filter(Boolean).join(""), card, lines };
  }

  // ---------------------------------------------------------------------------
  // Mounting and rendering
  // ---------------------------------------------------------------------------
  function render() {
    renderTimerId = null;
    const overlay = overlayEl();
    if (!host || !overlay || !host.isConnected) return;
    // The camera pop-up measured the clock where it stands; the content
    // under it waits until the pop-up has gone.
    if (overlay.classList.contains("has-bd-alert")) return;
    const content = compose();
    const next = JSON.stringify(content);
    if (next === signature) return;
    signature = next;
    host.dataset.mode = content.mode;
    host.innerHTML = `${content.pills ? `<div class="bdv-pills">${content.pills}</div>` : ""}${content.card}${content.lines ? `<div class="bdv-lines">${content.lines}</div>` : ""}`;
    overlay.classList.toggle("has-bdv-card", Boolean(content.card));
    overlay.classList.toggle("has-bdv-lines", Boolean(content.lines));
  }

  function requestRender(delay = RENDER_DELAY_MS) {
    if (!host) return;
    window.clearTimeout(renderTimerId);
    renderTimerId = window.setTimeout(render, delay);
  }

  function scheduleMinute() {
    window.clearTimeout(minuteTimerId);
    const now = new Date();
    minuteTimerId = window.setTimeout(() => { render(); scheduleMinute(); }, (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 200);
  }

  function onClick(event) {
    const button = event.target.closest("[data-bdv]");
    if (!button) return;
    event.stopPropagation();
    if (button.disabled || Date.now() - shownAt < BUTTON_GUARD_MS) return;
    const S = api();
    if (button.dataset.bdv === "lock") S.lockDoors(S.unlockedDoors());
    else if (button.dataset.bdv === "media") S.mediaAction(button.dataset.entity, button.dataset.service);
    signature = "";
    render();
  }

  function mount(overlay) {
    unmount();
    const anchor = overlay.querySelector(".beast-ambient-date");
    if (!anchor) return;
    host = document.createElement("div");
    host.className = "beast-bedroom-saverinfo";
    host.addEventListener("click", onClick);
    anchor.after(host);
    overlay.classList.add("has-bdv");
    shownAt = Date.now();
    signature = "";
    const S = api();
    const weatherId = BeastConfig.get("panels.weather.entity");
    const ids = new Set([...S.relevantIds(), ...(typeof weatherId === "string" && weatherId ? [weatherId] : [])]);
    unsubscribers = [...ids].map((id) => BeastHaSocket.subscribeEntity(id, () => requestRender()));
    classObserver = new MutationObserver(() => { if (!overlay.classList.contains("has-bd-alert")) requestRender(450); });
    classObserver.observe(overlay, { attributes: true, attributeFilter: ["class"] });
    render();
    S.ensureCalendar().then((loaded) => { if (loaded) { signature = ""; render(); } }).catch(() => {});
    scheduleMinute();
  }

  function unmount() {
    window.clearTimeout(renderTimerId);
    window.clearTimeout(minuteTimerId);
    renderTimerId = null;
    classObserver?.disconnect();
    classObserver = null;
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    unsubscribers = [];
    const overlay = document.getElementById("beastAmbientMode");
    overlay?.classList.remove("has-bdv", "has-bdv-card", "has-bdv-lines");
    host?.remove();
    host = null;
    signature = "";
  }

  // Registered before the camera alert module's listener (script order), so
  // the content stands before a returning pop-up measures the clock.
  document.addEventListener("beast:ambientchange", (event) => {
    if (!event.detail?.on) { unmount(); return; }
    const overlay = overlayEl();
    if (overlay && enabledHere() && B.saver) mount(overlay);
  });
  document.addEventListener("beast:config-changed", () => { signature = ""; requestRender(); });

  return { render: () => { signature = ""; render(); }, isShowing: () => Boolean(host) };
})();
