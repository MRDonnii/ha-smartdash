const BeastAuth = (() => {
  const AUTH_SCRIPT_URL = document.currentScript?.src || window.location.href;
  const APP_ROOT_URL = new URL("../", AUTH_SCRIPT_URL);
  // Keep the Home Assistant proxy beneath the current application base. This
  // is /ha on a normal Docker host and /api/hassio_ingress/<token>/ha when the
  // same files are opened through Home Assistant Ingress.
  const HA_PROXY_PATH = new URL("ha", APP_ROOT_URL).pathname.replace(/\/$/, "");
  const OAUTH_STORAGE_KEY = "beast_panel_ha_oauth_v1";
  const AUTH_PENDING_KEY = "beast_panel_ha_auth_pending_v1";
  const AUTH_DIAGNOSTICS_KEY = "beast_panel_ha_auth_diagnostics_v1";
  // Kept separate from BeastConfig on purpose: login has to work before any
  // HA connection exists to load registries/entities from, so this can't
  // depend on anything that itself needs a live HA session.
  const HA_BASE_URL_KEY = "beast_panel_ha_base_url_v1";
  // This install already had a working HA connection before the Opsætning
  // (Setup) flow existed, so an unset override falls back to that fixed
  // address instead of showing the first-run "connect" screen.
  const DEFAULT_HA_BASE_URL = "";

  let oauthConfig = loadOAuthConfig();

  function getHaBaseUrl() {
    return (localStorage.getItem(HA_BASE_URL_KEY) || "").trim() || DEFAULT_HA_BASE_URL;
  }

  function setHaBaseUrl(url) {
    const normalized = String(url || "").trim().replace(/\/+$/, "");
    localStorage.setItem(HA_BASE_URL_KEY, normalized);
    return normalized;
  }

  function loadOAuthConfig() {
    try {
      const raw = localStorage.getItem(OAUTH_STORAGE_KEY);
      if (!raw) return { accessToken: "", refreshToken: "", expiresAt: 0, clientId: "" };
      return JSON.parse(raw);
    } catch (error) {
      return { accessToken: "", refreshToken: "", expiresAt: 0, clientId: "" };
    }
  }

  function saveOAuthConfig(config) {
    localStorage.setItem(OAUTH_STORAGE_KEY, JSON.stringify(config));
  }

  function loadDiagnostics() {
    try {
      const entries = JSON.parse(sessionStorage.getItem(AUTH_DIAGNOSTICS_KEY) || "[]");
      return Array.isArray(entries) ? entries.slice(-20) : [];
    } catch (error) {
      return [];
    }
  }

  function recordDiagnostic(entry) {
    const safe = {
      time: new Date().toISOString(),
      phase: String(entry.phase || "login"),
      code: String(entry.code || "unknown"),
      status: Number(entry.status || 0),
      proxyPath: `${window.location.origin}${HA_PROXY_PATH}`,
      haAddress: getHaBaseUrl()
    };
    const entries = [...loadDiagnostics(), safe].slice(-20);
    sessionStorage.setItem(AUTH_DIAGNOSTICS_KEY, JSON.stringify(entries));
    window.dispatchEvent(new CustomEvent("beast:authdiagnostic", { detail: safe }));
    return safe;
  }

  function clearDiagnostics() {
    sessionStorage.removeItem(AUTH_DIAGNOSTICS_KEY);
  }

  function clearOAuthConfig() {
    localStorage.removeItem(OAUTH_STORAGE_KEY);
    oauthConfig = { accessToken: "", refreshToken: "", expiresAt: 0, clientId: "" };
  }

  function hasSession() {
    return Boolean(oauthConfig && String(oauthConfig.refreshToken || oauthConfig.accessToken || "").trim());
  }

  function proxyErrorMessage(result) {
    if (result.code === "ha-rejected-proxy") {
      return "Home Assistant afviste Nginx-proxyen (HTTP 400). Tilføj Nginx-serverens eller container-netværkets IP under http.trusted_proxies i Home Assistant configuration.yaml, aktivér use_x_forwarded_for, og genstart Home Assistant.";
    }
    if (result.code === "route-missing") {
      return `Home Assistant-proxyen /ha/ er ikke aktiv i Nginx (HTTP ${result.status}). Kontrollér at location /ha/ findes i den aktive serverblok.`;
    }
    if (result.code === "upstream-unavailable") {
      return `Nginx kan ikke nå Home Assistant gennem /ha/ (HTTP ${result.status}). Kontrollér Home Assistant-IP, port 8123 og proxy_pass.`;
    }
    if (result.code === "invalid-response") {
      return "Adressen /ha/ returnerer Smartdash/HTML i stedet for Home Assistant. Nginx location /ha/ mangler eller bliver tilsidesat af location /.";
    }
    if (result.code === "network-error") {
      return "Smartdash kunne ikke kontrollere Home Assistant-proxyen. Kontrollér Nginx og netværksforbindelsen til serveren.";
    }
    return `Home Assistant-proxyen svarede ikke korrekt${result.status ? ` (HTTP ${result.status})` : ""}.`;
  }

  async function checkProxy() {
    let response;
    try {
      response = await fetch(`${HA_PROXY_PATH}/auth/providers`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
    } catch (error) {
      const result = { ok: false, code: "network-error", status: 0 };
      recordDiagnostic({ phase: "proxy-check", ...result });
      return result;
    }

    let failure = null;
    if (response.status === 400) failure = { ok: false, code: "ha-rejected-proxy", status: response.status };
    else if ([404, 405].includes(response.status)) failure = { ok: false, code: "route-missing", status: response.status };
    else if ([502, 503, 504].includes(response.status)) failure = { ok: false, code: "upstream-unavailable", status: response.status };
    else if (!response.ok) failure = { ok: false, code: "proxy-error", status: response.status };
    if (failure) {
      recordDiagnostic({ phase: "proxy-check", ...failure });
      return failure;
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("application/json")) {
      const result = { ok: false, code: "invalid-response", status: response.status };
      recordDiagnostic({ phase: "proxy-check", ...result });
      return result;
    }
    try {
      const payload = await response.json();
      if (!Array.isArray(payload?.providers)) {
        const result = { ok: false, code: "invalid-response", status: response.status };
        recordDiagnostic({ phase: "proxy-check", ...result });
        return result;
      }
      return { ok: true, code: "ok", status: response.status };
    } catch (error) {
      const result = { ok: false, code: "invalid-response", status: response.status };
      recordDiagnostic({ phase: "proxy-check", ...result });
      return result;
    }
  }

  async function loginWithToken(token) {
    const accessToken = String(token || "").trim();
    if (!accessToken) throw Object.assign(new Error("HA_TOKEN_MISSING"), { userMessage: "Indsæt et Home Assistant Long-Lived Access Token." });
    let response;
    try {
      response = await fetch(`${HA_PROXY_PATH}/api/`, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
        cache: "no-store"
      });
    } catch (error) {
      recordDiagnostic({ phase: "token-login", code: "network-error", status: 0 });
      throw Object.assign(new Error("HA_TOKEN_NETWORK"), { userMessage: "Kunne ikke nå Home Assistant gennem /ha/-proxyen." });
    }
    if (!response.ok) {
      const code = response.status === 401 ? "token-rejected" : response.status === 400 ? "ha-rejected-proxy" : "token-validation-failed";
      recordDiagnostic({ phase: "token-login", code, status: response.status });
      const message = response.status === 401
        ? "Home Assistant afviste tokenet (HTTP 401). Opret et nyt Long-Lived Access Token og prøv igen."
        : proxyErrorMessage({ code, status: response.status });
      throw Object.assign(new Error(`HA_TOKEN_${response.status}`), { userMessage: message });
    }
    oauthConfig = { accessToken, refreshToken: "", expiresAt: 0, clientId: "", mode: "token" };
    saveOAuthConfig(oauthConfig);
    return true;
  }

  function buildClientId() {
    return `${window.location.origin}${window.location.pathname}`;
  }

  function buildRedirectUri() {
    return `${window.location.origin}${window.location.pathname}`;
  }

  function startLogin(options = {}) {
    const baseUrl = getHaBaseUrl();
    if (!baseUrl) throw new Error("HA_BASE_URL_MISSING");

    const authState = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(AUTH_PENDING_KEY, JSON.stringify({ state: authState }));

    const redirectUri = buildRedirectUri();
    const clientId = buildClientId();
    const prompt = options.forceLogin ? "&prompt=login" : "";
    const authorizeUrl = `${baseUrl}/auth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(authState)}&response_type=code${prompt}`;
    window.location.assign(authorizeUrl);
  }

  async function prepareLogin(options = {}) {
    const result = await checkProxy();
    if (!result.ok) {
      const error = new Error(`HA_PROXY_${result.code.toUpperCase().replace(/-/g, "_")}`);
      error.userMessage = proxyErrorMessage(result);
      error.proxyResult = result;
      throw error;
    }
    startLogin(options);
  }

  function clearAuthQueryParams() {
    const url = new URL(window.location.href);
    ["code", "state", "error", "error_description"].forEach((key) => url.searchParams.delete(key));
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }

  async function exchangeAuthorizationCodeForToken(code) {
    const response = await fetch(`${HA_PROXY_PATH}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: buildClientId(),
        redirect_uri: buildRedirectUri()
      }).toString()
    });
    if (!response.ok) throw new Error(`HA_AUTH_${response.status}`);
    return response.json();
  }

  async function handleAuthCallback() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("code") && !params.has("error")) return null;

    const pendingRaw = sessionStorage.getItem(AUTH_PENDING_KEY);
    sessionStorage.removeItem(AUTH_PENDING_KEY);
    clearAuthQueryParams();

    if (!pendingRaw) {
      recordDiagnostic({ phase: "oauth-callback", code: "missing-session", status: 0 });
      return { type: "error", message: "Login-sessionen mangler. Prøv igen." };
    }
    const pending = JSON.parse(pendingRaw);
    if (params.get("state") !== pending.state) {
      recordDiagnostic({ phase: "oauth-callback", code: "state-mismatch", status: 0 });
      return { type: "error", message: "Login blev afvist (state matcher ikke)." };
    }
    if (params.has("error")) {
      recordDiagnostic({ phase: "oauth-callback", code: params.get("error") || "oauth-error", status: 0 });
      return { type: "error", message: `Login blev afbrudt: ${params.get("error_description") || params.get("error")}` };
    }

    try {
      const tokenData = await exchangeAuthorizationCodeForToken(params.get("code"));
      oauthConfig = {
        accessToken: tokenData.access_token || "",
        refreshToken: tokenData.refresh_token || "",
        expiresAt: Date.now() + (Number(tokenData.expires_in || 1800) * 1000),
        clientId: buildClientId()
      };
      saveOAuthConfig(oauthConfig);
      return { type: "success" };
    } catch (error) {
      const status = Number(String(error.message || "").match(/HA_AUTH_(\d+)/)?.[1] || 0);
      recordDiagnostic({ phase: "oauth-token-exchange", code: status ? `http-${status}` : "network-error", status });
      if (status === 400) return { type: "error", message: proxyErrorMessage({ code: "ha-rejected-proxy", status }) };
      if ([404, 405].includes(status)) return { type: "error", message: proxyErrorMessage({ code: "route-missing", status }) };
      if ([502, 503, 504].includes(status)) return { type: "error", message: proxyErrorMessage({ code: "upstream-unavailable", status }) };
      return { type: "error", message: "Kunne ikke fuldføre login. Kontrollér Home Assistant-proxyen /ha/ og prøv igen." };
    }
  }

  async function refreshAccessToken(forceRefresh = false) {
    if (!hasSession()) throw new Error("HA_AUTH_MISSING");
    if (oauthConfig.mode === "token" && oauthConfig.accessToken) return oauthConfig.accessToken;

    const expiresSoon = !oauthConfig.expiresAt || Date.now() >= (Number(oauthConfig.expiresAt) - 60000);
    if (!forceRefresh && oauthConfig.accessToken && !expiresSoon) {
      return oauthConfig.accessToken;
    }

    const response = await fetch(`${HA_PROXY_PATH}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: oauthConfig.refreshToken,
        client_id: oauthConfig.clientId || buildClientId()
      }).toString()
    });

    if (!response.ok) {
      clearOAuthConfig();
      throw new Error(`HA_AUTH_${response.status}`);
    }

    const payload = await response.json();
    oauthConfig.accessToken = payload.access_token || "";
    oauthConfig.refreshToken = payload.refresh_token || oauthConfig.refreshToken;
    oauthConfig.expiresAt = Date.now() + (Number(payload.expires_in || 1800) * 1000);
    oauthConfig.clientId = oauthConfig.clientId || buildClientId();
    saveOAuthConfig(oauthConfig);
    return oauthConfig.accessToken;
  }

  async function haFetch(path, options = {}) {
    const requestOnce = async () => {
      const token = await refreshAccessToken(false);
      const headers = { Authorization: `Bearer ${token}`, ...(options.headers || {}) };
      return fetch(`${HA_PROXY_PATH}${path}`, { ...options, headers });
    };

    let response = await requestOnce();
    if (response.status === 401) {
      await refreshAccessToken(true);
      response = await requestOnce();
    }
    if (!response.ok) {
      const error = new Error(`HA request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return null;
    return response.json();
  }

  // <img src> can't carry an Authorization header, so HA-proxied images (area
  // pictures, media artwork) need to be fetched as a blob and handed to the
  // <img> as an object URL instead of a plain HA path.
  async function haFetchBlob(path) {
    const requestOnce = async () => {
      const token = await refreshAccessToken(false);
      return fetch(`${HA_PROXY_PATH}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    };
    let response = await requestOnce();
    if (response.status === 401) {
      await refreshAccessToken(true);
      response = await requestOnce();
    }
    if (!response.ok) {
      const error = new Error(`HA request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.blob();
  }

  async function setAuthedImageSrc(imgEl, path) {
    if (!path) { imgEl.removeAttribute("src"); return; }
    try {
      const blob = await haFetchBlob(path);
      const objectUrl = URL.createObjectURL(blob);
      if (imgEl.dataset.objectUrl) URL.revokeObjectURL(imgEl.dataset.objectUrl);
      imgEl.dataset.objectUrl = objectUrl;
      imgEl.src = objectUrl;
    } catch (error) {
      imgEl.removeAttribute("src");
    }
  }

  function logout() {
    clearOAuthConfig();
  }

  return {
    HA_PROXY_PATH,
    getHaBaseUrl,
    setHaBaseUrl,
    hasSession,
    checkProxy,
    loginWithToken,
    prepareLogin,
    startLogin,
    handleAuthCallback,
    refreshAccessToken,
    haFetch,
    haFetchBlob,
    setAuthedImageSrc,
    getDiagnostics: loadDiagnostics,
    clearDiagnostics,
    logout
  };
})();
