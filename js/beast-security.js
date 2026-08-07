(function () {
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

  function applyConfig() {
    const config = BeastConfig.get("panels.security") || {};
    const locks = Array.isArray(config.locks) ? config.locks : [];
    const openings = Array.isArray(config.openingSensors) ? config.openingSensors : [];
    const length = Math.max(locks.length, openings.length);
    ENTRY_POINTS = Array.from({ length }, (_, index) => ({
      label: BeastEntityPicker.friendlyName(locks[index] || openings[index]),
      lockEntity: locks[index] || "", doorEntity: openings[index] || ""
    })).filter((entry) => entry.lockEntity || entry.doorEntity);
    const alarms = Array.isArray(config.alarmPanels) ? config.alarmPanels : [];
    ALARM_PANELS = alarms.map((entityId) => ({
      entityId, label: BeastEntityPicker.friendlyName(entityId), primary: entityId === config.primaryAlarm
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

  function render() {
    if (!containerEl) return;
    const primary = ALARM_PANELS.find((panel) => panel.primary);
    const primaryState = BeastHaSocket.getState(primary.entityId)?.state || "unknown";
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
      <div class="beast-security-command${alarmTriggered ? " is-triggered" : ""}">
        <section class="beast-security-hero">
          <div class="beast-security-hero-top">
            <span class="beast-security-orbit">${BeastCore.icon("shield", { size: 42 })}</span>
            <div><small>Samlet sikkerhedsstatus</small><h2>${headline}</h2><p>${subline}</p></div>
            <span class="beast-security-state-pill" data-state="${primaryState}">${ALARM_STATE_LABELS[primaryState] || primaryState}</span>
          </div>
          <div class="beast-security-health">
            <div><span>${BeastCore.icon("lock", { size: 18 })}</span><b>${ENTRY_POINTS.length - unlockedCount}/${ENTRY_POINTS.length}</b><small>Døre låst</small></div>
            <div><span>${BeastCore.icon("home", { size: 18 })}</span><b>${closedSensors}/${openingSensors.length || "–"}</b><small>Åbninger lukket</small></div>
            <div><span>${BeastCore.icon("shield", { size: 18 })}</span><b>${onlineSystems}/${ALARM_PANELS.length}</b><small>Systemer online</small></div>
          </div>
          <div class="beast-security-primary-actions">
            ${buildActionButton(primary.entityId, "alarm_disarm", "Fra", true)}
            ${buildActionButton(primary.entityId, "alarm_arm_home", "Hjemme")}
            ${buildActionButton(primary.entityId, "alarm_arm_away", "Fuld tilkobling")}
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
              ${openSensors.length ? openSensors.slice(0, 10).map((sensor) => `
                <span class="beast-security-opening is-open">${BeastCore.icon(sensor.type === "window" ? "grid" : "unlock", { size: 15 })}${escapeHtml(sensor.label)}</span>
              `).join("") : `<span class="beast-security-opening is-closed">${BeastCore.icon("lock", { size: 15 })} Ingen åbne døre eller vinduer</span>`}
            </div>
          </div>
        </section>
      </div>
    `;

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
