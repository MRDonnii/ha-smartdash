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

// Everything that ships the app, copied wholesale from the downloaded
// release -- an allowlist would need editing every time a release adds a
// file. data/ (config, backups, snapshots) is the only thing that must
// never be touched; the rest is repository housekeeping that has no
// business on a live deployment.
$excludeTopLevel = [
  "data", ".git", ".github", ".gitignore", ".gitattributes", ".DS_Store",
  "README.md", "README.da.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md",
  "THIRD_PARTY_NOTICES.md", "demo", "deploy", "docs", "scripts"
];

function currentBuildId($root) {
  $html = @file_get_contents($root . "/beast.html");
  if ($html && preg_match('/<meta name="beast-build" content="([^"]+)"/', $html, $m)) return $m[1];
  return "legacy";
}

function isSafeVersion($version) {
  return is_string($version) && preg_match('/^[A-Za-z0-9._-]{1,64}$/', $version);
}

function isSafeTag($tag) {
  return is_string($tag) && preg_match('/^v?[0-9]+\.[0-9]+\.[0-9]+$/', $tag);
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

function snapshotCurrent($root, $snapshotsDir, $excludeTopLevel, $version) {
  if (!isSafeVersion($version)) return false;
  $dest = $snapshotsDir . "/" . $version;
  if (is_dir($dest)) return true;
  $tmp = $dest . ".tmp-" . uniqid();
  foreach (scandir($root) as $item) {
    if ($item === "." || $item === ".." || in_array($item, $excludeTopLevel, true)) continue;
    copyRecursive("$root/$item", "$tmp/$item");
  }
  if (!is_dir($tmp)) return false;
  rename($tmp, $dest);
  return true;
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
  // GitHub's unauthenticated API allows only 60 requests/hour per source
  // IP -- shared by every kiosk and every open Administration tab on this
  // network. Each check used to hit GitHub directly (2 requests), and the
  // dashboard itself used to poll every 60 seconds, which alone exhausts
  // the entire hourly quota from a single always-on kiosk. Caching the
  // GitHub-derived result for a few minutes means any number of kiosks and
  // admin tabs polling this endpoint only cost GitHub a request every few
  // minutes, not per poll. currentVersion/updateAvailable are still
  // recomputed fresh every call against whatever is actually installed
  // right now -- only the GitHub half of the answer is cached.
  $cacheFile = $dataDir . "/update-check-cache.json";
  $cacheTtlSeconds = 300;
  $cached = null;
  if (is_file($cacheFile)) {
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
      "tag" => $tag,
      "remoteVersion" => $remoteBuildId,
      "updateAvailable" => $remoteBuildId > $current,
      "releaseUrl" => $cached["releaseUrl"],
      "releaseNotes" => $cached["releaseNotes"],
      "publishedAt" => $cached["publishedAt"],
      "cached" => true,
    ]);
    exit;
  }

  $error = null;
  $release = fetchLatestRelease($githubRepo, $error);
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
          "tag" => $stale["tag"],
          "remoteVersion" => $stale["remoteVersion"],
          "updateAvailable" => $stale["remoteVersion"] > $current,
          "releaseUrl" => $stale["releaseUrl"],
          "releaseNotes" => $stale["releaseNotes"],
          "publishedAt" => $stale["publishedAt"],
          "cached" => true,
          "stale" => true,
        ]);
        exit;
      }
    }
    http_response_code(502);
    echo json_encode(["error" => "github_unreachable", "message" => $error]);
    exit;
  }
  $tag = $release["tag_name"];
  $remoteBuildId = fetchRemoteBuildId($githubRepo, $tag, $error);
  if ($remoteBuildId === null) { http_response_code(502); echo json_encode(["error" => "github_unreachable", "message" => $error]); exit; }

  $payload = [
    "tag" => $tag,
    "remoteVersion" => $remoteBuildId,
    "releaseUrl" => $release["html_url"] ?? null,
    "releaseNotes" => $release["body"] ?? "",
    "publishedAt" => $release["published_at"] ?? null,
  ];
  @file_put_contents($cacheFile, json_encode(["fetchedAt" => time()] + $payload));

  echo json_encode([
    "currentVersion" => $current,
    "updateAvailable" => $remoteBuildId > $current,
    "cached" => false,
  ] + $payload);
  exit;
}

if ($action === "install") {
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
    snapshotCurrent($root, $snapshotsDir, $excludeTopLevel, $current);

    try {
      foreach (scandir($extractedRoot) as $item) {
        if ($item === "." || $item === ".." || in_array($item, $excludeTopLevel, true)) continue;
        copyRecursive("$extractedRoot/$item", "$root/$item");
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
    snapshotCurrent($root, $snapshotsDir, $excludeTopLevel, $installedVersion);

    echo json_encode(["success" => true, "installedVersion" => $installedVersion, "tag" => $tag]);
  } finally {
    @unlink($zipPath);
    if (is_dir($extractDir)) recursiveRemove($extractDir);
  }
  exit;
}

http_response_code(400);
echo json_encode(["error" => "unknown_action"]);
