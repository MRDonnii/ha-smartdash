# HA Smartdash

## Installation

1. Install and start the app.
2. Open the dashboard through **Open Web UI**.
3. Sign in with Home Assistant or use a Long-Lived Access Token belonging to a
   dedicated wall-panel user.
4. Configure pages, entities, cameras and kiosk behavior in Administration.

The internal Home Assistant address normally remains
`http://homeassistant:8123`. Change it only if Home Assistant uses a custom
internal network configuration.

## Direct wall-panel access and custom port

Ingress works without publishing a LAN port. To connect a kiosk directly,
open the app's **Network** section and map internal TCP port `8099` to any
available host port. The chosen host port does not need to be 8099.

## Data and backups

All user configuration lives under `/data` and is included in Home Assistant
app backups. Replacing or updating the image does not remove this data.

## Updates

Use Home Assistant's app update button. The dashboard detects new releases but
will not rewrite files inside its running container.

