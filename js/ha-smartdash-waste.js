(function () {
  function wasteSensorIds() { return BeastConfig.get("panels.waste.sensors") || []; }
  function calendarEntityIds() { return BeastConfig.get("panels.waste.calendars") || []; }
  function scheduleCalendarIds() { return BeastConfig.get("panels.waste.scheduleCalendars") || []; }

  let containerEl = null;
  let calendarRequest = 0;
  let selectedCalendarDay = "all";
  // One card per configured schedule calendar (e.g. one per child) -- each
  // navigates its own day independently, so this is keyed by entity_id
  // rather than a single shared value.
  let scheduleDayOffsets = {};
  let scheduleRequestId = 0;

  // Slugifies an entity_id into something safe to use in a DOM id/selector
  // (data-calendar-section="schedule-..."). Not meant to be reversed --
  // the real entity_id is looked up separately wherever needed.
  function scheduleCardSlug(entityId) {
    return String(entityId).replace(/[^a-z0-9]/gi, "-");
  }

  // The calendar's own friendly_name already carries the child's name (per
  // the family's own naming convention, e.g. "Skoleskema Mads Thorn Halle")
  // -- stripping a leading "Skoleskema"/"Schedule" word gives a clean card
  // title without needing a separate label field in Admin.
  function scheduleCardLabel(entityId) {
    const name = BeastHaSocket.getState(entityId)?.attributes?.friendly_name || entityId.replace("calendar.", "");
    return name.replace(/^(skoleskema|schedule)\s+/i, "").trim() || name;
  }

  // AULA-style summaries are "<FAGKODE>, <Lærernavn>" (e.g. "MAT, Tine Bach
  // Christensen"), sometimes "KRI, VIKAR: Amar Jusic" for a substitute. Not
  // every calendar will follow this exact shape, so a summary without a
  // comma just becomes the subject with no teacher rather than failing.
  function parseScheduleSummary(summary) {
    const raw = String(summary || "").trim();
    const commaIndex = raw.indexOf(",");
    if (commaIndex === -1) return { subject: raw, teacher: "" };
    return { subject: raw.slice(0, commaIndex).trim(), teacher: raw.slice(commaIndex + 1).trim() };
  }

  // AULA's subject codes as seen on this family's own timetable, mapped to
  // their real Danish names (confirmed against AULA's own schedule view --
  // codes not in this list, e.g. an unlabelled block code, are shown as-is
  // rather than guessed).
  const SCHEDULE_SUBJECT_NAMES = {
    idr: "Idræt", mat: "Matematik", dan: "Dansk", mus: "Musik",
    kri: "Kristendomskundskab", "n/t": "Natur/teknologi"
  };
  function scheduleSubjectLabel(code) {
    const raw = String(code || "").trim();
    return SCHEDULE_SUBJECT_NAMES[raw.toLowerCase()] || raw;
  }

  // "2-lærer" (co-teacher) and "Klpæd" (class pedagogue) are AULA's way of
  // attaching a second staff member to a period -- they show up as their
  // OWN calendar event at the exact same start/end as the real lesson, not
  // as an attribute of it. They must never be picked as the row's subject
  // (only the real lesson code should be), but their teacher name still
  // belongs in the merged row's teacher list.
  const SCHEDULE_SUBJECT_PLACEHOLDERS = ["2-lærer", "klpæd"];
  function isPlaceholderSubject(code) {
    return SCHEDULE_SUBJECT_PLACEHOLDERS.includes(String(code || "").trim().toLowerCase());
  }

  // Multiple teachers/roles can cover the exact same period (co-teaching,
  // support staff) -- AULA represents that as separate events sharing one
  // start/end instead of one event with several teachers. Grouping by
  // start+end merges those back into the single row a person actually
  // wants to see, rather than duplicate-looking rows for the same lesson.
  function mergeScheduleEvents(events) {
    const groups = new Map();
    events.forEach((event) => {
      const start = event.start?.dateTime || event.start?.date || "";
      const end = event.end?.dateTime || event.end?.date || "";
      const key = `${start}|${end}`;
      if (!groups.has(key)) groups.set(key, { start, end, parts: [] });
      groups.get(key).parts.push({ ...parseScheduleSummary(event.summary), location: event.location || "" });
    });
    return Array.from(groups.values())
      .sort((a, b) => new Date(a.start) - new Date(b.start))
      .map((group) => {
        const primary = group.parts.find((part) => part.subject && !isPlaceholderSubject(part.subject)) || group.parts[0];
        return {
          start: group.start,
          end: group.end,
          location: primary?.location || group.parts.find((part) => part.location)?.location || "",
          subject: primary?.subject || "",
          teachers: group.parts.map((part) => part.teacher).filter(Boolean)
        };
      });
  }

  // Shared with the AULA lesson-soon banner (ha-smartdash-overview.js) so
  // subject-code translation and multi-teacher merging stay in one place.
  window.BeastScheduleSubjects = { label: scheduleSubjectLabel, mergeEvents: mergeScheduleEvents };

  function weatherEntityId() { return BeastConfig.get("panels.weather.entity"); }

  async function loadCalendarWeather() {
    const entityId = weatherEntityId();
    if (!entityId) return { daily:[], hourly:[] };
    const fetchType = (type) => BeastAuth.haFetch("/api/services/weather/get_forecasts?return_response", {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ entity_id:entityId, type })
    });
    const results = await Promise.allSettled([fetchType("daily"), fetchType("hourly")]);
    const extract = (result) => {
      if (result.status !== "fulfilled") return [];
      const response = result.value?.service_response || result.value;
      const entityResult = response?.[entityId] || response;
      return Array.isArray(entityResult?.forecast) ? entityResult.forecast : [];
    };
    const fallback = BeastHaSocket.getState(entityId)?.attributes?.forecast;
    return { daily:extract(results[0]).length ? extract(results[0]) : (Array.isArray(fallback) ? fallback : []), hourly:extract(results[1]) };
  }

  function forecastForDay(weather, date) {
    const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
    return weather.daily.find((item) => String(item.datetime || "").slice(0,10) === key) || null;
  }

  function forecastForEvent(weather, event) {
    const startValue = event.start?.dateTime || event.start?.date;
    if (!startValue) return null;
    const eventDate = new Date(startValue);
    if (event.start?.dateTime && weather.hourly.length) {
      const nearest = weather.hourly.reduce((best, item) => {
        const distance = Math.abs(new Date(item.datetime).getTime() - eventDate.getTime());
        return !best || distance < best.distance ? { item, distance } : best;
      }, null);
      if (nearest && nearest.distance <= 3 * 60 * 60 * 1000) return nearest.item;
    }
    return forecastForDay(weather, eventDate);
  }

  function weatherBadge(item, compact = false) {
    if (!item) return "";
    const temperature = Number(item.temperature);
    const meta = BeastCore.weatherMeta(item.condition);
    return `<span class="beast-calendar-weather${compact ? " is-compact" : ""}" title="${escapeHtml(meta.label)}">${BeastCore.animatedWeatherIcon(meta.mood, compact ? 25 : 29)}<strong>${Number.isFinite(temperature) ? `${Math.round(temperature)}°` : "–"}</strong></span>`;
  }

  function cardRows(cardId, fallback = 12) {
    const path = window.BeastNativePageEditor?.storagePath?.("waste") || "pageLayouts.waste.nativeCards";
    const cards = BeastConfig.get(path);
    const value = Array.isArray(cards) ? cards.find((card) => card.id === cardId)?.options?.rows : null;
    return Math.max(1, Math.min(30, Number(value) || fallback));
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function buildWasteMarkup() {
    const items = wasteSensorIds()
      .map((id) => BeastHaSocket.getState(id))
      .filter(Boolean)
      .map((s) => ({
        name: s.attributes.name || s.attributes.friendly_name,
        days: Number(s.state),
        dateLabel: s.attributes.date_short || ""
      }))
      .sort((a, b) => a.days - b.days);

    if (!items.length) return `<p class="beast-music-empty">Ingen affaldsdata.</p>`;

    const visibleItems = items.slice(0, cardRows("waste", 6));
    return visibleItems.map((item, index) => {
      const when = item.days === 0 ? "I dag" : item.days === 1 ? "I morgen" : `Om ${item.days} dage`;
      return `<article class="beast-calendar-waste-item${index === 0 ? " is-next" : ""}">
        <span class="beast-calendar-waste-icon">${BeastCore.icon("calendar", { size:index === 0 ? 26 : 21 })}</span>
        <div><small>${index === 0 ? "Næste afhentning" : escapeHtml(item.dateLabel || "Planlagt")}</small><strong>${escapeHtml(item.name || "Affald")}</strong>${index === 0 && item.dateLabel ? `<em>${escapeHtml(item.dateLabel)}</em>` : ""}</div>
        <b>${escapeHtml(when)}</b>
      </article>`;
    }).join("");
  }

  async function loadScheduleDay(entityId, dayOffset) {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + dayOffset);
    const start = new Date(day);
    const end = new Date(day);
    end.setDate(end.getDate() + 1);
    try {
      const events = await BeastAuth.haFetch(`/api/calendars/${entityId}?start=${start.toISOString()}&end=${end.toISOString()}`);
      return mergeScheduleEvents(events || []);
    } catch (error) {
      return [];
    }
  }

  function renderScheduleRows(rows, locale) {
    if (!rows.length) return `<div class="beast-calendar-empty">${BeastCore.icon("calendar", { size: 26 })}<strong>Ingen timer</strong></div>`;
    return rows.map((row) => {
      const time = row.start && row.start.length > 10
        ? new Date(row.start).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
        : "";
      const teacherText = row.teachers.map((teacher) => {
        const isSub = /^vikar/i.test(teacher);
        const clean = teacher.replace(/^vikar:?\s*/i, "");
        return isSub ? `<em class="is-substitute">VIKAR: ${escapeHtml(clean)}</em>` : escapeHtml(teacher);
      }).join(" + ");
      return `<article class="beast-schedule-row">
        <time>${escapeHtml(time)}</time>
        <div><strong>${escapeHtml(scheduleSubjectLabel(row.subject) || "Ukendt fag")}</strong>${teacherText ? `<span>${teacherText}</span>` : ""}</div>
        ${row.location ? `<b>${escapeHtml(row.location)}</b>` : ""}
      </article>`;
    }).join("");
  }

  function scheduleDayLabel(dayOffset, locale) {
    if (dayOffset === 0) return "I dag";
    if (dayOffset === 1) return "I morgen";
    if (dayOffset === -1) return "I går";
    const day = new Date();
    day.setDate(day.getDate() + dayOffset);
    return day.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "short" });
  }

  async function renderScheduleCard(entityId) {
    const slug = scheduleCardSlug(entityId);
    const host = document.getElementById(`beastSchedule-${slug}`);
    if (!host) return;
    const requestId = ++scheduleRequestId;
    const dayOffset = scheduleDayOffsets[entityId] || 0;
    const locale = window.HASmartdashI18n?.locale || "da-DK";
    host.innerHTML = `<p class="beast-music-empty">Henter…</p>`;
    const rows = await loadScheduleDay(entityId, dayOffset);
    if (requestId !== scheduleRequestId) return;
    host.innerHTML = `
      <div class="beast-schedule-nav">
        <button type="button" class="beast-schedule-nav-btn is-prev" data-schedule-prev="${escapeHtml(entityId)}" aria-label="Forrige dag">${BeastCore.icon("chevron-right", { size: 16 })}</button>
        <strong>${escapeHtml(scheduleDayLabel(dayOffset, locale))}</strong>
        <button type="button" class="beast-schedule-nav-btn" data-schedule-next="${escapeHtml(entityId)}" aria-label="Næste dag">${BeastCore.icon("chevron-right", { size: 16 })}</button>
      </div>
      <div class="beast-schedule-rows">${renderScheduleRows(rows, locale)}</div>
    `;
  }

  function formatEventTime(event) {
    const start = event.start?.dateTime || event.start?.date;
    if (!start) return "";
    const date = new Date(start);
    const isAllDay = !event.start?.dateTime;
    const locale = window.HASmartdashI18n?.locale || "da-DK";
    if (isAllDay) return date.toLocaleDateString(locale, { day: "numeric", month: "short" });
    return date.toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  async function loadCalendarEvents() {
    const requestId = ++calendarRequest;
    const start = new Date();
    const end = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const allStates = BeastHaSocket.getAllStates();
    const availableCalendars = calendarEntityIds().filter((id) => allStates.has(id));

    const results = await Promise.all(availableCalendars.map(async (id) => {
      try {
        const events = await BeastAuth.haFetch(`/api/calendars/${id}?start=${start.toISOString()}&end=${end.toISOString()}`);
        return (events || []).map((event) => ({ ...event, calendarId: id }));
      } catch (error) {
        return [];
      }
    }));

    if (requestId !== calendarRequest) return null;
    const now = Date.now();
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return results.flat()
      .filter((event) => {
        const startValue = event.start?.dateTime || event.start?.date;
        if (!startValue) return false;
        // A date-only event is relevant for its named local calendar day.
        // Timed events must still be upcoming (with a tiny clock-skew grace).
        if (!event.start?.dateTime) return String(startValue).slice(0, 10) >= todayKey;
        const startMs = new Date(startValue).getTime();
        return Number.isFinite(startMs) && startMs >= now - 5 * 60 * 1000;
      })
      .sort((a, b) => new Date(a.start?.dateTime || a.start?.date) - new Date(b.start?.dateTime || b.start?.date));
  }

  function renderCalendarEvents(events, weather = { daily:[], hourly:[] }) {
    const host = document.getElementById("beastCalendarEvents");
    if (!host || events === null) return;
    const locale = window.HASmartdashI18n?.locale || "da-DK";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const eventDayKey = (event) => String(event.start?.dateTime || event.start?.date || "").slice(0, 10);
    const days = Array.from({ length:7 }, (_, offset) => {
      const day = new Date(today); day.setDate(today.getDate() + offset);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2,"0")}-${String(day.getDate()).padStart(2,"0")}`;
      const count = events.filter((event) => eventDayKey(event) === key).length;
      return { day, key, count, offset };
    });
    if (selectedCalendarDay !== "all" && !days.some((item) => item.key === selectedCalendarDay)) selectedCalendarDay = "all";
    const dayStrip = `<button type="button" class="beast-calendar-day is-all${selectedCalendarDay === "all" ? " is-selected" : ""}" data-calendar-day="all" aria-pressed="${selectedCalendarDay === "all"}"><small>Vis</small><strong>Alle</strong><span>${events.length} aftaler</span></button>${days.map(({day,key,count,offset}) => `<button type="button" class="beast-calendar-day${offset === 0 ? " is-today" : ""}${count ? " has-events" : ""}${selectedCalendarDay === key ? " is-selected" : ""}" data-calendar-day="${key}" aria-pressed="${selectedCalendarDay === key}"><small>${day.toLocaleDateString(locale,{weekday:"short"}).replace(".","")}</small><strong>${day.getDate()}</strong>${weatherBadge(forecastForDay(weather, day), true)}<i>${count || ""}</i></button>`).join("")}`;
    const visibleEvents = (selectedCalendarDay === "all" ? events : events.filter((event) => eventDayKey(event) === selectedCalendarDay)).slice(0, cardRows("events", 12));
    const selectedDay = days.find((item) => item.key === selectedCalendarDay)?.day;
    const emptyDetail = selectedDay
      ? `Ingen aftaler ${selectedDay.toLocaleDateString(locale, { weekday:"long", day:"numeric", month:"long" })}.`
      : "Ingen kommende begivenheder de næste 14 dage.";
    const agenda = visibleEvents.map((event, index) => {
      const calendar = BeastHaSocket.getState(event.calendarId);
      const calendarName = calendar?.attributes?.friendly_name || event.calendarId?.replace("calendar.", "") || "Kalender";
      const start = event.start?.dateTime || event.start?.date;
      const date = new Date(start);
      const allDay = !event.start?.dateTime;
      const day = date.toLocaleDateString(locale, { weekday:"short", day:"numeric", month:"short" });
      const time = allDay ? "Hele dagen" : date.toLocaleTimeString(locale, { hour:"2-digit", minute:"2-digit" });
      const eventWeather = forecastForEvent(weather, event);
      return `<article class="beast-calendar-event${index === 0 ? " is-next" : ""}">
        <time><strong>${escapeHtml(day.replace(".",""))}</strong><span>${escapeHtml(time)}</span></time>
        <i aria-hidden="true"></i>
        <div><strong>${escapeHtml(event.summary || "Uden titel")}</strong><span>${escapeHtml(calendarName)}</span></div>
        ${weatherBadge(eventWeather)}
        ${index === 0 ? `<b>Næste</b>` : ""}
      </article>`;
    }).join("") || `<div class="beast-calendar-empty">${BeastCore.icon("calendar", { size:30 })}<strong>Kalenderen er fri</strong><span>${escapeHtml(emptyDetail)}</span></div>`;
    host.innerHTML = `<div class="beast-calendar-week">${dayStrip}</div><div class="beast-calendar-agenda">${agenda}</div>`;
    host.querySelector(".beast-calendar-week")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-calendar-day]");
      if (!button || button.dataset.calendarDay === selectedCalendarDay) return;
      selectedCalendarDay = button.dataset.calendarDay;
      renderCalendarEvents(events, weather);
    });
  }

  function render() {
    if (!containerEl) return;
    const scheduleIds = scheduleCalendarIds();
    const scheduleSections = scheduleIds.map((entityId) => {
      const slug = scheduleCardSlug(entityId);
      return `<section class="beast-waste-section" data-calendar-section="schedule-${slug}">
        <header class="beast-calendar-section-head"><span>${BeastCore.icon("calendar", { size:22 })}</span><div><small>Skoleskema</small><h2>${escapeHtml(scheduleCardLabel(entityId))}</h2></div></header>
        <div class="beast-schedule-body" id="beastSchedule-${slug}"><p class="beast-music-empty">Henter…</p></div>
      </section>`;
    }).join("");
    containerEl.innerHTML = `
      <button type="button" class="beast-page-edit-trigger" id="beastCalendarLayoutEdit" aria-label="Rediger kalenderlayout">⋮</button>
      ${scheduleSections}
      <section class="beast-waste-section" data-calendar-section="waste">
        <header class="beast-calendar-section-head"><span>${BeastCore.icon("calendar", { size:22 })}</span><div><small>Husets afhentninger</small><h2>Affald</h2></div></header>
        <div class="beast-calendar-waste-list" style="--calendar-item-rows:${Math.max(1, Math.min(cardRows("waste", 6), wasteSensorIds().length || 1))}">${buildWasteMarkup()}</div>
      </section>
      <section class="beast-waste-section" data-calendar-section="events">
        <header class="beast-calendar-section-head"><span>${BeastCore.icon("calendar", { size:22 })}</span><div><small>De næste 14 dage</small><h2>Kommende aftaler</h2></div><time>${new Date().toLocaleDateString(window.HASmartdashI18n?.locale || "da-DK", { weekday:"long", day:"numeric", month:"long" })}</time></header>
        <div class="beast-calendar-events" id="beastCalendarEvents"><p class="beast-music-empty">Henter…</p></div>
      </section>
    `;
    wireCalendarLayout();
    wireScheduleNav();

    scheduleIds.forEach((entityId) => renderScheduleCard(entityId));
    Promise.all([loadCalendarEvents(), loadCalendarWeather()])
      .then(([events, weather]) => renderCalendarEvents(events, weather))
      .catch(() => renderCalendarEvents([]));
  }

  function wireScheduleNav() {
    containerEl.querySelectorAll(".beast-schedule-body").forEach((host) => {
      host.addEventListener("click", (event) => {
        const prevBtn = event.target.closest("[data-schedule-prev]");
        const nextBtn = event.target.closest("[data-schedule-next]");
        const entityId = prevBtn?.dataset.schedulePrev || nextBtn?.dataset.scheduleNext;
        if (!entityId) return;
        scheduleDayOffsets[entityId] = (scheduleDayOffsets[entityId] || 0) + (prevBtn ? -1 : 1);
        renderScheduleCard(entityId);
      });
    });
  }

  function wireCalendarLayout() {
    const layout = BeastConfig.get("pageLayouts.waste.calendarLayout") || {};
    const hidden = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
    containerEl.querySelectorAll("[data-calendar-section]").forEach((el) => el.classList.toggle("is-layout-hidden", hidden.has(el.dataset.calendarSection)));
    BeastNativePageEditor.mount({ section:"waste", label:"Kalender", root:()=>containerEl, host:()=>containerEl, trigger:"#beastCalendarLayoutEdit", cards:()=>[
      // One card per configured schedule calendar, stacked in the column
      // Affald used to occupy -- scales to however many are configured
      // (one per child), not fixed to any specific number.
      ...scheduleCalendarIds().map((entityId, index) => {
        const id = `schedule-${scheduleCardSlug(entityId)}`;
        return { id, label: `Skema · ${scheduleCardLabel(entityId)}`, selector: `[data-calendar-section="${id}"]`, titleSelector: "h2", enabled: !hidden.has(id), desktop: { x: 1, y: 1 + index * 6, w: 4, h: 6 } };
      }),
      { id:"waste", label:"Affald og afhentning", selector:'[data-calendar-section="waste"]', titleSelector:"h2", enabled:!hidden.has("waste"), desktop:{x:1,y:13,w:12,h:4}, options:{rows:cardRows("waste",6)}, controls:[{key:"rows",label:"Antal viste rækker",min:1,max:30,default:6}] },
      { id:"events", label:"Kommende kalenderaftaler", selector:'[data-calendar-section="events"]', titleSelector:"h2", enabled:!hidden.has("events"), desktop:{x:5,y:1,w:8,h:12}, options:{rows:cardRows("events",12)}, controls:[{key:"rows",label:"Antal viste rækker",min:1,max:30,default:12}] }
    ], onSave:()=>render() });
  }

  function openCalendarLayout(layout) {
    const hidden = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
    const items = [["waste", "Affald og afhentning"], ["events", "Kommende kalenderaftaler"]];
    const overlay = document.createElement("div"); overlay.className = "beast-modal-overlay";
    overlay.innerHTML = `<div class="beast-modal beast-calendar-layout-modal"><div class="beast-modal-header"><h3>Rediger kalenderlayout</h3><button type="button" class="beast-modal-close" data-close>×</button></div><div class="beast-modal-body"><div class="beast-calendar-layout-list">${items.map(([id,label]) => `<label><input type="checkbox" data-calendar-layout-section="${id}" ${hidden.has(id) ? "" : "checked"}><strong>${label}</strong></label>`).join("")}</div><button type="button" class="beast-btn beast-btn-primary" data-save-calendar-layout>Gem layout</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) return overlay.remove();
      if (!event.target.closest("[data-save-calendar-layout]")) return;
      const nextHidden = items.filter(([id]) => !overlay.querySelector(`[data-calendar-layout-section="${id}"]`).checked).map(([id]) => id);
      BeastConfig.set("pageLayouts.waste.calendarLayout", { ...layout, hidden: nextHidden }); overlay.remove(); render();
    });
  }

  function init(root) {
    containerEl = root;
    containerEl.classList.add("beast-waste-panel");
    if (!wasteSensorIds().length && !calendarEntityIds().length && !scheduleCalendarIds().length) {
      containerEl.innerHTML = BeastCore.notConfiguredMarkup("Affald & kalender", "Vælg affaldssensorer og/eller kalendere i Administration for at aktivere dette panel.");
      BeastCore.wireNotConfiguredLinks(containerEl);
      return;
    }
    containerEl.innerHTML = `<p class="beast-music-empty">Henter…</p>`;
    const stableRender = BeastCore.stableUpdater(containerEl, render, 500);

    BeastHaSocket.onStatusChange((status) => { if (status === "connected") render(); });
    wasteSensorIds().forEach((id) => BeastHaSocket.subscribeEntity(id, stableRender));
    if (weatherEntityId()) BeastHaSocket.subscribeEntity(weatherEntityId(), stableRender);
    BeastHaSocket.subscribeDomain("calendar", stableRender);
    window.setInterval(() => {
      if (containerEl?.closest(".beast-section")?.classList.contains("is-active")) render();
    }, 5 * 60 * 1000);
  }

  BeastCore.registerPanel("waste", "beastWasteZone", init);
})();
