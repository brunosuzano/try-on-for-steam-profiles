# Roadmap

Current version: **1.42** (userscript, five slots, feature-complete for
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

- [ ] Grab each of the five item types from the Points Shop
- [ ] Grab a whole Game Profile bundle (should fill 5 slots in one press)
- [ ] Grab from a user profile, and from a frameless profile (should stay empty)
- [ ] Apply → Peek → Clear on both a static and an animated theme
- [ ] Presets: save, apply, rename, drag-reorder, number keys
- [ ] Export → Delete all → Import (should round-trip)
- [ ] Cross-tab sync, both directions, store ↔ profile
- [ ] Erase everything → reload → undo

---

## Before any public release

- [ ] **Confirm the name.** Settled on *Try-On for Steam Profiles*, tagline
      "Preview backgrounds, avatars, frames and themes before you buy".
      AMO checked October 2026: no collision. Still to check by hand:
      Chrome Web Store and Greasy Fork (both block automated search).
      Avoid "Preview", "Modifier", "Customizer", "Changer": all taken by
      tools in this space (Steam Profile Modifier, SteamProfilePreviewer,
      Steam Profile Changer). Keep "Steam" out of the first word.
- [ ] **Pick the icon.** Candidates are the swatch-grid and swatch-strip SVGs.
      Flat, bold, three colours, no thin lines; test at 16px before committing.
- [ ] **Revert `@name` to a stable string** — version lives in `@version`
      alone from then on. **Export presets first**; this starts a fresh
      storage bucket. See the versioning note in CLAUDE.md. Do this last,
      after iteration stops.

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
