const BeastScreenLock = (() => {
  // Legacy per-browser storage keys — kept only so any PIN set before this
  // moved to the shared backend config can be migrated forward once, not
  // silently lost. The PIN itself now lives in BeastConfig (screenLock.*)
  // so it's the same code on every browser/device, not just the one it was
  // created on.
  const LEGACY_PIN_HASH_KEY = "beast_panel_screen_pin_hash_v1";
  const LEGACY_AUTOLOCK_KEY = "beast_panel_screen_autolock_v1";
  const PIN_LENGTH = 4;
  const ADMIN_VERIFICATION_KEY = "beast_admin_pin_verified_v1";
  const ADMIN_VERIFICATION_TTL_MS = 30 * 1000;

  let overlayEl = null;
  let mode = null; // 'locked' | 'set-first' | 'set-confirm' | 'verify'
  let digits = "";
  let firstEntry = "";
  let errorActive = false;
  let onDoneCallback = null;
  let pendingVerifiedAction = null;
  let alarmSubscribed = false;
  let promptTitle = "";
  let promptSubtitle = "";
  let lockedByAlarm = false;

  // crypto.subtle needs a secure context (HTTPS or localhost); this panel is
  // served over plain HTTP on the LAN, so it's unavailable. This lock is a
  // casual-access deterrent, not a cryptographic boundary, so a simple
  // synchronous string hash is an acceptable (and reliable) substitute.
  function hashPin(pin) {
    let hash = 0;
    const salted = `beast-panel-lock-${pin}`;
    for (let i = 0; i < salted.length; i += 1) {
      hash = (Math.imul(hash, 31) + salted.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16);
  }

  function hasPin() {
    return Boolean(BeastConfig.get("screenLock.pinHash"));
  }

  function isAutoLockEnabled() {
    return BeastConfig.get("screenLock.autoLockEnabled") === true;
  }

  function setAutoLockEnabled(enabled) {
    BeastConfig.set("screenLock.autoLockEnabled", Boolean(enabled));
  }

  function isAlarmScreenOffEnabled() {
    return BeastConfig.get("screenLock.alarmScreenOffEnabled") === true;
  }

  function setAlarmScreenOffEnabled(enabled) {
    BeastConfig.set("screenLock.alarmScreenOffEnabled", Boolean(enabled));
  }

  function alarmUnlockMode() {
    return BeastConfig.get("screenLock.alarmUnlockMode") === "disarm" ? "disarm" : "pin";
  }

  // Runs once, after BeastConfig has loaded from the backend (see init()).
  // If this browser has an old, local-only PIN and the shared config has
  // none yet, carry it forward so the person who set it up doesn't have to
  // redo it. The server's own PIN always wins if one already exists there.
  function migrateLegacyPinIfNeeded() {
    const legacyHash = localStorage.getItem(LEGACY_PIN_HASH_KEY);
    if (!legacyHash || BeastConfig.get("screenLock.pinHash")) return;
    BeastConfig.set("screenLock", {
      pinHash: legacyHash,
      autoLockEnabled: localStorage.getItem(LEGACY_AUTOLOCK_KEY) === "1",
      alarmScreenOffEnabled: false,
      alarmEntity: null,
      alarmUnlockMode: "pin"
    });
    localStorage.removeItem(LEGACY_PIN_HASH_KEY);
    localStorage.removeItem(LEGACY_AUTOLOCK_KEY);
  }

  function isLocked() {
    return mode === "locked";
  }

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement("div");
    overlayEl.className = "beast-lock-overlay";
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function titleFor() {
    if (mode === "locked") return "Skærmen er låst";
    if (mode === "code-entry") return promptTitle || "Indtast alarmkode";
    if (mode === "verify") return "Indtast kode";
    if (mode === "set-first") return "Vælg en ny kode";
    if (mode === "set-confirm") return "Bekræft koden";
    return "";
  }

  function subtitleFor() {
    if (mode === "locked") return "Indtast koden for at låse op";
    if (mode === "code-entry") return promptSubtitle || "Koden sendes direkte og gemmes ikke";
    if (mode === "verify") return "Bekræft med din nuværende kode";
    if (mode === "set-first") return `${PIN_LENGTH} cifre`;
    if (mode === "set-confirm") return "Indtast koden igen";
    return "";
  }

  function render() {
    const overlay = ensureOverlay();
    if (!mode) {
      overlay.classList.remove("is-open");
      overlay.innerHTML = "";
      return;
    }
    overlay.classList.add("is-open");
    // Only the real "screen is now locked" ambient state stays always-dark
    // (matching the screensaver) -- verify/set/change/remove-PIN prompts are
    // normal in-context modals layered over the current page and follow its
    // theme instead, see ha-smartdash-screenlock.css.
    overlay.classList.toggle("is-ambient", mode === "locked");

    const dots = Array.from({ length: PIN_LENGTH }, (_, i) => `<span class="beast-lock-dot${i < digits.length ? " is-filled" : ""}"></span>`).join("");
    const showCancel = mode !== "locked";
    const showRecovery = hasPin() && ["locked", "verify"].includes(mode);

    overlay.innerHTML = `
      <div class="beast-lock-card${errorActive ? " is-shaking" : ""}">
        ${BeastCore.icon("lock", { size: 32 })}
        <h2 class="beast-lock-title">${titleFor()}</h2>
        <p class="beast-lock-subtitle">${subtitleFor()}</p>
        <div class="beast-lock-dots">${dots}</div>
        <div class="beast-lock-keypad">
          ${["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => `<button type="button" class="beast-lock-key" data-digit="${d}">${d}</button>`).join("")}
          <button type="button" class="beast-lock-key beast-lock-key-cancel" data-action="cancel" ${showCancel ? "" : "disabled style=\"visibility:hidden;\""}>${BeastCore.icon("close", { size: 20 })}</button>
          <button type="button" class="beast-lock-key" data-digit="0">0</button>
          <button type="button" class="beast-lock-key" data-action="backspace">${BeastCore.icon("backspace", { size: 20 })}</button>
        </div>
        ${showRecovery ? `<button type="button" class="beast-lock-forgot" data-action="recover">Glemt kode? Nulstil med Home Assistant-login</button>` : ""}
      </div>
    `;

    overlay.querySelectorAll("[data-digit]").forEach((btn) => {
      btn.addEventListener("click", () => onDigit(btn.dataset.digit));
    });
    overlay.querySelector("[data-action='backspace']")?.addEventListener("click", onBackspace);
    overlay.querySelector("[data-action='cancel']")?.addEventListener("click", onCancel);
    overlay.querySelector("[data-action='recover']")?.addEventListener("click", startTrustedRecovery);
  }

  function startTrustedRecovery() {
    sessionStorage.setItem("beast_panel_pin_recovery_pending_v1", "1");
    sessionStorage.setItem("beast_panel_pin_recovery_source_v1", window.location.pathname || "/");
    window.location.assign(BeastCore.appUrl("admin/?pin-recovery=1"));
  }

  function handleKeyboard(event) {
    if (!mode || event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^[0-9]$/.test(event.key)) { event.preventDefault(); onDigit(event.key); return; }
    if (event.key === "Backspace" || event.key === "Delete") { event.preventDefault(); onBackspace(); return; }
    if (event.key === "Escape" && mode !== "locked") { event.preventDefault(); onCancel(); return; }
    if (event.key === "Enter" && digits.length === PIN_LENGTH) { event.preventDefault(); handleComplete(); }
  }

  document.addEventListener("keydown", handleKeyboard);

  function updateDots() {
    const overlay = ensureOverlay();
    overlay.querySelectorAll(".beast-lock-dot").forEach((dot, index) => {
      dot.classList.toggle("is-filled", index < digits.length);
    });
  }

  function onDigit(digit) {
    if (digits.length >= PIN_LENGTH) return;
    digits += digit;
    updateDots();
    if (digits.length === PIN_LENGTH) {
      window.setTimeout(handleComplete, 150);
    }
  }

  function onBackspace() {
    digits = digits.slice(0, -1);
    updateDots();
  }

  function onCancel() {
    const cb = onDoneCallback;
    resetFlow();
    if (cb) cb(false);
  }

  function shakeAndClear(message) {
    errorActive = true;
    render();
    window.setTimeout(() => {
      errorActive = false;
      digits = "";
      render();
    }, 500);
  }

  function handleComplete() {
    const entered = digits;
    digits = "";

    if (mode === "code-entry") {
      const cb = onDoneCallback;
      resetFlow();
      if (cb) cb(entered);
      return;
    }

    if (mode === "locked" || mode === "verify") {
      const storedHash = BeastConfig.get("screenLock.pinHash");
      const enteredHash = hashPin(entered);
      if (enteredHash !== storedHash) {
        shakeAndClear();
        return;
      }
      if (mode === "locked") {
        resetFlow();
        return;
      }
      // mode === "verify": proceed to whatever verified action was queued
      const action = pendingVerifiedAction;
      const cb = onDoneCallback;
      pendingVerifiedAction = null;
      onDoneCallback = null;
      mode = null;
      if (action === "change" || action === "set") {
        beginSetFlow(cb);
      } else if (action === "remove") {
        BeastConfig.set("screenLock", { ...(BeastConfig.get("screenLock") || {}), pinHash: null, autoLockEnabled: false, alarmScreenOffEnabled: false });
        resetFlow();
        if (cb) cb(true);
      } else {
        resetFlow();
        if (cb) cb(true);
      }
      return;
    }

    if (mode === "set-first") {
      firstEntry = entered;
      mode = "set-confirm";
      render();
      return;
    }

    if (mode === "set-confirm") {
      if (entered !== firstEntry) {
        firstEntry = "";
        mode = "set-first";
        shakeAndClear();
        return;
      }
      const hash = hashPin(entered);
      BeastConfig.set("screenLock.pinHash", hash);
      const cb = onDoneCallback;
      resetFlow();
      if (cb) cb(true);
    }
  }

  function resetFlow() {
    mode = null;
    digits = "";
    firstEntry = "";
    errorActive = false;
    onDoneCallback = null;
    pendingVerifiedAction = null;
    promptTitle = "";
    promptSubtitle = "";
    lockedByAlarm = false;
    render();
  }

  function beginSetFlow(onDone) {
    mode = "set-first";
    digits = "";
    firstEntry = "";
    onDoneCallback = onDone || null;
    render();
  }

  function lockNow(source = "manual") {
    if (!hasPin()) return;
    lockedByAlarm = source === "alarm";
    mode = "locked";
    digits = "";
    onDoneCallback = null;
    render();
  }

  function lockForArmedAlarm() {
    if (!isAutoLockEnabled() || !hasPin()) return;
    lockNow("alarm");
    if (isAlarmScreenOffEnabled()) {
      // Let the lock overlay paint before the physical kiosk display is
      // switched off. The app keeps the locked state; the first touch wakes
      // the screen and reveals the PIN keypad, never the dashboard beneath.
      window.setTimeout(() => document.dispatchEvent(new CustomEvent("beast:alarm-screen-off")), 350);
    }
  }

  function isFullyArmed(state) {
    return ["armed_away", "armed_vacation"].includes(String(state || ""));
  }

  function unlockAfterAlarmDisarm() {
    if (!lockedByAlarm || alarmUnlockMode() !== "disarm") return;
    // Remove only the alarm-created lock. Screen power remains untouched so
    // the normal presence/idle rules decide when the kiosk should wake again.
    resetFlow();
  }

  function requestCode(options, onDone) {
    mode = "code-entry";
    digits = "";
    promptTitle = options?.title || "Indtast alarmkode";
    promptSubtitle = options?.subtitle || "Koden sendes direkte og gemmes ikke";
    onDoneCallback = onDone || null;
    render();
  }

  function startSetPin(onDone) {
    if (hasPin()) {
      mode = "verify";
      digits = "";
      pendingVerifiedAction = "set";
      onDoneCallback = onDone || null;
      render();
    } else {
      beginSetFlow(onDone);
    }
  }

  function startChangePin(onDone) {
    mode = "verify";
    digits = "";
    pendingVerifiedAction = "change";
    onDoneCallback = onDone || null;
    render();
  }

  function startRemovePin(onDone) {
    mode = "verify";
    digits = "";
    pendingVerifiedAction = "remove";
    onDoneCallback = onDone || null;
    render();
  }

  // Called only after an external identity check, such as a fresh Home
  // Assistant OAuth login. beginSetFlow bypasses the old-PIN verification,
  // but the stored PIN is only overwritten after the new PIN is confirmed.
  // Cancelling therefore leaves the existing protection intact.
  function resetPinAfterTrustedLogin(onDone) {
    resetFlow();
    beginSetFlow(onDone);
  }

  // For gating access to something (e.g. Administration) behind the same
  // code used to unlock the kiosk screen — calls onDone(true) once the
  // correct PIN is entered, onDone(false) on cancel, or immediately with
  // true if no PIN has been set at all (nothing to gate against).
  function requestPinVerification(onDone) {
    if (!hasPin()) {
      if (onDone) onDone(true);
      return;
    }
    mode = "verify";
    digits = "";
    pendingVerifiedAction = null;
    onDoneCallback = onDone || null;
    render();
  }

  // The dashboard verifies the PIN before navigating to Administration. Pass
  // that result across the same-tab navigation as a short-lived, one-use
  // grant so Admin does not immediately ask for the same PIN a second time.
  // Direct visits to /admin/ do not have this grant and remain protected.
  function grantAdminVerification() {
    try { sessionStorage.setItem(ADMIN_VERIFICATION_KEY, String(Date.now())); } catch (_) {}
  }

  function consumeAdminVerification() {
    let verifiedAt = 0;
    try {
      verifiedAt = Number(sessionStorage.getItem(ADMIN_VERIFICATION_KEY) || 0);
      sessionStorage.removeItem(ADMIN_VERIFICATION_KEY);
    } catch (_) {}
    return verifiedAt > 0 && Date.now() - verifiedAt <= ADMIN_VERIFICATION_TTL_MS;
  }

  function init() {
    if (alarmSubscribed || !window.BeastHaSocket) return;
    alarmSubscribed = true;
    migrateLegacyPinIfNeeded();
    const security = window.BeastConfig?.get("panels.security") || {};
    const selectedAlarm = window.BeastConfig?.get("screenLock.alarmEntity") || security.primaryAlarm;
    const alarmIds = selectedAlarm ? [selectedAlarm] : (Array.isArray(security.alarmPanels) ? security.alarmPanels.filter(Boolean).slice(0, 1) : []);
    BeastHaSocket.onStatusChange((status) => {
      if (status !== "connected") return;
      const currentState = alarmIds.map((id) => BeastHaSocket.getState(id)?.state).find(Boolean);
      if (isFullyArmed(currentState)) lockForArmedAlarm();
      else if (currentState === "disarmed") unlockAfterAlarmDisarm();
    });
    alarmIds.forEach((alarmId) => BeastHaSocket.subscribeEntity(alarmId, (entityId, newState, oldState) => {
      if (!newState) return;
      const wasFullyArmed = oldState && isFullyArmed(oldState.state);
      const fullyArmed = isFullyArmed(newState.state);
      if (!wasFullyArmed && fullyArmed) lockForArmedAlarm();
      if (wasFullyArmed && newState.state === "disarmed") unlockAfterAlarmDisarm();
    }));
  }

  return {
    hasPin,
    isAutoLockEnabled,
    setAutoLockEnabled,
    isAlarmScreenOffEnabled,
    setAlarmScreenOffEnabled,
    isLocked,
    lockNow,
    requestCode,
    startSetPin,
    startChangePin,
    startRemovePin,
    resetPinAfterTrustedLogin,
    requestPinVerification,
    grantAdminVerification,
    consumeAdminVerification,
    init
  };
})();

window.BeastScreenLock = BeastScreenLock;
