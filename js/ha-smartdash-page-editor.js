// Shared editor for full-page views that do not need a page-specific card
// renderer. It keeps the existing specialised view intact and adds a
// configurable layer of entity cards below it. The same editor is used by
// every page, so drag/resize/search/save behaviour stays consistent.
window.BeastPageActions = (() => {
  function closeAll() {
    document.querySelectorAll(".beast-page-edit-menu").forEach((menu) => {
      menu.hidden = true;
      const trigger = menu.parentElement?.querySelector(".beast-page-edit-trigger");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
  }

  function attach(trigger, editAction) {
    if (!trigger || trigger.dataset.pageEditActionBound === "true") return;
    trigger.dataset.pageEditActionBound = "true";
    const menu = document.createElement("div");
    menu.className = "beast-page-edit-menu";
    menu.hidden = true;
    menu.innerHTML = `
      <button type="button" data-page-edit-action="refresh">${BeastCore.icon("refresh", { size: 16 })}<span>Genindlæs dashboard</span></button>
      <button type="button" data-page-edit-action="edit">${BeastCore.icon("settings", { size: 16 })}<span>Rediger siden</span></button>
    `;
    trigger.parentElement?.appendChild(menu);
    trigger.setAttribute("aria-expanded", "false");
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const isOpen = !menu.hidden;
      closeAll();
      if (isOpen) return;
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
    });
    menu.addEventListener("click", (event) => {
      const action = event.target.closest("[data-page-edit-action]");
      if (!action) return;
      event.stopPropagation();
      closeAll();
      const nextAction = action.dataset.pageEditAction;
      if (nextAction === "refresh") {
        window.triggerGlobalDashboardRefresh?.();
        return;
      }
      if (nextAction === "edit") {
        editAction?.();
      }
    });
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest(".beast-page-edit-trigger")) return;
    if (event.target.closest(".beast-page-edit-menu")) return;
    closeAll();
  }, true);

  return { attach, closeAll };
})();

window.BeastPageEditor = (() => {
  const EXCLUDED = new Set(["overview", "robots", "printer", "settings"]);
  const LABELS = {
    rooms: "Rum", cameras: "Kameraer", security: "Sikkerhed", music: "Musik",
    energy: "Energi", heating: "Varme", car: "Bil", pool: "Pool",
    waste: "Kalender", weather: "Vejr"
  };
  const DOMAIN_HINTS = {
    rooms: ["light", "climate", "sensor", "binary_sensor", "cover"],
    cameras: ["camera"], security: ["alarm_control_panel", "lock", "binary_sensor", "sensor"],
    music: ["media_player"], energy: ["sensor", "number"], heating: ["climate", "sensor"],
    car: ["device_tracker", "sensor", "binary_sensor"], pool: ["sensor", "switch", "light"],
    waste: ["calendar", "sensor"], weather: ["weather", "sensor"]
  };

  function escape(value) { const el = document.createElement("span"); el.textContent = String(value ?? ""); return el.innerHTML; }
  function cardsPath(section) { return `pageLayouts.${section}.cards`; }
  function entitiesFor(section) {
    const hints = DOMAIN_HINTS[section] || [];
    return BeastCardEditor.allEntities().filter((entity) => {
      const domain = entity.id.split(".")[0];
      return !hints.length || hints.includes(domain) || entity.name.toLowerCase().includes(section);
    });
  }
  function cardMarkup(card) {
    const size = `data-builder-card="${escape(card.id)}" style="--desktop-w:${Number(card.desktop?.w) || 3};--desktop-h:${Number(card.desktop?.h) || 1};--tablet-w:${Number(card.tablet?.w) || 1};--tablet-h:${Number(card.tablet?.h) || 1};--portrait-h:${Number(card.portrait?.h) || 1};"`;
    const standard = ["stat", "toggle", "graph", "camera", "media", "calendar"].includes(card.type) ? card.type : "custom";
    const host = standard === "custom" ? "<div class=\"beastOvGeneric\"></div>" : "<div class=\"beastStandardCardBody\"></div>";
    return `<section class="beast-panel beast-ov-card beast-page-builder-card beast-page-entity-card${card.enabled === false ? " is-disabled" : ""}" ${size} data-standard-card="${standard}" data-entity="${escape(card.entity || "")}" data-label="${escape(card.label || "")}" data-icon="${escape(card.icon || "grid")}">${host}<small class="beast-page-card-label">${escape(card.label || "")}</small></section>`;
  }
  function seed(section) {
    // Do not populate a page implicitly when edit mode opens. The user
    // should decide which cards belong on a view; relevant entities are
    // offered as suggestions in the add/configure dialog instead.
    return [];
  }
  function configureCard(card, commit, section) {
    const overlay = document.createElement("div");
    overlay.className = "beast-modal-overlay";
    const entities = BeastCardEditor.allEntities();
    overlay.innerHTML = `<div class="beast-modal beast-page-entity-modal" role="dialog" aria-modal="true"><div class="beast-modal-header"><h3>Indstil kort</h3><button type="button" class="beast-modal-close" data-close>×</button></div><div class="beast-modal-body"><label class="beast-page-editor-field">Korttype<select class="beast-page-card-type"><option value="custom">Entity / sensor</option><option value="stat">Statistik</option><option value="toggle">Touch-knap</option></select></label><label class="beast-page-editor-field">Navn på kort<input type="text" class="beast-page-card-name" placeholder="Valgfrit navn" value="${escape(card.label || "")}"></label><label class="beast-page-editor-field">Ikon<input type="text" class="beast-page-card-icon" placeholder="grid, bolt, light…" value="${escape(card.icon || "grid")}"></label><label class="beast-page-editor-check"><input type="checkbox" class="beast-page-card-enabled" ${card.enabled !== false ? "checked" : ""}> Vis kortet i normal visning</label><p class="beast-page-editor-hint">Forslag til ${escape(LABELS[section] || section)} vises først. Søgningen dækker alle Home Assistant-entiteter.</p><input type="search" class="beast-page-entity-search" placeholder="Søg i alle entities…" value="${escape(card.entity || "")}"><select class="beast-page-entity-select" size="8"></select><button type="button" class="beast-btn beast-btn-primary" data-save>Gem kort</button></div></div>`;
    document.body.appendChild(overlay);
    const search = overlay.querySelector(".beast-page-entity-search"), select = overlay.querySelector(".beast-page-entity-select");
    const typeSelect = overlay.querySelector(".beast-page-card-type");
    if (typeSelect) typeSelect.value = card.type || "custom";
    const renderOptions = () => {
      const query = search.value.trim().toLowerCase();
      const suggested = entitiesFor(section);
      const list = (query ? entities : suggested).filter((item) => !query || item.name.toLowerCase().includes(query) || item.id.toLowerCase().includes(query));
      select.innerHTML = list.map((item) => `<option value="${escape(item.id)}">${escape(item.name)} · ${escape(item.id)}</option>`).join("");
      if (card.entity) select.value = card.entity;
    };
    renderOptions();
    search.addEventListener("input", renderOptions);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) return overlay.remove();
      if (event.target.closest("[data-save]") && select.value) { commit({ ...card, type: typeSelect?.value || "custom", entity: select.value, label: overlay.querySelector(".beast-page-card-name")?.value?.trim() || "", icon: overlay.querySelector(".beast-page-card-icon")?.value?.trim() || "grid", enabled: overlay.querySelector(".beast-page-card-enabled")?.checked !== false }); overlay.remove(); }
    });
    search.focus();
  }
  function mount(section, zone) {
    if (!zone || EXCLUDED.has(section) || zone.dataset.pageEditorMounted === "true") return;
    zone.dataset.pageEditorMounted = "true";
    zone.classList.add("beast-page-editor-scroll-host");
    const host = document.createElement("div");
    host.className = "beast-page-editor-host";
    host.innerHTML = `<button type="button" class="beast-page-edit-trigger" aria-label="Rediger ${escape(LABELS[section] || section)}" title="Rediger siden">⋮</button><div class="beast-overview-grid beast-page-builder-grid beast-page-entity-grid is-freeform"></div>`;
    zone.appendChild(host);
    const grid = host.querySelector(".beast-page-entity-grid");
    const editor = BeastCardEditor.attach({
      zoneEl: grid, configPath: cardsPath(section), cardTypes: [["stat", "Statistik"], ["toggle", "Touch-knap"], ["graph", "Graf"], ["camera", "Kamera"], ["media", "Medieafspiller"], ["calendar", "Kalender"], ["custom", "Entity / sensor"]],
      renderCardMarkup: cardMarkup, seedCards: () => seed(section), defaultCardSize: { desktop: { w: 3, h: 1 }, tablet: { w: 1, h: 1 }, portrait: { h: 1 } },
      allEntities: BeastCardEditor.allEntities, entityPickerTypes: ["stat", "toggle", "graph", "camera", "media", "calendar", "custom"], editLabel: `Redigerer ${LABELS[section] || section}`,
      configureCard: (card, commit) => configureCard(card, commit, section), onAfterRender: () => BeastStandardCards.wire(grid)
    });
    window.BeastPageActions?.attach(host.querySelector(".beast-page-edit-trigger"), () => editor.enter());
    // Page modules may repaint their zone when HA state changes. Reattach the
    // editor host after such a repaint without touching the page's own cards.
    const observer = new MutationObserver(() => {
      if (!zone.contains(host)) {
        zone.dataset.pageEditorMounted = "";
        observer.disconnect();
        window.setTimeout(() => mount(section, zone), 0);
      }
    });
    observer.observe(zone, { childList: true });
  }
  function mountAll() {
    document.querySelectorAll(".beast-section[data-section]").forEach((section) => {
      const id = section.dataset.section;
      if (EXCLUDED.has(id)) return;
      const zone = section.querySelector("[id$='Zone']") || section.firstElementChild;
      if (zone) mount(id, zone);
    });
  }
  return { mountAll };
})();
