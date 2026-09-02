# Changelog

## 0.8.31

- Reverted v0.8.30: the overview page's 3 cameras are back to live
  video, as requested. Note this also brings back the bandwidth/decode
  cost that was causing the reported slowdown -- if it recurs, worth
  revisiting (e.g. fewer live cameras or a lower default quality on
  the overview page specifically) rather than dropping live view.

## 0.8.30

- Found and fixed the real cause of broad kiosk slowness reported
  alongside the camera investigation: the overview page's 3-camera
  strip was opening a full live go2rtc video connection for *every*
  camera shown there (not just one), all running continuously
  whenever the overview page is on screen -- typically the page a
  kiosk idles on most of the time. That's a real, ongoing bandwidth
  and decode cost per camera per second connected, unlike the
  dedicated Cameras page (which already only opens one live stream,
  for the camera actually selected). The overview strip now shows the
  same kind of lightweight, periodically-refreshed snapshot the
  Cameras page's own thumbnails use; tapping a camera still opens a
  real live view on the Cameras page.

## 0.8.29

- Fixed camera switching for go2rtc setups showing a picture, then
  going black, then finally the live feed. camera-player.html already
  shows its own snapshot instantly and crossfades smoothly to live
  video on its own -- the featured-camera code was waiting on the
  iframe's generic page-load event before revealing it at all, which
  fires long before that internal snapshot has even loaded, so it
  revealed the iframe's blank pre-snapshot state as an extra flash.
  The iframe now swaps in immediately and manages its own loading
  state, same as it always did.
- The instant placeholder shown while switching cameras no longer
  reuses a go2rtc tile's live snapshot URL as-is (a fresh network
  request with no fallback if it fails) -- it's preloaded and verified
  first, matching the safe pattern the periodic tile refresh already
  used, so a failed request can no longer show up as a missing picture.

## 0.8.28

- Fixed the real cause of the featured camera taking a long time to
  load even after the instant placeholder appeared: without go2rtc,
  it was preferring Home Assistant's own continuously-proxied (often
  transcoded) MJPEG stream over a plain snapshot whenever the camera
  exposed an access_token, which is common -- a much heavier
  connection to establish on the Home Assistant host than the single-
  frame snapshot the thumbnail strip already used successfully. The
  featured view now always uses the same fast, periodically-refreshed
  snapshot as the thumbnails when go2rtc isn't configured.

## 0.8.27

- Clicking a camera now shows that camera's own last-known thumbnail
  immediately as a placeholder, reusing the picture already sitting in
  the camera strip -- no waiting, no black frame -- while the real
  live stream or full-resolution picture loads in behind it, then
  swaps in automatically once that's ready. The placeholder is shown
  slightly dimmed so it reads as "still loading" without looking
  broken.

## 0.8.26

- Fixed a real regression from v0.8.23's camera click-switch fix: a
  single transient picture-fetch failure (Home Assistant briefly busy)
  swapped in a blank/black picture immediately instead of keeping the
  previous camera's picture on screen and trying again. It now retries
  a couple of times with a short backoff before giving up.
- Authenticated images (camera pictures, printer snapshots, banner
  photos) across the whole app no longer go blank on one failed
  refresh -- the last-known-good picture now stays on screen until a
  refresh actually succeeds.
- The camera strip's periodic thumbnail refresh now uses the same
  entity-picture fallback as everything else, instead of a raw
  attribute read -- cameras whose integration doesn't expose an
  entity_picture attribute at all were never refreshed again after
  their first load.

## 0.8.25

- Hardened the ventilation card's diagram-fitting: it re-samples close
  to 500 SVG point positions whenever the card's own size changes, and
  was previously gated by an exact fractional-pixel size match, which
  sub-pixel layout jitter could defeat and cause to re-run needlessly.
  It's now gated to whole pixels and coalesced to at most once per
  animation frame, avoiding needless CPU work on a wall display left
  running for many hours.
- Investigated a report of the Admin button becoming briefly
  unresponsive in kiosk mode: traced the click handler and confirmed
  it does not block native navigation when no PIN is configured, so
  this was not a broken Admin link. The report's own diagnosis (a
  stalled renderer/main thread, not specific to this button, also seen
  on earlier builds) matches what the code shows.

## 0.8.24

- The ventilation card's heat exchanger now shows the heat recovery
  percentage in the middle of the rotor, matching the real Home
  Assistant card, and hides it (shows "--") while bypass is open. The
  value was already being read from the correct Dantherm sensor
  (temperature efficiency) but was never actually displayed anywhere.

## 0.8.23

- Fixed a bug where switching the featured camera on the Cameras page
  rebuilt the entire panel and refetched every thumbnail, turning both
  the featured picture and all thumbnails black for several seconds --
  worst on setups without go2rtc, using Home Assistant's own camera
  proxy with large snapshots. Clicking a camera now only fetches that
  one camera's picture, keeps the previous picture on screen until the
  new one has actually loaded, and no longer touches the other
  thumbnails at all.

## 0.8.22

- Text, icons and buttons on the Security page's own status, systems and
  entry cards now scale proportionally with the card's own size instead
  of clipping or overflowing when it is made smaller in the layout
  editor, matching every other card type.

## 0.8.21

- Text, icons and buttons on the climate, security, room, media player,
  pool, car, tyre pressure, robot, printer, weather and energy template
  cards now scale proportionally with the card's own size instead of
  clipping or overflowing when the card is made smaller, extending the
  0.8.20 scaling to the rest of the card types.

## 0.8.20

- Text and icons on the touch-button, graph, media player, calendar,
  and composite template cards now scale proportionally with the
  card's own size instead of clipping or overflowing when the card is
  made smaller.

## 0.8.19

- The heating coil in the ventilation card now sits nearly invisible
  behind the duct when inactive, and becomes solid with a pulse again
  once it switches on -- matching the real Home Assistant card.

## 0.8.18

- Fixed a bug where the ventilation card showed a double frame (a card
  inside a card), because the card's own background/border from when
  it shared space with the cameras was still there after it became
  its own independent card. The card now fills its whole area with a
  single frame, like every other card.

## 0.8.17

- The ventilation card's auto-detect now also finds the heating coil's
  active status, air after the coil, and flow/return temperatures
  from the associated Dantherm device.

## 0.8.16

- The ventilation card's auto-detect now also finds filter-change and
  afterheat sensors on the unit itself, combines up to 5 separate
  fault sensors (from several sub-devices) into the alarm field with
  no Home Assistant helper required, and fills room temperature,
  humidity and heat transfer from other Dantherm-linked devices when
  exactly one unambiguous candidate exists.

## 0.8.15

- The ventilation card's editor can now auto-detect a Dantherm HCH
  PassivLink device from its sensors and fill in the 13 fields it
  covers with a single click, instead of typing them in one at a time.

## 0.8.14

- Cards on the overview and other pages can now be resized in
  quarter-unit steps (4 levels per unit) instead of only half, both by
  dragging the corner handle and from the card's own settings dialog,
  which now has a number field instead of a dropdown.
- The factor card sizes are multiplied by in the CSS is now a single
  shared constant in one place, not a repeated literal across six
  files -- the exact class of bug behind the v0.8.11-v0.8.13 issue
  can't happen the same way again.

## 0.8.13

- Fixed a serious bug where a card on the overview or other pages
  doubled in size every single time Save was pressed in edit mode --
  including cards that were never touched that session. The size grew
  exponentially with each save, making the layout impossible to
  properly edit into shape.

## 0.8.12

- Fixed a serious bug from the last release where every card on the
  overview and other pages rendered at double its intended height, with
  large empty gaps.
- An already-migrated ventilation card whose setup was missing a cameras
  card now automatically gets one back, so the cameras no longer
  disappear.
- The migrated ventilation card now defaults to the same height as the
  cameras card, so it lands in the same row and resembles the old
  shared view.

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
