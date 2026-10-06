(function () {
  const EVENT_TYPE = "kiosk-warden-power";
  // The state survives a reload of the same tab: a kiosk whose screen is off
  // (idle) and whose page is refreshed in the background stays idle instead
  // of starting every stream and animation again behind the dark screen. The
  // kiosk wakes it as before by setting "active".
  const STORE_KEY = "beast-power-state";
  let state = "active";
  function storedState() { try { return sessionStorage.getItem(STORE_KEY); } catch (_) { return null; } }

  function profile() {
    const value = typeof BeastLocalSettings !== "undefined" ? BeastLocalSettings.get("powerProfile", "balanced") : "balanced";
    return ["performance", "balanced", "low"].includes(value) ? value : "balanced";
  }

  function applyProfile() {
    const next = profile();
    document.documentElement.dataset.powerProfile = next;
    document.dispatchEvent(new CustomEvent("beast:powerprofilechange", { detail: { profile: next } }));
  }

  function setState(nextState) {
    if (nextState !== "active" && nextState !== "idle") return false;
    state = nextState;
    try { sessionStorage.setItem(STORE_KEY, state); } catch (_) { /* private mode */ }
    const idle = state === "idle";
    document.documentElement.classList.toggle("beast-power-idle", idle);
    document.documentElement.dataset.powerState = state;
    document.dispatchEvent(new CustomEvent("beast:powerstatechange", {
      detail: { state, idle }
    }));
    return true;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.type !== EVENT_TYPE) return;
    setState(event.data.state);
  });

  window.BeastPower = Object.freeze({
    getState: () => state,
    getProfile: profile,
    setState
  });
  document.addEventListener("beast:local-settings-changed", (event) => {
    if (["*", "powerProfile"].includes(event.detail?.path)) applyProfile();
  });
  applyProfile();
  setState(storedState() === "idle" ? "idle" : "active");
})();
