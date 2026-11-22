import { VideoRTC } from "./vendor/video-rtc.js?v=3";

const params = new URLSearchParams(window.location.search);
let GO2RTC_BASE_URL = params.get("base") || "";
const source = params.get("src") || "";
const useSub = params.get("sub") === "1";
const allowAudio = params.get("audio") === "1";
const transport = params.get("transport") || "webrtc";
const fit = params.get("fit") === "cover" ? "cover" : "contain";
const position = params.get("position") || "center";
const resolvedSrc = useSub && !source.endsWith("_sub") ? `${source}_sub` : source;
const poster = document.getElementById("poster");
poster.style.objectFit = fit;
let connected = false;
let streamReady = false;
let audioMuted = true;
let heartbeatTimer = null;
let reconnectTimer = null;
let lastVideoTime = -1;
let lastVideoProgressAt = 0;
let reconnectAttempts = 0;
let activeMode = transport === "mse" ? "mse" : "webrtc";

document.body.classList.add(`position-${position}`);

function postHealth(state) {
  if (window.parent === window) return;
  window.parent.postMessage({ type: "camera-player-health", state, src: resolvedSrc }, window.location.origin);
}

function markReady() {
  if (!connected) return;
  streamReady = true;
  reconnectAttempts = 0;
  lastVideoProgressAt = Date.now();
  document.body.classList.add("ready");
  if (window.parent !== window) {
    window.parent.postMessage({ type: "camera-player-ready", src: resolvedSrc }, window.location.origin);
  }
  postHealth("playing");
}

function configureVideo(video) {
  if (!video) return;
  video.autoplay = true;
  video.muted = audioMuted;
  video.defaultMuted = true;
  video.controls = false;
  video.disablePictureInPicture = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("aria-hidden", "true");
  Object.assign(video.style, {
    width: "100%",
    height: "100%",
    objectFit: fit,
    objectPosition: "center center",
    imageRendering: "auto",
    display: "block",
    pointerEvents: "none"
  });
}

class BeastCameraStream extends VideoRTC {
  constructor() {
    super();
    this.mode = activeMode;
    this.media = allowAudio ? "video,audio" : "video";
    this.background = true;
  }

  oninit() {
    super.oninit();
    configureVideo(this.video);
    this.video.addEventListener("playing", markReady);
    this.video.addEventListener("loadeddata", markReady);
  }

  onpcvideo(video) {
    video.muted = audioMuted;
    video.defaultMuted = true;
    super.onpcvideo(video);
    configureVideo(this.video);
    markReady();
  }
}

customElements.define("beast-camera-stream", BeastCameraStream);
const stream = document.getElementById("stream");

// The poster is what's visible whenever the live video isn't (see the
// body.ready rule in camera-player.html) -- including during every
// reconnect. Assigning its src directly meant a failed fetch (go2rtc
// answers 503 for a source whose producer connection is currently down)
// replaced a perfectly good last frame with a broken-image blank, so a
// source that reconnects often showed up as the picture repeatedly
// flashing to black. Loading into a detached Image first and only
// swapping on success keeps the last frame that *did* load on screen
// through the gap instead. Nothing here fixes a flapping camera link --
// it just stops a recovering stream from looking like a broken one.
function refreshPoster() {
  if (!resolvedSrc) return;
  const nextUrl = `${GO2RTC_BASE_URL}/api/frame.jpeg?src=${encodeURIComponent(resolvedSrc)}&_ts=${Date.now()}`;
  const preload = new Image();
  preload.onload = () => { poster.src = nextUrl; };
  preload.onerror = () => {};
  preload.src = nextUrl;
}

function connect() {
  if (!resolvedSrc || connected || document.hidden) return;
  connected = true;
  streamReady = false;
  document.body.classList.remove("ready");
  stream.mode = activeMode;
  refreshPoster();
  stream.src = `${GO2RTC_BASE_URL}/api/ws?src=${encodeURIComponent(resolvedSrc)}`;
  postHealth("connecting");
}

function disconnect() {
  if (!connected && !stream.ws && !stream.pc) return;
  connected = false;
  streamReady = false;
  document.body.classList.remove("ready");
  if (stream.reconnectTID) {
    window.clearTimeout(stream.reconnectTID);
    stream.reconnectTID = 0;
  }
  try { stream.ondisconnect(); } catch (_) {}
  stream.wsURL = "";
  postHealth("paused");
}

function reconnect() {
  if (reconnectTimer || document.hidden) return;
  disconnect();
  const delay = Math.min(2500, 180 + reconnectAttempts * 320);
  reconnectAttempts += 1;
  reconnectTimer = window.setTimeout(() => { reconnectTimer = null; connect(); }, delay);
}

function recoverStalledStream() {
  // Keep one transport active at a time. Parallel MSE and WebRTC can
  // compete for a high-bitrate stream and cause a reconnect loop.
  // Explicit legacy MSE players move to WebRTC after their first stall.
  if (activeMode === "mse") activeMode = "webrtc";
  postHealth("stalled");
  reconnect();
}

function shouldStartImmediately() {
  try {
    const section = window.frameElement?.closest(".beast-section");
    return !section || section.classList.contains("is-active");
  } catch (_) {
    return true;
  }
}

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.type === "camera-player-pause") disconnect();
  if (event.data?.type === "camera-player-resume") connect();
  if (event.data?.type === "camera-player-reconnect") reconnect();
  if (allowAudio && event.data?.type === "camera-player-audio") {
    audioMuted = event.data.muted !== false;
    if (stream.video) stream.video.muted = audioMuted;
  }
});
document.addEventListener("visibilitychange", () => document.hidden ? disconnect() : connect());
window.addEventListener("online", reconnect);
window.addEventListener("pagehide", disconnect);

async function initPlayer() {
  // Every caller that already knows the go2rtc address (see
  // sharedCameraMarkup() and friends in the parent app) passes it as
  // ?base=... precisely to skip this fetch. It used to run on every single
  // player load regardless -- fine when api/config.php answers instantly,
  // but a single slow/flaky response from it (a busy backend, a brief
  // 503, ...) left GO2RTC_BASE_URL empty, which made this player give up
  // immediately (see the unavailable-return below) without ever trying
  // WebRTC. The parent's camera-health watchdog then saw a permanently
  // silent frame, reloaded it, and the fresh reload hit the same flaky
  // endpoint again -- a fast reload loop that showed up as the live
  // picture repeatedly flashing to a blank white frame (a freshly
  // (re)loaded iframe's default background, before this page's own CSS
  // even applies) rather than any actual camera or stream problem.
  if (!GO2RTC_BASE_URL) {
    try {
      const response = await fetch("./api/config.php", { cache: "no-store" });
      const config = response.ok ? await response.json() : {};
      GO2RTC_BASE_URL = String(config?.panels?.cameras?.go2rtcBaseUrl || "").replace(/\/+$/, "");
    } catch (_) { GO2RTC_BASE_URL = ""; }
  }
  if (!GO2RTC_BASE_URL || !resolvedSrc) { postHealth("unavailable"); return; }
  refreshPoster();
  heartbeatTimer = window.setInterval(() => {
    if (!connected || !streamReady) return;
    const current = Number(stream.video?.currentTime);
    if (Number.isFinite(current) && current > lastVideoTime + 0.02) {
      lastVideoTime = current;
      lastVideoProgressAt = Date.now();
      postHealth("playing");
    } else if (lastVideoProgressAt && Date.now() - lastVideoProgressAt > 24000) {
      // Recovering means a visible drop to the black/poster frame while the
      // connection re-negotiates (see connect()'s "ready" class removal) --
      // worth it for a genuinely dead stream, but a source that's merely
      // hiccuping every so often (weak wifi to the camera, a busy NVR,
      // ...) would otherwise get "recovered" right through a brief stall
      // that was already about to resolve on its own. 24s tolerates that
      // without meaningfully delaying recovery from a real drop.
      recoverStalledStream();
    }
  }, 5000);
  if (shouldStartImmediately()) connect();
  else postHealth("paused");
}

initPlayer();
