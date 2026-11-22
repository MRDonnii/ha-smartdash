# Security policy

HA Smartdash is intended for a trusted private network. Its PHP configuration endpoints rely on the surrounding web server and network for access control; they do not implement a separate administrator account.

## Safe deployment

- Keep Home Assistant tokens out of source files and Git history.
- Use the Home Assistant authentication flow in the browser.
- Serve the dashboard and `/ha/` proxy from the same trusted HTTPS origin.
- Restrict `/admin/` and `/api/` at the reverse proxy, VPN or firewall layer.
- Do not expose the sample nginx server unchanged to the public internet.
- Keep PHP and the web server updated and back up `data/config.json`.
- Treat exported profiles as private: they can contain entity IDs and household structure.
- Keep safety-critical automations in Home Assistant and fail them safely there.

## Reporting a vulnerability

Open a GitHub security advisory for the repository rather than a public issue. Do not include real access tokens, cookies, addresses, camera images or private configuration in a report.
