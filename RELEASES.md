# HA Smartdash release standard

This file is the authoritative release contract for HA Smartdash. Every human,
automation, and coding agent must follow it. If another document, an old
release, or an existing UI string uses a different format, this file wins.

## Canonical names

| Item | Stable | Beta |
| --- | --- | --- |
| Git tag | `v0.8.0` | `v0.8.1` |
| GitHub release title | `HA Smartdash v0.8.0` | `HA Smartdash v0.8.1 Beta` |
| GitHub pre-release flag | Off | On |
| Dashboard product/version | `HA Smartdash v0.8.0` | `HA Smartdash v0.8.1` with a localized Beta badge |

The project name is always **HA Smartdash**. Never publish releases as
`HA dashboard`, `V0.8.0`, `v0.8.0` alone, `V0.8.0 Beta`, or
`HA Smartdash v0.8.0 (Beta)`.

Rules:

- Use a lowercase `v` immediately before the semantic version.
- Use three numeric components: `vMAJOR.MINOR.PATCH`.
- Put `Beta` at the end of a Beta release title without parentheses.
- A Beta release must be marked as a GitHub pre-release.
- A Stable release must not be marked as a GitHub pre-release.
- Never reuse, move, or overwrite a published tag.
- Stable and Beta use the same monotonically increasing version sequence.

## Version metadata

Every release must update all of these values in the same commit:

1. `index.html`: `beast-build` and `beast-release-tag`.
2. `beast.html`: `beast-build` and `beast-release-tag`.
3. The first entry in `changelog.json`: `version`, `tag`, `date`, and
   `changes`.
4. Every changed browser-loaded CSS or JavaScript file must receive a new
   query-string cache ID in both HTML entry points that load it. Prefer the
   release build ID, for example `?v=20260811-148`.

`beast-release-tag` and `changelog.json.tag` must equal the Git tag exactly.
The two HTML files must contain identical release tags and build IDs.

The build ID format is `YYYYMMDD-N`, for example `20260811-142`. Increment
`N` for every build made on the same date. Never decrease or reuse a build ID.

## Changelog contract

`changelog.json` is shown inside the dashboard and is therefore bilingual.
The newest release is always the first array entry.

```json
{
  "version": "20260811-142",
  "tag": "v0.8.1",
  "date": "2026-08-11",
  "changes": [
    {
      "da": "Kort og konkret dansk ændringstekst.",
      "en": "Short and concrete English change text."
    }
  ]
}
```

Each change must:

- contain non-empty `da` and `en` strings;
- describe a user-visible result, migration, or important fix;
- avoid private names, addresses, entity IDs, tokens, and installation data;
- use the dashboard language selection when rendered.

## GitHub language and release notes

Everything published on GitHub must be English: commit messages, pull request
titles and descriptions, release titles, release notes, issue text, and the
primary documentation. Danish belongs in dashboard translations,
`changelog.json.da`, and explicitly Danish documentation such as
`README.da.md`.

Release notes should use this structure:

```markdown
## Highlights

- Describe the most important user-visible result.

## Changes

- Describe other changes and migrations.

## Update channel

This is a Beta release. Stable remains on v0.8.0.
```

For a Stable release, the last sentence is instead:

```text
This is a Stable release.
```

Do not put `Beta` in the Git tag. The GitHub pre-release flag and canonical
release title identify the channel.

## Release procedure

1. Choose the next unused semantic version and build ID.
2. Update both HTML files and prepend the bilingual changelog entry.
3. Update cache IDs for every changed browser-loaded CSS and JavaScript asset.
4. Run `scripts/check-release.sh` and fix every failure.
5. Commit with an English message and push the intended commit.
6. Create the Git tag from that exact commit.
7. Create the GitHub release using the canonical title and English notes.
8. Set the GitHub pre-release flag according to the selected channel.
9. Verify the published tag, title, pre-release flag, target commit, and
   release notes.
10. Verify that Stable discovery returns the newest non-pre-release and Beta
   discovery returns the newest release including pre-releases.

Example commands:

```sh
# Beta
gh release create v0.8.1 --target main --title "HA Smartdash v0.8.1 Beta" --prerelease --notes-file release-notes.md

# Stable
gh release create v0.8.2 --target main --title "HA Smartdash v0.8.2" --notes-file release-notes.md
```

Never publish until the release check passes.
