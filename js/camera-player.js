import { VideoRTC } from "/js/vendor/video-rtc.js?v=1";

const params = new URLSearchParams(window.location.search);
let GO2RTC_BASE_URL = params.get("base") || "";
const source = params.get("src") || "";
const useSub = params.get("sub") === "1";
const allowAudio = params.get("audio") === "1";
const transport = params.get("transport") || "auto";
const fit = params.get("fit") === "cover" ? "cover" : "contain";
const position = params.get("position") || "center";
const resolvedSrc = useSub && !source.endsWith("_sub") ? `${source}_sub` : source;
const poster = document.getElementById("poster");
poster.style.objectFit = fit;
let connected = false;
let streamReady = false;
let audioMuted = true;
let heartbeatTimer = null;

document.body.classList.add(`position-${position}`);

function postHealth(state) {
  if (window.parent === window) return;
  window.parent.postMessage({ type: "camera-player-health", state, src: resolvedSrc }, window.location.origin);
}

function markReady() {
  if (!connected) return;
  streamReady = true;
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
    this.mode = transport === "mse" ? "mse" : "mse,webrtc";
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

function refreshPoster() {
  if (resolvedSrc) poster.src = `${GO2RTC_BASE_URL}/api/frame.jpeg?src=${encodeURIComponent(resolvedSrc)}&_ts=${Date.now()}`;
}

function connect() {
  if (!resolvedSrc || connected || document.hidden) return;
  connected = true;
  streamReady = false;
  document.body.classList.remove("ready");
  refreshPoster();
  stream.src = `${GO2RTC_BASE_URL}/api/ws?src=${encodeURIComponent(resolvedSrc)}`;
  postHealth("connecting");
}

function disconnect() {
  connected = false;
  streamReady = false;
  document.body.classList.remove("ready");
  if (stream.reconnectTID) {
    window.clearTimeout(stream.reconnectTID);
    stream.reconnectTID = 0;
  }
  stream.ondisconnect();
  stream.wsURL = "";
  postHealth("paused");
}

function reconnect() {
  disconnect();
  window.setTimeout(connect, 120);
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
    if (connected && streamReady) postHealth("playing");
  }, 5000);
  if (shouldStartImmediately()) connect();
  else postHealth("paused");
}

initPlayer();
