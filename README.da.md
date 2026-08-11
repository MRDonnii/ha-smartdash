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

1. Hent projektet og læg indholdet i webserverens rodmappe.
2. Aktivér PHP 8+ og giv webserveren skriverettighed til `data/`.
3. Kør `sh deploy/setup-smartdash.sh`. Førstegangsopsætningen spørger efter HA-adressen, webroden og den aktive Nginx-serverfil. Den tager backup, genererer proxyen, validerer Nginx, genindlæser den og tester loginruten.
4. Åbn `/admin/`, log ind og vælg de entities, du vil bruge.
5. Åbn `/` for selve dashboardet.

Docker og Unraid kan køre samme opsætning uden spørgsmål:

```sh
SMARTDASH_HA_URL=http://192.168.1.20:8123 \
SMARTDASH_WEB_ROOT=/var/www/ha-smartdash \
SMARTDASH_NGINX_CONF=/etc/nginx/conf.d/ha-smartdash.conf \
SMARTDASH_PUBLIC_URL=http://192.168.1.50 \
sh deploy/setup-smartdash.sh
```

Den manuelle `nginx.conf.example` og `check-install.sh` findes fortsat til fælles eller specialbyggede Nginx-konfigurationer.

Kontrollen kalder `/ha/auth/providers`. HTTP 200 med JSON og feltet `providers` betyder, at proxyen virker. HTTP 405 eller HTML betyder, at Nginx stadig sender kaldet til den statiske `location /`. HTTP 502/503/504 betyder, at proxyblokken er indlæst, men at Nginx ikke kan nå den valgte Home Assistant-adresse eller port 8123.

Home Assistant skal have tillid til den **umiddelbare** Nginx-proxy. Efter et afvist kald viser Home Assistant-loggen den præcise proxyadresse, der skal godkendes. Tilføj kun denne adresse eller det mindst mulige korrekte Docker-netværk i `configuration.yaml`, og genstart Home Assistant:

```yaml
http:
  use_x_forwarded_for: true
  trusted_proxies:
    - 192.168.1.50      # Eksempel: Nginx-værtens LAN-adresse
    # - 172.18.0.0/16   # Kun eksempel: brug den faktiske Docker-netværksadresse
```

Ved subnet skal netværksadressen bruges, ikke en almindelig værtsadresse med subnet-suffiks. Undgå at godkende hele lokalnettet, medmindre det er et bevidst krav. HTTP 400 fra installationskontrollen betyder normalt, at denne tillid mangler eller ikke matcher den umiddelbare proxy.

Den centrale opsætning oprettes som `data/config.json`. Filen er ignoreret af Git og må ikke lægges på GitHub, da entity-id'er kan afsløre oplysninger om hjemmet.

## Hvad gemmes hvor?

- Entity-valg, aktiverede sider, forsidekort, fælles titel og favicon gemmes centralt.
- Login/session, pinkode, tema, kameraopsætning og kioskindstillinger gemmes lokalt i den enkelte browser.
- Entity-listen hentes én gang, caches og genhentes kun via den tydelige opdateringsknap.

Forsidebyggeren er gitterbaseret: kort kan tilføjes, fjernes, flyttes og få responsive størrelser. Den er bevidst ikke et frit pixel-lærred, fordi layoutet skal være stabilt på brede, smalle og lodrette skærme.

## Backup og opdatering

Eksportér profilen under **Admin → Backup & gendannelse**, før programfiler udskiftes. Bevar `data/config.json`, eller importér profilen igen efter opdateringen. En SMB-share skal monteres af værten under `/config/backup-targets/<navn>`; HA Smartdash gemmer ikke SMB-login.

Lokale backups og backups på monterede SMB-shares vises i adminpanelet og kan hentes direkte. Se [SMB-vejledningen](deploy/SMB-BACKUP.md) for Linux, Docker og Unraid.

## Privatliv og ansvar

Projektet har ingen analytics, telemetri eller påkrævet cloudtjeneste. Browseren kontakter kun Smartdash-serveren, den konfigurerede Home Assistant-proxy og eventuelle tjenester, du selv vælger. Sikkerheds- eller poolautomatik bør ligge og testes i Home Assistant, ikke kun i brugerfladen.

Se den engelske [README](README.md), [sikkerhedsvejledningen](SECURITY.md) og [licensen](LICENSE) for alle detaljer.
