(function () {
  const SELECTED_PLAYER_KEY = "beast_panel_music_selected_player_v1";
  const CATEGORY_ALLOWLIST = ["playlists", "albums", "radio"];
  const CATEGORY_LABELS = { playlists: "Playlister", albums: "Albummer", radio: "Radio" };
  const DIRECT_CATEGORIES = [
    { media_content_id: "playlists", media_type: "playlist", title: "Playlister" },
    { media_content_id: "albums", media_type: "album", title: "Albummer" },
    { media_content_id: "radio", media_type: "radio", title: "Radio" }
  ];
  function musicConfigEntryId() { return BeastConfig.get("panels.music.configEntryId"); }
  const SEARCH_DEBOUNCE_MS = 350;
  function stereoGroups() { return BeastConfig.get("panels.music.stereoGroups") || {}; }

  let containerEl = null;
  let selectedEntityId = localStorage.getItem(SELECTED_PLAYER_KEY) || "";
  let progressTickerId = null;
  let progressState = null;
  let activeCategoryId = null;
  let searchQuery = "";
  let searchToken = 0;
  let searchDebounceId = null;
  let playerRenderTimerId = null;
  let libraryVisibleCount = 18;
  let speakerPanelOpen = false;
  let speakerFeedbackMessage = "";
  let speakerFeedbackType = "";
  const categoriesByPlayer = new Map();
  const failedLibraryPlayers = new Set();
  const gridCache = new Map();
  const detailCache = new Map();
  const playerRenderSignatures = new Map();
  const linkedPlayersByLeader = new Map();

  function findItems(payload) {
    if (!payload || typeof payload !== "object") return null;
    if (Array.isArray(payload.items)) return payload.items;
    for (const value of Object.values(payload)) {
      if (value && typeof value === "object") {
        const found = findItems(value);
        if (found) return found;
      }
    }
    return null;
  }

  async function getLibraryItems(category) {
    const cacheKey = `library:${category.media_type}`;
    if (gridCache.has(cacheKey)) return gridCache.get(cacheKey);
    const response = await BeastAuth.haFetch("/api/services/music_assistant/get_library?return_response=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config_entry_id: musicConfigEntryId(),
        media_type: category.media_type,
        limit: 48,
        order_by: "name"
      })
    });
    const items = findItems(response?.service_response || response) || [];
    gridCache.set(cacheKey, items);
    return items;
  }

  function isMusicAssistantPlayer(state) {
    return Boolean(state && state.entity_id && state.entity_id.startsWith("media_player.") && state.attributes && state.attributes.app_id === "music_assistant");
  }

  function stereoGroupInfo(entityId) {
    return stereoGroups()[entityId] || null;
  }

  function getPlayers() {
    const visiblePlayers = BeastConfig.get("panels.music.visiblePlayers");
    const allowed = Array.isArray(visiblePlayers) ? new Set(visiblePlayers) : null;
    return Array.from(BeastHaSocket.getAllStates().values())
      .filter((state) => isMusicAssistantPlayer(state) && (!allowed || allowed.has(state.entity_id)))
      .sort((a, b) => String(a.attributes.friendly_name || "").localeCompare(String(b.attributes.friendly_name || ""), "da-DK"));
  }

  function pickActivePlayer(players) {
    if (!players.length) return null;
    if (selectedEntityId) {
      const found = players.find((p) => p.entity_id === selectedEntityId);
      if (found) return found;
    }
    const usable = players.filter((p) => !failedLibraryPlayers.has(p.entity_id));
    const pool = usable.length ? usable : players;
    return pool.find((p) => p.state === "playing") || pool[0];
  }

  function selectPlayer(entityId) {
    selectedEntityId = entityId;
    localStorage.setItem(SELECTED_PLAYER_KEY, entityId);
    render();
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function callService(domain, service, entityId, data = {}) {
    return BeastAuth.haFetch(`/api/services/${domain}/${service}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_id: entityId, ...data })
    }).catch((error) => {
      BeastCore.log(`Musik: kommando fejlede (${error.message}).`);
    });
  }

  function callServiceStrict(domain, service, entityId, data = {}) {
    return BeastAuth.haFetch(`/api/services/${domain}/${service}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entity_id: entityId, ...data })
    });
  }

  function playerGroupIds(players, player) {
    const ownMembers = Array.isArray(player?.attributes?.group_members)
      ? player.attributes.group_members.filter(Boolean)
      : [];
    if (ownMembers.length > 1) return ownMembers;
    const related = players.find((candidate) => {
      const members = candidate.attributes?.group_members;
      return Array.isArray(members) && members.length > 1 && members.includes(player.entity_id);
    });
    return related ? related.attributes.group_members.filter(Boolean) : [player.entity_id];
  }

  function linkedPlayerIds(leaderId) {
    if (!linkedPlayersByLeader.has(leaderId)) linkedPlayersByLeader.set(leaderId, new Set());
    return linkedPlayersByLeader.get(leaderId);
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function mirrorCurrentPlayback(activePlayer, targetPlayer, leaderId) {
    const attrs = activePlayer.attributes || {};
    if (!attrs.media_content_id) throw new Error("MEDIA_CONTENT_MISSING");
    await callServiceStrict("media_player", "play_media", targetPlayer.entity_id, {
      media_content_id: attrs.media_content_id,
      media_content_type: attrs.media_content_type || "music"
    });
    const updatedAt = attrs.media_position_updated_at ? new Date(attrs.media_position_updated_at).getTime() : Date.now();
    const runningOffset = activePlayer.state === "playing" ? Math.max(0, (Date.now() - updatedAt) / 1000) : 0;
    const position = Math.max(0, (Number(attrs.media_position) || 0) + runningOffset);
    await sleep(900);
    if (position > 1) {
      await callServiceStrict("media_player", "media_seek", targetPlayer.entity_id, { seek_position: position });
    }
    linkedPlayerIds(leaderId).add(targetPlayer.entity_id);
  }

  function setGroupFeedback(message, type = "") {
    speakerFeedbackMessage = message;
    speakerFeedbackType = type;
    const feedback = document.getElementById("beastSpeakerFeedback");
    if (!feedback) return;
    feedback.textContent = message;
    feedback.className = `beast-speaker-feedback${type ? ` is-${type}` : ""}`;
  }

  async function changeSpeakerGroup(players, activePlayer, player, shouldJoin, button) {
    const activeGroup = playerGroupIds(players, activePlayer);
    const leaderId = activeGroup[0] || activePlayer.entity_id;
    const linkedPlayers = linkedPlayerIds(leaderId);
    const playerName = player.attributes.friendly_name || player.entity_id;
    const originalHtml = button?.innerHTML;
    if (button) {
      button.disabled = true;
      button.classList.add("is-busy");
      button.innerHTML = `<span>${shouldJoin ? "Tilslutter…" : "Frakobler…"}</span>`;
    }
    setGroupFeedback(`${shouldJoin ? "Tilslutter" : "Frakobler"} ${playerName}…`);
    try {
      if (shouldJoin) {
        const oldGroup = playerGroupIds(players, player);
        if (oldGroup.length > 1 && !activeGroup.includes(player.entity_id)) {
          await callServiceStrict("media_player", "unjoin", player.entity_id);
        }
        await callServiceStrict("media_player", "join", leaderId, { group_members: [player.entity_id] });
        await sleep(750);
        const leaderState = await BeastAuth.haFetch(`/api/states/${encodeURIComponent(leaderId)}`);
        const nativeMembers = Array.isArray(leaderState?.attributes?.group_members) ? leaderState.attributes.group_members : [];
        if (!nativeMembers.includes(player.entity_id)) {
          setGroupFeedback(`Starter samme musik på ${playerName}…`);
          await mirrorCurrentPlayback(activePlayer, player, leaderId);
          setGroupFeedback(`${playerName} afspiller med · uden fast synkronisering.`, "success");
        } else {
          linkedPlayers.delete(player.entity_id);
          setGroupFeedback(`${playerName} er tilsluttet.`, "success");
        }
      } else {
        if (linkedPlayers.has(player.entity_id)) {
          await callServiceStrict("media_player", "media_stop", player.entity_id);
          linkedPlayers.delete(player.entity_id);
        } else {
          await callServiceStrict("media_player", "unjoin", player.entity_id);
        }
        setGroupFeedback(`${playerName} er frakoblet.`, "success");
      }
      window.setTimeout(render, 700);
    } catch (error) {
      BeastCore.log(`Musik: gruppering fejlede for ${player.entity_id} (${error.message}).`);
      setGroupFeedback(`Kunne ikke ${shouldJoin ? "tilslutte" : "frakoble"} ${playerName}.`, "error");
      if (button) {
        button.disabled = false;
        button.classList.remove("is-busy");
        button.innerHTML = originalHtml;
      }
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function stopProgressTicker() {
    if (progressTickerId) window.clearInterval(progressTickerId);
    progressTickerId = null;
  }

  function startProgressTicker() {
    stopProgressTicker();
    progressTickerId = window.setInterval(() => {
      if (!progressState) return;
      const fillEl = document.getElementById("beastProgressFill");
      const elapsedEl = document.getElementById("beastProgressElapsed");
      const durationEl = document.getElementById("beastProgressDuration");
      if (!fillEl) return;
      let elapsedNow = progressState.startElapsed;
      if (progressState.playing) elapsedNow += (Date.now() - progressState.startedAtMs) / 1000;
      const clamped = Math.max(0, Math.min(progressState.duration || 0, elapsedNow));
      const pct = progressState.duration ? (clamped / progressState.duration) * 100 : 0;
      fillEl.style.width = `${pct}%`;
      elapsedEl.textContent = formatDuration(clamped);
      durationEl.textContent = formatDuration(progressState.duration);
    }, 500);
  }

  function updateProgressState(state) {
    const attrs = state.attributes;
    const duration = Number(attrs.media_duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      progressState = null;
      return;
    }
    progressState = {
      startElapsed: Number(attrs.media_position) || 0,
      startedAtMs: attrs.media_position_updated_at ? new Date(attrs.media_position_updated_at).getTime() : Date.now(),
      duration,
      playing: state.state === "playing"
    };
  }

  async function ensureCategories(entityId) {
    if (categoriesByPlayer.has(entityId)) return categoriesByPlayer.get(entityId);
    try {
      const result = await BeastHaSocket.sendCommand("media_player/browse_media", {
        entity_id: entityId,
        media_content_type: "music_assistant",
        media_content_id: ""
      });
      const children = Array.isArray(result.children) ? result.children : [];
      const filtered = children.filter((c) => CATEGORY_ALLOWLIST.includes(String(c.media_content_id).toLowerCase()));
      const items = filtered.length ? filtered : children.slice(0, 3);
      categoriesByPlayer.set(entityId, items);
      failedLibraryPlayers.delete(entityId);
      if (!activeCategoryId && items.length) {
        activeCategoryId = items.find((item) => String(item.media_content_id).toLowerCase() === "playlists")?.media_content_id || items[0].media_content_id;
      }
      return items;
    } catch (error) {
      BeastCore.log(`Musik: kunne ikke hente kategorier for ${entityId} (${error.message}).`);
      failedLibraryPlayers.add(entityId);
      return null;
    }
  }

  async function browseCategory(entityId, category) {
    const cacheKey = `${entityId}:${category.media_content_id}`;
    if (gridCache.has(cacheKey)) return gridCache.get(cacheKey);
    const result = await BeastHaSocket.sendCommand("media_player/browse_media", {
      entity_id: entityId,
      media_content_type: category.media_content_type,
      media_content_id: category.media_content_id
    });
    const items = Array.isArray(result.children) ? result.children : [];
    gridCache.set(cacheKey, items);
    return items;
  }

  async function searchLibrary(query) {
    const response = await BeastAuth.haFetch("/api/services/music_assistant/search?return_response=true", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config_entry_id: musicConfigEntryId(),
        name: query,
        media_type: ["playlist", "album", "track", "radio"]
      })
    });
    const payload = (response && response.service_response) || {};
    const buckets = ["playlists", "albums", "tracks", "radio"];
    const items = [];
    buckets.forEach((bucket) => {
      (payload[bucket] || []).forEach((item) => items.push(item));
    });
    return items;
  }

  function renderLoading() {
    containerEl.innerHTML = `<p class="beast-panel-title">Musik</p><p class="beast-music-empty">Henter afspillere…</p>`;
  }

  function render() {
    if (!containerEl) return;
    const players = getPlayers();
    if (!players.length) {
      stopProgressTicker();
      const configured = BeastConfig.get("panels.music.visiblePlayers");
      const emptyText = Array.isArray(configured) && configured.length === 0
        ? "Ingen afspillere er valgt under Administration → Musik."
        : "Ingen Music Assistant-afspillere fundet endnu.";
      containerEl.innerHTML = `<p class="beast-panel-title">Musik</p><p class="beast-music-empty">${emptyText}</p>`;
      return;
    }

    const activePlayer = pickActivePlayer(players);
    selectedEntityId = activePlayer.entity_id;
    const attrs = activePlayer.attributes;
    const playing = activePlayer.state === "playing";
    const nativeGroupIds = playerGroupIds(players, activePlayer);
    const groupLeaderId = nativeGroupIds[0] || activePlayer.entity_id;
    const visibleGroupCount = stereoGroupInfo(activePlayer.entity_id)?.speakers || new Set([...nativeGroupIds, ...linkedPlayerIds(groupLeaderId)]).size;
    const english = window.HASmartdashI18n?.language === "en";
    const playerCountLabel = `${visibleGroupCount} ${english ? (visibleGroupCount === 1 ? "player" : "players") : (visibleGroupCount === 1 ? "afspiller" : "afspillere")}`;

    containerEl.innerHTML = `
      <button type="button" class="beast-page-edit-trigger" id="beastMusicLayoutEdit" aria-label="Rediger musiklayout">⋮</button><div class="beast-music-dashboard">
        <aside class="beast-music-control">
          <header class="beast-music-section-head">
            <button type="button" class="beast-speaker-toggle" id="beastSpeakerToggle" aria-expanded="${speakerPanelOpen}">
              <span class="beast-speaker-toggle-icon">${BeastCore.icon("volume", { size: 22 })}</span>
              <span><small>Afspil på</small><strong>${escapeHtml(attrs.friendly_name || activePlayer.entity_id)}</strong><em>${visibleGroupCount} i gruppen</em></span>
              <span class="beast-speaker-toggle-arrow">⌄</span>
            </button>
            <div class="beast-music-group-actions${speakerPanelOpen ? "" : " is-collapsed"}">
              <button type="button" id="beastGroupAll">${BeastCore.icon("plus", { size: 16 })} Alle</button>
              <button type="button" id="beastUngroupAll">${BeastCore.icon("minus", { size: 16 })} Opløs</button>
            </div>
          </header>
          <div class="beast-speaker-drawer${speakerPanelOpen ? " is-open" : ""}" id="beastSpeakerDrawer">
            <div class="beast-music-players" id="beastMusicPlayers"></div>
            <div class="beast-group-volume" id="beastGroupVolume"></div>
            <p class="beast-speaker-feedback${speakerFeedbackType ? ` is-${speakerFeedbackType}` : ""}" id="beastSpeakerFeedback" aria-live="polite">${escapeHtml(speakerFeedbackMessage)}</p>
          </div>
          <div class="beast-now-playing">
            <div class="beast-now-playing-cover"><img class="beast-now-playing-art" id="beastNowPlayingArt" alt=""><span>${BeastCore.icon("music", { size: 52 })}</span></div>
            <div class="beast-now-playing-body">
                <small class="beast-now-playing-kicker">Afspiller nu</small>
                <div class="beast-now-playing-title" id="beastNowPlayingTitle">${attrs.media_title ? escapeHtml(attrs.media_title) : "Ingen afspilning"}</div>
                <div class="beast-now-playing-artist" id="beastNowPlayingArtist">${escapeHtml(attrs.media_artist || "Vælg musik fra biblioteket")}</div>
                <div class="beast-now-playing-album" id="beastNowPlayingAlbum">${attrs.media_album_name ? `<strong>${escapeHtml(attrs.media_album_name)}</strong><span>Album · ${escapeHtml(attrs.media_artist || "Ukendt kunstner")}</span>` : `<strong>Musikbibliotek</strong><span>Vælg et album, en playliste eller en radiostation</span>`}</div>
                <div class="beast-player-dock">
                  <div class="beast-transport-row">
                    <button type="button" class="beast-transport-btn" id="beastPrevBtn" aria-label="Forrige">${BeastCore.icon("skip-back", { size: 22 })}</button>
                    <button type="button" class="beast-transport-btn beast-play-btn" id="beastPlayBtn" aria-label="${playing ? "Pause" : "Afspil"}">${BeastCore.icon(playing ? "pause" : "play", { size: 27 })}</button>
                    <button type="button" class="beast-transport-btn" id="beastNextBtn" aria-label="Næste">${BeastCore.icon("skip-forward", { size: 22 })}</button>
                  </div>
                  <div class="beast-volume-row">
                    <button type="button" class="beast-mute-btn" id="beastMuteBtn" aria-label="Slå lyd fra">${BeastCore.icon(attrs.is_volume_muted ? "volume-mute" : "volume", { size: 21 })}</button>
                    <div class="beast-volume-buttons">
                      <button type="button" data-volume-step="-5" aria-label="Skru ned">−</button>
                      <output id="beastVolumeOutput">${Math.round((Number(attrs.volume_level) || 0) * 100)}%</output>
                      <button type="button" data-volume-step="5" aria-label="Skru op">+</button>
                    </div>
                  </div>
                  <button type="button" class="beast-player-output" id="beastPlayerOutputBtn" aria-label="${english ? "Select player" : "Vælg afspiller"}">
                    <span>${BeastCore.icon("volume", { size: 21 })}</span>
                    <span><small>${playerCountLabel}</small><strong>${escapeHtml(attrs.friendly_name || activePlayer.entity_id)}</strong></span>
                  </button>
                </div>
                <div class="beast-progress-row">
                  <span id="beastProgressElapsed">--:--</span>
                  <div class="beast-progress-track"><div class="beast-progress-fill" id="beastProgressFill"></div></div>
                  <span id="beastProgressDuration">--:--</span>
                </div>
            </div>
          </div>
        </aside>
        <main class="beast-music-library">
          <header class="beast-music-library-head">
            <div><small>Music Assistant</small><strong>Dit musikbibliotek</strong></div>
            <div class="beast-music-search-row">
              ${BeastCore.icon("search", { size: 19 })}
              <input type="search" class="beast-music-search" id="beastMusicSearch" placeholder="Søg efter musik, album eller radio…" value="${escapeHtml(searchQuery)}">
            </div>
          </header>
          <div class="beast-music-tabs" id="beastMusicTabs"></div>
          <div class="beast-music-grid" id="beastMusicGrid"><p class="beast-music-empty">Henter playlister…</p></div>
        </main>
      </div>
    `;
    wireMusicLayout();

    renderPlayerChips(players, activePlayer);
    renderGroupVolume(players, activePlayer);
    wireSpeakerToggle();
    wireGroupControls(players, activePlayer);
    updateNowPlayingArt(attrs.entity_picture);
    updateProgressState(activePlayer);
    startProgressTicker();
    wireTransportControls(activePlayer);
    wireSearchInput(activePlayer);

    if (searchQuery.trim()) {
      runSearch(activePlayer, searchQuery.trim());
    } else {
      loadTabsAndGrid(activePlayer);
    }
  }

  function wireMusicLayout() {
    const layout = BeastConfig.get("pageLayouts.music.musicLayout") || {};
    const hidden = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
    containerEl.querySelector(".beast-music-control")?.classList.toggle("is-layout-hidden", hidden.has("player"));
    containerEl.querySelector(".beast-music-library")?.classList.toggle("is-layout-hidden", hidden.has("library"));
    BeastNativePageEditor.mount({ section:"music", label:"Musik", root:()=>containerEl, host:()=>containerEl.querySelector(".beast-music-dashboard"), trigger:"#beastMusicLayoutEdit", onSave:()=>render(), cards:()=>[
      { id:"player", label:"Afspiller og højttalere", selector:".beast-music-control", enabled:!hidden.has("player"), desktop:{x:1,y:1,w:4,h:12}, options:{speakers:true}, controls:[{key:"speakers",label:"Vis højttalervælger",type:"checkbox",default:true}] },
      { id:"library", label:"Bibliotek, søgning og album", selector:".beast-music-library", titleSelector:".beast-music-library-head strong", enabled:!hidden.has("library"), desktop:{x:5,y:1,w:8,h:12}, options:{items:18}, controls:[{key:"items",label:"Elementer ad gangen",min:6,max:48,step:6,default:18}] }
    ] });
    containerEl.querySelector(".beast-music-control")?.classList.toggle("hide-speaker-picker", !BeastNativePageEditor.option("music", "player", "speakers", true));
  }

  function openMusicLayout(layout) {
    const hidden = new Set(Array.isArray(layout.hidden) ? layout.hidden : []);
    const items = [["player", "Afspiller og højttalere"], ["library", "Bibliotek, søgning og album"]];
    const overlay = document.createElement("div"); overlay.className = "beast-modal-overlay";
    overlay.innerHTML = `<div class="beast-modal beast-music-layout-modal"><div class="beast-modal-header"><h3>Rediger musiklayout</h3><button type="button" class="beast-modal-close" data-close>×</button></div><div class="beast-modal-body"><div class="beast-music-layout-list">${items.map(([id,label]) => `<label><input type="checkbox" data-music-section="${id}" ${hidden.has(id) ? "" : "checked"}><strong>${label}</strong></label>`).join("")}</div><button type="button" class="beast-btn beast-btn-primary" data-save-music-layout>Gem layout</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-close]")) return overlay.remove();
      if (!event.target.closest("[data-save-music-layout]")) return;
      const nextHidden = items.filter(([id]) => !overlay.querySelector(`[data-music-section="${id}"]`).checked).map(([id]) => id);
      BeastConfig.set("pageLayouts.music.musicLayout", { ...layout, hidden: nextHidden }); overlay.remove(); render();
    });
  }

  function wireSearchInput(activePlayer) {
    const input = document.getElementById("beastMusicSearch");
    if (!input) return;
    input.addEventListener("input", () => {
      searchQuery = input.value;
      window.clearTimeout(searchDebounceId);
      searchDebounceId = window.setTimeout(() => {
        const trimmed = searchQuery.trim();
        if (trimmed) {
          runSearch(activePlayer, trimmed);
        } else {
          document.getElementById("beastMusicTabs").style.display = "";
          loadTabsAndGrid(activePlayer);
        }
      }, SEARCH_DEBOUNCE_MS);
    });
  }

  async function browseMediaItem(entityId, item) {
    const mediaType = item.media_content_type || item.media_type || "album";
    const mediaId = item.media_content_id || item.uri || "";
    const cacheKey = `detail:${entityId}:${mediaType}:${mediaId}`;
    if (detailCache.has(cacheKey)) return detailCache.get(cacheKey);
    const result = await BeastHaSocket.sendCommand("media_player/browse_media", {
      entity_id: entityId,
      media_content_type: mediaType,
      media_content_id: mediaId
    });
    detailCache.set(cacheKey, result);
    return result;
  }

  function closeMediaDetail() {
    document.getElementById("beastMusicDetail")?.remove();
  }

  function playLibraryItem(activePlayer, item, button) {
    const mediaType = item.media_content_type || item.media_type || "music";
    const mediaId = item.media_content_id || item.uri || item.name || "";
    button?.classList.add("is-loading");
    return callService("media_player", "play_media", activePlayer.entity_id, {
      media_content_type: mediaType,
      media_content_id: mediaId
    }).finally(() => window.setTimeout(() => button?.classList.remove("is-loading"), 600));
  }

  async function openMediaDetail(item, activePlayer) {
    closeMediaDetail();
    const mediaType = item.media_content_type || item.media_type || "album";
    const isPlaylist = mediaType === "playlist";
    const typeLabel = isPlaylist ? "Spilleliste" : "Album";
    const title = item.title || item.name || typeLabel;
    const rawImage = item.thumbnail || item.image || item.image_url || item.image_path || "";
    const thumbnail = typeof rawImage === "string" ? rawImage : (rawImage?.url || rawImage?.path || rawImage?.uri || "");
    const modal = document.createElement("div");
    modal.id = "beastMusicDetail";
    modal.className = "beast-music-detail";
    modal.innerHTML = `
      <button type="button" class="beast-music-detail-backdrop" aria-label="Luk"></button>
      <section class="beast-music-detail-sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <header class="beast-music-detail-head">
          <div class="beast-music-detail-cover">${BeastCore.icon("music", { size: 38 })}${thumbnail ? `<img decoding="async" src="${escapeHtml(thumbnail)}" alt="">` : ""}</div>
          <div><small>${typeLabel}</small><h2>${escapeHtml(title)}</h2><p id="beastMusicDetailMeta">Henter numre…</p></div>
          <button type="button" class="beast-music-detail-close" aria-label="Luk">×</button>
        </header>
        <div class="beast-music-detail-actions"><button type="button" class="beast-music-detail-play">${BeastCore.icon("play", { size: 21 })}<span>Afspil hele ${isPlaylist ? "spillelisten" : "albummet"}</span></button></div>
        <div class="beast-music-track-list" id="beastMusicTrackList"><p class="beast-music-empty">Henter numre…</p></div>
      </section>`;
    document.body.appendChild(modal);
    modal.querySelector(".beast-music-detail-backdrop").addEventListener("click", closeMediaDetail);
    modal.querySelector(".beast-music-detail-close").addEventListener("click", closeMediaDetail);
    modal.querySelector(".beast-music-detail-play").addEventListener("click", (event) => playLibraryItem(activePlayer, item, event.currentTarget));
    try {
      const result = await browseMediaItem(activePlayer.entity_id, item);
      if (!modal.isConnected) return;
      const tracks = Array.isArray(result?.children) ? result.children : [];
      const list = modal.querySelector("#beastMusicTrackList");
      modal.querySelector("#beastMusicDetailMeta").textContent = tracks.length ? `${tracks.length} numre` : "Ingen nummerliste fundet";
      if (!tracks.length) {
        list.innerHTML = `<p class="beast-music-empty">Music Assistant returnerede ingen numre for denne ${isPlaylist ? "spilleliste" : "albumvisning"}.</p>`;
        return;
      }
      const fragment = document.createDocumentFragment();
      tracks.forEach((track, index) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "beast-music-track";
        const duration = Number(track.media_duration || track.duration);
        row.innerHTML = `<span class="beast-music-track-number">${index + 1}</span><span class="beast-music-track-name"><strong>${escapeHtml(track.title || track.name || `Nummer ${index + 1}`)}</strong><small>${escapeHtml(track.artist || track.media_artist || "")}</small></span>${Number.isFinite(duration) ? `<span class="beast-music-track-duration">${formatDuration(duration)}</span>` : "<span></span>"}<span class="beast-music-track-play">${BeastCore.icon("play", { size: 18 })}</span>`;
        row.addEventListener("click", () => playLibraryItem(activePlayer, track, row));
        fragment.appendChild(row);
      });
      list.innerHTML = "";
      list.appendChild(fragment);
    } catch (error) {
      if (!modal.isConnected) return;
      modal.querySelector("#beastMusicDetailMeta").textContent = "Kunne ikke hente numre";
      modal.querySelector("#beastMusicTrackList").innerHTML = `<p class="beast-music-empty">Nummerlisten kunne ikke hentes (${escapeHtml(error.message)}).</p>`;
    }
  }

  async function runSearch(activePlayer, query) {
    const myToken = ++searchToken;
    const tabRow = document.getElementById("beastMusicTabs");
    const grid = document.getElementById("beastMusicGrid");
    if (!grid) return;
    if (tabRow) tabRow.style.display = "none";
    grid.innerHTML = `<p class="beast-music-empty">Søger…</p>`;
    try {
      const items = await searchLibrary(query);
      if (myToken !== searchToken || !containerEl.contains(grid)) return;
      renderSearchResults(grid, items, activePlayer);
    } catch (error) {
      if (myToken !== searchToken || !containerEl.contains(grid)) return;
      grid.innerHTML = `<p class="beast-music-empty">Søgning fejlede (${escapeHtml(error.message)}).</p>`;
    }
  }

  function renderSearchResults(grid, items, activePlayer) {
    if (!items.length) {
      grid.innerHTML = `<p class="beast-music-empty">Ingen resultater.</p>`;
      return;
    }
    grid.innerHTML = "";
    const fragment = document.createDocumentFragment();
    items.slice(0, 48).forEach((item) => {
      const tile = document.createElement("article");
      tile.className = "beast-music-tile";
      const title = item.title || item.name || "Uden navn";
      const rawImage = item.thumbnail || item.image || item.image_url || item.image_path || "";
      const thumbnail = typeof rawImage === "string"
        ? rawImage
        : (rawImage?.url || rawImage?.path || rawImage?.uri || "");
      const mediaType = item.media_content_type || item.media_type || "music";
      const mediaId = item.media_content_id || item.uri || item.name || "";
      const canBrowse = mediaType === "album" || mediaType === "playlist";
      tile.innerHTML = `
        <button type="button" class="beast-music-tile-main" aria-label="${canBrowse ? "Åbn" : "Afspil"} ${escapeHtml(title)}">
          <div class="beast-music-tile-cover">${BeastCore.icon("music", { size: 42 })}${thumbnail ? `<img loading="lazy" decoding="async" src="${escapeHtml(thumbnail)}" alt="" onerror="this.remove()">` : ""}</div>
          <strong>${escapeHtml(title)}</strong>
        </button>
        <button type="button" class="beast-music-tile-action">
          ${BeastCore.icon(canBrowse ? "music" : "play", { size: 18 })}<span>${canBrowse ? "Se numre" : "Afspil"}</span>
        </button>
      `;
      const playableItem = { ...item, media_content_type: mediaType, media_content_id: mediaId };
      const activate = () => canBrowse
        ? openMediaDetail(playableItem, activePlayer)
        : playLibraryItem(activePlayer, playableItem, tile);
      tile.querySelector(".beast-music-tile-main").addEventListener("click", activate);
      tile.querySelector(".beast-music-tile-action").addEventListener("click", activate);
      fragment.appendChild(tile);
    });
    grid.appendChild(fragment);
  }

  function updateNowPlayingArt(pictureUrl) {
    const art = document.getElementById("beastNowPlayingArt");
    if (!art) return;
    if (!pictureUrl) { art.style.display = "none"; art.dataset.picture = ""; return; }
    if (art.dataset.picture === pictureUrl) return;
    art.dataset.picture = pictureUrl;
    art.style.display = "block";
    if (/^https?:\/\//i.test(pictureUrl)) {
      art.src = pictureUrl;
    } else {
      BeastAuth.setAuthedImageSrc(art, pictureUrl);
    }
  }

  function renderPlayerChips(players, activePlayer) {
    const row = document.getElementById("beastMusicPlayers");
    if (!row) return;
    row.innerHTML = "";
    players.forEach((player) => {
      const chip = document.createElement("div");
      chip.className = `beast-player-chip${player.entity_id === activePlayer.entity_id ? " is-active" : ""}`;
      chip.dataset.entityId = player.entity_id;
      chip.dataset.playing = String(player.state === "playing");
      const volume = Number.isFinite(Number(player.attributes.volume_level)) ? `${Math.round(Number(player.attributes.volume_level) * 100)}%` : "--";
      const stereo = stereoGroupInfo(player.entity_id);
      const playerStatus = player.state === "playing" ? "Afspiller" : player.state === "paused" ? "På pause" : "Klar";
      chip.innerHTML = `<button type="button" class="beast-player-select"><span class="beast-player-dot"></span><span><strong>${escapeHtml(player.attributes.friendly_name || player.entity_id)}</strong><small>${stereo ? `${stereo.label} · ` : ""}${playerStatus}</small></span><span class="beast-player-volume">${volume}</span></button>`;
      chip.querySelector(".beast-player-select").addEventListener("click", () => selectPlayer(player.entity_id));

      if (Number.isFinite(Number(player.attributes.volume_level))) {
        const volumeControl = document.createElement("div");
        volumeControl.className = "beast-player-volume-control";
        let volumeValue = Math.round(Number(player.attributes.volume_level) * 100);
        volumeControl.innerHTML = `<button type="button" data-step="-5" aria-label="Skru ned for ${escapeHtml(player.attributes.friendly_name || player.entity_id)}">−</button><output>${volumeValue}%</output><button type="button" data-step="5" aria-label="Skru op for ${escapeHtml(player.attributes.friendly_name || player.entity_id)}">+</button>`;
        const output = volumeControl.querySelector("output");
        volumeControl.querySelectorAll("button").forEach((button) => {
          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            volumeValue = Math.max(0, Math.min(100, volumeValue + Number(button.dataset.step)));
            output.textContent = `${volumeValue}%`;
            chip.querySelector(".beast-player-volume").textContent = `${volumeValue}%`;
            callService("media_player", "volume_set", player.entity_id, { volume_level: volumeValue / 100 });
          });
        });
        chip.appendChild(volumeControl);
      }

      if (player.entity_id !== activePlayer.entity_id) {
        const masterMembers = playerGroupIds(players, activePlayer);
        const leaderId = masterMembers[0] || activePlayer.entity_id;
        const grouped = masterMembers.includes(player.entity_id) || linkedPlayerIds(leaderId).has(player.entity_id);
        const groupBtn = document.createElement("button");
        groupBtn.type = "button";
        groupBtn.className = `beast-player-group-btn${grouped ? " is-grouped" : ""}`;
        groupBtn.title = grouped ? "Fjern denne højttaler" : "Tilføj denne højttaler";
        groupBtn.innerHTML = `${BeastCore.icon(grouped ? "minus" : "plus", { size: 15, strokeWidth: 2.5 })}<span>${grouped ? "Fjern" : "Tilslut"}</span>`;
        groupBtn.setAttribute("aria-label", `${grouped ? "Fjern" : "Tilslut"} ${player.attributes.friendly_name || player.entity_id}`);
        groupBtn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          changeSpeakerGroup(players, activePlayer, player, !grouped, groupBtn);
        });
        chip.appendChild(groupBtn);
      }
      row.appendChild(chip);
    });
  }

  function renderGroupVolume(players, activePlayer) {
    const control = document.getElementById("beastGroupVolume");
    if (!control) return;
    const nativeIds = playerGroupIds(players, activePlayer);
    const leaderId = nativeIds[0] || activePlayer.entity_id;
    const memberIds = Array.from(new Set([...nativeIds, ...linkedPlayerIds(leaderId)]));
    const members = players.filter((player) => memberIds.includes(player.entity_id));
    const displayedMemberCount = stereoGroupInfo(activePlayer.entity_id)?.speakers || members.length;
    const volume = Math.round((Number(activePlayer.attributes.volume_level) || 0) * 100);
    control.innerHTML = `
      <div class="beast-group-volume-label">
        <span><strong>Gruppelydstyrke</strong><small>${displayedMemberCount} ${displayedMemberCount === 1 ? "højttaler" : "højttalere"}</small></span>
      </div>
      <div class="beast-volume-buttons">
        <button type="button" data-step="-5" aria-label="Skru gruppen ned">−</button>
        <output>${volume}%</output>
        <button type="button" data-step="5" aria-label="Skru gruppen op">+</button>
      </div>`;
    const output = control.querySelector("output");
    let groupVolume = volume;
    control.querySelectorAll(".beast-volume-buttons button").forEach((button) => {
      button.addEventListener("click", () => {
        groupVolume = Math.max(0, Math.min(100, groupVolume + Number(button.dataset.step)));
        output.textContent = `${groupVolume}%`;
        members.forEach((player) => callService("media_player", "volume_set", player.entity_id, { volume_level: groupVolume / 100 }));
      });
    });
  }

  function updatePlayerLiveState(entityId, state) {
    if (!state || !containerEl?.querySelector(".beast-music-dashboard")) return;
    const attrs = state.attributes || {};
    const chip = Array.from(containerEl.querySelectorAll(".beast-player-chip")).find((item) => item.dataset.entityId === entityId);
    if (chip) {
      chip.dataset.playing = String(state.state === "playing");
      const status = state.state === "playing" ? "Afspiller" : state.state === "paused" ? "På pause" : "Klar";
      const stereo = stereoGroupInfo(entityId);
      const statusEl = chip.querySelector(".beast-player-select small");
      if (statusEl) statusEl.textContent = `${stereo ? `${stereo.label} · ` : ""}${status}`;
      const volume = Number(attrs.volume_level);
      if (Number.isFinite(volume)) {
        const text = `${Math.round(volume * 100)}%`;
        const compact = chip.querySelector(".beast-player-volume");
        const output = chip.querySelector(".beast-player-volume-control output");
        if (compact) compact.textContent = text;
        if (output) output.textContent = text;
      }
    }
    if (entityId !== selectedEntityId) return;
    const title = document.getElementById("beastNowPlayingTitle");
    const artist = document.getElementById("beastNowPlayingArtist");
    const album = document.getElementById("beastNowPlayingAlbum");
    if (title) title.textContent = attrs.media_title || "Ingen afspilning";
    if (artist) artist.textContent = attrs.media_artist || "Vælg musik fra biblioteket";
    if (album) {
      album.innerHTML = attrs.media_album_name
        ? `<strong>${escapeHtml(attrs.media_album_name)}</strong><span>Album · ${escapeHtml(attrs.media_artist || "Ukendt kunstner")}</span>`
        : `<strong>Musikbibliotek</strong><span>Vælg et album, en playliste eller en radiostation</span>`;
    }
    updateNowPlayingArt(attrs.entity_picture || "");
    updateProgressState(state);
    const playBtn = document.getElementById("beastPlayBtn");
    if (playBtn) {
      const playing = state.state === "playing";
      playBtn.dataset.playing = String(playing);
      playBtn.setAttribute("aria-label", playing ? "Pause" : "Afspil");
      playBtn.innerHTML = BeastCore.icon(playing ? "pause" : "play", { size: 27 });
    }
    const muteBtn = document.getElementById("beastMuteBtn");
    if (muteBtn) {
      muteBtn.dataset.muted = String(Boolean(attrs.is_volume_muted));
      muteBtn.innerHTML = BeastCore.icon(attrs.is_volume_muted ? "volume-mute" : "volume", { size: 21 });
    }
    const volumeOutput = document.getElementById("beastVolumeOutput");
    if (volumeOutput && Number.isFinite(Number(attrs.volume_level))) volumeOutput.textContent = `${Math.round(Number(attrs.volume_level) * 100)}%`;
  }

  function wireSpeakerToggle() {
    const toggle = document.getElementById("beastSpeakerToggle");
    const outputButton = document.getElementById("beastPlayerOutputBtn");
    const drawer = document.getElementById("beastSpeakerDrawer");
    const actions = containerEl.querySelector(".beast-music-group-actions");
    if (!toggle || !drawer) return;
    const setOpen = () => {
      speakerPanelOpen = !speakerPanelOpen;
      toggle.setAttribute("aria-expanded", String(speakerPanelOpen));
      drawer.classList.toggle("is-open", speakerPanelOpen);
      actions?.classList.toggle("is-collapsed", !speakerPanelOpen);
    };
    toggle.addEventListener("click", setOpen);
    outputButton?.addEventListener("click", setOpen);
  }

  function wireGroupControls(players, activePlayer) {
    const others = players.filter((player) => player.entity_id !== activePlayer.entity_id);
    document.getElementById("beastGroupAll")?.addEventListener("click", async (event) => {
      if (!others.length) return;
      const button = event.currentTarget;
      const currentMembers = playerGroupIds(players, activePlayer);
      const leaderId = currentMembers[0] || activePlayer.entity_id;
      const targets = players.filter((player) => player.entity_id !== leaderId);
      button.disabled = true;
      setGroupFeedback("Tilslutter alle højttalere…");
      try {
        for (const player of targets) {
          const oldGroup = playerGroupIds(players, player);
          if (oldGroup.length > 1 && !currentMembers.includes(player.entity_id)) {
            await callServiceStrict("media_player", "unjoin", player.entity_id);
          }
        }
        await callServiceStrict("media_player", "join", leaderId, { group_members: targets.map((player) => player.entity_id) });
        setGroupFeedback("Alle højttalere er tilsluttet.", "success");
        window.setTimeout(render, 700);
      } catch (error) {
        BeastCore.log(`Musik: kunne ikke gruppere alle (${error.message}).`);
        setGroupFeedback("Kunne ikke tilslutte alle højttalere.", "error");
        button.disabled = false;
      }
    });
    document.getElementById("beastUngroupAll")?.addEventListener("click", () => {
      const members = playerGroupIds(players, activePlayer);
      members.slice(1).forEach((entityId) => {
        callService("media_player", "unjoin", entityId);
      });
    });
  }

  function wireTransportControls(activePlayer) {
    const entityId = activePlayer.entity_id;
    const playBtn = document.getElementById("beastPlayBtn");
    const prevBtn = document.getElementById("beastPrevBtn");
    const nextBtn = document.getElementById("beastNextBtn");
    const muteBtn = document.getElementById("beastMuteBtn");
    const volumeOutput = document.getElementById("beastVolumeOutput");

    playBtn.dataset.playing = String(activePlayer.state === "playing");
    muteBtn.dataset.muted = String(Boolean(activePlayer.attributes.is_volume_muted));

    playBtn.addEventListener("click", () => {
      const nextPlaying = playBtn.dataset.playing !== "true";
      playBtn.dataset.playing = String(nextPlaying);
      playBtn.innerHTML = BeastCore.icon(nextPlaying ? "pause" : "play", { size: 22 });
      callService("media_player", "media_play_pause", entityId);
    });
    prevBtn.addEventListener("click", () => callService("media_player", "media_previous_track", entityId));
    nextBtn.addEventListener("click", () => callService("media_player", "media_next_track", entityId));
    muteBtn.addEventListener("click", () => {
      const nextMuted = muteBtn.dataset.muted !== "true";
      muteBtn.dataset.muted = String(nextMuted);
      muteBtn.innerHTML = BeastCore.icon(nextMuted ? "volume-mute" : "volume", { size: 18 });
      callService("media_player", "volume_mute", entityId, { is_volume_muted: nextMuted });
    });

    let volumeValue = Math.round((Number(activePlayer.attributes.volume_level) || 0) * 100);
    containerEl.querySelectorAll(".beast-now-playing .beast-volume-buttons button").forEach((button) => {
      button.addEventListener("click", () => {
        volumeValue = Math.max(0, Math.min(100, volumeValue + Number(button.dataset.volumeStep)));
        if (volumeOutput) volumeOutput.textContent = `${volumeValue}%`;
        callService("media_player", "volume_set", entityId, { volume_level: volumeValue / 100 });
      });
    });
  }

  async function loadTabsAndGrid(activePlayer) {
    const tabRow = document.getElementById("beastMusicTabs");
    const grid = document.getElementById("beastMusicGrid");
    if (tabRow) tabRow.style.display = "";
    if (!activeCategoryId || !DIRECT_CATEGORIES.some((category) => category.media_content_id === activeCategoryId)) {
      activeCategoryId = "playlists";
    }
    tabRow.innerHTML = "";
    DIRECT_CATEGORIES.forEach((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `beast-music-tab${category.media_content_id === activeCategoryId ? " is-active" : ""}`;
      button.textContent = category.title;
      button.addEventListener("click", () => {
        activeCategoryId = category.media_content_id;
        libraryVisibleCount = 18;
        loadTabsAndGrid(activePlayer);
      });
      tabRow.appendChild(button);
    });
    const directCategory = DIRECT_CATEGORIES.find((category) => category.media_content_id === activeCategoryId);
    grid.innerHTML = `<p class="beast-music-empty">Henter ${directCategory.title.toLowerCase()}…</p>`;
    try {
      const directItems = await getLibraryItems(directCategory);
      if (!containerEl.contains(grid)) return;
      renderGridItems(grid, directItems, activePlayer);
      return;
    } catch (error) {
      BeastCore.log(`Musik: get_library fejlede (${error.message}), prøver browse_media.`);
    }

    const players = getPlayers();
    const browseCandidates = [
      activePlayer,
      ...players.filter((player) => player.entity_id !== activePlayer.entity_id)
    ];
    let libraryPlayer = activePlayer;
    let cats = null;
    for (const candidate of browseCandidates) {
      const candidateCategories = await ensureCategories(candidate.entity_id);
      if (Array.isArray(candidateCategories) && candidateCategories.length) {
        libraryPlayer = candidate;
        cats = candidateCategories;
        break;
      }
    }
    if (!containerEl.contains(tabRow)) return; // panel re-rendered while awaiting

    if (!cats) {
      tabRow.innerHTML = "";
      tabRow.style.display = "none";
      grid.innerHTML = `<div class="beast-music-library-error">${BeastCore.icon("music", { size: 34 })}<strong>Biblioteket kunne ikke hentes</strong><span>Søgning virker stadig – prøv at søge efter en playliste, et album eller en radiostation ovenfor.</span></div>`;
      return;
    }

    if (!cats.length) {
      tabRow.innerHTML = "";
      grid.innerHTML = `<p class="beast-music-empty">Intet bibliotek fundet.</p>`;
      return;
    }

    tabRow.innerHTML = "";
    cats.forEach((cat) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `beast-music-tab${cat.media_content_id === activeCategoryId ? " is-active" : ""}`;
      btn.textContent = CATEGORY_LABELS[cat.media_content_id] || cat.title;
      btn.addEventListener("click", () => {
        activeCategoryId = cat.media_content_id;
        loadTabsAndGrid(activePlayer);
      });
      tabRow.appendChild(btn);
    });

    const activeCategory = cats.find((c) => c.media_content_id === activeCategoryId) || cats[0];
    activeCategoryId = activeCategory.media_content_id;
    grid.innerHTML = `<p class="beast-music-empty">Henter…</p>`;
    try {
      const items = await browseCategory(libraryPlayer.entity_id, activeCategory);
      renderGridItems(grid, items, activePlayer);
    } catch (error) {
      grid.innerHTML = `<p class="beast-music-empty">Kunne ikke hente (${escapeHtml(error.message)}).</p>`;
    }
  }

  function renderGridItems(grid, items, activePlayer) {
    if (!containerEl.contains(grid)) return;
    if (!items.length) {
      grid.innerHTML = `<p class="beast-music-empty">Ingenting fundet.</p>`;
      return;
    }
    libraryVisibleCount = Math.max(libraryVisibleCount, Number(BeastNativePageEditor.option("music", "library", "items", 18)));
    grid.innerHTML = "";
    const fragment = document.createDocumentFragment();
    items.slice(0, libraryVisibleCount).forEach((item) => {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "beast-music-tile";
      const title = item.title || item.name || "Uden navn";
      const rawImage = item.thumbnail || item.image || item.image_url || item.image_path || "";
      const thumbnail = typeof rawImage === "string"
        ? rawImage
        : (rawImage?.url || rawImage?.path || rawImage?.uri || "");
      const mediaType = item.media_content_type || item.media_type || "music";
      const mediaId = item.media_content_id || item.uri || item.name || "";
      const canBrowse = mediaType === "album" || mediaType === "playlist" || activeCategoryId === "albums" || activeCategoryId === "playlists";
      tile.innerHTML = `
        <button type="button" class="beast-music-tile-main" aria-label="${canBrowse ? "Åbn" : "Afspil"} ${escapeHtml(title)}"><div class="beast-music-tile-cover">${BeastCore.icon("music", { size: 42 })}${thumbnail ? `<img loading="lazy" decoding="async" src="${escapeHtml(thumbnail)}" alt="" onerror="this.remove()">` : ""}</div><strong>${escapeHtml(title)}</strong></button>
        <button type="button" class="beast-music-tile-action">${BeastCore.icon(canBrowse ? "music" : "play", { size: 18 })}<span>${canBrowse ? "Se numre" : "Afspil"}</span></button>
      `;
      const activate = () => canBrowse
        ? openMediaDetail(item, activePlayer)
        : playLibraryItem(activePlayer, { ...item, media_content_type: mediaType, media_content_id: mediaId }, tile);
      tile.querySelector(".beast-music-tile-main").addEventListener("click", activate);
      tile.querySelector(".beast-music-tile-action").addEventListener("click", activate);
      fragment.appendChild(tile);
    });
    grid.appendChild(fragment);
    if (items.length > libraryVisibleCount) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "beast-music-more";
      more.textContent = `Vis flere · ${items.length - libraryVisibleCount} tilbage`;
      more.addEventListener("click", () => {
        libraryVisibleCount += 18;
        renderGridItems(grid, items, activePlayer);
      });
      grid.appendChild(more);
    }
  }

  function init(root) {
    containerEl = root;
    containerEl.classList.add("beast-music-panel");
    renderLoading();
    const stableRender = BeastCore.stableUpdater(containerEl, render, 280);

    BeastHaSocket.onStatusChange((status) => {
      if (status === "connected") render();
    });
    BeastHaSocket.subscribeDomain("media_player", (entityId, newState, oldState) => {
      if (!isMusicAssistantPlayer(newState) && !isMusicAssistantPlayer(oldState)) return;
      if (!newState) {
        window.clearTimeout(playerRenderTimerId);
        playerRenderTimerId = window.setTimeout(stableRender, 280);
        return;
      }
      const groupChanged = JSON.stringify(newState.attributes?.group_members || []) !== JSON.stringify(oldState?.attributes?.group_members || []);
      const nameChanged = newState.attributes?.friendly_name !== oldState?.attributes?.friendly_name;
      if (groupChanged || nameChanged) {
        window.clearTimeout(playerRenderTimerId);
        playerRenderTimerId = window.setTimeout(stableRender, 280);
        return;
      }
      updatePlayerLiveState(entityId, newState);
    });
  }

  BeastCore.registerPanel("music", "beastMusicZone", init);

  window.BeastMusic = {
    getNowPlaying: () => {
      const players = getPlayers();
      if (!players.length) return null;
      const active = players.find((p) => p.state === "playing") || pickActivePlayer(players);
      if (!active) return null;
      return {
        entityId: active.entity_id,
        playing: active.state === "playing",
        title: active.attributes.media_title || "",
        artist: active.attributes.media_artist || active.attributes.media_album_name || "",
        picture: active.attributes.entity_picture || "",
        volume: Number.isFinite(Number(active.attributes.volume_level)) ? Number(active.attributes.volume_level) : 0,
        muted: Boolean(active.attributes.is_volume_muted)
      };
    }
  };
})();
