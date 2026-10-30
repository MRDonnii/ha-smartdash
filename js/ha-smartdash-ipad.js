(() => {
  const SETTINGS_KEY = "beast_machine_settings_v1";
  const root = document.documentElement;

  function enabled() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}").ipadMode === true; }
    catch (_) { return false; }
  }

  // Shortcut for switching it on from the iPad itself: ?ipad=1 / ?ipad=0.
  const query = new URLSearchParams(location.search).get("ipad");
  if (query === "1" || query === "0") {
    try {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      stored.ipadMode = query === "1";
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
    } catch (_) {}
  }

  function apply() { root.classList.toggle("beast-ipad", enabled()); }
  apply();
  document.addEventListener("beast:local-settings-changed", (event) => {
    if (["*", "ipadMode"].includes(event.detail?.path)) apply();
  });

  // Wake Lock needs a secure context; over plain HTTP this does nothing and
  // iPadOS Auto-Lock must be set to "Never" instead.
  let sentinel = null;
  async function acquireWakeLock() {
    if (!root.classList.contains("beast-ipad") || !("wakeLock" in navigator) || document.visibilityState !== "visible" || sentinel) return;
    try {
      sentinel = await navigator.wakeLock.request("screen");
      sentinel.addEventListener("release", () => { sentinel = null; });
    } catch (_) { sentinel = null; }
  }
  document.addEventListener("visibilitychange", acquireWakeLock);
  document.addEventListener("beast:local-settings-changed", acquireWakeLock);
  window.addEventListener("pointerdown", acquireWakeLock, { passive: true });
  window.addEventListener("load", acquireWakeLock);

  // Safari ignores user-scalable=no; block pinch zoom while the mode is on.
  ["gesturestart", "gesturechange", "gestureend"].forEach((name) => {
    document.addEventListener(name, (event) => { if (root.classList.contains("beast-ipad")) event.preventDefault(); });
  });
})();
