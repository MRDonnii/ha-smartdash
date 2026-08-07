(function () {
  function wasteSensorIds() { return BeastConfig.get("panels.waste.sensors") || []; }
  function calendarEntityIds() { return BeastConfig.get("panels.waste.calendars") || []; }

  let containerEl = null;

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

    return items.map((item) => BeastCore.statTile({
      icon: "calendar",
      label: escapeHtml(item.name),
      value: item.days === 0 ? "I dag" : item.days === 1 ? "I morgen" : `Om ${item.days}<small>dage</small>`,
      meta: escapeHtml(item.dateLabel)
    })).join("");
  }

  function formatEventTime(event) {
    const start = event.start?.dateTime || event.start?.date;
    if (!start) return "";
    const date = new Date(start);
    const isAllDay = !event.start?.dateTime;
    if (isAllDay) return date.toLocaleDateString("da-DK", { day: "numeric", month: "short" });
    return date.toLocaleString("da-DK", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  async function loadCalendarEvents() {
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

    return results.flat()
      .sort((a, b) => new Date(a.start?.dateTime || a.start?.date) - new Date(b.start?.dateTime || b.start?.date))
      .slice(0, 12);
  }

  function renderCalendarEvents(events) {
    const host = document.getElementById("beastCalendarEvents");
    if (!host) return;
    if (!events.length) {
      host.innerHTML = `<p class="beast-music-empty">Ingen kommende begivenheder.</p>`;
      return;
    }
    host.innerHTML = events.map((event) => BeastCore.statTile({
      icon: "calendar",
      label: escapeHtml(formatEventTime(event)),
      value: escapeHtml(event.summary || "Uden titel")
    })).join("");
  }

  function render() {
    if (!containerEl) return;
    containerEl.innerHTML = `
      <section class="beast-waste-section">
        <p class="beast-panel-title">Affaldskalender</p>
        <div class="beast-stat-grid">${buildWasteMarkup()}</div>
      </section>
      <section class="beast-waste-section">
        <p class="beast-panel-title">Kommende begivenheder</p>
        <div class="beast-stat-grid" id="beastCalendarEvents"><p class="beast-music-empty">Henter…</p></div>
      </section>
    `;

    loadCalendarEvents().then(renderCalendarEvents);
  }

  function init(root) {
    containerEl = root;
    containerEl.classList.add("beast-waste-panel");
    if (!wasteSensorIds().length && !calendarEntityIds().length) {
      containerEl.innerHTML = BeastCore.notConfiguredMarkup("Affald & kalender", "Vælg affaldssensorer og/eller kalendere i Administration for at aktivere dette panel.");
      BeastCore.wireNotConfiguredLinks(containerEl);
      return;
    }
    containerEl.innerHTML = `<p class="beast-music-empty">Henter…</p>`;
    const stableRender = BeastCore.stableUpdater(containerEl, render, 500);

    BeastHaSocket.onStatusChange((status) => { if (status === "connected") render(); });
    wasteSensorIds().forEach((id) => BeastHaSocket.subscribeEntity(id, stableRender));
  }

  BeastCore.registerPanel("waste", "beastWasteZone", init);
})();
