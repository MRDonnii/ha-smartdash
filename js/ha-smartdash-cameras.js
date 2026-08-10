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

  function cameraIdentity(entityId) {
    const raw = entityId.replace(/^camera\./, "");
    const named = raw.match(/_(high|medium|low)(?:_resolution)?(?:_channel)?$/i);
    const short = raw.match(/_(hd|sd|sub|main)(?:_stream)?$/i);
    const match = named || short;
    const quality = named ? named[1].toLowerCase() : short ? ({ hd: "high", main: "high", sd: "medium", sub: "low" })[short[1].toLowerCase()] : "standard";
    return { slug: match ? raw.slice(0, -match[0].length) : raw, quality };
  }

  function qualityLabel(quality) {
    return ({ high: "Høj", medium: "Mellem", low: "Lav", standard: "Standard" })[quality] || quality;
  }

  function cleanCameraLabel(value, slug) {
    let label = String(value || slug).trim();
    // Home Assistant integrations often append the provider, entity type and
    // stream quality to every friendly name. The picker only needs the
    // physical camera name; quality remains available in the camera menu.
    const technicalSuffixes = [
      /\s*[-–—·|]\s*UniFi\s+Protect(?:\s+(?:camera|kamera))?\s*$/i,
      /\s*\((?:UniFi\s+Protect|camera|kamera)\)\s*$/i,
      /\s*[-–—·|]?\s*(high|medium|low)\s+resolution\s+channel\s*$/i,
      /\s*[-–—·|]?\s*(high|medium|low|hd|sd|main|sub)(\s+stream)?\s*$/i,
      /\s*[-–—·|]?\s*(høj|mellem|lav)\s*(kvalitet|opløsning)?\s*$/i,
      /\s*[-–—·|]\s*(camera|kamera)\s*$/i
    ];
    // Run twice because a name can contain both provider and quality suffixes.
    for (let pass = 0; pass < 2; pass += 1) technicalSuffixes.forEach((pattern) => { label = label.replace(pattern, "").trim(); });
    if (label) return label;
    return String(slug || "Kamera").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function smartDetectionForCamera(slug) {
    const pattern = new RegExp(`^binary_sensor\\.${escapeRegExp(slug)}_(person|vehicle|animal|pet|dog|cat)(?:_detected)?$`, "i");
    const labels = { person: "Person", vehicle: "Bil", animal: "Dyr", pet: "Dyr", dog: "Dyr", cat: "Dyr" };
    const detections = [];
    BeastHaSocket.getAllStates().forEach((state, entityId) => {
      const match = entityId.match(pattern);
      if (!match || state.state !== "on") return;
      detections.push({
        type: match[1].toLowerCase(),
        label: labels[match[1].toLowerCase()] || "Hændelse",
        changedAt: new Date(state.last_changed || 0).getTime() || 0
      });
    });
    detections.sort((a, b) => b.changedAt - a.changedAt);
    return detections[0] || null;
  }

  function isSmartDetectionEntity(entityId) {
    return /^binary_sensor\..+_(?:person|vehicle|animal|pet|dog|cat)(?:_detected)?$/i.test(String(entityId || ""));
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
    const identity = cameraIdentity(entityId);
    const slug = identity.slug;
    const streamName = STREAM_NAME_MAP[slug] || null;
    const detection = smartDetectionForCamera(slug);
    return {
      slug,
      quality: identity.quality,
      entityId,
      streamName,
      // Some camera integrations expose a valid camera entity without an
      // entity_picture attribute. HA's authenticated camera proxy still
      // works and is the universal fallback for those installations.
      entityPicture: state.attributes.entity_picture || `/api/camera_proxy/${entityId}`,
      label: cleanCameraLabel(state.attributes.friendly_name, slug),
      motion: Boolean(detection),
      motionType: detection?.type || null,
      motionLabel: detection?.label || null,
      motionChangedAt: detection?.changedAt || 0
    };
  }

  function discoverCameras() {
    const states = BeastHaSocket.getAllStates();
    const groups = new Map();
    const configuredSlugs = configuredCameraIds ? new Set([...configuredCameraIds].map((id) => cameraIdentity(id).slug)) : null;
    states.forEach((state, entityId) => {
      // Any HA camera entity is eligible -- this used to require an entity
      // id ending in "_medium_resolution_channel" (an NVR sub-stream naming
      // convention specific to one setup) AND a hand-curated go2rtc name,
      // which silently excluded every camera that wasn't part of that one
      // setup. configuredCameraIds (Administration's "Kamera-entities"
      // field) is the real, user-controlled filter; when nothing is
      // configured yet, show everything so there's something to narrow.
      if (!entityId.startsWith("camera.")) return;
      const identity = cameraIdentity(entityId);
      // Selecting one quality in Administration enables the physical camera;
      // sibling quality entities are grouped automatically.
      if (configuredSlugs && !configuredSlugs.has(identity.slug)) return;
      const info = cameraInfoFor(entityId);
      if (!info) return;
      if (!groups.has(info.slug)) groups.set(info.slug, []);
      groups.get(info.slug).push(info);
    });
    const qualityByCamera = BeastConfig.get("pageLayouts.cameras.qualityByCamera") || {};
    const rank = { high: 0, medium: 1, standard: 2, low: 3 };
    const cameras = [...groups.values()].map((variants) => {
      variants.sort((a, b) => (rank[a.quality] ?? 9) - (rank[b.quality] ?? 9));
      const preferred = qualityByCamera[variants[0].slug];
      const selectedQuality = preferred === "high" ? "high" : "low";
      const selected = selectedQuality === "high"
        ? (variants.find((variant) => variant.quality === "high") || variants[0])
        : (variants.find((variant) => variant.quality === "low") || variants.find((variant) => variant.quality === "medium") || variants[0]);
      const useSub = selectedQuality === "low";
      const resolvedStreamName = selected.streamName ? `${selected.streamName}${useSub ? "_sub" : ""}` : null;
      const qualityOptions = selected.streamName
        ? [{ quality: "high", label: "Høj" }, { quality: "low", label: "Lav" }]
        : variants.map((variant) => ({ quality: variant.quality, label: qualityLabel(variant.quality) }));
      return { ...selected, variants, selectedQuality, qualityOptions, useSub, resolvedStreamName };
    });
    cameras.sort((a, b) => {
      if (a.motion !== b.motion) return a.motion ? -1 : 1;
      if (a.motion && b.motion) return b.motionChangedAt - a.motionChangedAt;
      return a.label.localeCompare(b.label, "da-DK");
    });
    return cameras;
  }

  function setCameraQuality(camera, quality) {
    if (!camera?.qualityOptions?.some((option) => option.quality === quality)) return;
    const current = BeastConfig.get("pageLayouts.cameras.qualityByCamera") || {};
    BeastConfig.set("pageLayouts.cameras.qualityByCamera", { ...current, [camera.slug]: quality });
    document.dispatchEvent(new CustomEvent("beast:camera-quality-changed", { detail: { slug: camera.slug, quality } }));
  }

  function qualityMenuMarkup(camera) {
    if (!camera?.qualityOptions || camera.qualityOptions.length < 2) return "";
    return `<div class="beast-camera-quality-menu" data-camera-quality-slug="${escapeHtml(camera.slug)}"><button type="button" class="beast-camera-quality-toggle" aria-label="Vælg kamerakvalitet" aria-expanded="false">⋮</button><div class="beast-camera-quality-popover" hidden><small>Livekvalitet</small>${camera.qualityOptions.map((option) => `<button type="button" data-camera-quality="${option.quality}" class="${option.quality === camera.selectedQuality ? "is-active" : ""}"><span>${escapeHtml(option.label)}</span>${option.quality === camera.selectedQuality ? BeastCore.icon("check", { size: 16 }) : ""}</button>`).join("")}</div></div>`;
  }

  function sharedCameraMarkup(camera, options = {}) {
    const className = options.className || "";
    // go2rtc is optional. Without an explicitly configured endpoint the
    // authenticated Home Assistant camera image is the reliable fallback.
    const streamName = GO2RTC_BASE_URL ? (camera.resolvedStreamName || camera.streamName) : null;
    return `<div class="beast-shared-camera ${className}" data-shared-camera="${escapeHtml(camera.slug)}">
      <div class="beast-shared-camera-frame">${streamName ? `<iframe class="beast-shared-camera-live" src="./camera-player.html?v=14&transport=mse&src=${encodeURIComponent(streamName)}${options.audio ? "&audio=1" : ""}" title="${escapeHtml(camera.label)} livekamera" frameborder="0" allow="autoplay"></iframe>` : `<img class="beast-shared-camera-snapshot" data-camera-picture="${escapeHtml(camera.entityPicture || "")}" alt="${escapeHtml(camera.label)}">`}</div>
      ${qualityMenuMarkup(camera)}
      ${options.motion !== false && camera.motion ? `<span class="beast-camera-motion-badge">${BeastCore.icon("bolt", { size: 11 })} ${escapeHtml(camera.motionLabel || "Hændelse")}</span>` : ""}
      ${options.label === false ? "" : `<span class="beast-shared-camera-label">${escapeHtml(camera.label)}</span>`}
    </div>`;
  }

  function wireSharedCameras(root, onQualityChanged) {
    root?.querySelectorAll(".beast-shared-camera-snapshot[data-camera-picture]").forEach((img) => { if (img.dataset.cameraPicture) BeastAuth.setAuthedImageSrc(img, img.dataset.cameraPicture); });
    root?.querySelectorAll("[data-camera-quality-slug]").forEach((menu) => {
      const toggle = menu.querySelector(".beast-camera-quality-toggle"); const popover = menu.querySelector(".beast-camera-quality-popover");
      toggle?.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); const open = toggle.getAttribute("aria-expanded") === "true"; toggle.setAttribute("aria-expanded", String(!open)); popover.hidden = open; });
      popover?.addEventListener("click", (event) => { const button = event.target.closest("[data-camera-quality]"); if (!button) return; event.preventDefault(); event.stopPropagation(); const camera = discoverCameras().find((item) => item.slug === menu.dataset.cameraQualitySlug); setCameraQuality(camera, button.dataset.cameraQuality); onQualityChanged?.(); });
    });
  }

  function hasGo2rtc() { return Boolean(GO2RTC_BASE_URL); }

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
      const streamName = tile?.dataset.streamName || STREAM_NAME_MAP[tile?.dataset.slug];
      if (streamName) { swapSnapshot(img, snapshotUrl(streamName)); return; }
      const state = tile?.dataset.entityId && BeastHaSocket.getState(tile.dataset.entityId);
      if (state?.attributes?.entity_picture) BeastAuth.setAuthedImageSrc(img, state.attributes.entity_picture);
    });
    // The featured view only gets a plain <img> (no go2rtc mapping for
    // that camera) -- refresh it on the same cadence as the strip.
    const featuredImg = containerEl.querySelector(".beast-camera-featured .beast-shared-camera-snapshot");
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
    const cameraLimit = Number(BeastNativePageEditor.option("cameras", "grid", "items", 8));
    const featuredFit = BeastNativePageEditor.option("cameras", "featured", "fit", "cover");
    if (!cameras.length) {
      containerEl.innerHTML = `<p class="beast-music-empty">Ingen kameraer fundet endnu.</p>`;
      return;
    }

    if (!featuredSlug || !cameras.some((c) => c.slug === featuredSlug)) {
      featuredSlug = cameras[0].slug;
    }
    const featured = cameras.find((c) => c.slug === featuredSlug);
    containerEl.innerHTML = `
      <button type="button" class="beast-page-edit-trigger" id="beastCamerasLayoutEdit" aria-label="Rediger kameralayout">⋮</button>
      <div class="beast-camera-featured" data-camera-fit="${featuredFit}">
        ${sharedCameraMarkup(featured, { className: "beast-camera-featured-render", audio: true, label: true, motion: true })}
        ${featured.streamName ? `<button type="button" class="beast-camera-audio-toggle" id="beastCameraAudioToggle" aria-pressed="false">${BeastCore.icon("volume-mute", { size: 17 })}<span>Lyd fra</span></button>` : ""}
      </div>
      <div class="beast-camera-strip" id="beastCameraStrip"></div>
    `;
    wireCameraLayout();
    wireSharedCameras(containerEl, render);
    const iframe = containerEl.querySelector(".beast-camera-featured .beast-shared-camera-live");
    if (iframe) {
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
    }

    const strip = document.getElementById("beastCameraStrip");
    cameras.slice(0, cameraLimit).forEach((camera) => {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = `beast-camera-tile${camera.motion ? " has-motion" : ""}${camera.slug === featuredSlug ? " is-featured" : ""}`;
      tile.dataset.slug = camera.slug;
      tile.dataset.entityId = camera.entityId;
      tile.dataset.streamName = GO2RTC_BASE_URL ? (camera.resolvedStreamName || camera.streamName || "") : "";
      tile.innerHTML = `
        <img class="beast-camera-snapshot" ${GO2RTC_BASE_URL && camera.streamName ? `src="${snapshotUrl(camera.resolvedStreamName || camera.streamName)}"` : ""} alt="" loading="lazy">
        ${camera.motion ? `<span class="beast-camera-motion-badge">${BeastCore.icon("bolt", { size: 10 })}</span>` : ""}
        <span class="beast-camera-label">${escapeHtml(camera.label)}</span>
      `;
      if ((!GO2RTC_BASE_URL || !camera.streamName) && camera.entityPicture) BeastAuth.setAuthedImageSrc(tile.querySelector("img"), camera.entityPicture);
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
    BeastNativePageEditor.mount({ section:"cameras", label:"Kameraer", root:()=>containerEl, host:()=>containerEl, trigger:"#beastCamerasLayoutEdit", onSave:()=>render(), fitCards:(cards)=>cards.map((card)=>card.id === "featured" ? {...card,desktop:{...card.desktop,h:10}} : card.id === "grid" ? {...card,desktop:{...card.desktop,h:2}} : card), cards:()=>[
      { id:"featured", label:"Stort livekamera", selector:".beast-camera-featured", enabled:!hidden.has("featured"), desktop:{x:1,y:1,w:12,h:10}, options:{fit:"cover"}, controls:[{key:"fit",label:"Billedtilpasning",type:"select",default:"cover",choices:[{value:"cover",label:"Fyld kortet"},{value:"contain",label:"Vis hele billedet"}]}] },
      { id:"grid", label:"Kameravælger", selector:".beast-camera-strip", enabled:!hidden.has("grid"), desktop:{x:1,y:11,w:12,h:2}, options:{items:8}, controls:[{key:"items",label:"Antal kameraer",min:1,max:16,step:1,default:8}] }
    ] });
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
    BeastHaSocket.subscribeDomain("binary_sensor", (entityId) => {
      if (isSmartDetectionEntity(entityId)) updateMotionBadges();
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
    resolveGroup: (entityIdOrSlug) => { const slug = cameraIdentity(entityIdOrSlug || "").slug; return discoverCameras().find((camera) => camera.slug === slug) || null; },
    snapshotUrl,
    swapSnapshot,
    setQuality: (slug, quality) => setCameraQuality(discoverCameras().find((camera) => camera.slug === slug), quality),
    qualityLabel,
    sharedCameraMarkup,
    wireSharedCameras,
    hasGo2rtc,
    isSmartDetectionEntity
  };
})();
