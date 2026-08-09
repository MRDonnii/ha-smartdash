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

  // Every BeastCardEditor renderCardMarkup() must produce a single root
  // element carrying data-builder-card="id" plus the sizing custom
  // properties -- same contract the front page's overviewCardMarkup()
  // already follows.
  function renderMarkup(card) {
    const size = ` data-builder-card="${escape(card.id)}" style="--desktop-w:${Number(card.desktop?.w) || 3};--desktop-h:${Number(card.desktop?.h) || 1};--tablet-w:${Number(card.tablet?.w) || 1};--tablet-h:${Number(card.tablet?.h) || 1};--portrait-h:${Number(card.portrait?.h) || 1};"`;
    if (card.type === "stat") {
      return `<div class="beast-panel beast-panel-fill beast-ov-card beast-ov-card--stat"${size} data-standard-card="stat" data-entity="${escape(card.entity)}"><div class="beastStandardCardBody"></div></div>`;
    }
    if (card.type === "toggle") {
      return `<section class="beast-panel beast-ov-card beast-ov-card--generic beast-standard-toggle-card"${size} data-standard-card="toggle" data-entity="${escape(card.entity)}"><div class="beastStandardCardBody"></div></section>`;
    }
    if (["graph", "camera", "media", "calendar"].includes(card.type)) return `<section class="beast-panel beast-ov-card beast-standard-${escape(card.type)}-card"${size} data-standard-card="${escape(card.type)}" data-entity="${escape(card.entity)}"><div class="beastStandardCardBody"></div></section>`;
    return `<section class="beast-panel beast-ov-card beast-ov-card--generic"${size} data-standard-card="custom" data-entity="${escape(card.entity)}"><div class="beastOvGeneric"></div></section>`;
  }

  // Populates live entity values into every standard-card shell inside
  // zoneEl -- call after every DOM rebuild (from the page's
  // onAfterRender), mirroring how the front page repaints its own
  // generic widgets on every render.
  function wire(zoneEl) {
    if (!zoneEl) return;
    zoneEl.querySelectorAll('[data-standard-card="stat"] .beastStandardCardBody, [data-standard-card="toggle"] .beastStandardCardBody, [data-standard-card="graph"] .beastStandardCardBody, [data-standard-card="camera"] .beastStandardCardBody, [data-standard-card="media"] .beastStandardCardBody, [data-standard-card="calendar"] .beastStandardCardBody, [data-standard-card="custom"] .beastOvGeneric').forEach((host) => {
      const card = host.closest("[data-standard-card]");
      const entityId = card.dataset.entity;
      const state = entityId ? BeastHaSocket.getState(entityId) : null;
      const unavailable = !state || ["unknown", "unavailable"].includes(state.state);
      const label = card.dataset.label || state?.attributes?.friendly_name || entityId || "Ikke valgt";
      const value = unavailable ? "Ikke tilgængelig" : state.state;
      const icon = card.dataset.icon || "grid";
      if (card.dataset.standardCard === "stat") {
        host.innerHTML = BeastCore.statTile({ icon, label, value, meta: unavailable ? "" : (state.attributes?.unit_of_measurement || "") });
      } else if (card.dataset.standardCard === "toggle") {
        const domain = entityId?.split(".")[0] || "switch";
        const active = state?.state === "on" || state?.state === "open" || state?.state === "unlocked";
        host.innerHTML = `<button type="button" class="beast-standard-toggle" data-entity="${escape(entityId || "")}" data-domain="${escape(domain)}" data-active="${active}"><span class="beast-standard-toggle-icon">${BeastCore.icon(active ? "check" : "bolt", { size: 23 })}</span><span><small>${escape(label)}</small><strong>${active ? "Tændt" : "Slukket"}</strong></span></button>`;
        host.querySelector("button")?.addEventListener("click", () => {
          if (!entityId || unavailable) return;
          const service = domain === "lock" ? (active ? "unlock" : "lock") : domain === "cover" ? (active ? "close_cover" : "open_cover") : (active ? "turn_off" : "turn_on");
          BeastAuth.haFetch(`/api/services/${domain}/${service}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity_id: entityId }) }).catch((error) => BeastCore.log(`Kortstyring fejlede: ${error.message}`));
        });
      } else if (card.dataset.standardCard === "graph") {
        const n = Number(state?.state); const points = Array.from({ length: 18 }, (_, i) => Number.isFinite(n) ? Math.max(0, n * (0.84 + ((i * 13) % 17) / 100)) : 0);
        host.innerHTML = `<div class="beast-standard-graph"><small>${escape(label)}</small><strong>${escape(value)} ${escape(state?.attributes?.unit_of_measurement || "")}</strong>${BeastCore.sparkline(points, { color: "var(--accent)", height: 72 })}</div>`;
      } else if (card.dataset.standardCard === "camera") {
        const path = state?.attributes?.entity_picture || "";
        host.innerHTML = `<div class="beast-standard-camera"><div class="beast-standard-camera-frame">${path ? `<img data-ha-path="${escape(path)}" alt="${escape(label)}">` : BeastCore.icon("camera", { size: 34 })}</div><strong>${escape(label)}</strong></div>`;
        const image = host.querySelector("img[data-ha-path]"); if (image) BeastAuth.setAuthedImageSrc(image, image.dataset.haPath);
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
