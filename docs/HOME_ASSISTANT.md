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
**Open Web UI** to open the direct Smartdash address in a new browser page.

The default internal Home Assistant address is
`http://homeassistant:8123`. Keep it unless the Core container uses a custom
network configuration.

Smartdash still uses its own Home Assistant user session for entity access. It
does not expose a Supervisor administrator token to wall-panel browsers.

## Direct dashboard address and custom port

The App publishes internal TCP port 8099 and **Open Web UI** resolves it to the
Home Assistant machine's LAN address and selected host port. This stable direct
address avoids nested Ingress OAuth callback errors and is recommended for
kiosks and camera-heavy dashboards. Open the App's **Network** section to use
another available host port; only the host-side value may be changed.

## Data, backup and update

Home Assistant maps a writable and backup-aware `/data` volume automatically.
It contains configuration, layouts, PIN settings, local profiles and backups.
Use Home Assistant's App update button; the persistent volume survives image
replacement. Include the HA Smartdash App in regular Home Assistant backups.

## Troubleshooting

- `Invalid redirect URI` from an older release is fixed by the direct Web UI
  address. Update the App and reopen it from **Open Web UI**.
- HTTP 502 means the App cannot reach the configured Home Assistant address.
- Each browser keeps its own Smartdash session and may need to sign in once.
