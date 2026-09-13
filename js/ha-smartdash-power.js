(function () {
  const EVENT_TYPE = "kiosk-warden-power";
  let state = "active";

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
    setState
  });
  setState("active");
})();
