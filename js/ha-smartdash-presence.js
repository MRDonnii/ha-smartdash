(function () {
  let containerEl = null;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function getPersons() {
    return Array.from(BeastHaSocket.getAllStates().values())
      .filter((s) => s.entity_id.startsWith("person."))
      .sort((a, b) => (a.attributes.friendly_name || "").localeCompare(b.attributes.friendly_name || "", "da-DK"));
  }

  function render() {
    if (!containerEl) return;
    const persons = getPersons();
    if (!persons.length) {
      containerEl.innerHTML = `<p class="beast-music-empty">Ingen personer fundet.</p>`;
      return;
    }

    containerEl.innerHTML = `<div class="beast-presence-grid">${persons.map((p) => {
      const home = p.state === "home";
      const initials = (p.attributes.friendly_name || p.entity_id).split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
      return `
        <div class="beast-presence-card${home ? " is-home" : ""}">
          <span class="beast-presence-avatar">${escapeHtml(initials)}</span>
          <span class="beast-presence-name">${escapeHtml(p.attributes.friendly_name || p.entity_id)}</span>
          <span class="beast-presence-status">${home ? "Hjemme" : escapeHtml(p.state)}</span>
        </div>
      `;
    }).join("")}</div>`;
  }

  function init(root) {
    containerEl = root;
    containerEl.classList.add("beast-presence-panel");
    containerEl.innerHTML = `<p class="beast-music-empty">Henter…</p>`;

    BeastHaSocket.onStatusChange((status) => { if (status === "connected") render(); });
    BeastHaSocket.subscribeDomain("person", render);
  }

  BeastCore.registerPanel("presence", "beastPresenceZone", init);
})();
