const BeastHaSocket = (() => {
  const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000, 10000, 15000];
  const CONNECT_TIMEOUT_MS = 10000;
  const WATCHDOG_INTERVAL_MS = 15000;
  const STALE_CONNECTION_MS = 45000;

  let ws = null;
  let messageId = 1;
  let subscribeEventsMsgId = null;
  let reconnectAttempt = 0;
  let reconnectTimerId = null;
  let authRetried = false;
  let intentionalClose = false;
  let lastMessageAt = 0;
  let watchdogTimerId = null;
  let disconnectedAt = 0;

  const stateByEntity = new Map();
  const pendingCommands = new Map();
  const entitySubscribers = new Map();
  const domainSubscribers = new Map();
  const wildcardSubscribers = new Set();
  const statusListeners = new Set();
  const deferredNotifications = new Map();
  let deferredFlushPending = false;

  function setStatus(state, detail) {
    statusListeners.forEach((callback) => {
      try { callback(state, detail); } catch (error) { console.error("[BeastHaSocket] status listener failed", error); }
    });
  }

  function onStatusChange(callback) {
    statusListeners.add(callback);
    return () => statusListeners.delete(callback);
  }

  function subscribeEntity(entityId, callback) {
    if (!entitySubscribers.has(entityId)) entitySubscribers.set(entityId, new Set());
    entitySubscribers.get(entityId).add(callback);
    return () => entitySubscribers.get(entityId)?.delete(callback);
  }

  function subscribeDomain(domain, callback) {
    if (!domainSubscribers.has(domain)) domainSubscribers.set(domain, new Set());
    domainSubscribers.get(domain).add(callback);
    return () => domainSubscribers.get(domain)?.delete(callback);
  }

  function subscribeAll(callback) {
    wildcardSubscribers.add(callback);
    return () => wildcardSubscribers.delete(callback);
  }

  function dispatchNotify(entityId, newState, oldState) {
    const domain = entityId.split(".")[0];
    entitySubscribers.get(entityId)?.forEach((cb) => safeCall(cb, entityId, newState, oldState));
    domainSubscribers.get(domain)?.forEach((cb) => safeCall(cb, entityId, newState, oldState));
    wildcardSubscribers.forEach((cb) => safeCall(cb, entityId, newState, oldState));
  }

  function notify(entityId, newState, oldState) {
    if (typeof BeastCore !== "undefined" && BeastCore.isUserInteracting()) {
      deferredNotifications.set(entityId, { newState, oldState });
      if (!deferredFlushPending) {
        deferredFlushPending = true;
        BeastCore.whenUserIdle(() => {
          deferredFlushPending = false;
          const queued = Array.from(deferredNotifications.entries());
          deferredNotifications.clear();
          queued.forEach(([id, states]) => dispatchNotify(id, states.newState, states.oldState));
        });
      }
      return;
    }
    dispatchNotify(entityId, newState, oldState);
  }

  function safeCall(fn, ...args) {
    try { fn(...args); } catch (error) { console.error("[BeastHaSocket] subscriber failed", error); }
  }

  function getState(entityId) {
    return stateByEntity.get(entityId) || null;
  }

  function getAllStates() {
    return new Map(stateByEntity);
  }

  function nextId() {
    return messageId++;
  }

  function sendCommand(type, extra = {}) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error("SOCKET_NOT_OPEN"));
        return;
      }
      const id = nextId();
      pendingCommands.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, type, ...extra }));
    });
  }

  function connect(force = false) {
    if (!force && ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    intentionalClose = false;
    window.clearTimeout(reconnectTimerId);
    if (force && ws) {
      try { ws.close(); } catch (error) {}
    }
    setStatus("connecting");
    BeastCore.log("HA-socket: forbinder...");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${protocol}//${window.location.host}${BeastAuth.HA_PROXY_PATH}/api/websocket`);

    const connectTimeoutId = window.setTimeout(() => {
      BeastCore.log("HA-socket: timeout, forsøger igen.");
      ws.close();
    }, CONNECT_TIMEOUT_MS);

    ws.addEventListener("message", async (event) => {
      lastMessageAt = Date.now();
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        return;
      }

      if (message.type === "auth_required") {
        const token = await BeastAuth.refreshAccessToken(false).catch(() => null);
        if (!token) {
          BeastCore.log("HA-socket: intet gyldigt token, kan ikke logge ind.");
          ws.close();
          return;
        }
        ws.send(JSON.stringify({ type: "auth", access_token: token }));
        return;
      }

      if (message.type === "auth_invalid") {
        window.clearTimeout(connectTimeoutId);
        if (!authRetried) {
          authRetried = true;
          BeastCore.log("HA-socket: token afvist, forsøger at forny.");
          await BeastAuth.refreshAccessToken(true).catch(() => null);
          ws.close();
          scheduleReconnect(true);
        } else {
          BeastCore.log("HA-socket: login fejlede permanent.");
          setStatus("auth-failed");
        }
        return;
      }

      if (message.type === "auth_ok") {
        window.clearTimeout(connectTimeoutId);
        authRetried = false;
        reconnectAttempt = 0;
        lastMessageAt = Date.now();
        BeastCore.log("HA-socket: godkendt, abonnerer på ændringer.");
        await subscribeAndSnapshot();
        // downMs tells listeners how long the connection was actually down
        // for -- 0 on first page load or a sub-watchdog-cycle blip that
        // recovered on its own, a real duration after something like an HA
        // restart. app.js uses this to force a full page reload after a
        // long enough outage instead of trying to patch every widget's
        // stale state back to life individually (cameras, images, timers,
        // ...) -- the same fresh start a manual reload already gives.
        const downMs = disconnectedAt ? Date.now() - disconnectedAt : 0;
        disconnectedAt = 0;
        setStatus("connected", { downMs });
        return;
      }

      if (message.type === "result" && pendingCommands.has(message.id)) {
        const { resolve, reject } = pendingCommands.get(message.id);
        pendingCommands.delete(message.id);
        if (message.success) resolve(message.result);
        else reject(new Error((message.error && message.error.message) || "HA_WS_ERROR"));
        return;
      }

      if (message.type === "event" && message.id === subscribeEventsMsgId) {
        const data = message.event && message.event.data;
        if (!data || !data.entity_id) return;
        const oldState = stateByEntity.get(data.entity_id) || null;
        if (data.new_state) stateByEntity.set(data.entity_id, data.new_state);
        else stateByEntity.delete(data.entity_id);
        notify(data.entity_id, data.new_state, oldState);
      }
    });

    ws.addEventListener("close", () => {
      window.clearTimeout(connectTimeoutId);
      pendingCommands.forEach(({ reject }) => reject(new Error("SOCKET_CLOSED")));
      pendingCommands.clear();
      if (intentionalClose) return;
      if (!disconnectedAt && lastMessageAt) disconnectedAt = Date.now();
      setStatus("connecting");
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      window.clearTimeout(connectTimeoutId);
    });
  }

  async function subscribeAndSnapshot() {
    subscribeEventsMsgId = nextId();
    ws.send(JSON.stringify({ id: subscribeEventsMsgId, type: "subscribe_events", event_type: "state_changed" }));
    pendingCommands.set(subscribeEventsMsgId, {
      resolve: () => {},
      reject: () => BeastCore.log("HA-socket: kunne ikke abonnere på ændringer.")
    });

    // Always re-fetch on (re)connect, even if the cache already holds
    // entities from before. Reusing the cache here used to skip this on
    // every reconnect but the very first one -- if a single entity's state
    // ever missed that one-and-only snapshot (e.g. HA still starting up
    // when it was taken, so that integration's entities weren't loaded
    // yet), no later reconnect ever corrected it; the cache just kept
    // "reusing" the same permanent gap. A restart is exactly the moment a
    // full re-sync matters most.
    await refreshSnapshot();
  }

  async function refreshSnapshot() {
    try {
      const states = await sendCommand("get_states");
      stateByEntity.clear();
      (states || []).forEach((state) => stateByEntity.set(state.entity_id, state));
      BeastCore.log(`HA-socket: hentede ${stateByEntity.size} entities.`);
      wildcardSubscribers.forEach((cb) => safeCall(cb, "*", null, null));
    } catch (error) {
      BeastCore.log(`HA-socket: kunne ikke hente status-snapshot (${error.message}).`);
      throw error;
    }
  }

  function scheduleReconnect(immediate = false) {
    window.clearTimeout(reconnectTimerId);
    const delay = immediate ? 300 : RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    reconnectAttempt += 1;
    reconnectTimerId = window.setTimeout(connect, delay);
  }

  function disconnect() {
    intentionalClose = true;
    window.clearTimeout(reconnectTimerId);
    if (ws) ws.close();
  }

  function startWatchdog() {
    if (watchdogTimerId) return;
    watchdogTimerId = window.setInterval(() => {
      if (document.hidden || navigator.onLine === false) return;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        scheduleReconnect(true);
        return;
      }
      if (ws.readyState !== WebSocket.OPEN) return;
      if (lastMessageAt && Date.now() - lastMessageAt > STALE_CONNECTION_MS) {
        BeastCore.log("HA-socket: forbindelsen svarer ikke, genstarter lokalt.");
        try { ws.close(); } catch (error) {}
        return;
      }
      try {
        ws.send(JSON.stringify({ id: nextId(), type: "ping" }));
      } catch (error) {
        try { ws.close(); } catch (closeError) {}
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  window.addEventListener("online", () => {
    BeastCore.log("Netværk tilbage: genopretter HA-forbindelsen.");
    connect(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && (!lastMessageAt || Date.now() - lastMessageAt > WATCHDOG_INTERVAL_MS * 2)) connect(true);
  });
  window.addEventListener("pageshow", () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) connect(true);
  });
  startWatchdog();

  return {
    connect,
    disconnect,
    onStatusChange,
    subscribeEntity,
    subscribeDomain,
    subscribeAll,
    getState,
    getAllStates,
    refreshSnapshot,
    sendCommand
  };
})();
