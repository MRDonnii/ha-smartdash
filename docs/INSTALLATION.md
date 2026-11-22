# Choose an installation method

HA Smartdash is the same application on every platform. Only the runtime and
update mechanism differ. Configuration, layouts, PIN settings and backups live
in `data/` (standalone web server) or the persistent `/data` volume
(containers).

| Installation | Best for | Updates | Guide |
| --- | --- | --- | --- |
| Docker Compose | Linux servers, NAS devices and Home Assistant Container hosts | Replace the image; retain `/data` | [Docker](DOCKER.md) |
| Unraid | Unraid users who prefer a Web UI template | Update the container in Unraid; retain appdata | [Unraid](UNRAID.md) |
| Home Assistant App | Home Assistant OS and Supervised | Home Assistant App update; retain App data | [Home Assistant](HOME_ASSISTANT.md) |
| Standalone web server | Existing Nginx + PHP installations | Built-in updater or replace application files; retain `data/` | [Web server](WEB_SERVER.md) |

Home Assistant Core Container does not include Supervisor and cannot install
Apps. Use Docker Compose in that environment.

All methods require a Home Assistant account. A dedicated wall-panel user with
only the permissions needed by the dashboard is recommended.

