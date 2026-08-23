# Docker Compose installation

HA Smartdash publishes one multi-architecture image for `amd64` and `arm64`.
Application files come from the image; configuration, layouts, PIN settings,
local profiles and backups remain in `/data`.

Stable installations use the `latest` tag. Track pre-release builds instead
with `beta`, or a moving `edge` tag built from every push to `main`.

## 1. Create the project directory

Download `docker-compose.yml` and `.env.example` from the repository. Rename
`.env.example` to `.env` and select any unused host port:

```env
SMARTDASH_PORT=8099
```

Edit `HA_URL` in `docker-compose.yml`. It must be reachable from inside the
container, for example `http://192.168.1.10:8123` or a Docker network alias.

## 2. Start and verify

```sh
docker compose up -d
docker compose ps
```

Open `http://SERVER:SMARTDASH_PORT`. The internal port remains 8099 so the
image, healthcheck and Home Assistant App use the same runtime contract.

Check health and logs:

```sh
docker compose exec ha-smartdash curl -fsS http://127.0.0.1:8099/healthz
docker compose logs --tail=100 ha-smartdash
```

## 3. First login

Open Administration and sign in with Home Assistant OAuth or a Long-Lived
Access Token. The token is stored only in that browser. The `/ha/` reverse
proxy keeps Home Assistant calls same-origin.

If Home Assistant rejects the proxy with HTTP 400, add the immediate Docker
proxy address or the smallest correct Docker subnet to Home Assistant's
`http.trusted_proxies`; never trust a broader network than necessary.

## 4. Update and roll back

```sh
docker compose pull
docker compose up -d
```

Pin a version for controlled upgrades:

```yaml
image: ghcr.io/mrdonnii/ha-smartdash:0.8.0
```

To roll back, replace the tag with an earlier release and recreate the
container. Never delete the `/data` volume during an image update.

## 5. Migrate an existing web-server installation

Stop writes to the old dashboard, then copy the contents of its `data/`
directory into `./smartdash-data/` before starting the container. Do not copy
old application JS, CSS, PHP or HTML files into `/data`.

For Unraid use [UNRAID.md](UNRAID.md). For Home Assistant OS/Supervised use
[HOME_ASSISTANT.md](HOME_ASSISTANT.md).
