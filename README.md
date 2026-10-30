# Try-On for Steam Profiles

See how a Steam profile would look with a different background, avatar,
avatar frame, mini profile or theme, **before you buy or equip anything**.

Find a background you like in the Points Shop, then flick through themes to
see which colourway suits it. Or try a whole look from someone else's profile
on your own.

> **Preview only.** Everything happens in your browser, on your screen. Your
> real Steam profile is never changed, nobody else sees the preview, and
> reloading the page without the script shows your profile exactly as it was.

## Install

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
   - In Chrome and Edge you may also need to turn on **Allow User Scripts** on
     Tampermonkey's page under `chrome://extensions` (or
     `edge://extensions`). Tampermonkey shows instructions if this is needed.
2. Open
   [`try-on-for-steam-profiles.user.js`](https://raw.githubusercontent.com/brunosuzano/try-on-for-steam-profiles/main/try-on-for-steam-profiles.user.js)
   and click **Install** when Tampermonkey asks.

   If you don't see that prompt, open the Tampermonkey dashboard, click **+**
   to create a new script, replace its contents with the file's contents, and
   save.

The script runs on `steamcommunity.com` and on the Steam Points Shop. A panel
appears in the top-right corner of those pages. Drag its header to move it,
or collapse it when you don't need it.

## Use it on a profile page

The panel has one row per item: **Background, Avatar frame, Avatar, Mini
profile, Theme**.

- **Grab** fills every row with what the profile you're viewing is using.
  Each row also has its own Grab for just that one item.
- **Apply** shows the filled-in rows on your own profile. You can also
  paste an item's image or video URL into a row yourself. On someone else's
  profile the panel only grabs, and Apply sends to your profile tabs instead
  (Advanced → *Apply on every profile* changes that).
- **Peek** (or hold **P**) shows the page's own look for as long as you hold
  it, so you can compare before and after. Press **O** to switch to the
  page's own look and stay there; press **O** again to come back.
- **Clear** removes everything you've applied.

A typical flow: grab a background from one profile, open your own profile, and
apply it. Then grab themes from other profiles one at a time to see which one
suits it.

## Use it in the Points Shop

Open an item's preview in the Points Shop and press **Grab** in the panel (or
press **G**). The item goes into the matching row, whether it's a background,
avatar, frame or mini profile. Grabbing from a **Game Profile** bundle fills
every row the bundle covers at once, theme included.

Then switch to a tab with a Steam profile open. What you grabbed shows up
there automatically. Nothing is applied in the shop itself.

## Presets

Type a name and press **Save** to keep the current combination as a preset.
Click a preset to apply it, or press **1–9** anywhere on the page to apply the
first nine. Double-click a preset's name to rename it, drag presets to
reorder them, and **Undo** a deletion if you change your mind.

Under **Advanced** you can **Export** your presets to a `.json` file and
**Import** them again, for example to move them to another browser.

## Privacy

No analytics, no tracking, no servers. Your presets and settings are stored
locally by Tampermonkey. The only requests the script makes are to Steam
itself, to read item details from the pages you're previewing.

## Not affiliated with Valve

This is an independent fan project. It is not affiliated with, endorsed by or
sponsored by Valve Corporation. Steam and the Steam logo are trademarks of
Valve Corporation.

## License

[MIT](LICENSE)
