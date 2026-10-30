# Steam DOM and CSS findings

Everything here was established by measuring real pages, usually after a wrong
guess. None of it is documented by Valve and all of it can be renamed by a
redesign. Treat it as findings, not API.

---

## Profile background

**Two nested `.no_header` elements exist on preview pages.** The outer one is a
plain page-frame wrapper; the inner one is the themed element. Always take the
innermost — the one that does *not* contain another `.no_header` and *does*
contain `.profile_header_bg`. Grabbing the outer one edits the wrong element
with no error.

**Strip the theme classes, then put the sizing back.** Applying works by
reducing the class list to `no_header profile_page has_profile_background`;
theme-specific classes like `golden_profile` and `full_width_background`
trigger broken sizing. But those classes also carry `background-size: 100%`,
so stripping them makes the image render at natural size. Capture the computed
`background-size`/`position`/`attachment` *before* stripping and re-apply them
explicitly. Force `no-repeat` regardless — a tiled profile background is never
right.

**Video geometry, measured from a live themed page:**

| | Steam's own | What we do |
|---|---|---|
| wrapper | `absolute`, 100% × 100% of the themed element, `overflow: hidden` | same |
| video | **natural size** (e.g. 1920×1080), `top: 0`, `left: 50%`, `translateX(-50%)`, `object-fit: contain` | same |

The early attempt that blew the video up stretched the *video* to 100% of a
3229px-tall container. Steam stretches the *wrapper* and leaves the video
alone. That distinction is the whole fix. A `fixed`, viewport-sized video also
works visually but doesn't scroll with the page the way Steam's does.

A `position: fixed` element with no `z-index` paints **above** static in-flow
content regardless of DOM order. `z-index: -1` puts it behind page content but
above the element's own background.

---

## Avatars and frames

**They are `<picture>` elements, not plain `<img>`.** A matching `<source>`
beats the `<img>`, so setting `img.src` alone changes nothing visible. Every
`srcset` has to be overridden too — and the avatar's `<img>` often carries only
`srcset` with **no `src` at all**, so a src-only swap fails twice over.

**Scope lookups to `.profile_header`.** The viewer's own avatar and frame
appear in the global header bar, the comment box and the responsive menu on
every profile. An unscoped `document.querySelector('.profile_avatar_frame')`
returns *yours*, which silently fills the slot on profiles that have no frame.

**Swap every copy by URL identity, not by location.** Steam serves one avatar
at several sizes — `name.jpg`, `name_medium.jpg`, `name_full.jpg`. Strip the
suffix and extension and what remains identifies the asset. Match that across
every `<img>` on the page and you update the owner's avatar everywhere while
leaving other people's comment avatars alone. No extra selectors to break.
Exclude `#pp-panel` or the script rewrites its own thumbnails.

**A missing frame is created, not refused.** `div.profile_avatar_frame` with an
`<img>`, inserted as the first child of `.playerAvatarAutoSizeInner`; Steam's
own CSS positions it. Restore removes it rather than restoring attributes.

---

## Whose profile is it

Measured on the five profile fixtures (three own, two other people's). All
three signals agree on every one:

| Signal | Where | Own | Other |
|---|---|---|---|
| `const g_bViewingOwnProfile = 1;` | inline `<script>`, right after `g_rgProfileData` | `1` | `0` |
| viewer `steamid` vs `g_rgProfileData.steamid` | viewer: `#application_config[data-userinfo]` JSON (or `g_steamID = "…"`) | equal | differ |
| viewer `accountid` vs header avatar `data-miniprofile` | `.playerAvatar.profile_header_size[data-miniprofile]` | equal | differ |

The userscript is sandboxed, so it can't read `window.g_bViewingOwnProfile`;
it regexes the inline script text instead. Also present only on your own
profile: an `a.btn_profile_action[href$="/edit/info"]`, which is a positive
signal only and isn't used.

**These markers can arrive after boot.** On a `?previewprofile=1` page the
outer `.no_header` (the page frame) parses before any of them, so a check made
the moment the panel boots can come back undecided. An undecided result waits
for `DOMContentLoaded`, and if it's still undecided it fails *open*: a Steam
rename shouldn't lock people out of their own profile.

---

## Mini profile

Built on hover and **destroyed and rebuilt on every hover**, so "apply once"
doesn't work — a `MutationObserver` has to repaint it each time it appears.
It also shows whichever user was hovered, so the painter compares the last
hovered `data-miniprofile` id against the profile owner's before touching
anything.

**`verify()` must be symmetric with what `apply()` writes**, or you get an
infinite repaint loop: the check says "not applied", the painter repaints, the
repaint wakes the observer, forever. The original bug compared only the first
`<source>` (webm, appended first) against the preferred URL (mp4). Check
whether *any* source matches *either* URL.

Capture it only once per container, or a repaint saves your own markup as "the
original" and permanently breaks Clear.

Nameplates carry **no poster attribute**, so a thumbnail has to pull a frame
out of the clip itself.

---

## Themes

Three different mechanisms, all on `<body>`:

| Kind | Class | Colours from | Identifiable? |
|---|---|---|---|
| Built-in (Summer, Purple, Dark Mode, Steam Deck…) | `<Name>Theme` | Steam's stylesheet | name only, no game |
| Purchased game theme | `GameProfile_<appid>_<item>_Theme` | inline `<style>` block | yes — appid is in the class |
| **Special Profile** (bundle) | bare `GameProfileTheme` | inline vars, gradients often transparent | **no** — nothing in the page names the game |

Prefer the specific class when both are present; taking the first match loses
the appid. Do **not** guess the appid from other equipped items — someone can
wear a background from one game and a theme from another, and naming the wrong
game sends people hunting for an item that doesn't exist.

A real theme can have fully transparent gradients (Special Profiles do), so
"all transparent means no theme" is not a safe test.

Applying = swap the body class + set the ten `--gradient-*` / `--color-*` /
`--btn-*` custom properties. Every profile page loads the same stylesheets, so
a class captured anywhere resolves anywhere.

---

## Points Shop

**It's a different origin** (`store.steampowered.com`), so the script needs its
own `@match`, and the panel there is capture-only — there's no profile to
modify. Grabs are staged into the shared applied-state key, which profile tabs
pick up through the existing cross-tab sync.

**The dialog is a `<dialog>` opened with `showModal()`**, which puts it and its
full-viewport `.ModalPosition` child in the browser's **top layer**. No
`z-index` can beat that — not `2147483646`, not a popover. The fix is to
reparent the panel *into* the dialog: anything inside renders in the top layer
too, and clicks there count as inside the modal so the preview stops dismissing
itself. Re-dock on a `MutationObserver`, not a poll, or the panel blinks out
when Steam removes the dialog with the panel inside it. Never measure the panel
to reposition it after docking — at that moment it's detached and every
measurement reads zero.

**Item type detection must be structural, not textual.** Reading the modal's
prose works only in English. Steam keeps a few semantic class names amid the
hashed ones:

- `[class*="miniprofile"]` present → mini profile
- the previewed media itself carries `.avatar` → avatar
- an `img.avatar` is present but the item is a different image → avatar frame
- otherwise → background

Verified against five real dumps. Also works for items the user already owns,
since it never reads purchase text.

**Static backgrounds are a CSS `background-image` on a div**, not an `<img>` —
they grab as nothing if you only look for img/video. **Pick the largest
candidate**, not the first in document order, or you grab the viewer's own
equipped frame instead of the item.

**The viewer's own equipped items are in every preview modal** (e.g. their
frame, `items/978460/…`). Anything that counts items must scope to the
modal's app link (`/points/shop/app/<appid>` → `/items/<appid>/`). An
unscoped bundle check counted the viewer's frame as a second piece and filed a
single mini profile as a "bundle" of background + avatar. Real bundle pieces
all share the bundle's appid, so bundle detection never falls back to
unscoped.

**Steam emits broken `<source>` elements**: a video can carry
`src=".../items/<appid>/undefined"` beside the real `.webm`. Seen on Debut
Collection mini profiles, October 2026. Accept item URLs only if they end in a
file extension.

**Game Profile bundles embed the real preview in a cross-origin `<iframe>`**
(`?previewprofile=1&appid=…&itemtype=…`). The dialog itself only has the item
list, whose background thumbnail is a `?size=320x200` crop. Fetch the iframe's
URL with `GM_xmlhttpRequest`, parse with `DOMParser`, and you get full-size
assets *and* the theme. The mini profile isn't rendered on a profile page, so
it comes from the dialog's item list, identified by elimination against the
assets the fetched page supplied — no English labels involved.

**The script must not run inside that iframe** (`@noframes`). It's a
steamcommunity.com page, so `@match` covers it, and a copy running in there
picks up the staged try-on through cross-tab sync and paints it over the very
profile being inspected. The grab fetches the iframe's URL itself and never
needed a copy inside.

---

## Storage

`GM_*` and `chrome.storage.local` are shared across every site the script runs
on; `localStorage` is per-origin and would break store↔community sync. Keep
the shim's fallback order as it is.

`GM_addValueChangeListener` needs its own `@grant`, and reports whether a
change came from another tab — that's what drives cross-tab sync.

---

## Things ruled out, so nobody retries them

- No shadow DOM, no iframe (on profile pages), no React re-render fight. Once
  the correct element is targeted, plain DOM edits stick permanently.
- Canvas capture for video thumbnails taints on Steam's CDN and throws. Use a
  `<video>` seeking to `0.1s` instead — and set `currentTime` explicitly on
  `loadedmetadata`, because the `#t=0.1` fragment alone is unreliable.
- Blocking Steam's modal-dismiss listener by stopping propagation: capture
  phase kills your own buttons, bubble phase never reaches their handler.
  Reparenting is the answer.
