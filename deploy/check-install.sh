#!/bin/sh
set -eu

BASE_URL=${1:-}
if [ -z "$BASE_URL" ]; then
  echo "Usage: $0 http://SMARTDASH_ADDRESS" >&2
  exit 2
fi

BASE_URL=${BASE_URL%/}
CHECK_URL="$BASE_URL/ha/auth/providers"
BODY_FILE=$(mktemp)
trap 'rm -f "$BODY_FILE"' EXIT HUP INT TERM

STATUS=$(curl -sS --max-time 10 -o "$BODY_FILE" -w '%{http_code}' -H 'Accept: application/json' "$CHECK_URL") || {
  echo "FAILED: Could not connect to $CHECK_URL" >&2
  exit 1
}

case "$STATUS" in
  200)
    if grep -q '"providers"' "$BODY_FILE"; then
      echo "OK: Smartdash /ha/ proxy reaches Home Assistant."
      exit 0
    fi
    echo "FAILED: $CHECK_URL returned HTTP 200, but not Home Assistant JSON. The static location / is probably handling /ha/." >&2
    ;;
  400)
    echo "FAILED: Home Assistant rejected the Nginx proxy with HTTP 400." >&2
    echo "Add the immediate Nginx proxy IP/network to http.trusted_proxies, enable use_x_forwarded_for, and restart Home Assistant." >&2
    ;;
  404|405)
    echo "FAILED: $CHECK_URL returned HTTP $STATUS. The active Nginx server block is missing location /ha/." >&2
    ;;
  502|503|504)
    echo "FAILED: $CHECK_URL returned HTTP $STATUS. Check HOME_ASSISTANT_HOST, port 8123 and network access from Nginx." >&2
    ;;
  *)
    echo "FAILED: $CHECK_URL returned unexpected HTTP $STATUS." >&2
    ;;
esac

exit 1
