# HA Smartdash

## Installation

1. Install and start the app.
2. Select the host port under **Network** and start the app.
3. Select **Open Web UI**. Home Assistant opens Smartdash directly on the
   Home Assistant host address and selected port in a new browser page.
4. Sign in with Home Assistant or use a Long-Lived Access Token belonging to a
   dedicated wall-panel user.
5. Configure pages, entities, cameras and kiosk behavior in Administration.

The internal Home Assistant address normally remains
`http://homeassistant:8123`. Change it only if Home Assistant uses a custom
internal network configuration.

## Web address and custom port

The Home Assistant button opens `http://HOME_ASSISTANT_IP:PORT/` directly.
Open the app's **Network** section to map internal TCP port `8099` to any
available host port. The default is `8099`, but only the host-side value should
be changed. Direct access avoids OAuth redirect errors caused by nested Ingress
paths and provides a stable address for wall panels, cameras and bookmarks.

## Data and backups

All user configuration lives under `/data` and is included in Home Assistant
app backups. Replacing or updating the image does not remove this data.

## Updates

Use Home Assistant's app update button. The dashboard detects new releases but
will not rewrite files inside its running container.
