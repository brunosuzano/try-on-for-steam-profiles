// Try-On for Steam Profiles: extension service worker.
//
// The app itself is try-on-for-steam-profiles.user.js, loaded as the content
// script. This file only does what a content script can't: requests to
// Steam's other origin, which in a content script are bound by the page's
// CORS (it's the extension's stand-in for GM_xmlhttpRequest), and the
// toolbar button.

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
    if (msg && msg.type === 'panelState') {
        if (sender.tab) showPanelState(sender.tab.id, msg.hidden);
        return false;
    }
    if (!msg || msg.type !== 'fetchText') return false;
    if (!isSteamUrl(msg.url)) {
        console.warn('[previewer] refused non-Steam fetch', msg.url);
        sendResponse({ text: '' });
        return false;
    }
    fetchText(msg.url, msg.timeout).then(text => sendResponse({ text }));
    return true;    // keeps the channel open for the async reply
});

// ---------------- toolbar button ----------------
//
// It toggles the in-page panel rather than opening a popup: a popup closes
// the moment you click the page, which would end the flick-between-presets
// workflow the panel is built for. Hidden is remembered and shared by every
// tab; the content script owns that state, this only relays and labels it.

const TITLE = 'Try-On for Steam Profiles';

function showPanelState(tabId, hidden) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#4b6a85' });
    chrome.action.setBadgeText({ tabId, text: hidden ? 'off' : '' });
    chrome.action.setTitle({ tabId, title: TITLE + (hidden ? ': panel hidden (click to show)' : '') });
}

// Fail loudly: a click that can't reach a panel says why, for a few seconds,
// instead of doing nothing.
function flag(tabId, why) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#c94f4f' });
    chrome.action.setBadgeText({ tabId, text: '!' });
    chrome.action.setTitle({ tabId, title: TITLE + ': ' + why });
    setTimeout(() => {
        chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
        chrome.action.setTitle({ tabId, title: TITLE }).catch(() => {});
    }, 4000);
}

chrome.action.onClicked.addListener(async (tab) => {
    if (!tab || tab.id === undefined) return;
    let res = null;
    try {
        res = await chrome.tabs.sendMessage(tab.id, { type: 'togglePanel' });
    } catch (e) {
        // No content script in this tab: not a Steam page, or one that was
        // open before the extension was installed or reloaded.
        flag(tab.id, 'works on Steam profiles and the Points Shop (reload the tab if it was already open)');
        return;
    }
    if (res && res.ok) showPanelState(tab.id, res.hidden);
    else flag(tab.id, 'no panel on this page: open a Steam profile or the Points Shop');
});

// A navigation starts a new page, which reports its own state if it has a
// panel. Clear the old label so a page without one doesn't keep "off".
chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'loading') chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
});
