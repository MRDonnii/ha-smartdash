<?php
// Finds Home Assistant instances on the local network so a login screen
// can offer them as a pick-list instead of requiring a manually typed
// address. Runs server-side (not in the browser) because the server, not
// the browser tab, is the thing actually sitting on the LAN -- this also
// works from a phone/tablet loading the dashboard over a completely
// different network path than the server itself.
//
// Two layers, cheapest first:
// 1. A short list of hostnames Home Assistant conventionally advertises
//    via mDNS ("homeassistant.local" and friends). Resolves instantly on
//    any host with mDNS name resolution configured -- true for most
//    bare-metal Linux servers (avahi + nss-mdns) and for whatever machine
//    the browser itself is running on, but NOT inside this project's own
//    Docker image (Alpine, no nss-mdns package) -- there this layer simply
//    finds nothing and falls through to the scan below.
// 2. A same-subnet scan on Home Assistant's default port (8123), derived
//    from the server's own local IP. Slower, and only reaches whatever
//    subnet the server itself has an interface on -- a Docker container on
//    a bridge network will scan the bridge's private subnet, not the LAN,
//    unless it runs with --network=host. Documented in docs/DOCKER.md
//    rather than silently pretending to work there.
//
// Every candidate is verified, not just guessed: Home Assistant's REST API
// answers an unauthenticated GET /api/ with HTTP 401 and the exact body
// "401: Unauthorized". That specific pairing is what actually gets treated
// as "this is Home Assistant", not just "something is listening on 8123".
header("Content-Type: application/json; charset=utf-8");

const HA_PORT = 8123;
const CONNECT_TIMEOUT_MS = 350;
const CANDIDATE_HOSTNAMES = ["homeassistant.local", "homeassistant", "hassio.local", "hassio"];

function looksLikeHomeAssistant(string $baseUrl): bool {
  $ch = curl_init("$baseUrl/api/");
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT_MS => CONNECT_TIMEOUT_MS,
    CURLOPT_TIMEOUT_MS => CONNECT_TIMEOUT_MS + 400,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
  ]);
  $body = curl_exec($ch);
  $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  return $status === 401 && trim((string)$body) === "401: Unauthorized";
}

function addCandidate(array &$found, array &$seen, string $host, string $label): void {
  $baseUrl = "http://$host:" . HA_PORT;
  if (isset($seen[$baseUrl])) return;
  $seen[$baseUrl] = true;
  if (looksLikeHomeAssistant($baseUrl)) $found[] = ["url" => $baseUrl, "label" => $label];
}

function localIPv4(): ?string {
  // $_SERVER["SERVER_ADDR"] is what PHP-FPM/nginx already know the request
  // arrived on and needs no optional extension, so it's the primary source.
  // The ext-sockets trick (ask the kernel which local interface a UDP
  // "connect" -- no packet actually sent -- would use to reach an arbitrary
  // address) is a fallback for the rare setup where SERVER_ADDR is missing
  // or a loopback/proxy address; ext-sockets isn't in this project's own
  // Docker image, hence the function_exists() guard.
  $fromServer = $_SERVER["SERVER_ADDR"] ?? null;
  if ($fromServer && $fromServer !== "127.0.0.1" && $fromServer !== "::1" && filter_var($fromServer, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
    return $fromServer;
  }
  if (!function_exists("socket_create")) return null;
  $sock = @socket_create(AF_INET, SOCK_DGRAM, SOL_UDP);
  if (!$sock) return null;
  if (!@socket_connect($sock, "192.0.2.1", 53)) { socket_close($sock); return null; }
  socket_getsockname($sock, $address);
  socket_close($sock);
  return $address ?: null;
}

$found = [];
$seen = [];

// Layer 1: conventional mDNS hostnames.
foreach (CANDIDATE_HOSTNAMES as $hostname) {
  $ip = gethostbyname($hostname);
  if ($ip === $hostname) continue; // gethostbyname() returns the input unchanged when resolution fails
  addCandidate($found, $seen, $hostname, $hostname);
}

// Layer 2: scan the server's own /24, skipping it entirely once layer 1
// already found something -- a same-subnet sweep is the slow, best-effort
// fallback for hosts without mDNS resolution, not something to run when a
// fast, specific answer already exists.
if (!$found) {
  $localIp = localIPv4();
  if ($localIp && preg_match('/^(\d+\.\d+\.\d+)\.\d+$/', $localIp, $m)) {
    $subnet = $m[1];
    $multi = curl_multi_init();
    $handles = [];
    for ($i = 1; $i <= 254; $i++) {
      $ip = "$subnet.$i";
      if ($ip === $localIp) continue;
      $ch = curl_init("http://$ip:" . HA_PORT . "/api/");
      curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT_MS => CONNECT_TIMEOUT_MS,
        CURLOPT_TIMEOUT_MS => CONNECT_TIMEOUT_MS + 250,
      ]);
      curl_multi_add_handle($multi, $ch);
      $handles[$ip] = $ch;
    }
    $running = null;
    do { curl_multi_exec($multi, $running); curl_multi_select($multi, 0.2); } while ($running > 0);
    foreach ($handles as $ip => $ch) {
      $body = curl_multi_getcontent($ch);
      $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
      if ($status === 401 && trim((string)$body) === "401: Unauthorized") {
        $baseUrl = "http://$ip:" . HA_PORT;
        if (!isset($seen[$baseUrl])) { $seen[$baseUrl] = true; $found[] = ["url" => $baseUrl, "label" => $ip]; }
      }
      curl_multi_remove_handle($multi, $ch);
      curl_close($ch);
    }
    curl_multi_close($multi);
  }
}

echo json_encode(["candidates" => $found]);
