#!/bin/sh
set -eu

log() { printf '[HA Smartdash] %s\n' "$*"; }

export TZ="${TZ:-Europe/Copenhagen}"

# Where nginx proxies /ha/ to is decided in this order:
#   1. the app option home_assistant_url (Home Assistant app)  -> fixed
#   2. the HA_URL variable                                      -> fixed
#   3. /data/ha-upstream, written by the connect screen after it has found
#      Home Assistant on the network                            -> dynamic
# With none of them set the proxy has no upstream yet and the connect screen
# offers the Home Assistant installations it finds. The old template default
# is treated as "not set" when it doesn't resolve, so a fresh install that
# never edited it can still start.
LEGACY_DEFAULT_URL="http://homeassistant.local:8123"
UPSTREAM_FILE=/data/ha-upstream
NO_UPSTREAM_URL="http://127.0.0.1:9"
SMARTDASH_UPSTREAM_MODE=dynamic
upstream="${HA_URL:-}"

# Home Assistant Apps expose their options in /data/options.json and provide
# a short-lived Supervisor token. Standalone Docker/Unraid uses HA_URL.
if [ -f /data/options.json ]; then
  option_url=$(jq -r '.home_assistant_url // empty' /data/options.json 2>/dev/null || true)
  option_tz=$(jq -r '.timezone // empty' /data/options.json 2>/dev/null || true)
  [ -n "$option_url" ] && upstream="$option_url"
  [ -n "$option_tz" ] && export TZ="$option_tz"
fi

upstream=${upstream%/}
if [ "$upstream" = "$LEGACY_DEFAULT_URL" ] && command -v getent >/dev/null 2>&1 \
    && ! getent hosts homeassistant.local >/dev/null 2>&1; then
  upstream=""
fi

valid_upstream() {
  printf '%s' "$1" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'
}

if [ -n "$upstream" ]; then
  case "$upstream" in
    http://*|https://*) ;;
    *) log "HA_URL must begin with http:// or https://"; exit 1 ;;
  esac
  SMARTDASH_UPSTREAM_MODE=fixed
else
  saved=$(head -n 1 "$UPSTREAM_FILE" 2>/dev/null | tr -d '\r' || true)
  if valid_upstream "$saved"; then upstream="$saved"; else upstream="$NO_UPSTREAM_URL"; fi
fi
export SMARTDASH_UPSTREAM_MODE
export SMARTDASH_HA_UPSTREAM="$upstream"

render_nginx_conf() {
  SMARTDASH_HA_UPSTREAM="$1" envsubst '${SMARTDASH_HA_UPSTREAM}' \
    < /etc/nginx/http.d/default.conf.template \
    > /etc/nginx/http.d/default.conf
}

# Applies an address picked on the connect screen without restarting the
# container: rewrite the proxy config, test it, reload nginx. An address that
# fails the test is dropped and the previous config is put back.
watch_upstream_file() {
  running="$SMARTDASH_HA_UPSTREAM"
  seen=""
  while sleep 2; do
    wanted=$(head -n 1 "$UPSTREAM_FILE" 2>/dev/null | tr -d '\r' || true)
    [ -n "$wanted" ] && [ "$wanted" != "$seen" ] && [ "$wanted" != "$running" ] || continue
    seen="$wanted"
    if ! valid_upstream "$wanted"; then
      log "Ignoring invalid address in $UPSTREAM_FILE"
      continue
    fi
    render_nginx_conf "$wanted"
    if nginx -t >/dev/null 2>&1 && nginx -s reload >/dev/null 2>&1; then
      running="$wanted"
      log "Home Assistant upstream changed to $wanted"
    else
      render_nginx_conf "$running"
      log "Could not apply $wanted; keeping $running"
    fi
  done
}

mkdir -p /data /run/nginx /run/php
chown -R nginx:nginx /data /run/nginx /run/php
[ -f /data/.gitkeep ] || : > /data/.gitkeep

render_nginx_conf "$SMARTDASH_HA_UPSTREAM"

php-fpm83 -F &
php_pid=$!
trap 'kill "$php_pid" 2>/dev/null || true' EXIT HUP INT TERM

nginx -t
if [ "$SMARTDASH_UPSTREAM_MODE" = "dynamic" ]; then
  watch_upstream_file &
  if [ "$SMARTDASH_HA_UPSTREAM" = "$NO_UPSTREAM_URL" ]; then
    log "Starting on port 8099; no Home Assistant chosen yet, open the dashboard to pick one"
  else
    log "Starting on port 8099; Home Assistant upstream (chosen in the dashboard): $SMARTDASH_HA_UPSTREAM"
  fi
else
  log "Starting on port 8099; Home Assistant upstream: $SMARTDASH_HA_UPSTREAM"
fi
exec nginx -g 'daemon off;'
