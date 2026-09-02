# Changelog

## 0.8.5

- Fixed a navigation bug where tapping the ventilation card on the overview
  incorrectly opened the cameras page instead of the heating page.

## 0.8.4

- Fixed a rendering glitch where the district-heating card's rounded corners
  could show small crescent artifacts outside real Home Assistant, including
  on the Smartdash overview.
- The district-heating card's house outline now shows a constant, subtle warm
  tint instead of being fully transparent.
- The ventilation card gained a new left-side metrics panel (bypass, air
  quality, heat transfer, alarm) mirroring the existing right panel, the same
  warm tint, and a full GUI configuration editor.

## 0.8.3

- Added an optional, configurable heat-recovery ventilation card beside the
  overview cameras, including temperature-aware airflow, bypass and
  afterheating status.
- Added the responsive Wavin Calefa district-heating house card to the heating
  page with live temperatures, flow and CH/DHW valve positions.
- Improved primary valve selection and added a clear summer-cutoff state while
  retaining domestic hot-water status.

## 0.8.2

- First Stable release of the Docker, Unraid, and Home Assistant App
  distributions -- Docker Compose and the Unraid template now track the
  `latest` image tag instead of `beta`.
- Alert popup drag/resize handles are now large enough to use reliably on a
  touchscreen.

## 0.8.1

- Home Assistant's Open Web UI button now opens the stable direct host and
  configured port instead of a nested Ingress path, preventing invalid OAuth
  redirect URI errors.

## 0.8.0

- Added the first Beta package for Home Assistant OS/Supervised with Ingress,
  optional direct kiosk port, persistent App data and platform-owned updates.
- Added matching Docker Compose and Unraid distribution from the same image.

## 0.7.123

- Initial Home Assistant App package with Ingress, optional direct port,
  persistent data, health monitoring and the shared HA Smartdash image.
