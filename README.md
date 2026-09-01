# HA Smartdash

![HA Smartdash logo](assets/ha-smartdash-logo.svg)

HA Smartdash is a responsive, configuration-driven Home Assistant dashboard built for wall-mounted touchscreens, kiosk computers, tablets and desktop browsers. Its purpose is to turn a large smart-home installation into one calm, coherent control surface: essential information is always visible, common actions are easy to reach, and detailed controls remain available without loading the full Home Assistant interface.

## Ready-made container packages

HA Smartdash can run from the same multi-architecture image on Docker,
Unraid, and Home Assistant OS/Supervised. The package includes Nginx, PHP,
health monitoring, automatic Home Assistant proxy configuration, and a
persistent `/data` volume. Users can choose their own LAN port without
changing the fixed internal Ingress port.

- **Docker Compose:** use `docker-compose.yml` and select the host port with
  `SMARTDASH_PORT`.
- **Unraid:** import `unraid/ha-smartdash.xml`; the Web UI port, appdata path,
  Home Assistant URL and timezone are editable fields.
- **Home Assistant:** add this GitHub repository to the App store, then install
  HA Smartdash with authenticated Ingress or expose a custom direct port.

See [Docker, Unraid and Home Assistant installation](docs/DOCKER.md) for the
complete installation and update flow.

The project combines a touch-first dashboard, a visual page and card editor, centralized entity configuration, live camera handling, kiosk power management and an administration area. It is designed to preserve each installation's choices across updates instead of assuming that every home uses the author's devices or layout.

On many kiosk computers and tablets, HA Smartdash can feel faster and use fewer client resources than Home Assistant's full interface. It loads the entity catalogue once per page session, caches it locally, updates cards in place and avoids unnecessary full-page refreshes. Actual performance depends on the device, browser, enabled pages, cameras and Home Assistant integrations.

> [!IMPORTANT]
> HA Smartdash is a personal hobby project, built for the author's own home with assistance from AI. It is shared as-is, without a promise that every Home Assistant installation, integration or device model will work. Test security, heating, pool and other safety-relevant automations in Home Assistant itself. Forks, experiments and contributions are welcome.

![Neutral overview demo](docs/screenshots/overview.png)

![Neutral admin demo](docs/screenshots/admin.png)

## Screenshot gallery

These screenshots mirror the production dashboard's layout, card proportions and navigation. All values, entity names and rooms are synthetic, and every camera and room image was generated specifically for this repository. No private Home Assistant data or real home is shown.

| Rooms | Energy |
| --- | --- |
| ![Rooms demo](docs/screenshots/rooms.png) | ![Energy demo](docs/screenshots/energy.png) |

| Weather | Device-driven robot |
| --- | --- |
| ![Weather demo](docs/screenshots/weather.png) | ![Robot demo](docs/screenshots/robot.png) |

| Pool | Electric vehicle |
| --- | --- |
| ![Pool demo](docs/screenshots/pool.png) | ![Electric vehicle demo](docs/screenshots/car.png) |

## Product principles

- **Touch first:** important controls use large targets, clear state and layouts that work from a wall panel.
- **One home, one interface:** rooms, security, energy, media, climate, cameras and equipment follow the same visual language.
- **Configuration over hard-coding:** entities, pages, cards, cameras and device roles are selected for each installation.
- **Stable live updates:** entity changes update content in place without resetting scroll position or rebuilding the entire page.
- **Progressive detail:** the overview stays concise while dedicated views provide complete control and history.
- **Safe updates:** explicit user choices, including empty lists and removed optional cards, are preserved.
- **Graceful fallbacks:** optional services improve the experience but do not become unnecessary single points of failure.

## Main features

### Editable dashboard and navigation

- Add, remove, rename, reorder and restore dashboard pages from Admin.
- Edit existing cards directly in each supported view.
- Add cards from a reusable template gallery and bind them to recommended or custom Home Assistant entities.
- Move and resize cards with responsive grid sizing rather than fragile pixel positioning.
- Store separate dashboard, tablet and compact layout profiles.
- Keep oversized custom layouts usable with vertical scrolling instead of clipping cards.
- Use **Fit page** to rebalance supported layouts for the current viewport.

### Overview

- Persistent weather, electricity-price and camera areas.
- Calendar, waste collection, security, locks, energy, pool temperature and media status cards.
- Configurable overview cards, quick tiles and centrally stored camera selection.
- Optional heat-recovery ventilation card beside two overview cameras. It can
  bind standard Home Assistant sensors for temperatures, fan speed, heat
  recovery, bypass and afterheating, and is disabled by default.
- Optional Wavin Calefa district-heating house card on the heating page with
  live pipe temperatures, water flow, radiator and hot-water valve positions.
- Compact notifications for mail, security conditions, equipment faults and active 3D prints.
- Optional floating media controls that disappear when playback is inactive.

### Cameras

- Shared camera renderer across overview, camera, printer and event-driven views.
- Per-camera stream-quality selection from an unobtrusive menu.
- go2rtc support when configured.
- Automatic fallback to Home Assistant `camera_proxy_stream`, followed by authenticated snapshots when no go2rtc mapping exists.
- Reconnection and health checks after network loss, Home Assistant restarts or camera-service updates.
- Doorbell events can wake the kiosk and temporarily show the configured front-door camera full screen.
- Camera alerts can be restricted to people, vehicles and animals instead of generic motion.

### Rooms and climate

- Room cards with large temperature and humidity readings.
- Grouped light controls, presence-aware content and Better Thermostat selection.
- Dedicated heating view with room thermostats, heat-pump controls, ventilation and district-heating data.
- Configurable visibility for optional ventilation and district-heating sections.

### Energy

- Current usage, daily usage, cost and electricity-price summaries.
- Hourly price bars across available forecast days.
- Consumption history and device-level "usage now" view.
- Space for actionable energy guidance, not only raw charts.

### Security and kiosk locking

- Dedicated security view for alarm systems, locks, open doors and open windows.
- Shared server-side PIN for kiosk unlocking and Admin access.
- Select one Home Assistant `alarm_control_panel` entity to control kiosk locking.
- Lock the dashboard when the selected alarm becomes fully armed.
- Optionally switch off the configured kiosk display after the lock screen has rendered.
- Choose whether disarming keeps the lock until the next PIN entry or removes only the alarm-created lock and returns to normal presence-based screen behavior.
- Manual locks are never removed by an alarm disarm event.
- Home Assistant re-authentication can be used for PIN recovery.

### Music and speakers

- Music Assistant library, search, playlists, albums, radio and track browsing.
- Open albums and playlists from both library and search results.
- Large now-playing view plus a compact player when speaker selection is open.
- Touch-friendly volume buttons, group volume and per-speaker control.
- Add and remove individual speakers, including grouped players such as Sonos stereo pairs.

### Robots

- Generic cards for Home Assistant vacuum and lawn-mower entities.
- Optional specialized templates for maps, room cleaning and supported device-specific controls.
- Full card editor for robot name, model, template, image or map, battery, bin state, progress, active area and quick actions.
- Choose which status, facts, controls, settings and actions are visible.
- Use a Home Assistant camera/image entity or an external image URL without changing application code.
- Existing robot cards remain editable and reusable as templates.

### 3D printer, pool, vehicle and calendar

- 3D-printer view with two selectable live cameras, print progress, model image, temperatures, controls, chamber light and AMS filament status.
- Pool view with live values, controls and temperature history.
- Electric-vehicle view with battery, charging and tyre-pressure presentation.
- Calendar view with day selection, upcoming events, weather context and configurable rows per card.
- Waste collection is shown as one collection per row with type and days remaining.

### Themes, kiosk and administration

- Light, dark, automatic and additional calm color themes with matching diffuse backgrounds.
- Adjustable container transparency while retaining readable touch controls.
- Night-only ambient screen, scheduled screen-off and morning return.
- Presence-driven wake behavior and optional automatic return to the overview.
- Admin sections for pages, entities, connections, kiosk, appearance, security, alerts, backup and updates.
- Central Home Assistant, MQTT and camera configuration with reconnect behavior.
- Danish and English interface selector.
- Protected `data/local-profile.css` and `data/local-profile.js` hooks for installation-specific extensions that releases do not overwrite.

The included [current production-style showcase](demo/current-showcase.html) reproduces the current dashboard structure with synthetic data and never connects to Home Assistant. The earlier [showcase](demo/showcase.html) and a simpler [static demo](demo/index.html) are also retained for comparison.

## Requirements

- Docker/Unraid, Home Assistant OS/Supervised, or a web server with PHP 8+
- Persistent write access to `/data` (containers) or `data/` (web server)
- Network access from Smartdash to Home Assistant
- A modern browser with CSS Grid, WebSocket and ES2020 support
- HTTPS when the dashboard is reachable outside a trusted private network

go2rtc, Music Assistant, MQTT, kiosk display entities and individual device integrations are optional. Their related features appear only when configured.

## Installation

Start with [Choose an installation method](docs/INSTALLATION.md):

| Method | Install guide |
| --- | --- |
| Docker Compose | [Docker](docs/DOCKER.md) |
| Unraid template | [Unraid](docs/UNRAID.md) |
| Home Assistant OS/Supervised App | [Home Assistant App](docs/HOME_ASSISTANT.md) |
| Existing Nginx + PHP server | [Standalone web server](docs/WEB_SERVER.md) |

The Danish standalone guide remains available as
[Komplet installation](docs/INSTALLATION.da.md).

## Configuration ownership

| Stored centrally on the server | Stored locally in each browser |
| --- | --- |
| Entity and device mappings | Home Assistant login/session |
| Enabled, ordered and custom pages | Theme and display profile |
| Card layouts, sizes and visibility | Device-specific kiosk preferences |
| Overview camera selection | Temporary UI state and cached entity catalogue |
| Shared screen-lock PIN and alarm behavior | Browser-specific camera placement where applicable |
| Shared title, branding, favicon and feature settings | Local ambient-screen preferences where applicable |

The page builder is intentionally grid-based. Cards can be added, removed, moved, resized and configured while the responsive layout remains stable across kiosk, tablet and desktop sizes.

## Cameras and optional go2rtc

HA Smartdash can use go2rtc for efficient live streaming and multiple quality variants. A camera does not require go2rtc: when no mapping is available, the dashboard uses Home Assistant's authenticated camera stream and snapshot endpoints. This allows installations with only standard Home Assistant camera entities to work without additional stream infrastructure.

Configure quality variants only when they represent real upstream streams. The dashboard's quality selector changes between the mapped sources; it does not manufacture additional resolution from one stream.

## Updating without losing configuration

Container installs update through Docker, Unraid or Home Assistant by replacing
the image while retaining `/data`. Standalone web servers may use the built-in
updater, which replaces release-owned files while retaining `data/`.

Before either update path, export a profile under **Admin → Backup & restore**.
Never bind-mount application JS/CSS/PHP over the container image and never
delete the persistent data directory during an upgrade.

The updater preserves `data/`, explicit empty or short arrays, removed optional cards and installation-specific profile files. New neutral defaults are added only when a property is genuinely absent. Older `beast-profile` and `beast-central` profile files can also be imported.

## Automatic backup and SMB

HA Smartdash does not mount network shares or store SMB credentials. Mount the share on the host under `/config/backup-targets/<name>`. Writable subdirectories appear as backup destinations in Admin. Scheduling is triggered by dashboard activity, so it is a convenience backup rather than a guaranteed server cron job.

Existing local and SMB backups are listed in Admin and can be downloaded directly. See the complete [SMB backup setup guide](deploy/SMB-BACKUP.md).

## Security and privacy

HA Smartdash has no analytics and does not send project data to the author. The browser communicates with the server hosting Smartdash, the configured Home Assistant proxy and any third-party endpoints you explicitly configure. Review [SECURITY.md](SECURITY.md) before exposing it outside your LAN.

The dashboard PIN is an interface lock and not a substitute for Home Assistant authentication, operating-system security, network isolation or a certified alarm control panel. Alarm, lock and screen-power behavior should be tested safely after configuration.

Do not publish:

- `data/config.json`
- `data/backup-settings.json`
- files in `data/backups/`
- screenshots containing names, cameras, calendars, locations or entity IDs
- Home Assistant tokens, cookies or OAuth callback URLs containing secrets

## Project status

This repository is an evolving personal project, not an official Home Assistant product. Features are developed against a real home installation, then generalized so other users can select their own entities, pages and device templates. Not every integration exposes the same controls or state attributes, so generic cards and graceful fallbacks remain a core design goal.

## Languages and release notes

English is the repository and GitHub release language. The in-dashboard changelog contains both English and Danish and follows the selected interface language. Use the **EN / DA** control in the dashboard to store an interface language choice in the current browser. Danish documentation is available in [README.da.md](README.da.md). Release naming and publishing must follow [RELEASES.md](RELEASES.md).

## License and third-party assets

Source code is licensed under the [MIT License](LICENSE). Bundled fonts, logos, generated showcase images and weather artwork retain their existing files and applicable notices; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Contributing

Issues and pull requests are welcome. Please remove personal configuration before sharing logs or screenshots. See [CONTRIBUTING.md](CONTRIBUTING.md).
