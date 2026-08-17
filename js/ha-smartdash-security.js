(function () {
  const SECURITY_NATIVE_DEFAULTS = [
    { id: "security-hero", kind: "security-hero", label: "Samlet sikkerhedsstatus", enabled: true, desktop: { x: 1, y: 1, w: 5, h: 4 }, bindings: {} },
    { id: "security-systems", kind: "security-systems", label: "Alarmsystemer", enabled: true, desktop: { x: 6, y: 1, w: 7, h: 4 }, bindings: {} },
    { id: "security-entries", kind: "security-entries", label: "Indgange, låse og åbninger", enabled: true, desktop: { x: 1, y: 5, w: 12, h: 3 }, bindings: {}, options: { openingLimit: 10 } },
  ];
  let ENTRY_POINTS = [];
  let ALARM_PANELS = [];

  const ALARM_STATE_LABELS = {
    disarmed: "Fra",
    armed_home: "Hjemme",
    armed_away: "Ude",
    armed_night: "Nat",
    pending: "Afventer…",
    arming: "Tilkobler…",
    disarming: "Frakobler…",
    triggered: "ALARM!"
  };

  let containerEl = null;
  let pendingConfirm = null; // { entityId, action }
  let pendingTimerId = null;
  let nativeEditing = false;
  let nativeDraftCards = null;
  function securityCardsPath() { return window.BeastNativePageEditor?.storagePath?.("security") || "pageLayouts.security.nativeCards"; }

  function securityNativeCards() {
    const saved = BeastConfig.get(securityCardsPath());
    const cards = Array.isArray(saved) && saved.length ? saved : SECURITY_NATIVE_DEFAULTS;
    const byId = (id) => cards.find((card) => card.id === id || card.kind === id)?.desktop || {};
    const originalLayout = Number(byId("security-hero").x) === 1 && Number(byId("security-hero").y) === 1 && Number(byId("security-hero").w) === 5 && Number(byId("security-hero").h) === 6
      && Number(byId("security-systems").x) === 6 && Number(byId("security-systems").y) === 1 && Number(byId("security-systems").w) === 7 && Number(byId("security-systems").h) === 3
      && Number(byId("security-entries").x) === 6 && Number(byId("security-entries").y) === 4 && Number(byId("security-entries").w) === 7 && Number(byId("security-entries").h) === 3;
    const firstRedesign = Number(byId("security-hero").x) === 1 && Number(byId("security-hero").y) === 1 && Number(byId("security-hero").w) === 5 && Number(byId("security-hero").h) === 3
      && Number(byId("security-systems").x) === 6 && Number(byId("security-systems").y) === 1 && Number(byId("security-systems").w) === 7 && Number(byId("security-systems").h) === 3
      && Number(byId("security-entries").x) === 1 && Number(byId("security-entries").y) === 4 && Number(byId("security-entries").w) === 12 && Number(byId("security-entries").h) === 3;
    const legacyLayout = originalLayout || firstRedesign;
    return cards.map((card) => {
      const fallback = SECURITY_NATIVE_DEFAULTS.find((item) => item.id === card.id || item.kind === card.kind) || {};
      return { ...fallback, ...card, kind: card.kind || fallback.kind || card.id, bindings: { ...(fallback.bindings || {}), ...(card.bindings || {}) }, desktop: legacyLayout ? { ...(fallback.desktop || {}) } : { ...(fallback.desktop || {}), ...(card.desktop || {}) } };
    });
  }

  function securityNativeCard(kind) { return securityNativeCards().find((card) => card.kind === kind || card.id === kind); }

  function applyConfig() {
    const config = BeastConfig.get("panels.security") || {};
    const entryBindings = securityNativeCard("security-entries")?.bindings || {};
    const boundLocks = [1,2,3,4,5,6].map((index) => entryBindings[`lock${index}`]).filter(Boolean);
    const boundOpenings = [1,2,3,4,5,6].map((index) => entryBindings[`opening${index}`]).filter(Boolean);
    const locks = boundLocks.length ? boundLocks : (Array.isArray(config.locks) ? config.locks : []);
    const openings = boundOpenings.length ? boundOpenings : (Array.isArray(config.openingSensors) ? config.openingSensors : []);
    const length = Math.max(locks.length, openings.length);
    ENTRY_POINTS = Array.from({ length }, (_, index) => ({
      label: BeastEntityPicker.friendlyName(locks[index] || openings[index]),
      lockEntity: locks[index] || "", doorEntity: openings[index] || ""
    })).filter((entry) => entry.lockEntity || entry.doorEntity);
    const heroAlarm = securityNativeCard("security-hero")?.bindings?.alarm;
    const systemBindings = securityNativeCard("security-systems")?.bindings || {};
    const boundAlarms = [heroAlarm, ...[1,2,3,4,5,6].map((index) => systemBindings[`alarm${index}`])].filter(Boolean);
    const alarms = boundAlarms.length ? [...new Set(boundAlarms)] : (Array.isArray(config.alarmPanels) ? config.alarmPanels : []);
    ALARM_PANELS = alarms.map((entityId) => ({
      entityId, label: BeastEntityPicker.friendlyName(entityId), primary: entityId === (heroAlarm || config.primaryAlarm)
    }));
    if (ALARM_PANELS.length && !ALARM_PANELS.some((panel) => panel.primary)) ALARM_PANELS[0].primary = true;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function callService(domain, service, entityId, data = {}) {
    return BeastAuth.haFetch(`/api/services/${domain}/${service}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_id: entityId, ...data })
    }).catch((error) => {
      BeastCore.log(`Sikkerhed: kommando fejlede (${error.message}).`);
    });
  }

  function buildActionButton(entityId, action, label, isDisarm) {
    const isPending = pendingConfirm && pendingConfirm.entityId === entityId && pendingConfirm.action === action;
    const text = isPending ? "Bekræft?" : label;
    return `<button type="button" class="beast-security-action-btn${isDisarm ? " is-disarm" : ""}${isPending ? " is-confirming" : ""}" data-entity="${entityId}" data-action="${action}">${text}</button>`;
  }

  function buildSystemCard(panel) {
    const s = BeastHaSocket.getState(panel.entityId);
    const state = s ? s.state : "unknown";
    const label = ALARM_STATE_LABELS[state] || state;
    return `
      <div class="beast-security-system${state === "triggered" ? " is-triggered" : ""}">
        <div class="beast-security-card-head">
          <div class="beast-security-identity">
            <span class="beast-security-system-icon">${BeastCore.icon("shield", { size: 18 })}</span>
            <span><small>Sikkerhedssystem</small><strong>${escapeHtml(panel.label)}</strong></span>
          </div>
          <span class="beast-security-state-pill" data-state="${state}">${label}</span>
        </div>
        <div class="beast-security-system-actions">
          ${buildActionButton(panel.entityId, "alarm_disarm", "Fra", true)}
          ${buildActionButton(panel.entityId, "alarm_arm_home", "Hjemme")}
          ${buildActionButton(panel.entityId, "alarm_arm_away", "Ude")}
        </div>
      </div>
    `;
  }

  function buildEntryCard(entry) {
    const lockState = BeastHaSocket.getState(entry.lockEntity);
    const doorState = BeastHaSocket.getState(entry.doorEntity);
    const locked = lockState && lockState.state === "locked";
    const open = doorState && doorState.state === "on";

    return `
      <div class="beast-security-entry${open ? " is-open" : ""}${locked ? " is-locked" : ""}">
        <div class="beast-security-entry-icon">${BeastCore.icon(open ? "unlock" : "lock", { size: 24 })}</div>
        <div class="beast-security-entry-copy">
          <strong>${escapeHtml(entry.label)}</strong>
          <span>${open ? "Døren er åben" : "Døren er lukket"} · ${locked ? "låst" : "ulåst"}</span>
        </div>
        <span class="beast-security-entry-contact">${open ? "Åben" : "Lukket"}</span>
        <button type="button" class="beast-security-lock-btn${locked ? " is-on" : ""}" data-action="toggle-lock" data-entity="${entry.lockEntity}" data-locked="${locked}">
          ${BeastCore.icon(locked ? "lock" : "unlock", { size: 19 })}<span>${locked ? "Låst" : "Lås døren"}</span>
        </button>
      </div>
    `;
  }

  function getOpeningSensors() {
    const supported = new Set(["door", "window", "garage_door"]);
    const knownDoorIds = new Set(ENTRY_POINTS.map((entry) => entry.doorEntity));
    return Array.from(BeastHaSocket.getAllStates().values())
      .filter((entity) => entity?.entity_id?.startsWith("binary_sensor.") && (supported.has(entity.attributes?.device_class) || knownDoorIds.has(entity.entity_id)))
      .filter((entity) => !["unknown", "unavailable"].includes(entity.state))
      .map((entity) => ({
        id: entity.entity_id,
        label: entity.attributes?.friendly_name || entity.entity_id.split(".")[1].replaceAll("_", " "),
        type: entity.attributes?.device_class,
        open: entity.state === "on"
      }))
      .filter((entity) => entity.label.trim().toLocaleLowerCase("da-DK") !== "windows" && entity.id.split(".")[1].toLowerCase() !== "windows")
      .sort((a, b) => Number(b.open) - Number(a.open) || a.label.localeCompare(b.label, "da"));
  }

  function applySecurityNativeLayout(cardsOverride = null) {
    const command = containerEl?.querySelector(".beast-security-command"); if (!command) return;
    const selectors = { "security-hero": ".beast-security-hero", "security-systems": ".beast-security-systems", "security-entries": ".beast-security-entries" };
    command.classList.add("has-native-layout");
    const cards = cardsOverride || securityNativeCards();
    let runtimeCards = cards;
    if (!cardsOverride) {
      const visible = cards.filter((card) => card.enabled !== false && (
        card.kind === "security-entries" ? (ENTRY_POINTS.length || getOpeningSensors().length) : ALARM_PANELS.length
      )).map((card) => ({ ...card, desktop:{ ...(card.desktop || {}) } }));
      if (visible.length < cards.length) {
        const baseHeight = Math.max(1, Math.floor(7 / Math.max(1,visible.length)));
        let nextY = 1;
        visible.forEach((card,index) => {
          const height = index === visible.length - 1 ? 8 - nextY : baseHeight;
          card.desktop = { ...card.desktop, x:1, y:nextY, w:12, h:Math.max(1,height) };
          nextY += height;
        });
        runtimeCards = visible;
      }
    }
    cards.forEach((card) => {
      const element = command.querySelector(selectors[card.kind]); if (!element) return;
      const runtimeCard = runtimeCards.find((item) => item.id === card.id);
      const desktop = runtimeCard?.desktop || card.desktop;
      element.classList.add("beast-security-native-card");
      element.dataset.securityNativeCard = card.id;
      element.style.setProperty("--security-x", String(Math.max(1, Math.min(12, Number(desktop?.x) || 1))));
      element.style.setProperty("--security-y", String(Math.max(1, Number(desktop?.y) || 1)));
      element.style.setProperty("--security-w", String(Math.max(1, Math.min(12, Number(desktop?.w) || 12))));
      element.style.setProperty("--security-h", String(Math.max(1, Math.min(8, Number(desktop?.h) || 1))));
      element.classList.toggle("is-layout-hidden", !runtimeCard);
      const heading = element.querySelector(".beast-security-section-head strong"); if (heading && card.label) heading.textContent = card.label;
    });
  }

  function exitSecurityNativeEditor(save) {
    if (!nativeEditing) return;
    if (save && nativeDraftCards) BeastConfig.set(securityCardsPath(), nativeDraftCards);
    nativeEditing = false;
    nativeDraftCards = null;
    window.beastCardEditorActive = false;
    containerEl?.querySelector(".beast-security-command")?.classList.remove("is-native-editing");
    containerEl?.querySelectorAll(".beast-security-native-drag,.beast-security-native-resize").forEach((control) => control.remove());
    document.getElementById("beastSecurityNativeEditBar")?.remove();
    applySecurityNativeLayout(securityNativeCards());
    render();
  }

  function wireSecurityNativeCardEdit(element) {
    const card = nativeDraftCards?.find((item) => item.id === element.dataset.securityNativeCard); if (!card) return;
    const drag = document.createElement("span"); drag.className = "beast-security-native-drag"; drag.innerHTML = BeastCore.icon("grip", { size: 18 });
    const resize = document.createElement("span"); resize.className = "beast-security-native-resize";
    element.append(drag, resize);
    let dragging = null; let lastTargetId = null;
    drag.addEventListener("pointerdown", (event) => { event.preventDefault(); event.stopPropagation(); dragging = event.pointerId; lastTargetId = null; drag.setPointerCapture?.(event.pointerId); element.classList.add("is-dragging"); });
    drag.addEventListener("pointermove", (event) => {
      if (dragging !== event.pointerId) return;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".beast-security-native-card");
      if (!target || target === element) return;
      if (target.dataset.securityNativeCard === lastTargetId) return;
      const targetCard = nativeDraftCards.find((item) => item.id === target.dataset.securityNativeCard); if (!targetCard) return;
      lastTargetId = target.dataset.securityNativeCard;
      const position = { x: card.desktop?.x || 1, y: card.desktop?.y || 1 };
      card.desktop = { ...(card.desktop || {}), x: targetCard.desktop?.x || 1, y: targetCard.desktop?.y || 1 };
      targetCard.desktop = { ...(targetCard.desktop || {}), ...position };
      applySecurityNativeLayout(nativeDraftCards);
    });
    const finishDrag = (event) => { if (dragging !== event.pointerId) return; drag.releasePointerCapture?.(event.pointerId); element.classList.remove("is-dragging"); dragging = null; lastTargetId = null; };
    drag.addEventListener("pointerup", finishDrag); drag.addEventListener("pointercancel", finishDrag);
    let sizing = null;
    resize.addEventListener("pointerdown", (event) => {
      event.preventDefault(); event.stopPropagation(); const rect = element.getBoundingClientRect();
      sizing = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, w: Number(card.desktop?.w) || 6, h: Number(card.desktop?.h) || 3, col: rect.width / (Number(card.desktop?.w) || 6), row: rect.height / (Number(card.desktop?.h) || 3) };
      resize.setPointerCapture?.(event.pointerId); element.classList.add("is-resizing");
    });
    resize.addEventListener("pointermove", (event) => {
      if (!sizing || sizing.pointerId !== event.pointerId) return;
      const w = Math.max(2, Math.min(12, Math.round(sizing.w + (event.clientX - sizing.x) / sizing.col)));
      const h = Math.max(1, Math.min(8, Math.round(sizing.h + (event.clientY - sizing.y) / sizing.row)));
      card.desktop = { ...(card.desktop || {}), w, h };
      element.style.setProperty("--security-w", String(w)); element.style.setProperty("--security-h", String(h));
    });
    const finishResize = (event) => { if (!sizing || sizing.pointerId !== event.pointerId) return; resize.releasePointerCapture?.(event.pointerId); element.classList.remove("is-resizing"); sizing = null; };
    resize.addEventListener("pointerup", finishResize); resize.addEventListener("pointercancel", finishResize);
  }

  function enterSecurityNativeEditor() {
    if (nativeEditing || !containerEl) return;
    nativeEditing = true; window.beastCardEditorActive = true;
    nativeDraftCards = JSON.parse(JSON.stringify(securityNativeCards()));
    const command = containerEl.querySelector(".beast-security-command"); command?.classList.add("is-native-editing");
    applySecurityNativeLayout(nativeDraftCards);
    command?.querySelectorAll(":scope > .beast-security-native-card").forEach(wireSecurityNativeCardEdit);
    const bar = document.createElement("div"); bar.id = "beastSecurityNativeEditBar"; bar.className = "beast-ov-edit-bar";
    bar.innerHTML = `<div class="beast-editor-status"><i>${BeastCore.icon("shield", { size: 19 })}</i><span><small>Redigering</small><strong>Redigerer sikkerhedskort</strong></span></div><div class="beast-ov-edit-bar-actions"><button type="button" data-security-native-settings>Indstillinger</button><button type="button" class="beast-edit-cancel" data-security-native-cancel>Annullér</button><button type="button" class="beast-btn beast-btn-primary beast-edit-save" data-security-native-save>Gem</button></div>`;
    document.body.appendChild(bar);
    bar.querySelector("[data-security-native-cancel]").addEventListener("click", () => exitSecurityNativeEditor(false));
    bar.querySelector("[data-security-native-save]").addEventListener("click", () => exitSecurityNativeEditor(true));
    bar.querySelector("[data-security-native-settings]").addEventListener("click", () => { BeastConfig.set(securityCardsPath(), nativeDraftCards); exitSecurityNativeEditor(false); openSecurityLayoutEditor(); });
  }

  function render() {
    if (!containerEl) return;
    if (!ENTRY_POINTS.length && !ALARM_PANELS.length) {
      containerEl.innerHTML = BeastCore.notConfiguredMarkup("Sikkerhed", "Vælg alarmpanel, låse og/eller åbningssensorer i Administration for at aktivere dette panel.");
      BeastCore.wireNotConfiguredLinks(containerEl);
      return;
    }
    const primary = ALARM_PANELS.find((panel) => panel.primary) || null;
    const primaryState = primary ? (BeastHaSocket.getState(primary.entityId)?.state || "unknown") : "unknown";
    const alarmTriggered = ALARM_PANELS.some((panel) => BeastHaSocket.getState(panel.entityId)?.state === "triggered");
    const alarmArmed = primaryState.startsWith("armed");
    const entryStates = ENTRY_POINTS.map((entry) => ({
      ...entry,
      open: BeastHaSocket.getState(entry.doorEntity)?.state === "on",
      locked: BeastHaSocket.getState(entry.lockEntity)?.state === "locked"
    }));
    const unlockedCount = entryStates.filter((entry) => !entry.locked).length;
    const openingSensors = getOpeningSensors();
    const openSensors = openingSensors.filter((sensor) => sensor.open);
    const closedSensors = openingSensors.length - openSensors.length;
    const onlineSystems = ALARM_PANELS.filter((panel) => {
      const state = BeastHaSocket.getState(panel.entityId)?.state;
      return state && !["unknown", "unavailable"].includes(state);
    }).length;
    const headline = alarmTriggered ? "Alarm aktiveret" : alarmArmed && !openSensors.length ? "Huset er sikret" : openSensors.length || unlockedCount ? "Kræver opmærksomhed" : "Klar til tilkobling";
    const subline = alarmTriggered ? "Kontrollér huset med det samme" : `${openSensors.length} åbne døre eller vinduer · ${unlockedCount} ulåste · ${onlineSystems}/${ALARM_PANELS.length} systemer online`;
    containerEl.innerHTML = `
      <button type="button" class="beast-page-edit-trigger" id="beastSecurityLayoutEdit" aria-label="Rediger sikkerhedslayout">⋮</button><div class="beast-security-command${alarmTriggered ? " is-triggered" : ""}">
        <section class="beast-security-hero">
          <div class="beast-security-hero-top">
            <span class="beast-security-orbit">${BeastCore.icon("shield", { size: 42 })}</span>
            <div><small>Samlet sikkerhedsstatus</small><h2>${headline}</h2><p>${subline}</p></div>
            <span class="beast-security-state-pill" data-state="${primaryState}">${ALARM_STATE_LABELS[primaryState] || primaryState}</span>
          </div>
          <div class="beast-security-health">
            <div><span>${BeastCore.icon("lock", { size: 18 })}</span><b>${ENTRY_POINTS.length - unlockedCount}/${ENTRY_POINTS.length}</b><small>Døre låst</small></div>
            <div><span>${BeastCore.icon(openSensors.length ? "unlock" : "shield", { size: 18 })}</span><b>${openSensors.length}</b><small>Åbne lige nu</small></div>
            <div><span>${BeastCore.icon("shield", { size: 18 })}</span><b>${onlineSystems}/${ALARM_PANELS.length}</b><small>Systemer online</small></div>
          </div>
          <div class="beast-security-primary-actions">
            ${primary ? `
              ${buildActionButton(primary.entityId, "alarm_disarm", "Fra", true)}
              ${buildActionButton(primary.entityId, "alarm_arm_home", "Hjemme")}
              ${buildActionButton(primary.entityId, "alarm_arm_away", "Fuld tilkobling")}
            ` : ""}
          </div>
          <p class="beast-security-note">${BeastCore.icon("lock", { size: 15 })} Fuld tilkobling låser automatisk dashboardet</p>
        </section>
        <aside class="beast-security-systems">
          <div class="beast-security-section-head"><div><small>Integrationer</small><strong>Alarmsystemer</strong></div><span>${onlineSystems} online</span></div>
          ${ALARM_PANELS.filter((panel) => !panel.primary).map(buildSystemCard).join("")}
        </aside>
        <section class="beast-security-entries">
          <div class="beast-security-section-head">
            <div><small>Direkte styring</small><strong>Indgange og låse</strong></div>
            <button type="button" class="beast-security-lock-all" data-action="lock-all">${BeastCore.icon("lock", { size: 17 })} Lås alle</button>
          </div>
          <div class="beast-security-entry-grid">${ENTRY_POINTS.map(buildEntryCard).join("")}</div>
          <div class="beast-security-perimeter">
            <div class="beast-security-perimeter-summary">
              <span class="${openSensors.length ? "is-warning" : "is-safe"}">${BeastCore.icon(openSensors.length ? "unlock" : "shield", { size: 21 })}</span>
              <div><strong>${openSensors.length ? `${openSensors.length} åbne` : "Alle lukkede"}</strong><small>${openingSensors.length} dør- og vinduessensorer overvåges</small></div>
            </div>
            <div class="beast-security-opening-list">
              ${openSensors.length ? openSensors.slice(0, Number(securityNativeCard("security-entries")?.options?.openingLimit || 10)).map((sensor) => `
                <span class="beast-security-opening is-open">${BeastCore.icon(sensor.type === "window" ? "grid" : "unlock", { size: 15 })}${escapeHtml(sensor.label)}</span>
              `).join("") : `<span class="beast-security-opening is-closed">${BeastCore.icon("lock", { size: 15 })} Ingen åbne døre eller vinduer</span>`}
            </div>
          </div>
        </section>
      </div>
    `;
    const securityLayout = BeastConfig.get("pageLayouts.security.securityLayout") || {};
    const hiddenSections = new Set(Array.isArray(securityLayout.hidden) ? securityLayout.hidden : []);
    ["hero", "systems", "entries"].forEach((name) => {
      const element = containerEl.querySelector(`.beast-security-${name}`);
      if (element) element.classList.toggle("is-layout-hidden", hiddenSections.has(name));
    });
    applySecurityNativeLayout();
    containerEl.querySelector("#beastSecurityLayoutEdit")?.addEventListener("click", enterSecurityNativeEditor);

    containerEl.querySelectorAll("[data-action='toggle-lock']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const locked = btn.dataset.locked === "true";
        callService("lock", locked ? "unlock" : "lock", btn.dataset.entity).then(() => window.setTimeout(render, 300));
      });
    });

    containerEl.querySelectorAll(".beast-security-action-btn").forEach((btn) => {
      btn.addEventListener("click", () => handleAlarmAction(btn));
    });
    containerEl.querySelector("[data-action='lock-all']")?.addEventListener("click", () => {
      const targets = entryStates.filter((entry) => !entry.locked).map((entry) => entry.lockEntity);
      if (targets.length) callService("lock", "lock", targets).then(() => window.setTimeout(render, 400));
    });
  }

  function openSecurityLayoutEditor() {
    document.getElementById("beastSecurityLayoutEditor")?.remove();
    const current = BeastConfig.get("pageLayouts.security.securityLayout") || {};
    const hidden = new Set(Array.isArray(current.hidden) ? current.hidden : []);
    const legacyIds = { "security-hero": "hero", "security-systems": "systems", "security-entries": "entries" };
    const cards = securityNativeCards();
    const entities = BeastCardEditor.allEntities();
    const fields = {
      "security-hero": [["alarm","Primært alarmsystem"]],
      "security-systems": [["alarm1","Alarmsystem 1"],["alarm2","Alarmsystem 2"],["alarm3","Alarmsystem 3"],["alarm4","Alarmsystem 4"]],
      "security-entries": [["lock1","Lås 1"],["opening1","Åbning 1"],["lock2","Lås 2"],["opening2","Åbning 2"],["lock3","Lås 3"],["opening3","Åbning 3"],["lock4","Lås 4"],["opening4","Åbning 4"]]
    };
    const rows = cards.map((card) => `<article class="beast-security-native-editor-card" data-security-settings-card="${escapeHtml(card.id)}"><header><label><input type="checkbox" data-security-enabled ${card.enabled !== false && !hidden.has(legacyIds[card.id]) ? "checked" : ""}><strong>${escapeHtml(card.label)}</strong></label></header><div><label>Navn<input data-security-label value="${escapeHtml(card.label)}"></label><label>Bredde<select data-security-width>${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${Number(card.desktop?.w)===i+1?"selected":""}>${i+1}/12</option>`).join("")}</select></label><label>Højde<select data-security-height>${Array.from({length:8},(_,i)=>`<option value="${i+1}" ${Number(card.desktop?.h)===i+1?"selected":""}>${i+1}</option>`).join("")}</select></label>${card.kind === "security-entries" ? `<label>Vis højst åbne sensorer<input type="number" min="1" max="30" data-security-opening-limit value="${Number(card.options?.openingLimit || 10)}"></label>` : ""}${(fields[card.kind]||[]).map(([key,label])=>`<label>${label}<input type="search" list="beastSecurityEntityList" data-security-binding="${key}" value="${escapeHtml(card.bindings?.[key]||"")}" placeholder="Brug serverstandard"></label>`).join("")}</div></article>`).join("");
    const overlay = document.createElement("div"); overlay.id = "beastSecurityLayoutEditor"; overlay.className = "beast-modal-overlay";
    overlay.innerHTML = `<div class="beast-modal beast-security-layout-modal" role="dialog" aria-modal="true"><div class="beast-modal-header"><div><small>Native sikkerhedskort</small><h3>Navne og entities</h3></div><button type="button" class="beast-modal-close" data-close>×</button></div><div class="beast-modal-body"><p class="beast-page-editor-hint">Tomme entityfelter bruger serverens sikkerhedskonfiguration. Ingen alarmkommandoer sendes herfra.</p><datalist id="beastSecurityEntityList">${entities.map((entity)=>`<option value="${escapeHtml(entity.id)}">${escapeHtml(entity.name)}</option>`).join("")}</datalist><div class="beast-security-layout-list">${rows}</div><button type="button" class="beast-btn beast-btn-primary" data-security-layout-save>Gem indstillinger</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) return overlay.remove();
      if (!event.target.closest("[data-security-layout-save]")) return;
      const nextCards = Array.from(overlay.querySelectorAll("[data-security-settings-card]")).map((row) => { const card = cards.find((item)=>item.id===row.dataset.securitySettingsCard); const bindings={}; row.querySelectorAll("[data-security-binding]").forEach((input)=>{if(input.value.trim()) bindings[input.dataset.securityBinding]=input.value.trim();}); return {...card,label:row.querySelector("[data-security-label]").value.trim()||card.label,enabled:row.querySelector("[data-security-enabled]").checked,bindings,options:{...(card.options||{}),...(row.querySelector("[data-security-opening-limit]")?{openingLimit:Number(row.querySelector("[data-security-opening-limit]").value)||10}:{})},desktop:{...(card.desktop||{}),w:Number(row.querySelector("[data-security-width]").value),h:Number(row.querySelector("[data-security-height]").value)}}; });
      const nextHidden = nextCards.filter((card)=>!card.enabled).map((card)=>legacyIds[card.id]).filter(Boolean);
      BeastConfig.set(securityCardsPath(), nextCards);
      BeastConfig.set("pageLayouts.security.securityLayout", { ...current, hidden: nextHidden });
      applyConfig(); overlay.remove(); render();
    });
  }

  function handleAlarmAction(btn) {
    const entityId = btn.dataset.entity;
    const action = btn.dataset.action;
    const isPendingMatch = pendingConfirm && pendingConfirm.entityId === entityId && pendingConfirm.action === action;

    if (isPendingMatch) {
      window.clearTimeout(pendingTimerId);
      pendingConfirm = null;
      const execute = () => callService("alarm_control_panel", action, entityId)
        .then(() => window.setTimeout(render, 500));
      if (entityId === BeastConfig.get("panels.security.primaryAlarm") && action === "alarm_arm_away" && !BeastScreenLock.hasPin()) {
        BeastScreenLock.startSetPin((created) => { if (created) execute(); });
      } else {
        execute();
      }
      render();
      return;
    }

    pendingConfirm = { entityId, action };
    window.clearTimeout(pendingTimerId);
    pendingTimerId = window.setTimeout(() => { pendingConfirm = null; render(); }, 3000);
    render();
  }

  function init(root) {
    applyConfig();
    containerEl = root;
    containerEl.classList.add("beast-security-panel");
    containerEl.innerHTML = `<p class="beast-music-empty">Henter…</p>`;
    const stableRender = BeastCore.stableUpdater(containerEl, render, 350);

    BeastHaSocket.onStatusChange((status) => {
      if (status === "connected") render();
    });
    BeastHaSocket.subscribeDomain("alarm_control_panel", stableRender);
    BeastHaSocket.subscribeDomain("lock", stableRender);
    BeastHaSocket.subscribeDomain("binary_sensor", (entityId, newState) => {
      const openingClasses = new Set(["door", "window", "garage_door"]);
      if (ENTRY_POINTS.some((entry) => entry.doorEntity === entityId) || openingClasses.has(newState?.attributes?.device_class)) stableRender();
    });
  }

  BeastCore.registerPanel("security", "beastSecurityZone", init);
})();
