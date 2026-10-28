# Fixtures

Real HTML captured from Steam, used to verify detection logic without a
browser. Every rule in `docs/steam-dom-notes.md` was derived from or checked
against these. When a selector changes, test it here first — it takes seconds
and catches the wrong-element bugs that are slow to spot by clicking round
Steam.

Captured October 2026. If Steam redesigns, these become the "before" and new
dumps are needed.

## Raw and clean

- `raw/`: dumps exactly as saved from the browser. **Gitignored.** They hold
  the logged-in account's `webapi_token`, session ID, login name and
  SteamID, plus other users' names, SteamIDs, real names and comments.
- `clean/`: the same files with all of that replaced by placeholders
  (`User 1`, `user-1`, fake SteamIDs, `REDACTED.TOKEN.VALUE`). Committed. Use
  these for testing; the tables below refer to them.

To add a dump: save it into `raw/`, then run

```bash
node tools/sanitize-fixtures.js
```

The same person gets the same placeholder in every file, so owner/visitor
comparisons still work. If anything personal survives, the script refuses
to write that file and says what's left. Extend its rules rather than
committing by hand. Avatar images and item URLs are kept: detection needs
them, and they're public assets.

## Points Shop — isolated modal fragments

Small, fast to parse, best for testing item-type detection and asset
extraction. Each is the preview modal's outer HTML only.

| File | What it previews | Notes |
|---|---|---|
| `shop-modal-avatar.html` | Animated Avatar | item is a `.gif`, carries `.avatar` |
| `shop-modal-avatar-2.html` | Animated Avatar | second sample |
| `shop-modal-avatar-frame.html` | Avatar Frame | owned item ("Equip Now" state) |
| `shop-modal-avatar-frame-2.html` | Avatar Frame | second sample |
| `shop-modal-background-static.html` | Profile Background | **CSS `background-image`, no `<img>`** |
| `shop-modal-background-animated.html` | Profile Background | `<video>` with webm + mp4 |
| `shop-modal-mini-profile.html` | Mini-Profile Background | `.miniprofile_backdropblur` present |
| `shop-modal-mini-profile-2.html` | Mini-Profile Background | second sample |

The viewer's own equipped frame (`items/978460/…png`) appears in most of these
— useful for checking that extraction picks the *item*, not the viewer's gear.

## Points Shop — whole pages with a dialog open

Bigger, but include the `<dialog>`, the top-layer overlay and the surrounding
page. Use these for anything about the panel docking or modal behaviour.

| File | What's open |
|---|---|
| `shop-page-background-static.html` | static background |
| `shop-page-background-animated.html` | animated background |
| `shop-page-avatar-animated.html` | animated avatar |
| `shop-page-avatar-frame.html` | avatar frame |
| `shop-page-game-profile-bundle.html` | **Game Profile bundle** — contains the cross-origin `<iframe>` and the item list |

## Profile pages

| File | Theme on `<body>` | Why it matters |
|---|---|---|
| `profile-own-game-theme.html` | `GameProfile_534380_54_Theme` | purchased theme, appid in the class |
| `profile-own-special-profile.html` | bare `GameProfileTheme` | Special Profile — transparent gradients, **no appid anywhere** |
| `profile-builtin-summer-theme.html` | `SummerTheme` | built-in, colours from Steam's stylesheet; also contains the theme picker listing all built-ins |
| `profile-other-purple-theme.html` | `PurpleTheme` | built-in with real hex colours |
| `profile-preview-game-theme.html` | `GameProfile_953490_27_Theme` | `?previewprofile=1` page — the nested `.no_header` case, plus golden theme classes |

## Diagnostics

JSON from the panel's "Copy sizing diagnostics". Shows what the script
*actually saw*, which is the quickest way to tell a detection failure from an
extraction failure.

| File | Profile |
|---|---|
| `diag-profile-special-profile.json` | Special Profile, all gradients transparent |
| `diag-profile-purple-theme.json` | built-in Purple, real hex colours |
| `diag-profile-steamdeck-theme.json` | built-in Steam Deck, `rgb(… / …%)` syntax |

## How these get used

Parse with any throwaway script — no framework needed. Example: confirm the
structural slot-type rules still classify all five modal fragments correctly.

```python
import re, glob
for f in sorted(glob.glob('fixtures/clean/shop-modal-*.html')):
    h = open(f, encoding='utf-8', errors='ignore').read()
    mini = 'miniprofile' in h
    appid = re.search(r'/points/shop/app/(\d+)', h)
    appid = appid.group(1) if appid else None
    tagged = re.findall(r'class="[^"]*\bavatar\b[^"]*"[^>]*src="[^"]*items/(\d+)/', h)
    has_avatar_img = bool(re.search(r'class="[^"]*\bavatar\b', h))
    in_scope = [e for a, e in
                re.findall(r'items/(\d+)/[a-f0-9]+\.(\w+)', h) if a == appid]
    slot = ('miniProfile' if mini else
            'avatar' if appid in tagged else
            'avatarFrame' if has_avatar_img and in_scope else
            'background')
    print(f'{f:48} -> {slot}')
```

Expected: the two avatar files give `avatar`, the two frame files
`avatarFrame`, both background files `background`, both mini profile files
`miniProfile`.
