(function () {
  let GO2RTC_BASE_URL = "";
  let configuredCameraIds = null;
  const SNAPSHOT_REFRESH_MS = 8000;

  // Hand-curated slug -> go2rtc stream-name mapping, carried over from TH dash's
  // proven go2rtc setup (only these cameras have a working go2rtc source).
  const STREAM_NAME_MAP = {
    fordor: "Fordor",
    forhaven: "Forhaven",
    carport: "carport",
    baghaven: "Baghaven",
    langs_huset: "Langs_huset",
    indkorsel: "Indkorsel",
    terrasse: "Terrasse",
    terrasse_syd: "Terrasse_syd",
    sandkassen: "sandkassen",
    trampolin: "trampolin",
    "3d_printer": "3dprinter",
    bag_indgang: "Bag_indgang"
  };

  let containerEl = null;
  let refreshTimerId = null;
  let featuredSlug = null;

  function getCameraSlug(entityId) {
    return entityId
      .replace(/^camera\./, "")
      .replace(/_medium_resolution_channel$/, "");
  }

  // Shared per-entity lookup used both by discoverCameras() (filtered by
  // the "Kameraer" panel's allowlist, for the camera strip/picker) and by
  // resolveCamera() below (unfiltered -- for features with their own
  // independent camera picker, like the screensaver and front-page
  // preview, where a camera the admin explicitly chose there shouldn't
  // silently fail to render just because it isn't also in the separate
  // Kameraer allowlist).
  function cameraInfoFor(entityId) {
    const state = BeastHaSocket.getState(entityId);
    if (!state) return null;
    const slug = getCameraSlug(entityId);
    const streamName = STREAM_NAME_MAP[slug] || null;
    const motionEntityId = `binary_sensor.${slug}_motion`;
    const motionState = BeastHaSocket.getState(motionEntityId);
    return {
      slug,
      entityId,
      streamName,
      entityPicture: state.attributes.entity_picture || null,
      label: (state.attributes.friendly_name || slug).split(" - ")[0],
      motion: Boolean(motionState && motionState.state === "on"),
      motionChangedAt: motionState ? new Date(motionState.last_changed).getTime() : 0
    };
  }

  function discoverCameras() {
    const states = BeastHaSocket.getAllStates();
    const cameras = [];
    states.forEach((state, entityId) => {
      // Any HA camera entity is eligible -- this used to require an entity
      // id ending in "_medium_resolution_channel" (an NVR sub-stream naming
      // convention specific to one setup) AND a hand-curated go2rtc name,
      // which silently excluded every camera that wasn't part of that one
      // setup. configuredCameraIds (Administration's "Kamera-entities"
      // field) is the real, user-controlled filter; when nothing is
      // configured yet, show everything so there's something to narrow.
      if (!entityId.startsWith("camera.")) return;
      if (configuredCameraIds && !configuredCameraIds.has(entityId)) return;
      const info = cameraInfoFor(entityId);
      if (info) cameras.push(info);
    });
    cameras.sort((a, b) => {
      if (a.motion !== b.motion) return a.motion ? -1 : 1;
      if (a.motion && b.motion) return b.motionChangedAt - a.motionChangedAt;
      return a.label.localeCompare(b.label, "da-DK");
    });
    return cameras;
  }

  function snapshotUrl(streamName) {
    return `${GO2RTC_BASE_URL}/api/frame.jpeg?src=${encodeURIComponent(streamName)}&_ts=${Date.now()}`;
  }

  async function swapSnapshot(img, nextUrl) {
    if (!img || img.dataset.snapshotLoading === "true") return false;
    img.dataset.snapshotLoading = "true";
    const preload = new Image();
    try {
      await new Promise((resolve, reject) => {
        preload.onload = resolve;
        preload.onerror = reject;
        preload.src = nextUrl;
      });
      if (preload.decode) await preload.decode().catch(() => {});
      if (!img.isConnected) return false;
      img.src = nextUrl;
      return true;
    } catch (error) {
      return false;
    } finally {
      delete img.dataset.snapshotLoading;
    }
  }

  function refreshStripSnapshots() {
    if (!containerEl || !BeastCore.isPanelVisible(containerEl)) return;
    containerEl.querySelectorAll(".beast-camera-snapshot").forEach((img) => {
      const tile = img.closest(".beast-camera-tile");
      const streamName = STREAM_NAME_MAP[tile?.dataset.slug];
      if (streamName) { swapSnapshot(img, snapshotUrl(streamName)); return; }
      const state = tile?.dataset.entityId && BeastHaSocket.getState(tile.dataset.entityId);
      if (state?.attributes?.entity_picture) BeastAuth.setAuthedImageSrc(img, state.attributes.entity_picture);
    });
    // The featured view only gets a plain <img> (no go2rtc mapping for
    // that camera) -- refresh it on the same cadence as the strip.
    const featuredImg = document.getElementById("beastCameraFeaturedImage");
    if (featuredImg && featuredSlug) {
      const entityPicture = discoverCameras().find((c) => c.slug === featuredSlug)?.entityPicture;
      if (entityPicture) BeastAuth.setAuthedImageSrc(featuredImg, entityPicture);
    }
  }

  function updateMotionBadges() {
    const cameraBySlug = new Map(discoverCameras().map((camera) => [camera.slug, camera]));
    containerEl?.querySelectorAll(".beast-camera-tile").forEach((tile) => {
      const camera = cameraBySlug.get(tile.dataset.slug);
      if (!camera) return;
      tile.classList.toggle("has-motion", camera.motion);
      let badge = tile.querySelector(".beast-camera-motion-badge");
      if (camera.motion && !badge) {
        badge = document.createElement("span");
        badge.className = "beast-camera-motion-badge";
        badge.innerHTML = BeastCore.icon("bolt", { size: 10 });
        tile.appendChild(badge);
      } else if (!camera.motion && badge) {
        badge.remove();
      }
    });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function render() {
    if (!containerEl) return;
    const cameras = discoverCameras();
    if (!cameras.length) {
      containerEl.innerHTML = `<p class="beast-music-empty">Ingen kameraer fundet endnu.</p>`;
      return;
    }

    if (!featuredSlug || !cameras.some((c) => c.slug === featuredSlug)) {
      featuredSlug = cameras[0].slug;
    }
    const featured = cameras.find((c) => c.slug === featuredSlug);
    const previousIframe = document.getElementById("beastCameraFeaturedIframe");
    const alreadyShowingFeatured = previousIframe && previousIframe.dataset.slug === featured.slug && featured.streamName;

    containerEl.innerHTML = `
      <button type="button" class="beast-page-edit-trigger" id="beastCamerasLayoutEdit" aria-label="Rediger kameralayout">⋮</button>
      <div class="beast-camera-featured">
        <div class="beast-camera-featured-frame" id="beastCameraFeaturedFrame"></div>
        <span class="beast-camera-featured-label">${escapeHtml(featured.label)}</span>
        ${featured.streamName ? `<button type="button" class="beast-camera-audio-toggle" id="beastCameraAudioToggle" aria-pressed="false">${BeastCore.icon("volume-mute", { size: 17 })}<span>Lyd fra</span></button>` : ""}
        ${featured.motion ? `<span class="beast-camera-motion-badge">${BeastCore.icon("bolt", { size: 12 })} Bevægelse</span>` : ""}
      </div>
      <div class="beast-camera-strip" id="beastCameraStrip"></div>
    `;
    wireCameraLayout();

    const frame = document.getElementById("beastCameraFeaturedFrame");
    if (featured.streamName) {
      // go2rtc: low-latency live player.
      let iframe = previousIframe;
      if (alreadyShowingFeatured) {
        frame.appendChild(previousIframe);
      } else {
        iframe = document.createElement("iframe");
        iframe.id = "beastCameraFeaturedIframe";
        iframe.dataset.slug = featured.slug;
        iframe.src = `./camera-player.html?v=7&audio=1&src=${encodeURIComponent(featured.streamName)}`;
        iframe.setAttribute("frameborder", "0");
        iframe.setAttribute("allow", "autoplay");
        frame.appendChild(iframe);
      }
      iframe.contentWindow?.postMessage({ type: "camera-player-audio", muted: true }, window.location.origin);

      const audioButton = document.getElementById("beastCameraAudioToggle");
      audioButton?.addEventListener("click", () => {
        const muted = audioButton.getAttribute("aria-pressed") === "true";
        audioButton.setAttribute("aria-pressed", String(!muted));
        audioButton.innerHTML = muted
          ? `${BeastCore.icon("volume-mute", { size: 17 })}<span>Lyd fra</span>`
          : `${BeastCore.icon("volume", { size: 17 })}<span>Lyd til</span>`;
        iframe.contentWindow?.postMessage({ type: "camera-player-audio", muted }, window.location.origin);
      });
    } else {
      // No go2rtc mapping for this camera -- fall back to HA's own
      // authenticated camera image, refreshed on the same timer as the
      // strip thumbnails instead of a true low-latency stream.
      const img = document.createElement("img");
      img.id = "beastCameraFeaturedImage";
      img.className = "beast-camera-featured-snapshot";
      img.alt = "";
      frame.appendChild(img);
      if (featured.entityPicture) BeastAuth.setAuthedImageSrc(img, featured.entityPicture);
    }

    const strip = document.getElementById("beastCameraStrip");
    cameras.forEach((camera) => {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = `beast-camera-tile${camera.motion ? " has-motion" : ""}${camera.slug === featuredSlug ? " is-featured" : ""}`;
      tile.dataset.slug = camera.slug;
      tile.dataset.entityId = camera.entityId;
      tile.innerHTML = `
        <img class="beast-camera-snapshot" ${camera.streamName ? `src="${snapshotUrl(camera.streamName)}"` : ""} alt="" loading="lazy">
        ${camera.motion ? `<span class="beast-camera-motion-badge">${BeastCore.icon("bolt", { size: 10 })}</span>` : ""}
        <span class="beast-camera-label">${escapeHtml(camera.label)}</span>
      `;
      if (!camera.streamName && camera.entityPicture) BeastAuth.setAuthedImageSrc(tile.querySelector("img"), camera.entityPicture);
      tile.addEventListener("click", () => {
        featuredSlug = camera.slug;
        render();
      });
      strip.appendChild(tile);
    });
  }

  function wireCameraLayout() {
    const layout = BeastConfig.get("pageLayouts.cameras.cameraLayout") || {};
    const hidden = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
    containerEl.querySelector(".beast-camera-featured")?.classList.toggle("is-layout-hidden", hidden.has("featured"));
    containerEl.querySelector(".beast-camera-strip")?.classList.toggle("is-layout-hidden", hidden.has("grid"));
    containerEl.querySelector("#beastCamerasLayoutEdit")?.addEventListener("click", () => openCameraLayout(layout));
  }

  function openCameraLayout(layout) {
    const hidden = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
    const items = [["featured","Stort kamera"],["grid","Kameragrid"]];
    const overlay = document.createElement("div"); overlay.className = "beast-modal-overlay";
    overlay.innerHTML = `<div class="beast-modal"><div class="beast-modal-header"><h3>Rediger kameralayout</h3><button type="button" class="beast-modal-close" data-close>×</button></div><div class="beast-modal-body"><div class="beast-camera-layout-list">${items.map(([id,label]) => `<label><input type="checkbox" data-camera-section="${id}" ${hidden.has(id)?"":"checked"}><strong>${label}</strong></label>`).join("")}</div><button type="button" class="beast-btn beast-btn-primary" data-save-camera-layout>Gem layout</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (event) => { if(event.target===overlay||event.target.closest("[data-close]")) return overlay.remove(); if(!event.target.closest("[data-save-camera-layout]")) return; const nextHidden=items.filter(([id])=>!overlay.querySelector(`[data-camera-section="${id}"]`).checked).map(([id])=>id); BeastConfig.set("pageLayouts.cameras.cameraLayout", {...layout,hidden:nextHidden}); overlay.remove(); render(); });
  }

  function init(root) {
    const config = BeastConfig.get("panels.cameras") || {};
    GO2RTC_BASE_URL = config.go2rtcBaseUrl || GO2RTC_BASE_URL;
    configuredCameraIds = Array.isArray(config.cameraEntities) && config.cameraEntities.length ? new Set(config.cameraEntities) : null;
    containerEl = root;
    containerEl.classList.add("beast-cameras-panel");
    containerEl.innerHTML = `<p class="beast-music-empty">Henter kameraer…</p>`;
    BeastHaSocket.onStatusChange((status) => {
      if (status === "connected") render();
    });
    BeastHaSocket.subscribeDomain("binary_sensor", (entityId, newState) => {
      if (entityId.endsWith("_motion")) updateMotionBadges();
    });

    window.clearInterval(refreshTimerId);
    refreshTimerId = window.setInterval(refreshStripSnapshots, SNAPSHOT_REFRESH_MS);
    document.addEventListener("beast:sectionchange", (event) => {
      if (event.detail?.section === "cameras") refreshStripSnapshots();
    });
  }

  BeastCore.registerPanel("cameras", "beastCamerasZone", init);

  window.BeastCameras = {
    getAllCameras: () => discoverCameras(),
    getTopCameras: (n) => discoverCameras().slice(0, n),
    resolveCamera: (entityId) => cameraInfoFor(entityId),
    snapshotUrl,
    swapSnapshot
  };
})();
