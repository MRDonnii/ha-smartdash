# Contributing

Thanks for helping improve HA Smartdash.

All releases must follow the authoritative [release standard](RELEASES.md).

1. Fork the project and use a focused branch.
2. Keep personal `data/config.json`, tokens, addresses and private screenshots out of commits.
3. Test both `/` and `/admin/` at wide, narrow and portrait viewport sizes.
4. Run `scripts/check-release.sh` before opening a pull request.
5. Explain the Home Assistant integration or device model used for integration-specific changes.

Small, readable changes are preferred. New pages should remain optional, tolerate missing entities and avoid polling Home Assistant more often than necessary.
