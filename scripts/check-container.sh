#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

required_files="
Dockerfile
docker/entrypoint.sh
docker/nginx.conf.template
docker/php-fpm.conf
docker-compose.yml
unraid/ha-smartdash.xml
repository.yaml
home-assistant-addon/config.yaml
"

for file in $required_files; do
  [ -s "$file" ] || { echo "Missing required container file: $file" >&2; exit 1; }
done

sh -n docker/entrypoint.sh

if command -v ruby >/dev/null 2>&1; then
  ruby -e 'require "yaml"; ARGV.each { |path| YAML.safe_load(File.read(path), aliases: true) or abort("Empty YAML: #{path}") }' \
    docker-compose.yml repository.yaml home-assistant-addon/config.yaml \
    home-assistant-addon/translations/en.yaml home-assistant-addon/translations/da.yaml
fi

if command -v xmllint >/dev/null 2>&1; then
  xmllint --noout unraid/ha-smartdash.xml
fi

addon_version=$(sed -n 's/^version: "\([^"]*\)"/\1/p' home-assistant-addon/config.yaml)
release_tag=$(sed -n 's/.*name="beast-release-tag" content="v\([^"]*\)".*/\1/p' beast.html)
[ "$addon_version" = "$release_tag" ] || {
  echo "Home Assistant App version ($addon_version) must match beast release ($release_tag)" >&2
  exit 1
}

grep -q 'Target="/data"' unraid/ha-smartdash.xml
grep -q '/data' docker-compose.yml
grep -Fq 'webui: http://[HOST]:[PORT:8099]/' home-assistant-addon/config.yaml
grep -Fq 'watchdog: http://[HOST]:[PORT:8099]/healthz' home-assistant-addon/config.yaml
if grep -q '^ingress: true' home-assistant-addon/config.yaml; then
  echo "Home Assistant App must use its direct Web UI to keep OAuth callbacks stable" >&2
  exit 1
fi
grep -q '\${SMARTDASH_PORT:-8099}:8099' docker-compose.yml

# Keep application URLs portable across direct installs and reverse proxies.
# HA API paths passed to haFetch are intentionally exempt because BeastAuth
# prefixes those with /ha.
if grep -RIE --include='*.html' --include='*.js' \
  '(src|href)="/(js|css|admin|assets|favicon)|fetch\("/api/(backup|config|update|versions)' \
  admin js index.html beast.html camera-player.html; then
  echo "Root-relative Smartdash URL breaks proxied installations" >&2
  exit 1
fi

echo "HA Smartdash container package checks passed."
