// Shared direct editor for the built-in regions of the specialised views.
// Page modules provide selectors and sane default coordinates; this module
// owns draft/save/cancel, touch handles and the common settings sheet.
window.BeastNativePageEditor = (() => {
  const SUPPORTED = new Set(["rooms", "cameras", "music", "heating", "car", "pool", "waste", "weather"]);
  const instances = new Map();
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || min));
  const escape = (value) => { const el = document.createElement("span"); el.textContent = String(value ?? ""); return el.innerHTML; };

  function viewportWidth() {
    const widths = [window.innerWidth, document.documentElement?.clientWidth, document.querySelector(".beast-app")?.clientWidth]
      .map(Number).filter((value) => Number.isFinite(value) && value > 0);
    const measured = Math.max(0, ...widths);
    // During a kiosk refresh Chromium can briefly report a tiny/zero viewport.
    // Do not let that transient value select and persist the mobile layout.
    if (measured < 480 && Number(window.screen?.availWidth) >= 1180) return Number(window.screen.availWidth);
    return measured || Number(window.screen?.availWidth) || 1920;
  }
  function activeProfile() {
    const width = viewportWidth();
    if (width <= 820) return "mobile";
    if (width <= 1366) return "tablet";
    return "dashboard";
  }
  function profileSuffix(profile = activeProfile()) { return profile === "dashboard" ? "" : profile[0].toUpperCase() + profile.slice(1); }
  function storagePath(section, key = "nativeCards", profile = activeProfile()) { return `pageLayouts.${section}.${key}${profileSuffix(profile)}`; }
  function profileLabel(profile = activeProfile()) { return ({dashboard:"Dashboard",tablet:"Tablet",mobile:"Mobil"})[profile]; }

  function savedCards(section, defaults) {
    const saved = BeastConfig.get(storagePath(section));
    const dashboard = BeastConfig.get(storagePath(section, "nativeCards", "dashboard"));
    const source = Array.isArray(saved) && saved.length ? saved : (Array.isArray(dashboard) && dashboard.length ? dashboard : defaults);
    return defaults.map((fallback) => {
      const card = source.find((item) => item.id === fallback.id) || fallback;
      // Runtime controls belong to the current card definition. Older saved
      // layouts contain a snapshot of the former controls array and must not
      // hide controls introduced by a later dashboard update.
      return { ...fallback, ...card, controls: fallback.controls || [], desktop: { ...fallback.desktop, ...(card.desktop || {}) }, bindings: { ...(fallback.bindings || {}), ...(card.bindings || {}) } };
    });
  }

  function create(options) {
    const state = { ...options, editing: false, draft: null };
    const cards = () => savedCards(state.section, state.cards());
    const root = () => state.root();
    const host = () => state.host();
    const elementFor = (card) => root()?.querySelector(card.selector);

    function isAvailable(card) {
      if (card.enabled === false || !elementFor(card)) return false;
      return typeof card.available === "function" ? card.available() !== false : card.available !== false;
    }

    // Saved coordinates remain the user's source of truth. When a card is
    // unavailable at runtime (missing integration/entity, or deliberately
    // hidden), expand the remaining rectangles into the vacant grid cells
    // without writing those temporary coordinates back to configuration.
    // This keeps every specialised page composed and full instead of leaving
    // holes, while restoring the exact saved layout when the card returns.
    function adaptiveLayout(list) {
      const visible = list.filter(isAvailable).map((card) => ({ ...card, desktop:{ ...(card.desktop || {}) } }));
      const configured = list.filter((card) => card.enabled !== false);
      if (!visible.length) return [];
      if (visible.length === list.length && list.every((card) => elementFor(card))) return list;
      if (visible.length === 1) {
        visible[0].desktop = { ...visible[0].desktop, x:1, y:1, w:12, h:Math.max(12, clamp(visible[0].desktop.h,1,24)) };
        return visible;
      }
      const totalRows = Math.max(12, ...configured.map((card) => clamp(card.desktop?.y,1,40) + clamp(card.desktop?.h,1,24) - 1));
      const occupied = () => {
        const cells = new Set();
        visible.forEach((card) => {
          const d = card.desktop;
          for (let y=d.y; y<d.y+d.h; y++) for (let x=d.x; x<d.x+d.w; x++) cells.add(`${x}:${y}`);
        });
        return cells;
      };
      const canGrow = (card, direction, cells) => {
        const d = card.desktop;
        const targets = [];
        if (direction === "left" && d.x > 1) for (let y=d.y; y<d.y+d.h; y++) targets.push(`${d.x-1}:${y}`);
        if (direction === "right" && d.x+d.w-1 < 12) for (let y=d.y; y<d.y+d.h; y++) targets.push(`${d.x+d.w}:${y}`);
        if (direction === "up" && d.y > 1) for (let x=d.x; x<d.x+d.w; x++) targets.push(`${x}:${d.y-1}`);
        if (direction === "down" && d.y+d.h-1 < totalRows) for (let x=d.x; x<d.x+d.w; x++) targets.push(`${x}:${d.y+d.h}`);
        return targets.length && targets.every((key) => !cells.has(key));
      };
      const grow = (card, direction) => {
        if (direction === "left") { card.desktop.x--; card.desktop.w++; }
        if (direction === "right") card.desktop.w++;
        if (direction === "up") { card.desktop.y--; card.desktop.h++; }
        if (direction === "down") card.desktop.h++;
      };
      let changed = true, guard = 0;
      while (changed && guard++ < 80) {
        changed = false;
        ["left","right","up","down"].forEach((direction) => visible.forEach((card) => {
          const cells = occupied();
          if (canGrow(card,direction,cells)) { grow(card,direction); changed = true; }
        }));
      }
      return visible;
    }

    function packed(list) {
      let x = 1, y = 1, rowHeight = 0;
      return list.map((card) => {
        if (card.enabled === false) return card;
        const w = clamp(card.desktop?.w, 1, 12), h = clamp(card.desktop?.h, 1, 24);
        if (x + w - 1 > 12) { x = 1; y += rowHeight; rowHeight = 0; }
        const next = { ...card, desktop: { ...(card.desktop || {}), x, y, w, h } };
        x += w; rowHeight = Math.max(rowHeight, h);
        if (x > 12) { x = 1; y += rowHeight; rowHeight = 0; }
        return next;
      });
    }

    function applyRowFit(list, force = false) {
      const layoutHost = host(); if (!layoutHost) return;
      const enabled = list.filter((card) => card.enabled !== false);
      const rows = enabled.reduce((max, card) => Math.max(max, (Number(card.desktop?.y) || 1) + (Number(card.desktop?.h) || 1) - 1), 1);
      const gap = parseFloat(getComputedStyle(layoutHost).gap) || 16;
      const section = root()?.closest?.(".beast-section") || root();
      const available = Math.max(360, section?.clientHeight || window.innerHeight);
      // Keep one gap of breathing room because the section's flex height can
      // settle a few pixels after the first mount (fonts and the rail finish
      // measuring asynchronously in Chromium).
      const fitBudget = available - Math.max(12, gap);
      // Do not derive this from scrollHeight: scrollHeight itself changes when
      // the row changes and creates a shrink-on-every-render feedback loop.
      const row = clamp(Math.floor((fitBudget - gap * Math.max(0, rows - 1)) / rows), 32, 72);
      // The built-in composition must always fit the visible panel. The saved
      // auto-fit flag controls packing/order, not whether fixed 72px rows are
      // allowed to push standard cards below the screen.
      const nextRow = `${row}px`;
      layoutHost.style.setProperty("--native-total-rows", String(rows));
      if (layoutHost.style.getPropertyValue("--native-row-height") !== nextRow) layoutHost.style.setProperty("--native-row-height", nextRow);
    }

    function apply(list = cards()) {
      const layoutHost = host();
      if (!layoutHost) return;
      const fitted = BeastConfig.get(storagePath(state.section, "nativeAutoFit")) === true;
      root()?.classList.toggle("is-responsive-fitted", fitted);
      root()?.closest?.(".beast-section")?.classList.toggle("is-responsive-fitted", fitted);
      layoutHost.classList.add("beast-native-layout-grid");
      const runtimeList = state.editing ? list : adaptiveLayout(list);
      applyRowFit(runtimeList);
      list.forEach((card) => {
        const element = elementFor(card); if (!element) return;
        const runtimeCard = runtimeList.find((item) => item.id === card.id);
        const d = runtimeCard?.desktop || card.desktop || {};
        element.dataset.beastNativeCard = card.id;
        element.classList.add("beast-native-layout-card");
        element.style.setProperty("--native-x", clamp(d.x, 1, 12));
        element.style.setProperty("--native-y", clamp(d.y, 1, 40));
        element.style.setProperty("--native-w", clamp(d.w, 1, 12));
        element.style.setProperty("--native-h", clamp(d.h, 1, 24));
        element.classList.toggle("is-layout-hidden", !runtimeCard);
        const title = card.titleSelector ? element.querySelector(card.titleSelector) : null;
        if (title && card.label) title.textContent = card.label;
      });
      const extra = layoutHost.querySelector(":scope > .beast-page-editor-host");
      if (extra) {
        const lastRow = runtimeList.reduce((max, card) => Math.max(max, (Number(card.desktop?.y) || 1) + (Number(card.desktop?.h) || 1)), 1);
        extra.style.gridColumn = "1 / -1"; extra.style.gridRow = `${lastRow} / auto`;
      }
    }

    async function fit(save = true) {
      const source = copy(state.editing && state.draft ? state.draft : cards());
      const fitted = packed(state.fitCards?.(source) || source);
      if (state.editing) state.draft = fitted;
      if (save) {
        await BeastConfig.set(storagePath(state.section), fitted);
        await BeastConfig.set(storagePath(state.section, "nativeAutoFit"), true);
      }
      apply(fitted); applyRowFit(fitted, true);
      root()?.classList.add("is-responsive-fitted");
      root()?.closest?.(".beast-section")?.classList.add("is-responsive-fitted");
      state.onSave?.(copy(fitted));
      return fitted;
    }

    async function reset() {
      await BeastConfig.set(storagePath(state.section), null);
      await BeastConfig.set(storagePath(state.section, "nativeAutoFit"), false);
      cleanup();
      apply(cards());
      state.onSave?.(copy(cards()));
      return cards();
    }

    function cleanup() {
      root()?.classList.remove("is-native-page-editing");
      root()?.querySelectorAll(".beast-native-card-drag,.beast-native-card-resize").forEach((control) => control.remove());
      document.getElementById("beastNativePageEditBar")?.remove();
      window.beastCardEditorActive = false;
      state.editing = false;
      state.draft = null;
    }

    function finish(save) {
      if (!state.editing) return;
      if (save && state.draft) {
        BeastConfig.set(storagePath(state.section), state.draft);
        state.onSave?.(copy(state.draft));
      }
      cleanup();
      apply();
      state.onFinish?.(save);
    }

    function wireCard(element, card) {
      const drag = document.createElement("button");
      drag.type = "button"; drag.className = "beast-native-card-drag"; drag.setAttribute("aria-label", `Flyt ${card.label}`); drag.innerHTML = BeastCore.icon("grip", { size: 19 });
      const resize = document.createElement("span"); resize.className = "beast-native-card-resize"; resize.setAttribute("aria-hidden", "true");
      element.append(drag, resize);
      let dragging = null, lastTarget = "";
      drag.addEventListener("pointerdown", (event) => { event.preventDefault(); event.stopPropagation(); dragging = event.pointerId; lastTarget = ""; drag.setPointerCapture?.(event.pointerId); element.classList.add("is-dragging"); });
      drag.addEventListener("pointermove", (event) => {
        if (event.pointerId !== dragging) return;
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".beast-native-layout-card");
        if (!target || target === element || target.dataset.beastNativeCard === lastTarget) return;
        const other = state.draft.find((item) => item.id === target.dataset.beastNativeCard); if (!other) return;
        lastTarget = other.id;
        const own = { x: card.desktop.x, y: card.desktop.y };
        card.desktop = { ...card.desktop, x: other.desktop.x, y: other.desktop.y };
        other.desktop = { ...other.desktop, ...own };
        apply(state.draft);
      });
      const endDrag = (event) => { if (event.pointerId !== dragging) return; drag.releasePointerCapture?.(event.pointerId); dragging = null; lastTarget = ""; element.classList.remove("is-dragging"); };
      drag.addEventListener("pointerup", endDrag); drag.addEventListener("pointercancel", endDrag);
      let sizing = null;
      resize.addEventListener("pointerdown", (event) => {
        event.preventDefault(); event.stopPropagation();
        const layoutHost = host().getBoundingClientRect();
        sizing = { id: event.pointerId, x: event.clientX, y: event.clientY, w: card.desktop.w, h: card.desktop.h, col: layoutHost.width / 12, row: 72 };
        resize.setPointerCapture?.(event.pointerId); element.classList.add("is-resizing");
      });
      resize.addEventListener("pointermove", (event) => {
        if (!sizing || sizing.id !== event.pointerId) return;
        card.desktop = { ...card.desktop, w: clamp(Math.round(sizing.w + (event.clientX - sizing.x) / sizing.col), 1, 13 - card.desktop.x), h: clamp(Math.round(sizing.h + (event.clientY - sizing.y) / sizing.row), 1, 24) };
        apply(state.draft);
      });
      const endResize = (event) => { if (!sizing || sizing.id !== event.pointerId) return; resize.releasePointerCapture?.(event.pointerId); sizing = null; element.classList.remove("is-resizing"); };
      resize.addEventListener("pointerup", endResize); resize.addEventListener("pointercancel", endResize);
    }

    function settings() {
      document.getElementById("beastNativePageSettings")?.remove();
      const list = state.draft || cards();
      const overlay = document.createElement("div"); overlay.id = "beastNativePageSettings"; overlay.className = "beast-modal-overlay";
      const controlMarkup = (card, control) => {
        const value = card.options?.[control.key] ?? control.default ?? "";
        if (control.type === "action") return `<button type="button" class="beast-btn beast-native-option-action" data-native-action="${escape(control.key)}" data-native-action-card="${escape(card.id)}">${control.icon ? BeastCore.icon(control.icon,{size:18}) : ""}<span>${escape(control.label)}</span></button>`;
        if (control.type === "select") return `<label>${escape(control.label)}<select data-native-option="${escape(control.key)}">${(control.choices || []).map((choice) => `<option value="${escape(choice.value)}" ${String(choice.value) === String(value) ? "selected" : ""}>${escape(choice.label)}</option>`).join("")}</select></label>`;
        if (control.type === "checkbox") return `<label class="beast-native-option-check"><input type="checkbox" data-native-option="${escape(control.key)}" ${value ? "checked" : ""}><span>${escape(control.label)}</span></label>`;
        return `<label>${escape(control.label)}<input type="number" data-native-option="${escape(control.key)}" min="${Number(control.min)||1}" max="${Number(control.max)||50}" step="${Number(control.step)||1}" value="${escape(value)}"></label>`;
      };
      overlay.innerHTML = `<div class="beast-modal beast-native-settings-modal"><div class="beast-modal-header"><div><small>Indbyggede kort · ${profileLabel()}</small><h3>Rediger ${escape(state.label)}</h3></div><button type="button" class="beast-modal-close" data-close>×</button></div><div class="beast-modal-body"><p class="beast-responsive-profile-note">Ændringer gemmes kun til profilen <strong>${profileLabel()}</strong>. De andre skærmstørrelser beholder deres eget layout.</p><div class="beast-native-settings-list">${list.map((card) => `<article data-native-settings-card="${escape(card.id)}"><header><label><input type="checkbox" data-native-enabled ${card.enabled === false ? "" : "checked"}><strong>${escape(card.label)}</strong></label></header><div><label>Navn<input data-native-label value="${escape(card.label)}"></label><label>Venstre<select data-native-x>${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${Number(card.desktop.x)===i+1?"selected":""}>${i+1}</option>`).join("")}</select></label><label>Top<select data-native-y>${Array.from({length:24},(_,i)=>`<option value="${i+1}" ${Number(card.desktop.y)===i+1?"selected":""}>${i+1}</option>`).join("")}</select></label><label>Bredde<select data-native-w>${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${Number(card.desktop.w)===i+1?"selected":""}>${i+1}/12</option>`).join("")}</select></label><label>Højde<select data-native-h>${Array.from({length:16},(_,i)=>`<option value="${i+1}" ${Number(card.desktop.h)===i+1?"selected":""}>${i+1}</option>`).join("")}</select></label>${(card.controls || []).map((control)=>controlMarkup(card, control)).join("")}</div></article>`).join("")}</div><button type="button" class="beast-btn beast-btn-primary" data-native-settings-save>Anvend</button></div></div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay || event.target.closest("[data-close]")) return overlay.remove();
        const action = event.target.closest("[data-native-action]");
        if (action) {
          event.preventDefault();
          state.onSettingsAction?.(action.dataset.nativeAction, { cardId:action.dataset.nativeActionCard, overlay, list });
          return;
        }
        if (!event.target.closest("[data-native-settings-save]")) return;
        overlay.querySelectorAll("[data-native-settings-card]").forEach((row) => {
          const card = list.find((item) => item.id === row.dataset.nativeSettingsCard); if (!card) return;
          card.label = row.querySelector("[data-native-label]").value.trim() || card.label;
          card.enabled = row.querySelector("[data-native-enabled]").checked;
          card.desktop = { x:Number(row.querySelector("[data-native-x]").value), y:Number(row.querySelector("[data-native-y]").value), w:Number(row.querySelector("[data-native-w]").value), h:Number(row.querySelector("[data-native-h]").value) };
          card.options = { ...(card.options || {}) }; row.querySelectorAll("[data-native-option]").forEach((input) => {
            card.options[input.dataset.nativeOption] = input.type === "checkbox" ? input.checked : (input.type === "number" ? Number(input.value) : input.value);
          });
        });
        if (!state.editing) BeastConfig.set(storagePath(state.section), list);
        overlay.remove(); apply(list);
      });
    }

    function enter() {
      if (state.editing || !root() || !host()) return;
      state.editing = true; state.draft = copy(cards()); window.beastCardEditorActive = true;
      root().classList.add("is-native-page-editing"); apply(state.draft);
      state.draft.forEach((card) => { const element = elementFor(card); if (element && card.enabled !== false) wireCard(element, card); });
      const bar = document.createElement("div"); bar.id = "beastNativePageEditBar"; bar.className = "beast-ov-edit-bar";
      bar.innerHTML = `<div class="beast-editor-status"><i>${BeastCore.icon("grid",{size:19})}</i><span><small>Redigering</small><strong>Redigerer ${escape(state.label)}</strong></span></div><div class="beast-ov-edit-bar-actions"><button type="button" data-native-add>Tilføj kort</button><button type="button" data-native-settings>Indstillinger</button><button type="button" class="beast-edit-cancel" data-native-cancel>Annullér</button><button type="button" class="beast-btn beast-btn-primary beast-edit-save" data-native-save>Gem</button></div>`;
      document.body.appendChild(bar);
      bar.querySelector("[data-native-cancel]").addEventListener("click", () => finish(false));
      bar.querySelector("[data-native-save]").addEventListener("click", () => finish(true));
      bar.querySelector("[data-native-settings]").addEventListener("click", settings);
      bar.querySelector("[data-native-add]").addEventListener("click", () => {
        finish(true);
        window.BeastPageEditor?.openAdd?.(state.section);
      });
    }

    function mount() {
      apply();
      const trigger = root()?.querySelector(state.trigger);
      if (trigger) { trigger.onclick = (event) => { event.preventDefault(); event.stopImmediatePropagation(); enter(); }; trigger.dataset.nativeEditorWired = "true"; }
    }
    return { mount, enter, apply, settings, fit, reset };
  }

  function mount(options) {
    if (!SUPPORTED.has(options.section)) return;
    let instance = instances.get(options.section);
    if (!instance) { instance = create(options); instances.set(options.section, instance); }
    instance.mount();
    return instance;
  }
  let lastProfile = activeProfile();
  function syncProfile() {
    const next = activeProfile();
    const changed = next !== lastProfile;
    lastProfile = next;
    // Re-apply even when the named profile is unchanged. On kiosk refresh the
    // viewport often receives its final width after the cards were first
    // measured; a manual window resize used to be the only thing correcting it.
    instances.forEach((instance) => instance.apply());
    document.dispatchEvent(new CustomEvent("beast:layout-profile", { detail:{ profile:next, changed } }));
  }
  let resizeFrame = 0;
  function scheduleProfileSync() {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = window.requestAnimationFrame(syncProfile);
  }
  window.addEventListener("resize", scheduleProfileSync);
  let startupRefreshScheduled = false;
  function refreshAfterStartup() {
    if (startupRefreshScheduled) return;
    startupRefreshScheduled = true;
    // CSS establishes the responsive shell before first paint. One settled
    // measurement is enough; repeatedly dispatching synthetic resize events
    // made cards visibly jump after navigation and could restart chart/video
    // layout work several times.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      syncProfile();
      window.dispatchEvent(new CustomEvent("beast:viewport-ready", { detail:{ width:viewportWidth() } }));
    }));
  }
  window.addEventListener("pageshow", refreshAfterStartup);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", refreshAfterStartup, { once:true });
  else refreshAfterStartup();
  window.visualViewport?.addEventListener?.("resize", scheduleProfileSync);
  function option(section, cardId, key, fallback) {
    const current = BeastConfig.get(storagePath(section));
    const dashboard = BeastConfig.get(storagePath(section, "nativeCards", "dashboard"));
    const cards = Array.isArray(current) && current.length ? current : dashboard;
    const value = cards?.find?.((card) => card.id === cardId)?.options?.[key];
    return value === undefined ? fallback : value;
  }
  return { mount, supports: (section) => SUPPORTED.has(section), open: (section) => instances.get(section)?.enter(), fit: (section) => instances.get(section)?.fit(), reset: (section) => instances.get(section)?.reset(), activeProfile, profileLabel, storagePath, option };
})();
