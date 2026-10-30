// Full-screen menu page of the bedroom section. It stands in for the rail a
// bedroom device never shows: the bedroom's own views, screen actions and the
// way into Administration. Page tiles only appear if the rail lists other
// pages, which a bedroom device never does. It is a layer over the bedroom page, which stays
// mounted underneath so closing is instant and camera streams keep running.
window.BeastBedroom.menu = (() => {
  const B = window.BeastBedroom;
  const { t, esc, icon, fmt, hm, capitalize, cfg, list, state, unavailable, numberState, displayName, locale } = B.util;

  const IDLE_CLOSE_MS = 60 * 1000;
  const DOUBLE_TAP_GUARD_MS = 250;
  const STATE_REFRESH_MS = 10 * 1000;
  const ENTRANCE_MS = 400;
  const MAX_TILES = 12;
  const PAGE_ICONS = {
    overview: "home", cameras: "camera", rooms: "rooms", security: "shield", music: "music", energy: "bolt", heating: "thermo",
    waste: "cal", weather: "weather", car: "car", pool: "pool", robots: "robot", printer: "printer"
  };

  let openedAt = 0;
  let idleTimerId = null;
  let refreshTimerId = null;
  let settleTimerId = null;
  let trigger = null;
  let unsubscribeStatus = null;
  let reloading = false;

  function host() { return B.layerKind?.() === "menu" ? B.root?.querySelector('[data-bd-layer] .bd-menu') : null; }
  function isOpen() { return Boolean(host()); }

  // ---------------------------------------------------------------------------
  // Pages: exactly what this device's rail shows, in rail order
  // ---------------------------------------------------------------------------
  // A bedroom device shows nothing but this page, so it has no other pages.
  function pages() {
    if (BeastLocalSettings.isBedroomDevice()) return [];
    return [...document.querySelectorAll("#beastRail .beast-rail-btn[data-section]")]
      .map((button) => ({ id: button.dataset.section, label: (button.querySelector("span")?.textContent || button.textContent || "").trim() }))
      .filter((page) => page.id && page.id !== "bedroom" && page.id !== "settings");
  }

  function panel(name) { return BeastConfig.get(`panels.${name}`) || {}; }
  function num(id) { return id ? numberState(id) : null; }
  function off() { return { html: esc(t("Ingen data lige nu")), tone: "off" }; }
  function plain(text) { return { html: esc(text), tone: "" }; }
  function live(verb, rest) { return { html: `<b>${esc(verb)}</b>${rest ? ` · ${esc(rest)}` : ""}`, tone: "live" }; }

  function lockIsOpen(id) {
    const value = state(id)?.state;
    return Boolean(value) && !["locked", "locking", "unknown", "unavailable"].includes(value);
  }

  // One short line per page; the colour rules come from the menu design
  // (terracotta = attention, gold verb = something running).
  const SUMMARIES = {
    overview() {
      let home = 0;
      let persons = 0;
      let lights = 0;
      BeastHaSocket.getAllStates().forEach((st, id) => {
        if (id.startsWith("person.")) { persons += 1; if (st.state === "home") home += 1; }
        else if (id.startsWith("light.") && st.state === "on" && !Array.isArray(st.attributes?.entity_id)) lights += 1;
      });
      const lightText = lights === 1 ? t("1 lys tændt") : t("{n} lys tændt", { n: lights });
      return plain(persons ? `${t("{n} hjemme", { n: home })} · ${lightText}` : lightText);
    },
    cameras() {
      const cameras = window.BeastCameras?.getAllCameras?.() || [];
      if (!cameras.length) return off();
      const moving = cameras.filter((camera) => camera.motion && Date.now() - (camera.motionChangedAt || 0) < 2 * 60 * 1000)
        .sort((a, b) => (b.motionChangedAt || 0) - (a.motionChangedAt || 0))[0];
      if (moving) return live(t("Bevægelse"), moving.label);
      return plain(t("{n} kameraer · roligt", { n: cameras.length }));
    },
    rooms() {
      const areaIds = (Array.isArray(panel("rooms").areaIds) ? panel("rooms").areaIds : []).filter((id) => typeof id === "string");
      if (!areaIds.length) return off();
      if (typeof BeastRegistry !== "undefined" && BeastRegistry.isLoaded()) {
        const lit = areaIds.filter((areaId) => (BeastRegistry.getAreaEntityIds(areaId) || []).some((id) => id.startsWith("light.") && state(id)?.state === "on")).length;
        return plain(t("{n} rum · {k} med lys", { n: areaIds.length, k: lit }));
      }
      return plain(t("{n} rum", { n: areaIds.length }));
    },
    security() {
      const config = panel("security");
      const locks = list(config.locks);
      const unlocked = locks.filter(lockIsOpen).length;
      if (unlocked) return { html: esc(unlocked === 1 ? t("1 dør ulåst") : t("{n} døre ulåst", { n: unlocked })), tone: "attn" };
      const open = list(config.openingSensors).filter((id) => state(id)?.state === "on").length;
      if (open) return { html: esc(open === 1 ? t("1 dør åben") : t("{n} åbne døre", { n: open })), tone: "attn" };
      const alarm = state(list([config.primaryAlarm])[0] || list(config.alarmPanels)[0]);
      if (alarm?.state?.startsWith("armed_")) {
        const mode = { armed_home: "Hjemme", armed_away: "Ude", armed_night: "Nat", armed_vacation: "Ferie", armed_custom_bypass: "Tilpasset" }[alarm.state] || alarm.state;
        return live(t("Alarm"), t(mode));
      }
      if (alarm?.state === "triggered") return { html: esc(t("Alarmen er udløst")), tone: "attn" };
      if (locks.length) return plain(t("Alle døre låst"));
      return alarm ? plain(t("Alarm fra")) : off();
    },
    music() {
      const config = panel("music");
      const players = Array.isArray(config.visiblePlayers) && config.visiblePlayers.length
        ? list(config.visiblePlayers)
        : [...BeastHaSocket.getAllStates().keys()].filter((id) => id.startsWith("media_player."));
      const playing = players.map((id) => state(id)).find((st) => st?.state === "playing");
      if (playing) return live(t("Afspiller"), String(playing.attributes?.media_title || playing.attributes?.friendly_name || "").trim());
      return players.length ? plain(t("Intet afspilles")) : off();
    },
    energy() {
      const config = panel("energy");
      const price = num(config.priceSensor);
      let power = num(config.powerSensor);
      const unit = String(state(config.powerSensor)?.attributes?.unit_of_measurement || "W");
      if (power != null && unit === "W") power /= 1000;
      const parts = [];
      if (price != null) parts.push(`${fmt(price, 2)} kr/kWh`);
      if (power != null) parts.push(`${fmt(power, 1)} kW`);
      return parts.length ? plain(parts.join(" · ")) : off();
    },
    heating() {
      const rooms = list(panel("heating").rooms).map((id) => state(id)).filter((st) => st && !unavailable(st));
      if (!rooms.length) return off();
      const temps = rooms.map((st) => Number(st.attributes?.current_temperature)).filter(Number.isFinite);
      const heating = rooms.filter((st) => st.attributes?.hvac_action === "heating").length;
      const parts = [];
      if (temps.length) parts.push(`${fmt(temps.reduce((sum, value) => sum + value, 0) / temps.length, 1)} °C`);
      parts.push(heating === 1 ? t("1 rum varmer") : t("{n} rum varmer", { n: heating }));
      return plain(parts.join(" · "));
    },
    waste() {
      const ids = list(panel("waste").calendars);
      if (!ids.length) return off();
      const now = Date.now();
      const next = ids.map((id) => {
        const attributes = state(id)?.attributes || {};
        const at = Date.parse(String(attributes.start_time || "").replace(" ", "T"));
        return Number.isFinite(at) && attributes.message ? { at, end: Date.parse(String(attributes.end_time || "").replace(" ", "T")), title: String(attributes.message), allDay: attributes.all_day === true } : null;
      }).filter((event) => event && (Number.isFinite(event.end) ? event.end > now : event.at > now - 3600000)).sort((a, b) => a.at - b.at)[0];
      if (!next) return plain(t("Intet i kalenderen"));
      const date = new Date(next.at);
      const today = B.util.startOfDay();
      const day = B.util.dateKey(date);
      const started = next.at <= now;
      const label = started && !next.allDay ? t("Nu") : started || day === B.util.dateKey(today) ? t("I dag") : day === B.util.dateKey(B.util.addDays(today, 1)) ? t("I morgen") : capitalize(date.toLocaleDateString(locale(), { weekday: "long" }));
      return plain(`${label}${next.allDay || started ? "" : ` ${hm(date)}`} · ${next.title}`);
    },
    weather() {
      if (typeof ambientWeather !== "function") return off();
      const weather = ambientWeather();
      if (weather.temperature === "–") return off();
      return plain(`${weather.temperature} · ${t(weather.label)}`);
    },
    car() {
      const config = panel("car");
      const battery = num(config.battery);
      const range = num(config.range);
      if (battery == null && range == null) return off();
      if (state(config.charging)?.state === "on") return live(t("Lader"), battery == null ? "" : `${fmt(battery, 0)} %`);
      return plain([battery == null ? "" : `${fmt(battery, 0)} %`, range == null ? "" : `${fmt(range, 0)} km`].filter(Boolean).join(" · "));
    },
    pool() {
      const config = panel("pool");
      const temp = num(config.waterTemp);
      const pump = state(config.pumpSwitch)?.state;
      if (temp == null && !pump) return off();
      const parts = [];
      if (temp != null) parts.push(`${fmt(temp, 1)} °C`);
      if (pump === "on") parts.push(t("pumpe kører"));
      else if (pump === "off") parts.push(t("pumpe slukket"));
      return plain(parts.join(" · "));
    },
    robots() {
      const config = panel("robots");
      const robots = [...list(config.vacuums), ...list(config.mowers)].map((id) => ({ id, st: state(id) })).filter((item) => item.st && !unavailable(item.st));
      if (!robots.length) return off();
      const running = robots.find((item) => ["cleaning", "mowing", "returning"].includes(item.st.state));
      if (running) {
        const verb = running.st.state === "mowing" ? t("Klipper") : running.st.state === "returning" ? t("Kører hjem") : t("Støvsuger");
        return live(verb, displayName(running.id));
      }
      return plain(robots.every((item) => ["docked", "idle"].includes(item.st.state)) ? t("Alle i dock") : t("{n} robotter", { n: robots.length }));
    },
    printer() {
      const config = panel("printer");
      const status = String(state(config.statusSensor)?.state || "");
      if (!status || unavailable(state(config.statusSensor))) return off();
      if (/print|running|busy/i.test(status) && !/finish|complete|idle/i.test(status)) {
        const progress = num(config.progressSensor);
        const remaining = num(config.remainingSensor);
        const rest = [progress == null ? "" : `${fmt(progress, 0)} %`, remaining == null ? "" : B.util.duration(remaining * (String(state(config.remainingSensor)?.attributes?.unit_of_measurement || "min") === "h" ? 60 : 1))].filter(Boolean).join(" · ");
        return live(t("Printer"), rest);
      }
      return plain(/fail|error/i.test(status) ? t("Kræver opmærksomhed") : t("Klar"));
    }
  };

  function summaryFor(page) {
    try {
      if (page.id.startsWith("custom_")) {
        const custom = (BeastConfig.get("pages.custom") || []).find((item) => item?.id === page.id);
        return plain(String(custom?.subtitle || custom?.description || "").trim() || t("Egen side"));
      }
      const summary = SUMMARIES[page.id];
      if (!summary) return plain("");
      if (BeastHaSocket.getAllStates().size === 0) return { html: "", tone: "loading" };
      return summary();
    } catch (_) {
      return off();
    }
  }

  // ---------------------------------------------------------------------------
  // Markup
  // ---------------------------------------------------------------------------
  function tileMarkup(page, { more = 0 } = {}) {
    if (more) {
      return `<a class="bd-tile" href="#" data-bd-menu="more" role="button"><span class="bd-tile-ring">${icon("page", 24)}</span><span class="bd-tile-text"><span class="bd-tile-lbl">${esc(t("Flere sider"))}</span><span class="bd-tile-st">${esc(t("{n} sider mere", { n: more }))}</span></span></a>`;
    }
    const summary = summaryFor(page);
    return `<a class="bd-tile${summary.tone ? ` is-${summary.tone}` : ""}" href="#${esc(page.id)}" data-bd-menu="page" data-section="${esc(page.id)}"><span class="bd-tile-ring">${icon(PAGE_ICONS[page.id] || "page", 24)}</span><span class="bd-tile-text"><span class="bd-tile-lbl">${esc(page.label)}</span><span class="bd-tile-st" data-tile-state="${esc(page.id)}">${summary.html}</span></span></a>`;
  }

  function rowMarkup({ action, iconName, title, sub, on = false, offline = false, trailing = "chev", attrs = "", tag = "button" }) {
    const end = trailing === "chev" ? icon("chev", 20, "bd-row-chev") : trailing === "switch" ? `<span class="bd-row-sw"></span>` : "";
    const open = tag === "a" ? `<a class="bd-row${on ? " is-on" : ""}${offline ? " is-off" : ""}" href="#" data-bd-menu="${action}"${attrs}>` : `<button type="button" class="bd-row${on ? " is-on" : ""}${offline ? " is-off" : ""}" data-bd-menu="${action}"${attrs}${offline ? " disabled" : ""}>`;
    return `${open}<span class="bd-row-badge">${icon(iconName, 20)}</span><span class="bd-row-text"><span class="bd-row-t1">${esc(title)}</span><span class="bd-row-t2" data-row-sub="${action}">${sub}</span></span>${end}${tag === "a" ? "</a>" : "</button>"}`;
  }

  function bedroomRows() {
    const rows = [];
    const sleep = B.sleep?.summary?.();
    if (sleep) rows.push({ action: "sleep", iconName: "bed", title: t("Søvn & CPAP"), sub: esc(sleep.text), offline: Boolean(sleep.off) });
    const lightIds = B.lightIds();
    if (lightIds.length > 1) rows.push({ action: "lights", iconName: "bulb", title: t("Alt lys"), ...lightsRow(lightIds) });
    const cameraIds = B.cameraIds();
    if (cameraIds.length) rows.push({ action: "cameras", iconName: "expand", title: t("Kameraer i fuld skærm"), sub: esc(cameraIds.map((id) => window.BeastCameras?.resolveCamera?.(id)?.label || displayName(id)).join(" · ")) });
    const sceneIds = B.sceneIds();
    if (sceneIds.length) rows.push({ action: "scenes", iconName: "scene", title: t("Scener"), ...scenesRow(sceneIds) });
    return rows;
  }

  function lightsRow(ids) {
    const on = ids.filter((id) => B.lightModel(id).on).length;
    const total = ids.length === 1 ? t("1 lampe") : t("{n} lamper", { n: ids.length });
    return { sub: on ? `<b>${esc(t("{n} tændt", { n: on }))}</b> · ${esc(total)}` : `${esc(t("Alle slukket"))} · ${esc(total)}`, on: on > 0 };
  }

  function scenesRow(ids) {
    const active = B.activeSceneId(ids);
    const total = ids.length === 1 ? t("1 scene") : t("{n} scener", { n: ids.length });
    return { sub: active ? `<b>${esc(displayName(active))}</b> · ${esc(total)}` : esc(total), on: Boolean(active) };
  }

  function dimRow() {
    const on = B.dimOn();
    return { action: "dim", iconName: "dim", title: t("Nattilstand"), sub: on ? `<b>${esc(t("Til"))}</b> · ${esc(t("ekstra dæmpet skærm"))}` : esc(t("Ekstra dæmpet skærm")), on, trailing: "switch", attrs: ` role="switch" aria-checked="${on}"` };
  }

  function connectionInfo() {
    const dot = document.getElementById("beastStatusDot")?.dataset.state || "connecting";
    if (dot === "connected") return { state: "connected", text: t("Forbundet til Home Assistant") };
    if (dot === "error") return { state: "error", text: t("Login udløbet") };
    return { state: "connecting", text: t("Forbinder …") };
  }

  function footerMarkup() {
    const tag = document.querySelector('meta[name="beast-release-tag"]')?.content || "";
    const conn = connectionInfo();
    const ipad = document.documentElement.classList.contains("beast-ipad") ? " · iPad" : "";
    return `<div class="bd-foot"><span class="bd-foot-ver">HA Smartdash${tag ? ` <b>${esc(tag)}</b>` : ""}${ipad}</span><span class="bd-conn" data-state="${conn.state}">${esc(conn.text)}</span></div>`;
  }

  function clockMarkup(now = new Date()) {
    const [hours, minutes] = hm(now).split(":");
    return `${hours}<i>:</i>${minutes}`;
  }

  function menuMarkup() {
    const now = new Date();
    const all = pages();
    const visible = all.length > MAX_TILES ? all.slice(0, MAX_TILES - 1) : all;
    const tiles = visible.map((page) => tileMarkup(page)).join("") + (all.length > MAX_TILES ? tileMarkup(null, { more: all.length - visible.length }) : "");
    const tileCount = Math.min(all.length, MAX_TILES);
    const bed = bedroomRows();
    // On a bedroom device the menu is the only way to Administration (behind
    // the PIN gate), so it stays even when the rail's admin button is hidden.
    const admin = BeastLocalSettings.isBedroomDevice() || BeastConfig.get("showAdminButton") !== false;
    const classes = ["bd-menu", bed.length ? "has-bed" : "", admin ? "has-settings" : "", tileCount ? "has-pages" : ""].filter(Boolean).join(" ");
    const screen = `<section class="bd-mpanel bd-mscreen" aria-label="${esc(t("Skærm"))}"><div class="bd-meyebrow">${esc(t("Skærm"))}</div>
        <button type="button" class="bd-saver" data-bd-menu="screensaver"><span class="bd-saver-pv"><b data-menu-preview>${esc(hm(now))}</b></span><span class="bd-saver-text"><span class="bd-saver-t1">${esc(t("Pauseskærm nu"))}</span><span class="bd-saver-t2">${esc(t("Dæmpet ur · tryk for at vække"))}</span></span></button>
        <div class="bd-rows">${rowMarkup(dimRow())}${rowMarkup({ action: "reload", iconName: "reload", title: t("Genindlæs"), sub: esc(t("Henter siden igen")), trailing: "" })}</div>
        ${admin ? "" : footerMarkup()}</section>`;
    const settings = admin ? `<section class="bd-mpanel bd-msettings" aria-label="${esc(t("Indstillinger"))}"><div class="bd-meyebrow">${esc(t("Indstillinger"))}</div>
        <div class="bd-rows">${rowMarkup({ action: "admin-bedroom", iconName: "sliders", title: t("Tilpas soveværelset"), sub: esc(t("Kameraer, kalendere og lys")), tag: "a" })}${rowMarkup({ action: "admin", iconName: "gear", title: t("Administration"), sub: esc(t("Sider, enheder og udseende")), tag: "a" })}</div>
        ${footerMarkup()}</section>` : "";
    return `<div class="${classes}" role="dialog" aria-modal="true" aria-label="${esc(t("Menu"))}">
      <header class="bd-menu-head"><div class="bd-menu-time" data-menu-clock>${clockMarkup(now)}</div><div class="bd-menu-date"><span class="bd-d1" data-menu-date>${esc(capitalize(now.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" })))}</span><span class="bd-d2">${esc(t("Menu"))} <span>· ${esc(B.util.roomTitle())}</span></span></div>
        <button type="button" class="bd-back" data-bd-menu="close" aria-label="${esc(t("Tilbage til soveværelset"))}"><span>${esc(t("Tilbage til soveværelset"))}</span><span class="bd-back-x">${icon("x", 20)}</span></button></header>
      ${tileCount ? `<section class="bd-mpanel bd-mpages" aria-label="${esc(t("Sider"))}"><div class="bd-meyebrow">${esc(t("Sider"))}</div><div class="bd-tiles" data-n="${tileCount}">${tiles}</div></section>` : ""}
      ${bed.length ? `<section class="bd-mpanel bd-mbed" aria-label="${esc(B.util.roomTitle())}"><div class="bd-meyebrow is-room">${esc(t("Soveværelset"))}</div><div class="bd-rows">${bed.map(rowMarkup).join("")}</div></section>` : ""}
      ${screen}${settings}
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // Live updates while open (state lines at most every 10 s, clock per minute)
  // ---------------------------------------------------------------------------
  function refresh() {
    const menu = host();
    if (!menu) return;
    pages().forEach((page) => {
      const line = menu.querySelector(`[data-tile-state="${CSS.escape(page.id)}"]`);
      if (!line) return;
      const summary = summaryFor(page);
      if (line.innerHTML !== summary.html) line.innerHTML = summary.html;
      const tile = line.closest(".bd-tile");
      ["attn", "live", "off", "loading"].forEach((tone) => tile.classList.toggle(`is-${tone}`, summary.tone === tone));
    });
    bedroomRows().forEach((row) => updateRow(menu, row));
    updateRow(menu, dimRow());
    const conn = connectionInfo();
    const connEl = menu.querySelector(".bd-conn");
    if (connEl && connEl.dataset.state !== conn.state) { connEl.dataset.state = conn.state; connEl.textContent = conn.text; }
    tickClock();
  }

  function updateRow(menu, row) {
    const sub = menu.querySelector(`[data-row-sub="${row.action}"]`);
    if (!sub) return;
    if (sub.innerHTML !== row.sub) sub.innerHTML = row.sub;
    const element = sub.closest(".bd-row");
    element.classList.toggle("is-on", Boolean(row.on));
    element.classList.toggle("is-off", Boolean(row.offline));
    if (row.attrs?.includes("aria-checked")) element.setAttribute("aria-checked", String(Boolean(row.on)));
  }

  function tickClock() {
    const menu = host();
    if (!menu) return;
    const now = new Date();
    const clock = menu.querySelector("[data-menu-clock]");
    const markup = clockMarkup(now);
    if (clock && clock.innerHTML !== markup) clock.innerHTML = markup;
    const preview = menu.querySelector("[data-menu-preview]");
    if (preview && preview.textContent !== hm(now)) preview.textContent = hm(now);
    const date = menu.querySelector("[data-menu-date]");
    const dateText = capitalize(now.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" }));
    if (date && date.textContent !== dateText) date.textContent = dateText;
  }

  // ---------------------------------------------------------------------------
  // Open / close
  // ---------------------------------------------------------------------------
  function resetIdle() {
    window.clearTimeout(idleTimerId);
    idleTimerId = window.setTimeout(() => close(), IDLE_CLOSE_MS);
  }

  function cleanup() {
    window.clearTimeout(idleTimerId);
    window.clearInterval(refreshTimerId);
    window.clearTimeout(settleTimerId);
    idleTimerId = refreshTimerId = settleTimerId = null;
    unsubscribeStatus?.();
    unsubscribeStatus = null;
    document.removeEventListener("pointerdown", resetIdle, true);
    document.documentElement.classList.remove("beast-bedroom-menu-open");
  }

  function open(fromButton) {
    if (!B.root) return;
    trigger = fromButton || B.root.querySelector(".bd-menu-btn");
    const layerHost = B.openLayer("menu", menuMarkup(), cleanup);
    if (!layerHost) return;
    openedAt = Date.now();
    const menu = layerHost.querySelector(".bd-menu");
    menu.addEventListener("click", onClick);
    menu.classList.add("is-entering");
    // The page underneath stops painting once the menu fully covers it.
    settleTimerId = window.setTimeout(() => {
      menu.classList.remove("is-entering");
      if (isOpen()) document.documentElement.classList.add("beast-bedroom-menu-open");
    }, ENTRANCE_MS);
    menu.querySelector(".bd-back")?.focus({ preventScroll: true });
    refreshTimerId = window.setInterval(refresh, STATE_REFRESH_MS);
    unsubscribeStatus = BeastHaSocket.onStatusChange(() => window.setTimeout(refresh, 0));
    document.addEventListener("pointerdown", resetIdle, true);
    resetIdle();
  }

  // instant: no fade (used when navigating away or opening another view).
  function close(instant = false) {
    if (!isOpen()) return;
    document.documentElement.classList.remove("beast-bedroom-menu-open");
    B.closeLayer(instant);
    if (!instant) trigger?.focus?.({ preventScroll: true });
  }

  function goToPage(section) {
    close(true);
    document.querySelector(`.beast-rail-btn[data-section="${CSS.escape(section)}"]`)?.click();
  }

  function openAdmin(path) {
    const go = () => {
      window.BeastScreenLock?.grantAdminVerification?.();
      window.location.href = smartdashLocalUrl(path);
    };
    const lock = window.BeastScreenLock;
    if (!lock?.hasPin()) { go(); return; }
    if (lock.isLocked()) return;
    lock.requestPinVerification((ok) => { if (ok) go(); });
  }

  function reload(row) {
    if (reloading) return;
    reloading = true;
    row.classList.add("is-busy");
    row.disabled = true;
    const sub = row.querySelector(".bd-row-t2");
    if (sub) sub.textContent = t("Genindlæser …");
    try { sessionStorage.setItem("beast_active_section_v1", "bedroom"); } catch (_) {}
    window.setTimeout(() => {
      const next = new URL(window.location.href);
      next.searchParams.set("dashboardReload", String(Date.now()));
      window.location.replace(next.href);
    }, 180);
  }

  function openMorePages() {
    const rest = pages().slice(MAX_TILES - 1);
    const body = `<div class="bd-rows is-sheet">${rest.map((page) => {
      const summary = summaryFor(page);
      return `<button type="button" class="bd-row" data-bd-menu-page="${esc(page.id)}"><span class="bd-row-badge">${icon(PAGE_ICONS[page.id] || "page", 20)}</span><span class="bd-row-text"><span class="bd-row-t1">${esc(page.label)}</span><span class="bd-row-t2">${summary.html}</span></span>${icon("chev", 20, "bd-row-chev")}</button>`;
    }).join("")}</div>`;
    close(true);
    const layerHost = B.openLayer("pages", B.sheetMarkup("pages", t("Flere sider"), body));
    layerHost?.querySelector(".bd-sheet")?.addEventListener("click", (event) => {
      const row = event.target.closest("[data-bd-menu-page]");
      if (!row) return;
      B.closeLayer(true);
      document.querySelector(`.beast-rail-btn[data-section="${CSS.escape(row.dataset.bdMenuPage)}"]`)?.click();
    });
  }

  function onClick(event) {
    const target = event.target.closest("[data-bd-menu]");
    if (!target || target.disabled) return;
    event.preventDefault();
    const action = target.dataset.bdMenu;
    if (action === "close") {
      if (Date.now() - openedAt < DOUBLE_TAP_GUARD_MS) return;
      close();
      return;
    }
    switch (action) {
      case "page": goToPage(target.dataset.section); break;
      case "more": openMorePages(); break;
      case "sleep": close(true); B.sleep?.openDetail(); break;
      case "lights": close(true); B.openLightsSheet(); break;
      case "scenes": close(true); B.openScenesSheet(); break;
      case "cameras": close(true); B.openCameraView(0); break;
      case "screensaver": close(true); window.showAmbientMode?.(true); break;
      case "dim": B.setDim(!B.dimOn()); refresh(); break;
      case "reload": reload(target); break;
      case "admin-bedroom": openAdmin("admin/#bedroom"); break;
      case "admin": openAdmin("admin/"); break;
      default: break;
    }
  }

  return { open, close, refresh, tickClock, isOpen };
})();
