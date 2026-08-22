# HA Smartdash Home Assistant App

This app runs HA Smartdash as a managed Home Assistant container. Configuration,
layouts, PIN settings and backups live in the app's persistent `/data` volume and
are included in Home Assistant backups.

After installation, select **Open Web UI** to open Smartdash directly on the
Home Assistant host address and configured port. This stable LAN address is
suitable for OAuth login, wall panels, kiosk browsers and camera playback.
