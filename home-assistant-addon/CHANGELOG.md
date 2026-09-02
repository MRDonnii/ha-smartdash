# Changelog

## 0.8.11

- Cards on the overview and every other page can now be resized in
  half-unit steps, not just whole ones, both by dragging the corner
  handle and from the card's own settings dialog.

## 0.8.10

- Migrating an already-enabled ventilation card now places it right
  after the cameras card in the layout, landing in the same area as
  before, and automatically caps a saved camera selection of more than
  2 down to 2 -- the same balance the old shared view had.

## 0.8.9

- The ventilation card is now a real, independent overview card that can
  be added, removed and configured the same way as every other card --
  with the same gear-icon editor and searchable entity fields. It is no
  longer a hidden setting inside "Choose cameras".
- An already-enabled ventilation card is migrated automatically to the
  new card format, so existing entity choices are preserved.

## 0.8.8

- The overview ventilation card now shows more vivid blue and red duct
  colors for cold and warm airflow, matching the real Home Assistant card.

## 0.8.7

- Removed redundant arrow markers from the overview ventilation card's ducts;
  the animated airflow already conveys direction.

## 0.8.6

- The overview ventilation card now matches the real Home Assistant card
  during bypass: straight ducts instead of crossing ones, correctly swapped
  supply/extract readings, and the heating coil panel is hidden while bypass
  is open.
- The overview ventilation card no longer shows heat recovery twice; the
  right-hand panel now has four fields instead of five, matching the real
  card.
- Reduced excess space above the house roof and the "INDE" title on the
  overview ventilation card.

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
