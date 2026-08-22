(function () {
  const MQTT_CONFIG_KEY = "beast_mqtt_settings_v1";
  const MQTT_TARGETS = [
    { id: "zigbee2mqtt", label: "Zigbee2MQTT", prefix: "zigbee2mqtt" },
    { id: "kiosk_8400t", label: "8400T kiosk", prefix: "kiosk_8400t" },
    { id: "touchkio", label: "TouchKio", prefix: "touchkio" },
    { id: "homehub", label: "HomeHub", prefix: "homehub/buttons" },
    { id: "homeassistant", label: "Home Assistant", prefix: "homeassistant" },
    { id: "custom", label: "Custom", prefix: "" }
  ];
  let containerEl = null;
  let currentConnState = "connecting";
  let currentMqttState = "connecting";
  let mqttWatchdogTimerId = null;
  let mqttCheckRunning = false;
  let pendingKioskAction = null;

  const STATUS_LABELS = {
    connecting: "Forbinder…",
    connected: "Live",
    "auth-failed": "Login udløbet"
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function getMqttConfig() {
    try {
      return { target: "kiosk_8400t", customPrefix: "homehub/buttons", payload: "PRESS", kioskName: "8400T kiosk", kioskPrefix: "kiosk_8400t", ...JSON.parse(localStorage.getItem(MQTT_CONFIG_KEY) || "{}") };
    } catch (error) {
      return { target: "kiosk_8400t", customPrefix: "homehub/buttons", payload: "PRESS", kioskName: "8400T kiosk", kioskPrefix: "kiosk_8400t" };
    }
  }

  function normalizePrefix(value) {
    const prefix = String(value || "kiosk_8400t").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    return prefix === "8400t_kiosk" ? "kiosk_8400t" : (prefix || "kiosk_8400t");
  }

  function getKioskIds() {
    const prefix = normalizePrefix(getMqttConfig().kioskPrefix);
    const configured = BeastConfig.get("appEntities.kioskEntities") || {};
    if (Object.keys(configured).length) return configured;
    const entity = (domain, suffix) => `${domain}.${prefix}_${suffix}`;
    return {
      reboot: entity("button", "reboot"), refresh: entity("button", "refresh"), shutdown: entity("button", "shutdown"),
      screenshotButton: entity("button", "screenshot"), display: entity("light", "display"), zoom: entity("number", "page_zoom"),
      volume: entity("number", "volume"), kiosk: entity("select", "kiosk"), theme: entity("select", "theme"),
      url: entity("text", "page_url"), heartbeat: entity("sensor", "heartbeat"), uptime: entity("sensor", "up_time"),
      cpu: entity("sensor", "processor_usage"), temperature: entity("sensor", "processor_temperature"),
      memory: entity("sensor", "memory_usage"), errors: entity("sensor", "errors"), upgrades: entity("sensor", "package_upgrades"),
      network: entity("sensor", "network_address"), model: entity("sensor", "model"), version: entity("sensor", "version"), host: entity("sensor", "host_name")
    };
  }

  function stateValue(entityId) {
    const state = BeastHaSocket.getState(entityId);
    if (!state || ["unknown", "unavailable"].includes(state.state)) return "–";
    return `${state.state}${state.attributes.unit_of_measurement ? ` ${state.attributes.unit_of_measurement}` : ""}`;
  }

  function callService(domain, service, data) {
    return BeastAuth.haFetch(`/api/services/${domain}/${service}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
    });
  }

  function mqttCommandAction(kind) {
    return {
      refresh: "refresh",
      hard: "hard-reload",
      chrome: "restart-chrome",
      shot: "screenshot",
      reboot: "reboot",
      shutdown: "shutdown"
    }[kind] || kind;
  }

  function publishDirectKioskCommand(kind) {
    return callService("mqtt", "publish", {
      topic: "dashboard/kiosk/command",
      payload: JSON.stringify({
        action: mqttCommandAction(kind),
        source: "beast-dashboard",
        layout: "beast",
        url: window.location.href,
        timestamp: new Date().toISOString()
      }),
      qos: 0,
      retain: false
    });
  }

  async function checkMqttConnection() {
    if (mqttCheckRunning || currentConnState !== "connected" || navigator.onLine === false) return;
    mqttCheckRunning = true;
    try {
      await callService("mqtt", "publish", {
        topic: "dashboard/ha-smartdash/status",
        payload: JSON.stringify({ state: "online", timestamp: new Date().toISOString() }),
        qos: 0,
        retain: true
      });
      currentMqttState = "connected";
    } catch (error) {
      currentMqttState = "connecting";
      BeastCore.log(`MQTT-watchdog: forbindelsen er ikke klar (${error.message}), prøver igen.`);
    } finally {
      mqttCheckRunning = false;
      if (containerEl && containerEl.closest(".beast-section")?.classList.contains("is-active")) render();
    }
  }

  function startMqttWatchdog() {
    if (mqttWatchdogTimerId) return;
    mqttWatchdogTimerId = window.setInterval(checkMqttConnection, 30000);
    window.addEventListener("online", () => window.setTimeout(checkMqttConnection, 1000));
  }

  function buildSelectControl(label, entityId) {
    const state = BeastHaSocket.getState(entityId);
    const options = Array.isArray(state?.attributes?.options) ? state.attributes.options : [];
    return `<div class="beast-mqtt-control"><span>${label}</span><strong>${escapeHtml(stateValue(entityId))}</strong><div class="beast-mqtt-options">${options.map((option) => `<button type="button" data-kiosk-action="select" data-entity="${entityId}" data-value="${escapeHtml(option)}" class="${state?.state === option ? "is-active" : ""}">${escapeHtml(option)}</button>`).join("") || "<i>Ingen valg</i>"}</div></div>`;
  }

  function buildNumberControl(label, entityId, step = 5) {
    const state = BeastHaSocket.getState(entityId);
    return `<div class="beast-mqtt-control"><span>${label}</span><strong>${escapeHtml(stateValue(entityId))}</strong><div class="beast-mqtt-stepper"><button type="button" data-kiosk-action="number" data-entity="${entityId}" data-delta="-${step}">−</button><button type="button" data-kiosk-action="number" data-entity="${entityId}" data-delta="${step}">+</button></div></div>`;
  }

  function renderMqttPanel() {
    const config = getMqttConfig();
    const ids = getKioskIds();
    const commands = [
      [ids.refresh, "Refresh", "refresh"], [ids.hardReload, "Hard reload", "hard"], [ids.restartChrome, "Genstart Chrome", "chrome"],
      [ids.screenshotButton, "Screenshot", "shot"], [ids.reboot, "Genstart kiosk", "reboot"], [ids.shutdown, "Luk kiosk", "shutdown"]
    ].filter(([entityId]) => entityId);
    const metrics = [
      ["Heartbeat", ids.heartbeat], ["Uptime", ids.uptime], ["CPU", ids.cpu], ["Temperatur", ids.temperature],
      ["Hukommelse", ids.memory], ["Fejl", ids.errors], ["Opdateringer", ids.upgrades], ["Netværk", ids.network],
      ["Model", ids.model], ["Version", ids.version], ["Host", ids.host]
    ];
    return `
      <div class="beast-settings-section-head"><div><p class="beast-panel-title">MQTT & kioskstyring</p><span>Samme styring som TH-Dash</span></div><span class="beast-mqtt-live">${BeastCore.icon(currentMqttState === "connected" ? "check" : "settings", { size: 14 })} ${currentMqttState === "connected" ? "MQTT live" : "Forbinder MQTT…"}</span></div>
      <div class="beast-mqtt-config">
        <label><span>MQTT-mål</span><select id="beastMqttTarget">${MQTT_TARGETS.map((target) => `<option value="${target.id}" ${config.target === target.id ? "selected" : ""}>${target.label}</option>`).join("")}</select></label>
        <label><span>Custom topic-prefix</span><input id="beastMqttCustom" value="${escapeHtml(config.customPrefix)}"></label>
        <label><span>Standard-payload</span><input id="beastMqttPayload" value="${escapeHtml(config.payload)}"></label>
        <label><span>Kiosknavn</span><input id="beastKioskName" value="${escapeHtml(config.kioskName)}"></label>
        <label><span>Kiosk entity-prefix</span><input id="beastKioskPrefix" value="${escapeHtml(config.kioskPrefix)}"></label>
        <button type="button" class="beast-btn beast-btn-primary" id="beastMqttSave">Gem MQTT</button>
        <button type="button" class="beast-btn" id="beastMqttTest">Send test</button>
      </div>
      <div class="beast-mqtt-device-head"><div><strong>${escapeHtml(config.kioskName)}</strong><span>${escapeHtml(config.kioskPrefix)}</span></div><button type="button" class="beast-mqtt-display ${["on"].includes(BeastHaSocket.getState(ids.display)?.state) ? "is-on" : ""}" data-kiosk-action="toggle" data-entity="${ids.display}">${BeastCore.icon("sun", { size: 17 })} Skærm</button></div>
      <div class="beast-mqtt-command-grid">${commands.map(([entityId, label, kind]) => {
        const entityState = BeastHaSocket.getState(entityId);
        const available = Boolean(entityState && !["unknown", "unavailable"].includes(entityState.state));
        return `<button type="button" data-kiosk-action="press" data-kind="${kind}" data-entity="${entityId}" data-entity-available="${available}" class="${kind === "shutdown" ? "is-danger" : ""}">${BeastCore.icon(kind === "shutdown" ? "close" : "settings", { size: 18 })}<strong>${label}</strong><small>${available ? "HA-entitet" : "Direkte MQTT"}</small></button>`;
      }).join("")}</div>
      <div class="beast-mqtt-controls">${buildNumberControl("Zoom", ids.zoom)}${buildNumberControl("Lyd", ids.volume)}${buildSelectControl("Kiosktilstand", ids.kiosk)}${buildSelectControl("Tema", ids.theme)}</div>
      <div class="beast-mqtt-url"><span>Sideadresse</span><code>${escapeHtml(stateValue(ids.url))}</code><button type="button" data-kiosk-action="url" data-entity="${ids.url}" data-value="${escapeHtml(BeastCore.appUrl())}">Åbn HA Smartdash</button></div>
      <div class="beast-mqtt-metrics">${metrics.map(([label, entityId]) => `<div><span>${label}</span><strong>${escapeHtml(stateValue(entityId))}</strong></div>`).join("")}</div>
      <p class="beast-mqtt-feedback" id="beastMqttFeedback"></p>
    `;
  }

  function render() {
    if (!containerEl) return;
    const hasPin = window.BeastScreenLock?.hasPin();
    const autoLockOn = window.BeastScreenLock?.isAutoLockEnabled();
    const floatingPlayerOn = window.BeastOverview?.isFloatingPlayerEnabled();
    const screensaver = BeastConfig.get("screensaver") || { enabled: true, schedule: "custom", startTime: "23:00", endTime: "05:30", offAfterMinutes: 5 };

    containerEl.innerHTML = `
      ${window.BeastTheme?.renderPanel() || ""}
      <div class="beast-settings-divider"></div>
      <p class="beast-panel-title">Forbindelse</p>
      <div class="beast-stat-grid">
        ${BeastCore.statTile({ icon: "check", label: "HA-forbindelse", value: STATUS_LABELS[currentConnState] || currentConnState, id: "beastSettingsConnTile" })}
        ${BeastCore.statTile({ icon: "grid", label: "Entities i cache", value: String(BeastHaSocket.getAllStates().size), id: "beastSettingsCountTile" })}
        ${BeastCore.statTile({
          icon: "music", label: "Flydende afspiller", value: floatingPlayerOn ? "Vises på forsiden" : "Skjult",
          id: "beastSettingsFloatingPlayerTile",
          extra: `<div class="beast-stat-tile-actions"><button type="button" class="beast-security-action-btn${floatingPlayerOn ? " is-disarm" : ""}" id="beastSettingsFloatingPlayerBtn">${floatingPlayerOn ? "Slå fra" : "Slå til"}</button></div>`
        })}
      </div>

      <p class="beast-panel-title" style="margin-top: var(--space-5);">Skærmlås</p>
      <div class="beast-stat-grid">
        ${BeastCore.statTile({
          icon: "lock", label: "Kode", value: hasPin ? "Aktiveret" : "Ikke sat",
          id: "beastSettingsPinTile",
          extra: `<div class="beast-stat-tile-actions">
            <button type="button" class="beast-security-action-btn" id="beastSettingsPinSet">${hasPin ? "Skift kode" : "Opret kode"}</button>
            ${hasPin ? `<button type="button" class="beast-security-action-btn is-disarm" id="beastSettingsPinRemove">Fjern</button>` : ""}
          </div>`
        })}
        ${BeastCore.statTile({
          icon: "shield", label: "Lås automatisk", value: autoLockOn ? "Til når alarm slås til" : "Fra",
          id: "beastSettingsAutoLockTile",
          extra: `<div class="beast-stat-tile-actions"><button type="button" class="beast-security-action-btn${autoLockOn ? " is-disarm" : ""}" id="beastSettingsAutoLockBtn" ${hasPin ? "" : "disabled"}>${autoLockOn ? "Slå fra" : "Slå til"}</button></div>`
        })}
        ${BeastCore.statTile({
          icon: "lock", label: "Lås nu", value: " ",
          id: "beastSettingsLockNowTile",
          extra: `<div class="beast-stat-tile-actions"><button type="button" class="beast-security-action-btn" id="beastSettingsLockNowBtn" ${hasPin ? "" : "disabled"}>Lås skærmen</button></div>`
        })}
      </div>

      <div class="beast-settings-divider"></div>
      <p class="beast-panel-title">Pauseskærm</p>
      <div class="beast-mqtt-config">
        <label><span>Pauseskærm</span>
          <select id="beastScreensaverEnabled">
            <option value="1" ${screensaver.enabled ? "selected" : ""}>Til</option>
            <option value="0" ${!screensaver.enabled ? "selected" : ""}>Fra</option>
          </select>
        </label>
        <label><span>Tidsrum</span>
          <select id="beastScreensaverSchedule">
            <option value="custom" ${screensaver.schedule !== "always" ? "selected" : ""}>Bestemt tidsrum</option>
            <option value="always" ${screensaver.schedule === "always" ? "selected" : ""}>Altid</option>
          </select>
        </label>
        <label><span>Starttidspunkt</span><input type="time" id="beastScreensaverStart" value="${escapeHtml(screensaver.startTime || "23:00")}"></label>
        <label><span>Sluttidspunkt</span><input type="time" id="beastScreensaverEnd" value="${escapeHtml(screensaver.endTime || "05:30")}"></label>
        <label><span>Slukker helt efter (minutter)</span><input type="number" min="1" max="60" id="beastScreensaverOffAfter" value="${Number(screensaver.offAfterMinutes) || 5}"></label>
        <button type="button" class="beast-btn beast-btn-primary" id="beastScreensaverSave">Gem pauseskærm</button>
      </div>

      <div class="beast-settings-divider"></div>
      ${renderMqttPanel()}

      <p class="beast-panel-title" style="margin-top: var(--space-5);">Log</p>
      <pre class="beast-debug-log" id="beastSettingsDebugLog"></pre>

      <button type="button" class="beast-btn" id="beastSettingsLogout" style="margin-top: var(--space-4); align-self: flex-start;">Log ud</button>
    `;

    containerEl.querySelectorAll("[data-theme-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        window.BeastTheme?.setMode(button.dataset.themeMode);
        render();
      });
    });
    containerEl.querySelectorAll("[data-theme-palette]").forEach((button) => {
      button.addEventListener("click", () => {
        window.BeastTheme?.setPalette(button.dataset.themePalette);
        render();
      });
    });
    containerEl.querySelectorAll("[data-theme-style]").forEach((button) => {
      button.addEventListener("click", () => {
        window.BeastTheme?.setStyle(button.dataset.themeStyle);
        render();
      });
    });
    document.getElementById("beastThemeOpacity")?.addEventListener("input", (event) => {
      const value = Number(event.currentTarget.value);
      const output = document.getElementById("beastThemeOpacityValue");
      if (output) output.textContent = `${value}%`;
      window.BeastTheme?.setCardOpacity(value);
    });
    document.getElementById("beastSettingsPinSet")?.addEventListener("click", () => {
      window.BeastScreenLock.startSetPin(() => render());
    });
    document.getElementById("beastSettingsPinRemove")?.addEventListener("click", () => {
      window.BeastScreenLock.startRemovePin(() => render());
    });
    document.getElementById("beastSettingsAutoLockBtn")?.addEventListener("click", () => {
      window.BeastScreenLock.setAutoLockEnabled(!autoLockOn);
      render();
    });
    document.getElementById("beastSettingsLockNowBtn")?.addEventListener("click", () => {
      window.BeastScreenLock.lockNow();
    });
    document.getElementById("beastSettingsFloatingPlayerBtn")?.addEventListener("click", () => {
      window.BeastOverview?.setFloatingPlayerEnabled(!floatingPlayerOn);
      render();
    });
    document.getElementById("beastScreensaverSave")?.addEventListener("click", () => {
      BeastConfig.set("screensaver", {
        enabled: document.getElementById("beastScreensaverEnabled").value === "1",
        schedule: document.getElementById("beastScreensaverSchedule").value,
        startTime: document.getElementById("beastScreensaverStart").value || "23:00",
        endTime: document.getElementById("beastScreensaverEnd").value || "05:30",
        offAfterMinutes: Math.max(1, Number(document.getElementById("beastScreensaverOffAfter").value) || 5)
      });
      render();
    });
    document.getElementById("beastSettingsLogout")?.addEventListener("click", () => {
      BeastAuth.logout();
      window.location.reload();
    });
    document.getElementById("beastMqttSave")?.addEventListener("click", () => {
      const next = {
        target: document.getElementById("beastMqttTarget").value,
        customPrefix: document.getElementById("beastMqttCustom").value.trim(),
        payload: document.getElementById("beastMqttPayload").value.trim() || "PRESS",
        kioskName: document.getElementById("beastKioskName").value.trim() || "Kiosk",
        kioskPrefix: normalizePrefix(document.getElementById("beastKioskPrefix").value)
      };
      localStorage.setItem(MQTT_CONFIG_KEY, JSON.stringify(next));
      render();
    });
    document.getElementById("beastMqttTest")?.addEventListener("click", async () => {
      const config = getMqttConfig();
      const target = MQTT_TARGETS.find((item) => item.id === config.target) || MQTT_TARGETS[0];
      const prefix = config.target === "custom" ? config.customPrefix : target.prefix;
      const feedback = document.getElementById("beastMqttFeedback");
      try {
        await callService("mqtt", "publish", { topic: `${String(prefix).replace(/\/+$/g, "")}/test`, payload: config.payload, qos: 0, retain: false });
        if (feedback) feedback.textContent = `Test sendt til ${prefix}/test`;
      } catch (error) {
        if (feedback) feedback.textContent = `MQTT-test fejlede: ${error.message}`;
      }
    });
    containerEl.querySelectorAll("[data-kiosk-action]").forEach((button) => {
      button.addEventListener("click", () => handleKioskAction(button));
    });

    const logEl = document.getElementById("beastSettingsDebugLog");
    if (logEl) {
      logEl.textContent = BeastCore.getDebugLog().slice(-60).join("\n");
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  async function handleKioskAction(button) {
    const action = button.dataset.kioskAction;
    const entityId = button.dataset.entity;
    const kind = button.dataset.kind || action;
    const feedback = document.getElementById("beastMqttFeedback");
    if (["shutdown", "reboot"].includes(kind) && pendingKioskAction !== `${kind}:${entityId}`) {
      pendingKioskAction = `${kind}:${entityId}`;
      if (feedback) feedback.textContent = `Tryk igen for at bekræfte ${kind === "shutdown" ? "nedlukning" : "genstart"}.`;
      window.setTimeout(() => { pendingKioskAction = null; }, 3500);
      return;
    }
    pendingKioskAction = null;
    button.disabled = true;
    try {
      if (action === "press") {
        if (button.dataset.entityAvailable === "true") {
          try {
            await callService("button", "press", { entity_id: entityId });
            if (feedback) feedback.textContent = `Kommando sendt via ${entityId}.`;
          } catch (error) {
            await publishDirectKioskCommand(kind);
            if (feedback) feedback.textContent = "HA-entiteten fejlede – kommando sendt direkte via MQTT.";
          }
        } else {
          await publishDirectKioskCommand(kind);
          if (feedback) feedback.textContent = "Kommando sendt direkte til dashboard/kiosk/command.";
        }
      } else if (action === "toggle") {
        const domain = entityId.split(".")[0] === "switch" ? "switch" : "light";
        await callService(domain, "toggle", { entity_id: entityId });
      } else if (action === "select") {
        await callService("select", "select_option", { entity_id: entityId, option: button.dataset.value });
      } else if (action === "number") {
        const state = BeastHaSocket.getState(entityId);
        const current = Number(state?.state);
        const delta = Number(button.dataset.delta);
        const min = Number(state?.attributes?.min);
        const max = Number(state?.attributes?.max);
        const raw = (Number.isFinite(current) ? current : 0) + delta;
        const value = Math.min(Number.isFinite(max) ? max : raw, Math.max(Number.isFinite(min) ? min : raw, raw));
        await callService("number", "set_value", { entity_id: entityId, value });
      } else if (action === "url") {
        await callService("text", "set_value", { entity_id: entityId, value: button.dataset.value });
      }
      if (feedback && action !== "press") feedback.textContent = "Kommando sendt.";
      window.setTimeout(render, 450);
    } catch (error) {
      if (feedback) feedback.textContent = `Kommando fejlede: ${error.message}`;
      button.disabled = false;
    }
  }

  function init(root) {
    containerEl = root;
    containerEl.classList.add("beast-settings-panel");
    render();
    const stableRender = BeastCore.stableUpdater(containerEl, render, 1000);

    startMqttWatchdog();
    BeastHaSocket.onStatusChange((state) => {
      currentConnState = state;
      if (state === "connected") window.setTimeout(checkMqttConnection, 700);
      else currentMqttState = "connecting";
      stableRender();
    });
    BeastHaSocket.subscribeAll(stableRender);
    document.addEventListener("beast:log", () => {
      const logEl = document.getElementById("beastSettingsDebugLog");
      if (logEl) {
        logEl.textContent = BeastCore.getDebugLog().slice(-60).join("\n");
        logEl.scrollTop = logEl.scrollHeight;
      }
    });
  }

  BeastCore.registerPanel("settings", "beastSettingsZone", init);
})();
