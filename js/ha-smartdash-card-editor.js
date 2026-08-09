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
  function attach(options) {
    const {
      zoneEl, configPath, cardTypes = [], singleInstanceTypes = [],
      renderCardMarkup, seedCards = () => [], onAfterRender = () => {},
      allEntities = () => [], editLabel = "Redigerer", renderEmptyState = null,
      entityPickerTypes = ["custom"], configureCard = null,
    } = options;
    const defaultCardSize = options.defaultCardSize || { desktop: { w: 3, h: 1 }, tablet: { w: 1, h: 1 }, portrait: { h: 1 } };

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
        card.appendChild(remove);
        if (configureCard) {
          const configure = document.createElement("button");
          configure.type = "button";
          configure.className = "beast-ov-card-configure";
          configure.setAttribute("aria-label", "Indstil kort");
          configure.innerHTML = BeastCore.icon("settings", { size: 16 });
          card.appendChild(configure);
          configure.addEventListener("click", (event) => {
            event.stopPropagation();
            const current = draftCards?.find((item) => item.id === card.dataset.builderCard);
            if (!current) return;
            configureCard(JSON.parse(JSON.stringify(current)), (updatedCard) => {
              if (!updatedCard) return;
              const index = draftCards.findIndex((item) => item.id === current.id);
              if (index < 0) return;
              rememberDraft();
              draftCards[index] = { ...draftCards[index], ...updatedCard, id: current.id };
              renderCardsDom(draftCards);
            });
          });
        }
        const duplicate = document.createElement("button");
        duplicate.type = "button";
        duplicate.className = "beast-ov-card-duplicate";
        duplicate.setAttribute("aria-label", "Dupliker kort");
        duplicate.innerHTML = BeastCore.icon("plus", { size: 15 });
        card.appendChild(duplicate);
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
          syncDraftCardOrderFromDom();
        }
        drag = null;
      };
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
    }

    function syncDraftCardOrderFromDom() {
      if (!draftCards) return;
      const order = Array.from(zoneEl.querySelectorAll(":scope > .beast-ov-card:not(.beast-ov-card-add)")).map((el) => el.dataset.builderCard);
      draftCards.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
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
        const h = Math.max(1, Math.min(2, Math.round(resize.startH + dy / resize.rowPx)));
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
      const usedTypes = new Set((draftCards || []).map((card) => card.type));
      const overlay = document.createElement("div");
      overlay.id = "beastCardEditorAddModal";
      overlay.className = "beast-modal-overlay";
      const typeButtons = cardTypes
        .filter(([value]) => !singleInstanceTypes.includes(value) || !usedTypes.has(value))
        .map(([value, label]) => `<button type="button" data-add-card-type="${value}">${label}</button>`)
        .join("");
      overlay.innerHTML = `<div class="beast-modal beast-ov-add-card-modal" role="dialog" aria-modal="true">
        <div class="beast-modal-header"><div><h3>Tilføj kort</h3></div><button type="button" class="beast-modal-close" data-close>${BeastCore.icon("close", { size: 22 })}</button></div>
        <div class="beast-modal-body">
          <div class="beast-ov-add-card-types">${typeButtons}</div>
          <div class="beast-ov-add-card-entity" hidden>
            <input class="beast-ov-add-card-search" type="search" placeholder="Søg efter entity…">
            <select class="beast-ov-add-card-select" size="6"></select>
            <button type="button" class="beast-btn beast-btn-primary" data-add-card-confirm>Tilføj</button>
          </div>
        </div>
      </div>`;
      document.body.appendChild(overlay);
      const close = () => overlay.remove();
      const newCard = (type, entity) => ({ id: `card_${Date.now()}`, type, label: "", entity: entity || null, desktop: { ...defaultCardSize.desktop }, tablet: { ...defaultCardSize.tablet }, portrait: { ...defaultCardSize.portrait } });
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay || event.target.closest("[data-close]")) { close(); return; }
        const typeButton = event.target.closest("[data-add-card-type]");
        if (typeButton) {
          const type = typeButton.dataset.addCardType;
          if (!entityPickerTypes.includes(type)) {
            rememberDraft();
            draftCards.push(newCard(type));
            close();
            renderCardsDom(draftCards);
            return;
          }
          overlay.dataset.pendingEntityType = type;
          overlay.querySelector(".beast-ov-add-card-types").hidden = true;
          const entityPane = overlay.querySelector(".beast-ov-add-card-entity");
          entityPane.hidden = false;
          const entities = allEntities(type);
          const select = overlay.querySelector(".beast-ov-add-card-select");
          select.innerHTML = entities.map((entity) => `<option value="${entity.id}">${entity.name}</option>`).join("");
          overlay.querySelector(".beast-ov-add-card-search").addEventListener("input", (inputEvent) => {
            const query = inputEvent.target.value.trim().toLowerCase();
            select.innerHTML = entities
              .filter((entity) => !query || entity.name.toLowerCase().includes(query) || entity.id.toLowerCase().includes(query))
              .map((entity) => `<option value="${entity.id}">${entity.name}</option>`).join("");
          });
          return;
        }
        if (event.target.closest("[data-add-card-confirm]")) {
          const select = overlay.querySelector(".beast-ov-add-card-select");
          const entity = select?.value;
          if (!entity) return;
          rememberDraft();
          draftCards.push(newCard(overlay.dataset.pendingEntityType || "custom", entity));
          close();
          renderCardsDom(draftCards);
        }
      });
    }

    function renderEditBar() {
      document.getElementById("beastCardEditorBar")?.remove();
      const bar = document.createElement("div");
      bar.id = "beastCardEditorBar";
      bar.className = "beast-ov-edit-bar";
      bar.innerHTML = `<span>${BeastCore.icon("grid", { size: 16 })}${editLabel}</span><div class="beast-ov-edit-bar-actions"><button type="button" data-ov-edit-undo ${history.length ? "" : "disabled"}>Fortryd</button><button type="button" data-ov-edit-reset>Nulstil</button><button type="button" data-ov-edit-clear>Ryd egne kort</button><button type="button" data-ov-edit-export>Eksportér</button><button type="button" data-ov-edit-import>Importér</button><button type="button" data-ov-edit-cancel>Annullér</button><button type="button" class="beast-btn beast-btn-primary" data-ov-edit-save>Gem</button></div>`;
      document.body.appendChild(bar);
      bar.querySelector("[data-ov-edit-cancel]").addEventListener("click", () => exit(false));
      bar.querySelector("[data-ov-edit-save]").addEventListener("click", () => exit(true));
      bar.querySelector("[data-ov-edit-undo]").addEventListener("click", () => {
        const previous = history.pop();
        if (!previous) return;
        draftCards = previous;
        renderCardsDom(draftCards);
        renderEditBar();
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
      const existing = BeastConfig.get(configPath) || [];
      draftCards = existing.length ? JSON.parse(JSON.stringify(existing)) : seedCards();
      originalCards = JSON.parse(JSON.stringify(draftCards));
      history = [];
      renderEditBar();
      renderCardsDom(draftCards);
    }

    function exit(save) {
      const nextCards = save ? draftCards : (BeastConfig.get(configPath) || []);
      if (save) BeastConfig.set(configPath, draftCards);
      editing = false;
      window.beastCardEditorActive = false;
      draftCards = null;
      originalCards = null;
      history = [];
      document.getElementById("beastCardEditorBar")?.remove();
      if (!nextCards.length && renderEmptyState) {
        renderEmptyState();
        return;
      }
      renderCardsDom(nextCards);
    }

    return { enter, isEditing: () => editing };
  }

  // Shared default for the "custom" card type's entity picker -- every
  // HA entity, sorted by friendly name. Any page can pass this straight
  // in as its allEntities option instead of writing the same three lines.
  function allEntities() {
    return Array.from(BeastHaSocket.getAllStates().values())
      .map((state) => ({ id: state.entity_id, name: state.attributes?.friendly_name || state.entity_id }))
      .sort((a, b) => a.name.localeCompare(b.name, "da"));
  }

  return { attach, allEntities };
})();
