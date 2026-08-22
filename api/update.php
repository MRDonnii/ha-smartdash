<?php
// Real GitHub-backed updater. api/versions.php only replays version
// snapshots that already exist on this specific server's disk (useful for
// same-server rollback), which meant an install that never received a
// hand-pushed update -- e.g. a fresh clone from GitHub -- had no way to
// ever discover or fetch a newer release. This endpoint actually talks to
// GitHub: checks the latest release, downloads its source archive,
// validates it, snapshots the current install, and installs the new files
// without touching user data.
header("Content-Type: application/json; charset=utf-8");

$root = realpath(__DIR__ . "/..");
$dataDir = $root . "/data";
$snapshotsDir = $dataDir . "/version-snapshots";
$githubRepo = "MRDonnii/ha-smartdash";

if (!is_dir($dataDir)) mkdir($dataDir, 0775, true);
if (!is_dir($snapshotsDir)) mkdir($snapshotsDir, 0775, true);

// Repository items that are not part of a live deployment. Installation
// still copies every other item from the clean GitHub archive, but rollback
// snapshots deliberately use the same compact application-code list as
// api/versions.php. A deployed folder can contain old backup-before-* dirs
// and other local files; snapshotting the whole root recursively made every
// update inherit those files and inflated snapshots from ~1.4 MB to ~138 MB.
$excludeTopLevel = [
  "data", ".git", ".github", ".gitignore", ".gitattributes", ".DS_Store",
  "README.md", "README.da.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md",
  "THIRD_PARTY_NOTICES.md", "demo", "deploy", "docs", "scripts"
];
$snapshotPaths = ["js", "css", "beast.html", "index.html", "admin/admin.js", "admin/admin.css", "admin/index.html"];

function currentBuildId($root) {
  $html = @file_get_contents($root . "/beast.html");
  if ($html && preg_match('/<meta name="beast-build" content="([^"]+)"/', $html, $m)) return $m[1];
  return "legacy";
}

function isSafeVersion($version) {
  return is_string($version) && preg_match('/^[A-Za-z0-9._-]{1,64}$/', $version);
}

function compareBuildIds($a, $b) {
  if (preg_match('/^(\d{8})-(\d+)$/', (string) $a, $left) && preg_match('/^(\d{8})-(\d+)$/', (string) $b, $right)) {
    $dateCompare = strcmp($left[1], $right[1]);
    if ($dateCompare !== 0) return $dateCompare;
    return ((int) $left[2]) <=> ((int) $right[2]);
  }
  return version_compare((string) $a, (string) $b);
}

// If installing $toBuildId is actually a downgrade from $fromBuildId,
// remember $fromBuildId so the dashboard's own idle auto-updater (in
// ha-smartdash-app.js) won't silently reinstall it the next time GitHub
// still reports it as the latest release -- that's exactly what "a
// rollback fixes it, then the kiosk quietly re-breaks itself an hour
// later" looks like from the outside. Not a permanent block: build IDs
// sort as plain strings (YYYYMMDD-NN), so this only matters for as long
// as GitHub's latest happens to equal this exact build; a genuinely new
// release naturally supersedes it and check() stops suppressing anything.
function recordSkippedIfDowngrade($dataDir, $fromBuildId, $toBuildId) {
  if (!$fromBuildId || !$toBuildId || compareBuildIds($toBuildId, $fromBuildId) >= 0) return;
  @file_put_contents($dataDir . "/update-skip.json", json_encode(["skippedBuildId" => $fromBuildId, "skippedAt" => time()]));
}

function skippedBuildId($dataDir) {
  $raw = @file_get_contents($dataDir . "/update-skip.json");
  $decoded = $raw ? json_decode($raw, true) : null;
  return is_array($decoded) ? ($decoded["skippedBuildId"] ?? null) : null;
}

function isSafeTag($tag) {
  return is_string($tag) && preg_match('/^v?[0-9]+\.[0-9]+\.[0-9]+$/', $tag);
}

function copyRecursive($src, $dst) {
  if (is_dir($src)) {
    if (!is_dir($dst) && !mkdir($dst, 0775, true) && !is_dir($dst)) throw new RuntimeException("Could not create directory: $dst");
    foreach (scandir($src) as $item) {
      if ($item === "." || $item === "..") continue;
      copyRecursive("$src/$item", "$dst/$item");
    }
  } elseif (is_file($src)) {
    $dstDir = dirname($dst);
    if (!is_dir($dstDir) && !mkdir($dstDir, 0775, true) && !is_dir($dstDir)) throw new RuntimeException("Could not create directory: $dstDir");
    if (!copy($src, $dst)) throw new RuntimeException("Could not replace file: $dst");
  }
}

function snapshotCurrent($root, $snapshotsDir, $snapshotPaths, $version) {
  if (!isSafeVersion($version)) return false;
  $dest = $snapshotsDir . "/" . $version;
  if (is_dir($dest)) return true;
  $tmp = $dest . ".tmp-" . uniqid();
  foreach ($snapshotPaths as $relPath) {
    $src = $root . "/" . $relPath;
    if (file_exists($src)) copyRecursive($src, $tmp . "/" . $relPath);
  }
  if (!is_dir($tmp)) return false;
  rename($tmp, $dest);
  return true;
}

function pruneSnapshots($snapshotsDir, $keepCount, $protectedVersions = []) {
  $entries = [];
  foreach (scandir($snapshotsDir) as $name) {
    if ($name === "." || $name === ".." || !isSafeVersion($name) || !is_dir($snapshotsDir . "/" . $name)) continue;
    $entries[] = $name;
  }
  usort($entries, function ($a, $b) { return compareBuildIds($b, $a); });
  $keep = array_fill_keys(array_slice($entries, 0, max(1, (int) $keepCount)), true);
  foreach ($protectedVersions as $version) if (isSafeVersion($version)) $keep[$version] = true;
  foreach ($entries as $name) if (!isset($keep[$name])) recursiveRemove($snapshotsDir . "/" . $name);
}

function httpGet($url, &$error = null) {
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 20,
    CURLOPT_USERAGENT => "ha-smartdash-updater",
    CURLOPT_HTTPHEADER => ["Accept: application/vnd.github+json"],
  ]);
  $body = curl_exec($ch);
  $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  if ($body === false) $error = curl_error($ch);
  curl_close($ch);
  if ($body === false || $status < 200 || $status >= 300) {
    $error = $error ?: "HTTP $status";
    return null;
  }
  return $body;
}

function downloadToFile($url, $destPath, &$error = null) {
  $ch = curl_init($url);
  $fh = fopen($destPath, "wb");
  if (!$fh) { $error = "Could not open temp file for writing"; return false; }
  curl_setopt_array($ch, [
    CURLOPT_FILE => $fh,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 45,
    CURLOPT_USERAGENT => "ha-smartdash-updater",
  ]);
  $ok = curl_exec($ch);
  $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  if (!$ok) $error = curl_error($ch);
  curl_close($ch);
  fclose($fh);
  if (!$ok || $status < 200 || $status >= 300) {
    $error = $error ?: "HTTP $status";
    @unlink($destPath);
    return false;
  }
  return true;
}

function fetchLatestRelease($githubRepo, &$error = null) {
  $body = httpGet("https://api.github.com/repos/$githubRepo/releases/latest", $error);
  if ($body === null) return null;
  $data = json_decode($body, true);
  if (!is_array($data) || empty($data["tag_name"])) { $error = "Unexpected GitHub API response"; return null; }
  return $data;
}

function fetchLatestReleaseFromAtom($githubRepo, &$error = null) {
  $feedError = null;
  $body = httpGet("https://github.com/$githubRepo/releases.atom", $feedError);
  if ($body === null) { $error = $feedError; return null; }

  if (!preg_match('/<entry>(.*?)<\/entry>/s', $body, $entryMatch)) {
    $error = "No release entry found in GitHub Atom feed";
    return null;
  }
  $entry = $entryMatch[1];
  if (!preg_match('/<id>[^<]*\/([^<\/]+)<\/id>/', $entry, $tagMatch)) {
    $error = "Release tag not found in GitHub Atom feed";
    return null;
  }

  $tag = html_entity_decode(trim($tagMatch[1]), ENT_QUOTES | ENT_XML1, "UTF-8");
  preg_match('/<title>(.*?)<\/title>/s', $entry, $titleMatch);
  preg_match('/<updated>(.*?)<\/updated>/s', $entry, $updatedMatch);
  preg_match('/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/', $entry, $linkMatch);
  preg_match('/<content[^>]*>(.*?)<\/content>/s', $entry, $contentMatch);
  $title = isset($titleMatch[1]) ? html_entity_decode(trim($titleMatch[1]), ENT_QUOTES | ENT_XML1, "UTF-8") : $tag;
  $content = isset($contentMatch[1]) ? html_entity_decode(trim($contentMatch[1]), ENT_QUOTES | ENT_XML1, "UTF-8") : "";
  $plainContent = trim(strip_tags($content));
  preg_match('/\bBuild:\s*(\d{8}-\d+)\b/i', $plainContent, $buildMatch);

  return [
    "tag_name" => $tag,
    "html_url" => isset($linkMatch[1]) ? html_entity_decode($linkMatch[1], ENT_QUOTES | ENT_XML1, "UTF-8") : "https://github.com/$githubRepo/releases/tag/" . rawurlencode($tag),
    "body" => $plainContent,
    "published_at" => $updatedMatch[1] ?? null,
    "prerelease" => stripos($title, "beta") !== false || stripos($title, "pre-release") !== false,
    "beast_build" => $buildMatch[1] ?? null,
  ];
}

// GitHub's /releases/latest quietly excludes anything marked "pre-release"
// -- exactly the behavior the stable channel wants, for free. The beta
// channel instead reads the plain /releases list (newest first) and takes
// the very first entry, pre-release or not, so a beta build is discovered
// the moment it's published without needing a second tagging scheme.
function fetchLatestReleaseForChannel($githubRepo, $channel, &$error = null) {
  if ($channel !== "beta") return fetchLatestRelease($githubRepo, $error);
  $body = httpGet("https://api.github.com/repos/$githubRepo/releases?per_page=5", $error);
  // GitHub's anonymous API quota is shared by every dashboard behind the
  // same public IP. The public Atom feed is not subject to that API quota,
  // so keep beta discovery working when GitHub responds with HTTP 403.
  if ($body === null) return fetchLatestReleaseFromAtom($githubRepo, $error);
  $data = json_decode($body, true);
  if (!is_array($data) || empty($data[0]["tag_name"])) { $error = "Unexpected GitHub API response"; return null; }
  return $data[0];
}

function fetchRemoteBuildId($githubRepo, $tag, &$error = null) {
  $safeTag = rawurlencode($tag);
  $body = httpGet("https://raw.githubusercontent.com/$githubRepo/$safeTag/beast.html", $error);
  if ($body === null) return null;
  if (preg_match('/<meta name="beast-build" content="([^"]+)"/', $body, $m)) return $m[1];
  $error = "beast-build meta tag not found in remote beast.html";
  return null;
}

function recursiveRemove($path) {
  if (!file_exists($path)) return;
  if (is_dir($path) && !is_link($path)) {
    foreach (scandir($path) as $item) {
      if ($item === "." || $item === "..") continue;
      recursiveRemove("$path/$item");
    }
    rmdir($path);
  } else {
    unlink($path);
  }
}

$current = currentBuildId($root);
$method = $_SERVER["REQUEST_METHOD"];

if ($method === "GET") {
  echo json_encode(["currentVersion" => $current]);
  exit;
}

if ($method !== "POST") { http_response_code(405); echo json_encode(["error" => "method_not_allowed"]); exit; }

$body = json_decode(file_get_contents("php://input"), true);
if (!is_array($body)) { http_response_code(400); echo json_encode(["error" => "invalid_json"]); exit; }
$action = $body["action"] ?? "";

if ($action === "check") {
  $containerManaged = getenv("SMARTDASH_CONTAINER") === "1";
  // "beta" opts into GitHub releases marked pre-release; anything else
  // (including a missing/unrecognized value) is "stable" -- the exact
  // behavior this endpoint already had before channels existed.
  $channel = ($body["channel"] ?? "stable") === "beta" ? "beta" : "stable";
  // GitHub's unauthenticated API allows only 60 requests/hour per source
  // IP -- shared by every kiosk and every open Administration tab on this
  // network. Each check used to hit GitHub directly (2 requests), and the
  // dashboard itself used to poll every 60 seconds, which alone exhausts
  // the entire hourly quota from a single always-on kiosk. Caching the
  // GitHub-derived result for a few minutes means any number of kiosks and
  // admin tabs polling this endpoint only cost GitHub a request every few
  // minutes, not per poll. currentVersion/updateAvailable are still
  // recomputed fresh every call against whatever is actually installed
  // right now -- only the GitHub half of the answer is cached. Cached
  // per channel so a kiosk that switches between them doesn't serve a
  // stable answer to a beta check or vice versa.
  $cacheFile = $dataDir . "/update-check-cache-$channel.json";
  $cacheTtlSeconds = 300;
  // Automatic/background checks reuse the short cache to protect GitHub's
  // unauthenticated rate limit. A user explicitly pressing the check button
  // must be able to discover a release published seconds ago, so that request
  // bypasses the cache and refreshes it with GitHub's current latest release.
  $forceRefresh = !empty($body["force"]);
  $skippedId = skippedBuildId($dataDir);
  $cached = null;
  if (!$forceRefresh && is_file($cacheFile)) {
    $raw = @file_get_contents($cacheFile);
    $decoded = $raw ? json_decode($raw, true) : null;
    if (is_array($decoded) && isset($decoded["fetchedAt"]) && (time() - $decoded["fetchedAt"]) < $cacheTtlSeconds) {
      $cached = $decoded;
    }
  }

  if ($cached !== null) {
    $tag = $cached["tag"];
    $remoteBuildId = $cached["remoteVersion"];
    echo json_encode([
      "currentVersion" => $current,
      "containerManaged" => $containerManaged,
      "channel" => $channel,
      "tag" => $tag,
      "remoteVersion" => $remoteBuildId,
      "updateAvailable" => compareBuildIds($remoteBuildId, $current) > 0,
      "releaseUrl" => $cached["releaseUrl"],
      "releaseNotes" => $cached["releaseNotes"],
      "publishedAt" => $cached["publishedAt"],
      "prerelease" => $cached["prerelease"] ?? false,
      "cached" => true,
      "skipAutoInstall" => $skippedId !== null && $skippedId === $remoteBuildId,
    ]);
    exit;
  }

  $error = null;
  $release = fetchLatestReleaseForChannel($githubRepo, $channel, $error);
  if ($release === null) {
    // GitHub is unreachable (rate-limited, offline, etc.) -- serve a stale
    // cache if one exists rather than failing outright; a slightly old
    // answer is far more useful than none.
    if (is_file($cacheFile)) {
      $raw = @file_get_contents($cacheFile);
      $stale = $raw ? json_decode($raw, true) : null;
      if (is_array($stale)) {
        echo json_encode([
          "currentVersion" => $current,
          "containerManaged" => $containerManaged,
          "channel" => $channel,
          "tag" => $stale["tag"],
          "remoteVersion" => $stale["remoteVersion"],
          "updateAvailable" => compareBuildIds($stale["remoteVersion"], $current) > 0,
          "releaseUrl" => $stale["releaseUrl"],
          "releaseNotes" => $stale["releaseNotes"],
          "publishedAt" => $stale["publishedAt"],
          "prerelease" => $stale["prerelease"] ?? false,
          "cached" => true,
          "stale" => true,
          "skipAutoInstall" => $skippedId !== null && $skippedId === $stale["remoteVersion"],
        ]);
        exit;
      }
    }
    http_response_code(502);
    echo json_encode(["error" => "github_unreachable", "message" => $error]);
    exit;
  }
  $tag = $release["tag_name"];
  $remoteBuildId = $release["beast_build"] ?? null;
  if (!isSafeVersion($remoteBuildId)) $remoteBuildId = fetchRemoteBuildId($githubRepo, $tag, $error);
  if ($remoteBuildId === null) { http_response_code(502); echo json_encode(["error" => "github_unreachable", "message" => $error]); exit; }

  $payload = [
    "tag" => $tag,
    "remoteVersion" => $remoteBuildId,
    "releaseUrl" => $release["html_url"] ?? null,
    "releaseNotes" => $release["body"] ?? "",
    "publishedAt" => $release["published_at"] ?? null,
    "prerelease" => $release["prerelease"] ?? false,
  ];
  @file_put_contents($cacheFile, json_encode(["fetchedAt" => time()] + $payload));

  echo json_encode([
    "currentVersion" => $current,
    "containerManaged" => $containerManaged,
    "channel" => $channel,
    "updateAvailable" => compareBuildIds($remoteBuildId, $current) > 0,
    "cached" => false,
    "skipAutoInstall" => $skippedId !== null && $skippedId === $remoteBuildId,
  ] + $payload);
  exit;
}

if ($action === "install") {
  // Container images are immutable release artifacts. Replacing files in a
  // running container would disappear on restart and bypass the platform's
  // rollback mechanism, so Docker, Unraid or Home Assistant must replace the
  // image while preserving /data instead.
  if (getenv("SMARTDASH_CONTAINER") === "1") {
    http_response_code(409);
    echo json_encode([
      "error" => "container_managed_update",
      "message" => "Update the HA Smartdash image through Docker, Unraid or Home Assistant. Persistent /data will be preserved."
    ]);
    exit;
  }
  set_time_limit(90);
  $error = null;

  $tag = $body["tag"] ?? null;
  if ($tag !== null && !isSafeTag($tag)) { http_response_code(400); echo json_encode(["error" => "invalid_tag"]); exit; }
  if ($tag === null) {
    $release = fetchLatestRelease($githubRepo, $error);
    if ($release === null) { http_response_code(502); echo json_encode(["error" => "github_unreachable", "message" => $error]); exit; }
    $tag = $release["tag_name"];
  }

  $zipPath = sys_get_temp_dir() . "/ha-smartdash-update-" . uniqid() . ".zip";
  $extractDir = sys_get_temp_dir() . "/ha-smartdash-extract-" . uniqid();
  $installedVersion = null;

  try {
    $downloadUrl = "https://github.com/$githubRepo/archive/refs/tags/" . rawurlencode($tag) . ".zip";
    if (!downloadToFile($downloadUrl, $zipPath, $error)) {
      http_response_code(502);
      echo json_encode(["error" => "download_failed", "message" => $error]);
      exit;
    }

    if (filesize($zipPath) < 1024) {
      http_response_code(502);
      echo json_encode(["error" => "download_too_small"]);
      exit;
    }

    $zip = new ZipArchive();
    if ($zip->open($zipPath) !== true) {
      http_response_code(502);
      echo json_encode(["error" => "invalid_archive"]);
      exit;
    }
    if (!$zip->extractTo($extractDir)) {
      $zip->close();
      http_response_code(500);
      echo json_encode(["error" => "extract_failed"]);
      exit;
    }
    $zip->close();

    // GitHub nests everything under a single "<repo>-<tag-without-v>/"
    // folder; find it rather than assuming the exact name.
    $entries = array_values(array_diff(scandir($extractDir), [".", ".."]));
    $extractedRoot = null;
    foreach ($entries as $entry) {
      if (is_dir("$extractDir/$entry")) { $extractedRoot = "$extractDir/$entry"; break; }
    }
    if (!$extractedRoot) {
      http_response_code(502);
      echo json_encode(["error" => "unexpected_archive_layout"]);
      exit;
    }

    foreach (["beast.html", "index.html", "admin/index.html", "js/ha-smartdash-core.js"] as $expected) {
      if (!file_exists("$extractedRoot/$expected")) {
        http_response_code(502);
        echo json_encode(["error" => "archive_missing_expected_files", "missing" => $expected]);
        exit;
      }
    }

    $newVersion = currentBuildId($extractedRoot);
    if (!isSafeVersion($newVersion)) {
      http_response_code(502);
      echo json_encode(["error" => "unreadable_new_version"]);
      exit;
    }

    // Safety net: snapshot what's live right now before overwriting it, so
    // if the copy below fails partway, or the new version turns out to be
    // broken, the existing local rollback (api/versions.php) can undo this.
    snapshotCurrent($root, $snapshotsDir, $snapshotPaths, $current);

    try {
      foreach (scandir($extractedRoot) as $item) {
        if ($item === "." || $item === ".." || in_array($item, $excludeTopLevel, true)) continue;
        copyRecursive("$extractedRoot/$item", "$root/$item");
      }
      $copiedVersion = currentBuildId($root);
      if ($copiedVersion !== $newVersion) {
        throw new RuntimeException("Installed build verification failed: expected $newVersion, found $copiedVersion");
      }
    } catch (Throwable $copyError) {
      // Best-effort rollback: restore the pre-install snapshot we just took.
      $rollbackSrc = "$snapshotsDir/$current";
      if (is_dir($rollbackSrc)) {
        foreach (scandir($rollbackSrc) as $item) {
          if ($item === "." || $item === "..") continue;
          copyRecursive("$rollbackSrc/$item", "$root/$item");
        }
      }
      http_response_code(500);
      echo json_encode(["error" => "install_failed_rolled_back", "message" => $copyError->getMessage()]);
      exit;
    }

    $installedVersion = currentBuildId($root);
    snapshotCurrent($root, $snapshotsDir, $snapshotPaths, $installedVersion);
    pruneSnapshots($snapshotsDir, 25, [$installedVersion]);
    recordSkippedIfDowngrade($dataDir, $current, $installedVersion);

    echo json_encode(["success" => true, "installedVersion" => $installedVersion, "tag" => $tag]);
  } finally {
    @unlink($zipPath);
    if (is_dir($extractDir)) recursiveRemove($extractDir);
  }
  exit;
}

if ($action === "clearSkip") {
  @unlink($dataDir . "/update-skip.json");
  echo json_encode(["success" => true]);
  exit;
}

http_response_code(400);
echo json_encode(["error" => "unknown_action"]);
