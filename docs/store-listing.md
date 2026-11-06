# Store listing

Text to paste into the Chrome Web Store dashboard, field by field. Edge
Add-ons asks for the same things under slightly different names. Keep this
in step with the extension: a reviewer compares it against what the code
does.

## Name

Try-On for Steam Profiles

(From `manifest.json`. "for Steam" describes what it works with, which store
policies allow; "Steam" stays out of the first word.)

## Summary (132 characters max)

Preview Steam profile backgrounds, avatars, frames, mini profiles and themes before you buy or equip them.

## Category

Fun

## Description

See how your Steam profile would look with a different background, avatar,
avatar frame, mini profile or theme, before you spend Points on it or equip
it.

Found a background you like in the Points Shop? Press Grab on its preview,
switch to a tab with your profile, and it's on your profile, on your screen
only. Then flick through themes to see which colourway suits it. Or grab a
whole look from someone else's profile and try it on your own.

PREVIEW ONLY
Everything happens in your browser. Your real Steam profile is never
changed, nobody else sees the preview, and Clear (or reloading without the
extension) puts your profile back exactly as it was.

WHAT IT DOES
- Grab: fills the panel from the profile or Points Shop preview you're
  looking at. A Game Profile bundle fills every item at once, theme included.
- Apply: shows the grabbed items on your own profile.
- Peek: hold P to see your real profile for a moment, or press O to switch
  back and forth.
- Presets: save looks, apply them with one click or the 1-9 keys, rename,
  reorder, export and import.
- Syncs between your Steam tabs: grab in the Points Shop, see it on your
  profile tab straight away.
- The toolbar button shows or hides the panel.

PRIVATE BY DESIGN
No analytics, no tracking, no accounts, no servers. Your presets stay in
your browser. The only requests go to Steam itself, to read item details
from the pages you're previewing.

Free and open source: https://github.com/brunosuzano/try-on-for-steam-profiles

Not affiliated with Valve. Steam is a trademark of Valve Corporation.

## Single purpose

Preview Steam profile cosmetics (backgrounds, avatars, avatar frames, mini
profiles and themes) on Steam's own pages before buying or equipping them.

## Permission justifications

**storage**: Saves the user's presets, settings and the look they're trying
on, locally, so they survive reloads and stay the same across their open
Steam tabs. Nothing stored leaves the browser.

**Host permission `https://steamcommunity.com/*`**: The preview panel runs on
Steam Community profile pages, where it shows the previewed items. It also
reads item details from steamcommunity.com, such as the user's mini profile
and the preview page of a Game Profile bundle.

**Host permission `https://store.steampowered.com/*`**: The panel runs on the
Steam Points Shop (`/points/` pages), where users grab items from their
previews. It also looks up a game's name on store.steampowered.com to label
a theme.

**Remote code**: No. All code ships in the package; nothing is downloaded or
evaluated at runtime.

## Data usage

Collects none of the listed data types. Certify all three statements: data
is not sold, not used for unrelated purposes, and not used for
creditworthiness or lending.

## Privacy policy URL

https://github.com/brunosuzano/try-on-for-steam-profiles/blob/main/PRIVACY.md

## Screenshots (1280×800, up to 5)

Take at 1280×800 (browser zoom or window size), panel visible, no personal
details on screen: use a profile that's fine to show, or crop.

1. Your profile with a grabbed background and theme applied, panel open.
2. The Points Shop with an item preview open and the panel docked over it.
3. The same profile, Peek held: the before view, for comparison.
4. The preset list with a few looks saved, one marked applied.
5. A Game Profile bundle grabbed into all five rows.

## Small promo tile (440×280, optional)

The icon on the panel's dark blue, with the name. Optional for submission.
