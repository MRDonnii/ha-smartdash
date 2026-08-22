# HA Smartdash Home Assistant App

This app runs HA Smartdash as a managed Home Assistant container. Configuration,
layouts, PIN settings and backups live in the app's persistent `/data` volume and
are included in Home Assistant backups.

After installation, select **Open Web UI** for authenticated Ingress access. Port
8099 may also be exposed for wall panels and kiosk browsers that must open the
dashboard without first opening the Home Assistant interface.

