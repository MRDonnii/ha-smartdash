<?php
// Config persistence for Hearth's Opsætning (Setup): the dashboard, its
// entity mappings and page visibility are stored centrally here instead of
// only in the browser's localStorage, so the setup follows the dashboard
// rather than the device it happened to be configured from. Same-origin
// only (no CORS needed) — this endpoint is called by hearth/beast.html
// itself, nothing else.
header("Content-Type: application/json; charset=utf-8");

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
  $decoded = json_decode($body);
  if (!is_object($decoded) && !is_array($decoded)) {
    http_response_code(400);
    echo json_encode(["error" => "invalid_json"]);
    exit;
  }
  // The dashboard commonly lives on a mounted appdata volume where rename
  // over an existing, longer file can leave trailing NUL bytes. Lock the
  // real file and truncate it explicitly before writing the new document.
  $json = json_encode($decoded, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  $handle = fopen($configFile, "c+");
  $written = false;
  if ($handle && flock($handle, LOCK_EX)) {
    ftruncate($handle, 0);
    rewind($handle);
    $written = fwrite($handle, $json);
    fflush($handle);
    flock($handle, LOCK_UN);
  }
  if ($handle) fclose($handle);
  if ($written === false || $written !== strlen($json)) {
    http_response_code(500);
    echo json_encode(["error" => "write_failed"]);
    exit;
  }
  echo json_encode(["success" => true]);
  exit;
}

http_response_code(405);
echo json_encode(["error" => "method_not_allowed"]);
