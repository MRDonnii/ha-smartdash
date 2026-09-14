#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

sh -n "$ROOT/deploy/check-install.sh"
sh -n "$ROOT/deploy/setup-smartdash.sh"

NODE_BIN=${NODE_BIN:-node}
PHP_BIN=${PHP_BIN:-php}

if command -v "$NODE_BIN" >/dev/null 2>&1 || test -x "$NODE_BIN"; then
  find "$ROOT/js" "$ROOT/admin" -name '*.js' -type f -exec "$NODE_BIN" --check {} \;
  "$NODE_BIN" - "$ROOT" <<'NODE'
const fs = require("fs");
const path = require("path");
const root = process.argv[2];
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const meta = (html, name) => html.match(new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([^"']+)["']`))?.[1];
const index = read("index.html");
const beast = read("beast.html");
const changelog = JSON.parse(read("changelog.json"));
const latest = changelog[0];
const addonConfig = read("home-assistant-addon/config.yaml");
const addonChangelog = read("home-assistant-addon/CHANGELOG.md");
const power = read("js/ha-smartdash-power.js");
const auth = read("js/ha-smartdash-auth.js");
const cameras = read("js/ha-smartdash-cameras.js");
const overview = read("js/ha-smartdash-overview.js");
const app = read("js/ha-smartdash-app.js");
const admin = read("admin/admin.js");
const adminHtml = read("admin/index.html");
const core = read("js/ha-smartdash-core.js");
if (!latest || !/^v\d+\.\d+\.\d+$/.test(latest.tag || "")) throw new Error("Latest changelog tag must use vMAJOR.MINOR.PATCH.");
if (!/^\d{8}-\d+$/.test(latest.version || "")) throw new Error("Latest changelog version must use YYYYMMDD-N.");
for (const html of [index, beast]) {
  if (meta(html, "beast-release-tag") !== latest.tag) throw new Error("HTML release tag does not match the latest changelog tag.");
  if (meta(html, "beast-build") !== latest.version) throw new Error("HTML build ID does not match the latest changelog version.");
  const releaseAssets = ["ha-smartdash-misc.css", "ha-smartdash-overview.css", "ha-smartdash-card-editor.js", "ha-smartdash-overview.js", "ha-smartdash-power.js", "ha-smartdash-cameras.js", "ha-smartdash-app.js"];
  for (const asset of releaseAssets) {
    const escaped = asset.replaceAll(".", "\\.");
    const cacheId = html.match(new RegExp(`${escaped}\\?v=([^\"']+)`))?.[1];
    if (cacheId !== latest.version) throw new Error(`${asset} cache ID must match the release build ID.`);
  }
}
if (!Array.isArray(latest.changes) || !latest.changes.length || latest.changes.some((item) => !String(item?.da || "").trim() || !String(item?.en || "").trim())) {
  throw new Error("Every latest changelog change must contain non-empty da and en text.");
}
const semanticVersion = latest.tag.slice(1);
if (!new RegExp(`^version:\\s*["']?${semanticVersion.replaceAll(".", "\\.")}["']?\\s*$`, "m").test(addonConfig)) {
  throw new Error("Home Assistant App version must match the latest release tag without the leading v.");
}
if (!addonChangelog.includes(`## ${semanticVersion}`)) throw new Error("Home Assistant App changelog must include the latest release version.");
if (!power.includes('event.data?.type !== EVENT_TYPE') || !power.includes('beast:powerstatechange')) throw new Error("Power bridge must validate and publish power state changes.");
if (!cameras.includes('window.BeastPower?.getState?.() !== "idle"') || !cameras.includes('this._remoteStream?.getTracks().forEach((track) => track.stop())')) throw new Error("Camera lifecycle must stop media while Smartdash is idle.");
if (!overview.includes("groups.flatMap((group) => group.cameras)") || !overview.includes("cameras: everyCamera") || overview.includes("data-camera-allowed")) throw new Error("Every overview camera group must use the complete camera catalog without a per-group allowlist.");
if (!overview.includes("data-camera-auto") || !overview.includes("data-camera-fallback") || !overview.includes("autoKeys.includes(automaticKey)")) throw new Error("Overview camera groups must expose automatic membership and fallback selection.");
if (!overview.includes("beast-ov-camera-star") || overview.includes("<select data-camera-fallback")) throw new Error("Camera fallback must use the compact per-row favourite star.");
if (!overview.includes('sendCommand("config/entity_registry/list")') || !overview.includes("overviewDetectionTimestamp") || !overview.includes("defaultOverviewCameraGroups")) throw new Error("Overview cameras must use detection-driven automatic views by default.");
if (!cameras.includes('querySelectorAll("img.beast-camera-snapshot")')) throw new Error("Periodic snapshot refresh must target image elements only.");
if (!cameras.includes('key:"displayMode"') || !cameras.includes('value:"live"') || !cameras.includes('key:"snapshotInterval"')) throw new Error("Camera picker must expose live/snapshot mode and snapshot interval controls.");
if (!cameras.includes('function stripCameraMarkup(camera)') || !cameras.includes('class="beast-camera-tile-live"')) throw new Error("Camera picker live mode must render dedicated live media without reusing snapshot refresh targets.");
if (!app.includes('!frame.closest("#beastOvCameras")')) throw new Error("Overview camera players must recover internally without outer iframe reloads.");
if (!auth.includes("preloadAuthedImage") || !cameras.includes("preloadOverviewSnapshots") || !overview.includes("current.replaceWith(tile)")) throw new Error("Overview camera switching must use warmed posters and per-tile reconciliation.");
if (!admin.includes('data-admin-view="health"') || !admin.includes('runHealthCheck') || !admin.includes('BeastHaSocket.sendCommand("get_config")')) throw new Error("Admin must include the Health Center checks.");
if (!admin.includes('ha-smartdash-diagnostics') || !admin.includes('redactDiagnostics') || !admin.includes('adminHealthExport') || !core.includes('getRuntimeErrors')) throw new Error("Health Center must export safe support diagnostics with runtime errors.");
if (!admin.includes('"[REDACTED]"') || !admin.includes('authentication:BeastAuth.getDiagnostics()')) throw new Error("Diagnostics export must redact secrets before including authentication diagnostics.");
for (const asset of ["admin.css", "admin.js", "ha-smartdash-cameras.js"]) if (!adminHtml.includes(`${asset}?v=${latest.version}`)) throw new Error(`Admin cache ID must match for ${asset}.`);
if (meta(adminHtml, "beast-release-tag") !== latest.tag || meta(adminHtml, "beast-build") !== latest.version) throw new Error("Admin release metadata must match the latest release.");
for (const html of [index, beast]) {
  if (html.indexOf("ha-smartdash-power.js") > html.indexOf("ha-smartdash-cameras.js")) throw new Error("Power bridge must load before camera components.");
}
console.log(`Release metadata OK: ${latest.tag} (${latest.version})`);
NODE
else
  echo "Node.js not found; JavaScript syntax check skipped." >&2
fi

if command -v "$PHP_BIN" >/dev/null 2>&1 || test -x "$PHP_BIN"; then
  "$PHP_BIN" -l "$ROOT/api/config.php" >/dev/null
  "$PHP_BIN" -l "$ROOT/api/backup.php" >/dev/null
  "$PHP_BIN" -l "$ROOT/api/versions.php" >/dev/null
  "$PHP_BIN" -l "$ROOT/api/update.php" >/dev/null
  "$PHP_BIN" -l "$ROOT/api/local-profile.php" >/dev/null
  "$PHP_BIN" -r 'json_decode(file_get_contents($argv[1]), true, 512, JSON_THROW_ON_ERROR);' "$ROOT/data/config.example.json"
elif command -v python3 >/dev/null 2>&1; then
  python3 -m json.tool "$ROOT/data/config.example.json" >/dev/null
  echo "PHP not found; PHP lint skipped." >&2
else
  echo "Neither PHP nor Python found; JSON/PHP checks skipped." >&2
fi

if grep -RIE --exclude-dir=.git --exclude='check-release.sh' 'eyJ[a-zA-Z0-9_-]{20,}\.|(10|192\.168)\.[0-9]+\.[0-9]+\.[0-9]+' "$ROOT"; then
  echo "Potential private address or credential found." >&2
  exit 1
fi

test -f "$ROOT/index.html"
test -f "$ROOT/admin/index.html"
test -f "$ROOT/LICENSE"
test ! -f "$ROOT/data/config.json"
echo "HA Smartdash release checks passed."
