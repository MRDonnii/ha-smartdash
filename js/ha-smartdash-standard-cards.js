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
  const TYPES = [
    ["stat", "Statistik"],
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

  // Every BeastCardEditor renderCardMarkup() must produce a single root
  // element carrying data-builder-card="id" plus the sizing custom
  // properties -- same contract the front page's overviewCardMarkup()
  // already follows.
  function renderMarkup(card) {
    const size = ` data-builder-card="${escape(card.id)}" style="--desktop-w:${Number(card.desktop?.w) || 3};--desktop-h:${Number(card.desktop?.h) || 1};--tablet-w:${Number(card.tablet?.w) || 1};--tablet-h:${Number(card.tablet?.h) || 1};--portrait-h:${Number(card.portrait?.h) || 1};"`;
    if (card.type === "stat") {
      return `<div class="beast-panel beast-panel-fill beast-ov-card beast-ov-card--stat"${size} data-standard-card="stat" data-entity="${escape(card.entity)}"><div class="beastStandardCardBody"></div></div>`;
    }
    return `<section class="beast-panel beast-ov-card beast-ov-card--generic"${size} data-standard-card="custom" data-entity="${escape(card.entity)}"><div class="beastOvGeneric"></div></section>`;
  }

  // Populates live entity values into every standard-card shell inside
  // zoneEl -- call after every DOM rebuild (from the page's
  // onAfterRender), mirroring how the front page repaints its own
  // generic widgets on every render.
  function wire(zoneEl) {
    if (!zoneEl) return;
    zoneEl.querySelectorAll('[data-standard-card="stat"] .beastStandardCardBody, [data-standard-card="custom"] .beastOvGeneric').forEach((host) => {
      const card = host.closest("[data-standard-card]");
      const entityId = card.dataset.entity;
      const state = entityId ? BeastHaSocket.getState(entityId) : null;
      const unavailable = !state || ["unknown", "unavailable"].includes(state.state);
      const label = state?.attributes?.friendly_name || entityId || "Ikke valgt";
      const value = unavailable ? "Ikke tilgængelig" : state.state;
      if (card.dataset.standardCard === "stat") {
        host.innerHTML = BeastCore.statTile({ icon: "grid", label, value, meta: unavailable ? "" : (state.attributes?.unit_of_measurement || "") });
      } else {
        host.innerHTML = `<div class="beast-ov-generic-content"><span>${BeastCore.icon("grid", { size: 31 })}</span><small>${escape(label)}</small><strong>${escape(value)}</strong><em>${escape(entityId || "")}</em></div>`;
      }
      card.classList.toggle("is-unavailable", unavailable);
    });
  }

  return { types: TYPES, entityPickerTypes: ENTITY_PICKER_TYPES, isStandardType, renderMarkup, wire };
})();
