#!/bin/sh
set -eu

log() { printf '[HA Smartdash] %s\n' "$*"; }

export TZ="${TZ:-Europe/Copenhagen}"
export SMARTDASH_HA_UPSTREAM="${HA_URL:-http://homeassistant.local:8123}"

# Home Assistant Apps expose their options in /data/options.json and provide
# a short-lived Supervisor token. Standalone Docker/Unraid uses HA_URL.
if [ -f /data/options.json ]; then
  option_url=$(jq -r '.home_assistant_url // empty' /data/options.json 2>/dev/null || true)
  option_tz=$(jq -r '.timezone // empty' /data/options.json 2>/dev/null || true)
  [ -n "$option_url" ] && export SMARTDASH_HA_UPSTREAM="$option_url"
  [ -n "$option_tz" ] && export TZ="$option_tz"
fi

SMARTDASH_HA_UPSTREAM=${SMARTDASH_HA_UPSTREAM%/}
case "$SMARTDASH_HA_UPSTREAM" in
  http://*|https://*) ;;
  *) log "HA_URL must begin with http:// or https://"; exit 1 ;;
esac

mkdir -p /data /run/nginx /run/php
chown -R nginx:nginx /data /run/nginx /run/php
[ -f /data/.gitkeep ] || : > /data/.gitkeep

envsubst '${SMARTDASH_HA_UPSTREAM}' \
  < /etc/nginx/http.d/default.conf.template \
  > /etc/nginx/http.d/default.conf

php-fpm83 -F &
php_pid=$!
trap 'kill "$php_pid" 2>/dev/null || true' EXIT HUP INT TERM

nginx -t
log "Starting on port 8099; Home Assistant upstream: $SMARTDASH_HA_UPSTREAM"
exec nginx -g 'daemon off;'
