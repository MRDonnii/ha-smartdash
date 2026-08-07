<?php
header("Content-Type: application/json; charset=utf-8");
header("Cache-Control: no-store");

$dataDir = __DIR__ . "/../data";
$settingsFile = $dataDir . "/backup-settings.json";
$localRoot = $dataDir . "/backups";
$mountRoot = "/config/backup-targets";
if (!is_dir($dataDir)) mkdir($dataDir, 0775, true);
if (!is_dir($localRoot)) mkdir($localRoot, 0775, true);

function backupSettings($file) {
  $defaults = ["enabled" => false, "frequency" => "daily", "target" => "local", "lastBackup" => null];
  if (!file_exists($file)) return $defaults;
  $value = json_decode(file_get_contents($file), true);
  return is_array($value) ? array_merge($defaults, $value) : $defaults;
}

function backupTargets($localRoot, $mountRoot) {
  $targets = [["id" => "local", "label" => "Lokal backupmappe", "path" => $localRoot]];
  if (is_dir($mountRoot)) {
    foreach (scandir($mountRoot) as $name) {
      if ($name === "." || $name === "..") continue;
      $path = $mountRoot . "/" . $name;
      if (is_dir($path) && is_writable($path)) $targets[] = ["id" => "mount:" . $name, "label" => "SMB / " . $name, "path" => $path];
    }
  }
  return $targets;
}

function resolveTarget($id, $targets) {
  foreach ($targets as $target) if ($target["id"] === $id) return $target;
  return $targets[0];
}

function backupFiles($targets) {
  $items = [];
  foreach ($targets as $target) {
    foreach (glob($target["path"] . "/ha-smartdash-profile-*.json") ?: [] as $file) {
      if (!is_file($file)) continue;
      $items[] = [
        "target" => $target["id"], "targetLabel" => $target["label"],
        "filename" => basename($file), "size" => filesize($file) ?: 0,
        "createdAt" => gmdate("c", filemtime($file) ?: time())
      ];
    }
  }
  usort($items, function ($a, $b) { return strcmp($b["createdAt"], $a["createdAt"]); });
  return array_slice($items, 0, 100);
}

function streamBackup($target, $filename) {
  if (!preg_match('/^ha-smartdash-profile-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}\.json$/', $filename)) return false;
  $base = realpath($target["path"]);
  $file = realpath($target["path"] . "/" . $filename);
  if (!$base || !$file || dirname($file) !== $base || !is_file($file) || !is_readable($file)) return false;
  header_remove("Content-Type");
  header("Content-Type: application/json; charset=utf-8");
  header("Content-Disposition: attachment; filename=\"" . basename($file) . "\"");
  header("Content-Length: " . filesize($file));
  readfile($file);
  return true;
}

$settings = backupSettings($settingsFile);
$targets = backupTargets($localRoot, $mountRoot);
if ($_SERVER["REQUEST_METHOD"] === "GET") {
  if (($_GET["action"] ?? "") === "download") {
    $target = resolveTarget((string)($_GET["target"] ?? "local"), $targets);
    if (streamBackup($target, basename((string)($_GET["file"] ?? "")))) exit;
    http_response_code(404); echo json_encode(["error" => "backup_not_found"]); exit;
  }
  echo json_encode(["settings" => $settings, "targets" => array_map(function ($item) { unset($item["path"]); return $item; }, $targets), "backups" => backupFiles($targets)]);
  exit;
}
if ($_SERVER["REQUEST_METHOD"] !== "POST") { http_response_code(405); echo json_encode(["error" => "method_not_allowed"]); exit; }

$body = json_decode(file_get_contents("php://input"), true);
if (!is_array($body)) { http_response_code(400); echo json_encode(["error" => "invalid_json"]); exit; }
$action = $body["action"] ?? "";
if ($action === "settings") {
  $validTarget = resolveTarget((string)($body["target"] ?? "local"), $targets);
  $settings["enabled"] = !empty($body["enabled"]);
  $settings["frequency"] = ($body["frequency"] ?? "daily") === "weekly" ? "weekly" : "daily";
  $settings["target"] = $validTarget["id"];
  $tmpSettings = $settingsFile . ".tmp";
  if (file_put_contents($tmpSettings, json_encode($settings, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX) === false || !rename($tmpSettings, $settingsFile)) {
    http_response_code(500); echo json_encode(["error" => "write_failed"]); exit;
  }
  echo json_encode(["success" => true, "settings" => $settings]);
  exit;
}
if ($action === "run" || $action === "maybe") {
  $now = time();
  $interval = $settings["frequency"] === "weekly" ? 604800 : 86400;
  $last = $settings["lastBackup"] ? strtotime($settings["lastBackup"]) : 0;
  if ($action === "maybe" && (!$settings["enabled"] || ($now - $last) < $interval)) { echo json_encode(["success" => true, "created" => false]); exit; }
  $target = resolveTarget($settings["target"], $targets);
  $configFile = $dataDir . "/config.json";
  $config = file_exists($configFile) ? json_decode(file_get_contents($configFile), true) : [];
  $payload = ["type" => "ha-smartdash-profile", "schemaVersion" => 3, "exportedAt" => gmdate("c"), "data" => $config];
  $filename = "ha-smartdash-profile-" . date("Y-m-d-His") . ".json";
  $written = file_put_contents($target["path"] . "/" . $filename, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX);
  if ($written === false) { http_response_code(500); echo json_encode(["error" => "write_failed"]); exit; }
  $settings["lastBackup"] = gmdate("c");
  if (file_put_contents($settingsFile, json_encode($settings, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX) === false) {
    http_response_code(500); echo json_encode(["error" => "settings_write_failed"]); exit;
  }
  echo json_encode(["success" => true, "created" => true, "filename" => $filename, "target" => $target["label"], "lastBackup" => $settings["lastBackup"]]);
  exit;
}
http_response_code(400); echo json_encode(["error" => "unknown_action"]);
