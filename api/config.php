<?php
// Central configuration persistence for HA Smartdash: the dashboard, its
// entity mappings and page visibility are stored centrally here instead of
// only in the browser's localStorage, so the setup follows the dashboard
// rather than the device it happened to be configured from. Same-origin
// only (no CORS needed) — this endpoint is called by hearth/beast.html
// itself, nothing else.
header("Content-Type: application/json; charset=utf-8");
header("Cache-Control: no-store");

$dataDir = __DIR__ . "/../data";
$configFile = $dataDir . "/config.json";

if (!is_dir($dataDir)) {
  mkdir($dataDir, 0775, true);
}

function readConfig($file) {
  if (!file_exists($file)) return new stdClass();
  $raw = file_get_contents($file);
  $decoded = json_decode($raw);
  return is_object($decoded) ? $decoded : new stdClass();
}

$method = $_SERVER["REQUEST_METHOD"];

if ($method === "GET") {
  echo json_encode(readConfig($configFile));
  exit;
}

if ($method === "POST") {
  $body = file_get_contents("php://input");
  if (strlen($body) > 2 * 1024 * 1024) {
    http_response_code(413);
    echo json_encode(["error" => "payload_too_large"]);
    exit;
  }
  $decoded = json_decode($body);
  if (json_last_error() !== JSON_ERROR_NONE || (!is_object($decoded) && !is_array($decoded))) {
    http_response_code(400);
    echo json_encode(["error" => "invalid_json"]);
    exit;
  }
  // Write to a temp file then rename — avoids a reader ever seeing a
  // half-written file if a save happens to land mid-read.
  $tmpFile = $configFile . ".tmp";
  $written = file_put_contents($tmpFile, json_encode($decoded, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX);
  if ($written === false || !rename($tmpFile, $configFile)) {
    http_response_code(500);
    echo json_encode(["error" => "write_failed"]);
    exit;
  }
  echo json_encode(["success" => true]);
  exit;
}

http_response_code(405);
echo json_encode(["error" => "method_not_allowed"]);
