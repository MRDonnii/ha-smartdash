# Unraid installation

HA Smartdash ships with an Unraid Docker template at
`unraid/ha-smartdash.xml`. It uses the same image as Docker Compose and keeps
all user data in the Unraid appdata share.

The template follows the `latest` image channel. To track pre-release builds
instead, edit the repository field to `ghcr.io/mrdonnii/ha-smartdash:beta`.

## Install

1. Open **Docker → Add Container** in Unraid.
2. Switch to Advanced View and load the template URL:
   `https://raw.githubusercontent.com/MRDonnii/ha-smartdash/main/unraid/ha-smartdash.xml`
3. Choose any unused **Web UI port**.
4. Keep `/mnt/user/appdata/ha-smartdash` or choose another persistent appdata
   path for container path `/data`.
5. Enter a Home Assistant URL reachable from the container.
6. Apply the template and wait for the health status to become healthy.

The host port is freely selectable. Container port 8099 must remain unchanged.

## First login and Home Assistant proxy

Open the Web UI from Unraid and connect a Home Assistant user. If Home
Assistant reports an untrusted reverse proxy, inspect the Home Assistant log
for the exact source address and add only that address or the smallest correct
Docker network to `http.trusted_proxies`.

## Update

Use **Check for Updates** and **Apply Update** on the Unraid Docker page. The
container is replaced; `/mnt/user/appdata/ha-smartdash` is retained. The
dashboard's internal update banner links the user back to the platform update
flow and never rewrites a running container.

## Backup and migration

Back up the mapped appdata directory. To migrate an existing installation,
copy only the contents of its `data/` directory into the mapped appdata path.
