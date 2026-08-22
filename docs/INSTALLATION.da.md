# Komplet installation af HA Smartdash

> Denne guide gælder installation på en eksisterende Nginx/PHP-webserver.
> Til den nye færdige pakke bruges [Docker](DOCKER.md), [Unraid](UNRAID.md)
> eller [Home Assistant App](HOME_ASSISTANT.md). Alle tre containerløsninger
> bevarer opsætningen i `/data` og opdateres ved at udskifte imaget.

Denne vejledning installerer HA Smartdash bag Nginx med PHP og en same-origin reverse proxy til Home Assistant. Følg rækkefølgen: webserver, Nginx-proxy, Home Assistant-tillid, forbindelsestest og til sidst login.

## 1. Før du begynder

Du skal kende:

- Smartdash-serverens IP eller DNS-navn
- Home Assistants interne IP og port, normalt `8123`
- placeringen af Smartdash-filerne på webserveren
- placeringen af den aktive Nginx-serverfil
- Nginx-proxyens IP, som Home Assistant ser forbindelsen komme fra

Serveren skal have Nginx, PHP 8 eller nyere, PHP-FPM og `curl`. Smartdash skal kunne skrive til mappen `data/`. Brug HTTPS, hvis dashboardet kan nås uden for et betroet lokalnet.

## 2. Hent programmet

Hent den seneste stabile release fra GitHub, og pak den ud i webroden. Ved Git:

```sh
git clone https://github.com/MRDonnii/ha-smartdash.git /var/www/ha-smartdash
cd /var/www/ha-smartdash
```

Giv webserverens bruger skriveadgang til `data/`. Brug den bruger, PHP-FPM faktisk kører som:

```sh
mkdir -p data
chown -R www-data:www-data data
chmod 775 data
```

På Unraid skal webroden og `data/` ligge på persistente appdata-mounts. Ændringer, der kun laves inde i en container uden et mount, forsvinder, når containeren genskabes.

## 3. Generér Nginx-konfigurationen

På en dedikeret Smartdash Nginx-server kan førstegangs-scriptet bruges:

```sh
sh deploy/setup-smartdash.sh
```

Scriptet spørger efter HA-adresse, webrod, Nginx-serverfil, port og PHP-FPM. Det tager backup, skriver konfigurationen, kører `nginx -t`, ruller tilbage ved en ugyldig konfiguration, genindlæser Nginx og tester `/ha/`.

Til Docker eller Unraid kan det køres uden spørgsmål:

```sh
SMARTDASH_HA_URL=http://192.168.1.25:8123 \
SMARTDASH_WEB_ROOT=/var/www/ha-smartdash \
SMARTDASH_NGINX_CONF=/etc/nginx/conf.d/ha-smartdash.conf \
SMARTDASH_PUBLIC_URL=http://192.168.1.27 \
sh deploy/setup-smartdash.sh
```

Kør scriptet i det miljø, hvor den aktive Nginx-konfiguration og `nginx`-kommandoen findes. Et script kørt på værten kan ikke ændre en Nginx-konfiguration, der kun findes inde i en container, medmindre konfigurationsmappen er monteret på værten.

Har Nginx-serveren allerede andre websites, skal du ikke overskrive den fælles serverfil. Brug i stedet `deploy/nginx.conf.example` som udgangspunkt, og indsæt `/ha`-lokationerne i den korrekte aktive `server { ... }`-blok.

## 4. Kontrollér Nginx før login

Kontrollér syntaksen og genindlæs Nginx:

```sh
nginx -t
nginx -s reload
```

Test derefter Smartdash-adressen:

```sh
sh deploy/check-install.sh http://SMARTDASH-IP
```

Et korrekt resultat er:

```text
OK: Smartdash /ha/ proxy reaches Home Assistant.
```

Testen kalder `http://SMARTDASH-IP/ha/auth/providers`. Den skal returnere HTTP 200 og rigtig Home Assistant JSON.

## 5. Lad Home Assistant stole på Nginx

Home Assistant skal stole på den **umiddelbare** proxyadresse. Det er adressen, som HA ser forbindelsen komme fra; i Docker kan det være en container- eller bridge-adresse frem for Nginx-værtens normale LAN-adresse.

I Home Assistants HTTP-indstillinger:

1. Aktivér **Trust X-Forwarded-For**.
2. Tilføj den præcise Nginx-IP eller det mindst mulige korrekte Docker-netværk under **Trusted proxies**.
3. Gem ændringen og lad Home Assistant genstarte.
4. Åbn Home Assistant direkte på port `8123`.
5. Tryk **Review the change**, og bekræft ændringen inden tidsfristen. Ellers ruller Home Assistant automatisk tilbage til den tidligere HTTP-konfiguration.

Eksempler:

```text
192.168.1.27       En enkelt vært
192.168.1.27/32    Den samme enkelte vært skrevet som CIDR
192.168.1.0/24     Hele netværket 192.168.1.x
172.30.33.0/24     Eksempel på et Docker-netværk
```

Skriv ikke `192.168.1.27/24`. Et `/24`-netværk skal bruge netværksadressen `192.168.1.0/24`. Brug ikke et helt LAN eller Docker-netværk, hvis den ene præcise proxy-IP er stabil og tilstrækkelig.

Ved YAML-konfiguration svarer det til:

```yaml
http:
  use_x_forwarded_for: true
  trusted_proxies:
    - 192.168.1.27/32
```

Hvis forbindelsen stadig giver HTTP 400, skal du åbne Home Assistant direkte, prøve Smartdash igen og læse HA-loggen. Linjen om `reverse proxy` viser den faktiske kilde-IP, der mangler.

## 6. Log ind

Åbn:

```text
http://SMARTDASH-IP/admin/
```

Der er to loginmuligheder:

### Home Assistant-login

Det normale OAuth-flow sender browseren til Home Assistant og tilbage igen. Det anbefales til almindelig brug, fordi HA kan forny sessionen uden et permanent token.

### Long-Lived Access Token

Opret tokenet nederst på din Home Assistant-brugerprofil. Åbn **Log ind med token**, indsæt tokenet og vælg **Kontrollér token og log ind**. Tokenet valideres mod `/ha/api/`, gemmes kun i browserens lokale lager og sendes aldrig til Smartdash-serverens konfigurationsfiler eller fejllog.

Et token løser ikke en ødelagt `/ha/`-proxy. HTTP 400, 404, 405 eller 502 skal rettes i HA/Nginx først.

## 7. Fejllog før adminadgang

Login-skærmens **Fejllog og forbindelsesdetaljer** kan åbnes uden at være logget ind. Den viser tidspunkt, fase, sikker fejlkode, HTTP-status, proxyens URL og den konfigurerede HA-adresse. Den viser aldrig OAuth-koder eller tokens.

Brug **Kopiér fejllog**, når en installation skal fejlfindes. Loggen gælder kun den aktuelle browserfane og kan ryddes fra samme panel.

## 8. Typiske fejl

| Fejl | Betydning | Rettelse |
| --- | --- | --- |
| HTTP 400 | HA afviser reverse proxyen | Ret `trusted_proxies`, gem, genstart og bekræft ændringen |
| HTTP 401 ved token | Tokenet er ugyldigt eller tilbagekaldt | Opret et nyt Long-Lived Access Token |
| HTTP 404/405 | `/ha/` rammer ikke proxyblokken | Ret den aktive Nginx `server`-blok og genindlæs |
| HTTP 502/503/504 | Nginx kan ikke nå HA | Kontrollér HA-IP, port 8123, Docker-netværk og firewall |
| HTTP 200 med HTML | Den statiske Smartdash-rute håndterer `/ha/` | Flyt/ret `location /ha/` i den aktive Nginx-konfiguration |
| Login vender tilbage med fejl | OAuth-kodeudvekslingen fejlede | Åbn den indbyggede fejllog og kontrollér proxytesten |

## 9. Opdatering og backup

Eksportér altid installationsprofilen under **Admin → Backup & gendannelse** før en opdatering. Den indbyggede updater bevarer `data/`, men opdaterer bevidst ikke værtspecifik infrastruktur i `deploy/` eller dokumentation. Læs derfor release-noterne ved ændringer i Nginx eller installation, hent den nye `deploy/`-mappe fra releasen, og kør kontrollen igen.

Efter en opdatering:

```sh
sh deploy/check-install.sh http://SMARTDASH-IP
```

Kontrollér derefter versionsnummeret i Administration og lav en hård genindlæsning i browseren, hvis gamle cachede filer stadig vises.

## 10. Sikkerhed

- Udgiv ikke `/admin/`, `/api/` eller en HA-proxy ubeskyttet på internettet.
- Brug VPN, firewall eller Nginx-adgangskontrol uden for et betroet LAN.
- Del aldrig Long-Lived Access Tokens eller indholdet af browserens lokale lager.
- Gem aldrig `data/config.json`, HA-token eller private installationseksporter i Git.
- Giv kun `trusted_proxies` det mindst mulige nødvendige adresseområde.
