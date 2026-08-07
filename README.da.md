# HA Smartdash

HA Smartdash er et responsivt, konfigurationsdrevet kiosk-dashboard til Home Assistant. Det er et personligt hobbyprojekt, bygget til udviklerens eget hjem med hjælp fra AI, og deles som det er uden garanti for alle installationer eller enhedsmodeller.

På mange kiosk-pc’er og tablets vil HA Smartdash opleves hurtigere og bruge færre ressourcer end Home Assistants fulde brugerflade. Det skyldes blandt andet, at dashboardet er fokuseret på kioskvisning, henter entity-listen én gang pr. sideåbning, cacher den lokalt og undgår unødvendige genindlæsninger. Den konkrete forskel afhænger af enheden, browseren, kameraerne, de aktiverede sider og HA-integrationerne.

## Hurtig installation

1. Hent projektet og læg indholdet i webserverens rodmappe.
2. Aktivér PHP 8+ og giv webserveren skriverettighed til `data/`.
3. Brug `deploy/nginx.conf.example` som udgangspunkt for en `/ha/` reverse proxy med WebSocket-understøttelse.
4. Åbn `/admin/`, angiv Home Assistant-adressen og log ind.
5. Vælg entities til de sider, du vil bruge, og gem.
6. Åbn `/` for selve dashboardet.

Den centrale opsætning oprettes som `data/config.json`. Filen er ignoreret af Git og må ikke lægges på GitHub, da entity-id'er kan afsløre oplysninger om hjemmet.

## Hvad gemmes hvor?

- Entity-valg, aktiverede sider, forsidekort, fælles titel og favicon gemmes centralt.
- Login/session, pinkode, tema, kameraopsætning og kioskindstillinger gemmes lokalt i den enkelte browser.
- Entity-listen hentes én gang, caches og genhentes kun via den tydelige opdateringsknap.

Forsidebyggeren er gitterbaseret: kort kan tilføjes, fjernes, flyttes og få responsive størrelser. Den er bevidst ikke et frit pixel-lærred, fordi layoutet skal være stabilt på brede, smalle og lodrette skærme.

## Backup og opdatering

Eksportér profilen under **Admin → Backup & gendannelse**, før programfiler udskiftes. Bevar `data/config.json`, eller importér profilen igen efter opdateringen. En SMB-share skal monteres af værten under `/config/backup-targets/<navn>`; HA Smartdash gemmer ikke SMB-login.

## Privatliv og ansvar

Projektet har ingen analytics, telemetri eller påkrævet cloudtjeneste. Browseren kontakter kun Smartdash-serveren, den konfigurerede Home Assistant-proxy og eventuelle tjenester, du selv vælger. Sikkerheds- eller poolautomatik bør ligge og testes i Home Assistant, ikke kun i brugerfladen.

Se den engelske [README](README.md), [sikkerhedsvejledningen](SECURITY.md) og [licensen](LICENSE) for alle detaljer.
