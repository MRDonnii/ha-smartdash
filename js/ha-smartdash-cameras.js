(function () {
  let GO2RTC_BASE_URL = "";
  let configuredCameraIds = null;
  let go2rtcStreamGroups = new Map();
  let go2rtcDiscoveryPromise = null;
  const SNAPSHOT_REFRESH_MS = 8000;

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

  function normalizedStreamKey(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function streamIdentity(streamName) {
    const raw = normalizedStreamKey(streamName);
    const match = raw.match(/_(high|medium|low|hd|sd|sub|main)(?:_stream|_resolution|_channel)?$/i);
    const token = match?.[1]?.toLowerCase();
    const quality = ({ high:"high", hd:"high", main:"high", medium:"medium", sd:"medium", low:"low", sub:"low" })[token] || "standard";
    return { base: match ? raw.slice(0, -match[0].length) : raw, quality };
  }

  async function discoverGo2rtcStreams(force = false) {
    if (!GO2RTC_BASE_URL) { go2rtcStreamGroups = new Map(); return go2rtcStreamGroups; }
    if (go2rtcDiscoveryPromise && !force) return go2rtcDiscoveryPromise;
    go2rtcDiscoveryPromise = fetch(`${GO2RTC_BASE_URL}/api/streams`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((payload) => {
        const groups = new Map();
        Object.keys(payload && typeof payload === "object" ? payload : {}).forEach((streamName) => {
          const identity = streamIdentity(streamName);
          if (!identity.base) return;
          if (!groups.has(identity.base)) groups.set(identity.base, []);
          groups.get(identity.base).push({ streamName, quality: identity.quality });
        });
        const rank = { high:0, standard:1, medium:2, low:3 };
        groups.forEach((variants) => {
          if (variants.length > 1 && variants.some((item) => item.quality !== "standard")) {
            variants.forEach((item) => { if (item.quality === "standard") item.quality = "high"; });
          }
          variants.sort((a,b) => (rank[a.quality] ?? 9) - (rank[b.quality] ?? 9) || a.streamName.localeCompare(b.streamName));
        });
        go2rtcStreamGroups = groups;
        return groups;
      })
      .catch((error) => {
        console.warn("[Kameraer] Kunne ikke hente streamlisten fra go2rtc", error);
        go2rtcStreamGroups = new Map();
        return go2rtcStreamGroups;
      })
      .finally(() => { go2rtcDiscoveryPromise = null; });
    return go2rtcDiscoveryPromise;
  }

  function go2rtcVariantsForCamera(slug) {
    const key = normalizedStreamKey(slug);
    return go2rtcStreamGroups.get(key) || go2rtcStreamGroups.get(key.replace(/_camera$/, "")) || [];
  }

  function reconcileSavedCameraQualities() {
    const current = BeastConfig.get("pageLayouts.cameras.qualityByCamera") || {};
    const next = { ...current };
    let changed = false;
    discoverCameras().forEach((camera) => {
      if (!Object.prototype.hasOwnProperty.call(next, camera.slug)) return;
      if (camera.qualityOptions.some((option) => option.quality === next[camera.slug])) return;
      delete next[camera.slug]; changed = true;
    });
    return changed ? BeastConfig.set("pageLayouts.cameras.qualityByCamera", next) : Promise.resolve({ success:true });
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
    const streamVariants = go2rtcVariantsForCamera(slug);
    const streamName = streamVariants[0]?.streamName || null;
    const detection = smartDetectionForCamera(slug);
    const cameraToken = state.attributes.access_token || null;
    return {
      slug,
      quality: identity.quality,
      entityId,
      streamName, streamVariants,
      haStreamUrl: cameraToken ? `${BeastAuth.HA_PROXY_PATH}/api/camera_proxy_stream/${entityId}?token=${encodeURIComponent(cameraToken)}` : null,
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
      const streamVariants = go2rtcVariantsForCamera(variants[0].slug);
      const qualityOptions = streamVariants.length
        ? streamVariants.map((variant, index) => ({
            quality: streamVariants.filter((item) => item.quality === variant.quality).length > 1 ? `stream:${index}` : variant.quality,
            label: variant.quality === "standard" && streamVariants.length > 1 ? variant.streamName : qualityLabel(variant.quality),
            streamName: variant.streamName
          }))
        : variants.map((variant) => ({ quality: variant.quality, label: qualityLabel(variant.quality), entityId: variant.entityId }));
      const preferred = qualityByCamera[variants[0].slug];
      const selectedOption = qualityOptions.find((option) => option.quality === preferred)
        || qualityOptions.find((option) => option.quality === "high") || qualityOptions[0];
      const selected = selectedOption?.entityId ? (variants.find((variant) => variant.entityId === selectedOption.entityId) || variants[0]) : variants[0];
      const selectedQuality = selectedOption?.quality || selected.quality;
      const resolvedStreamName = selectedOption?.streamName || selected.streamName || null;
      return { ...selected, variants, selectedQuality, qualityOptions, useSub: selectedQuality === "low", resolvedStreamName, streamName: resolvedStreamName || selected.streamName };
    });
    const savedOrder = BeastConfig.get("pageLayouts.cameras.cameraOrder") || [];
    const orderIndex = new Map((Array.isArray(savedOrder) ? savedOrder : []).map((slug, index) => [slug, index]));
    cameras.sort((a, b) => {
      const aIndex = orderIndex.has(a.slug) ? orderIndex.get(a.slug) : Number.MAX_SAFE_INTEGER;
      const bIndex = orderIndex.has(b.slug) ? orderIndex.get(b.slug) : Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return a.label.localeCompare(b.label, "da-DK");
    });
    return cameras;
  }

  function openCameraOrder() {
    document.getElementById("beastCameraOrderModal")?.remove();
    const cameras = discoverCameras();
    const cameraBySlug = new Map(cameras.map((camera) => [camera.slug, camera]));
    const ordered = cameras.map((camera) => camera.slug);
    const overlay = document.createElement("div");
    overlay.id = "beastCameraOrderModal";
    overlay.className = "beast-modal-overlay";
    overlay.innerHTML = `<div class="beast-modal beast-camera-order-modal" role="dialog" aria-modal="true"><div class="beast-modal-header"><div><small>Kameravælger</small><h3>Rækkefølge på kameraer</h3></div><button type="button" class="beast-modal-close" data-close>×</button></div><div class="beast-modal-body"><p class="beast-page-editor-hint">Flyt de fysiske kameraer. Kameraets kvaliteter følger automatisk med.</p><div class="beast-camera-order-list"></div><button type="button" class="beast-btn beast-btn-primary" data-save-camera-order>Gem rækkefølge</button></div></div>`;
    const renderRows = () => {
      overlay.querySelector(".beast-camera-order-list").innerHTML = ordered.map((slug, index) => {
        const camera = cameraBySlug.get(slug);
        return `<article data-camera-order="${escapeHtml(slug)}"><b>${index + 1}</b><span><strong>${escapeHtml(camera?.label || slug)}</strong><small>${escapeHtml(camera?.entityId || "")}</small></span><div><button type="button" data-camera-up aria-label="Flyt op" ${index ? "" : "disabled"}>↑</button><button type="button" data-camera-down aria-label="Flyt ned" ${index < ordered.length - 1 ? "" : "disabled"}>↓</button></div></article>`;
      }).join("");
    };
    renderRows();
    document.body.appendChild(overlay);
    overlay.addEventListener("click", async (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) return overlay.remove();
      const row = event.target.closest("[data-camera-order]");
      if (row && (event.target.closest("[data-camera-up]") || event.target.closest("[data-camera-down]"))) {
        const index = ordered.indexOf(row.dataset.cameraOrder);
        const next = event.target.closest("[data-camera-up]") ? index - 1 : index + 1;
        if (next >= 0 && next < ordered.length) [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
        renderRows();
        return;
      }
      if (!event.target.closest("[data-save-camera-order]")) return;
      await BeastConfig.set("pageLayouts.cameras.cameraOrder", ordered);
      overlay.remove();
      render();
    });
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

  // GO2RTC_BASE_URL is only assigned in init(), i.e. when the Cameras panel
  // itself mounts. Anything that renders a camera before that (the overview
  // alert banners, in particular) would see it empty and silently fall back
  // to Home Assistant's own MJPEG proxy stream -- a real live picture, so
  // nothing looks broken, but a far less resilient one than the WebRTC
  // player, and prone to exactly the stall/reconnect flicker that transport
  // is meant to absorb. Reading straight from config makes the choice
  // independent of panel init order.
  function go2rtcBaseUrl() {
    return GO2RTC_BASE_URL || String(BeastConfig.get("panels.cameras.go2rtcBaseUrl") || "").replace(/\/+$/, "");
  }

  function sharedCameraMarkup(camera, options = {}) {
    const className = options.className || "";
    // go2rtc is optional. Without an explicitly configured endpoint the
    // authenticated Home Assistant camera image is the reliable fallback.
    const baseUrl = go2rtcBaseUrl();
    const streamName = baseUrl ? (camera.resolvedStreamName || camera.streamName) : null;
    // haStreamUrl points at Home Assistant's own /api/camera_proxy_stream/,
    // a continuously proxied (often transcoded) MJPEG feed -- much heavier
    // to establish on the HA host than the single-frame snapshot the
    // thumbnail strip already uses successfully, and the actual cause of
    // "shows a picture eventually, just takes forever": callers that pass
    // liveFallback:false skip it and go straight to the same fast snapshot.
    const useHaStream = options.liveFallback !== false && camera.haStreamUrl;
    return `<div class="beast-shared-camera ${className}" data-shared-camera="${escapeHtml(camera.slug)}">
      <div class="beast-shared-camera-frame">${streamName ? `<iframe class="beast-shared-camera-live" src="./camera-player.html?v=19&base=${encodeURIComponent(baseUrl)}&transport=webrtc&src=${encodeURIComponent(streamName)}${options.audio ? "&audio=1" : ""}" title="${escapeHtml(camera.label)} livekamera" frameborder="0" allow="autoplay"></iframe>` : useHaStream ? `<img class="beast-shared-camera-live beast-shared-camera-ha-stream" src="${escapeHtml(camera.haStreamUrl)}" data-camera-fallback-picture="${escapeHtml(camera.entityPicture || "")}" alt="${escapeHtml(camera.label)} livekamera">` : `<img class="beast-shared-camera-snapshot" data-camera-picture="${escapeHtml(camera.entityPicture || "")}" alt="${escapeHtml(camera.label)}">`}</div>
      ${qualityMenuMarkup(camera)}
      ${options.motion !== false && camera.motion ? `<span class="beast-camera-motion-badge">${BeastCore.icon("bolt", { size: 11 })} ${escapeHtml(camera.motionLabel || "Hændelse")}</span>` : ""}
      ${options.label === false ? "" : `<span class="beast-shared-camera-label">${escapeHtml(camera.label)}</span>`}
    </div>`;
  }

  function wireSharedCameras(root, onQualityChanged) {
    // Skip images a caller already loaded itself (selectFeaturedCamera awaits
    // the fetch before swapping the element in, then calls this to wire the
    // quality menu) -- re-fetching here would start a second, redundant
    // request and immediately revoke the blob URL just handed to the image.
    root?.querySelectorAll(".beast-shared-camera-snapshot[data-camera-picture]").forEach((img) => { if (img.dataset.cameraPicture && !img.dataset.objectUrl) BeastAuth.setAuthedImageSrc(img, img.dataset.cameraPicture); });
    root?.querySelectorAll(".beast-shared-camera-ha-stream[data-camera-fallback-picture]").forEach((img) => {
      img.addEventListener("error", () => {
        const picture = img.dataset.cameraFallbackPicture;
        img.classList.remove("beast-shared-camera-ha-stream");
        img.classList.add("beast-shared-camera-snapshot");
        if (picture) BeastAuth.setAuthedImageSrc(img, picture);
      }, { once: true });
    });
    root?.querySelectorAll("[data-camera-quality-slug]").forEach((menu) => {
      const toggle = menu.querySelector(".beast-camera-quality-toggle"); const popover = menu.querySelector(".beast-camera-quality-popover");
      toggle?.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); const open = toggle.getAttribute("aria-expanded") === "true"; toggle.setAttribute("aria-expanded", String(!open)); popover.hidden = open; });
      popover?.addEventListener("click", (event) => { const button = event.target.closest("[data-camera-quality]"); if (!button) return; event.preventDefault(); event.stopPropagation(); const camera = discoverCameras().find((item) => item.slug === menu.dataset.cameraQualitySlug); setCameraQuality(camera, button.dataset.cameraQuality); onQualityChanged?.(); });
    });
  }

  // Same init-order independence as sharedCameraMarkup() above -- callers
  // gate whole live-camera views on this (doorbell, pool, screensaver).
  function hasGo2rtc() { return Boolean(go2rtcBaseUrl()); }

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
      const streamName = tile?.dataset.streamName || go2rtcVariantsForCamera(tile?.dataset.slug)[0]?.streamName;
      if (streamName) { swapSnapshot(img, snapshotUrl(streamName)); return; }
      // Reads state.attributes.entity_picture through cameraInfoFor()'s own
      // fallback (some integrations expose a valid camera entity without an
      // entity_picture attribute at all) instead of the raw attribute --
      // otherwise every periodic refresh silently no-ops for those cameras
      // and the tile just keeps showing whatever frame it loaded once, on
      // the very first render, forever.
      const entityPicture = tile?.dataset.entityId && cameraInfoFor(tile.dataset.entityId)?.entityPicture;
      if (entityPicture) BeastAuth.setAuthedImageSrc(img, entityPicture);
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

  // Wires the audio toggle and the go2rtc iframe's initial mute state on
  // whichever element currently holds the featured camera's markup. Split
  // out of render() so selectFeaturedCamera() can re-run it after an
  // in-place swap without touching the rest of the panel.
  function wireFeaturedMedia(featuredWrap) {
    const iframe = featuredWrap.querySelector(".beast-shared-camera-live");
    if (!iframe || iframe.tagName !== "IFRAME") return;
    iframe.contentWindow?.postMessage({ type: "camera-player-audio", muted: true }, window.location.origin);
    const audioButton = featuredWrap.querySelector("#beastCameraAudioToggle");
    audioButton?.addEventListener("click", () => {
      const muted = audioButton.getAttribute("aria-pressed") === "true";
      audioButton.setAttribute("aria-pressed", String(!muted));
      audioButton.innerHTML = muted
        ? `${BeastCore.icon("volume-mute", { size: 17 })}<span>Lyd fra</span>`
        : `${BeastCore.icon("volume", { size: 17 })}<span>Lyd til</span>`;
      iframe.contentWindow?.postMessage({ type: "camera-player-audio", muted }, window.location.origin);
    });
  }

  // Resolves once the new featured camera's media has actually produced a
  // frame (or failed/timed out) -- never before. This is what lets the old
  // picture stay on screen for the whole handover instead of going black
  // the instant the element is created.
  async function waitForFeaturedMedia(host) {
    const timeout = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const live = host.querySelector(".beast-shared-camera-live");
    if (live && live.tagName === "IFRAME") {
      // camera-player.html already solves exactly this problem *inside*
      // itself: it shows its own poster snapshot the instant it can fetch
      // one and smoothly crossfades to live video only once frames are
      // actually flowing (see its "ready" class / markReady()). The
      // iframe's DOM "load" event fires when that HTML shell finishes
      // parsing, which happens well before any of that -- waiting on it
      // here just delayed revealing the iframe until after its poster
      // fetch had *also* had time to run, so what should have been an
      // instant handoff from our own placeholder to camera-player.html's
      // own poster instead showed its blank pre-poster state as a second,
      // spurious black flash. Swap it in immediately and let it manage its
      // own loading state, same as before any of this staged-swap logic
      // existed.
      return;
    }
    if (live && live.tagName === "IMG") {
      if (live.complete && live.naturalWidth) return;
      await Promise.race([
        new Promise((resolve) => {
          live.addEventListener("load", resolve, { once: true });
          // Same HA-stream-unavailable fallback wireSharedCameras() wires for
          // *later* failures -- needed here too because by the time this
          // element is handed to wireSharedCameras() after the swap, the
          // {once:true} error listener it attaches would already have missed
          // an error that happened during this initial load.
          live.addEventListener("error", () => {
            const picture = live.dataset.cameraFallbackPicture;
            if (live.classList.contains("beast-shared-camera-ha-stream") && picture) {
              live.classList.remove("beast-shared-camera-ha-stream");
              live.classList.add("beast-shared-camera-snapshot");
              BeastAuth.setAuthedImageSrc(live, picture).then(resolve);
            } else {
              resolve();
            }
          }, { once: true });
        }),
        timeout(8000)
      ]);
      return;
    }
    const snapshotImg = host.querySelector(".beast-shared-camera-snapshot[data-camera-picture]");
    if (!snapshotImg) return;
    const picture = snapshotImg.dataset.cameraPicture;
    if (!picture) return;
    // A single transient fetch failure (HA momentarily busy, a brief network
    // hiccup) used to swap in a blank picture immediately and rely entirely
    // on the next 8-second periodic refresh to fill it back in. Try a couple
    // more times first, with a short backoff, before accepting defeat.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const ok = await BeastAuth.setAuthedImageSrc(snapshotImg, picture);
      if (ok || attempt === 2 || !host.isConnected) return;
      await timeout(500 * (attempt + 1));
    }
  }

  // A lightweight stand-in for the clicked camera while its real stream or
  // full picture is still loading -- just a label and a snapshot, reusing
  // the clicked tile's own already-decoded thumbnail (instant, nothing to
  // wait for) when there is one, so the featured view reflects the picked
  // camera immediately instead of either continuing to show the *previous*
  // camera's live feed or going black.
  function placeholderCameraMarkup(camera, reuseSrc) {
    return `<div class="beast-shared-camera beast-camera-featured-render is-placeholder" data-shared-camera="${escapeHtml(camera.slug)}">
      <div class="beast-shared-camera-frame"><img class="beast-shared-camera-snapshot"${reuseSrc ? ` src="${escapeHtml(reuseSrc)}"` : ""} data-camera-picture="${escapeHtml(camera.entityPicture || "")}" alt="${escapeHtml(camera.label)}"></div>
      ${camera.motion ? `<span class="beast-camera-motion-badge">${BeastCore.icon("bolt", { size: 11 })} ${escapeHtml(camera.motionLabel || "Hændelse")}</span>` : ""}
      <span class="beast-shared-camera-label">${escapeHtml(camera.label)}</span>
    </div>`;
  }

  // Switching the featured camera used to call render(), which tore down
  // and recreated every tile and the featured view via containerEl.innerHTML
  // -- blanking every <img> (including the seven cameras nobody clicked) and
  // refetching them from scratch, several seconds of black tiles on
  // anything but a fast link. This instead toggles the tile highlight in
  // place, shows an instant snapshot placeholder for the newly picked
  // camera, builds the real content off to the side, and only swaps the
  // placeholder out once that real media is actually ready.
  function selectFeaturedCamera(camera) {
    if (!camera) return;
    const featuredWrap = containerEl?.querySelector(".beast-camera-featured");
    if (!containerEl || !featuredWrap) { featuredSlug = camera.slug; if (containerEl) render(); return; }
    if (camera.slug === featuredSlug) return;
    featuredSlug = camera.slug;
    containerEl.querySelectorAll(".beast-camera-tile").forEach((tile) => {
      tile.classList.toggle("is-featured", tile.dataset.slug === camera.slug);
    });

    const clickedTileImg = containerEl.querySelector(`.beast-camera-tile[data-slug="${CSS.escape(camera.slug)}"] .beast-camera-snapshot`);
    const tileImgSrc = clickedTileImg?.getAttribute("src") || null;
    // A blob: URL is already-decoded data sitting in memory -- reusing the
    // string is instant and can't fail. Anything else (a go2rtc tile's
    // plain http(s) frame.jpeg URL) is a *live* URL with no guarantee the
    // browser will serve it from cache -- reusing that string directly
    // fires a fresh network request with no fallback if it 404s or times
    // out, which is exactly what showed up as "tries to show a snapshot
    // but it's not there". Only trust it inline for blob:; anything else
    // gets preloaded and verified first via swapSnapshot(), same as the
    // periodic tile refresh already does.
    const isInstantReuse = tileImgSrc?.startsWith("blob:");
    const priorNodes = Array.from(featuredWrap.children);
    const priorObjectUrl = priorNodes.map((node) => node.querySelector?.(".beast-shared-camera-snapshot")?.dataset.objectUrl).find(Boolean);
    priorNodes.forEach((node) => node.remove());
    const placeholderHost = document.createElement("div");
    placeholderHost.innerHTML = placeholderCameraMarkup(camera, isInstantReuse ? tileImgSrc : null);
    featuredWrap.appendChild(placeholderHost.firstElementChild);
    const placeholderImg = featuredWrap.querySelector(".is-placeholder .beast-shared-camera-snapshot");
    if (isInstantReuse) {
      // already showing, nothing more to do
    } else if (tileImgSrc && clickedTileImg.complete && clickedTileImg.naturalWidth) {
      swapSnapshot(placeholderImg, tileImgSrc).then((succeeded) => {
        if (!succeeded && camera.entityPicture) BeastAuth.setAuthedImageSrc(placeholderImg, camera.entityPicture);
      });
    } else if (camera.entityPicture) {
      BeastAuth.setAuthedImageSrc(placeholderImg, camera.entityPicture);
    }
    if (priorObjectUrl) URL.revokeObjectURL(priorObjectUrl);

    const host = document.createElement("div");
    host.style.cssText = "position:absolute;inset:0;visibility:hidden;pointer-events:none;";
    host.innerHTML = `${sharedCameraMarkup(camera, { className: "beast-camera-featured-render", audio: true, label: true, motion: true, liveFallback: false })}${camera.streamName ? `<button type="button" class="beast-camera-audio-toggle" id="beastCameraAudioToggle" aria-pressed="false">${BeastCore.icon("volume-mute", { size: 17 })}<span>Lyd fra</span></button>` : ""}`;
    featuredWrap.appendChild(host);
    waitForFeaturedMedia(host).then(() => {
      // A later click may have superseded this one while we were waiting.
      if (featuredSlug !== camera.slug || !host.isConnected) { host.remove(); return; }
      const staleNodes = Array.from(featuredWrap.children).filter((node) => node !== host);
      const staleObjectUrl = staleNodes.map((node) => node.querySelector?.(".beast-shared-camera-snapshot")?.dataset.objectUrl).find(Boolean);
      staleNodes.forEach((node) => node.remove());
      host.removeAttribute("style");
      while (host.firstChild) featuredWrap.appendChild(host.firstChild);
      host.remove();
      wireFeaturedMedia(featuredWrap);
      wireSharedCameras(featuredWrap, render);
      if (staleObjectUrl) URL.revokeObjectURL(staleObjectUrl);
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
        ${sharedCameraMarkup(featured, { className: "beast-camera-featured-render", audio: true, label: true, motion: true, liveFallback: false })}
        ${featured.streamName ? `<button type="button" class="beast-camera-audio-toggle" id="beastCameraAudioToggle" aria-pressed="false">${BeastCore.icon("volume-mute", { size: 17 })}<span>Lyd fra</span></button>` : ""}
      </div>
      <div class="beast-camera-strip" id="beastCameraStrip"></div>
    `;
    wireCameraLayout();
    wireSharedCameras(containerEl, render);
    wireFeaturedMedia(containerEl.querySelector(".beast-camera-featured"));

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
        selectFeaturedCamera(camera);
      });
      strip.appendChild(tile);
    });
  }

  function wireCameraLayout() {
    const layout = BeastConfig.get("pageLayouts.cameras.cameraLayout") || {};
    const hidden = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
    containerEl.querySelector(".beast-camera-featured")?.classList.toggle("is-layout-hidden", hidden.has("featured"));
    containerEl.querySelector(".beast-camera-strip")?.classList.toggle("is-layout-hidden", hidden.has("grid"));
    BeastNativePageEditor.mount({ section:"cameras", label:"Kameraer", root:()=>containerEl, host:()=>containerEl, trigger:"#beastCamerasLayoutEdit", onSave:()=>render(), onSettingsAction:(action)=>{ if(action === "cameraOrder") openCameraOrder(); }, fitCards:(cards)=>cards.map((card)=>card.id === "featured" ? {...card,desktop:{...card.desktop,h:10}} : card.id === "grid" ? {...card,desktop:{...card.desktop,h:2}} : card), cards:()=>[
      { id:"featured", label:"Stort livekamera", selector:".beast-camera-featured", enabled:!hidden.has("featured"), desktop:{x:1,y:1,w:12,h:10}, options:{fit:"cover"}, controls:[{key:"fit",label:"Billedtilpasning",type:"select",default:"cover",choices:[{value:"cover",label:"Fyld kortet"},{value:"contain",label:"Vis hele billedet"}]}] },
      { id:"grid", label:"Kameravælger", selector:".beast-camera-strip", enabled:!hidden.has("grid"), desktop:{x:1,y:11,w:12,h:2}, options:{items:8}, controls:[{key:"items",label:"Antal kameraer",min:1,max:16,step:1,default:8},{key:"cameraOrder",label:"Kamerarækkefølge",type:"action",icon:"grip"}] }
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
    discoverGo2rtcStreams().then(() => reconcileSavedCameraQualities()).then(() => {
      render();
      document.dispatchEvent(new CustomEvent("beast:camera-streams-changed"));
    });
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
    selectCamera: (slug) => {
      const camera = discoverCameras().find((item) => item.slug === slug);
      if (!camera) return false;
      selectFeaturedCamera(camera);
      return true;
    },
    snapshotUrl,
    swapSnapshot,
    setQuality: (slug, quality) => setCameraQuality(discoverCameras().find((camera) => camera.slug === slug), quality),
    qualityLabel,
    sharedCameraMarkup,
    wireSharedCameras,
    hasGo2rtc,
    isSmartDetectionEntity,
    refreshStreams: () => discoverGo2rtcStreams(true).then(() => reconcileSavedCameraQualities()).then(() => {
      render(); document.dispatchEvent(new CustomEvent("beast:camera-streams-changed")); return discoverCameras();
    }),
    // For pages that need go2rtc's stream list (to tell which camera
    // entities will actually get a live WebRTC feed vs HA's own slower
    // proxy stream -- see Administration's camera picker) but never mount
    // the Cameras panel itself, so discoverGo2rtcStreams() would otherwise
    // never run and GO2RTC_BASE_URL would stay empty. Safe to call
    // regardless of whether the Cameras panel is mounted -- unlike
    // refreshStreams(), this never touches containerEl/render().
    ensureStreamDiscovery: (baseUrl) => {
      if (baseUrl) GO2RTC_BASE_URL = baseUrl;
      return discoverGo2rtcStreams();
    }
  };
})();
