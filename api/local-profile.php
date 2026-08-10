<?php
// Supported installation-local presentation hook. The updater never copies
// over data/, so these optional files survive every application release.
$type = ($_GET["type"] ?? "") === "css" ? "css" : "js";
$file = __DIR__ . "/../data/local-profile." . $type;
header("Content-Type: " . ($type === "css" ? "text/css" : "application/javascript") . "; charset=utf-8");
header("Cache-Control: no-cache, must-revalidate");
header("X-Content-Type-Options: nosniff");
if (is_file($file)) readfile($file);
// Missing is intentionally a successful empty response: using the hook is
// optional and a clean install should not produce console errors.
