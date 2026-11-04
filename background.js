// Try-On for Steam Profiles: extension service worker.
//
// The app itself is try-on-for-steam-profiles.user.js, loaded as the content
// script. This file only does what a content script can't: requests to
// Steam's other origin, which in a content script are bound by the page's
// CORS. It's the extension's stand-in for GM_xmlhttpRequest.

'use strict';

// The only hosts the extension talks to. Anything else is refused here too,
// not just left out of host_permissions: see the privacy policy.
const STEAM_HOSTS = new Set(['steamcommunity.com', 'store.steampowered.com']);

function isSteamUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol === 'https:' && STEAM_HOSTS.has(u.hostname);
    } catch (e) {
        return false;
    }
}

// Cookies are sent, as GM_xmlhttpRequest sends them by default: the bundle
// grab fetches a ?previewprofile=1 page of the user's own profile.
async function fetchText(url, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout || 10000);
    try {
        const res = await fetch(url, { credentials: 'include', signal: controller.signal });
        return await res.text();
    } catch (e) {
        console.warn('[previewer] fetch failed', url, e);
        return '';
    } finally {
        clearTimeout(timer);
    }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'fetchText') return false;
    if (!isSteamUrl(msg.url)) {
        console.warn('[previewer] refused non-Steam fetch', msg.url);
        sendResponse({ text: '' });
        return false;
    }
    fetchText(msg.url, msg.timeout).then(text => sendResponse({ text }));
    return true;    // keeps the channel open for the async reply
});
