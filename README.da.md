# HA Smartdash

HA Smartdash er et responsivt, konfigurationsdrevet kiosk-dashboard til Home Assistant. Det er et personligt hobbyprojekt, bygget til udviklerens eget hjem med hjælp fra AI, og deles som det er uden garanti for alle installationer eller enhedsmodeller.

På mange kiosk-pc’er og tablets vil HA Smartdash opleves hurtigere og bruge færre ressourcer end Home Assistants fulde brugerflade. Det skyldes blandt andet, at dashboardet er fokuseret på kioskvisning, henter entity-listen én gang pr. sideåbning, cacher den lokalt og undgår unødvendige genindlæsninger. Den konkrete forskel afhænger af enheden, browseren, kameraerne, de aktiverede sider og HA-integrationerne.

## Skærmbilleder

Skærmbillederne følger produktionsdashboardets layout, kortstørrelser og navigation. Alle værdier, entity-navne og rum er syntetiske, og samtlige kamera- og rumbilleder er genereret til dette repository; ingen private Home Assistant-data eller virkelige hjem vises.

![Neutral forside-demo](docs/screenshots/overview.png)

| Rum | Energi |
| --- | --- |
| ![Rum-demo](docs/screenshots/rooms.png) | ![Energi-demo](docs/screenshots/energy.png) |

| Vejr | Robot |
| --- | --- |
| ![Vejr-demo](docs/screenshots/weather.png) | ![Robot-demo](docs/screenshots/robot.png) |

| Pool | Elbil |
| --- | --- |
| ![Pool-demo](docs/screenshots/pool.png) | ![Elbil-demo](docs/screenshots/car.png) |

Den [produktionslignende showcase](demo/showcase.html) gengiver dashboardets layout med syntetiske data og forbinder aldrig til Home Assistant.

## Hurtig installation

Vælg den installationsform, der passer til værten:

| Metode | Vejledning |
| --- | --- |
| Docker Compose | [Docker](docs/DOCKER.md) |
| Unraid-template | [Unraid](docs/UNRAID.md) |
| Home Assistant OS/Supervised App | [Home Assistant App](docs/HOME_ASSISTANT.md) |
| Eksisterende Nginx + PHP | [Komplet dansk webserverinstallation](docs/INSTALLATION.da.md) |

Alle containerløsninger bruger samme image og bevarer konfigurationen i
`/data`. Den eksterne port kan vælges frit; containerens interne port er 8099.

## Hvad gemmes hvor?

- Entity-valg, aktiverede sider, forsidekort, fælles titel og favicon gemmes centralt.
- Login/session og enkelte enhedsspecifikke kioskvalg gemmes lokalt i browseren; fælles PIN, sider, layouts, entities og serverindstillinger gemmes centralt.
- Entity-listen hentes én gang, caches og genhentes kun via den tydelige opdateringsknap.

Forsidebyggeren er gitterbaseret: kort kan tilføjes, fjernes, flyttes og få responsive størrelser. Den er bevidst ikke et frit pixel-lærred, fordi layoutet skal være stabilt på brede, smalle og lodrette skærme.

## Backup og opdatering

Eksportér profilen under **Admin → Backup & gendannelse** før opdatering. Docker,
Unraid og Home Assistant erstatter imaget og bevarer `/data`; en selvstændig
webserver erstatter programfiler og bevarer `data/`. En SMB-share skal monteres
af værten under `/config/backup-targets/<navn>`; HA Smartdash gemmer ikke SMB-login.

Lokale backups og backups på monterede SMB-shares vises i adminpanelet og kan hentes direkte. Se [SMB-vejledningen](deploy/SMB-BACKUP.md) for Linux, Docker og Unraid.

## Privatliv og ansvar

Projektet har ingen analytics, telemetri eller påkrævet cloudtjeneste. Browseren kontakter kun Smartdash-serveren, den konfigurerede Home Assistant-proxy og eventuelle tjenester, du selv vælger. Sikkerheds- eller poolautomatik bør ligge og testes i Home Assistant, ikke kun i brugerfladen.

Se den engelske [README](README.md), [sikkerhedsvejledningen](SECURITY.md) og [licensen](LICENSE) for alle detaljer.
