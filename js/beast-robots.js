(function () {
  let containerEl = null;
  let robots = [];

  const STATE_LABELS = {
    docked: "Docket", cleaning: "Rengør", returning: "På vej hjem", paused: "Pause",
    idle: "Klar", error: "Fejl", mowing: "Slår græs", charging: "Oplader"
  };

  function escapeHtml(input) {
    return String(input ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function state(id) { return id ? BeastHaSocket.getState(id) : null; }
  function value(id, fallback = "–") {
    const result = state(id)?.state;
    return !result || ["unknown", "unavailable"].includes(result) ? fallback : result;
  }

  function callService(domain, service, entityId, data = {}) {
    if (!entityId) return Promise.resolve();
    return BeastAuth.haFetch(`/api/services/${domain}/${service}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_id: entityId, ...data })
    }).catch((error) => BeastCore.log(`Robotter: kommando fejlede (${error.message}).`));
  }

  function discoverFeatures(entityId) {
    const deviceId = BeastRegistry.getEntityMeta(entityId)?.deviceId;
    const entityIds = deviceId ? BeastRegistry.getDeviceEntityIds(deviceId) : [];
    const entries = entityIds.map((id) => ({
      id, entity: state(id), text: `${id} ${state(id)?.attributes?.friendly_name || ""}`.toLowerCase()
    }));
    const one = (domain, pattern) => entries.find((entry) => entry.id.startsWith(`${domain}.`) && pattern.test(entry.text))?.id || null;
    return {
      deviceId, entityIds,
      battery: one("sensor", /battery|batteri|akku|charge level/),
      bin: one("binary_sensor", /bin|dust|beholder|full|fuld/),
      progress: one("sensor", /progress|fremdrift|percent|procent/),
      area: one("sensor", /room|rum|zone|omrade|område|area/),
      map: entries.find((entry) => entry.id.startsWith("image."))?.id || null,
      selects: entries.filter((entry) => entry.id.startsWith("select.") && Array.isArray(entry.entity?.attributes?.options)).map((entry) => entry.id),
      buttons: entries.filter((entry) => entry.id.startsWith("button.")).map((entry) => entry.id)
    };
  }

  function statusPill(entityId) {
    const current = value(entityId, "offline");
    const active = ["cleaning", "mowing", "returning"].includes(current);
    return `<span class="beast-room-badge${active ? " is-active" : ""}">${escapeHtml(STATE_LABELS[current] || current)}</span>`;
  }

  function battery(entityId, sensorId) {
    const attribute = state(entityId)?.attributes?.battery_level;
    const level = Number.isFinite(Number(attribute)) ? attribute : value(sensorId);
    return `<span>${BeastCore.icon("bolt", { size: 15 })} ${escapeHtml(level)}%</span>`;
  }

  function actions(entityId, domain) {
    const start = domain === "vacuum" ? "start" : "start_mowing";
    const home = domain === "vacuum" ? "return_to_base" : "dock";
    return `<div class="beast-robot-actions">
      <button type="button" class="beast-security-action-btn" data-command="${domain}|${start}|${entityId}">Start</button>
      <button type="button" class="beast-security-action-btn" data-command="${domain}|pause|${entityId}">Pause</button>
      <button type="button" class="beast-security-action-btn" data-command="${domain}|${home}|${entityId}">Hjem</button>
    </div>`;
  }

  function selectControl(entityId) {
    const entity = state(entityId);
    const options = entity?.attributes?.options || [];
    return `<label class="beast-robot-setting"><span>${escapeHtml(BeastEntityPicker.friendlyName(entityId))}</span>
      <select data-select="${escapeHtml(entityId)}">${options.map((option) => `<option value="${escapeHtml(option)}"${option === entity?.state ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>
    </label>`;
  }

  function buildRobot({ entityId, domain }) {
    const entity = state(entityId);
    const features = discoverFeatures(entityId);
    const device = BeastRegistry.getDevice(features.deviceId);
    const name = entity?.attributes?.friendly_name || BeastEntityPicker.friendlyName(entityId);
    const model = device?.model || device?.manufacturer || (domain === "vacuum" ? "Robotstøvsuger" : "Robotplæneklipper");
    const facts = [
      features.bin ? `<span>${BeastCore.icon("grid", { size: 15 })} ${value(features.bin, "off") === "on" ? "Beholder kræver opmærksomhed" : "Beholder klar"}</span>` : "",
      features.progress ? `<span>${BeastCore.icon("check", { size: 15 })} ${escapeHtml(value(features.progress))}%</span>` : "",
      features.area ? `<span>${BeastCore.icon("home", { size: 15 })} ${escapeHtml(value(features.area))}</span>` : ""
    ].filter(Boolean).join("");
    return `<article class="beast-robot-card beast-robot-card--product">
      <div class="beast-robot-card-head"><div><small>${escapeHtml(model)}</small><strong class="beast-robot-name">${escapeHtml(name)}</strong></div>${statusPill(entityId)}</div>
      <div class="beast-robot-media">${features.map ? `<img data-robot-image="${escapeHtml(features.map)}" alt="${escapeHtml(name)}">` : `<span class="beast-robot-generic-icon">${BeastCore.icon("robot", { size: 72 })}</span>`}</div>
      <div class="beast-robot-facts">${battery(entityId, features.battery)}<span>${BeastCore.icon("home", { size: 15 })} ${escapeHtml(STATE_LABELS[entity?.state] || entity?.state || "Offline")}</span>${facts}</div>
      ${actions(entityId, domain)}
      ${features.selects.length ? `<div class="beast-robot-settings">${features.selects.map(selectControl).join("")}</div>` : ""}
      ${features.buttons.length ? `<div class="beast-robot-quick-actions">${features.buttons.slice(0, 6).map((id) => `<button type="button" data-command="button|press|${escapeHtml(id)}">${escapeHtml(BeastEntityPicker.friendlyName(id))}</button>`).join("")}</div>` : ""}
    </article>`;
  }

  function render() {
    if (!containerEl) return;
    containerEl.innerHTML = robots.length
      ? `<div class="beast-robots-grid">${robots.map(buildRobot).join("")}</div>`
      : `<p class="beast-music-empty">Ingen robotter er valgt. Tilføj dem under Indstillinger → Robotter.</p>`;
    containerEl.querySelectorAll("[data-robot-image]").forEach((image) => BeastAuth.setAuthedImageSrc(image, `/api/image_proxy/${image.dataset.robotImage}`));
    containerEl.querySelectorAll("[data-command]").forEach((button) => button.addEventListener("click", () => {
      const [domain, service, entityId] = button.dataset.command.split("|");
      callService(domain, service, entityId).then(() => window.setTimeout(render, 450));
    }));
    containerEl.querySelectorAll("[data-select]").forEach((select) => select.addEventListener("change", () => {
      callService("select", "select_option", select.dataset.select, { option: select.value }).then(() => window.setTimeout(render, 350));
    }));
  }

  function init(root) {
    const config = BeastConfig.get("panels.robots") || {};
    const vacuums = Array.isArray(config.vacuums) ? config.vacuums.filter(Boolean) : [];
    const mowers = Array.isArray(config.mowers) ? config.mowers.filter(Boolean) : [];
    robots = [...vacuums.map((entityId) => ({ entityId, domain: "vacuum" })), ...mowers.map((entityId) => ({ entityId, domain: "lawn_mower" }))];
    containerEl = root;
    containerEl.classList.add("beast-robots-panel");
    const stableRender = BeastCore.stableUpdater(containerEl, render, 350);
    BeastHaSocket.onStatusChange((status) => { if (status === "connected") render(); });
    const related = robots.flatMap((robot) => discoverFeatures(robot.entityId).entityIds);
    [...new Set([...robots.map((robot) => robot.entityId), ...related])].forEach((id) => BeastHaSocket.subscribeEntity(id, stableRender));
    render();
  }

  BeastCore.registerPanel("robots", "beastRobotsZone", init);
})();
