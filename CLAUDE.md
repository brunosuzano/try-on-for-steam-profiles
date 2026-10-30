# Try-On for Steam Profiles

A Tampermonkey userscript that previews Steam profile cosmetics — background,
avatar frame, avatar, mini profile, theme — **without owning or equipping
them**. Built to answer "which theme's colourway suits this background?"
before spending Points.

Release name: **Try-On for Steam Profiles**, which is also the script's
`@name`. Not affiliated with Valve.

## Layout

- `try-on-for-steam-profiles.user.js` — the entire app. One file, no build step,
  no dependencies. Everything ships in it.
- `docs/steam-dom-notes.md` — hard-won findings about Steam's DOM and CSS.
  **Read this before changing any selector or geometry.** Every rule in it cost
  several wrong attempts.
- `ROADMAP.md` — what's left to do, and why in that order.
- `fixtures/` — real HTML dumps from Steam pages, used to verify detection
  logic without a browser. `fixtures/README.md` catalogues them. Raw dumps go
  in `fixtures/raw/` and **must never be committed**: full-page captures
  contain the logged-in account's `webapi_token`, session ID, login name and
  SteamID, plus other users' names and SteamIDs. `tools/sanitize-fixtures.js`
  writes placeholder-only copies to `fixtures/clean/`, which is what's
  committed and what tests should read.
- `tools/sanitize-fixtures.js` — raw → clean fixtures. Refuses to write a file
  if anything personal survives; extend its rules, never hand-edit around it.
- `archive/steam-bg-swapper.user.js` — the superseded background-only version.
  Kept for reference; do not edit.

## Architecture in one paragraph

Everything is a **slot**: an object declaring `find`, `snapshot`, `capture`,
`apply`, `verify`, `restore`, `peekOut`, `peekIn`. `SLOTS` holds five of them.
All the machinery — grab, apply, clear, peek, presets, auto-reapply, cross-tab
sync, undo, erase — loops over `SLOTS` and knows nothing about what a
"background" is. Adding a sixth slot is a declaration, not a subsystem. A
**preset** is `{name, slots: {...}}` holding any subset, which is what lets one
preset be a whole look and another be a single background. Storage goes through
a shim (`store.get/set/subscribe`) that wraps `GM_*`, `chrome.storage.local`
and `localStorage`, so the eventual extension port is a backend swap.

## Rules that matter

**Verify patches against the file, not against the patch script.** A failed
assertion in a multi-edit script discards every edit in that batch. After
editing, grep the file for the changed strings and confirm they landed. This
has caused a wasted release once already.

**Measure before changing detection.** Steam's class names are private
implementation detail. When something detects wrongly, get a real HTML dump or
the in-app diagnostics (Advanced → Copy sizing diagnostics, or press **D** on
the Points Shop) and read what's actually there. Guessing at markup has cost
more rounds in this project than anything else.

**Detection is layered on purpose.** Each slot tries several `strategies` in
order and logs which matched. Keep that shape when adding selectors — a Steam
rename should break one strategy, not the feature.

**Fail loudly.** Silent no-ops are the worst outcome: the user sees nothing and
assumes the tool is broken. Apply paths verify their own result and write a
status message. Keep that.

**No telemetry, ever.** No analytics, no servers, no data collection. It's a
stated selling point in a niche where extensions are rightly distrusted, and it
keeps the privacy policy to six lines. The only network requests go to Steam
(`steamcommunity.com`, `store.steampowered.com`) to read item details; adding
any other host means rewriting the privacy policy, so don't.

## Testing

No test suite. The gates are:

```bash
node --check try-on-for-steam-profiles.user.js   # syntax, always run this
```

Node isn't installed on the dev machine. VS Code's bundled Node does the same
job (exit code 0 = OK; `Start-Process -Wait -PassThru` is needed to read it,
since Code.exe is a GUI binary):

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& "C:\Program Files\Microsoft VS Code\Code.exe" --check try-on-for-steam-profiles.user.js
```

...then install in Tampermonkey and exercise it manually. Detection logic can
be checked against `fixtures/clean/` with a throwaway Python/Node script rather than
a browser — that's how the slot-type rules were validated.

## Versioning

**Never change `@name` or `@namespace`.** Tampermonkey and Greasy Fork key a
script by those two, so changing either installs it as a *separate script with
empty storage*: two panels on screen, presets gone, and existing users stop
getting updates. `@name` was fixed in 1.43; `@namespace` was moved to the
renamed repo's URL in 1.46, before any public release. Both are final now.
If the repo is ever renamed again, `@namespace` stays: it's an identifier,
not a link.

Updates come from `@downloadURL`/`@updateURL` (the raw file on GitHub's
`main`), so **pushing to `main` with a higher `@version` is a release**: every
install picks it up. Don't rename or move the script file, or installs stop
updating. Presets and settings live in Tampermonkey's storage under the
`pp*` keys and survive updates; renaming those keys, or changing the stored
shapes without migrating old ones, would silently lose everyone's data.

A release bumps `@version` **and** `SCRIPT_VERSION` together. The constant is
what lets a newer panel replace an older one when two copies are installed.
