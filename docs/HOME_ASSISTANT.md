# Home Assistant App installation

This installation is available on Home Assistant OS and Home Assistant
Supervised. Home Assistant Container/Core users should use
[Docker Compose](DOCKER.md).

## Add the repository

1. Open **Settings → Apps → App store**.
2. Open the repository menu.
3. Add `https://github.com/MRDonnii/ha-smartdash`.
4. Refresh the store and select **HA Smartdash**.

## Install and open

Install the App, enable automatic start and optionally enable Watchdog. Use
**Open Web UI** for Home Assistant-authenticated Ingress access.

The default internal Home Assistant address is
`http://homeassistant:8123`. Keep it unless the Core container uses a custom
network configuration.

Smartdash still uses its own Home Assistant user session for entity access. It
does not expose a Supervisor administrator token to wall-panel browsers.

## Optional direct kiosk port

Ingress needs no published port. For a kiosk that opens Smartdash directly,
open the App's **Network** section and map internal TCP port 8099 to any unused
host port. Only the host-side value may be changed.

## Data, backup and update

Home Assistant maps a writable and backup-aware `/data` volume automatically.
It contains configuration, layouts, PIN settings, local profiles and backups.
Use Home Assistant's App update button; the persistent volume survives image
replacement. Include the HA Smartdash App in regular Home Assistant backups.

## Troubleshooting

- Blank Ingress assets normally indicate a root-relative application URL.
  Current releases validate all application-owned URLs for Ingress safety.
- HTTP 502 means the App cannot reach the configured Home Assistant address.
- Direct access and Ingress use separate browser storage, so each browser may
  need to sign in once.

