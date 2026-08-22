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
if (!latest || !/^v\d+\.\d+\.\d+$/.test(latest.tag || "")) throw new Error("Latest changelog tag must use vMAJOR.MINOR.PATCH.");
if (!/^\d{8}-\d+$/.test(latest.version || "")) throw new Error("Latest changelog version must use YYYYMMDD-N.");
for (const html of [index, beast]) {
  if (meta(html, "beast-release-tag") !== latest.tag) throw new Error("HTML release tag does not match the latest changelog tag.");
  if (meta(html, "beast-build") !== latest.version) throw new Error("HTML build ID does not match the latest changelog version.");
  const releaseAssets = ["ha-smartdash-misc.css", "ha-smartdash-overview.css", "ha-smartdash-card-editor.js", "ha-smartdash-overview.js"];
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
