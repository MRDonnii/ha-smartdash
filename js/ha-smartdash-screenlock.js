const BeastScreenLock = (() => {
  // Legacy per-browser storage keys — kept only so any PIN set before this
  // moved to the shared backend config can be migrated forward once, not
  // silently lost. The PIN itself now lives in BeastConfig (screenLock.*)
  // so it's the same code on every browser/device, not just the one it was
  // created on.
  const LEGACY_PIN_HASH_KEY = "beast_panel_screen_pin_hash_v1";
  const LEGACY_AUTOLOCK_KEY = "beast_panel_screen_autolock_v1";
  const PIN_LENGTH = 4;

  let overlayEl = null;
  let extrasEl = null;
  let cardSlotEl = null;
  let mode = null; // 'locked' | 'set-first' | 'set-confirm' | 'verify'
  let digits = "";
  let firstEntry = "";
  let errorActive = false;
  let onDoneCallback = null;
  let pendingVerifiedAction = null;
  let alarmSubscribed = false;
  let promptTitle = "";
  let promptSubtitle = "";
  let clockTimerId = null;
  let brightnessDebounceId = null;

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

  // Runs once, after BeastConfig has loaded from the backend (see init()).
  // If this browser has an old, local-only PIN and the shared config has
  // none yet, carry it forward so the person who set it up doesn't have to
  // redo it. The server's own PIN always wins if one already exists there.
  function migrateLegacyPinIfNeeded() {
    const legacyHash = localStorage.getItem(LEGACY_PIN_HASH_KEY);
    if (!legacyHash || BeastConfig.get("screenLock.pinHash")) return;
    BeastConfig.set("screenLock", {
      pinHash: legacyHash,
      autoLockEnabled: localStorage.getItem(LEGACY_AUTOLOCK_KEY) === "1"
    });
    localStorage.removeItem(LEGACY_PIN_HASH_KEY);
    localStorage.removeItem(LEGACY_AUTOLOCK_KEY);
  }

  function isLocked() {
    return mode === "locked";
  }

  // extrasEl (background/clock/camera/brightness) and cardSlotEl (the PIN
  // pad) are separate persistent children of overlayEl, created once --
  // render() used to replace overlay.innerHTML wholesale on every mode
  // change (including a wrong-PIN shake), which would tear down and
  // recreate the camera <iframe> each time and restart its video stream.
  // Only cardSlotEl's contents are replaced per-render now; extrasEl is
  // updated in place by renderExtras().
  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement("div");
    overlayEl.className = "beast-lock-overlay";
    extrasEl = document.createElement("div");
    extrasEl.className = "beast-lock-extras";
    cardSlotEl = document.createElement("div");
    cardSlotEl.className = "beast-lock-card-slot";
    overlayEl.appendChild(extrasEl);
    overlayEl.appendChild(cardSlotEl);
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
      cardSlotEl.innerHTML = "";
      renderExtras();
      return;
    }
    overlay.classList.add("is-open");

    const dots = Array.from({ length: PIN_LENGTH }, (_, i) => `<span class="beast-lock-dot${i < digits.length ? " is-filled" : ""}"></span>`).join("");
    const showCancel = mode !== "locked";
    const showRecovery = hasPin() && ["locked", "verify"].includes(mode);

    cardSlotEl.innerHTML = `
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

    cardSlotEl.querySelectorAll("[data-digit]").forEach((btn) => {
      btn.addEventListener("click", () => onDigit(btn.dataset.digit));
    });
    cardSlotEl.querySelector("[data-action='backspace']")?.addEventListener("click", onBackspace);
    cardSlotEl.querySelector("[data-action='cancel']")?.addEventListener("click", onCancel);
    cardSlotEl.querySelector("[data-action='recover']")?.addEventListener("click", startTrustedRecovery);
    renderExtras();
  }

  function updateClockText(host) {
    if (!host) return;
    const now = new Date();
    const h = String(now.getHours()).padStart(2, "0");
    const m = String(now.getMinutes()).padStart(2, "0");
    host.innerHTML = `<div class="beast-lock-clock-time">${h}<span class="beast-lock-clock-colon">:</span>${m}</div><div class="beast-lock-clock-date">${BeastCore.formatDate(now)}</div>`;
  }

  // Design settings (background/clock/camera/brightness) only apply to the
  // actual "locked" face -- not the PIN-setup or alarm-code-entry flows,
  // which reuse the same overlay but are transient admin/alarm actions
  // rather than the lock screen itself.
  function renderExtras() {
    const showExtras = mode === "locked";
    const config = showExtras ? (BeastConfig.get("lockScreen") || {}) : {};

    overlayEl.classList.toggle("has-custom-background", showExtras && Boolean(config.backgroundImageUrl || config.backgroundColor));
    overlayEl.style.backgroundImage = showExtras && config.backgroundImageUrl ? `url("${config.backgroundImageUrl}")` : "";
    overlayEl.style.backgroundColor = showExtras && config.backgroundColor ? config.backgroundColor : "";

    const cameraOn = showExtras && config.showCamera && config.cameraEntity;
    let cameraHost = extrasEl.querySelector(".beast-lock-camera");
    if (cameraOn) {
      const camera = (window.BeastCameras?.getAllCameras?.() || []).find((c) => c.entityId === config.cameraEntity);
      if (!cameraHost) {
        cameraHost = document.createElement("div");
        cameraHost.className = "beast-lock-camera";
        extrasEl.appendChild(cameraHost);
      }
      if (camera?.streamName) {
        const src = `./camera-player.html?v=11&sub=1&src=${encodeURIComponent(camera.streamName)}`;
        const absoluteSrc = new URL(src, window.location.href).href;
        let iframe = cameraHost.querySelector("iframe");
        if (!iframe) {
          cameraHost.innerHTML = `<iframe class="beast-lock-camera-frame" src="${src}" allow="autoplay"></iframe><div class="beast-lock-camera-veil"></div>`;
        } else if (iframe.src !== absoluteSrc) {
          iframe.src = src;
        }
      } else if (camera?.entityPicture) {
        if (!cameraHost.querySelector("img")) {
          cameraHost.innerHTML = `<img class="beast-lock-camera-frame" alt=""><div class="beast-lock-camera-veil"></div>`;
        }
        window.BeastAuth?.setAuthedImageSrc?.(cameraHost.querySelector("img"), camera.entityPicture);
      } else {
        cameraHost.innerHTML = "";
      }
    } else if (cameraHost) {
      cameraHost.remove();
    }

    let clockHost = extrasEl.querySelector(".beast-lock-clock");
    if (showExtras && config.showClock !== false) {
      if (!clockHost) {
        clockHost = document.createElement("div");
        extrasEl.insertBefore(clockHost, extrasEl.firstChild);
      }
      clockHost.className = `beast-lock-clock beast-lock-clock--${config.clockSize || "medium"}`;
      updateClockText(clockHost);
      if (!clockTimerId) {
        clockTimerId = window.setInterval(() => updateClockText(extrasEl.querySelector(".beast-lock-clock")), 1000);
      }
    } else {
      if (clockHost) clockHost.remove();
      if (clockTimerId) { window.clearInterval(clockTimerId); clockTimerId = null; }
    }

    const kioskLight = window.KIOSK_SCREEN_ENTITY_ID ? window.KIOSK_SCREEN_ENTITY_ID() : null;
    let brightnessHost = extrasEl.querySelector(".beast-lock-brightness");
    if (showExtras && config.brightnessEnabled && kioskLight) {
      if (!brightnessHost) {
        brightnessHost = document.createElement("div");
        brightnessHost.className = "beast-lock-brightness";
        brightnessHost.innerHTML = `${BeastCore.icon("sun", { size: 16 })}<input type="range" min="5" max="100" value="${Number(config.brightnessPercent) || 80}">`;
        extrasEl.appendChild(brightnessHost);
        brightnessHost.querySelector("input").addEventListener("input", (event) => {
          const pct = Number(event.target.value);
          window.clearTimeout(brightnessDebounceId);
          brightnessDebounceId = window.setTimeout(() => {
            BeastConfig.set("lockScreen.brightnessPercent", pct);
            window.BeastAuth?.haFetch?.("/api/services/light/turn_on", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ entity_id: kioskLight, brightness_pct: pct })
            }).catch(() => {});
          }, 250);
        });
      }
    } else if (brightnessHost) {
      brightnessHost.remove();
    }
  }

  document.addEventListener("beast:config-changed", () => { if (mode === "locked") renderExtras(); });

  function startTrustedRecovery() {
    sessionStorage.setItem("beast_panel_pin_recovery_pending_v1", "1");
    sessionStorage.setItem("beast_panel_pin_recovery_source_v1", window.location.pathname || "/");
    window.location.assign("/admin/?pin-recovery=1");
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
        BeastConfig.set("screenLock", { pinHash: null, autoLockEnabled: false });
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
    render();
  }

  function beginSetFlow(onDone) {
    mode = "set-first";
    digits = "";
    firstEntry = "";
    onDoneCallback = onDone || null;
    render();
  }

  function lockNow() {
    if (!hasPin()) return;
    mode = "locked";
    digits = "";
    onDoneCallback = null;
    render();
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

  function init() {
    if (alarmSubscribed || !window.BeastHaSocket) return;
    alarmSubscribed = true;
    migrateLegacyPinIfNeeded();
    const security = window.BeastConfig?.get("panels.security") || {};
    const alarmIds = Array.isArray(security.alarmPanels) ? security.alarmPanels.filter(Boolean) : [];
    BeastHaSocket.onStatusChange((status) => {
      if (status !== "connected" || !hasPin()) return;
      if (alarmIds.some((id) => BeastHaSocket.getState(id)?.state === "armed_away")) lockNow();
    });
    alarmIds.forEach((alarmId) => BeastHaSocket.subscribeEntity(alarmId, (entityId, newState, oldState) => {
      if (!newState) return;
      const wasArmed = oldState && String(oldState.state || "").startsWith("armed");
      const isArmed = String(newState.state || "").startsWith("armed");
      if (!wasArmed && isArmed && isAutoLockEnabled() && hasPin()) lockNow();
    }));
  }

  return {
    hasPin,
    isAutoLockEnabled,
    setAutoLockEnabled,
    isLocked,
    lockNow,
    requestCode,
    startSetPin,
    startChangePin,
    startRemovePin,
    resetPinAfterTrustedLogin,
    requestPinVerification,
    init
  };
})();

window.BeastScreenLock = BeastScreenLock;
