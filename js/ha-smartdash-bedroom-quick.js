// Pop-ups over the bedroom screensaver (bedroom devices). The shortcut row's
// Kameraer, Lys and Blæser open one of these without leaving the screensaver:
// large buttons that are easy to hit in the dark, and for cameras one big live
// picture with a small gallery under it to switch between the cameras. Taps
// inside never wake the screen (see onSaverPointerDown in
// ha-smartdash-bedroom-alerts.js); the pop-up closes on its Luk button, a tap
// beside it, a quiet two minutes, or when the screensaver closes.
// -- Change by Claude AI (v0.8.103)
window.BeastBedroom.quick = (() => {
  const B = window.BeastBedroom;
  const { t, esc, icon, list, state, unavailable, displayName, roomTitle } = B.util;
  const P = B.popupApi;
  const KINDS = ["cameras", "lights", "fan"];
  const IDLE_CLOSE_MS = 2 * 60 * 1000;
  const OPEN_GUARD_MS = 350;
  const THUMB_CYCLE_MS = 15 * 1000;
  const LEVELS = [10, 30, 60, 100];

  let el = null;
  let kind = "";
  let openedAt = 0;
  let unsubscribers = [];
  let idleTimerId = null;
  let renderTimerId = null;
  let thumbTimerId = null;
  let resizeObserver = null;
  let camIds = [];
  let camIndex = 0;
  let thumbNext = 0;

  function overlayEl() {
    const overlay = document.getElementById("beastAmbientMode");
    return overlay && overlay.classList.contains("is-visible") ? overlay : null;
  }

  const TITLES = { cameras: "Kameraer", lights: "Lys", fan: "Blæser" };

  // ---------------------------------------------------------------------------
  // Lights: a big tile per light, brightness in four steps, then the scenes
  // ---------------------------------------------------------------------------
  function lightCard(model) {
    if (model.unavailable) {
      return `<div class="bdq-light is-off"><button type="button" class="bdq-tog" disabled><span class="bdq-ic">${icon("bulb", 28)}</span><span class="bdq-tx"><b>${esc(model.name)}</b><small>${esc(t("Utilgængelig"))}</small></span></button></div>`;
    }
    const sub = !model.on ? t("Slukket") : model.canDim ? `${model.pct} %` : t("Tændt");
    const levels = model.canDim ? `<div class="bdq-levels" role="group" aria-label="${esc(t("Lysstyrke {name}", { name: model.name }))}">${LEVELS.map((pct) => {
      const current = model.on && Math.abs(model.pct - pct) <= 8;
      return `<button type="button" class="bdq-level${current ? " is-on" : ""}" data-bdq="level" data-id="${esc(model.id)}" data-pct="${pct}">${pct} %</button>`;
    }).join("")}</div>` : "";
    return `<div class="bdq-light${model.on ? " is-on" : ""}"><button type="button" class="bdq-tog" data-bdq="light" data-id="${esc(model.id)}" aria-pressed="${model.on}"><span class="bdq-ic">${icon("bulb", 28)}</span><span class="bdq-tx"><b>${esc(model.name)}</b><small>${esc(sub)}</small></span></button>${levels}</div>`;
  }

  function lightsMarkup() {
    const models = B.lightIds().map(B.lightModel);
    const sceneIds = B.sceneIds();
    const activeId = sceneIds.length ? B.activeSceneId(sceneIds) : null;
    const scenes = sceneIds.map((id) => {
      const st = state(id);
      const off = !st || st.state === "unavailable";
      const running = P.pendingFor(id)?.scene === "running";
      return `<button type="button" class="bdq-scene${id === activeId ? " is-on" : ""}${running ? " is-run" : ""}" data-bdq="scene" data-id="${esc(id)}"${off ? " disabled" : ""}>${esc(displayName(id))}</button>`;
    }).join("");
    return `<div class="bdq-scroll">
      <button type="button" class="bdq-wide" data-bdq="lights-off">${icon("power", 26)}<span>${esc(t("Alt lys fra"))}</span></button>
      ${models.length ? `<div class="bdq-lights" data-n="${models.length}">${models.map(lightCard).join("")}</div>` : `<p class="bdq-quiet">${esc(t("Ingen lys valgt"))}</p>`}
      ${scenes ? `<h3 class="bdq-sub">${esc(t("Stemninger"))}</h3><div class="bdq-scenes">${scenes}</div>` : ""}
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // Fan: state at a glance, then two huge buttons
  // ---------------------------------------------------------------------------
  function fanMarkup() {
    const cards = P.fanIds().map((id) => {
      const st = state(id);
      const off = unavailable(st);
      const pend = P.pendingFor(id);
      const on = !off && (pend && "on" in pend ? pend.on : st.state === "on");
      const status = off ? t("Utilgængelig") : on ? t("Kører") : t("Slukket");
      return `<section class="bdq-fan${on ? " is-on" : ""}">
        <div class="bdq-fan-head"><span class="bdq-ic is-big">${icon("fan", 40)}</span><span class="bdq-tx"><b>${esc(displayName(id))}</b><small>${esc(status)}</small></span></div>
        <div class="bdq-pair"><button type="button" class="bdq-huge${on ? " is-on" : ""}" data-bdq="fan-on" data-id="${esc(id)}"${off ? " disabled" : ""}>${esc(t("Tænd"))}</button><button type="button" class="bdq-huge${!on && !off ? " is-on" : ""}" data-bdq="fan-off" data-id="${esc(id)}"${off ? " disabled" : ""}>${esc(t("Sluk"))}</button></div>
      </section>`;
    }).join("");
    return `<div class="bdq-scroll bdq-fans">${cards}</div>`;
  }

  // ---------------------------------------------------------------------------
  // Cameras: one big live picture, a gallery of snapshots under it
  // ---------------------------------------------------------------------------
  function camerasMarkup() {
    if (!camIds.length) return `<p class="bdq-quiet">${esc(t("Kamera utilgængeligt"))}</p>`;
    const thumbs = camIds.map((id, index) => `<button type="button" class="bdq-thumb" data-bdq="cam" data-index="${index}" aria-label="${esc(t("Vis {name} live", { name: P.cameraLabel(id) }))}"><img alt="" decoding="async"><span>${esc(P.cameraLabel(id))}</span></button>`).join("");
    return `<div class="bdq-cams"><div class="bdq-stagewrap"><div class="bdq-stage" data-bdq-stage></div></div><div class="bdq-gallery" role="group" aria-label="${esc(t("Kameraer"))}">${thumbs}</div></div>`;
  }

  function fitStage() {
    const wrap = el?.querySelector(".bdq-stagewrap");
    const stage = el?.querySelector("[data-bdq-stage]");
    if (!wrap || !stage) return;
    const width = Math.max(0, Math.min(wrap.clientWidth, wrap.clientHeight * 16 / 9));
    stage.style.width = `${Math.floor(width)}px`;
    stage.style.height = `${Math.floor(width * 9 / 16)}px`;
  }

  function stopStage() {
    el?.querySelectorAll("[data-bdq-stage] iframe").forEach((frame) => { frame.src = "about:blank"; });
  }

  function showCamera(index) {
    if (!el || !camIds.length) return;
    camIndex = (index + camIds.length) % camIds.length;
    const id = camIds[camIndex];
    const stage = el.querySelector("[data-bdq-stage]");
    if (!stage) return;
    stopStage();
    const spec = P.cameraSpec(id);
    stage.innerHTML = spec
      ? `${P.streamMarkup(spec)}<span class="bdq-camname">${esc(P.cameraLabel(id))}</span>`
      : `<div class="bdq-quiet">${esc(t("Kamera utilgængeligt"))}</div>`;
    el.querySelectorAll(".bdq-thumb").forEach((button, i) => {
      const active = i === camIndex;
      button.classList.toggle("is-active", active);
      if (active) {
        button.setAttribute("aria-current", "true");
        const gallery = button.parentElement;
        if (gallery) gallery.scrollLeft = Math.max(0, button.offsetLeft - (gallery.clientWidth - button.offsetWidth) / 2);
      } else button.removeAttribute("aria-current");
    });
  }

  async function loadThumb(index) {
    const img = el?.querySelector(`.bdq-thumb[data-index="${index}"] img`);
    const id = camIds[index];
    const picture = id ? (state(id)?.attributes?.entity_picture || `/api/camera_proxy/${id}`) : "";
    if (!img || !picture) return;
    try {
      const blob = await BeastAuth.haFetchBlob(`${picture}${picture.includes("?") ? "&" : "?"}_t=${Date.now()}`);
      if (!img.isConnected) return;
      const previous = img.dataset.url;
      const url = URL.createObjectURL(blob);
      img.onload = () => { if (previous) URL.revokeObjectURL(previous); img.onload = null; };
      img.dataset.url = url;
      img.src = url;
      img.closest(".bdq-thumb")?.classList.add("is-loaded");
    } catch (_) {
      // Keep the last good picture.
    }
  }

  function scheduleThumbs(delay) {
    window.clearTimeout(thumbTimerId);
    thumbTimerId = window.setTimeout(() => {
      if (!el || kind !== "cameras" || document.hidden || !camIds.length) return;
      loadThumb(thumbNext % camIds.length);
      thumbNext = (thumbNext + 1) % camIds.length;
      scheduleThumbs(Math.max(1500, THUMB_CYCLE_MS / camIds.length));
    }, delay);
  }

  // ---------------------------------------------------------------------------
  // Frame, rendering, events
  // ---------------------------------------------------------------------------
  function renderBody() {
    renderTimerId = null;
    const body = el?.querySelector("[data-bdq-body]");
    if (!body || kind === "cameras") return;
    const scroll = body.firstElementChild?.scrollTop || 0;
    body.innerHTML = kind === "lights" ? lightsMarkup() : fanMarkup();
    if (scroll && body.firstElementChild) body.firstElementChild.scrollTop = scroll;
  }

  function requestRender(delay = 80) {
    if (!el || kind === "cameras") return;
    window.clearTimeout(renderTimerId);
    renderTimerId = window.setTimeout(renderBody, delay);
  }

  function touch() {
    window.clearTimeout(idleTimerId);
    idleTimerId = window.setTimeout(close, IDLE_CLOSE_MS);
  }

  function onClick(event) {
    if (Date.now() - openedAt < OPEN_GUARD_MS) return;
    touch();
    if (event.target === el) { close(); return; }
    const button = event.target.closest("[data-bdq]");
    if (!button || button.disabled) return;
    event.stopPropagation();
    const id = button.dataset.id;
    switch (button.dataset.bdq) {
      case "close": close(); return;
      case "light": P.toggleLight(id); break;
      case "level": P.commitBrightness(id, Number(button.dataset.pct)); break;
      case "lights-off": P.allLightsOff(); break;
      case "scene": P.activateScene(id); break;
      case "fan-on":
      case "fan-off": {
        const st = state(id);
        const on = P.pendingFor(id)?.on ?? st?.state === "on";
        if (on !== (button.dataset.bdq === "fan-on")) P.toggleEntity(id);
        break;
      }
      case "cam": showCamera(Number(button.dataset.index) || 0); return;
      default: return;
    }
    requestRender(30);
  }

  function ids() {
    if (kind === "lights") return [...B.lightIds(), ...B.sceneIds()];
    if (kind === "fan") return P.fanIds();
    return [];
  }

  function open(next) {
    const overlay = overlayEl();
    if (!overlay || !KINDS.includes(next)) return false;
    if (next === "fan" && !P.fanIds().length) return false;
    if (next === "cameras" && !(B.allCameraIds?.() || []).length) return false;
    close();
    kind = next;
    openedAt = Date.now();
    camIds = kind === "cameras" ? B.allCameraIds() : [];
    el = document.createElement("div");
    el.className = "bdq";
    el.dataset.kind = kind;
    const title = t(TITLES[kind]);
    el.innerHTML = `<div class="bdq-panel" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="bdq-head"><div class="bdq-title"><span>${esc(roomTitle())}</span><strong>${esc(title)}</strong></div><button type="button" class="bdq-close" data-bdq="close" aria-label="${esc(t("Luk"))}">${icon("x", 30)}</button></header>
      <div class="bdq-body" data-bdq-body>${kind === "cameras" ? camerasMarkup() : kind === "lights" ? lightsMarkup() : fanMarkup()}</div></div>`;
    el.addEventListener("click", onClick);
    overlay.appendChild(el);
    overlay.classList.add("has-bdq");
    unsubscribers = ids().map((id) => BeastHaSocket.subscribeEntity(id, () => requestRender()));
    if (kind === "cameras") {
      fitStage();
      resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(fitStage) : null;
      resizeObserver?.observe(el.querySelector(".bdq-stagewrap"));
      showCamera(0);
      camIds.forEach((id, index) => window.setTimeout(() => loadThumb(index), index * 150));
      thumbNext = 0;
      scheduleThumbs(THUMB_CYCLE_MS);
    }
    touch();
    return true;
  }

  function close() {
    if (!el) return;
    window.clearTimeout(idleTimerId);
    window.clearTimeout(renderTimerId);
    window.clearTimeout(thumbTimerId);
    idleTimerId = renderTimerId = thumbTimerId = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    unsubscribers = [];
    stopStage();
    el.querySelectorAll(".bdq-thumb img").forEach((img) => { if (img.dataset.url) URL.revokeObjectURL(img.dataset.url); });
    el.parentElement?.classList.remove("has-bdq");
    el.remove();
    el = null;
    kind = "";
    camIds = [];
  }

  document.addEventListener("beast:ambientchange", () => close());
  window.addEventListener("resize", () => { if (kind === "cameras") fitStage(); });

  return { open, close, isOpen: () => Boolean(el) };
})();
