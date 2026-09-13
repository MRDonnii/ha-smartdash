(function () {
  const EVENT_TYPE = "kiosk-warden-power";
  let state = "active";

  function profile() {
    const value = window.BeastLocalSettings?.get?.("powerProfile", "balanced");
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
  setState("active");
})();
