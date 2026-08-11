// Generic live "edit mode" for a page's card grid -- drag to reorder,
// drag-resize, add/remove cards, explicit Gem/Annullér so nothing saves
// from an accidental touch on a shared kiosk screen. Extracted from the
// front page's original (page-specific) implementation so every other
// tab that gets the same treatment shares one place to fix bugs in,
// instead of N copies drifting apart. See js/ha-smartdash-overview.js for
// the first caller and js/ha-smartdash-rooms.js for the second.
//
// Usage: BeastCardEditor.attach(options) returns { enter, isEditing },
// which the calling page wires to its own "Rediger ..." button -- this
// module never assumes how a page triggers edit mode, only what happens
// once it's active.
//
// options:
//   zoneEl            grid container element (cards are its direct children)
//   configPath        BeastConfig path holding the card array, e.g.
//                     "overviewCards" or "pageLayouts.rooms.cards"
//   cardTypes         [[value, label], ...] offered in "+ Tilføj kort"
//   singleInstanceTypes  subset of cardTypes' values limited to one
//                     instance at a time (omit for "no limit")
//   renderCardMarkup(card)  -> HTML string for one card (must produce a
//                     single root element carrying data-builder-card="id")
//   seedCards()       -> fallback card array when configPath is empty
//                     the first time edit mode opens (e.g. migrating a
//                     legacy non-card layout) -- optional, defaults to []
//   defaultCardSize   {desktop:{w,h}, tablet:{w,h}, portrait:{h}} used for
//                     newly-added cards -- optional, defaults to a 3x1
//   editLabel         text shown in the Gem/Annullér bar, e.g.
//                     "Redigerer forsiden" -- optional
//   onAfterRender(cards)  called after every DOM rebuild (add/remove/
//                     move/resize/enter/exit) so the page can repaint its
//                     own live content into the fresh card shells and
//                     rewire anything page-specific (camera menu, etc.)
//   allEntities()     -> [{id, name}, ...] for the entity-picker card
//                     types' entity picker -- optional, only needed if
//                     cardTypes includes one of entityPickerTypes
//   entityPickerTypes  subset of cardTypes' values that need an entity
//                     picked at add-time instead of being created
//                     immediately (e.g. "custom", "stat") -- optional,
//                     defaults to ["custom"]
//   renderEmptyState()  called instead of the normal card-array render
//                     ONLY when cancelling out of edit mode with zero
//                     saved cards -- for a page migrating from an older,
//                     non-card layout (e.g. the front page's legacy
//                     5-slot grid), so cancelling doesn't show a blank
//                     grid before anything's ever been saved. Optional;
//                     omit for pages with no such legacy format to fall
//                     back to.
//   configureCard(card, commit) optional page-specific card settings UI.
//                     When supplied, each card gets a settings button;
//                     call commit(updatedCard) to update the live draft.
window.BeastCardEditor = (function () {
  const SNAPSHOT_LIMIT = 8;
  const snapshotKey = (path) => `beast-card-layout-history:${path}`;

  function readSnapshots(path) {
    try { return JSON.parse(localStorage.getItem(snapshotKey(path)) || "[]"); }
    catch (_) { return []; }
  }

  function saveSnapshot(path, cards, reason = "Gemte layout") {
    if (!Array.isArray(cards)) return;
    const history = readSnapshots(path);
    const serialized = JSON.stringify(cards);
    if (history[0]?.serialized === serialized) return;
    history.unshift({ at: new Date().toISOString(), reason, serialized });
    try { localStorage.setItem(snapshotKey(path), JSON.stringify(history.slice(0, SNAPSHOT_LIMIT))); } catch (_) {}
  }

  function sectionFromPath(path) {
    const match = String(path || "").match(/^pageLayouts\.([^.]+)/);
    return match?.[1] || (path === "overviewCards" ? "overview" : "");
  }

  function entityScore(entity, section, domains = []) {
    const id = String(entity.id || "");
    const domain = id.split(".")[0];
    const haystack = `${entity.name || ""} ${id} ${entity.area || ""}`.toLowerCase();
    let score = 0;
    if (domains.includes(domain)) score += 80;
    if (section && haystack.includes(section.toLowerCase())) score += 35;
    if (entity.area && section && String(entity.area).toLowerCase().includes(section.toLowerCase())) score += 55;
    if (!["unknown", "unavailable"].includes(entity.state)) score += 8;
    return score;
  }

  function rankedEntities(list, section, domains = []) {
    return [...list].sort((a, b) => entityScore(b, section, domains) - entityScore(a, section, domains) || a.name.localeCompare(b.name, "da"));
  }

  const TEMPLATE_KEYWORDS = {
    "Vejr": ["weather","vejr","temperatur","temperature","humidity","fugt","pressure","tryk","wind","vind","rain","regn","precipitation","forecast","prognose","cloud","sky","visibility","sigt","uv","dew"],
    "Energi": ["energy","energi","power","effekt","forbrug","consumption","elpris","price","pris","tarif","cost","kwh","watt"],
    "Pool": ["pool","vandtemperatur","water temperature","pumpe","pump","runtime","driftstid"],
    "Bil": ["tesla","car","bil","battery","batteri","range","rækkevidde","charging","oplad","tyre","tire","dæktryk","pressure"],
    "3D Printer": ["printer","bambu","print","nozzle","dyse","bed","plade","filament","ams","layer","lag","remaining","resterende"],
    "Robotter": ["vacuum","roborock","roomba","worx","landroid","robot","battery","batteri","clean","rengør"],
    "Kalender": ["calendar","kalender","waste","affald","pickup","afhent","restaffald","madaffald"],
    "Rum": ["temperature","temperatur","humidity","fugt","presence","tilstede","light","lys"],
    "Varme": ["climate","varme","heat","temperature","temperatur","thermostat","termostat","dantherm","fremløb","retur","co2"],
    "Sikkerhed": ["alarm","lock","lås","door","dør","window","vindue","opening","åbning","contact","kontakt"],
    "Musik": ["media_player","speaker","højtaler","sonos","music","musik"]
  };

  function relevantEntitiesForTemplate(entities, template) {
    const domains = template?.domains || [];
    const domainAllowed = entities.filter((entity) => !domains.length || domains.includes(String(entity.id || "").split(".")[0]));
    if (!template || template.id === "custom-entity" || !TEMPLATE_KEYWORDS[template.category]) return domainAllowed;
    const keywords = TEMPLATE_KEYWORDS[template.category];
    return domainAllowed.filter((entity) => {
      const domain = String(entity.id || "").split(".")[0];
      // Dedicated HA domains are already meaningful; the semantic filter is
      // primarily needed to stop every generic sensor appearing at once.
      if (domain !== "sensor" && domain !== "binary_sensor") return true;
      const haystack = `${entity.name || ""} ${entity.id || ""} ${entity.area || ""} ${entity.deviceClass || ""}`.toLowerCase();
      return keywords.some((keyword) => haystack.includes(keyword));
    });
  }

  function attach(options) {
    const {
      zoneEl, configPath, cardTypes = [], singleInstanceTypes = [],
      renderCardMarkup, seedCards = () => [], onAfterRender = () => {},
      allEntities = () => [], editLabel = "Redigerer", renderEmptyState = null,
      entityPickerTypes = ["custom"], configureCard = null,
    } = options;
    const defaultCardSize = options.defaultCardSize || { desktop: { w: 3, h: 1 }, tablet: { w: 1, h: 1 }, portrait: { h: 1 } };
    const editorSection = options.section || sectionFromPath(configPath);

    let editing = false;
    let draftCards = null;
    let originalCards = null;
    let history = [];

    function renderCardsDom(cards) {
      if (!zoneEl) return;
      const anchor = zoneEl.querySelector(":scope > [data-card-editor-anchor]");
      zoneEl.querySelectorAll(":scope > .beast-ov-card, :scope > .beast-ov-card-add").forEach((el) => el.remove());
      zoneEl.classList.toggle("is-freeform", cards.length > 0);
      zoneEl.classList.toggle("is-editing", editing);
      const wrap = document.createElement("div");
      wrap.innerHTML = cards.map((card) => renderCardMarkup(card)).join("");
      Array.from(wrap.children).forEach((el) => zoneEl.insertBefore(el, anchor));
      onAfterRender(cards);
      if (editing) {
        renderAddCardTile(anchor);
        applyEditModeChrome();
      }
    }

    function rememberDraft() {
      if (draftCards) history.push(JSON.parse(JSON.stringify(draftCards)));
    }

    function configureBasicCard(card, commit) {
      const overlay = document.createElement("div");
      overlay.className = "beast-modal-overlay";
      const entities = allEntities(card.type) || [];
      const template = window.BeastCardTemplates?.get?.(card.templateId);
      const fields = template?.fields?.length ? template.fields : [{ key: "primary", label: "Entity", domains: [] }];
      const bindings = { ...(card.bindings || {}) };
      if (card.entity && !Object.values(bindings).includes(card.entity)) bindings[fields[0].key] = card.entity;
      const width = Math.max(1, Math.min(12, Number(card.desktop?.w) || 3));
      const height = Math.max(1, Math.min(12, Number(card.desktop?.h) || 1));
      const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
      const bindingFields = entities.length ? fields.map((field, index) => { const allowed = rankedEntities(entities.filter((entity) => !field.domains?.length || field.domains.includes(entity.id.split(".")[0])), editorSection, field.domains || []); const listId = `beastBinding_${Date.now()}_${index}`; return `<label class="beast-page-editor-field beast-card-binding-field">${safe(field.label)}${field.required ? "<b>Krævet</b>" : "<small>Valgfri</small>"}<input type="search" data-binding-key="${safe(field.key)}" data-binding-required="${field.required ? "true" : "false"}" list="${listId}" value="${safe(bindings[field.key] || "")}" placeholder="Søg eller vælg entity…"><datalist id="${listId}">${allowed.map((entity) => `<option value="${safe(entity.id)}">${safe(entity.name)}${entity.area ? ` · ${safe(entity.area)}` : ""}</option>`).join("")}</datalist></label>`; }).join("") : "";
      const actionFields = card.type === "toggle" ? `<div class="beast-page-editor-size-fields"><label class="beast-page-editor-field">Handling<select class="beast-basic-card-service"><option value="auto">Automatisk til/fra</option>${["toggle","turn_on","turn_off","lock","unlock","open_cover","close_cover"].map((service) => `<option value="${service}" ${card.action?.service === service ? "selected" : ""}>${service}</option>`).join("")}</select></label><label class="beast-page-editor-check"><input type="checkbox" class="beast-basic-card-confirm" ${card.action?.confirm ? "checked" : ""}> Kræv bekræftelse</label></div>` : "";
      const visibilityFields = `<details class="beast-card-advanced"><summary>Avanceret visning</summary><label class="beast-page-editor-field">Vis kun når entity<input class="beast-basic-visibility-entity" value="${safe(card.visibility?.entity || "")}" placeholder="Valgfrit"></label><label class="beast-page-editor-field">Har tilstand<input class="beast-basic-visibility-state" value="${safe(card.visibility?.state || "")}" placeholder="fx on, open eller playing"></label></details>`;
      overlay.innerHTML = `<div class="beast-modal beast-page-entity-modal" role="dialog" aria-modal="true"><div class="beast-modal-header"><div><small>${template ? safe(template.category) : "Genbrugt skabelon"}</small><h3>Rediger kort</h3></div><button type="button" class="beast-modal-close" data-close>${BeastCore.icon("close", { size: 22 })}</button></div><div class="beast-modal-body"><label class="beast-page-editor-field">Navn<input class="beast-basic-card-name" value="${safe(card.label || "")}"></label><label class="beast-page-editor-field">Ikon<input class="beast-basic-card-icon" value="${safe(card.icon || "grid")}"></label><div class="beast-page-editor-size-fields"><label class="beast-page-editor-field">Bredde<select class="beast-basic-card-width">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === width ? "selected" : ""}>${i + 1} / 12</option>`).join("")}</select></label><label class="beast-page-editor-field">Højde<select class="beast-basic-card-height">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === height ? "selected" : ""}>${i + 1} række${i ? "r" : ""}</option>`).join("")}</select></label></div>${bindingFields}${actionFields}${visibilityFields}<button type="button" class="beast-btn beast-btn-primary" data-basic-save>Gem ændringer</button></div></div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay || event.target.closest("[data-close]")) return overlay.remove();
        if (!event.target.closest("[data-basic-save]")) return;
        const nextBindings = {}; overlay.querySelectorAll("[data-binding-key]").forEach((input) => { if (input.value.trim()) nextBindings[input.dataset.bindingKey] = input.value.trim(); });
        const missingRequired = Array.from(overlay.querySelectorAll('[data-binding-required="true"]')).filter((input) => !input.value.trim());
        overlay.querySelectorAll("[data-binding-key]").forEach((input) => input.removeAttribute("aria-invalid"));
        overlay.querySelector(".beast-card-binding-error")?.remove();
        if (missingRequired.length) {
          missingRequired.forEach((input) => input.setAttribute("aria-invalid", "true"));
          const message = document.createElement("p"); message.className = "beast-card-binding-error"; message.textContent = "Vælg de krævede entities før kortet gemmes.";
          overlay.querySelector("[data-basic-save]").before(message); missingRequired[0].focus(); return;
        }
        const visibilityEntity = overlay.querySelector(".beast-basic-visibility-entity")?.value.trim() || ""; const visibilityState = overlay.querySelector(".beast-basic-visibility-state")?.value.trim() || "";
        commit({ ...card, label: overlay.querySelector(".beast-basic-card-name")?.value.trim() || "", icon: overlay.querySelector(".beast-basic-card-icon")?.value.trim() || "grid", entity: nextBindings[fields[0].key] || card.entity || null, bindings: nextBindings, action: card.type === "toggle" ? { service: overlay.querySelector(".beast-basic-card-service")?.value || "auto", confirm: overlay.querySelector(".beast-basic-card-confirm")?.checked === true } : card.action, visibility: visibilityEntity ? { entity: visibilityEntity, state: visibilityState } : null, desktop: { ...(card.desktop || {}), w: Number(overlay.querySelector(".beast-basic-card-width")?.value) || width, h: Number(overlay.querySelector(".beast-basic-card-height")?.value) || height } });
        overlay.remove();
      });
    }

    // "+ Tilføj kort" -- not a real card, never part of draftCards, always
    // the last grid child while editing. Removed by renderCardsDom's own
    // cleanup selector the instant edit mode ends or the grid re-renders.
    function renderAddCardTile(anchor) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "beast-panel beast-ov-card beast-ov-card-add";
      tile.style.setProperty("--desktop-w", String(defaultCardSize.desktop?.w ?? 3));
      tile.style.setProperty("--desktop-h", String(defaultCardSize.desktop?.h ?? 1));
      tile.style.setProperty("--tablet-w", String(defaultCardSize.tablet?.w ?? 1));
      tile.style.setProperty("--tablet-h", String(defaultCardSize.tablet?.h ?? 1));
      tile.style.setProperty("--portrait-h", String(defaultCardSize.portrait?.h ?? 1));
      tile.innerHTML = `${BeastCore.icon("plus", { size: 26 })}<span>Tilføj kort</span>`;
      tile.addEventListener("click", (event) => { event.stopPropagation(); openAddCardModal(); });
      zoneEl.insertBefore(tile, anchor);
    }

    // Adds/removes the drag/resize/remove handles used only in edit mode --
    // kept out of renderCardMarkup() itself so normal (non-editing)
    // rendering never has to think about them.
    function applyEditModeChrome() {
      zoneEl.querySelectorAll(":scope > .beast-ov-card:not(.beast-ov-card-add)").forEach((card) => {
        card.querySelector(".beast-ov-card-drag")?.remove();
        card.querySelector(".beast-ov-card-resize")?.remove();
        card.querySelector(".beast-ov-card-remove")?.remove();
        card.querySelector(".beast-ov-card-configure")?.remove();
        card.querySelector(".beast-ov-card-duplicate")?.remove();
        card.querySelector(".beast-ov-card-reset")?.remove();
        card.querySelector(".beast-ov-card-tools")?.remove();
        const drag = document.createElement("span");
        drag.className = "beast-ov-card-drag";
        drag.setAttribute("aria-hidden", "true");
        drag.innerHTML = BeastCore.icon("grip", { size: 16 });
        card.appendChild(drag);
        const resize = document.createElement("span");
        resize.className = "beast-ov-card-resize";
        resize.setAttribute("aria-hidden", "true");
        card.appendChild(resize);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "beast-ov-card-remove";
        remove.setAttribute("aria-label", "Fjern kort");
        remove.innerHTML = BeastCore.icon("close", { size: 14 });
        const tools = document.createElement("div");
        tools.className = "beast-ov-card-tools";
        const configure = document.createElement("button");
        configure.type = "button";
        configure.className = "beast-ov-card-configure";
        configure.setAttribute("aria-label", "Indstil kort");
        configure.innerHTML = BeastCore.icon("settings", { size: 16 });
        tools.appendChild(configure);
        configure.addEventListener("click", (event) => {
          event.stopPropagation();
          const current = draftCards?.find((item) => item.id === card.dataset.builderCard);
          if (!current) return;
          const isStandard = window.BeastStandardCards?.isStandardType?.(current.type);
          const openSettings = configureCard && !isStandard ? configureCard : configureBasicCard;
          openSettings(JSON.parse(JSON.stringify(current)), (updatedCard) => {
            if (!updatedCard) return;
            const index = draftCards.findIndex((item) => item.id === current.id);
            if (index < 0) return;
            rememberDraft();
            draftCards[index] = { ...draftCards[index], ...updatedCard, id: current.id };
            renderCardsDom(draftCards);
          });
        });
        const duplicate = document.createElement("button");
        duplicate.type = "button";
        duplicate.className = "beast-ov-card-duplicate";
        duplicate.setAttribute("aria-label", "Dupliker kort");
        duplicate.innerHTML = BeastCore.icon("plus", { size: 15 });
        tools.appendChild(duplicate);
        duplicate.addEventListener("click", (event) => {
          event.stopPropagation();
          rememberDraft();
          const source = draftCards.find((item) => item.id === card.dataset.builderCard);
          if (!source) return;
          const clone = JSON.parse(JSON.stringify(source));
          clone.id = `card_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          clone.label = clone.label ? `${clone.label} kopi` : "";
          draftCards.push(clone);
          renderCardsDom(draftCards);
        });
        const reset = document.createElement("button");
        reset.type = "button"; reset.className = "beast-ov-card-reset"; reset.setAttribute("aria-label", "Nulstil kort"); reset.innerHTML = "↺"; tools.appendChild(reset);
        tools.appendChild(remove);
        card.appendChild(tools);
        reset.addEventListener("click", (event) => {
          event.stopPropagation(); const index = draftCards.findIndex((item) => item.id === card.dataset.builderCard); if (index < 0) return;
          const current = draftCards[index], template = window.BeastCardTemplates?.get?.(current.templateId); rememberDraft();
          draftCards[index] = { ...current, label: template?.title || current.label || "", icon: template?.icon || current.icon || "grid", entity: null, bindings: {}, action: null, visibility: null, desktop: { ...(current.desktop || {}), ...(template?.size || {}) } };
          renderCardsDom(draftCards);
        });
        wireCardDrag(card, drag);
        wireCardResize(card, resize);
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          const id = card.dataset.builderCard;
          rememberDraft();
          draftCards = draftCards.filter((c) => c.id !== id);
          renderCardsDom(draftCards);
        });
      });
    }

    // Drag-to-reorder moves the card's own existing DOM node via
    // insertBefore rather than re-rendering on every pointermove -- a full
    // renderCardsDom() rebuild would destroy and recreate the drag handle
    // mid-gesture, which silently ends the pointer capture and drops the
    // rest of the drag (this bit real: a periodic re-render elsewhere in
    // this app once did exactly that to an earlier, less careful version
    // of this same resize logic). The array order is only synced from the
    // final DOM order once, on release.
    function wireCardDrag(card, handle) {
      let drag = null;
      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        drag = { pointerId: event.pointerId, moved: false };
        handle.setPointerCapture?.(event.pointerId);
        card.classList.add("is-dragging");
      });
      handle.addEventListener("pointermove", (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag.moved = true;
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".beast-ov-card");
        if (!target || target === card || target.classList.contains("beast-ov-card-add") || !zoneEl.contains(target)) return;
        if (target.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING) {
          target.parentNode.insertBefore(card, target);
        } else {
          target.parentNode.insertBefore(card, target.nextSibling);
        }
      });
      const finish = (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        handle.releasePointerCapture?.(event.pointerId);
        card.classList.remove("is-dragging");
        if (drag.moved) {
          window.beastCardDraggedUntil = Date.now() + 400;
          syncDraftCardsFromDom();
        }
        drag = null;
      };
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
    }

    function syncDraftCardsFromDom() {
      if (!draftCards) return;
      const elements = Array.from(zoneEl.querySelectorAll(":scope > .beast-ov-card[data-builder-card]:not(.beast-ov-card-add)"));
      const byId = new Map(draftCards.map((card) => [card.id, card]));
      const ordered = elements.map((element, index) => {
        const card = byId.get(element.dataset.builderCard);
        if (!card) return null;
        const width = Number(element.style.getPropertyValue("--desktop-w"));
        const height = Number(element.style.getPropertyValue("--desktop-h"));
        if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
          card.desktop = { ...(card.desktop || {}), w: width, h: height };
        }
        card.order = index;
        byId.delete(card.id);
        return card;
      }).filter(Boolean);
      byId.forEach((card) => ordered.push(card));
      draftCards = ordered;
    }

    // Resize measures the card's OWN currently-rendered size divided by its
    // current column/row span to get an approximate pixels-per-unit, rather
    // than trying to parse the grid's minmax()-based track CSS (unreliable
    // across browsers via getComputedStyle) -- close enough for a live-feel
    // drag, exact values are whole numbers via Math.round either way.
    function wireCardResize(card, handle) {
      let resize = null;
      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const cardData = draftCards?.find((c) => c.id === card.dataset.builderCard);
        if (!cardData) return;
        const rect = card.getBoundingClientRect();
        const startW = Math.max(1, Number(cardData.desktop?.w) || 4);
        const startH = Math.max(1, Number(cardData.desktop?.h) || 1);
        resize = {
          pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
          startW, startH, colPx: rect.width / startW, rowPx: rect.height / startH, cardData
        };
        handle.setPointerCapture?.(event.pointerId);
        card.classList.add("is-resizing");
      });
      handle.addEventListener("pointermove", (event) => {
        if (!resize || event.pointerId !== resize.pointerId) return;
        const dx = event.clientX - resize.startX;
        const dy = event.clientY - resize.startY;
        const w = Math.max(1, Math.min(12, Math.round(resize.startW + dx / resize.colPx)));
        // Full-page views may contain cameras and graphs that need more than
        // the overview's original two rows.  Keep the drag bounded, but allow
        // enough vertical span for a real 16:9 camera card on a touch screen.
        const h = Math.max(1, Math.min(12, Math.round(resize.startH + dy / resize.rowPx)));
        card.style.setProperty("--desktop-w", w);
        card.style.setProperty("--desktop-h", h);
        resize.pendingW = w;
        resize.pendingH = h;
      });
      const finish = (event) => {
        if (!resize || event.pointerId !== resize.pointerId) return;
        handle.releasePointerCapture?.(event.pointerId);
        card.classList.remove("is-resizing");
        if (resize.pendingW !== undefined) {
          resize.cardData.desktop = { w: resize.pendingW, h: resize.pendingH };
          window.beastCardDraggedUntil = Date.now() + 400;
        }
        resize = null;
      };
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
    }

    function openAddCardModal() {
      document.getElementById("beastCardEditorAddModal")?.remove();
      const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
      const usedTypes = new Set((draftCards || []).map((card) => card.type));
      const availableTypes = cardTypes.map(([value]) => value);
      const galleryTemplates = window.BeastCardTemplates?.catalog(availableTypes) || [];
      // Page-specific cards (robot, printer cameras, print control, etc.) are
      // included beside the shared catalogue, but only on pages whose
      // renderer knows that type.
      cardTypes.forEach(([type, label]) => {
        if (galleryTemplates.some((item) => item.type === type) || BeastStandardCards?.isStandardType?.(type)) return;
        galleryTemplates.push({ id: `native-${type}`, category: "Specialkort", title: label, description: "Originalt funktionskort fra denne side", type, icon: "grid", domains: [], size: { ...defaultCardSize.desktop } });
      });
      const overlay = document.createElement("div");
      overlay.id = "beastCardEditorAddModal";
      overlay.className = "beast-modal-overlay";
      const usableTemplates = galleryTemplates.filter((item) => !singleInstanceTypes.includes(item.type) || !usedTypes.has(item.type));
      const categories = ["Alle", ...new Set(usableTemplates.map((item) => item.category))];
      const categoryCount = (category) => category === "Alle" ? usableTemplates.length : usableTemplates.filter((item) => item.category === category).length;
      const templateMarkup = usableTemplates.map((item) => {
        const fields = item.fields?.length ? item.fields : [{ label:"Valgfri entity", domains:item.domains || [] }];
        const fieldPreview = fields.slice(0, 3).map((field) => `<span>${safe(field.label || "Entity")}</span>`).join("");
        const moreFields = fields.length > 3 ? `<span>+${fields.length - 3}</span>` : "";
        return `<button type="button" class="beast-template-card" data-template-id="${safe(item.id)}" data-template-category="${safe(item.category)}">
          <span class="beast-template-card-icon">${BeastCore.icon(item.icon || "grid", { size: 28 })}</span>
          <span class="beast-template-card-copy"><span class="beast-template-card-title"><strong>${safe(item.title)}</strong><b>${safe(item.category)}</b></span><small>${safe(item.description)}</small><span class="beast-template-card-fields">${fieldPreview}${moreFields}</span><em><span>${fields.length} entityfelt${fields.length === 1 ? "" : "er"}</span><i>${item.size?.w || defaultCardSize.desktop.w}/12 bred · ${item.size?.h || defaultCardSize.desktop.h} række${Number(item.size?.h || defaultCardSize.desktop.h) === 1 ? "" : "r"}</i></em></span>
          <span class="beast-template-card-action">Vælg ${BeastCore.icon("chevron-right", { size: 16 })}</span>
        </button>`;
      }).join("");
      overlay.innerHTML = `<div class="beast-modal beast-ov-add-card-modal beast-template-gallery-modal" role="dialog" aria-modal="true">
        <div class="beast-modal-header"><div><small>Kortbibliotek · ${usableTemplates.length} skabeloner</small><h3>Hvilket kort vil du tilføje?</h3><p>Vælg en skabelon og forbind derefter de enheder, kortet skal bruge.</p></div><button type="button" class="beast-modal-close" data-close>${BeastCore.icon("close", { size: 22 })}</button></div>
        <div class="beast-modal-body">
          <input class="beast-template-search" type="search" placeholder="Søg efter kort…">
          <div class="beast-template-categories">${categories.map((category, index) => `<button type="button" data-template-filter="${category}" class="${index ? "" : "is-active"}"><span>${category}</span><small>${categoryCount(category)}</small></button>`).join("")}</div>
          <div class="beast-template-gallery">${templateMarkup || "<p>Ingen skabeloner er tilgængelige på denne side.</p>"}</div>
          <div class="beast-ov-add-card-entity" hidden>
            <button type="button" class="beast-template-back" data-template-back>← Tilbage til galleriet</button>
            <div class="beast-template-selected"></div>
            <div class="beast-template-entity-controls"><input class="beast-ov-add-card-search" type="search" placeholder="Søg efter entity…"><label class="beast-page-editor-check beast-template-all-entities"><input type="checkbox" data-template-all-entities> Vis alle entities (avanceret)</label><button type="button" class="beast-btn beast-btn-primary beast-template-confirm" data-add-card-confirm>${BeastCore.icon("plus", { size:19 })}<span>Tilføj kort</span></button></div>
            <select class="beast-ov-add-card-select" size="10"></select>
          </div>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      const close = () => overlay.remove();
      let pendingTemplate = null;
      const newCard = (type, entity, template = null) => {
        const desktop = { ...defaultCardSize.desktop, ...(template?.size || {}) };
        const tablet = { ...defaultCardSize.tablet };
        const portrait = { ...defaultCardSize.portrait };
        // A one-row camera is shorter than its 16:9 content in the auxiliary
        // page grids and consequently looks cropped before the user edits it.
        if (type === "camera") {
          desktop.h = Math.max(2, Number(desktop.h) || 1);
          tablet.h = Math.max(2, Number(tablet.h) || 1);
          portrait.h = Math.max(2, Number(portrait.h) || 1);
        }
        const firstField = template?.fields?.[0]?.key || "primary";
        return { id: `card_${Date.now()}`, type, templateId: template?.id || null, label: template?.title || "", icon: template?.icon || "grid", entity: entity || null, bindings: entity ? { [firstField]: entity } : {}, desktop, tablet, portrait };
      };
      const gallery = overlay.querySelector(".beast-template-gallery");
      const applyGalleryFilter = () => {
        const category = overlay.querySelector("[data-template-filter].is-active")?.dataset.templateFilter || "Alle";
        const query = overlay.querySelector(".beast-template-search")?.value.trim().toLowerCase() || "";
        gallery.querySelectorAll(".beast-template-card").forEach((button) => {
          const item = usableTemplates.find((candidate) => candidate.id === button.dataset.templateId);
          const haystack = `${item?.title || ""} ${item?.description || ""} ${item?.category || ""}`.toLowerCase();
          button.hidden = (category !== "Alle" && item?.category !== category) || (query && !haystack.includes(query));
        });
      };
      overlay.querySelector(".beast-template-search")?.addEventListener("input", applyGalleryFilter);
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay || event.target.closest("[data-close]")) { close(); return; }
        const filterButton = event.target.closest("[data-template-filter]");
        if (filterButton) {
          overlay.querySelectorAll("[data-template-filter]").forEach((button) => button.classList.toggle("is-active", button === filterButton));
          applyGalleryFilter();
          return;
        }
        if (event.target.closest("[data-template-back]")) {
          overlay.querySelector(".beast-ov-add-card-entity").hidden = true;
          overlay.querySelector(".beast-template-search").hidden = false;
          overlay.querySelector(".beast-template-categories").hidden = false;
          gallery.hidden = false;
          pendingTemplate = null;
          return;
        }
        const templateButton = event.target.closest("[data-template-id]");
        if (templateButton) {
          const template = usableTemplates.find((item) => item.id === templateButton.dataset.templateId);
          if (!template) return;
          const type = template.type;
          if (!entityPickerTypes.includes(type)) {
            rememberDraft();
            draftCards.push(newCard(type, null, template));
            close();
            renderCardsDom(draftCards);
            return;
          }
          pendingTemplate = template;
          overlay.querySelector(".beast-template-search").hidden = true;
          overlay.querySelector(".beast-template-categories").hidden = true;
          gallery.hidden = true;
          const entityPane = overlay.querySelector(".beast-ov-add-card-entity");
          entityPane.hidden = false;
          entityPane.querySelector(".beast-template-selected").innerHTML = `<span class="beast-template-card-icon">${BeastCore.icon(template.icon || "grid", { size: 25 })}</span><span><small>${template.category}</small><strong>${template.title}</strong><em>${template.description}</em><b>${template.fields?.filter((field)=>field.required).length || 1} krævet · ${template.fields?.length || 1} felter i alt</b></span>`;
          const allTemplateEntities = type === "camera" && window.BeastCameras?.getAllCameras
            ? BeastCameras.getAllCameras().map((camera) => ({ id: camera.entityId, name: camera.label }))
            : allEntities(type);
          const relevantEntities = relevantEntitiesForTemplate(allTemplateEntities, template);
          const select = overlay.querySelector(".beast-ov-add-card-select");
          const allToggle = overlay.querySelector("[data-template-all-entities]");
          allToggle.checked = false;
          const renderEntities = (query = "") => {
            const source = allToggle.checked ? allTemplateEntities : relevantEntities;
            const sorted = rankedEntities(source, editorSection, template.domains || []);
            select.innerHTML = sorted.filter((entity) => !query || entity.name.toLowerCase().includes(query) || entity.id.toLowerCase().includes(query) || String(entity.area || "").toLowerCase().includes(query)).map((entity) => `<option value="${entity.id}">${entity.name}${entity.area ? ` · ${entity.area}` : ""} · ${entity.id}</option>`).join("");
          };
          renderEntities();
          const search = overlay.querySelector(".beast-ov-add-card-search");
          search.value = "";
          search.oninput = (inputEvent) => {
            const query = inputEvent.target.value.trim().toLowerCase();
            renderEntities(query);
          };
          allToggle.onchange = () => renderEntities(search.value.trim().toLowerCase());
          search.focus();
          return;
        }
        if (event.target.closest("[data-add-card-confirm]")) {
          const select = overlay.querySelector(".beast-ov-add-card-select");
          const entity = select?.value;
          if (!entity) return;
          rememberDraft();
          const created = newCard(pendingTemplate?.type || "custom", entity, pendingTemplate);
          draftCards.push(created);
          close();
          renderCardsDom(draftCards);
          if (pendingTemplate?.fields?.length > 1) {
            window.setTimeout(() => configureBasicCard(JSON.parse(JSON.stringify(created)), (updatedCard) => {
              const index = draftCards.findIndex((item) => item.id === created.id); if (index < 0) return;
              rememberDraft(); draftCards[index] = { ...draftCards[index], ...updatedCard, id: created.id }; renderCardsDom(draftCards);
            }), 0);
          }
        }
      });
    }

    function renderEditBar() {
      document.getElementById("beastCardEditorBar")?.remove();
      const bar = document.createElement("div");
      bar.id = "beastCardEditorBar";
      bar.className = "beast-ov-edit-bar";
      const snapshots = readSnapshots(configPath);
      bar.innerHTML = `<div class="beast-editor-status"><i>${BeastCore.icon("grid", { size: 19 })}</i><span><small>Redigering</small><strong>${editLabel}</strong></span></div><div class="beast-ov-edit-bar-actions"><button type="button" data-ov-edit-add>Tilføj kort</button><button type="button" data-ov-edit-settings>Indstillinger</button><button type="button" class="beast-edit-cancel" data-ov-edit-cancel>Annullér</button><button type="button" class="beast-btn beast-btn-primary beast-edit-save" data-ov-edit-save>Gem</button></div><div class="beast-editor-hidden-actions" hidden><button type="button" data-ov-edit-undo ${history.length ? "" : "disabled"}>Fortryd</button><button type="button" data-ov-edit-restore ${snapshots.length ? "" : "disabled"}>Gendan</button><button type="button" data-ov-edit-reset>Nulstil</button><button type="button" data-ov-edit-clear>Ryd egne kort</button><button type="button" data-ov-edit-export>Eksportér</button><button type="button" data-ov-edit-import>Importér</button></div>`;
      document.body.appendChild(bar);
      bar.querySelector("[data-ov-edit-add]").addEventListener("click", openAddCardModal);
      bar.querySelector("[data-ov-edit-settings]").addEventListener("click", () => {
        document.getElementById("beastCardEditorTools")?.remove();
        const tools = document.createElement("div"); tools.id = "beastCardEditorTools"; tools.className = "beast-modal-overlay";
        tools.innerHTML = `<div class="beast-modal beast-card-editor-tools" role="dialog" aria-modal="true"><div class="beast-modal-header"><div><small>Redigeringsværktøjer</small><h3>Indstillinger</h3></div><button type="button" class="beast-modal-close" data-close>${BeastCore.icon("close", { size:22 })}</button></div><div class="beast-modal-body"><p class="beast-page-editor-hint">Navn, størrelse og entities ændres med indstillingsknappen på det enkelte kort.</p><div class="beast-card-editor-tools-grid"><button type="button" data-tool-action="undo" ${history.length ? "" : "disabled"}>${BeastCore.icon("backspace",{size:20})}<span><strong>Fortryd</strong><small>Gå ét trin tilbage</small></span></button><button type="button" data-tool-action="restore" ${snapshots.length ? "" : "disabled"}>${BeastCore.icon("calendar",{size:20})}<span><strong>Gendan</strong><small>Tidligere gemt layout</small></span></button><button type="button" data-tool-action="reset">${BeastCore.icon("grid",{size:20})}<span><strong>Nulstil ændringer</strong><small>Til layoutet før redigering</small></span></button><button type="button" data-tool-action="export">${BeastCore.icon("chevron-down",{size:20})}<span><strong>Eksportér</strong><small>Kopiér layout som JSON</small></span></button><button type="button" data-tool-action="import">${BeastCore.icon("chevron-up",{size:20})}<span><strong>Importér</strong><small>Indlæs et gemt layout</small></span></button><button type="button" class="is-danger" data-tool-action="clear">${BeastCore.icon("close",{size:20})}<span><strong>Ryd egne kort</strong><small>Fjern alle kort fra siden</small></span></button></div></div></div>`;
        document.body.appendChild(tools);
        const actionMap = { undo:"undo", restore:"restore", reset:"reset", export:"export", import:"import", clear:"clear" };
        tools.addEventListener("click", (event) => {
          if (event.target === tools || event.target.closest("[data-close]")) return tools.remove();
          const button = event.target.closest("[data-tool-action]"); if (!button || button.disabled) return;
          const action = actionMap[button.dataset.toolAction]; tools.remove(); bar.querySelector(`[data-ov-edit-${action}]`)?.click();
        });
      });
      bar.querySelector("[data-ov-edit-cancel]").addEventListener("click", () => exit(false));
      bar.querySelector("[data-ov-edit-save]").addEventListener("click", () => {
        // Remote desktop and touch browsers can lose the final pointerup
        // even after the DOM card was visibly moved. Read the rendered grid
        // again here so Save can never persist the stale pre-drag array.
        syncDraftCardsFromDom();
        exit(true);
      });
      bar.querySelector("[data-ov-edit-undo]").addEventListener("click", () => {
        const previous = history.pop();
        if (!previous) return;
        draftCards = previous;
        renderCardsDom(draftCards);
        renderEditBar();
      });
      bar.querySelector("[data-ov-edit-restore]").addEventListener("click", () => {
        const snapshots = readSnapshots(configPath); if (!snapshots.length) return;
        const overlay = document.createElement("div"); overlay.className = "beast-modal-overlay";
        overlay.innerHTML = `<div class="beast-modal beast-layout-history-modal"><div class="beast-modal-header"><div><small>Layout-historik</small><h3>Gendan tidligere layout</h3></div><button type="button" class="beast-modal-close" data-close>×</button></div><div class="beast-modal-body"><p class="beast-page-editor-hint">De seneste ${SNAPSHOT_LIMIT} gemte versioner ligger lokalt på denne skærm.</p><div class="beast-layout-history-list">${snapshots.map((item, index) => `<button type="button" data-restore-index="${index}"><strong>${new Date(item.at).toLocaleString(window.HASmartdashI18n?.locale || "da-DK")}</strong><small>${item.reason || "Gemte layout"}</small></button>`).join("")}</div></div></div>`;
        document.body.appendChild(overlay);
        overlay.addEventListener("click", (event) => { if (event.target === overlay || event.target.closest("[data-close]")) return overlay.remove(); const button = event.target.closest("[data-restore-index]"); if (!button) return; try { rememberDraft(); draftCards = JSON.parse(snapshots[Number(button.dataset.restoreIndex)].serialized); renderCardsDom(draftCards); renderEditBar(); overlay.remove(); } catch (_) { window.alert("Den valgte version kunne ikke gendannes."); } });
      });
      bar.querySelector("[data-ov-edit-reset]").addEventListener("click", () => {
        if (!window.confirm("Nulstil kortene på denne side til layoutet før redigering?")) return;
        history.push(JSON.parse(JSON.stringify(draftCards || [])));
        draftCards = JSON.parse(JSON.stringify(originalCards || []));
        renderCardsDom(draftCards);
        renderEditBar();
      });
      bar.querySelector("[data-ov-edit-clear]").addEventListener("click", () => {
        if (!draftCards?.length || !window.confirm("Fjern alle egne kort fra denne side?")) return;
        rememberDraft();
        draftCards = [];
        renderCardsDom(draftCards);
        renderEditBar();
      });
      bar.querySelector("[data-ov-edit-export]").addEventListener("click", async () => {
        const payload = JSON.stringify({ smartdash: "card-layout", version: 1, cards: draftCards || [] }, null, 2);
        try {
          await navigator.clipboard.writeText(payload);
          bar.querySelector("[data-ov-edit-export]").textContent = "Kopieret";
          window.setTimeout(() => renderEditBar(), 1000);
        } catch (error) {
          window.prompt("Kopiér layout-JSON:", payload);
        }
      });
      bar.querySelector("[data-ov-edit-import]").addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file"; input.accept = "application/json,.json";
        input.addEventListener("change", () => {
          const file = input.files?.[0]; if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            try {
              const parsed = JSON.parse(String(reader.result || ""));
              const cards = Array.isArray(parsed) ? parsed : parsed.cards;
              if (!Array.isArray(cards)) throw new Error("Ugyldigt layout");
              if (!cards.every((card) => card && typeof card === "object" && typeof card.id === "string")) throw new Error("Ugyldigt kortformat");
              rememberDraft();
              draftCards = cards.map((card) => ({ ...card, id: `card_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }));
              renderCardsDom(draftCards); renderEditBar();
            } catch (error) { window.alert("Layoutet kunne ikke importeres. Kontrollér JSON-filen."); }
          };
          reader.readAsText(file);
        });
        input.click();
      });
    }

    function enter() {
      if (editing) return;
      editing = true;
      window.beastCardEditorActive = true;
      // Reserve scrollable space for the fixed save/cancel bar. Without it,
      // the resize handle on the last card sits underneath the bar.
      zoneEl.closest(".beast-page-editor-scroll-host")?.classList.add("is-card-editing");
      const existing = BeastConfig.get(configPath) || [];
      draftCards = (existing.length ? JSON.parse(JSON.stringify(existing)) : seedCards()).map((card) => window.BeastCardTemplates?.normalizeCard?.(card) || card);
      originalCards = JSON.parse(JSON.stringify(draftCards));
      history = [];
      renderEditBar();
      renderCardsDom(draftCards);
    }

    function exit(save) {
      if (save) syncDraftCardsFromDom();
      const nextCards = save ? draftCards : (BeastConfig.get(configPath) || []);
      if (save) {
        saveSnapshot(configPath, BeastConfig.get(configPath) || [], "Før seneste gemning");
        BeastConfig.set(configPath, draftCards);
        // Distinguish "the user deliberately saved zero cards" from an old
        // config where the cards property did not exist yet. Array length is
        // not a valid migration signal: [] is a real user choice.
        if (/\.cards$/.test(configPath)) BeastConfig.set(configPath.replace(/\.cards$/, ".cardsConfigured"), true);
        saveSnapshot(configPath, draftCards, "Gemte layout");
      }
      editing = false;
      window.beastCardEditorActive = false;
      zoneEl.closest(".beast-page-editor-scroll-host")?.classList.remove("is-card-editing");
      draftCards = null;
      originalCards = null;
      history = [];
      document.getElementById("beastCardEditorBar")?.remove();
      if (!nextCards.length && renderEmptyState) {
        renderEmptyState();
        return;
      }
      renderCardsDom(nextCards.map((card) => window.BeastCardTemplates?.normalizeCard?.(card) || card));
    }

    const initialCards = (BeastConfig.get(configPath) || []).map((card) => window.BeastCardTemplates?.normalizeCard?.(card) || card);
    if (initialCards.length) renderCardsDom(initialCards);
    return {
      enter,
      openAdd: () => {
        enter();
        window.requestAnimationFrame(() => openAddCardModal());
      },
      isEditing: () => editing
    };
  }

  // Shared default for the "custom" card type's entity picker -- every
  // HA entity, sorted by friendly name. Any page can pass this straight
  // in as its allEntities option instead of writing the same three lines.
  function allEntities() {
    return Array.from(BeastHaSocket.getAllStates().values())
      .map((state) => ({ id: state.entity_id, name: state.attributes?.friendly_name || state.entity_id, area: state.attributes?.area_name || state.attributes?.area || "", deviceClass: state.attributes?.device_class || "", state: state.state }))
      .sort((a, b) => a.name.localeCompare(b.name, "da"));
  }

  return { attach, allEntities };
})();
