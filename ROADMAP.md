# Roadmap

Current version: **1.46** (userscript, five slots, feature-complete for
Tampermonkey).

---

## Now — real use

Nothing on the feature list is outstanding. What's missing is a week of
actually browsing the Points Shop with it and noting anything that causes a
hesitation or a second click. That list is worth more than any feature
proposed from the outside, and it should land **before** the port, which locks
in decisions that are annoying to revisit.

Also worth a deliberate regression pass, since fixes were verified
individually but never end-to-end:

- [x] Grab each of the five item types from the Points Shop
- [x] Grab a whole Game Profile bundle (should fill 5 slots in one press)
- [x] Grab from a user profile, and from a frameless profile (should stay empty)
- [x] Apply → Peek → Clear on both a static and an animated theme
- [x] Presets: save, apply, rename, drag-reorder, number keys
- [x] Export → Delete all → Import (should round-trip)
- [x] Cross-tab sync, both directions, store ↔ profile
- [x] Erase everything → reload → undo

### Regression pass findings (October 2026), to fix before the port

Decisions already made with the owner. Work through them in this order.

1. [ ] **Bug: store Apply repaints the bundle preview.** A Game Profile
       bundle's preview is a steamcommunity.com page in an `<iframe>`, and the
       script runs inside it, so Apply on the store paints your try-on over the
       profile you're inspecting. Fix: add `@noframes`. The bundle grab
       fetches the iframe's URL itself and doesn't need the script running in
       there.
2. [ ] **Apply only on your own profile.** On anyone else's profile the
       panel is grab-only, and says so ("Not your profile: grab only").
       Detect the viewer against the profile owner; measure how in
       `fixtures/clean/` (own vs other profiles) before relying on a marker.
       Optional Advanced setting "Apply on every profile", off by default.
3. [ ] **Allow duplicate presets.** Remove the "Already saved as X" block
       entirely; users delete extras by hand. Keep import dedupe (that's
       about not doubling a whole file).
4. [ ] **Shared draft across tabs.** Grabbed-but-unapplied slot values
       become one draft in storage that every tab shows and updates, like
       presets. One draft, last write wins.
5. [ ] **Bigger ✕ hit area** on slot rows, with clear space between it and
       Grab; clicking near it currently expands the row instead.
6. [ ] **O key: latched peek.** Toggles between the try-on and the page's
       own look and stays put; P stays press-and-hold; Clear stays
       button-only. The owner isn't sure about this one. Ship it and see;
       the alternative on the table was C for Clear.
7. [ ] **Tiled backgrounds render too zoomed in.** A newer background type.
       Grab works; display doesn't. Likely cause: the apply path forces
       `no-repeat` and a full-width `background-size`, while Steam tiles at
       natural size. **Measure first:** ask the owner for the Points Shop
       **D** output with a tiled background's preview open, and a saved HTML
       page of a profile with one equipped (into `fixtures/raw/`, then run
       the sanitiser). Don't guess at the markup.

---

## Before any public release

- [x] **Confirm the name.** Settled on *Try-On for Steam Profiles*, tagline
      "Preview backgrounds, avatars, frames and themes before you buy".
      Checked October 2026 on AMO, Chrome Web Store, Greasy Fork and Edge
      Add-ons: no collision. Nearest neighbour is "Colorify - Steam
      Profiles" (Greasy Fork, ~14 installs), which recolours Steam to match
      a profile's theme. Not a name clash, but adjacent to the
      colourway-match idea below.
      Avoid "Preview", "Modifier", "Customizer", "Changer": all taken by
      tools in this space (Steam Profile Modifier, SteamProfilePreviewer,
      Steam Profile Changer). Keep "Steam" out of the first word.
- [x] **Pick the icon.** `icons/n-panel.svg` (avatar, accent picks,
      colourway strip; redrawn from a Gemini concept) is the master for 32px
      and up; `icons/n-panel-16.svg` is a pixel-aligned 16px variant without
      the accent circles. PNG exports: `icon-16/32/48/128.png`, plus
      `store-icon-128.png` (96px artwork in 16px transparent padding, per
      Chrome Web Store guidance).
- [x] **Revert `@name` to a stable string.** Done in 1.43: `@name` is
      "Try-On for Steam Profiles" and `@namespace` is the GitHub repo URL.
      Neither changes again; see "Versioning" in CLAUDE.md.

---

## Stage 2 — the extension port

Small, because everything site-specific is behind the slot registry and the
storage shim.

- [ ] MV3 skeleton: `manifest.json`, `storage` permission, the two host
      matches, icons at 16/48/128
- [ ] Swap the storage shim's backend to `chrome.storage.local` (async —
      already accounted for; call sites await)
- [ ] Toolbar icon toggles the panel. **Keep the in-page panel** — a popup
      closes the moment you click the page, which destroys the
      flick-between-presets workflow this is built around.
- [ ] "Report broken" button: prefilled GitHub issue carrying the page URL,
      which detection strategy matched, and the diagnostics payload. This is
      the no-telemetry substitute for knowing when Steam changes their markup.
- [ ] Firefox variant: namespace shim + manifest tweak, same file.

Chromium stores (Edge, Brave, Opera, Vivaldi) take the same zip.
Safari is out of scope — needs a Mac, Xcode, and $99/year.

---

## Stage 3 — publishing

- [x] Repo, licence, README
- [ ] **Make the repo public.** `@downloadURL`/`@updateURL` point at the raw
      file on `main`, which 404s while the repo is private, so until then
      installs can't update themselves (install by pasting the file instead).
      Going public is what turns updates on.
- [ ] Privacy policy on GitHub Pages. Six lines: collects nothing, no
      analytics, no servers, presets and URLs stored locally. Network
      requests go to Steam only (`steamcommunity.com`,
      `store.steampowered.com`) to read item details from the pages being
      previewed; the mini profile lookup carries the user's own Steam
      cookies, exactly as Steam's own page would. Nothing is sent anywhere
      else. Stays six lines as long as the no-telemetry rule in CLAUDE.md
      holds.
- [ ] Listing assets: 128px icon, 1280×800 screenshots, description,
      single-purpose statement, per-permission justifications
- [ ] Submit: Chrome ($5 one-time, covers all future extensions), AMO (free),
      Edge (free)
- [ ] Optionally Greasy Fork for the userscript itself. Free, no review queue,
      has a donation-link field. Publishing there doesn't expose anything
      publishing an extension wouldn't — both ship readable JS, and both
      stores ban obfuscation.

Donations are fine on both stores. Firefox has a built-in Contributions URL
field; Chrome has none, so link from the options page. **Never add affiliate
or referral links** — that's the policy landmine in this area, not donations.

---

## Known gaps, deliberately not fixed

- **Special Profile themes can't be linked to their game.** Steam puts the
  appid nowhere in the page for those. The workaround is renaming the preset.
- **Mini profile grabs the poster, not the clip,** when captured from the
  bundle dialog — the dialog only renders a still. Grabbing that item from its
  own shop page gets the animation.
- **No image uploads.** A local file needs a data URL to survive navigation,
  which costs ~2.7MB of the 10MB extension quota per photo. If added: images
  only, downscaled to 1920px and re-encoded, and `sanitizeUrl` widens to
  `data:image/*` specifically — never `data:` generally.

## Ideas not committed to

- Per-slot "grab only this" from a profile page (exists for the shop already)
- Widening avatar swapping beyond the profile header by URL identity
- A colourway-match hint: compare a background's dominant colours against a
  theme's variables and rank them. This is the original problem the project
  set out to solve, and it's the one feature nothing else does.
