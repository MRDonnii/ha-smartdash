# Standalone Nginx and PHP installation

Use this method when HA Smartdash should run in an existing web stack without
Docker. It requires Nginx, PHP-FPM with cURL and ZIP support, HTTPS-capable CA
certificates, and write permission to `data/`.

## Install

1. Download a Stable or Beta source archive from GitHub Releases.
2. Extract it to a dedicated web root such as `/var/www/ha-smartdash`.
3. Ensure the PHP-FPM user can write only to `data/`.
4. Configure Nginx using `deploy/nginx.conf.example`, including the `/ha/`
   WebSocket reverse proxy.
5. Run `sh deploy/check-install.sh http://SMARTDASH_ADDRESS`.
6. Add the immediate Nginx proxy address to Home Assistant's
   `http.trusted_proxies` if Home Assistant reports HTTP 400.

The interactive helper can generate the Nginx server block:

```sh
sudo sh deploy/setup-smartdash.sh
```

## Update

Export a profile backup first. The built-in updater downloads a GitHub release,
validates it, snapshots the current application and replaces release-owned
files while preserving `data/`. Manual updates must follow the same rule:
replace application files but never overwrite or delete `data/`.

The standalone updater is intentionally disabled inside container images;
Docker, Unraid and Home Assistant replace images instead.

## Security

Protect Administration and the PHP API with LAN/VPN/firewall controls. The
dashboard PIN is an interface lock, not network authentication. Never commit
`data/config.json`, exported profiles or Home Assistant tokens.

