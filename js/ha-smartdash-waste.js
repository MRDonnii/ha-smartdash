(function () {
  function t(da, en) { return BeastLocalSettings.get("language", "en") === "da" ? da : en; }
  function wasteSensorIds() { return BeastConfig.get("panels.waste.sensors") || []; }
  function calendarEntityIds() { return BeastConfig.get("panels.waste.calendars") || []; }
  function scheduleCalendarIds() { return BeastConfig.get("panels.waste.scheduleCalendars") || []; }

  let containerEl = null;
  let calendarRequest = 0;
  let selectedCalendarDay = "all";
  // One card per configured schedule calendar (e.g. one per child) -- each
  // navigates its own week independently, so this is keyed by entity_id
  // rather than a single shared value.
  let scheduleWeekOffsets = {};
  let scheduleRequestIds = {};

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
    idr: ["Idræt", "Physical education"], mat: ["Matematik", "Mathematics"], dan: ["Dansk", "Danish"], mus: ["Musik", "Music"],
    kri: ["Kristendomskundskab", "Religious education"], "n/t": ["Natur/teknologi", "Science and technology"]
  };
  function scheduleSubjectLabel(code) {
    const raw = String(code || "").trim();
    const names = SCHEDULE_SUBJECT_NAMES[raw.toLowerCase()];
    return names ? t(names[0], names[1]) : raw;
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

  // A subject's color must stay the same everywhere it appears (both
  // children's cards, every week), but different schools/installs will
  // have entirely different subject codes -- so this hashes the subject's
  // real name into a fixed palette instead of hardcoding this family's own
  // subjects, which keeps it working for anyone else's timetable too.
  const SCHEDULE_SUBJECT_PALETTE = [
    "#1f7a5c", "#2f5f9f", "#9f3450", "#9f7d1f",
    "#1f8f9f", "#6f3f9f", "#b0601f", "#3f7a3f"
  ];
  function scheduleSubjectColor(code) {
    const label = (String(code || "").trim() || "?").toLowerCase();
    let hash = 0;
    for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
    return SCHEDULE_SUBJECT_PALETTE[hash % SCHEDULE_SUBJECT_PALETTE.length];
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
          teachers: [...new Set(group.parts.map((part) => part.teacher).filter(Boolean))]
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

    if (!items.length) return `<p class="beast-music-empty">${t("Ingen affaldsdata.", "No collection data.")}</p>`;

    const visibleItems = items.slice(0, cardRows("waste", 3));
    return visibleItems.map((item, index) => {
      const when = item.days === 0 ? t("I dag", "Today") : item.days === 1 ? t("I morgen", "Tomorrow") : t(`Om ${item.days} dage`, `In ${item.days} days`);
      return `<article class="beast-calendar-waste-item${index === 0 ? " is-next" : ""}">
        <span class="beast-calendar-waste-icon">${BeastCore.icon("calendar", { size:index === 0 ? 26 : 21 })}</span>
        <div><small>${index === 0 ? t("Næste afhentning", "Next collection") : escapeHtml(item.dateLabel || t("Planlagt", "Scheduled"))}</small><strong>${escapeHtml(item.name || t("Affald", "Waste"))}</strong>${index === 0 && item.dateLabel ? `<em>${escapeHtml(item.dateLabel)}</em>` : ""}</div>
        <b>${escapeHtml(when)}</b>
      </article>`;
    }).join("");
  }

  // Monday of the target week, weekOffset weeks from the current one.
  function scheduleWeekStart(weekOffset) {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    const dow = day.getDay(); // 0=Sun..6=Sat
    const mondayDelta = dow === 0 ? -6 : 1 - dow;
    day.setDate(day.getDate() + mondayDelta + weekOffset * 7);
    return day;
  }

  async function loadScheduleWeek(entityId, weekOffset) {
    const start = scheduleWeekStart(weekOffset);
    const end = new Date(start);
    end.setDate(end.getDate() + 5); // Monday through end of Friday
    try {
      const events = await BeastAuth.haFetch(`/api/calendars/${entityId}?start=${start.toISOString()}&end=${end.toISOString()}`);
      return mergeScheduleEvents(events || []);
    } catch (error) {
      return [];
    }
  }

  function scheduleTimeKey(iso) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function scheduleDayKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  const scheduleOverflowObservers = new WeakMap();
  function wireScheduleOverflowText(host) {
    scheduleOverflowObservers.get(host)?.disconnect();
    const measure = () => {
      host.querySelectorAll(".beast-schedule-scroll-line").forEach((line) => {
        const content = line.querySelector(".beast-schedule-scroll-content");
        if (!content) return;
        line.classList.remove("is-overflowing");
        line.style.removeProperty("--schedule-scroll-distance");
        line.style.removeProperty("--schedule-scroll-duration");
        const overflow = Math.ceil(content.scrollWidth - line.clientWidth);
        if (overflow <= 2) return;
        line.style.setProperty("--schedule-scroll-distance", `${overflow}px`);
        line.style.setProperty("--schedule-scroll-duration", `${Math.max(6, Math.min(16, 4 + overflow / 22)).toFixed(1)}s`);
        line.classList.add("is-overflowing");
      });
    };
    const observer = new ResizeObserver(() => window.requestAnimationFrame(measure));
    observer.observe(host);
    scheduleOverflowObservers.set(host, observer);
    window.requestAnimationFrame(measure);
  }

  // Weekday columns x time-of-day rows -- rows are the distinct start times
  // actually seen this week (school periods are fixed, but a half-day or a
  // cancelled first period shouldn't invent an empty row that never occurs).
  function renderScheduleWeekGrid(rows, weekStart, locale) {
    if (!rows.length) return `<div class="beast-calendar-empty">${BeastCore.icon("calendar", { size: 26 })}<strong>${t("Ingen timer denne uge", "No lessons this week")}</strong></div>`;

    const days = Array.from({ length: 5 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });
    const dayKeys = days.map(scheduleDayKey);

    const slotMap = new Map();
    rows.forEach((row) => {
      const key = scheduleTimeKey(row.start);
      if (!slotMap.has(key)) slotMap.set(key, { startKey: key, endKey: scheduleTimeKey(row.end) });
    });
    const slots = Array.from(slotMap.values()).sort((a, b) => a.startKey.localeCompare(b.startKey));

    const cellIndex = new Map();
    rows.forEach((row) => {
      cellIndex.set(`${scheduleDayKey(new Date(row.start))}|${scheduleTimeKey(row.start)}`, row);
    });

    const headerCells = days.map((d) => `<div class="beast-schedule-week-head"><small>${escapeHtml(d.toLocaleDateString(locale, { weekday: "short" }))}</small><strong>${d.getDate()}/${d.getMonth() + 1}</strong></div>`).join("");

    const bodyRows = slots.map((slot) => {
      const timeCell = `<div class="beast-schedule-week-time">${escapeHtml(slot.startKey)}<small>${escapeHtml(slot.endKey)}</small></div>`;
      const dayCells = dayKeys.map((key) => {
        const row = cellIndex.get(`${key}|${slot.startKey}`);
        if (!row) return `<div class="beast-schedule-week-cell is-empty"></div>`;
        const teacherText = row.teachers.map((teacher) => {
          const isSub = /^vikar/i.test(teacher);
          const clean = teacher.replace(/^vikar:?\s*/i, "");
          return isSub ? `<em class="is-substitute">${t("VIKAR", "SUBSTITUTE")}: ${escapeHtml(clean)}</em>` : escapeHtml(teacher);
        }).join(" + ");
        return `<div class="beast-schedule-week-cell" style="--subject-color:${scheduleSubjectColor(row.subject)}">
          <strong class="beast-schedule-scroll-line"><span class="beast-schedule-scroll-content">${escapeHtml(scheduleSubjectLabel(row.subject) || t("Ukendt fag", "Unknown subject"))}</span></strong>
          ${teacherText ? `<span class="beast-schedule-scroll-line"><span class="beast-schedule-scroll-content">${teacherText}</span></span>` : ""}
        </div>`;
      }).join("");
      return `<div class="beast-schedule-week-row">${timeCell}${dayCells}</div>`;
    }).join("");

    return `<div class="beast-schedule-week-grid">
      <div class="beast-schedule-week-row beast-schedule-week-header"><div class="beast-schedule-week-time"></div>${headerCells}</div>
      ${bodyRows}
    </div>`;
  }

  function scheduleWeekLabel(weekOffset, weekStart, locale) {
    if (weekOffset === 0) return t("Denne uge", "This week");
    if (weekOffset === 1) return t("Næste uge", "Next week");
    if (weekOffset === -1) return t("Sidste uge", "Previous week");
    const end = new Date(weekStart); end.setDate(end.getDate() + 4);
    return `${weekStart.toLocaleDateString(locale, { day: "numeric", month: "short" })} – ${end.toLocaleDateString(locale, { day: "numeric", month: "short" })}`;
  }

  async function renderScheduleCard(entityId) {
    const slug = scheduleCardSlug(entityId);
    const host = document.getElementById(`beastSchedule-${slug}`);
    if (!host) return;
    const requestId = (scheduleRequestIds[entityId] || 0) + 1;
    scheduleRequestIds[entityId] = requestId;
    const weekOffset = scheduleWeekOffsets[entityId] || 0;
    const locale = window.HASmartdashI18n?.locale || "da-DK";
    const weekStart = scheduleWeekStart(weekOffset);
    host.innerHTML = `<p class="beast-music-empty">${t("Henter…", "Loading…")}</p>`;
    const rows = await loadScheduleWeek(entityId, weekOffset);
    if (requestId !== scheduleRequestIds[entityId]) return;
    host.innerHTML = `
      <div class="beast-schedule-nav">
        <button type="button" class="beast-schedule-nav-btn is-prev" data-schedule-prev="${escapeHtml(entityId)}" aria-label="${t("Forrige uge", "Previous week")}">${BeastCore.icon("chevron-right", { size: 16 })}</button>
        <strong>${escapeHtml(scheduleWeekLabel(weekOffset, weekStart, locale))}</strong>
        <button type="button" class="beast-schedule-nav-btn" data-schedule-next="${escapeHtml(entityId)}" aria-label="${t("Næste uge", "Next week")}">${BeastCore.icon("chevron-right", { size: 16 })}</button>
      </div>
      ${renderScheduleWeekGrid(rows, weekStart, locale)}
    `;
    wireScheduleOverflowText(host);
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
    const dayStrip = `<button type="button" class="beast-calendar-day is-all${selectedCalendarDay === "all" ? " is-selected" : ""}" data-calendar-day="all" aria-pressed="${selectedCalendarDay === "all"}"><small>${t("Vis", "Show")}</small><strong>${t("Alle", "All")}</strong><span>${events.length} ${t("aftaler", "events")}</span></button>${days.map(({day,key,count,offset}) => `<button type="button" class="beast-calendar-day${offset === 0 ? " is-today" : ""}${count ? " has-events" : ""}${selectedCalendarDay === key ? " is-selected" : ""}" data-calendar-day="${key}" aria-pressed="${selectedCalendarDay === key}"><small>${day.toLocaleDateString(locale,{weekday:"short"}).replace(".","")}</small><strong>${day.getDate()}</strong>${weatherBadge(forecastForDay(weather, day), true)}<i>${count || ""}</i></button>`).join("")}`;
    const visibleEvents = (selectedCalendarDay === "all" ? events : events.filter((event) => eventDayKey(event) === selectedCalendarDay)).slice(0, cardRows("events", 12));
    const selectedDay = days.find((item) => item.key === selectedCalendarDay)?.day;
    const emptyDetail = selectedDay
      ? t(`Ingen aftaler ${selectedDay.toLocaleDateString(locale, { weekday:"long", day:"numeric", month:"long" })}.`, `No events ${selectedDay.toLocaleDateString(locale, { weekday:"long", day:"numeric", month:"long" })}.`)
      : t("Ingen kommende begivenheder de næste 14 dage.", "No upcoming events in the next 14 days.");
    const agenda = visibleEvents.map((event, index) => {
      const calendar = BeastHaSocket.getState(event.calendarId);
      const calendarName = calendar?.attributes?.friendly_name || event.calendarId?.replace("calendar.", "") || t("Kalender", "Calendar");
      const start = event.start?.dateTime || event.start?.date;
      const date = new Date(start);
      const allDay = !event.start?.dateTime;
      const day = date.toLocaleDateString(locale, { weekday:"short", day:"numeric", month:"short" });
      const time = allDay ? t("Hele dagen", "All day") : date.toLocaleTimeString(locale, { hour:"2-digit", minute:"2-digit" });
      const eventWeather = forecastForEvent(weather, event);
      return `<article class="beast-calendar-event${index === 0 ? " is-next" : ""}">
        <time><strong>${escapeHtml(day.replace(".",""))}</strong><span>${escapeHtml(time)}</span></time>
        <i aria-hidden="true"></i>
        <div><strong>${escapeHtml(event.summary || t("Uden titel", "Untitled"))}</strong><span>${escapeHtml(calendarName)}</span></div>
        ${weatherBadge(eventWeather)}
        ${index === 0 ? `<b>${t("Næste", "Next")}</b>` : ""}
      </article>`;
    }).join("") || `<div class="beast-calendar-empty">${BeastCore.icon("calendar", { size:30 })}<strong>${t("Kalenderen er fri", "Calendar is clear")}</strong><span>${escapeHtml(emptyDetail)}</span></div>`;
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
        <header class="beast-calendar-section-head"><span>${BeastCore.icon("calendar", { size:22 })}</span><div><small>${t("Skoleskema", "School schedule")}</small><h2>${escapeHtml(scheduleCardLabel(entityId))}</h2></div></header>
        <div class="beast-schedule-body" id="beastSchedule-${slug}"><p class="beast-music-empty">${t("Henter…", "Loading…")}</p></div>
      </section>`;
    }).join("");
    containerEl.innerHTML = `
      <button type="button" class="beast-page-edit-trigger" id="beastCalendarLayoutEdit" aria-label="${t("Rediger kalenderlayout", "Edit calendar layout")}">⋮</button>
      ${scheduleSections}
      <section class="beast-waste-section" data-calendar-section="waste">
        <header class="beast-calendar-section-head"><span>${BeastCore.icon("calendar", { size:22 })}</span><div><small>${t("Husets afhentninger", "Household collections")}</small><h2>${t("Affald", "Waste")}</h2></div></header>
        <div class="beast-calendar-waste-list" style="--calendar-item-rows:${Math.max(1, Math.min(cardRows("waste", 3), wasteSensorIds().length || 1))}">${buildWasteMarkup()}</div>
      </section>
      <section class="beast-waste-section" data-calendar-section="events">
        <header class="beast-calendar-section-head"><span>${BeastCore.icon("calendar", { size:22 })}</span><div><small>${t("De næste 14 dage", "Next 14 days")}</small><h2>${t("Kommende aftaler", "Upcoming events")}</h2></div><time>${new Date().toLocaleDateString(window.HASmartdashI18n?.locale || "da-DK", { weekday:"long", day:"numeric", month:"long" })}</time></header>
        <div class="beast-calendar-events" id="beastCalendarEvents"><p class="beast-music-empty">${t("Henter…", "Loading…")}</p></div>
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
        scheduleWeekOffsets[entityId] = (scheduleWeekOffsets[entityId] || 0) + (prevBtn ? -1 : 1);
        renderScheduleCard(entityId);
      });
    });
  }

  function wireCalendarLayout() {
    const layout = BeastConfig.get("pageLayouts.waste.calendarLayout") || {};
    const hidden = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
    containerEl.querySelectorAll("[data-calendar-section]").forEach((el) => el.classList.toggle("is-layout-hidden", hidden.has(el.dataset.calendarSection)));
    // School schedules are the primary calendar content and therefore use
    // the wide column. Upcoming events and the less important collection
    // summary share the compact side column. Additional school calendars
    // stack below the first one without changing the side-column hierarchy.
    BeastNativePageEditor.mount({ section:"waste", label:t("Kalender", "Calendar"), root:()=>containerEl, host:()=>containerEl, trigger:"#beastCalendarLayoutEdit", cards:()=>[
      ...scheduleCalendarIds().map((entityId, index) => {
        const id = `schedule-${scheduleCardSlug(entityId)}`;
        return { id, label: `${t("Skema", "Schedule")} · ${scheduleCardLabel(entityId)}`, selector: `[data-calendar-section="${id}"]`, titleSelector: "h2", enabled: !hidden.has(id), desktop: { x: 1, y: 1 + index * 12, w: 8, h: 12 } };
      }),
      { id:"waste", label:t("Affald og afhentning", "Waste and collections"), selector:'[data-calendar-section="waste"]', titleSelector:"h2", available:()=>wasteSensorIds().length > 0, enabled:!hidden.has("waste"), desktop:{x:9,y:13,w:4,h:6}, options:{rows:cardRows("waste",3)}, controls:[{key:"rows",label:t("Antal viste rækker", "Visible rows"),min:1,max:30,default:3}] },
      { id:"events", label:t("Kommende kalenderaftaler", "Upcoming calendar events"), selector:'[data-calendar-section="events"]', titleSelector:"h2", available:()=>calendarEntityIds().length > 0, enabled:!hidden.has("events"), desktop:{x:9,y:1,w:4,h:12}, options:{rows:cardRows("events",12)}, controls:[{key:"rows",label:t("Antal viste rækker", "Visible rows"),min:1,max:30,default:12}] }
    ], onSave:()=>render() });
  }

  function openCalendarLayout(layout) {
    const hidden = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
    const items = [["waste", t("Affald og afhentning", "Waste and collections")], ["events", t("Kommende kalenderaftaler", "Upcoming calendar events")]];
    const overlay = document.createElement("div"); overlay.className = "beast-modal-overlay";
    overlay.innerHTML = `<div class="beast-modal beast-calendar-layout-modal"><div class="beast-modal-header"><h3>${t("Rediger kalenderlayout", "Edit calendar layout")}</h3><button type="button" class="beast-modal-close" data-close>×</button></div><div class="beast-modal-body"><div class="beast-calendar-layout-list">${items.map(([id,label]) => `<label><input type="checkbox" data-calendar-layout-section="${id}" ${hidden.has(id) ? "" : "checked"}><strong>${label}</strong></label>`).join("")}</div><button type="button" class="beast-btn beast-btn-primary" data-save-calendar-layout>${t("Gem layout", "Save layout")}</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) return overlay.remove();
      if (!event.target.closest("[data-save-calendar-layout]")) return;
      const nextHidden = items.filter(([id]) => !overlay.querySelector(`[data-calendar-layout-section="${id}"]`).checked).map(([id]) => id);
      BeastConfig.set("pageLayouts.waste.calendarLayout", { ...layout, hidden: nextHidden }); overlay.remove(); render();
    });
  }

  // A dashboard that already had a saved Kalender layout before schedule
  // calendars existed keeps its old "waste"/"events" desktop positions
  // forever (the native editor always prefers a saved position over a
  // fresh default) -- so the moment schedule calendars are configured for
  // the first time, this stacks them below the old cards instead of
  // leaving them overlapping. Only touches a saved position that still
  // exactly matches the pre-feature default -- a real sign it was never
  // customized -- and only runs once, the moment schedule-* cards are
  // still absent from the saved layout.
  const LEGACY_WASTE_DESKTOP = { x: 1, y: 1, w: 5, h: 12 };
  function migrateWasteLayoutForSchedule() {
    if (!scheduleCalendarIds().length) return;
    const path = window.BeastNativePageEditor?.storagePath?.("waste") || "pageLayouts.waste.nativeCards";
    const saved = BeastConfig.get(path);
    if (!Array.isArray(saved) || !saved.length) return;
    if (saved.some((card) => String(card.id || "").startsWith("schedule-"))) return;
    const wasteCard = saved.find((card) => card.id === "waste");
    const d = wasteCard?.desktop || {};
    const isLegacy = d.x === LEGACY_WASTE_DESKTOP.x && d.y === LEGACY_WASTE_DESKTOP.y && d.w === LEGACY_WASTE_DESKTOP.w && d.h === LEGACY_WASTE_DESKTOP.h;
    if (!isLegacy) return;
    wasteCard.desktop = { x: 1, y: 13, w: 12, h: 4 };
    const eventsCard = saved.find((card) => card.id === "events");
    if (eventsCard) eventsCard.desktop = { x: 5, y: 1, w: 8, h: 12 };
    BeastConfig.set(path, saved);
  }

  // v0.7.61 introduced schedule cards in a narrow four-column stack and
  // placed waste across the full page. Migrate only those exact defaults;
  // user-arranged cards keep their saved positions unchanged.
  function migrateCalendarLayoutToScheduleFirst() {
    const path = window.BeastNativePageEditor?.storagePath?.("waste") || "pageLayouts.waste.nativeCards";
    const saved = BeastConfig.get(path);
    if (!Array.isArray(saved) || !saved.length) return;
    let changed = false;
    saved.filter((card) => String(card.id || "").startsWith("schedule-")).forEach((card, index) => {
      const d = card.desktop || {};
      if (d.x === 1 && d.y === 1 + index * 6 && d.w === 4 && d.h === 6) {
        card.desktop = { x: 1, y: 1 + index * 8, w: 8, h: 8 }; changed = true;
      }
    });
    const events = saved.find((card) => card.id === "events");
    if (events?.desktop?.x === 5 && events.desktop.y === 1 && events.desktop.w === 8 && events.desktop.h === 12) {
      events.desktop = { x: 9, y: 1, w: 4, h: 12 }; changed = true;
    }
    const waste = saved.find((card) => card.id === "waste");
    if (waste?.desktop?.x === 1 && waste.desktop.y === 13 && waste.desktop.w === 12 && waste.desktop.h === 4) {
      waste.desktop = { x: 9, y: 13, w: 4, h: 3 };
      if (!waste.options || Number(waste.options.rows) === 6) waste.options = { ...(waste.options || {}), rows: 3 };
      changed = true;
    }
    if (changed) BeastConfig.set(path, saved);
  }

  // v0.7.63 made school schedules the primary wide card, but its eight-row
  // height still forced the weekly timetable to scroll. Expand only that
  // release's exact default; manually resized schedules remain untouched.
  function migrateCalendarLayoutToFullSchedule() {
    const path = window.BeastNativePageEditor?.storagePath?.("waste") || "pageLayouts.waste.nativeCards";
    const saved = BeastConfig.get(path);
    if (!Array.isArray(saved) || !saved.length) return;
    let changed = false;
    saved.filter((card) => String(card.id || "").startsWith("schedule-")).forEach((card, index) => {
      const d = card.desktop || {};
      if (d.x === 1 && d.y === 1 + index * 8 && d.w === 8 && d.h === 8) {
        card.desktop = { x: 1, y: 1 + index * 12, w: 8, h: 12 };
        changed = true;
      }
    });
    if (changed) BeastConfig.set(path, saved);
  }

  // v0.7.64 reduced the waste card to three layout rows. With two school
  // schedules that left less usable height than its header and collection
  // rows require, so the content appeared as clipped strips. Expand only
  // that exact default; user-resized waste cards remain untouched.
  function migrateCalendarLayoutToReadableWaste() {
    const path = window.BeastNativePageEditor?.storagePath?.("waste") || "pageLayouts.waste.nativeCards";
    const saved = BeastConfig.get(path);
    if (!Array.isArray(saved) || !saved.length) return;
    const waste = saved.find((card) => card.id === "waste");
    const d = waste?.desktop || {};
    if (d.x !== 9 || d.y !== 13 || d.w !== 4 || d.h !== 3) return;
    waste.desktop = { x: 9, y: 13, w: 4, h: 6 };
    BeastConfig.set(path, saved);
  }

  function init(root) {
    containerEl = root;
    containerEl.classList.add("beast-waste-panel");
    if (!wasteSensorIds().length && !calendarEntityIds().length && !scheduleCalendarIds().length) {
      containerEl.innerHTML = BeastCore.notConfiguredMarkup(t("Affald & kalender", "Waste & calendar"), t("Vælg affaldssensorer og/eller kalendere i Administration for at aktivere dette panel.", "Select waste sensors and/or calendars in Administration to enable this panel."));
      BeastCore.wireNotConfiguredLinks(containerEl);
      return;
    }
    migrateWasteLayoutForSchedule();
    migrateCalendarLayoutToScheduleFirst();
    migrateCalendarLayoutToFullSchedule();
    migrateCalendarLayoutToReadableWaste();
    containerEl.innerHTML = `<p class="beast-music-empty">${t("Henter…", "Loading…")}</p>`;
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
