# SMB backup setup

HA Smartdash uses server-mounted SMB shares. The dashboard never receives or stores the SMB password.

## Required mapping

Mount each writable share below:

```text
/config/backup-targets/<name>
```

Example:

```text
//nas/Smartdash  →  /config/backup-targets/nas
```

After mounting it, reopen **Admin → Backup & restore**. The share appears automatically in the backup destination list.

## Linux example

Install CIFS support and create a credentials file readable only by root:

```text
/etc/ha-smartdash-smb.credentials
username=YOUR_USER
password=YOUR_PASSWORD
```

Example `/etc/fstab` entry:

```fstab
//NAS_HOST/Smartdash /config/backup-targets/nas cifs credentials=/etc/ha-smartdash-smb.credentials,uid=WEB_UID,gid=WEB_GID,file_mode=0660,dir_mode=0770,vers=3.0,_netdev,nofail 0 0
```

Replace the host, share, UID and GID. Then create the mountpoint and mount it using your operating system's normal administration tools.

## Docker or Unraid

Mount the SMB share on the Docker host first. Add that host directory to the HA Smartdash/nginx container as a read-write path below `/config/backup-targets/<name>`.

Example mapping:

```text
Host:      /mnt/remotes/nas_smartdash
Container: /config/backup-targets/nas
Mode:      read/write
```

## Verification

The PHP/web-server user must be able to create and read files in the mounted directory. HA Smartdash only lists writable mountpoints and never exposes their server filesystem paths through the API.

Backups can be created, listed and downloaded from the admin panel. Treat downloaded profiles as private because they may contain entity IDs and household structure.
