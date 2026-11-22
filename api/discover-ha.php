<?php
// Finds Home Assistant installations on the local network so the first-run
// connect screen can offer them as a pick-list instead of asking for an IP
// address. Runs server-side because the server, not the browser tab, is the
// thing sitting on the LAN.
//
// Layers, cheapest and most informative first:
// 1. mDNS/zeroconf: Home Assistant advertises "_home-assistant._tcp.local"
//    with its location name, version and UUID. A single multicast query
//    (answered by unicast, so no port-5353 listener or ext-sockets needed)
//    gives a named, versioned list. Needs a network where multicast reaches
//    the server -- bare metal, VMs and `--network=host` -- and silently finds
//    nothing on a Docker bridge.
// 2. A scan of port 8123 on the /24 networks the request itself reveals (the
//    address the dashboard was opened on, the client's address, the server's
//    own address). A bridged container cannot see the LAN's interfaces but
//    can still open outgoing TCP connections to it, so this is what makes
//    discovery work in a normal Docker/Unraid install too.
// 3. Only if both found nothing: the conventional hostnames
//    ("homeassistant", "homeassistant.local"). Last because a failing
//    ".local" lookup can block for seconds.
//
// Every candidate is verified, never just guessed: Home Assistant answers an
// unauthenticated GET /api/ with HTTP 401 and the exact body
// "401: Unauthorized".
//
// GET  -> {candidates, current, mode, canSwitch, scanned, cached, ...}
// POST -> {action:"use", url} re-points the Docker proxy at a verified Home
//         Assistant, but only while the proxy has no working upstream and the
//         container wasn't pinned with HA_URL / add-on options (see
//         docker/entrypoint.sh for the watcher that applies it).
header("Content-Type: application/json; charset=utf-8");
header("Cache-Control: no-store");

const HA_PORT = 8123;
const CONNECT_TIMEOUT_MS = 400;
const MAX_SUBNETS = 3;
const SCAN_CHUNK = 256;
const MDNS_WINDOW_MS = 1300;
const CACHE_SECONDS = 30;
const CANDIDATE_HOSTNAMES = ["homeassistant", "homeassistant.local"];

$dataDir = __DIR__ . "/../data";
$upstreamFile = $dataDir . "/ha-upstream";

function respond(array $payload, int $status = 200): void {
  http_response_code($status);
  echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  exit;
}

function ipToLong(string $ip): ?int {
  if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) return null;
  return ip2long($ip) ?: null;
}

// Only RFC 1918 ranges are ever probed or accepted: this endpoint must never
// become a way to poke at arbitrary or public addresses.
function isPrivateIPv4(string $ip): bool {
  $long = ipToLong($ip);
  if ($long === null) return false;
  return ($long >> 24) === 10
    || ($long >> 20) === (172 << 4 | 1)
    || ($long >> 16) === (192 << 8 | 168);
}

function isHaResponse(?int $status, $body): bool {
  return $status === 401 && trim((string)$body) === "401: Unauthorized";
}

function looksLikeHomeAssistant(string $baseUrl): bool {
  $ch = curl_init(rtrim($baseUrl, "/") . "/api/");
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT_MS => CONNECT_TIMEOUT_MS,
    CURLOPT_TIMEOUT_MS => CONNECT_TIMEOUT_MS + 600,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
  ]);
  $body = curl_exec($ch);
  $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  return isHaResponse($status, $body);
}

function hostOfUrl(string $url): string {
  return strtolower((string)parse_url($url, PHP_URL_HOST));
}

function resolveHost(string $host): ?string {
  if (ipToLong($host) !== null) return $host;
  $ip = gethostbyname($host);
  return $ip !== $host && ipToLong($ip) !== null ? $ip : null;
}

// --- Current proxy upstream ------------------------------------------------

// docker/entrypoint.sh exports SMARTDASH_UPSTREAM_MODE:
//   fixed   -> pinned by the add-on option or the HA_URL variable
//   dynamic -> nothing pinned; the address lives in /data/ha-upstream and can
//              be chosen from the connect screen
// Outside the container (setup-smartdash.sh, hand-written nginx) the variable
// is absent and the upstream is whatever the nginx config says: "unknown".
function upstreamState(string $upstreamFile): array {
  $mode = getenv("SMARTDASH_UPSTREAM_MODE") ?: "unknown";
  $url = null;
  if ($mode === "fixed") {
    $url = getenv("SMARTDASH_HA_UPSTREAM") ?: null;
  } elseif ($mode === "dynamic" && is_file($upstreamFile)) {
    $saved = trim((string)@file_get_contents($upstreamFile));
    $url = $saved !== "" ? $saved : null;
  }
  $reachable = $url !== null && looksLikeHomeAssistant($url);
  return [
    "mode" => $mode,
    "url" => $url,
    "configured" => $url !== null,
    "reachable" => $reachable,
    // Switching is a first-run / repair action, never a way to quietly
    // redirect a working proxy.
    "canSwitch" => $mode === "dynamic" && !$reachable,
  ];
}

// --- Subnets to scan -------------------------------------------------------

function localIPv4(): ?string {
  $fromServer = $_SERVER["SERVER_ADDR"] ?? null;
  if ($fromServer && ipToLong($fromServer) !== null && !str_starts_with($fromServer, "127.")) return $fromServer;
  if (!function_exists("socket_create")) return null;
  $sock = @socket_create(AF_INET, SOCK_DGRAM, SOL_UDP);
  if (!$sock) return null;
  if (!@socket_connect($sock, "192.0.2.1", 53)) { socket_close($sock); return null; }
  socket_getsockname($sock, $address);
  socket_close($sock);
  return $address ?: null;
}

function requestSubnets(): array {
  $addresses = [];
  $host = (string)($_SERVER["HTTP_HOST"] ?? "");
  $hostOnly = preg_replace('/:\d+$/', "", $host);
  if ($hostOnly !== "" && ipToLong($hostOnly) !== null) $addresses[] = $hostOnly;
  if (!empty($_SERVER["REMOTE_ADDR"])) $addresses[] = $_SERVER["REMOTE_ADDR"];
  $forwarded = trim(explode(",", (string)($_SERVER["HTTP_X_FORWARDED_FOR"] ?? ""))[0]);
  if ($forwarded !== "") $addresses[] = $forwarded;
  $local = localIPv4();
  if ($local) $addresses[] = $local;

  $subnets = [];
  foreach ($addresses as $address) {
    if (!isPrivateIPv4($address)) continue;
    if (!preg_match('/^(\d+\.\d+\.\d+)\.\d+$/', $address, $m)) continue;
    if (!in_array($m[1], $subnets, true)) $subnets[] = $m[1];
    if (count($subnets) >= MAX_SUBNETS) break;
  }
  return $subnets;
}

function scanSubnets(array $subnets, array $skipIps): array {
  $found = [];
  $targets = [];
  foreach ($subnets as $subnet) {
    for ($i = 1; $i <= 254; $i++) {
      $ip = "$subnet.$i";
      if (!in_array($ip, $skipIps, true)) $targets[] = $ip;
    }
  }
  foreach (array_chunk($targets, SCAN_CHUNK) as $chunk) {
    $multi = curl_multi_init();
    $handles = [];
    foreach ($chunk as $ip) {
      $ch = curl_init("http://$ip:" . HA_PORT . "/api/");
      curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT_MS => CONNECT_TIMEOUT_MS,
        CURLOPT_TIMEOUT_MS => CONNECT_TIMEOUT_MS + 300,
        CURLOPT_FOLLOWLOCATION => false,
      ]);
      curl_multi_add_handle($multi, $ch);
      $handles[$ip] = $ch;
    }
    $running = null;
    do {
      curl_multi_exec($multi, $running);
      if ($running > 0) curl_multi_select($multi, 0.2);
    } while ($running > 0);
    foreach ($handles as $ip => $ch) {
      if (isHaResponse((int)curl_getinfo($ch, CURLINFO_HTTP_CODE), curl_multi_getcontent($ch))) $found[] = $ip;
      curl_multi_remove_handle($multi, $ch);
      curl_close($ch);
    }
    curl_multi_close($multi);
  }
  return $found;
}

// --- mDNS ------------------------------------------------------------------

function dnsReadName(string $msg, int &$offset, int $depth = 0): string {
  $labels = [];
  $length = strlen($msg);
  $jumped = false;
  $position = $offset;
  while ($position < $length && $depth < 16) {
    $size = ord($msg[$position]);
    if ($size === 0) { $position++; break; }
    if (($size & 0xC0) === 0xC0) {
      if ($position + 1 >= $length) break;
      $pointer = (($size & 0x3F) << 8) | ord($msg[$position + 1]);
      if (!$jumped) $offset = $position + 2;
      $jumped = true;
      $position = $pointer;
      $depth++;
      continue;
    }
    $labels[] = substr($msg, $position + 1, $size);
    $position += 1 + $size;
  }
  if (!$jumped) $offset = $position;
  return implode(".", $labels);
}

function dnsParseResponse(string $msg, array &$ptr, array &$srv, array &$txt, array &$addr): void {
  if (strlen($msg) < 12) return;
  $header = unpack("nid/nflags/nqd/nan/nns/nar", $msg);
  $offset = 12;
  for ($i = 0; $i < $header["qd"]; $i++) { dnsReadName($msg, $offset); $offset += 4; }
  $records = $header["an"] + $header["ns"] + $header["ar"];
  for ($i = 0; $i < $records && $offset < strlen($msg); $i++) {
    $name = strtolower(dnsReadName($msg, $offset));
    if ($offset + 10 > strlen($msg)) return;
    $meta = unpack("ntype/nclass/Nttl/nlen", substr($msg, $offset, 10));
    $offset += 10;
    $start = $offset;
    $end = $offset + $meta["len"];
    if ($end > strlen($msg)) return;
    switch ($meta["type"]) {
      case 12: // PTR
        $target = dnsReadName($msg, $offset);
        if ($name === "_home-assistant._tcp.local") $ptr[strtolower($target)] = true;
        break;
      case 33: // SRV
        $srvData = unpack("npriority/nweight/nport", substr($msg, $start, 6));
        $offset = $start + 6;
        $srv[$name] = ["port" => $srvData["port"], "target" => strtolower(dnsReadName($msg, $offset))];
        break;
      case 16: // TXT
        $props = [];
        $cursor = $start;
        while ($cursor < $end) {
          $size = ord($msg[$cursor]);
          $entry = substr($msg, $cursor + 1, $size);
          $cursor += 1 + $size;
          $eq = strpos($entry, "=");
          if ($eq !== false) $props[strtolower(substr($entry, 0, $eq))] = substr($entry, $eq + 1);
        }
        $txt[$name] = $props;
        break;
      case 1: // A
        if ($meta["len"] === 4) $addr[$name] = inet_ntop(substr($msg, $start, 4));
        break;
    }
    $offset = $end;
  }
}

function mdnsDiscover(int $windowMs): array {
  $socket = @stream_socket_server("udp://0.0.0.0:0", $errno, $errstr, STREAM_SERVER_BIND);
  if (!$socket) return [];
  stream_set_blocking($socket, false);

  $question = "";
  foreach (["_home-assistant", "_tcp", "local"] as $label) $question .= chr(strlen($label)) . $label;
  // QTYPE PTR, QCLASS IN with the unicast-response bit so replies come back
  // to our ephemeral port instead of the multicast group.
  $packet = pack("nnnnnn", 0, 0, 1, 0, 0, 0) . $question . "\0" . pack("nn", 12, 0x8001);

  $ptr = []; $srv = []; $txt = []; $addr = []; $peers = [];
  $deadline = microtime(true) + $windowMs / 1000;
  $nextSend = 0.0;
  $sends = 0;
  $lastReply = 0.0;
  while (microtime(true) < $deadline) {
    // Replies usually arrive within a few ms; once everything has been asked
    // twice and the answers have gone quiet there is no reason to wait out the
    // full window.
    if ($sends >= 2 && $lastReply > 0 && microtime(true) - $lastReply > 0.35) break;
    if ($sends < 2 && microtime(true) >= $nextSend) {
      @stream_socket_sendto($socket, $packet, 0, "224.0.0.251:5353");
      $sends++;
      $nextSend = microtime(true) + 0.45;
    }
    $read = [$socket]; $write = null; $except = null;
    if (@stream_select($read, $write, $except, 0, 120000) > 0) {
      while (($data = @stream_socket_recvfrom($socket, 9000, 0, $peer)) !== false && $data !== "") {
        dnsParseResponse($data, $ptr, $srv, $txt, $addr);
        $lastReply = microtime(true);
        $peers[strtolower(explode(":", (string)$peer)[0])] = true;
      }
    }
  }
  fclose($socket);

  $found = [];
  foreach (array_keys($ptr) as $instance) {
    $service = $srv[$instance] ?? null;
    $props = $txt[$instance] ?? [];
    $ip = $service ? ($addr[$service["target"]] ?? null) : null;
    if ($ip === null && count($peers) === 1) $ip = array_key_first($peers);
    if ($ip === null || !isPrivateIPv4($ip)) continue;
    $port = $service["port"] ?? HA_PORT;
    $scheme = str_starts_with((string)($props["internal_url"] ?? ""), "https://") ? "https" : "http";
    $name = $props["location_name"] ?? null;
    if ($name === null) {
      $label = explode("._home-assistant._tcp.local", $instance)[0];
      $name = $label !== "" ? $label : null;
    }
    $found[$ip] = [
      "url" => "$scheme://$ip:$port",
      "host" => $ip,
      "name" => $name,
      "version" => $props["version"] ?? null,
      "uuid" => $props["uuid"] ?? null,
      "source" => "mdns",
    ];
  }
  return $found;
}

// --- POST: use a discovered Home Assistant as the proxy upstream -----------

function handleUse(string $upstreamFile, string $dataDir): void {
  $origin = (string)($_SERVER["HTTP_ORIGIN"] ?? "");
  if ($origin !== "" && strcasecmp(parse_url($origin, PHP_URL_HOST) . (parse_url($origin, PHP_URL_PORT) ? ":" . parse_url($origin, PHP_URL_PORT) : ""), (string)($_SERVER["HTTP_HOST"] ?? "")) !== 0) {
    respond(["error" => "cross_origin"], 403);
  }
  if (($_SERVER["HTTP_X_SMARTDASH_SETUP"] ?? "") !== "1") respond(["error" => "missing_header"], 400);

  $body = json_decode((string)file_get_contents("php://input"), true);
  $url = is_array($body) ? trim((string)($body["url"] ?? "")) : "";
  $parts = parse_url($url);
  $host = $parts["host"] ?? "";
  $scheme = $parts["scheme"] ?? "";
  if (!in_array($scheme, ["http", "https"], true) || !isPrivateIPv4($host) || isset($parts["path"]) && $parts["path"] !== "" && $parts["path"] !== "/" || isset($parts["query"])) {
    respond(["error" => "invalid_url"], 400);
  }
  $port = (int)($parts["port"] ?? ($scheme === "https" ? 443 : 80));
  if ($port < 1 || $port > 65535) respond(["error" => "invalid_url"], 400);
  $normalized = "$scheme://$host:$port";

  $state = upstreamState($upstreamFile);
  if (!$state["canSwitch"]) respond(["error" => "switch_not_allowed", "mode" => $state["mode"], "reachable" => $state["reachable"]], 409);
  if (!looksLikeHomeAssistant($normalized)) respond(["error" => "not_home_assistant"], 422);

  if (!is_dir($dataDir) && !@mkdir($dataDir, 0775, true)) respond(["error" => "write_failed"], 500);
  $tmp = $upstreamFile . ".tmp";
  if (@file_put_contents($tmp, $normalized . "\n", LOCK_EX) === false || !@rename($tmp, $upstreamFile)) {
    @unlink($tmp);
    respond(["error" => "write_failed"], 500);
  }
  respond(["ok" => true, "url" => $normalized]);
}

if (($_SERVER["REQUEST_METHOD"] ?? "GET") === "POST") handleUse($upstreamFile, $dataDir);

// --- GET: discovery ---------------------------------------------------------

$started = microtime(true);
$state = upstreamState($upstreamFile);
$subnets = requestSubnets();
$cacheKey = sha1(implode(",", $subnets));
$cacheFile = sys_get_temp_dir() . "/smartdash-discover-$cacheKey.json";
$cached = false;
$candidates = null;

if (empty($_GET["refresh"]) && is_file($cacheFile) && time() - (int)filemtime($cacheFile) < CACHE_SECONDS) {
  $decoded = json_decode((string)@file_get_contents($cacheFile), true);
  if (is_array($decoded)) { $candidates = $decoded; $cached = true; }
}

if ($candidates === null) {
  $byIp = [];

  foreach (mdnsDiscover(MDNS_WINDOW_MS) as $ip => $candidate) {
    if (looksLikeHomeAssistant($candidate["url"])) $byIp[$ip] = $candidate;
  }

  $local = localIPv4();
  $skip = array_merge(array_keys($byIp), $local ? [$local] : []);
  foreach (scanSubnets($subnets, $skip) as $ip) {
    $byIp[$ip] = ["url" => "http://$ip:" . HA_PORT, "host" => $ip, "name" => null, "version" => null, "uuid" => null, "source" => "scan"];
  }

  if (!$byIp) {
    foreach (CANDIDATE_HOSTNAMES as $hostname) {
      $ip = resolveHost($hostname);
      if ($ip === null || isset($byIp[$ip]) || !isPrivateIPv4($ip)) continue;
      if (looksLikeHomeAssistant("http://$ip:" . HA_PORT)) {
        $byIp[$ip] = ["url" => "http://$ip:" . HA_PORT, "host" => $ip, "name" => null, "version" => null, "uuid" => null, "source" => "hostname"];
      }
    }
  }

  $candidates = array_values($byIp);
  @file_put_contents($cacheFile, json_encode($candidates), LOCK_EX);
}

// The configured upstream is marked rather than cached, since it can change
// between two calls. A working upstream that the scan didn't see (a hostname
// such as "homeassistant" or an address outside the scanned subnets) is added
// so the connect screen can still offer it.
$currentIp = $state["url"] ? resolveHost(hostOfUrl($state["url"])) : null;
$seenCurrent = false;
foreach ($candidates as &$candidate) {
  $candidate["current"] = $currentIp !== null && $candidate["host"] === $currentIp;
  $seenCurrent = $seenCurrent || $candidate["current"];
  $candidate["label"] = $candidate["name"] ?: $candidate["host"];
}
unset($candidate);
if ($state["reachable"] && !$seenCurrent) {
  $currentHost = hostOfUrl($state["url"]);
  $candidates[] = [
    "url" => $state["url"],
    "host" => $currentHost,
    "name" => null,
    "version" => null,
    "uuid" => null,
    "source" => "configured",
    "current" => true,
    "label" => $currentHost,
    // A bare hostname ("homeassistant") only resolves inside the container
    // or add-on network, so a browser cannot be sent there.
    "internal" => ipToLong($currentHost) === null && !str_contains($currentHost, "."),
  ];
}

usort($candidates, function ($a, $b) {
  return [$b["current"] ? 1 : 0, $b["name"] ? 1 : 0, $a["host"]] <=> [$a["current"] ? 1 : 0, $a["name"] ? 1 : 0, $b["host"]];
});

respond([
  "candidates" => $candidates,
  "current" => ["url" => $state["url"], "reachable" => $state["reachable"], "configured" => $state["configured"]],
  "mode" => $state["mode"],
  "canSwitch" => $state["canSwitch"],
  "scanned" => array_map(fn($s) => "$s.0/24", $subnets),
  "cached" => $cached,
  "elapsedMs" => (int)round((microtime(true) - $started) * 1000),
]);
