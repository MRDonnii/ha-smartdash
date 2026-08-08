<?php
// Version snapshots for the dashboard's own code (js/, css/, beast.html,
// index.html, admin/) — separate from backup.php, which only backs up the
// user's *config data*. This lets Administration show real version history
// and actually restore an older release, not just describe what changed.
header("Content-Type: application/json; charset=utf-8");

$root = realpath(__DIR__ . "/..");
$dataDir = $root . "/data";
$snapshotsDir = $dataDir . "/version-snapshots";
$changelogFile = $root . "/changelog.json";

if (!is_dir($dataDir)) mkdir($dataDir, 0775, true);
if (!is_dir($snapshotsDir)) mkdir($snapshotsDir, 0775, true);

// Everything that actually changes between releases. Deliberately excludes
// data/ (user config — handled by config.php/backup.php), fonts/, assets/,
// weather-icons/ (large, effectively static) so snapshots stay small and
// fast.
$versionedPaths = ["js", "css", "beast.html", "index.html", "admin/admin.js", "admin/admin.css", "admin/index.html"];

function currentBuildId($root) {
  $html = @file_get_contents($root . "/beast.html");
  if ($html && preg_match('/<meta name="beast-build" content="([^"]+)"/', $html, $m)) return $m[1];
  return "legacy";
}

// The build ID (e.g. "20260808-05") is what actually drives update
// comparisons -- it sorts correctly as a plain string, which a semver-style
// tag like "v0.5.10" doesn't ("v0.5.10" < "v0.5.9" lexicographically). This
// tag is display-only, read straight from the shipped beast.html, so
// Administration can show the same version number GitHub shows without
// needing a network call. Older snapshots taken before this existed won't
// have it -- callers should fall back to the build ID in that case.
function releaseTag($htmlPath) {
  $html = @file_get_contents($htmlPath);
  if ($html && preg_match('/<meta name="beast-release-tag" content="([^"]+)"/', $html, $m)) return $m[1];
  return null;
}

// Mirrors the same-named function in update.php -- if a rollback here is
// itself a downgrade, remember the build we rolled back FROM so the
// dashboard's idle auto-updater won't silently reinstall it the next time
// GitHub still reports it as latest. See update.php for the full rationale.
function recordSkippedIfDowngrade($dataDir, $fromBuildId, $toBuildId) {
  if (!$fromBuildId || !$toBuildId || $toBuildId >= $fromBuildId) return;
  @file_put_contents($dataDir . "/update-skip.json", json_encode(["skippedBuildId" => $fromBuildId, "skippedAt" => time()]));
}

function isSafeVersion($version) {
  return is_string($version) && preg_match('/^[A-Za-z0-9._-]{1,64}$/', $version);
}

function copyRecursive($src, $dst) {
  if (is_dir($src)) {
    if (!is_dir($dst)) mkdir($dst, 0775, true);
    foreach (scandir($src) as $item) {
      if ($item === "." || $item === "..") continue;
      copyRecursive("$src/$item", "$dst/$item");
    }
  } elseif (is_file($src)) {
    $dstDir = dirname($dst);
    if (!is_dir($dstDir)) mkdir($dstDir, 0775, true);
    copy($src, $dst);
  }
}

function dirSizeKb($path) {
  if (!is_dir($path)) return 0;
  $bytes = 0;
  $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS));
  foreach ($it as $file) $bytes += $file->getSize();
  return (int) round($bytes / 1024);
}

function readChangelog($file) {
  if (!file_exists($file)) return [];
  $decoded = json_decode(file_get_contents($file), true);
  return is_array($decoded) ? $decoded : [];
}

function snapshotVersion($root, $snapshotsDir, $versionedPaths, $version) {
  if (!isSafeVersion($version)) return false;
  $dest = $snapshotsDir . "/" . $version;
  if (is_dir($dest)) return true; // already have it
  $tmp = $dest . ".tmp-" . uniqid();
  foreach ($versionedPaths as $relPath) {
    $src = $root . "/" . $relPath;
    if (file_exists($src)) copyRecursive($src, $tmp . "/" . $relPath);
  }
  if (!is_dir($tmp)) return false;
  rename($tmp, $dest);
  return true;
}

function listSnapshots($snapshotsDir, $changelog) {
  $changelogByVersion = [];
  foreach ($changelog as $entry) {
    if (!empty($entry["version"])) $changelogByVersion[$entry["version"]] = $entry;
  }
  $versions = [];
  foreach (scandir($snapshotsDir) as $name) {
    if ($name === "." || $name === ".." || !isSafeVersion($name)) continue;
    $path = $snapshotsDir . "/" . $name;
    if (!is_dir($path)) continue;
    $entry = $changelogByVersion[$name] ?? null;
    $versions[] = [
      "version" => $name,
      "tag" => releaseTag($path . "/beast.html"),
      "date" => $entry["date"] ?? gmdate("Y-m-d", filemtime($path) ?: time()),
      "changes" => $entry["changes"] ?? [],
      "sizeKb" => dirSizeKb($path),
      "snapshottedAt" => gmdate("c", filemtime($path) ?: time())
    ];
  }
  usort($versions, function ($a, $b) { return strcmp($b["version"], $a["version"]); });
  return $versions;
}

$current = currentBuildId($root);
$method = $_SERVER["REQUEST_METHOD"];

if ($method === "GET") {
  echo json_encode([
    "currentVersion" => $current,
    "currentTag" => releaseTag($root . "/beast.html"),
    "hasCurrentSnapshot" => is_dir($snapshotsDir . "/" . $current),
    "versions" => listSnapshots($snapshotsDir, readChangelog($changelogFile))
  ]);
  exit;
}

if ($method !== "POST") { http_response_code(405); echo json_encode(["error" => "method_not_allowed"]); exit; }

$body = json_decode(file_get_contents("php://input"), true);
if (!is_array($body)) { http_response_code(400); echo json_encode(["error" => "invalid_json"]); exit; }
$action = $body["action"] ?? "";

if ($action === "snapshot") {
  $ok = snapshotVersion($root, $snapshotsDir, $versionedPaths, $current);
  echo json_encode(["success" => $ok, "version" => $current]);
  exit;
}

if ($action === "rollback") {
  $target = (string) ($body["version"] ?? "");
  if (!isSafeVersion($target)) { http_response_code(400); echo json_encode(["error" => "invalid_version"]); exit; }
  $src = $snapshotsDir . "/" . $target;
  if (!is_dir($src)) { http_response_code(404); echo json_encode(["error" => "snapshot_not_found"]); exit; }
  // Safety net: always snapshot what's live right now before overwriting
  // it, so a rollback is itself never a one-way door.
  snapshotVersion($root, $snapshotsDir, $versionedPaths, $current);
  foreach ($versionedPaths as $relPath) {
    $from = $src . "/" . $relPath;
    if (file_exists($from)) copyRecursive($from, $root . "/" . $relPath);
  }
  recordSkippedIfDowngrade($dataDir, $current, $target);
  echo json_encode(["success" => true, "restoredVersion" => $target]);
  exit;
}

http_response_code(400);
echo json_encode(["error" => "unknown_action"]);
