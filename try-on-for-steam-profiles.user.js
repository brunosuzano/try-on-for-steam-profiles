// ==UserScript==
// @name         Try-On for Steam Profiles
// @namespace    https://github.com/brunosuzano/try-on-for-steam-profiles
// @version      1.47
// @description  Preview Steam profile backgrounds, avatars, avatar frames, mini profiles and themes before you buy or equip them
// @author       Bruno Moreira
// @license      MIT
// @homepageURL  https://github.com/brunosuzano/try-on-for-steam-profiles
// @supportURL   https://github.com/brunosuzano/try-on-for-steam-profiles/issues
// @downloadURL  https://raw.githubusercontent.com/brunosuzano/try-on-for-steam-profiles/main/try-on-for-steam-profiles.user.js
// @updateURL    https://raw.githubusercontent.com/brunosuzano/try-on-for-steam-profiles/main/try-on-for-steam-profiles.user.js
// @icon         data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAALxSURBVFhH7ZdNTxNBGMfLl4C49WBQmK1gjbzNatuIvGpBAnZpbNEgxTa0kIoItJjgQSWgRtuYqCVGYyIXLwY9EY3U+BK5mGjCwZiY+AUkHJoQDuQxz9DZtLttpaW8HJzkl9l5nnnm/+/sbrqj0yW0IkNVuZ7QiCBKX/WiBPmErUloBDUSNXkrEMSaAT2RVtSFeYdIK0Ip9SWpC6U0qJm4xewhdJCJFxJq1It0lSfEui6osgdB6p6AY66pvIBr4Zq4NtcRRBorPFC5X6cnNMyDZSfd8YKbcMQ2nBVYoxZOBWooO0FoWKcX6QIbHDSxCRXyCOwtM2u27F9gTaU8miRm7gtB/chT1ifGUWu9ji7gDizjYF9FM0uSWgcYG5zQd/8d+B5ENwTONTZ0Aal1KiLy9BdwR2PgeR9jvW16QcmhVnwHlnX8FxTXtLJkicUOtN2nEUHO33jBUMcRrMFaXKNh7DkTVtN4dYblUYvrbshAz9QsGEztShFeYyydgbZ7bzXiCMZzMmDqvKS55xhLZ8A68UojjmA8JwPGeofGAMbSGbB4w9D75k+SOI4xnpMBk5xiB+T0O4DUDkbgzMNP4JhZZD2OeS5rA92TLzXPAMYyGchE1gY4G30LkGHvEESv2OHHaCvrcbwpA67br6Fz7AkDr9X5RAN29zj8CrTA76BVAccYz9qAJzwHhxvPKQUcjLlDcykNXO8fSBLnYDxrA+XHZY04x2Du2FoDbf6wRlQNzlEb2NQtKGtyQQltBTnwGCpO9WgE1eAcnIs1WMsftJwfwuqua1BMT4NAJBAIxU+pzOAcIrEarOUimchoYDvYnQYsdX4I+RZTYnV9AGvvNwX1nwznc6gflh85FdRvAaejqeW/gV1lYP2jdGcMrH+URnbMAKERXZF49BAeTLbfAF1Vzol4NNtuA8rRLN4Kqs0XJ+94v2vE823gZ6AFGk8030LNRAOsddju+gcuzC6Nez6u5dvA/GXb2jPv2aUhp92fqPkXEzFyCkNXyhgAAAAASUVORK5CYII=
// @match        https://steamcommunity.com/*
// @match        https://store.steampowered.com/points/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      store.steampowered.com
// @connect      steamcommunity.com
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // =================================================================
    // This is the slot-registry version of the background swapper. The
    // machinery (grab, peek, clear, presets, auto-reapply, cross-tab
    // sync, undo, validation) no longer knows what a "background" is —
    // it loops over whatever slots are registered. Adding the avatar
    // frame later is a slot definition, not a new subsystem.
    //
    // Shipping with ONLY the background slot on purpose: if this behaves
    // identically to 9.11, the abstraction fits.
    // =================================================================

    const SCRIPT_VERSION = '1.47';
    const STATE_KEY = 'ppApplied';
    const PRESETS_KEY = 'ppPresets';
    const AUTO_KEY = 'ppAuto';
    const CONFIRM_KEY = 'ppConfirmDelete';
    const KEYS_KEY = 'ppNumberKeys';
    const UI_KEY = 'ppUi';
    const BACKUP_KEY = 'ppEraseBackup';
    const APP_NAMES_KEY = 'ppAppNames';
    const EVERYWHERE_KEY = 'ppApplyEverywhere';

    // ---------------- storage shim ----------------

    const store = {
        async get(key, fallback = '') {
            try {
                if (typeof GM_getValue !== 'undefined') return GM_getValue(key, fallback);
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    const res = await chrome.storage.local.get(key);
                    return (key in res) ? res[key] : fallback;
                }
                const v = localStorage.getItem(key);
                return v === null ? fallback : v;
            } catch (e) {
                console.warn('[previewer] storage read failed', e);
                return fallback;
            }
        },
        async set(key, value) {
            try {
                if (typeof GM_setValue !== 'undefined') return GM_setValue(key, value);
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    return chrome.storage.local.set({ [key]: value });
                }
                localStorage.setItem(key, value);
            } catch (e) {
                console.warn('[previewer] storage write failed', e);
            }
        },
        subscribe(key, callback) {
            try {
                if (typeof GM_addValueChangeListener !== 'undefined') {
                    GM_addValueChangeListener(key, (name, oldValue, newValue, remote) => {
                        if (remote) callback(newValue);
                    });
                    return;
                }
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
                    chrome.storage.onChanged.addListener((changes, area) => {
                        if (area !== 'local' || !(key in changes)) return;
                        callback(changes[key].newValue);
                    });
                    return;
                }
                window.addEventListener('storage', (e) => {
                    if (e.key === key) callback(e.newValue);
                });
            } catch (e) {
                console.warn('[previewer] could not subscribe to', key, e);
            }
        },
    };

    // ---------------- url helpers ----------------

    const STEAM_CDN = /(^|\.)steamstatic\.com$|(^|\.)akamaihd\.net$|(^|\.)steamcommunity\.com$/i;

    function urlFromCssValue(value) {
        const m = /url\(\s*["']?(.*?)["']?\s*\)/.exec(value || '');
        return m ? m[1] : '';
    }

    function normalizeUrl(raw) {
        let url = (raw || '').trim();
        if (!url) return '';
        if (/^\/\//.test(url)) return 'https:' + url;
        if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
        if (/^[^\s/]+\.[^\s/]+\//.test(url) || /^[^\s/]+\.[^\s/]+$/.test(url)) {
            return 'https://' + url;
        }
        return url;
    }

    function toHttps(url) { return url ? url.replace(/^http:/i, 'https:') : url; }

    function urlProblem(url) {
        if (!/^https?:\/\//i.test(url)) {
            return 'That doesn\u2019t look like a URL \u2014 it should start with https://';
        }
        return null;
    }

    function isSteamCdn(url) {
        try { return STEAM_CDN.test(new URL(url).hostname); } catch (e) { return false; }
    }

    function looksLikeVideo(url) { return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url); }
    function looksLikeImage(url) { return /\.(jpe?g|png|gif|webp|avif|bmp)(\?|#|$)/i.test(url); }

    // ---------------- slot values ----------------
    //
    // A slot value is { kind: 'image', url } or
    // { kind: 'video', mp4, webm, poster }. Slots declare which kinds
    // they accept; the panel builds its fields from that.

    const KIND_FIELDS = {
        image: [{ key: 'url', placeholder: 'Image URL' }],
        video: [
            { key: 'mp4', placeholder: 'Video URL (.mp4)' },
            { key: 'webm', placeholder: 'Video URL (.webm, optional)' },
            { key: 'poster', placeholder: 'Poster image URL (optional)' },
        ],
        // A theme isn't a URL — it's a body class plus a set of CSS variables,
        // so it has no editable fields and is grab-only.
        theme: [],
    };

    function normalizeValue(value) {
        if (!value || !value.kind) return null;
        if (value.kind === 'theme') {
            const vars = (value.vars && typeof value.vars === 'object') ? value.vars : {};
            const bodyClass = typeof value.bodyClass === 'string' ? value.bodyClass.trim() : '';
            if (!bodyClass && !Object.keys(vars).length) return null;
            const appid = typeof value.appid === 'string' ? value.appid : '';
            const thumb = typeof value.thumb === 'string' ? value.thumb : '';
            return { kind: 'theme', bodyClass, appid, thumb, vars, label: value.label || bodyClass };
        }
        if (value.kind === 'image') {
            const url = normalizeUrl(value.url);
            return url ? { kind: 'image', url } : null;
        }
        if (value.kind === 'video') {
            const mp4 = normalizeUrl(value.mp4);
            const webm = normalizeUrl(value.webm);
            const poster = normalizeUrl(value.poster);
            return (mp4 || webm) ? { kind: 'video', mp4, webm, poster } : null;
        }
        return null;
    }

    // Returns an error string, or null when the value can be applied.
    function validateValue(value) {
        if (!value) return 'Nothing to apply.';
        if (value.kind === 'theme') return null;
        if (value.kind === 'image') {
            const problem = urlProblem(value.url);
            if (problem) return problem;
            if (looksLikeVideo(value.url)) {
                return 'That looks like a video file \u2014 switch that slot to Video.';
            }
            return null;
        }
        for (const [label, candidate] of [['mp4', value.mp4], ['webm', value.webm]]) {
            if (!candidate) continue;
            const problem = urlProblem(candidate);
            if (problem) return label + ' \u2014 ' + problem;
            if (looksLikeImage(candidate)) {
                return 'The ' + label + ' URL looks like an image \u2014 use Image for stills.';
            }
        }
        return null;
    }

    function valueStill(value) {
        if (!value) return '';
        if (value.kind === 'theme') {
            if (value.thumb) return value.thumb;
            const appid = themeAppId(value);
            return appid ? capsuleUrls(appid)[0] : '';
        }
        return value.kind === 'image' ? value.url : (value.poster || '');
    }

    function valueClip(value) {
        if (!value || value.kind !== 'video') return '';
        return value.mp4 || value.webm || '';
    }

    function sameValue(a, b) {
        if (!a || !b || a.kind !== b.kind) return false;
        if (a.kind === 'theme') {
            // Key by key, not JSON.stringify: a bundle grab parses the
            // variables in stylesheet order, a profile grab in THEME_VARS
            // order, and the same theme must compare equal either way.
            const av = a.vars || {};
            const bv = b.vars || {};
            const names = Object.keys(av);
            return a.bodyClass === b.bodyClass &&
                names.length === Object.keys(bv).length &&
                names.every(name => av[name] === bv[name]);
        }
        if (a.kind === 'image') return (a.url || '') === (b.url || '');
        if (a.mp4 && a.mp4 === b.mp4) return true;
        if (a.webm && a.webm === b.webm) return true;
        // mp4-only and webm-only copies of one clip share no URL at all;
        // the poster is the link between them.
        if (a.poster && a.poster === b.poster) return true;
        return false;
    }

    function mergeValue(existing, incoming) {
        if (!existing || existing.kind !== 'video' || !incoming || incoming.kind !== 'video') return false;
        let changed = false;
        for (const key of ['mp4', 'webm', 'poster']) {
            if (!existing[key] && incoming[key]) { existing[key] = incoming[key]; changed = true; }
        }
        return changed;
    }

    // ---------------- shared DOM helpers ----------------

    function hasVisibleBg(cs) {
        const img = cs.backgroundImage;
        if (img && img !== 'none') return true;
        const m = (cs.backgroundColor || '').match(/rgba?\(([^)]+)\)/);
        if (!m) return false;
        const parts = m[1].split(',').map(s => parseFloat(s));
        const alpha = parts.length > 3 ? parts[3] : 1;
        return alpha > 0;
    }

    function neutralizeAncestors(el, store_) {
        restoreAncestors(store_);
        let node = el;
        while (node && node.nodeType === 1 && node !== document.body) {
            const cs = window.getComputedStyle(node);
            if (hasVisibleBg(cs)) {
                store_.push({
                    el: node,
                    color: node.style.getPropertyValue('background-color'),
                    colorPriority: node.style.getPropertyPriority('background-color'),
                    image: node.style.getPropertyValue('background-image'),
                    imagePriority: node.style.getPropertyPriority('background-image'),
                });
                node.style.setProperty('background-color', 'transparent', 'important');
                node.style.setProperty('background-image', 'none', 'important');
            }
            node = node.parentElement;
        }
    }

    function restoreAncestors(store_) {
        for (const rec of store_) {
            rec.el.style.removeProperty('background-color');
            rec.el.style.removeProperty('background-image');
            if (rec.color) rec.el.style.setProperty('background-color', rec.color, rec.colorPriority);
            if (rec.image) rec.el.style.setProperty('background-image', rec.image, rec.imagePriority);
        }
        store_.length = 0;
    }

    // A <video> pauses when removed from the DOM and does not resume on
    // re-insertion. Both Clear and Peek put the page's own animation back.
    function resumeVideoIn(node) {
        if (!node) return;
        const video = node.querySelector ? node.querySelector('video') : null;
        if (!video) return;
        const pr = video.play();
        if (pr && pr.catch) {
            pr.catch(() => {
                try { video.load(); } catch (e) {}
                const retry = video.play();
                if (retry && retry.catch) retry.catch(() => {});
            });
        }
    }

    function findByStrategies(strategies, slotId) {
        for (const strategy of strategies) {
            let el = null;
            try { el = strategy.find(); } catch (e) { /* try the next one */ }
            if (el) {
                console.log('[previewer] ' + slotId + ' found via:', strategy.name);
                return el;
            }
        }
        console.warn('[previewer] no strategy matched for slot:', slotId);
        return null;
    }

    // =================================================================
    // Slot definitions
    // =================================================================

    const BASE_CLASS = 'no_header profile_page has_profile_background';

    const MEDIA_ERRORS = {
        1: 'ABORTED (1) \u2014 load cancelled',
        2: 'NETWORK (2) \u2014 URL unreachable / blocked',
        3: 'DECODE (3) \u2014 file corrupt or unsupported encoding',
        4: 'SRC_NOT_SUPPORTED (4) \u2014 bad URL or codec the browser refuses',
    };

    const backgroundSlot = {
        id: 'background',
        label: 'Background',
        kinds: ['image', 'video'],
        wrapperId: 'pp-video-background',

        strategies: [
            {
                name: 'innermost .no_header containing .profile_header_bg',
                find() {
                    for (const el of document.querySelectorAll('.no_header')) {
                        if (!el.querySelector('.no_header') && el.querySelector('.profile_header_bg')) return el;
                    }
                    return null;
                },
            },
            {
                name: 'parent of .profile_header_bg',
                find() {
                    const bg = document.querySelector('.profile_header_bg');
                    return bg ? bg.parentElement : null;
                },
            },
            {
                name: 'element with inline Steam asset background-image',
                find() {
                    for (const el of document.querySelectorAll('[style*="background-image"]')) {
                        const style = el.getAttribute('style') || '';
                        if (/community_assets|images\/items/i.test(style)) return el;
                    }
                    return null;
                },
            },
            {
                name: '.profile_page.has_profile_background',
                find() { return document.querySelector('.profile_page.has_profile_background'); },
            },
            {
                name: 'last .no_header (fallback)',
                find() {
                    const c = document.querySelectorAll('.no_header');
                    return c[c.length - 1] || null;
                },
            },
        ],

        find() { return findByStrategies(this.strategies, this.id); },

        // What the page itself is showing, captured before anything is touched.
        snapshot() {
            const snap = { value: null, meta: {} };
            const el = this.find();

            if (el) {
                const cs = window.getComputedStyle(el);
                const image = urlFromCssValue(el.style.backgroundImage) || urlFromCssValue(cs.backgroundImage);
                // Stripping the theme classes on apply also drops their
                // background-size, so keep it and put it back explicitly.
                snap.meta.imageStyle = {
                    size: cs.backgroundSize,
                    position: cs.backgroundPosition,
                    repeat: cs.backgroundRepeat,
                    attachment: cs.backgroundAttachment,
                    origin: cs.backgroundOrigin,
                    clip: cs.backgroundClip,
                };
                const rect = el.getBoundingClientRect();
                snap.meta.targetRect = {
                    width: Math.round(rect.width), height: Math.round(rect.height),
                    top: Math.round(rect.top), left: Math.round(rect.left),
                };
                if (image) snap.value = { kind: 'image', url: image };
            }

            const themeWrapper = document.querySelector('.profile_animated_background');
            if (themeWrapper) {
                const ws = window.getComputedStyle(themeWrapper);
                const wr = themeWrapper.getBoundingClientRect();
                snap.meta.themeVideoBox = {
                    position: ws.position, top: ws.top, left: ws.left,
                    width: ws.width, height: ws.height, transform: ws.transform,
                    zIndex: ws.zIndex, overflow: ws.overflow,
                    rect: { width: Math.round(wr.width), height: Math.round(wr.height),
                            top: Math.round(wr.top), left: Math.round(wr.left) },
                };
            }

            const video = document.querySelector('.profile_animated_background video');
            if (video) {
                const vs = window.getComputedStyle(video);
                const vr = video.getBoundingClientRect();
                snap.meta.themeVideoStyle = {
                    objectFit: vs.objectFit, objectPosition: vs.objectPosition,
                    width: vs.width, height: vs.height, position: vs.position,
                    top: vs.top, left: vs.left, transform: vs.transform,
                    intrinsic: (video.videoWidth || 0) + 'x' + (video.videoHeight || 0),
                    rect: { width: Math.round(vr.width), height: Math.round(vr.height),
                            top: Math.round(vr.top), left: Math.round(vr.left) },
                };
                const clip = { kind: 'video', mp4: '', webm: '', poster: video.getAttribute('poster') || '' };
                for (const source of video.querySelectorAll('source')) {
                    const src = source.getAttribute('src') || '';
                    const type = source.getAttribute('type') || '';
                    if (/\.webm/i.test(src) || type.includes('webm')) clip.webm = clip.webm || src;
                    else if (/\.mp4/i.test(src) || type.includes('mp4')) clip.mp4 = clip.mp4 || src;
                }
                if (!clip.mp4 && !clip.webm && video.currentSrc) clip.mp4 = video.currentSrc;
                if (clip.mp4 || clip.webm) snap.value = clip;
            }

            return snap;
        },

        capture(state, el) {
            if (state.original) return;
            const animatedBg = el.querySelector(':scope > .profile_animated_background');
            state.original = {
                className: el.className,
                styleCssText: el.style.cssText,
                animatedBgNode: animatedBg || null,
                animatedBgNextSibling: animatedBg ? animatedBg.nextSibling : null,
            };
        },

        removeInjected() {
            const existing = document.getElementById(this.wrapperId);
            if (existing) existing.remove();
        },

        apply(state, value, meta, report) {
            const el = this.find();
            if (!el) return { ok: false, message: 'Couldn\u2019t find the profile background on this page.' };

            state.targetEl = el;
            this.capture(state, el);
            this.removeInjected();

            const themeBg = el.querySelector(':scope > .profile_animated_background');
            if (themeBg) themeBg.remove();

            el.className = BASE_CLASS;
            el.style.cssText = '';

            if (value.kind === 'image') {
                restoreAncestors(state.neutralized);
                el.style.cssText = `background-image: url('${value.url}');`;

                const themeStyle = (meta && meta.imageStyle) || {};
                const usableSize = themeStyle.size && themeStyle.size !== 'auto';
                el.style.setProperty('background-size', usableSize ? themeStyle.size : '100%');
                el.style.setProperty('background-position', usableSize ? themeStyle.position : '50% 0');
                el.style.setProperty('background-attachment', themeStyle.attachment || 'scroll');
                el.style.setProperty('background-repeat', 'no-repeat');
                if (themeStyle.origin) el.style.setProperty('background-origin', themeStyle.origin);
                if (themeStyle.clip) el.style.setProperty('background-clip', themeStyle.clip);

                const applied = urlFromCssValue(window.getComputedStyle(el).backgroundImage);
                if (!applied) {
                    return { ok: false, message: 'Applied, but the element shows no background image.' };
                }
                if (applied.split('/').pop() !== value.url.split('/').pop()) {
                    return { ok: false, message: 'Applied, but a different image is winning \u2014 CSS conflict.' };
                }
                this.probe(state, value, report);
                return { ok: true, message: 'Background applied.' };
            }

            return this.applyVideo(state, value, report, false);
        },

        probe(state, value, report) {
            const url = value.url;
            const current = () => state.active && state.active.kind === 'image' && state.active.url === url;
            const probe = new Image();
            probe.onerror = () => {
                if (!current()) return;
                if (/^http:\/\//i.test(url)) {
                    const secure = toHttps(url);
                    const retry = new Image();
                    retry.onload = () => {
                        if (!current()) return;
                        report({ ok: true, message: 'Loaded it over https:// instead.', reapply: { kind: 'image', url: secure } });
                    };
                    retry.onerror = () => {
                        if (!current()) return;
                        report({ ok: false, message: 'That URL didn\u2019t load as an image \u2014 check the link.' });
                    };
                    retry.src = secure;
                    return;
                }
                report({ ok: false, message: 'That URL didn\u2019t load as an image \u2014 check the link.' });
            };
            probe.onload = () => {
                if (!current()) return;
                if (!isSteamCdn(url)) report({ ok: true, message: 'Background applied (not a Steam CDN link).' });
            };
            probe.src = url;
        },

        // Geometry mirrors what Steam does, measured from a live themed page:
        // an absolute, full-height wrapper with overflow hidden, containing a
        // video left at its NATURAL size, top-anchored and centred.
        applyVideo(state, value, report, httpsRetried) {
            const el = state.targetEl;
            const wrapper = document.createElement('div');
            wrapper.id = this.wrapperId;
            wrapper.style.setProperty('position', 'absolute', 'important');
            wrapper.style.setProperty('top', '0', 'important');
            wrapper.style.setProperty('left', '0', 'important');
            wrapper.style.setProperty('width', '100%', 'important');
            wrapper.style.setProperty('height', '100%', 'important');
            wrapper.style.setProperty('overflow', 'hidden', 'important');
            wrapper.style.setProperty('pointer-events', 'none', 'important');
            wrapper.style.setProperty('background', 'transparent', 'important');
            wrapper.style.setProperty('z-index', '-1', 'important');

            const video = document.createElement('video');
            video.autoplay = true;
            video.muted = true;
            video.defaultMuted = true;
            video.loop = true;
            video.playsInline = true;
            video.setAttribute('muted', '');
            video.setAttribute('playsinline', '');
            if (value.poster) video.poster = value.poster;
            video.style.setProperty('position', 'absolute', 'important');
            video.style.setProperty('top', '0', 'important');
            video.style.setProperty('left', '50%', 'important');
            video.style.setProperty('transform', 'translateX(-50%)', 'important');
            video.style.setProperty('object-fit', 'contain', 'important');
            video.style.setProperty('display', 'block', 'important');
            video.style.setProperty('width', '100%', 'important');
            video.style.setProperty('height', 'auto', 'important');

            video.addEventListener('loadedmetadata', () => {
                if (video.videoWidth && video.videoHeight) {
                    video.style.setProperty('width', video.videoWidth + 'px', 'important');
                    video.style.setProperty('height', video.videoHeight + 'px', 'important');
                }
                console.log('[previewer] video natural size:', video.videoWidth + 'x' + video.videoHeight);
            });
            video.addEventListener('playing', () => {
                const fromSteam = isSteamCdn(value.mp4 || '') || isSteamCdn(value.webm || '');
                report({ ok: true, message: fromSteam ? 'Video playing.' : 'Video playing (not a Steam CDN link).' });
            });
            video.addEventListener('error', () => {
                const usesHttp = /^http:\/\//i.test(value.mp4 || '') || /^http:\/\//i.test(value.webm || '');
                if (usesHttp && !httpsRetried) {
                    report({ ok: true, message: 'Retrying over https\u2026' });
                    this.removeInjected();
                    this.applyVideo(state, {
                        kind: 'video',
                        mp4: toHttps(value.mp4), webm: toHttps(value.webm), poster: toHttps(value.poster),
                    }, report, true);
                    return;
                }
                const code = video.error ? video.error.code : 0;
                report({ ok: false, message: 'Video error: ' + (MEDIA_ERRORS[code] || 'unknown') });
            });

            if (value.webm) {
                const s = document.createElement('source');
                s.src = value.webm;
                s.type = 'video/webm';
                video.appendChild(s);
            }
            if (value.mp4) {
                const s = document.createElement('source');
                s.src = value.mp4;
                s.type = 'video/mp4';
                video.appendChild(s);
            }

            wrapper.appendChild(video);
            el.insertBefore(wrapper, el.firstChild);
            neutralizeAncestors(el, state.neutralized);

            const rect = wrapper.getBoundingClientRect();
            if (!wrapper.isConnected || rect.width < 1 || rect.height < 1) {
                return { ok: false, message: 'Video container has no size \u2014 page CSS may be interfering.' };
            }

            video.load();
            const pr = video.play();
            if (pr && pr.catch) pr.catch(err => report({ ok: false, message: 'Autoplay blocked: ' + err.name }));
            return { ok: true, message: 'Loading video\u2026' };
        },

        verify(state, value) {
            if (!state.targetEl || !state.targetEl.isConnected) return false;
            if (value.kind === 'video') {
                const wrapper = document.getElementById(this.wrapperId);
                return !!(wrapper && wrapper.isConnected);
            }
            const applied = urlFromCssValue(window.getComputedStyle(state.targetEl).backgroundImage);
            if (!applied) return false;
            return applied.split('/').pop() === (value.url || '').split('/').pop();
        },

        restore(state) {
            this.removeInjected();
            restoreAncestors(state.neutralized);
            if (!state.targetEl || !state.original) return;

            state.targetEl.className = state.original.className;
            state.targetEl.style.cssText = state.original.styleCssText;

            const node = state.original.animatedBgNode;
            if (node) {
                const next = state.original.animatedBgNextSibling;
                if (next && next.parentNode === state.targetEl) state.targetEl.insertBefore(node, next);
                else state.targetEl.insertBefore(node, state.targetEl.firstChild);
                resumeVideoIn(node);
            }
        },

        // Peek hides our video rather than destroying it, so releasing is
        // instant instead of a reload.
        peekOut(state) {
            if (!state.targetEl || !state.original) return null;
            const memo = { className: state.targetEl.className, cssText: state.targetEl.style.cssText };
            const wrapper = document.getElementById(this.wrapperId);
            if (wrapper) {
                wrapper.style.setProperty('display', 'none', 'important');
                memo.hadVideo = true;
            }
            restoreAncestors(state.neutralized);
            state.targetEl.className = state.original.className;
            state.targetEl.style.cssText = state.original.styleCssText;
            if (state.original.animatedBgNode && !state.original.animatedBgNode.isConnected) {
                state.targetEl.insertBefore(state.original.animatedBgNode, state.targetEl.firstChild);
                resumeVideoIn(state.original.animatedBgNode);
                memo.reinserted = true;
            }
            return memo;
        },

        peekIn(state, memo) {
            if (!memo) return;
            if (memo.reinserted && state.original && state.original.animatedBgNode) {
                state.original.animatedBgNode.remove();
            }
            if (state.targetEl) {
                state.targetEl.className = memo.className;
                state.targetEl.style.cssText = memo.cssText;
            }
            if (memo.hadVideo) {
                const wrapper = document.getElementById(this.wrapperId);
                if (wrapper) wrapper.style.removeProperty('display');
                if (state.targetEl) neutralizeAncestors(state.targetEl, state.neutralized);
            }
        },
    };

    // ---------------- picture/img swapping ----------------
    //
    // Steam serves avatars and frames as <picture> with two <source>
    // elements and an <img>. A matching <source> beats the <img>, so
    // setting img.src alone changes nothing visible — every srcset has to
    // be overridden too. The avatar's <img> carries only srcset and no
    // src at all, so a src-only swap would fail twice over.

    function imgOf(el) {
        if (!el) return null;
        return el.tagName === 'IMG' ? el : el.querySelector('img');
    }

    function sourcesOf(el) {
        if (!el || el.tagName === 'IMG') return [];
        return Array.from(el.querySelectorAll('source'));
    }

    function captureImageSources(el) {
        const img = imgOf(el);
        const sources = sourcesOf(el);
        return {
            el, img, sources,
            imgSrc: img ? img.getAttribute('src') : null,
            imgSrcset: img ? img.getAttribute('srcset') : null,
            sourceSrcsets: sources.map(source => source.getAttribute('srcset')),
        };
    }

    function setImageSources(el, url) {
        for (const source of sourcesOf(el)) source.setAttribute('srcset', url);
        const img = imgOf(el);
        if (img) {
            img.setAttribute('src', url);
            img.setAttribute('srcset', url);
        }
    }

    function restoreImageSources(memo) {
        if (!memo) return;
        memo.sources.forEach((source, i) => {
            const value = memo.sourceSrcsets[i];
            if (value === null) source.removeAttribute('srcset');
            else source.setAttribute('srcset', value);
        });
        if (memo.img) {
            if (memo.imgSrc === null) memo.img.removeAttribute('src');
            else memo.img.setAttribute('src', memo.imgSrc);
            if (memo.imgSrcset === null) memo.img.removeAttribute('srcset');
            else memo.img.setAttribute('srcset', memo.imgSrcset);
        }
    }

    function currentImageUrl(el) {
        const img = imgOf(el);
        if (img) {
            const src = img.getAttribute('src');
            if (src) return src;
            const srcset = img.getAttribute('srcset');
            if (srcset) return srcset.split(',')[0].trim().split(/\s+/)[0];
            if (img.currentSrc) return img.currentSrc;
        }
        const source = sourcesOf(el).find(s2 => s2.getAttribute('srcset'));
        if (source) return source.getAttribute('srcset').split(',')[0].trim().split(/\s+/)[0];
        return '';
    }

    // Steam serves one avatar at several sizes: name.jpg, name_medium.jpg,
    // name_full.jpg. Strip the suffix and extension and what's left is the
    // asset's identity — shared by every copy of it on the page, and
    // different for every other user's avatar.
    function identityKey(url) {
        if (!url) return '';
        const file = url.split('?')[0].split('#')[0].split('/').pop();
        if (!file) return '';
        return file.replace(/\.[a-z0-9]+$/i, '').replace(/_(full|medium|small)$/i, '');
    }

    function sameFile(a, b) {
        if (!a || !b) return false;
        return a.split('?')[0].split('/').pop() === b.split('?')[0].split('/').pop();
    }

    // Shared behaviour for the avatar and avatar-frame slots: both are a
    // <picture> to be swapped in place, differing only in how they're found
    // and whether they can be created when absent.
    const pictureSlotBase = {
        kinds: ['image'],

        find() { return findByStrategies(this.strategies, this.id); },

        snapshot() {
            const el = this.find();
            if (!el) return { value: null, meta: {} };
            const url = currentImageUrl(el);
            return { value: url ? { kind: 'image', url } : null, meta: {} };
        },

        // Every copy of this asset on the page, found by identity rather
        // than by location: no extra selectors to break, and other people's
        // avatars in comments and friend lists are left alone.
        collectTargets(state) {
            let primary = this.find();
            if (!primary && this.create) primary = this.create(state);
            if (!primary) return null;

            const targets = [primary];
            const key = identityKey(currentImageUrl(primary));
            if (key) {
                for (const img of document.querySelectorAll('img')) {
                    if (img.closest('#pp-panel')) continue;      // our own thumbnails
                    if (!this.accepts(img)) continue;
                    const container = this.containerFor(img);
                    if (!container || targets.indexOf(container) !== -1) continue;
                    if (identityKey(currentImageUrl(container)) !== key) continue;
                    targets.push(container);
                }
            }

            state.targets = targets;
            state.targetEl = primary;
            // Captured now, while everything still shows the page's own asset.
            state.original = targets.map(el => captureImageSources(el));
            return targets;
        },

        ensureTargets(state) {
            const usable = state.targets && state.targets.length
                && state.targets.every(el => el.isConnected);
            return usable ? state.targets : this.collectTargets(state);
        },

        apply(state, value, meta, report) {
            const targets = this.ensureTargets(state);
            if (!targets) return { ok: false, message: this.missingMessage };
            for (const el of targets) setImageSources(el, value.url);
            const el = state.targetEl;

            // Report a load failure rather than leaving a broken image.
            const probe = new Image();
            probe.onerror = () => {
                if (!state.active || state.active.url !== value.url) return;
                report({ ok: false, message: this.label + ': that URL didn\u2019t load as an image.' });
            };
            probe.src = value.url;

            const extra = targets.length - 1;
            return {
                ok: true,
                message: this.label + ' applied' + (extra > 0 ? ' in ' + targets.length + ' places.' : '.'),
            };
        },

        verify(state, value) {
            if (!state.targetEl || !state.targetEl.isConnected) return false;
            return sameFile(currentImageUrl(state.targetEl), value.url);
        },

        restore(state) {
            for (const memo of (state.original || [])) restoreImageSources(memo);
            if (state.created && state.targetEl && state.targetEl.isConnected) {
                state.targetEl.remove();
            }
            state.created = false;
            state.targets = null;
        },

        peekOut(state) {
            if (!state.targets || !state.targets.length) return null;
            for (const memo of (state.original || [])) restoreImageSources(memo);
            if (state.created && state.targetEl) {
                state.targetEl.style.setProperty('display', 'none', 'important');
            }
            return { swapped: true };
        },

        peekIn(state, memo) {
            if (!memo || !state.active || !state.targets) return;
            if (state.created && state.targetEl) state.targetEl.style.removeProperty('display');
            for (const el of state.targets) setImageSources(el, state.active.url);
        },
    };

    // Everything avatar-related must be looked up inside the profile header.
    // Page-wide fallbacks were grabbing the VIEWER's own frame from the global
    // header bar when the profile being viewed had none.
    function profileHeaderRoot() {
        return document.querySelector('.profile_header')
            || document.querySelector('.playerAvatar.profile_header_size')
            || null;
    }

    const avatarFrameSlot = Object.assign({}, pictureSlotBase, {
        id: 'avatarFrame',
        label: 'Avatar frame',
        missingMessage: 'Couldn\u2019t find anywhere to put an avatar frame on this page.',

        accepts(img) { return !!img.closest('.profile_avatar_frame'); },
        containerFor(img) { return img.closest('.profile_avatar_frame'); },

        strategies: [
            {
                name: 'header avatar .profile_avatar_frame',
                find() { return document.querySelector('.playerAvatar.profile_header_size .profile_avatar_frame'); },
            },
            {
                // Scoped to the header: an unscoped query returns the viewer's
                // own frame from the site header or a comment avatar.
                name: '.profile_header .profile_avatar_frame',
                find() {
                    const root = profileHeaderRoot();
                    return root ? root.querySelector('.profile_avatar_frame') : null;
                },
            },
        ],

        // A profile with no frame equipped has no element to swap, so make
        // one. Same class name, so Steam's own CSS positions it.
        create(state) {
            const root = profileHeaderRoot();
            const host = document.querySelector('.playerAvatar.profile_header_size .playerAvatarAutoSizeInner')
                || (root ? root.querySelector('.playerAvatarAutoSizeInner') : null);
            if (!host) return null;
            const frame = document.createElement('div');
            frame.className = 'profile_avatar_frame';
            frame.appendChild(document.createElement('img'));
            host.insertBefore(frame, host.firstChild);
            state.created = true;
            return frame;
        },
    });

    const avatarSlot = Object.assign({}, pictureSlotBase, {
        id: 'avatar',
        label: 'Avatar',
        missingMessage: 'Couldn\u2019t find the profile avatar on this page.',

        accepts(img) { return !img.closest('.profile_avatar_frame'); },
        containerFor(img) { return img.closest('picture') || img; },

        // Header avatar only. Deliberately not every avatar on the page:
        // comments and friend lists show other people, and rewriting them
        // all multiplies the breakage surface for no benefit.
        strategies: [
            {
                name: 'header .playerAvatarAutoSizeInner > picture',
                find() { return document.querySelector('.playerAvatar.profile_header_size .playerAvatarAutoSizeInner > picture'); },
            },
            {
                name: '.profile_header .playerAvatarAutoSizeInner > picture',
                find() {
                    const root = profileHeaderRoot();
                    return root ? root.querySelector('.playerAvatarAutoSizeInner > picture') : null;
                },
            },
            {
                name: 'header avatar img outside the frame',
                find() {
                    const holder = document.querySelector('.playerAvatar.profile_header_size')
                        || profileHeaderRoot();
                    if (!holder) return null;
                    for (const img of holder.querySelectorAll('img')) {
                        if (!img.closest('.profile_avatar_frame')) return img;
                    }
                    return null;
                },
            },
        ],
    });

    // ---------------- mini profile ----------------
    //
    // Unlike the other slots this one has no stable element: the popup is
    // built when you hover a name and rebuilt on every hover, so applying
    // once is useless. A watcher repaints it each time it renders.
    //
    // It also shows whichever user you hovered, so the painter checks the
    // last hovered data-miniprofile id against the profile owner's before
    // touching anything.

    let ownerMiniId = '';
    let lastHoverMiniId = '';

    // Pages can carry an empty .miniprofile_hover placeholder alongside a
    // populated one, so take the one with actual content.
    function miniPopup() {
        const popups = document.querySelectorAll('.miniprofile_hover');
        for (const popup of popups) {
            if (popup.querySelector('.miniprofile_container')) return popup;
        }
        return popups[0] || null;
    }

    function nameplateValueFrom(container) {
        if (!container) return null;
        const video = container.querySelector('video');
        if (video) {
            const clip = { kind: 'video', mp4: '', webm: '', poster: video.getAttribute('poster') || '' };
            for (const source of video.querySelectorAll('source')) {
                const src = source.getAttribute('src') || '';
                const type = source.getAttribute('type') || '';
                if (/\.webm/i.test(src) || type.includes('webm')) clip.webm = clip.webm || src;
                else if (/\.mp4/i.test(src) || type.includes('mp4')) clip.mp4 = clip.mp4 || src;
            }
            if (clip.mp4 || clip.webm) return clip;
        }
        const img = container.querySelector('img');
        const url = img ? (img.getAttribute('src') || '') : '';
        return url ? { kind: 'image', url } : null;
    }

    function waitFor(test, timeoutMs) {
        return new Promise(resolve => {
            const started = Date.now();
            (function poll() {
                if (test()) return resolve(true);
                if (Date.now() - started > timeoutMs) return resolve(false);
                setTimeout(poll, 50);
            })();
        });
    }

    // Ask Steam to build the popup itself, by pretending to hover the name.
    // Hidden with a temporary stylesheet so it doesn't flash open and shut.
    async function forceMiniProfileHover(timeoutMs) {
        const holder = document.querySelector('.playerAvatar.profile_header_size[data-miniprofile]')
            || document.querySelector('[data-miniprofile]');
        if (!holder) return false;

        const style = document.createElement('style');
        style.textContent = '.miniprofile_hover{visibility:hidden !important;}';
        document.head.appendChild(style);

        try {
            lastHoverMiniId = holder.getAttribute('data-miniprofile') || '';
            for (const type of ['mouseover', 'mouseenter']) {
                holder.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
            }
            const ready = await waitFor(() => {
                const popup = miniPopup();
                return !!(popup && popup.querySelector('.miniprofile_nameplatecontainer'));
            }, timeoutMs || 1500);
            for (const type of ['mouseout', 'mouseleave']) {
                holder.dispatchEvent(new MouseEvent(type, {
                    bubbles: true, cancelable: true, view: window, relatedTarget: document.body,
                }));
            }
            return ready;
        } catch (e) {
            console.warn('[previewer] simulated hover failed', e);
            return false;
        } finally {
            setTimeout(() => style.remove(), 300);
        }
    }

    // Fallback: the endpoint Steam builds these from. Undocumented, hence
    // second in line, but it needs no rendering and cannot flash on screen.
    async function fetchMiniProfileValue() {
        if (!ownerMiniId) return null;
        try {
            const url = 'https://steamcommunity.com/miniprofile/' + encodeURIComponent(ownerMiniId)
                + '?origin=' + encodeURIComponent(location.origin);
            const response = await fetch(url, { credentials: 'include' });
            if (!response.ok) return null;
            const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
            return nameplateValueFrom(doc.querySelector('.miniprofile_nameplatecontainer'));
        } catch (e) {
            console.warn('[previewer] mini profile fetch failed', e);
            return null;
        }
    }

    const miniProfileSlot = {
        id: 'miniProfile',
        label: 'Mini profile',
        kinds: ['image', 'video'],

        // Built on hover, not at page load — so its snapshot can't be taken
        // once up front like the others. Grab re-reads it on demand.
        volatile: true,
        emptyHint: 'Couldn\u2019t load your mini profile \u2014 hover your name once, then Grab.',

        find() {
            const popup = miniPopup();
            return popup ? popup.querySelector('.miniprofile_nameplatecontainer') : null;
        },

        snapshot() {
            const container = this.find();
            return { value: nameplateValueFrom(container), meta: {} };
        },

        // Make the popup exist without the user having to hover first:
        // simulate the hover, and fall back to fetching it.
        async ensure() {
            if (this.find()) return null;
            if (await forceMiniProfileHover(1500)) return null;
            return await fetchMiniProfileValue();
        },

        apply(state, value) {
            state.active = value;   // paintMiniProfile reads this
            const painted = paintMiniProfile();
            return {
                ok: true,
                message: painted
                    ? 'Mini profile applied.'
                    : 'Mini profile saved \u2014 it will show next time you hover your name.',
            };
        },

        // Nothing rendered means nothing to have been clobbered. Without
        // this the auto-reapply watcher would fail three times and pause
        // itself on every page where you never hover a name.
        verify(state, value) {
            const container = this.find();
            if (!container) return true;
            if (value.kind === 'video') {
                // Any source matching either URL counts. Comparing only the
                // first source against only the preferred URL made this fail
                // whenever both formats were present: the check said "not
                // applied", the painter repainted, the repaint woke the
                // observer, and round it went.
                const wanted = [value.mp4, value.webm].filter(Boolean);
                const sources = Array.from(container.querySelectorAll('video source'));
                if (!sources.length) return false;
                return sources.some(source =>
                    wanted.some(url => sameFile(source.getAttribute('src'), url)));
            }
            return sameFile(currentImageUrl(container), value.url);
        },

        restore(state) {
            const memo = state.miniMemo;
            if (memo && memo.container && memo.container.isConnected) {
                memo.container.innerHTML = memo.html;
            }
            state.miniMemo = null;
        },

        peekOut(state) {
            const memo = state.miniMemo;
            if (memo && memo.container && memo.container.isConnected) {
                memo.container.innerHTML = memo.html;
            }
            return { swapped: true };
        },

        peekIn(state) { paintMiniProfile(); },
    };

    function buildNameplate(value) {
        if (value.kind === 'video') {
            const video = document.createElement('video');
            video.className = 'miniprofile_nameplate';
            video.autoplay = true;
            video.muted = true;
            video.defaultMuted = true;
            video.loop = true;
            video.playsInline = true;
            video.setAttribute('muted', '');
            video.setAttribute('playsinline', '');
            if (value.poster) video.poster = value.poster;
            if (value.webm) {
                const source = document.createElement('source');
                source.src = value.webm;
                source.type = 'video/webm';
                video.appendChild(source);
            }
            if (value.mp4) {
                const source = document.createElement('source');
                source.src = value.mp4;
                source.type = 'video/mp4';
                video.appendChild(source);
            }
            return video;
        }
        const img = document.createElement('img');
        img.className = 'miniprofile_nameplate';
        img.src = value.url;
        return img;
    }

    // Returns true if anything was painted.
    function paintMiniProfile() {
        const popup = miniPopup();
        if (!popup) return false;
        if (ownerMiniId && lastHoverMiniId && lastHoverMiniId !== ownerMiniId) return false;

        let painted = false;

        const miniState = slotState.miniProfile;
        const nameplate = miniState && miniState.active;
        const container = popup.querySelector('.miniprofile_nameplatecontainer');
        if (nameplate && container) {
            const already = miniProfileSlot.verify(miniState, nameplate);
            if (!already) {
                // Only capture the original once per container: a repaint
                // would otherwise save our own markup as "the original".
                if (!miniState.miniMemo || miniState.miniMemo.container !== container) {
                    miniState.miniMemo = { container, html: container.innerHTML };
                }
                container.innerHTML = '';
                container.appendChild(buildNameplate(nameplate));
                painted = true;
            }
        }

        // The popup carries its own copies of the avatar and frame, and it
        // didn't exist when those slots collected their targets.
        const frameValue = slotState.avatarFrame && slotState.avatarFrame.active;
        const frameEl = popup.querySelector('.playersection_avatar_frame');
        if (frameValue && frameEl && !sameFile(currentImageUrl(frameEl), frameValue.url)) {
            setImageSources(frameEl, frameValue.url);
            painted = true;
        }

        const avatarValue = slotState.avatar && slotState.avatar.active;
        const avatarEl = popup.querySelector('.playersection_avatar');
        if (avatarValue && avatarEl && !sameFile(currentImageUrl(avatarEl), avatarValue.url)) {
            setImageSources(avatarEl, avatarValue.url);
            painted = true;
        }

        return painted;
    }

    function watchMiniProfile() {
        // Capture phase: the popup is opened by Steam's own handlers, and we
        // need to know who was hovered before it renders.
        document.addEventListener('mouseover', (e) => {
            const holder = e.target && e.target.closest && e.target.closest('[data-miniprofile]');
            if (holder) lastHoverMiniId = holder.getAttribute('data-miniprofile') || '';
        }, true);

        let timer = null;
        const observer = new MutationObserver(() => {
            if (peeking) return;
            // Cheap bail-out: this fires on every mutation on the page.
            const relevant = (slotState.miniProfile && slotState.miniProfile.active)
                || (slotState.avatarFrame && slotState.avatarFrame.active)
                || (slotState.avatar && slotState.avatar.active);
            if (!relevant) return;
            clearTimeout(timer);
            timer = setTimeout(paintMiniProfile, 30);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ---------------- theme ----------------
    //
    // Steam does this two ways, and the slot handles both:
    //   free themes   -> a class on <body>, e.g. SummerTheme
    //   bought themes -> GameProfile_<appid>_<item>_Theme, whose colours come
    //                    from CSS variables (inline on shop previews, from a
    //                    stylesheet on real profiles)
    // Every profile page loads the same stylesheets, so a captured class
    // resolves anywhere; the variables are captured as computed values, which
    // covers both sources without caring which one it was.

    const THEME_VARS = [
        '--gradient-right', '--gradient-left', '--gradient-background',
        '--gradient-background-right', '--gradient-background-left',
        '--color-showcase-header', '--gradient-showcase-header-left',
        '--btn-background', '--btn-background-hover', '--btn-outline',
    ];

    const THEME_CLASS = /(^|\s)([A-Za-z0-9_]*Theme)(?=\s|$)/g;

    // Built-in themes are a plain class whose colours live in Steam's own
    // stylesheet: Summer, Midnight, Steel, Cosmic, Dark Mode, Purple and
    // whatever they add next. No game behind them — the name is the identity,
    // so derive it from the class rather than keeping a list that goes stale.
    const BUILTIN_THEMES = {
        DefaultTheme: 'Default',
        DarkModeTheme: 'Dark Mode',
    };

    // A "Special Profile" — the bundles that override any theme setting —
    // renders with the generic GameProfileTheme class, transparent gradients,
    // and neutral button tints, with no appid anywhere in the page. It is a
    // real theme even though every gradient is transparent, so a blank-gradient
    // test alone would wrongly call it "no theme".
    const SPECIAL_PROFILE_MARKERS = {
        '--btn-background': /rgba\(0,\s*0,\s*0,\s*\.?2\)/,
        '--btn-background-hover': /rgba?\(255,\s*255,\s*255,\s*\.?1\)/,
        '--btn-outline': /rgba?\(255,\s*255,\s*255,\s*\.?1\)/,
    };

    function looksLikeSpecialProfile(vars) {
        if (!vars) return false;
        for (const name of Object.keys(SPECIAL_PROFILE_MARKERS)) {
            const value = vars[name];
            if (!value || !SPECIAL_PROFILE_MARKERS[name].test(value.replace(/\s+/g, ' '))) return false;
        }
        return true;
    }

    function themeClassesOf(el) {
        const found = [];
        let match;
        THEME_CLASS.lastIndex = 0;
        while ((match = THEME_CLASS.exec(' ' + el.className + ' ')) !== null) {
            found.push(match[2]);
        }
        return found;
    }

    // The appid is right there in the class, and Steam's capsule art sits at a
    // predictable public URL — so a theme can have a real thumbnail and a real
    // name instead of a number.
    let appNames = {};

    function themeAppId(value) {
        if (value && value.appid) return value.appid;
        const match = /^GameProfile_(\d+)_/.exec((value && value.bodyClass) || '');
        return match ? match[1] : '';
    }

    // No guessing the appid from other equipped items: someone can wear a
    // background from one game and a theme from another, and naming the wrong
    // game sends people hunting for an item that isn't there. It also attached
    // bogus game names to free Steam themes, which have no appid at all.

    // Preview pages carry ?appid= even when <body> only has the generic class.
    function appIdFromUrl() {
        try {
            const value = new URLSearchParams(location.search).get('appid');
            return /^\d+$/.test(value || '') ? value : '';
        } catch (e) {
            return '';
        }
    }

    function capsuleUrls(appid) {
        return [
            'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/' + appid + '/capsule_231x87.jpg',
            'https://cdn.cloudflare.steamstatic.com/steam/apps/' + appid + '/capsule_231x87.jpg',
        ];
    }

    // GM_xmlhttpRequest rather than fetch: this is cross-origin from
    // steamcommunity.com, and the store API isn't reliably CORS-friendly.
    function requestJson(url) {
        return new Promise((resolve) => {
            if (typeof GM_xmlhttpRequest === 'undefined') {
                fetch(url, { credentials: 'omit' })
                    .then(res => res.json()).then(resolve).catch(() => resolve(null));
                return;
            }
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                onload: (res) => {
                    try { resolve(JSON.parse(res.responseText)); } catch (e) { resolve(null); }
                },
                onerror: () => resolve(null),
                ontimeout: () => resolve(null),
                timeout: 8000,
            });
        });
    }

    async function resolveAppName(appid) {
        if (!appid) return '';
        if (appNames[appid] !== undefined) return appNames[appid];
        const data = await requestJson(
            'https://store.steampowered.com/api/appdetails?appids=' + appid + '&filters=basic');
        const entry = data && data[appid];
        const name = (entry && entry.success && entry.data && entry.data.name) || '';
        appNames[appid] = name;   // cache misses too, so we ask once
        await store.set(APP_NAMES_KEY, JSON.stringify(appNames));
        return name;
    }

    function themeLabel(value) {
        if (!value) return '';
        const appid = themeAppId(value);
        if (appid && appNames[appid]) return appNames[appid];
        return value.label || prettyThemeName(value.bodyClass);
    }

    function prettyThemeName(bodyClass, appid, vars) {
        if (!bodyClass) return 'Theme';
        if (BUILTIN_THEMES[bodyClass]) return BUILTIN_THEMES[bodyClass];
        const game = /^GameProfile_(\d+)_(\d+)_Theme$/.exec(bodyClass);
        if (game) return 'Game theme ' + game[1] + '/' + game[2];
        if (bodyClass === 'GameProfileTheme') {
            if (appid) return 'Game theme ' + appid;
            // Steam doesn't put the game anywhere in the page for these.
            return looksLikeSpecialProfile(vars) ? 'Special Profile theme' : 'Game theme';
        }
        // PurpleTheme -> Purple, DarkModeTheme -> Dark Mode
        return bodyClass.replace(/Theme$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
        return bodyClass.replace(/Theme$/, '') || bodyClass;
    }

    const themeSlot = {
        id: 'theme',
        label: 'Theme',
        kinds: ['theme'],

        find() { return document.body; },

        snapshot() {
            const body = document.body;
            if (!body) return { value: null, meta: {} };
            const classes = themeClassesOf(body);
            const computed = window.getComputedStyle(body);
            const vars = {};
            for (const name of THEME_VARS) {
                const value = computed.getPropertyValue(name).trim();
                if (value) vars[name] = value;
            }
            if (!classes.length && !Object.keys(vars).length) return { value: null, meta: {} };

            // Pages carry both the generic GameProfileTheme and the specific
            // GameProfile_<appid>_<item>_Theme. Taking the first one found lost
            // the appid — and with it the capsule art and the game's name.
            const specific = classes.find(cls => /^GameProfile_\d+_\d+_Theme$/.test(cls));
            const named = classes.find(cls => cls !== 'GameProfileTheme');
            const bodyClass = specific || named || classes[0] || '';

            // No "all transparent means no theme" shortcut: a real theme can
            // be transparent at the top of the page and coloured further down.
            const fromClass = /^GameProfile_(\d+)_/.exec(bodyClass);
            const appid = fromClass ? fromClass[1] : appIdFromUrl();

            return {
                value: {
                    kind: 'theme', bodyClass, appid, vars,
                    label: prettyThemeName(bodyClass, appid, vars),
                },
                meta: {},
            };
        },

        apply(state, value) {
            const body = document.body;
            if (!body) return { ok: false, message: 'No page body to theme.' };

            if (!state.original) {
                const inline = {};
                for (const name of THEME_VARS) inline[name] = body.style.getPropertyValue(name);
                state.original = { className: body.className, inline };
            }

            for (const cls of themeClassesOf(body)) body.classList.remove(cls);
            if (value.bodyClass) body.classList.add(value.bodyClass);
            // Shop previews use the generic class with inline variables; adding
            // it makes those variables apply on a normal profile page too.
            if (Object.keys(value.vars || {}).length) body.classList.add('GameProfileTheme');

            for (const name of THEME_VARS) {
                const next = (value.vars || {})[name];
                if (next) body.style.setProperty(name, next);
                else body.style.removeProperty(name);
            }

            state.targetEl = body;
            return { ok: true, message: 'Theme applied: ' + (value.label || value.bodyClass) + '.' };
        },

        verify(state, value) {
            const body = document.body;
            if (!body) return false;
            if (value.bodyClass && !body.classList.contains(value.bodyClass)) return false;
            for (const name of Object.keys(value.vars || {})) {
                if (body.style.getPropertyValue(name) !== value.vars[name]) return false;
            }
            return true;
        },

        restore(state) {
            const body = document.body;
            if (!body || !state.original) return;
            body.className = state.original.className;
            for (const name of THEME_VARS) {
                const previous = state.original.inline[name];
                if (previous) body.style.setProperty(name, previous);
                else body.style.removeProperty(name);
            }
        },

        peekOut(state) {
            this.restore(state);
            return { swapped: true };
        },

        peekIn(state) {
            if (state.active) this.apply(state, state.active);
        },
    };

    const SLOTS = [backgroundSlot, avatarFrameSlot, avatarSlot, miniProfileSlot, themeSlot];
    const SLOT_BY_ID = {};
    for (const slot of SLOTS) SLOT_BY_ID[slot.id] = slot;

    // =================================================================
    // Engine
    // =================================================================

    const slotState = {};
    for (const slot of SLOTS) {
        slotState[slot.id] = { original: null, targetEl: null, active: null, neutralized: [], peek: null, created: false, targets: null };
    }

    let pageSnapshot = {};      // slotId -> { value, meta }
    let snapshotTaken = false;
    let peeking = false;
    let autoReapply = true;
    let numberKeys = true;
    let confirmDelete = false;
    let failedReapplies = 0;
    let statusEl = null;

    function setStatus(message, isError) {
        console.log('[previewer]', message);
        if (!statusEl) return;
        statusEl.textContent = message;
        statusEl.style.color = isError ? '#ff6b6b' : '#8fbc8f';
    }

    // ---------------- whose profile is this ----------------
    //
    // Apply paints over the owner's look, which only makes sense on your own
    // profile; anywhere else the panel is grab-only. Measured against
    // fixtures/clean/ (three own pages, two other people's): all three
    // strategies agree on every one. The script is sandboxed, so page globals
    // are read out of the inline script text rather than off window.

    function inlineScriptText() {
        return Array.from(document.querySelectorAll('script:not([src])'))
            .map(s => s.textContent).join('\n');
    }

    function viewerInfo() {
        const config = document.getElementById('application_config');
        let info = {};
        try { info = JSON.parse((config && config.getAttribute('data-userinfo')) || '{}') || {}; }
        catch (e) { info = {}; }
        if (!info.steamid) {
            const m = /\bg_steamID\s*=\s*"(\d+)"/.exec(inlineScriptText());
            if (m) info.steamid = m[1];
        }
        return info;
    }

    const OWNERSHIP_STRATEGIES = [
        {
            // Steam's own answer, emitted beside g_rgProfileData.
            name: 'g_bViewingOwnProfile',
            test() {
                const m = /\bg_bViewingOwnProfile\s*=\s*(\w+)/.exec(inlineScriptText());
                return m ? (m[1] === '1' || m[1] === 'true') : null;
            },
        },
        {
            name: 'viewer steamid vs g_rgProfileData.steamid',
            test() {
                const viewer = viewerInfo().steamid;
                const m = /\bg_rgProfileData\s*=\s*\{[^;]*?"steamid"\s*:\s*"(\d+)"/.exec(inlineScriptText());
                return (viewer && m) ? String(viewer) === m[1] : null;
            },
        },
        {
            name: 'viewer accountid vs header avatar data-miniprofile',
            test() {
                const viewer = viewerInfo().accountid;
                const owner = document.querySelector('.playerAvatar.profile_header_size[data-miniprofile]');
                return (viewer && owner) ? String(viewer) === owner.getAttribute('data-miniprofile') : null;
            },
        },
    ];

    let ownership = { owns: null, via: '' };
    let applyEverywhere = false;

    function detectOwnership() {
        if (ownership.owns !== null) return ownership;
        for (const strategy of OWNERSHIP_STRATEGIES) {
            let owns = null;
            try { owns = strategy.test(); } catch (e) { /* try the next one */ }
            if (owns === null) continue;
            ownership = { owns, via: strategy.name };
            console.log('[previewer] own profile: ' + owns + ' (via ' + strategy.name + ')');
            return ownership;
        }
        return ownership;
    }

    // Boot can fire before the markers have parsed in (on a preview page the
    // outer .no_header comes first), so an undecided page gets until
    // DOMContentLoaded before giving up.
    async function resolveOwnership() {
        if (detectOwnership().owns === null && document.readyState === 'loading') {
            await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
            detectOwnership();
        }
        if (ownership.owns === null) console.warn('[previewer] could not tell whose profile this is — allowing Apply');
        return ownership;
    }

    // Steam's own item preview (?previewprofile=1) is there to show one item
    // on your profile; painting the try-on over it hides the very thing
    // being inspected. Grab-only, even though it's your profile.
    function onSteamPreview() {
        return new URLSearchParams(location.search).get('previewprofile') === '1';
    }

    // Undecided means detection broke, not that the page is someone else's:
    // fail open, so a Steam rename can't lock people out of their own profile.
    function applyHere() {
        if (ON_STORE) return false;
        if (applyEverywhere) return true;
        return !onSteamPreview() && ownership.owns !== false;
    }

    function snapshotPage() {
        if (snapshotTaken) return;
        const owner = document.querySelector('.playerAvatar.profile_header_size[data-miniprofile]')
            || document.querySelector('[data-miniprofile]');
        ownerMiniId = owner ? (owner.getAttribute('data-miniprofile') || '') : '';
        pageSnapshot = {};
        for (const slot of SLOTS) {
            try { pageSnapshot[slot.id] = slot.snapshot(); }
            catch (e) {
                console.warn('[previewer] snapshot failed for', slot.id, e);
                pageSnapshot[slot.id] = { value: null, meta: {} };
            }
        }
        snapshotTaken = true;
        console.log('[previewer] page snapshot:', pageSnapshot);
    }

    // Volatile slots (anything built on demand, like the mini profile popup)
    // have nothing to snapshot at page load, so re-read them when asked.
    // Skipped once the slot is applied, or we'd capture our own paint back.
    async function refreshVolatileSnapshot(slotId) {
        const slot = SLOT_BY_ID[slotId];
        if (!slot || !slot.volatile) return;
        if (slotState[slotId].active) return;

        let fetched = null;
        if (slot.ensure) {
            try { fetched = await slot.ensure(); }
            catch (e) { console.warn('[previewer] ensure failed for', slotId, e); }
        }
        try {
            const snap = slot.snapshot();
            if (snap && snap.value) { pageSnapshot[slotId] = snap; return; }
        } catch (e) {
            console.warn('[previewer] volatile snapshot failed for', slotId, e);
        }
        if (fetched) pageSnapshot[slotId] = { value: fetched, meta: {} };
    }

    function anyActive() {
        return SLOTS.some(slot => slotState[slot.id].active);
    }

    function activeSet() {
        const out = {};
        for (const slot of SLOTS) {
            const value = slotState[slot.id].active;
            if (value) out[slot.id] = value;
        }
        return out;
    }

    function applySlot(slotId, rawValue) {
        const slot = SLOT_BY_ID[slotId];
        if (!slot) return false;
        const value = normalizeValue(rawValue);
        if (!value) { setStatus('Nothing to apply for ' + slot.label + '.', true); return false; }

        const problem = validateValue(value);
        if (problem) { setStatus(slot.label + ': ' + problem, true); return false; }

        const state = slotState[slotId];
        const meta = (pageSnapshot[slotId] && pageSnapshot[slotId].meta) || {};

        // Async outcomes (media events, load probes) report back here.
        const report = (result) => {
            if (result.reapply) { applySlot(slotId, result.reapply); return; }
            setStatus(result.message, !result.ok);
        };

        let result;
        try { result = slot.apply(state, value, meta, report); }
        catch (e) {
            console.warn('[previewer] apply failed for', slotId, e);
            setStatus(slot.label + ': something went wrong applying that.', true);
            return false;
        }

        if (!result || !result.ok) {
            setStatus(slot.label + ': ' + ((result && result.message) || 'could not apply.'), true);
            return false;
        }
        state.active = value;
        setStatus(result.message, false);
        return true;
    }

    function clearSlot(slotId, quiet) {
        const slot = SLOT_BY_ID[slotId];
        const state = slotState[slotId];
        if (!slot) return;
        try { slot.restore(state); }
        catch (e) { console.warn('[previewer] restore failed for', slotId, e); }
        state.original = null;
        state.targetEl = null;
        state.active = null;
        state.created = false;
        state.targets = null;
        if (!quiet) setStatus(slot.label + ' cleared.', false);
    }

    function clearAll(quiet) {
        for (const slot of SLOTS) clearSlot(slot.id, true);
        if (!quiet) setStatus('Cleared.', false);
    }

    function peekStart() {
        if (peeking || !anyActive()) return;
        peeking = true;
        for (const slot of SLOTS) {
            const state = slotState[slot.id];
            if (!state.active) continue;
            try { state.peek = slot.peekOut(state); }
            catch (e) { console.warn('[previewer] peekOut failed for', slot.id, e); }
        }
        setStatus('Peeking at this page\u2019s own look\u2026', false);
    }

    function peekEnd() {
        if (!peeking) return;
        for (const slot of SLOTS) {
            const state = slotState[slot.id];
            if (!state.peek) continue;
            try { slot.peekIn(state, state.peek); }
            catch (e) { console.warn('[previewer] peekIn failed for', slot.id, e); }
            state.peek = null;
        }
        peeking = false;
        setStatus('Back to your version.', false);
    }

    function allStillApplied() {
        for (const slot of SLOTS) {
            const state = slotState[slot.id];
            if (!state.active) continue;
            let ok = false;
            try { ok = slot.verify(state, state.active); } catch (e) { ok = false; }
            if (!ok) return false;
        }
        return true;
    }

    function reapplyActive(reason) {
        if (!autoReapply || peeking || !anyActive() || !applyHere()) return;
        console.log('[previewer] re-applying:', reason);
        for (const slot of SLOTS) {
            const value = slotState[slot.id].active;
            if (value) applySlot(slot.id, value);
        }
    }

    function isTypingTarget(el) {
        if (!el) return false;
        const tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    }

    // ---------------- watchers ----------------

    let clobberTimer = null;

    function watchForClobber() {
        const observer = new MutationObserver(() => {
            if (!autoReapply || peeking || !anyActive()) return;
            clearTimeout(clobberTimer);
            clobberTimer = setTimeout(() => {
                if (peeking || allStillApplied()) { failedReapplies = 0; return; }
                if (failedReapplies >= 3) {
                    if (autoReapply) {
                        autoReapply = false;
                        setStatus('The page keeps resetting things \u2014 auto-reapply paused.', true);
                    }
                    return;
                }
                failedReapplies++;
                reapplyActive('page reset something');
            }, 300);
        });
        observer.observe(document.body, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'src', 'srcset'],
        });
    }

    function handleUrlChange() {
        for (const slot of SLOTS) {
            const state = slotState[slot.id];
            restoreAncestors(state.neutralized);
            if (slot.removeInjected) slot.removeInjected();
            state.original = null;
            state.targetEl = null;
            state.peek = null;
            state.created = false;
            state.targets = null;
        }
        peeking = false;
        snapshotTaken = false;
        failedReapplies = 0;
        ownership = { owns: null, via: '' };
        setTimeout(() => {
            snapshotPage();
            detectOwnership();
            reapplyActive('navigation');
            if (onApplyModeChange) onApplyModeChange();
        }, 300);
    }

    // Set by the panel, so a navigation can relabel it for the new page.
    let onApplyModeChange = null;

    function watchForNavigation() {
        let lastUrl = location.href;
        // Polling rather than patching history.pushState: the userscript
        // sandbox and the page see different window objects.
        setInterval(() => {
            if (location.href === lastUrl) return;
            lastUrl = location.href;
            handleUrlChange();
        }, 1000);
        window.addEventListener('popstate', handleUrlChange);
    }

    // =================================================================
    // Panel
    // =================================================================

    // ---------------- points shop capture ----------------
    //
    // The Points Shop previews items in an in-page modal rather than opening
    // a profile, and it lives on store.steampowered.com. There's no profile
    // there to modify, so that page is capture-only: grab the previewed item
    // into a slot, save it as a preset, and it's waiting on any profile page.
    // Storage is per-script rather than per-origin, so both domains share it.

    const ON_STORE = location.hostname === 'store.steampowered.com';

    // Order matters: the first match wins when a label is genuinely ambiguous
    // ("Mini-Profile Background" contains "Profile Background").
    const STORE_TYPE_PATTERNS = [
        { slot: 'miniProfile', test: /mini[-\s]?profile/i },
        { slot: 'avatarFrame', test: /avatar frame/i },
        // "avatar" but not "avatar frame", so a frame can't match both.
        { slot: 'avatar', test: /animated avatar|\bavatar\b(?!\s*frame)/i },
        { slot: 'background', test: /profile background/i },
    ];

    // Language-independent typing. Amid the hashed class names Steam keeps a
    // few semantic ones, and they differ per item type:
    //   mini profile -> a .miniprofile_* element in the preview
    //   avatar       -> the previewed image itself carries .avatar
    //   avatar frame -> an img.avatar is on show, but the item is another image
    //   background   -> no avatar anywhere; a video or a CSS background-image
    // This also works for items the user already owns, since it never reads
    // the purchase text.
    function detectSlotStructural(root, mediaEl) {
        if (!root || !mediaEl) return '';
        if (root.querySelector('[class*="miniprofile"]')) return 'miniProfile';
        if (mediaEl.classList && mediaEl.classList.contains('avatar')) return 'avatar';
        if (root.querySelector('img.avatar')) {
            return mediaEl.tagName === 'IMG' ? 'avatarFrame' : '';
        }
        return 'background';
    }

    function withArticle(text) {
        return (/^[aeiou]/i.test(text || '') ? 'an ' : 'a ') + text;
    }

    function slotFromLabel(label) {
        for (const entry of STORE_TYPE_PATTERNS) {
            if (entry.test.test(label)) return entry.slot;
        }
        return '';
    }

    // Every shop modal states the type exactly once, in a fixed sentence:
    // "Use your Steam Points to get this Mini Profile Background." Matching
    // just that phrase beats scanning the whole modal, where an avatar's
    // description mentioning "mini profile" was enough to misfile it — and the
    // avatar's own ancestors carry no text at all to narrow it down.
    function detectSlotFromContext(mediaEl, fallbackRoot) {
        const blob = ((fallbackRoot && fallbackRoot.textContent) || '').replace(/\s+/g, ' ');
        const stated = /get this ([^.]{2,60})\./i.exec(blob);
        if (stated) {
            const slot = slotFromLabel(stated[1]);
            if (slot) return slot;
        }

        // Tiles have no such sentence: fall back to widening out from the
        // media until exactly one type matches.
        let node = mediaEl;
        for (let depth = 0; node && depth < 5; depth++) {
            const text = node.textContent || '';
            const hits = STORE_TYPE_PATTERNS.filter(entry => entry.test.test(text));
            if (hits.length === 1) return hits[0].slot;
            node = node.parentElement;
        }
        return slotFromLabel(blob);
    }

    function storeModal() {
        return document.querySelector('.FullModalOverlay dialog[open]')
            || document.querySelector('dialog[open]')
            || document.querySelector('.FullModalOverlay .ModalOverlayContent.active')
            || null;
    }

    const ITEM_ASSET = /\/community_assets\/images\/items\/(\d+)\//;
    // Steam sometimes emits a <source> whose src ends in ".../undefined" next
    // to the real one. Real assets always end in a file extension.
    const ITEM_FILE = /\/[^\/?#]+\.[a-z0-9]{2,5}(?:[?#]|$)/i;
    const isItemAsset = url => !!url && ITEM_ASSET.test(url) && ITEM_FILE.test(url);

    // Pulls an item out of any container: a shop tile or a preview modal.
    // Videos before images, because a video item's poster is also an image.
    function previewFromContainer(root, scope) {
        if (!root || !root.querySelectorAll) return null;
        const inScope = url => isItemAsset(url) && (!scope || scope.test(url));
        const areaOf = (el) => {
            const rect = el.getBoundingClientRect();
            return rect.width * rect.height;
        };

        // Collect everything, then take the biggest. Taking the first in
        // document order could pick the user's own equipped frame instead of
        // the item being previewed; the preview is always the largest thing.
        const candidates = [];

        for (const video of root.querySelectorAll('video')) {
            const clip = { kind: 'video', mp4: '', webm: '', poster: '' };
            const poster = video.getAttribute('poster') || '';
            if (inScope(poster)) clip.poster = poster;
            for (const source of video.querySelectorAll('source')) {
                const src = source.getAttribute('src') || '';
                if (!inScope(src)) continue;
                const type = source.getAttribute('type') || '';
                if (/\.webm/i.test(src) || type.includes('webm')) clip.webm = clip.webm || src;
                else if (/\.mp4/i.test(src) || type.includes('mp4')) clip.mp4 = clip.mp4 || src;
            }
            if (clip.mp4 || clip.webm) candidates.push({ value: clip, el: video, area: areaOf(video) });
            else if (clip.poster) {
                candidates.push({ value: { kind: 'image', url: clip.poster }, el: video, area: areaOf(video) });
            }
        }

        for (const img of root.querySelectorAll('img')) {
            const src = img.getAttribute('src') || '';
            if (!inScope(src)) continue;
            candidates.push({ value: { kind: 'image', url: src }, el: img, area: areaOf(img) });
        }

        // Static backgrounds aren't an <img> at all — they're painted as a CSS
        // background-image on a div.
        for (const el of root.querySelectorAll('[style*="background-image"]')) {
            const url = urlFromCssValue(el.getAttribute('style') || '');
            if (!inScope(url)) continue;
            candidates.push({ value: { kind: 'image', url }, el, area: areaOf(el) });
        }

        if (!candidates.length) return null;
        candidates.sort((a, b) => b.area - a.area);
        const best = candidates[0];

        return {
            slotId: detectSlotStructural(root, best.el) || detectSlotFromContext(best.el, root),
            value: best.value,
            title: '',
            mediaEl: best.el,
        };
    }

    function requestText(url) {
        return new Promise((resolve) => {
            if (typeof GM_xmlhttpRequest === 'undefined') {
                fetch(url, { credentials: 'omit' })
                    .then(res => res.text()).then(resolve).catch(() => resolve(''));
                return;
            }
            GM_xmlhttpRequest({
                method: 'GET', url,
                onload: (res) => resolve(res.responseText || ''),
                onerror: () => resolve(''),
                ontimeout: () => resolve(''),
                timeout: 10000,
            });
        });
    }

    function firstSrcset(el) {
        if (!el) return '';
        const img = el.tagName === 'IMG' ? el : el.querySelector('img');
        if (img) {
            const src = img.getAttribute('src');
            if (src) return src;
            const set = img.getAttribute('srcset');
            if (set) return set.split(',')[0].trim().split(/\s+/)[0];
        }
        const source = el.querySelector && el.querySelector('source[srcset]');
        return source ? source.getAttribute('srcset').split(',')[0].trim().split(/\s+/)[0] : '';
    }

    // The store dialog embeds the real preview in a cross-origin <iframe>, so
    // the page itself can't be read from here — everything scrapeable in the
    // dialog is the little item list beside it, whose background thumbnail is
    // a ?size=320x200 crop. Fetching the iframe's URL gives the genuine page:
    // full-size assets and, unlike the dialog, the theme.
    function parsePreviewDocument(doc) {
        const slots = {};

        const header = Array.from(doc.querySelectorAll('.no_header'))
            .find(el => !el.querySelector('.no_header') && el.querySelector('.profile_header_bg'))
            || doc.querySelector('.profile_page.has_profile_background');

        const video = doc.querySelector('.profile_animated_background video');
        if (video) {
            const clip = { kind: 'video', mp4: '', webm: '', poster: video.getAttribute('poster') || '' };
            for (const source of video.querySelectorAll('source')) {
                const src = source.getAttribute('src') || '';
                const type = source.getAttribute('type') || '';
                if (/\.webm/i.test(src) || type.includes('webm')) clip.webm = clip.webm || src;
                else if (/\.mp4/i.test(src) || type.includes('mp4')) clip.mp4 = clip.mp4 || src;
            }
            if (clip.mp4 || clip.webm) slots.background = clip;
        }
        if (!slots.background && header) {
            const url = urlFromCssValue(header.getAttribute('style') || '');
            if (url) slots.background = { kind: 'image', url };
        }

        const frameUrl = firstSrcset(doc.querySelector('.profile_avatar_frame'));
        if (frameUrl) slots.avatarFrame = { kind: 'image', url: frameUrl };

        const avatarHolder = doc.querySelector('.playerAvatarAutoSizeInner > picture')
            || doc.querySelector('.playerAvatarAutoSizeInner > img');
        const avatarUrl = firstSrcset(avatarHolder);
        if (avatarUrl) slots.avatar = { kind: 'image', url: avatarUrl };

        // Themes ship as an inline rule on these pages, so read it as text
        // rather than via computed styles, which a parsed document has none of.
        const body = doc.body;
        const classes = body ? themeClassesOf(body) : [];
        const vars = {};
        for (const style of doc.querySelectorAll('style')) {
            const text = style.textContent || '';
            if (!/body\.[A-Za-z0-9_]*Theme/.test(text)) continue;
            for (const match of text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
                if (THEME_VARS.indexOf(match[1]) !== -1) vars[match[1]] = match[2].trim();
            }
        }
        if (classes.length || Object.keys(vars).length) {
            const specific = classes.find(cls => /^GameProfile_\d+_\d+_Theme$/.test(cls));
            const named = classes.find(cls => cls !== 'GameProfileTheme');
            const bodyClass = specific || named || classes[0] || 'GameProfileTheme';
            const fromClass = /^GameProfile_(\d+)_/.exec(bodyClass);
            const appid = fromClass ? fromClass[1] : '';
            slots.theme = {
                kind: 'theme', bodyClass, appid, vars,
                label: prettyThemeName(bodyClass, appid, vars),
            };
        }

        return slots;
    }

    function assetKey(url) {
        return (url || '').split('?')[0].split('/').pop();
    }

    // The mini profile isn't rendered on a profile page, so it comes from the
    // dialog's item list. Which entry it is gets settled by elimination against
    // the assets the preview page already gave us — no English labels involved.
    function miniFromBundleList(modal, known) {
        const seen = new Set();
        for (const value of Object.values(known)) {
            if (!value) continue;
            if (value.kind === 'image') seen.add(assetKey(value.url));
            else if (value.kind === 'video') {
                for (const key of ['mp4', 'webm', 'poster']) if (value[key]) seen.add(assetKey(value[key]));
            }
        }

        const entries = [];
        for (const img of modal.querySelectorAll('img')) {
            const src = img.getAttribute('src') || '';
            if (!ITEM_ASSET.test(src)) continue;
            entries.push(src.split('?')[0]);
        }
        // First entry is the bundle's own cover art, not a wearable item.
        const candidates = entries.slice(1).filter(url => !seen.has(assetKey(url)));
        return candidates.length ? { kind: 'image', url: candidates[0] } : null;
    }

    // The fetched page only identifies the theme by its generic class, but the
    // dialog shows the bundle's real name beside the cover art — "Beach Boil",
    // "Summer Sale 2026". Read it from there instead of settling for
    // "Special Profile theme". It's a proper noun, so no language issue.
    function bundleTitle(modal) {
        for (const img of modal.querySelectorAll('img')) {
            const src = img.getAttribute('src') || '';
            if (!ITEM_ASSET.test(src)) continue;
            let node = img.parentElement;
            for (let depth = 0; node && depth < 3; depth++) {
                const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
                if (text) return text.split(/\s{2,}|(?=[A-Z][a-z]+ Profile$)/)[0].slice(0, 60);
                node = node.parentElement;
            }
            break;   // only the first entry, which is the bundle's own cover
        }
        return '';
    }

    // Bundle titles often end in "... Profile", which adds nothing once the
    // value is already sitting in a row labelled Theme.
    function trimThemeTitle(title) {
        return (title || '').replace(/\s*\bProfile\s*$/i, '').trim();
    }

    // The first item asset in the dialog is the bundle's own cover art — a
    // better thumbnail for a Special Profile than a flat colour swatch.
    function bundleCover(modal) {
        for (const img of modal.querySelectorAll('img')) {
            const src = img.getAttribute('src') || '';
            if (ITEM_ASSET.test(src)) return src.split('?')[0];
        }
        return '';
    }

    let bundleCache = { url: '', slots: null };

    async function bundleFromPreviewFrame(modal) {
        const frame = modal.querySelector('iframe[src*="previewprofile=1"]');
        const url = frame ? frame.getAttribute('src') : '';
        if (!url) return null;

        const clean = url.replace(/&amp;/g, '&');
        // Cached so a per-slot grab doesn't refetch the same page.
        if (bundleCache.url === clean && bundleCache.slots) return bundleCache.slots;

        const html = await requestText(clean);
        if (!html) return null;

        const doc = new DOMParser().parseFromString(html, 'text/html');
        const slots = parsePreviewDocument(doc);
        const mini = miniFromBundleList(modal, slots);
        if (mini) slots.miniProfile = mini;

        const title = trimThemeTitle(bundleTitle(modal));
        if (slots.theme) {
            if (title) slots.theme.label = title;
            const cover = bundleCover(modal);
            if (cover) slots.theme.thumb = cover;
        }

        if (!Object.keys(slots).length) return null;
        bundleCache = { url: clean, slots };
        return slots;
    }

    // A "Game Profile" bundle previews every piece at once — background,
    // avatar, frame, mini profile and theme. Taking only the largest asset
    // grabbed whichever image happened to be biggest and filed it as a
    // background. This pulls each piece out and assigns it by structure.
    function bundleFromContainer(root, scope) {
        if (!root || !root.querySelectorAll) return null;
        const inScope = url => isItemAsset(url) && (!scope || scope.test(url));
        const found = {};

        const claim = (slotId, value, el) => {
            if (!slotId || found[slotId]) return;
            found[slotId] = { value, el, area: el ? el.getBoundingClientRect().width * el.getBoundingClientRect().height : 0 };
        };

        const classifyEl = (el) => {
            if (el.closest('[class*="miniprofile"]')) return 'miniProfile';
            if (el.closest('[class*="frame"]') || /frame/i.test(el.className || '')) return 'avatarFrame';
            if (el.closest('[class*="avatar"]') || /\bavatar\b/i.test(el.className || '')) return 'avatar';
            return '';
        };

        for (const video of root.querySelectorAll('video')) {
            const clip = { kind: 'video', mp4: '', webm: '', poster: '' };
            const poster = video.getAttribute('poster') || '';
            if (inScope(poster)) clip.poster = poster;
            for (const source of video.querySelectorAll('source')) {
                const src = source.getAttribute('src') || '';
                if (!inScope(src)) continue;
                const type = source.getAttribute('type') || '';
                if (/\.webm/i.test(src) || type.includes('webm')) clip.webm = clip.webm || src;
                else if (/\.mp4/i.test(src) || type.includes('mp4')) clip.mp4 = clip.mp4 || src;
            }
            if (!clip.mp4 && !clip.webm) continue;
            claim(classifyEl(video) || 'background', clip, video);
        }

        for (const img of root.querySelectorAll('img')) {
            const src = img.getAttribute('src') || '';
            if (!inScope(src)) continue;
            claim(classifyEl(img), { kind: 'image', url: src }, img);
        }

        // Static backgrounds are painted as CSS, not <img>.
        for (const el of root.querySelectorAll('[style*="background-image"]')) {
            const url = urlFromCssValue(el.getAttribute('style') || '');
            if (!inScope(url)) continue;
            claim(classifyEl(el) || 'background', { kind: 'image', url }, el);
        }

        // The bundle's colours, if the preview carries them.
        const themed = root.querySelector('[style*="--gradient"], [class*="Theme"]');
        if (themed) {
            const computed = window.getComputedStyle(themed);
            const vars = {};
            for (const name of THEME_VARS) {
                const value = computed.getPropertyValue(name).trim();
                if (value) vars[name] = value;
            }
            if (Object.keys(vars).length) {
                const link = root.querySelector('a[href*="/points/shop/app/"]');
                const match = link ? (link.getAttribute('href') || '').match(/\/app\/(\d+)/) : null;
                const appid = match ? match[1] : '';
                found.theme = {
                    value: {
                        kind: 'theme', bodyClass: 'GameProfileTheme', appid, vars,
                        label: prettyThemeName('GameProfileTheme', appid, vars),
                    },
                    el: themed,
                };
            }
        }

        const slots = {};
        for (const id of Object.keys(found)) slots[id] = found[id].value;
        return Object.keys(slots).length >= 2 ? slots : null;
    }

    // Returns { slotId, value, title } describing whatever the modal shows.
    function storePreviewValue() {
        const modal = storeModal();
        if (!modal) return null;

        // The item's own assets sit under /items/<appid>/. Scoping to that
        // skips your own avatar frame and the app capsule in the same modal.
        const link = modal.querySelector('a[href*="/points/shop/app/"]');
        const appMatch = link ? (link.getAttribute('href') || '').match(/\/app\/(\d+)/) : null;
        const scope = appMatch ? new RegExp('/items/' + appMatch[1] + '/') : null;

        // Scope to the item's own appid first; if that finds nothing, retry
        // accepting any Steam item media in the modal.
        // A Game Profile bundle contains several items at once; grabbing it as
        // a single asset picked whichever image was largest and mislabelled it.
        // Bundles get no unscoped retry: every piece shares the bundle's appid,
        // and an unscoped pass counts the viewer's own equipped frame as a
        // second piece, turning any single item into a fake two-piece bundle.
        const bundle = bundleFromContainer(modal, scope);

        const found = previewFromContainer(modal, scope) || previewFromContainer(modal, null);
        if (!found) return bundle ? { slotId: '', value: null, title: '', bundle } : null;
        found.bundle = bundle;

        const titleNode = modal.querySelector('h1, h2, [class*="title"]');
        found.title = titleNode ? titleNode.textContent.trim().slice(0, 60) : '';
        return found;
    }

    // Clicking our panel counts as a click outside Steam's modal, so Steam
    // dismisses the preview before Grab can read it. Remember each preview as
    // it appears and read the remembered value instead of racing the DOM.
    let lastStorePreview = null;

    // Registered at document-start, so these run before Steam's own document
    // listeners. Capture: snapshot the preview before Steam can close it, so
    // the first Grab click works. Bubble: stopImmediatePropagation kills
    // Steam's dismiss listener on the same node — plain stopPropagation can't,
    // since it only stops OTHER nodes.
    //
    // mouseup and mousemove are deliberately not guarded: the panel drag ends
    // on document mouseup, and blocking it leaves the panel stuck to the cursor.
    function guardPanelClicks() {
        const inPanel = (e) => {
            const t = e.target;
            return !!(t && t.closest && t.closest('#pp-panel'));
        };
        for (const type of ['pointerdown', 'mousedown', 'click']) {
            document.addEventListener(type, (e) => {
                if (!inPanel(e)) return;
                const preview = storePreviewValue();
                if (preview) lastStorePreview = preview;
            }, true);
            document.addEventListener(type, (e) => {
                if (inPanel(e)) e.stopImmediatePropagation();
            }, false);
        }

        // Capture-phase blocking is the only thing that can beat Steam's
        // dismiss handler, but it also stops the event reaching our own
        // controls — that's what killed the buttons in 1.10 and stuck the
        // panel to the cursor in 1.11. So block exactly one event type that
        // nothing of ours listens for: buttons use click, dragging uses
        // mousedown. If Steam dismisses on pointerdown this keeps the preview
        // open; if it dismisses on something else, this costs nothing.
        document.addEventListener('pointerdown', (e) => {
            if (inPanel(e)) e.stopImmediatePropagation();
        }, true);
    }

    function watchStorePreviews() {
        let timer = null;
        const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const preview = storePreviewValue();
                if (preview) lastStorePreview = preview;
            }, 100);
        });
        observer.observe(document.body, { childList: true, subtree: true });
        const initial = storePreviewValue();
        if (initial) lastStorePreview = initial;

        // The reliable one: just look, repeatedly. Whatever the preview is,
        // it's cached before you click anything, so Grab never has to race
        // Steam's close handler.
        setInterval(() => {
            const preview = storePreviewValue();
            if (preview) lastStorePreview = preview;
        }, 250);

        // Second capture point: the tile itself. Shop tiles
        // already carry the item's sources, poster and type label, so this
        // records the item before any modal exists — and survives Steam
        // closing that modal the moment our panel is clicked.
        document.addEventListener('pointerdown', (e) => {
            const target = e.target;
            if (!target || !target.closest || target.closest('#pp-panel')) return;
            // Walk outwards from the click: the first ancestor holding item
            // media is the tile, not the whole grid.
            let node = target;
            for (let depth = 0; node && node !== document.body && depth < 8; depth++) {
                const found = previewFromContainer(node, null);
                if (found) { lastStorePreview = found; return; }
                node = node.parentElement;
            }
        }, true);
    }

    function slotRowsMarkup() {
        return SLOTS.map(slot => {
            const kindToggle = slot.kinds.length > 1
                ? `<div style="margin-bottom:6px; font-size:11px;">` +
                  slot.kinds.map((kind, i) => `<label style="margin-right:10px; cursor:pointer;">
                      <input type="radio" name="ppKind_${slot.id}" value="${kind}"${i === 0 ? ' checked' : ''}>
                      ${kind === 'image' ? 'Image' : 'Video'}
                  </label>`).join('') + `</div>`
                : '';

            const fieldGroups = slot.kinds.map((kind, i) => {
                const inputs = KIND_FIELDS[kind].map(field =>
                    `<input data-slot="${slot.id}" data-kind="${kind}" data-field="${field.key}"
                        type="text" placeholder="${field.placeholder}"
                        style="width:100%; box-sizing:border-box; margin-bottom:6px; padding:4px;">`
                ).join('');
                return `<div data-fields="${slot.id}" data-kind="${kind}"
                    style="display:${i === 0 ? '' : 'none'};">${inputs}</div>`;
            }).join('');

            // Kinds with no editable fields (the theme) show what's held instead.
            const info = slot.kinds.some(kind => !(KIND_FIELDS[kind] || []).length)
                ? `<div data-slotinfo="${slot.id}" style="font-size:11px; color:#7a8b99;">
                       Nothing grabbed yet \u2014 press Grab on a page using the theme you want.
                   </div>`
                : '';

            return `
            <div data-slotrow="${slot.id}" style="border:1px solid #2a475e; border-radius:3px; margin-bottom:6px;">
                <div data-slothead="${slot.id}" title="Click to show this slot's URLs"
                    style="display:flex; align-items:center; gap:6px; padding:5px; cursor:pointer; user-select:none;">
                    <span data-slotcaret="${slot.id}" style="flex:none; font-size:10px; color:#7a8b99;">&#9656;</span>
                    <div data-slotthumb="${slot.id}" style="width:32px; height:20px; flex:none; border-radius:2px;
                        background:#0e1620; overflow:hidden; display:flex; align-items:center; justify-content:center;"></div>
                    <div style="flex:1; min-width:0; font-size:11px;">${slot.label}</div>
                    <span data-slotstate="${slot.id}" style="flex:none; font-size:10px; color:#7a8b99;">none</span>
                    <button data-slotgrab="${slot.id}" title="Grab just this page's ${slot.label.toLowerCase()} and apply it"
                        style="flex:none; cursor:pointer; padding:2px 6px; font-size:10px; background:transparent;
                        border:1px solid #66c0f4; border-radius:3px; color:#66c0f4;">Grab</button>
                    <span data-slotclear="${slot.id}" title="Clear this slot"
                        style="flex:none; cursor:pointer; color:#7a8b99; padding:0 3px; font-size:14px;">&times;</span>
                </div>
                <div data-slotbody="${slot.id}" style="display:none; padding:0 5px 5px;">
                    ${kindToggle}${fieldGroups}${info}
                </div>
            </div>`;
        }).join('');
    }

    function versionRank(text) {
        return (text || '0').split('.').map(n => parseInt(n, 10) || 0);
    }

    function isNewerThan(a, b) {
        const left = versionRank(a);
        const right = versionRank(b);
        for (let i = 0; i < Math.max(left.length, right.length); i++) {
            const diff = (left[i] || 0) - (right[i] || 0);
            if (diff) return diff > 0;
        }
        return false;
    }

    async function createPanel() {
        // The version sits in @name, so each release installs as its own script
        // rather than an update and two can be enabled at once. Newer wins,
        // rather than whichever happened to load first.
        const existing = document.getElementById('pp-panel');
        if (existing) {
            if (!isNewerThan(SCRIPT_VERSION, existing.dataset.ppVersion)) return;
            console.warn('[previewer] replacing panel from older version', existing.dataset.ppVersion);
            existing.remove();
        }

        snapshotPage();

        // Each site's global CSS reaches into the panel — form controls don't
        // inherit fonts, and the store styles them differently from the
        // community pages. Pin them so both look the same.
        if (!document.getElementById('pp-style')) {
            const style = document.createElement('style');
            style.id = 'pp-style';
            style.textContent = [
                '#pp-panel, #pp-panel * { font-family: Arial, Helvetica, sans-serif !important;',
                '  box-sizing: border-box; letter-spacing: normal !important;',
                '  text-transform: none !important; }',
                '#pp-panel input[type="text"] { font-size: 12px !important;',
                '  color: #c7d5e0 !important; background: #0e1620 !important;',
                '  border: 1px solid #2a475e !important; border-radius: 2px; }',
                '#pp-panel input[type="text"]::placeholder { color: #7a8b99; font-style: italic; }',
                // No !important on the size: it was overriding the inline 10px
                // on the small per-row buttons and blowing them up.
                '#pp-panel button { font-size: 12px; line-height: normal !important; }',
                '#pp-panel input[type="checkbox"] { accent-color: #66c0f4; }',
            ].join('\n');
            (document.head || document.documentElement).appendChild(style);
        }

        const panel = document.createElement('div');
        panel.id = 'pp-panel';
        panel.dataset.ppVersion = SCRIPT_VERSION;
        // Steam's modal renders a full-screen overlay element that sat on top
        // of this panel: clicks landed on the backdrop instead of our buttons
        // (the giveaway was the cursor staying an arrow over them), and the
        // backdrop then dismissed the preview. Both are fixed children of
        // <body>, so they share a stacking context and the larger z-index
        // simply wins.
        // left/bottom/margin/overflow are pinned because the popover UA styles
        // (used below to reach the top layer) set inset:0 and margin:auto,
        // which would otherwise drag the panel to the left edge.
        panel.style.cssText = `
            position: fixed; top: 10px; right: 10px; left: auto; bottom: auto;
            margin: 0; overflow: visible; z-index: 2147483646; font-size: 12px;
            background: #1b2838; border: 1px solid #66c0f4; border-radius: 6px;
            padding: 10px; font-family: Arial, sans-serif; color: #c7d5e0;
            box-shadow: 0 2px 8px rgba(0,0,0,0.5); width: 320px;
        `;
        panel.innerHTML = `
            <div id="ppHeader" title="Drag to move"
                style="display:flex; align-items:center; gap:6px; margin-bottom:8px; cursor:move; user-select:none;">
                <span style="flex:none; width:14px;"></span>
                <div style="flex:1; font-weight:bold; text-align:center; font-size:13px;">Try-On for Steam Profiles</div>
                <span id="ppCollapse" title="Collapse"
                    style="cursor:pointer; padding:0 4px; font-size:12px; color:#7a8b99;">&#9662;</span>
            </div>
            <div id="ppBody">
                <div style="display:flex; gap:6px; margin-bottom:8px;">
                    <button id="ppGrab" title="Fill every slot with what this page is already using. Each row has its own Grab for just that item."
                        style="flex:1; padding:5px; cursor:pointer; background:#2a475e;
                        border:1px solid #66c0f4; border-radius:3px; color:#c7d5e0;">
                        Grab all from this page
                    </button>
                    <button id="ppCopy" title="Copy the URL(s) of this page's own look (not the one you've applied)"
                        style="flex:none; padding:5px 10px; cursor:pointer; background:#2a475e;
                        border:1px solid #2a475e; border-radius:3px; color:#c7d5e0;">
                        Copy
                    </button>
                </div>

                <div id="ppPresetHeading" style="font-size:11px; color:#7a8b99; margin-bottom:4px;">Presets</div>
                <!-- 4.5 rows of 33px plus the border: a half-cut row is what
                     says "scroll for more". At exactly 4 the list looked complete. -->
                <div id="ppPresetList" style="max-height:150px; overflow-y:auto; margin-bottom:6px;
                    border:1px solid #2a475e; border-radius:3px;"></div>
                <div id="ppUndoBar" style="display:none; align-items:center; gap:6px; margin-bottom:6px;
                    padding:4px 6px; border:1px solid #66c0f4; border-radius:3px; background:#22394d; font-size:11px;">
                    <span id="ppUndoMsg" style="flex:1; min-width:0;"></span>
                    <button id="ppUndoBtn" title="Undo the change described here"
                        style="flex:none; padding:2px 8px; cursor:pointer; background:#66c0f4;
                        border:none; border-radius:3px; color:#1b2838; font-weight:bold; font-size:11px;">Undo</button>
                    <span id="ppUndoDismiss" title="Dismiss"
                        style="flex:none; cursor:pointer; color:#7a8b99; padding:0 2px; font-size:14px;">&times;</span>
                </div>
                <div style="display:flex; gap:6px; margin-bottom:10px;">
                    <input id="ppPresetName" type="text" placeholder="Preset name (optional)"
                        style="flex:1; min-width:0; box-sizing:border-box; padding:4px;">
                    <button id="ppPresetSave" title="Save the filled slots as a preset. Uses what's applied if the fields are empty."
                        style="flex:none; padding:4px 10px; cursor:pointer; background:#2a475e;
                        border:none; border-radius:3px; color:#c7d5e0;">Save</button>
                </div>

                ${slotRowsMarkup()}

                <div id="ppActions" style="display:flex; gap:6px; margin-top:8px;">
                    <button id="ppApply" title="Apply every slot that has URL(s) filled in"
                        style="flex:1; padding:5px; cursor:pointer; background:#66c0f4;
                        border:none; border-radius:3px; color:#1b2838; font-weight:bold;">Apply</button>
                    <button id="ppClear" title="Remove everything you've applied and put the page back"
                        style="flex:1; padding:5px; cursor:pointer; background:#2a475e;
                        border:none; border-radius:3px; color:#c7d5e0;">Clear</button>
                    <button id="ppPeek" title="Hold to see this page's own look (or hold P)"
                        style="flex:1; padding:5px; cursor:pointer; background:#2a475e;
                        border:1px solid #66c0f4; border-radius:3px; color:#c7d5e0;">Peek</button>
                </div>

                <div id="ppAdvToggle" title="Settings you shouldn't normally need"
                    style="margin-top:8px; font-size:11px; color:#7a8b99; cursor:pointer; user-select:none;">
                    &#9656; Advanced
                </div>
                <div id="ppAdvanced" style="display:none; margin-top:6px; padding:6px;
                    border:1px solid #2a475e; border-radius:3px;">
                    <label title="Press 1-9 anywhere on the page to apply that preset. Numbers follow the list order."
                        style="display:block; font-size:11px; cursor:pointer; color:#7a8b99;">
                        <input id="ppKeys" type="checkbox" checked> Number keys apply presets<span
                            id="ppKeysHint" style="display:none; color:#b8873c;"> \u2014 default: on</span>
                    </label>
                    <label title="Off by default \u2014 deleting a preset can be undone."
                        style="display:block; margin-top:6px; font-size:11px; cursor:pointer; color:#7a8b99;">
                        <input id="ppConfirm" type="checkbox"> Ask before deleting a preset<span
                            id="ppConfirmHint" style="display:none; color:#b8873c;"> \u2014 default: off</span>
                    </label>
                    <label title="Puts your changes back if the page resets them, or if Steam swaps the page content without a reload."
                        style="display:block; margin-top:6px; font-size:11px; cursor:pointer; color:#7a8b99;">
                        <input id="ppAuto" type="checkbox" checked> Keep applied while browsing<span
                            id="ppAutoHint" style="display:none; color:#b8873c;"> \u2014 default: on</span>
                    </label>
                    <label title="Off by default: on other people's profiles and Steam's item previews the panel only grabs, and Apply sends to your own profile tabs instead."
                        style="display:block; margin-top:6px; font-size:11px; cursor:pointer; color:#7a8b99;">
                        <input id="ppEverywhere" type="checkbox"> Apply on every profile<span
                            id="ppEverywhereHint" style="display:none; color:#b8873c;"> \u2014 default: off</span>
                    </label>
                    <div style="display:flex; gap:6px; margin-top:6px;">
                        <button id="ppExport" title="Download all presets as a .json file"
                            style="flex:1; padding:4px; cursor:pointer; background:#2a475e;
                            border:none; border-radius:3px; color:#c7d5e0; font-size:11px;">Export</button>
                        <button id="ppImport" title="Add presets from a .json file. Existing presets are kept."
                            style="flex:1; padding:4px; cursor:pointer; background:#2a475e;
                            border:none; border-radius:3px; color:#c7d5e0; font-size:11px;">Import</button>
                    </div>
                    <input id="ppImportFile" type="file" accept="application/json,.json" style="display:none;">
                    <button id="ppDeleteAll" title="Delete every saved preset. Always asks first."
                        style="width:100%; margin-top:6px; padding:4px; cursor:pointer; background:#5a2a2a;
                        border:none; border-radius:3px; color:#e8c7c7; font-size:11px;">Delete all presets</button>
                    <button id="ppReset" title="Restore default settings. Saved presets are kept."
                        style="width:100%; margin-top:6px; padding:4px; cursor:pointer; background:#2a475e;
                        border:none; border-radius:3px; color:#c7d5e0; font-size:11px;">Reset settings to defaults</button>
                    <button id="ppDiag" title="Copy measurements of this page's own look, for debugging"
                        style="width:100%; margin-top:6px; padding:4px; cursor:pointer; background:#2a475e;
                        border:none; border-radius:3px; color:#c7d5e0; font-size:11px;">Copy sizing diagnostics</button>
                    <div style="margin-top:12px; padding-top:10px; border-top:1px solid #2a475e;">
                        <button id="ppNuke" title="Erases presets, settings, panel position and everything applied. A backup is kept so it can be undone."
                            style="width:100%; padding:5px; cursor:pointer; background:#0d0d0d;
                            border:1px solid #3a1f1f; border-radius:3px; color:#c78787; font-size:11px;">
                            Erase everything
                        </button>
                    </div>
                </div>

                <div id="ppStatus" style="margin-top:6px; font-size:11px; min-height:14px;
                    word-break:break-word; color:#8fbc8f;"></div>
                <div id="ppTextOut" style="display:none; margin-top:6px;">
                    <div id="ppTextOutLabel" style="font-size:11px; color:#7a8b99; margin-bottom:4px;"></div>
                    <textarea id="ppTextOutArea" readonly rows="5" style="width:100%; box-sizing:border-box;
                        font-size:10px; font-family:monospace; background:#0e1620; color:#c7d5e0;
                        border:1px solid #2a475e; border-radius:3px; resize:vertical;"></textarea>
                    <button id="ppTextOutClose" title="Hide this text box"
                        style="width:100%; margin-top:4px; padding:3px; cursor:pointer; background:#2a475e;
                        border:none; border-radius:3px; color:#c7d5e0; font-size:11px;">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        const $ = sel => panel.querySelector(sel);
        statusEl = $('#ppStatus');

        const presetList = $('#ppPresetList');
        const presetNameInput = $('#ppPresetName');
        const undoBar = $('#ppUndoBar');
        const undoMsg = $('#ppUndoMsg');
        const autoInput = $('#ppAuto');
        const autoHint = $('#ppAutoHint');
        const confirmInput = $('#ppConfirm');
        const confirmHint = $('#ppConfirmHint');
        const keysInput = $('#ppKeys');
        const keysHint = $('#ppKeysHint');
        const everywhereInput = $('#ppEverywhere');
        const everywhereHint = $('#ppEverywhereHint');
        const importFile = $('#ppImportFile');
        const nukeBtn = $('#ppNuke');
        const textOut = $('#ppTextOut');
        const textOutLabel = $('#ppTextOutLabel');
        const textOutArea = $('#ppTextOutArea');
        const panelBody = $('#ppBody');
        const collapseBtn = $('#ppCollapse');
        const advancedBox = $('#ppAdvanced');
        const advancedToggle = $('#ppAdvToggle');

        function storeDiagnostics() {
            const modal = storeModal();
            const preview = storePreviewValue();
            const lines = [
                'url: ' + location.href,
                'modal found: ' + (modal ? 'yes' : 'no'),
                'detected slot: ' + (preview ? (preview.slotId || '(none)') : '(no preview)'),
                'preview iframe: ' + (modal && modal.querySelector('iframe[src*="previewprofile=1"]')
                    ? modal.querySelector('iframe[src*="previewprofile=1"]').getAttribute('src') : 'none'),
                'bundle: ' + (preview && preview.bundle
                    ? Object.keys(preview.bundle).join(', ') + '\n  ' +
                      JSON.stringify(preview.bundle, null, 1).replace(/\n/g, '\n  ')
                    : 'none'),
                'value: ' + (preview ? JSON.stringify(preview.value) : 'none'),
            ];

            // What the type detection is actually reading, level by level —
            // this is the part that decides which slot an item lands in.
            if (preview && preview.mediaEl) {
                lines.push('media: <' + preview.mediaEl.tagName.toLowerCase() + '> ' +
                    (preview.mediaEl.getAttribute('src') || preview.mediaEl.getAttribute('poster') || ''));
                let node = preview.mediaEl;
                for (let depth = 0; node && depth < 5; depth++) {
                    const text = (node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140);
                    const hits = STORE_TYPE_PATTERNS
                        .filter(entry => entry.test.test(node.textContent || ''))
                        .map(entry => entry.slot);
                    lines.push('  level ' + depth + ' <' + node.tagName.toLowerCase() + '.' +
                        (node.className || '').toString().split(' ')[0] + '>' +
                        ' matches[' + (hits.join(',') || '-') + ']: ' + (text || '(no text)'));
                    node = node.parentElement;
                }
            }
            lines.push('cached preview: ' + (lastStorePreview ? JSON.stringify(lastStorePreview.value) : 'none'));
            if (modal) {
                const link = modal.querySelector('a[href*="/points/shop/app/"]');
                lines.push('app link: ' + (link ? link.getAttribute('href') : 'none'));
                lines.push('videos in modal: ' + modal.querySelectorAll('video').length);
                lines.push('images in modal: ' + modal.querySelectorAll('img').length);
                const sources = Array.from(modal.querySelectorAll('source'))
                    .map(x => x.getAttribute('src')).filter(Boolean);
                lines.push('modal sources:\n  ' + (sources.join('\n  ') || 'none'));
            }
            if (modal) {
                lines.push('modal background-image elements: ' +
                    modal.querySelectorAll('[style*="background-image"]').length);
            }
            lines.push('item media anywhere on page: ' +
                Array.from(document.querySelectorAll('source, img, video'))
                    .filter(x => ITEM_ASSET.test(x.getAttribute('src') || x.getAttribute('poster') || ''))
                    .length);
            return lines.join('\n');
        }

        // Grabbing on the store writes into the applied set rather than just
        // the fields, so profile tabs pick it up through the same cross-tab
        // sync that already exists — no Save step, no reload.
        async function storeStage(slotId, value) {
            let saved = {};
            try {
                const raw = await store.get(STATE_KEY, '');
                saved = raw ? (JSON.parse(raw) || {}) : {};
            } catch (e) {
                saved = {};
            }
            saved[slotId] = value;
            await store.set(STATE_KEY, JSON.stringify(saved));
        }

        // ---------------- slot field plumbing ----------------

        function slotKind(slotId) {
            const slot = SLOT_BY_ID[slotId];
            if (slot.kinds.length === 1) return slot.kinds[0];
            const checked = panel.querySelector(`input[name="ppKind_${slotId}"]:checked`);
            return checked ? checked.value : slot.kinds[0];
        }

        function setSlotKind(slotId, kind) {
            const slot = SLOT_BY_ID[slotId];
            if (slot.kinds.length > 1) {
                for (const radio of panel.querySelectorAll(`input[name="ppKind_${slotId}"]`)) {
                    radio.checked = radio.value === kind;
                }
            }
            for (const group of panel.querySelectorAll(`[data-fields="${slotId}"]`)) {
                group.style.display = group.dataset.kind === kind ? '' : 'none';
            }
        }

        // A theme has no inputs to hold it, so it lives here between Grab and
        // Apply — the same role the text fields play for the other slots.
        const slotDrafts = {};

        function updateSlotInfo(slotId) {
            const info = panel.querySelector(`[data-slotinfo="${slotId}"]`);
            if (!info) return;
            const draft = slotDrafts[slotId];
            info.textContent = draft
                ? (themeLabel(draft) || 'Grabbed') + ' \u2014 press Apply'
                : 'Nothing grabbed yet \u2014 press Grab on a page using the theme you want.';
            const appid = themeAppId(draft);
            if (appid && appNames[appid] === undefined) {
                resolveAppName(appid).then(name => { if (name) updateSlotInfo(slotId); });
            }
        }

        function fieldInput(slotId, kind, key) {
            return panel.querySelector(`input[data-slot="${slotId}"][data-kind="${kind}"][data-field="${key}"]`);
        }

        function readSlotFields(slotId) {
            const kind = slotKind(slotId);
            if (!(KIND_FIELDS[kind] || []).length) return slotDrafts[slotId] || null;
            const value = { kind };
            for (const field of KIND_FIELDS[kind]) {
                value[field.key] = normalizeUrl(fieldInput(slotId, kind, field.key).value);
                fieldInput(slotId, kind, field.key).value = value[field.key];
            }
            return normalizeValue(value);
        }

        function writeSlotFields(slotId, value) {
            if (!value) return;
            setSlotKind(slotId, value.kind);
            if (!(KIND_FIELDS[value.kind] || []).length) {
                slotDrafts[slotId] = value;
                updateSlotInfo(slotId);
                return;
            }
            for (const field of KIND_FIELDS[value.kind]) {
                fieldInput(slotId, value.kind, field.key).value = value[field.key] || '';
            }
        }

        function clearSlotFields(slotId) {
            slotDrafts[slotId] = null;
            updateSlotInfo(slotId);
            const slot = SLOT_BY_ID[slotId];
            for (const kind of slot.kinds) {
                for (const field of KIND_FIELDS[kind]) fieldInput(slotId, kind, field.key).value = '';
            }
        }

        function readAllFields() {
            const out = {};
            for (const slot of SLOTS) {
                const value = readSlotFields(slot.id);
                if (value) out[slot.id] = value;
            }
            return out;
        }

        // The #t=0.1 fragment is only a hint — whether the browser seeks and
        // paints that frame depends on how the load went, which is why
        // thumbnails filled in sometimes and not others. Ask explicitly.
        function primeThumbVideo(vid) {
            vid.addEventListener('loadedmetadata', () => {
                try { if (vid.paused) vid.currentTime = 0.1; } catch (e) {}
            });
        }

        function refreshSlotRow(slotId) {
            const state = slotState[slotId];
            const label = panel.querySelector(`[data-slotstate="${slotId}"]`);
            const thumb = panel.querySelector(`[data-slotthumb="${slotId}"]`);
            label.textContent = state.active ? state.active.kind : 'none';
            label.style.color = state.active ? '#8fbc8f' : '#7a8b99';
            thumb.innerHTML = '';
            // Themes paint the thumb with an inline background colour, and
            // emptying its children doesn't remove that.
            thumb.style.background = '#0e1620';
            thumb.title = '';
            const value = state.active || readSlotFields(slotId);
            if (!value) return;

            if (value.kind === 'theme') {
                const swatch = (value.vars || {})['--color-showcase-header']
                    || (value.vars || {})['--gradient-background']
                    || (value.vars || {})['--gradient-left'];
                const appid = themeAppId(value);
                const sources = [];
                if (value.thumb) sources.push(value.thumb);
                if (appid) sources.push.apply(sources, capsuleUrls(appid));

                if (sources.length) {
                    const img = document.createElement('img');
                    let attempt = 0;
                    img.src = sources[0];
                    img.style.cssText = 'width:100%; height:100%; object-fit:cover; display:block;';
                    img.addEventListener('error', () => {
                        attempt++;
                        if (attempt < sources.length) { img.src = sources[attempt]; return; }
                        thumb.innerHTML = '';
                        if (swatch) thumb.style.background = swatch;
                    });
                    thumb.appendChild(img);
                } else if (swatch) {
                    thumb.style.background = swatch;
                } else {
                    const tag = document.createElement('span');
                    tag.textContent = 'THM';
                    tag.style.cssText = 'font-size:9px; color:#7a8b99;';
                    thumb.appendChild(tag);
                }

                label.textContent = state.active ? themeLabel(state.active) : 'none';
                label.style.color = state.active ? '#8fbc8f' : '#7a8b99';
                if (appid && appNames[appid] === undefined) {
                    resolveAppName(appid).then(name => { if (name) refreshSlotRow(slotId); });
                }
                return;
            }

            const still = valueStill(value);
            const clip = valueClip(value);

            // Video first. Checking for a poster first meant any clip that had
            // one became a plain <img>, so the background row never animated.
            if (clip) {
                const vid = document.createElement('video');
                if (still) vid.poster = still;   // instant resting frame
                vid.src = clip;
                vid.muted = true;
                vid.defaultMuted = true;
                vid.loop = true;
                vid.playsInline = true;
                vid.preload = 'metadata';
                vid.setAttribute('muted', '');
                vid.setAttribute('playsinline', '');
                vid.style.cssText = 'width:100%; height:100%; object-fit:cover; display:block;';
                vid.addEventListener('error', () => { thumb.innerHTML = ''; });
                primeThumbVideo(vid);
                thumb.appendChild(vid);
            } else if (still) {
                const img = document.createElement('img');
                img.src = still;
                img.style.cssText = 'width:100%; height:100%; object-fit:cover; display:block;';
                img.addEventListener('error', () => { thumb.innerHTML = ''; });
                thumb.appendChild(img);
            }
            thumb.title = clip ? 'Hover the row to preview' : '';
        }

        function refreshAllRows() { for (const slot of SLOTS) refreshSlotRow(slot.id); }

        for (const slot of SLOTS) {
            const head = panel.querySelector(`[data-slothead="${slot.id}"]`);
            const body = panel.querySelector(`[data-slotbody="${slot.id}"]`);
            const caret = panel.querySelector(`[data-slotcaret="${slot.id}"]`);
            head.addEventListener('mouseenter', () => {
                const vid = head.querySelector('video');
                if (!vid) return;
                const pr = vid.play();
                if (pr && pr.catch) pr.catch(() => {});
            });
            head.addEventListener('mouseleave', () => {
                const vid = head.querySelector('video');
                if (!vid) return;
                vid.pause();
                try { vid.currentTime = 0.1; } catch (e) {}
            });

            head.addEventListener('click', (e) => {
                if (e.target.dataset && (e.target.dataset.slotclear || e.target.dataset.slotgrab)) return;
                const open = body.style.display !== 'none';
                body.style.display = open ? 'none' : '';
                caret.innerHTML = open ? '&#9656;' : '&#9662;';
            });
            // Grabs one slot and applies it straight away. Filling the fields
            // alone wouldn't survive the next page load — and moving between
            // pages is the whole point of a per-slot grab, since applied state
            // persists and accumulates while typed fields don't.
            panel.querySelector(`[data-slotgrab="${slot.id}"]`).addEventListener('click', async (e) => {
                e.stopPropagation();
                if (ON_STORE) {
                    // A whole-profile dialog embeds the real preview in a
                    // cross-origin iframe, so scraping the dialog only yields
                    // the item list's cropped thumbnails. Take this slot's
                    // piece out of the fetched preview instead.
                    const bundleModal = storeModal();
                    if (bundleModal && bundleModal.querySelector('iframe[src*="previewprofile=1"]')) {
                        setStatus('Reading the full preview\u2026', false);
                        let fetched = null;
                        try { fetched = await bundleFromPreviewFrame(bundleModal); }
                        catch (e) { console.warn('[previewer] preview fetch failed', e); }
                        if (fetched && fetched[slot.id]) {
                            writeSlotFields(slot.id, fetched[slot.id]);
                            refreshSlotRow(slot.id);
                            setStatus('Grabbed the ' + slot.label.toLowerCase() +
                                ' from this profile. Press Apply to send it to your profile tabs.', false);
                            return;
                        }
                        if (fetched) {
                            setStatus('This profile has no ' + slot.label.toLowerCase() + '.', true);
                            return;
                        }
                    }

                    // Whatever's previewed goes into the row you clicked, even
                    // if its type wasn't recognised — that's the escape hatch.
                    const preview = storePreviewValue() || lastStorePreview;
                    if (!preview) {
                        setStatus('Nothing captured \u2014 details below.', true);
                        showTextFallback('What the grab saw:', storeDiagnostics());
                        return;
                    }
                    writeSlotFields(slot.id, preview.value);
                    refreshSlotRow(slot.id);

                    // Warn rather than block. Detection leans on Steam's class
                    // names and has been wrong before, so the row buttons stay
                    // the escape hatch — and putting a mini profile artwork in
                    // the background slot is a legitimate thing to want.
                    const detected = preview.slotId;
                    const mismatch = detected && detected !== slot.id && SLOT_BY_ID[detected];
                    setStatus('Grabbed as ' + slot.label.toLowerCase() +
                        (mismatch ? ' (this looks like ' + withArticle(SLOT_BY_ID[detected].label.toLowerCase()) + ')' : '') +
                        '. Press Apply to send it to your profile tabs.', !!mismatch);
                    return;
                }

                if (slot.volatile) setStatus('Loading the ' + slot.label.toLowerCase() + '\u2026', false);
                await refreshVolatileSnapshot(slot.id);
                const snap = pageSnapshot[slot.id];
                if (!snap || !snap.value) {
                    setStatus(slot.emptyHint
                        || ('This page has no ' + slot.label.toLowerCase() + ' of its own to grab.'), true);
                    return;
                }
                writeSlotFields(slot.id, snap.value);
                if (!applyHere()) {
                    refreshSlotRow(slot.id);
                    setStatus('Grabbed this profile’s ' + slot.label.toLowerCase() +
                        '. Press Apply to send it to your profile tabs.', false);
                    return;
                }
                if (applySlot(slot.id, snap.value)) {
                    await store.set(STATE_KEY, JSON.stringify(activeSet()));
                    setStatus('Grabbed this page\u2019s ' + slot.label.toLowerCase() + '.', false);
                }
                refreshSlotRow(slot.id);
            });

            panel.querySelector(`[data-slotclear="${slot.id}"]`).addEventListener('click', async (e) => {
                e.stopPropagation();
                clearSlot(slot.id);
                clearSlotFields(slot.id);
                await store.set(STATE_KEY, JSON.stringify(activeSet()));
                refreshSlotRow(slot.id);
            });
            for (const radio of panel.querySelectorAll(`input[name="ppKind_${slot.id}"]`)) {
                radio.addEventListener('change', () => setSlotKind(slot.id, radio.value));
            }
        }

        // ---------------- text fallback ----------------

        function showTextFallback(label, text) {
            textOutLabel.textContent = label;
            textOutArea.value = text;
            textOut.style.display = '';
            textOutArea.focus();
            textOutArea.select();
        }

        $('#ppTextOutClose').addEventListener('click', () => {
            textOut.style.display = 'none';
            textOutArea.value = '';
        });

        async function writeClipboard(text) {
            if (typeof GM_setClipboard !== 'undefined') { GM_setClipboard(text, 'text'); return; }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return;
            }
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed; opacity:0; pointer-events:none;';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }

        // ---------------- grab / copy / apply / clear / peek ----------------

        $('#ppGrab').addEventListener('click', async () => {
            if (ON_STORE) {
                const preview = storePreviewValue() || lastStorePreview;
                if (!preview) {
                    setStatus('Nothing captured \u2014 details below.', true);
                    showTextFallback('What the grab saw:', storeDiagnostics());
                    return;
                }
                // A bundle fills every slot it covers, which is the point of
                // grabbing a whole game profile rather than one piece of it.
                const modal = storeModal();
                if (modal && modal.querySelector('iframe[src*="previewprofile=1"]')) {
                    setStatus('Reading the full preview\u2026', false);
                    let fetched = null;
                    try { fetched = await bundleFromPreviewFrame(modal); }
                    catch (e) { console.warn('[previewer] preview fetch failed', e); }
                    if (fetched) {
                        const ids = Object.keys(fetched);
                        for (const id of ids) {
                            writeSlotFields(id, fetched[id]);
                            refreshSlotRow(id);
                        }
                        setStatus('Grabbed ' + ids.length + ' items (' +
                            ids.map(id => SLOT_BY_ID[id].label.toLowerCase()).join(', ') +
                            '). Press Apply to send them to your profile tabs.', false);
                        return;
                    }
                    setStatus('Couldn\u2019t read the full preview \u2014 falling back to the item list.', true);
                }

                if (preview.bundle) {
                    const ids = Object.keys(preview.bundle);
                    for (const id of ids) {
                        writeSlotFields(id, preview.bundle[id]);
                        refreshSlotRow(id);
                    }
                    setStatus('Grabbed ' + ids.length + ' items (' +
                        ids.map(id => SLOT_BY_ID[id].label.toLowerCase()).join(', ') +
                        '). Press Apply to send them to your profile tabs.', false);
                    return;
                }

                if (!preview.slotId) {
                    setStatus('Couldn\u2019t tell what kind of item that is \u2014 press Grab on the row you '
                        + 'want instead (' + SLOTS.map(x => x.label).join(', ') + ').', true);
                    return;
                }
                writeSlotFields(preview.slotId, preview.value);
                refreshSlotRow(preview.slotId);
                setStatus('Grabbed ' + (preview.title ? '"' + preview.title + '" ' : '') + 'as ' +
                    SLOT_BY_ID[preview.slotId].label.toLowerCase() +
                    '. Press Apply to send it to your profile tabs.', false);
                return;
            }

            let found = 0;
            for (const slot of SLOTS) await refreshVolatileSnapshot(slot.id);
            for (const slot of SLOTS) {
                const snap = pageSnapshot[slot.id];
                if (snap && snap.value) { writeSlotFields(slot.id, snap.value); found++; }
            }
            refreshAllRows();
            setStatus(found
                ? 'Grabbed ' + found + ' item' + (found === 1 ? '' : 's') + ' from this page. Press Apply to ' +
                    (applyHere() ? 'keep.' : 'send to your profile tabs.')
                : 'Nothing on this page to grab.', !found);
        });

        $('#ppCopy').addEventListener('click', async () => {
            if (ON_STORE) {
                const preview = storePreviewValue();
                if (!preview) { setStatus('Open an item\u2019s preview first.', true); return; }
                const v = preview.value;
                const urls = v.kind === 'image' ? [v.url] : [v.mp4, v.webm, v.poster].filter(Boolean);
                const text = urls.join('\n');
                try {
                    await writeClipboard(text);
                    setStatus('Copied ' + urls.length + ' URL' + (urls.length === 1 ? '' : 's') + '.', false);
                } catch (e) {
                    setStatus('Clipboard blocked \u2014 the URL(s) are below.', true);
                    showTextFallback('Previewed item URL(s):', text);
                }
                return;
            }

            for (const slot of SLOTS) await refreshVolatileSnapshot(slot.id);
            const lines = [];
            for (const slot of SLOTS) {
                const value = pageSnapshot[slot.id] && pageSnapshot[slot.id].value;
                if (!value) continue;
                if (value.kind === 'image') lines.push(value.url);
                else {
                    if (value.mp4) lines.push(value.mp4);
                    if (value.webm) lines.push(value.webm);
                    if (value.poster) lines.push(value.poster);
                }
            }
            if (!lines.length) { setStatus('This page has nothing of its own to copy.', true); return; }
            const text = lines.join('\n');
            try {
                await writeClipboard(text);
                setStatus('Copied ' + lines.length + ' URL' + (lines.length === 1 ? '' : 's') + ' from this page.', false);
            } catch (e) {
                setStatus('Clipboard blocked \u2014 the URL(s) are below.', true);
                showTextFallback('This page\u2019s own URL(s):', text);
            }
        });

        $('#ppApply').addEventListener('click', async () => {
            const values = readAllFields();
            const ids = Object.keys(values);
            if (!ids.length) { setStatus('Fill in at least one slot first, or press Grab.', true); return; }

            if (!applyHere()) {
                for (const id of ids) await storeStage(id, values[id]);
                refreshAllRows();
                setStatus('Sent ' + ids.length + ' item' + (ids.length === 1 ? '' : 's') +
                    ' to your profile tabs.', false);
                return;
            }
            let applied = 0;
            for (const id of ids) if (applySlot(id, values[id])) applied++;
            await store.set(STATE_KEY, JSON.stringify(activeSet()));
            refreshAllRows();
            if (applied > 1) setStatus('Applied ' + applied + ' items.', false);
        });

        $('#ppClear').addEventListener('click', async () => {
            if (!applyHere()) {
                // Without this there's no way to undo a store grab from the
                // store — it just follows you to your profile tabs.
                await store.set(STATE_KEY, '');
                for (const slot of SLOTS) clearSlotFields(slot.id);
                refreshAllRows();
                setStatus('Cleared everywhere.', false);
                return;
            }

            clearAll();
            for (const slot of SLOTS) clearSlotFields(slot.id);
            await store.set(STATE_KEY, '');
            refreshAllRows();
        });

        const peekBtn = $('#ppPeek');
        peekBtn.addEventListener('mousedown', (e) => { e.preventDefault(); peekStart(); });
        peekBtn.addEventListener('mouseup', peekEnd);
        peekBtn.addEventListener('mouseleave', peekEnd);
        peekBtn.addEventListener('touchstart', (e) => { e.preventDefault(); peekStart(); }, { passive: false });
        peekBtn.addEventListener('touchend', peekEnd);
        window.addEventListener('blur', peekEnd);

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'p' && e.key !== 'P') return;
            if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
            if (isTypingTarget(e.target)) return;
            peekStart();
        });
        document.addEventListener('keyup', (e) => {
            if (e.key === 'p' || e.key === 'P') peekEnd();
        });

        // Steam's preview is a <dialog> opened with showModal(), so it lives in
        // the browser's TOP LAYER along with the full-viewport .ModalPosition
        // div inside it. Nothing outside that dialog can be above it — not a
        // huge z-index, not even a popover, since a modal dialog opened later
        // still wins the layer ordering.
        //
        // So go inside it. Anything inside the dialog renders in the top layer
        // too, and a click in there counts as inside the modal, so the preview
        // no longer dismisses itself. The panel keeps position:fixed, so it
        // stays put visually rather than jumping into the dialog's layout.
        let dockedTo = null;

        function dockPanel() {
            const host = storeModal() || document.body;
            if (panel.parentElement === host) return;

            host.appendChild(panel);
            dockedTo = host;

            // Deliberately NOT measured: Steam removes the dialog with the
            // panel still inside it, so at that moment the panel is detached
            // and every measurement reads zero — which parked it in the
            // top-left corner. Re-apply the position we already know instead.
            placePanel();

            // Moving a node makes the browser reload any <video> inside it, so
            // the thumbnails lose their seeked frame. Re-prime them rather
            // than re-rendering the lists, which would reset the scroll.
            for (const vid of panel.querySelectorAll('video')) {
                if (!vid.getAttribute('src')) continue;
                try { vid.load(); } catch (e) {}
            }
        }

        // The panel's canonical spot: wherever it was dragged to, or the
        // default top-right corner.
        function placePanel() {
            if (uiState.left === null || uiState.top === null) {
                panel.style.left = 'auto';
                panel.style.right = '10px';
                panel.style.top = '10px';
                panel.style.bottom = 'auto';
                return;
            }
            const [left, top] = clampToViewport(uiState.left, uiState.top);
            panel.style.left = left + 'px';
            panel.style.top = top + 'px';
            panel.style.right = 'auto';
        }

        if (ON_STORE) {
            // "Grab previewed item" is wrong for a whole-profile bundle.
            const grabBtn = $('#ppGrab');
            let grabLabel = '';
            function updateGrabLabel() {
                const modal = storeModal();
                const bundle = !!(modal && modal.querySelector('iframe[src*="previewprofile=1"]'));
                const next = bundle ? 'Grab whole profile' : 'Grab previewed item';
                if (next === grabLabel) return;
                grabLabel = next;
                grabBtn.textContent = next;
                grabBtn.title = bundle
                    ? 'Grab every part of this profile: background, avatar, frame, mini profile and theme'
                    : 'Grab whatever item preview is open (or press G)';
            }
            updateGrabLabel();
            setInterval(updateGrabLabel, 250);

            // Steam removes the dialog with the panel inside it, so waiting for
            // the next poll left the panel missing for a beat. React to the
            // removal itself; the interval stays as a backstop.
            let dockQueued = false;
            new MutationObserver(() => {
                if (dockQueued) return;
                dockQueued = true;
                requestAnimationFrame(() => {
                    dockQueued = false;
                    dockPanel();
                });
            }).observe(document.documentElement, { childList: true, subtree: true });
            setInterval(dockPanel, 250);

            // The reliable way in. Steam's preview covers the panel with a
            // full-screen layer, so the panel may not be clickable while one
            // is open — but keys still reach the document, and pressing one
            // isn't a click outside the preview, so it shouldn't dismiss it.
            document.addEventListener('keydown', (e) => {
                if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
                if (isTypingTarget(e.target)) return;
                if (e.key === 'g' || e.key === 'G') {
                    e.preventDefault();
                    $('#ppGrab').click();
                } else if (e.key === 'd' || e.key === 'D') {
                    e.preventDefault();
                    const report = storeDiagnostics();
                    console.log('[previewer] store diagnostics\n' + report);
                    showTextFallback('What the panel can see:', report);
                }
            }, true);
        }

        // ---------------- panel chrome ----------------

        let uiState = { left: null, top: null, collapsed: false };

        async function saveUiState() { await store.set(UI_KEY, JSON.stringify(uiState)); }

        function applyCollapsed() {
            panelBody.style.display = uiState.collapsed ? 'none' : '';
            collapseBtn.innerHTML = uiState.collapsed ? '&#9656;' : '&#9662;';
            collapseBtn.title = uiState.collapsed ? 'Expand' : 'Collapse';
        }

        function clampToViewport(left, top) {
            const w = panel.offsetWidth || 320;
            const h = panel.offsetHeight || 40;
            return [
                Math.max(0, Math.min(left, window.innerWidth - Math.min(w, window.innerWidth))),
                Math.max(0, Math.min(top, window.innerHeight - Math.min(h, window.innerHeight))),
            ];
        }

        function applyPosition() {
            if (uiState.left === null || uiState.top === null) return;
            const [left, top] = clampToViewport(uiState.left, uiState.top);
            panel.style.left = left + 'px';
            panel.style.top = top + 'px';
            panel.style.right = 'auto';
        }

        collapseBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            disarmNuke();
            uiState.collapsed = !uiState.collapsed;
            applyCollapsed();
            await saveUiState();
        });

        let panelDrag = null;
        $('#ppHeader').addEventListener('mousedown', (e) => {
            if (e.target === collapseBtn) return;
            const rect = panel.getBoundingClientRect();
            panelDrag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!panelDrag) return;
            const [left, top] = clampToViewport(e.clientX - panelDrag.dx, e.clientY - panelDrag.dy);
            panel.style.left = left + 'px';
            panel.style.top = top + 'px';
            panel.style.right = 'auto';
        });
        document.addEventListener('mouseup', async () => {
            if (!panelDrag) return;
            panelDrag = null;
            const rect = panel.getBoundingClientRect();
            uiState.left = rect.left;
            uiState.top = rect.top;
            await saveUiState();
        });

        advancedToggle.addEventListener('click', () => {
            disarmNuke();
            const open = advancedBox.style.display !== 'none';
            advancedBox.style.display = open ? 'none' : '';
            advancedToggle.innerHTML = (open ? '&#9656;' : '&#9662;') + ' Advanced';
        });

        // ---------------- undo ----------------

        let pendingUndo = null;
        let pendingDismiss = null;

        function offerUndo(message, restore, onDismiss) {
            pendingUndo = restore;
            pendingDismiss = onDismiss || null;
            undoMsg.textContent = message;
            undoBar.style.display = 'flex';
        }

        function hideUndo() {
            pendingUndo = null;
            pendingDismiss = null;
            undoBar.style.display = 'none';
        }

        $('#ppUndoBtn').addEventListener('click', async () => {
            const restore = pendingUndo;
            hideUndo();
            if (restore) await restore();
        });
        $('#ppUndoDismiss').addEventListener('click', () => {
            const dismissed = pendingDismiss;
            hideUndo();
            if (dismissed) dismissed();
        });

        // ---------------- settings ----------------

        function updateKeysHint() { keysHint.style.display = keysInput.checked ? 'none' : ''; }
        function updateConfirmHint() { confirmHint.style.display = confirmInput.checked ? '' : 'none'; }
        function updateAutoHint() { autoHint.style.display = autoInput.checked ? 'none' : ''; }
        function updateEverywhereHint() { everywhereHint.style.display = everywhereInput.checked ? '' : 'none'; }

        // Peek has nothing to show where nothing can be applied.
        function setPeekAvailable(available, title) {
            const peek = $('#ppPeek');
            peek.disabled = !available;
            peek.title = title;
            peek.style.opacity = available ? '' : '0.4';
            peek.style.cursor = available ? 'pointer' : 'default';
            peek.style.borderColor = available ? '#66c0f4' : '#2a475e';
        }

        // Own profile: Apply paints this page. Anyone else's, or a Steam item
        // preview: grab-only, and Apply sends to your profile tabs the way
        // the Points Shop does.
        function updateApplyMode() {
            if (ON_STORE) return;
            if (applyHere()) {
                $('#ppApply').title = 'Apply every slot that has URL(s) filled in';
                $('#ppClear').title = 'Remove everything you’ve applied and put the page back';
                setPeekAvailable(true, 'Hold to see this page’s own look (or hold P)');
                return;
            }
            const preview = onSteamPreview();
            $('#ppApply').title = (preview ? 'Steam preview' : 'Not your profile') +
                ', so nothing is applied here. Sends the filled slots to your profile tabs.';
            $('#ppClear').title = 'Clear everything on your profile tabs';
            setPeekAvailable(false, preview
                ? 'Nothing is applied over Steam’s own preview'
                : 'Nothing is applied on someone else’s profile');
            setStatus(preview ? 'Steam preview: grab only.' : 'Not your profile: grab only.', false);
        }

        // Writes the shared applied set into the fields, and applies it too
        // when this page allows that.
        async function loadApplied() {
            const savedRaw = await store.get(STATE_KEY, '');
            if (!savedRaw) return;
            try {
                const saved = JSON.parse(savedRaw) || {};
                for (const id of Object.keys(saved)) {
                    if (!SLOT_BY_ID[id]) continue;
                    writeSlotFields(id, saved[id]);
                    // The store is capture-only. Most slots fail to apply here
                    // anyway, but the mini profile "succeeds" (it paints on
                    // hover), and the stale active value then outranked every
                    // later grab in its row thumbnail.
                    if (applyHere()) applySlot(id, saved[id]);
                }
            } catch (e) {
                console.warn('[previewer] could not parse saved state', e);
            }
        }

        async function setApplyEverywhere(on, persist) {
            const before = applyHere();
            applyEverywhere = on;
            everywhereInput.checked = on;
            updateEverywhereHint();
            if (persist) await store.set(EVERYWHERE_KEY, on ? '1' : '0');
            if (applyHere() === before) return;
            // Only this page's paint changes; the shared applied set is
            // untouched, so your own profile tabs keep it either way.
            if (applyHere()) await loadApplied();
            else clearAll(true);
            refreshAllRows();
            updateApplyMode();
            if (applyHere()) setStatus(anyActive() ? 'Applied here too.' : 'Apply now works on this profile.', false);
        }
        onApplyModeChange = updateApplyMode;

        everywhereInput.addEventListener('change', () => setApplyEverywhere(everywhereInput.checked, true));

        keysInput.addEventListener('change', async () => {
            numberKeys = keysInput.checked;
            updateKeysHint();
            await store.set(KEYS_KEY, numberKeys ? '1' : '0');
            renderPresets();
            setStatus(numberKeys ? 'Number keys apply presets 1-9.' : 'Number-key shortcuts off.', false);
        });

        confirmInput.addEventListener('change', async () => {
            confirmDelete = confirmInput.checked;
            updateConfirmHint();
            await store.set(CONFIRM_KEY, confirmDelete ? '1' : '0');
        });

        autoInput.addEventListener('change', async () => {
            autoReapply = autoInput.checked;
            failedReapplies = 0;
            updateAutoHint();
            await store.set(AUTO_KEY, autoReapply ? '1' : '0');
            if (autoReapply && anyActive() && !allStillApplied()) reapplyActive('auto re-enabled');
        });

        document.addEventListener('keydown', (e) => {
            if (!numberKeys) return;
            if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
            if (isTypingTarget(e.target)) return;
            if (e.key < '1' || e.key > '9') return;
            const preset = presets[Number(e.key) - 1];
            if (!preset) return;
            e.preventDefault();
            applyPreset(preset);
        });

        // ---------------- presets ----------------

        let presets = [];
        let dragIndex = null;

        function presetValues(p) { return p.slots || {}; }

        function presetStill(p) {
            for (const slot of SLOTS) {
                const still = valueStill(presetValues(p)[slot.id]);
                if (still) return still;
            }
            return '';
        }

        function presetClip(p) {
            for (const slot of SLOTS) {
                const clip = valueClip(presetValues(p)[slot.id]);
                if (clip) return clip;
            }
            return '';
        }

        function deriveName(p) {
            const themeValue = presetValues(p).theme;
            if (themeValue) {
                const named = themeLabel(themeValue);
                if (named) return named.slice(0, 30);
            }
            const source = presetStill(p) || presetClip(p);
            const file = (source || '').split('/').pop().split('?')[0];
            return file ? file.slice(0, 20) : 'Preset';
        }

        function samePreset(a, b) {
            const av = presetValues(a);
            const bv = presetValues(b);
            const ids = new Set([...Object.keys(av), ...Object.keys(bv)]);
            if (!ids.size) return false;
            for (const id of ids) {
                if (!av[id] || !bv[id]) return false;
                if (!sameValue(av[id], bv[id])) return false;
            }
            return true;
        }

        function mergePreset(existing, incoming) {
            let changed = false;
            const ev = presetValues(existing);
            const iv = presetValues(incoming);
            for (const id of Object.keys(iv)) {
                if (!ev[id]) { ev[id] = iv[id]; changed = true; }
                else if (mergeValue(ev[id], iv[id])) changed = true;
            }
            existing.slots = ev;
            return changed;
        }

        async function savePresets() { await store.set(PRESETS_KEY, JSON.stringify(presets)); }

        async function applyPreset(p) {
            const values = presetValues(p);

            if (!applyHere()) {
                // applySlot can't work here, and letting it save an empty
                // active set would wipe what's applied on the profile tabs.
                for (const id of Object.keys(values)) {
                    writeSlotFields(id, values[id]);
                    await storeStage(id, values[id]);
                }
                refreshAllRows();
                setStatus('"' + p.name + '" sent to your profile tabs.', false);
                return;
            }

            let applied = 0;
            for (const slot of SLOTS) {
                if (!values[slot.id]) continue;
                writeSlotFields(slot.id, values[slot.id]);
                if (applySlot(slot.id, values[slot.id])) applied++;
            }
            await store.set(STATE_KEY, JSON.stringify(activeSet()));
            refreshAllRows();
            if (applied > 1) setStatus('Applied "' + p.name + '".', false);
        }

        const thumbObserver = new IntersectionObserver((entries, obs) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const node = entry.target;
                if (node.dataset.poster) { node.poster = node.dataset.poster; delete node.dataset.poster; }
                if (node.dataset.src) { node.src = node.dataset.src; delete node.dataset.src; }
                obs.unobserve(node);
            }
        }, { root: presetList, rootMargin: '60px' });

        function placeholder(text) {
            const box = document.createElement('span');
            box.textContent = text;
            box.style.cssText = 'font-size:9px; color:#7a8b99;';
            return box;
        }

        function buildThumb(p) {
            const thumb = document.createElement('div');
            thumb.style.cssText = 'width:40px; height:24px; flex:none; border-radius:2px;' +
                'background:#0e1620; overflow:hidden; display:flex; align-items:center; justify-content:center;';
            const still = presetStill(p);
            const clip = presetClip(p);

            if (clip) {
                // Always a <video> when there's a clip, so every animated preset
                // can preview on hover. The poster is the cheap resting state.
                const vid = document.createElement('video');
                vid.dataset.clip = clip;
                if (still) vid.dataset.poster = still;
                else vid.dataset.src = clip + '#t=0.1';
                vid.muted = true;
                vid.defaultMuted = true;
                vid.loop = true;
                vid.playsInline = true;
                vid.preload = 'metadata';
                vid.setAttribute('muted', '');
                vid.setAttribute('playsinline', '');
                vid.style.cssText = 'width:100%; height:100%; object-fit:cover; display:block;';
                vid.addEventListener('error', () => {
                    thumb.innerHTML = '';
                    thumb.appendChild(placeholder('VID'));
                });
                primeThumbVideo(vid);
                thumb.appendChild(vid);
                thumbObserver.observe(vid);
            } else if (still) {
                const img = document.createElement('img');
                img.dataset.src = still;
                img.style.cssText = 'width:100%; height:100%; object-fit:cover; display:block;';
                img.addEventListener('error', () => {
                    thumb.innerHTML = '';
                    thumb.appendChild(placeholder('IMG'));
                });
                thumb.appendChild(img);
                thumbObserver.observe(img);
            } else {
                thumb.appendChild(placeholder('?'));
            }
            return thumb;
        }

        function clearDropMarkers() {
            for (const child of presetList.children) child.style.boxShadow = '';
        }

        // A new row lands at the bottom of a list that may already be full, so
        // a save looked like nothing happened. Bring the row into view and
        // flash it. Scrolls the list only: scrollIntoView would also scroll
        // the page, or Steam's dialog on the store.
        function revealPreset(index) {
            const row = presetList.children[index];
            if (!row) return;
            const listRect = presetList.getBoundingClientRect();
            const rowRect = row.getBoundingClientRect();
            if (rowRect.bottom > listRect.bottom) presetList.scrollTop += rowRect.bottom - listRect.bottom;
            else if (rowRect.top < listRect.top) presetList.scrollTop -= listRect.top - rowRect.top;
            if (row.animate) {
                row.animate([{ background: '#3d6d8f' }, { background: 'transparent' }],
                    { duration: 1200, easing: 'ease-out' });
            }
        }

        function renderPresets() {
            thumbObserver.disconnect();
            presetList.innerHTML = '';
            $('#ppPresetHeading').textContent = presets.length ? 'Presets (' + presets.length + ')' : 'Presets';
            if (!presets.length) {
                const empty = document.createElement('div');
                empty.style.cssText = 'padding:6px; font-size:11px; color:#7a8b99;';
                empty.textContent = 'No presets yet \u2014 Grab or paste URLs, then Save.';
                presetList.appendChild(empty);
                return;
            }

            presets.forEach((p, index) => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex; align-items:center; gap:6px; padding:4px;' +
                    'cursor:pointer; border-bottom:1px solid #2a475e;';

                const slotCount = Object.keys(presetValues(p)).length;
                const applyHint = (numberKeys && index < 9)
                    ? 'Click to apply or press ' + (index + 1)
                    : 'Click to apply';
                row.title = p.name + ' (' + slotCount + ' item' + (slotCount === 1 ? '' : 's') + ')\n' +
                    applyHint + ' \u00b7 double-click the name to rename';

                if (numberKeys && index < 9) {
                    const badge = document.createElement('span');
                    badge.textContent = String(index + 1);
                    badge.style.cssText = 'flex:none; width:9px; text-align:center; font-size:10px; color:#7a8b99;';
                    row.appendChild(badge);
                }

                const thumb = buildThumb(p);
                const label = document.createElement('div');
                label.style.cssText = 'flex:1; min-width:0; font-size:11px; overflow:hidden;' +
                    'text-overflow:ellipsis; white-space:nowrap;';
                label.textContent = p.name;

                const del = document.createElement('span');
                del.textContent = '\u00d7';
                del.title = 'Delete preset';
                del.style.cssText = 'flex:none; padding:0 4px; color:#7a8b99; font-size:15px; line-height:1;';

                row.appendChild(thumb);
                row.appendChild(label);
                row.appendChild(del);

                function beginRename() {
                    if (label.querySelector('input')) return;
                    row.draggable = false;
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.value = p.name;
                    input.style.cssText = 'width:100%; box-sizing:border-box; padding:1px 2px; font-size:11px;' +
                        'background:#0e1620; color:#c7d5e0; border:1px solid #66c0f4; border-radius:2px;';
                    label.textContent = '';
                    label.appendChild(input);
                    input.focus();
                    input.select();

                    let settled = false;
                    async function finish(save) {
                        if (settled) return;
                        settled = true;
                        row.draggable = true;
                        if (save) {
                            const next = input.value.trim().slice(0, 60) || deriveName(p);
                            if (next !== p.name) {
                                p.name = next;
                                await savePresets();
                                setStatus('Renamed preset ' + (index + 1) + ' to "' + next + '".', false);
                            }
                        }
                        renderPresets();
                    }

                    ['click', 'dblclick', 'mousedown'].forEach(evt =>
                        input.addEventListener(evt, e => e.stopPropagation()));
                    input.addEventListener('keydown', (e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
                        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
                    });
                    input.addEventListener('blur', () => finish(true));
                }

                let nameClickTimer = null;
                label.addEventListener('click', (e) => {
                    e.stopPropagation();
                    clearTimeout(nameClickTimer);
                    nameClickTimer = setTimeout(() => applyPreset(p), 200);
                });
                label.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    clearTimeout(nameClickTimer);
                    beginRename();
                });

                row.addEventListener('mouseenter', () => {
                    row.style.background = '#2a475e';
                    const v = thumb.querySelector('video');
                    if (!v) return;
                    if (!v.getAttribute('src') && v.dataset.clip) {
                        v.src = v.dataset.clip;
                        delete v.dataset.clip;
                    }
                    const pr = v.play();
                    if (pr && pr.catch) pr.catch(() => {});
                });
                row.addEventListener('mouseleave', () => {
                    row.style.background = '';
                    const v = thumb.querySelector('video');
                    if (!v || !v.getAttribute('src')) return;
                    v.pause();
                    try { v.currentTime = 0; } catch (e) {}
                });

                row.draggable = true;
                row.addEventListener('dragstart', (e) => {
                    dragIndex = index;
                    row.style.opacity = '0.4';
                    if (e.dataTransfer) {
                        e.dataTransfer.effectAllowed = 'move';
                        try { e.dataTransfer.setData('text/plain', String(index)); } catch (err) {}
                    }
                });
                row.addEventListener('dragend', () => {
                    dragIndex = null;
                    row.style.opacity = '';
                    clearDropMarkers();
                });
                row.addEventListener('dragover', (e) => {
                    if (dragIndex === null) return;
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                    const rect = row.getBoundingClientRect();
                    const below = e.clientY > rect.top + rect.height / 2;
                    clearDropMarkers();
                    row.style.boxShadow = below ? 'inset 0 -2px 0 #66c0f4' : 'inset 0 2px 0 #66c0f4';
                });
                row.addEventListener('dragleave', () => { row.style.boxShadow = ''; });
                row.addEventListener('drop', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (dragIndex === null) return;
                    const rect = row.getBoundingClientRect();
                    const below = e.clientY > rect.top + rect.height / 2;
                    let target = index + (below ? 1 : 0);
                    const from = dragIndex;
                    dragIndex = null;
                    if (from === target || from === target - 1) { clearDropMarkers(); return; }
                    const [moved] = presets.splice(from, 1);
                    if (from < target) target--;
                    presets.splice(target, 0, moved);
                    await savePresets();
                    renderPresets();
                    setStatus('Preset moved.', false);
                });

                row.addEventListener('click', () => { applyPreset(p); });
                del.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirmDelete && !window.confirm('Delete preset "' + p.name + '"?')) return;
                    const [removed] = presets.splice(index, 1);
                    await savePresets();
                    renderPresets();
                    offerUndo('Deleted "' + removed.name + '".', async () => {
                        const at = Math.min(index, presets.length);
                        presets.splice(at, 0, removed);
                        await savePresets();
                        renderPresets();
                        revealPreset(at);
                        setStatus('Restored "' + removed.name + '".', false);
                    });
                });

                presetList.appendChild(row);
            });
        }

        $('#ppPresetSave').addEventListener('click', async () => {
            // Fields first; fall back to what's applied, so clearing the inputs
            // after applying doesn't lose what you're looking at.
            let slots = readAllFields();
            let source = 'fields';
            if (!Object.keys(slots).length) {
                slots = activeSet();
                source = 'applied';
            }
            if (!Object.keys(slots).length) {
                setStatus('Nothing to save \u2014 press Grab, paste URLs, or apply something first.', true);
                return;
            }

            // Duplicates are allowed on purpose: saving the same look twice
            // under two names is a legitimate thing to want, and refusing
            // read as the Save button being broken. Import still dedupes.
            const candidate = { slots };
            candidate.name = presetNameInput.value.trim().slice(0, 60) || deriveName(candidate);
            candidate.id = newPresetId();
            presets.push(candidate);
            await savePresets();
            presetNameInput.value = '';
            renderPresets();
            revealPreset(presets.length - 1);
            setStatus('Saved "' + candidate.name + '" as preset ' + presets.length + ' (from ' + source + ').', false);
        });

        // ---------------- export / import ----------------

        function newPresetId() { return Date.now() + Math.floor(Math.random() * 1000); }

        function sanitizeUrl(value) {
            if (typeof value !== 'string') return '';
            const trimmed = normalizeUrl(value);
            return /^https?:\/\//i.test(trimmed) ? trimmed : '';
        }

        // Presets grabbed before 1.43 can hold Steam's broken
        // ".../items/<appid>/undefined" sources. Drop them on the way in.
        function sanitizeMediaUrl(value) {
            const url = sanitizeUrl(value);
            return (ITEM_ASSET.test(url) && !ITEM_FILE.test(url)) ? '' : url;
        }

        function sanitizeValue(raw) {
            if (!raw || typeof raw !== 'object') return null;
            const kind = raw.kind || raw.mode;      // 'mode' is the v1 spelling
            if (kind === 'image') {
                const url = sanitizeMediaUrl(raw.url);
                return url ? { kind: 'image', url } : null;
            }
            if (kind === 'video') {
                const mp4 = sanitizeMediaUrl(raw.mp4);
                const webm = sanitizeMediaUrl(raw.webm);
                if (!mp4 && !webm) return null;
                return { kind: 'video', mp4, webm, poster: sanitizeMediaUrl(raw.poster) };
            }
            // Missing this branch dropped every theme on import, so the
            // imported copy of a five-slot preset had four and never matched
            // the original: a duplicate, minus its theme. Values go into
            // style.setProperty, so only known variable names are kept.
            if (kind === 'theme') {
                const cls = typeof raw.bodyClass === 'string' ? raw.bodyClass.trim() : '';
                const bodyClass = /^[A-Za-z0-9_]*Theme$/.test(cls) ? cls : '';
                const vars = {};
                if (raw.vars && typeof raw.vars === 'object') {
                    for (const name of THEME_VARS) {
                        if (typeof raw.vars[name] === 'string') vars[name] = raw.vars[name].slice(0, 200);
                    }
                }
                if (!bodyClass && !Object.keys(vars).length) return null;
                const appid = /^\d+$/.test(raw.appid || '') ? raw.appid : '';
                const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 60) : '';
                return {
                    kind: 'theme', bodyClass, appid, vars,
                    thumb: sanitizeUrl(raw.thumb),
                    label: label || prettyThemeName(bodyClass, appid, vars),
                };
            }
            return null;
        }

        // Accepts this app's format and the old background-swapper export,
        // where a preset WAS a single background value. That file is the only
        // bridge between the two apps' separate storage.
        function sanitizePreset(raw) {
            if (!raw || typeof raw !== 'object') return null;
            const name = (typeof raw.name === 'string' && raw.name.trim())
                ? raw.name.trim().slice(0, 60) : '';

            const slots = {};
            if (raw.slots && typeof raw.slots === 'object') {
                for (const id of Object.keys(raw.slots)) {
                    if (!SLOT_BY_ID[id]) continue;
                    const value = sanitizeValue(raw.slots[id]);
                    if (value) slots[id] = value;
                }
            } else {
                const legacy = sanitizeValue(raw);
                if (legacy) slots.background = legacy;
            }

            if (!Object.keys(slots).length) return null;
            const preset = { slots };
            preset.name = name || deriveName(preset);
            preset.id = newPresetId();
            return preset;
        }

        $('#ppExport').addEventListener('click', async () => {
            if (!presets.length) { setStatus('There are no presets to export.', true); return; }
            const payload = JSON.stringify({
                // Format tag, not a name: kept as-is so old and new exports match.
                app: 'steam-profile-previewer',
                formatVersion: 2,
                exported: new Date().toISOString(),
                presets,
            }, null, 2);

            let url = '';
            try {
                const blob = new Blob([payload], { type: 'application/json' });
                url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'steam-profile-presets-' + new Date().toISOString().slice(0, 10) + '.json';
                document.body.appendChild(a);
                a.click();
                a.remove();
                setStatus('Exported ' + presets.length + ' presets.', false);
                setTimeout(() => URL.revokeObjectURL(url), 10000);
            } catch (e) {
                if (url) URL.revokeObjectURL(url);
                try {
                    await writeClipboard(payload);
                    setStatus('Download blocked \u2014 presets copied to the clipboard instead.', true);
                } catch (e2) {
                    setStatus('Couldn\u2019t download or copy \u2014 select the text below and save it as .json.', true);
                    showTextFallback('Your presets \u2014 copy this and save it as a .json file:', payload);
                }
            }
        });

        $('#ppImport').addEventListener('click', () => importFile.click());

        importFile.addEventListener('change', async () => {
            const file = importFile.files && importFile.files[0];
            if (!file) return;
            try {
                const data = JSON.parse(await file.text());
                const list = Array.isArray(data)
                    ? data
                    : (data && Array.isArray(data.presets) ? data.presets : null);
                if (!list) { setStatus('That file doesn\u2019t look like a preset export.', true); return; }

                const backup = presets.map(item => JSON.parse(JSON.stringify(item)));
                let added = 0, duplicate = 0, invalid = 0, filled = 0;
                const nameConflicts = [];

                for (const raw of list) {
                    const p = sanitizePreset(raw);
                    if (!p) { invalid++; continue; }
                    const dupe = presets.find(existing => samePreset(existing, p));
                    if (dupe) {
                        duplicate++;
                        if (mergePreset(dupe, p)) filled++;
                        const importedName = typeof raw.name === 'string' ? raw.name.trim() : '';
                        if (importedName && importedName !== dupe.name) {
                            nameConflicts.push({ preset: dupe, name: importedName.slice(0, 60) });
                        }
                        continue;
                    }
                    presets.push(p);
                    added++;
                }

                let renamed = 0;
                if (nameConflicts.length) {
                    const useImported = window.confirm(
                        nameConflicts.length + ' imported preset' + (nameConflicts.length === 1 ? '' : 's') +
                        ' match what you already have but use different names.\n\n' +
                        'OK \u2014 use the imported names\nCancel \u2014 keep your current names'
                    );
                    if (useImported) {
                        for (const conflict of nameConflicts) conflict.preset.name = conflict.name;
                        renamed = nameConflicts.length;
                    }
                }

                if (!added && !filled && !renamed) {
                    setStatus('Nothing to import \u2014 ' + duplicate + ' already saved, ' + invalid + ' unusable.', true);
                    return;
                }

                await savePresets();
                renderPresets();

                const parts = [];
                if (added) parts.push('added ' + added);
                if (filled) parts.push('completed ' + filled);
                if (renamed) parts.push('renamed ' + renamed);
                const extras = [];
                if (duplicate) extras.push(duplicate + ' already saved');
                if (invalid) extras.push(invalid + ' unusable');
                offerUndo('Imported: ' + parts.join(', ') + (extras.length ? ' (' + extras.join(', ') + ').' : '.'),
                    async () => {
                        presets = backup;
                        await savePresets();
                        renderPresets();
                        setStatus('Import undone.', false);
                    });
            } catch (e) {
                console.warn('[previewer] import failed', e);
                setStatus('Could not read that file \u2014 is it a valid .json export?', true);
            } finally {
                importFile.value = '';
            }
        });

        $('#ppDeleteAll').addEventListener('click', async () => {
            if (!presets.length) { setStatus('There are no presets to delete.', true); return; }
            if (!window.confirm('Delete all ' + presets.length + ' presets?')) return;
            const backup = presets.slice();
            presets = [];
            await savePresets();
            renderPresets();
            offerUndo('Deleted all ' + backup.length + ' presets.', async () => {
                presets = backup;
                await savePresets();
                renderPresets();
                setStatus('Restored ' + backup.length + ' presets.', false);
            });
        });

        $('#ppReset').addEventListener('click', async () => {
            if (!window.confirm('Reset settings to defaults?\n\nYour saved presets are kept.')) return;
            autoReapply = true; autoInput.checked = true; updateAutoHint();
            confirmDelete = false; confirmInput.checked = false; updateConfirmHint();
            numberKeys = true; keysInput.checked = true; updateKeysHint();
            failedReapplies = 0;
            await store.set(AUTO_KEY, '1');
            await store.set(CONFIRM_KEY, '0');
            await store.set(KEYS_KEY, '1');
            await setApplyEverywhere(false, true);

            uiState = { left: null, top: null, collapsed: false };
            panel.style.left = 'auto';
            panel.style.right = '10px';
            panel.style.top = '10px';
            applyCollapsed();
            await saveUiState();
            renderPresets();
            setStatus('Settings reset to defaults.', false);
        });

        $('#ppDiag').addEventListener('click', async () => {
            const report = {
                url: location.href,
                viewport: { w: window.innerWidth, h: window.innerHeight },
                bodyClass: document.body.className,
                themeSnapshot: (pageSnapshot.theme && pageSnapshot.theme.value) || null,
                snapshot: pageSnapshot,
                applied: activeSet(),
                ownProfile: ownership.owns,
                ownProfileVia: ownership.via || '(undecided)',
                steamPreview: onSteamPreview(),
                applyEverywhere,
                slots: {},
            };
            for (const slot of SLOTS) {
                const state = slotState[slot.id];
                const entry = { hasOriginal: !!state.original, active: state.active };
                if (state.targetEl) {
                    const cs = window.getComputedStyle(state.targetEl);
                    const rect = state.targetEl.getBoundingClientRect();
                    entry.target = {
                        className: state.targetEl.className,
                        backgroundSize: cs.backgroundSize,
                        backgroundPosition: cs.backgroundPosition,
                        backgroundAttachment: cs.backgroundAttachment,
                        rect: { width: Math.round(rect.width), height: Math.round(rect.height),
                                top: Math.round(rect.top), left: Math.round(rect.left) },
                    };
                }
                if (slot.wrapperId) {
                    const wrapper = document.getElementById(slot.wrapperId);
                    if (wrapper) {
                        const ws = window.getComputedStyle(wrapper);
                        const wr = wrapper.getBoundingClientRect();
                        const v = wrapper.querySelector('video');
                        entry.ourBox = {
                            position: ws.position, top: ws.top, left: ws.left,
                            width: ws.width, height: ws.height, zIndex: ws.zIndex,
                            rect: { width: Math.round(wr.width), height: Math.round(wr.height),
                                    top: Math.round(wr.top), left: Math.round(wr.left) },
                            intrinsic: v ? (v.videoWidth + 'x' + v.videoHeight) : null,
                            objectFit: v ? window.getComputedStyle(v).objectFit : null,
                        };
                    }
                }
                report.slots[slot.id] = entry;
            }
            const text = JSON.stringify(report, null, 2);
            console.log('[previewer] diagnostics\n' + text);
            try {
                await writeClipboard(text);
                setStatus('Sizing diagnostics copied.', false);
            } catch (e) {
                setStatus('Clipboard blocked \u2014 the diagnostics are below.', true);
                showTextFallback('Sizing diagnostics:', text);
            }
        });

        // ---------------- erase everything ----------------

        let nukeArmed = false;
        let nukeTimer = null;

        function blastRadius() {
            const bits = [presets.length + ' preset' + (presets.length === 1 ? '' : 's')];
            if (anyActive()) bits.push('what\u2019s applied');
            bits.push('settings');
            return bits.join(', ');
        }

        function disarmNuke() {
            nukeArmed = false;
            clearTimeout(nukeTimer);
            nukeBtn.textContent = 'Erase everything';
            nukeBtn.style.background = '#0d0d0d';
            nukeBtn.style.color = '#c78787';
        }

        async function restoreFromBackup() {
            let backup;
            try {
                const raw = await store.get(BACKUP_KEY, '');
                backup = raw ? JSON.parse(raw) : null;
            } catch (e) { backup = null; }
            if (!backup) { setStatus('The backup is no longer available.', true); return; }

            presets = Array.isArray(backup.presets) ? backup.presets : [];
            await savePresets();

            const settings = backup.settings || {};
            autoReapply = settings.auto !== false;
            confirmDelete = settings.confirm === true;
            numberKeys = settings.keys !== false;
            autoInput.checked = autoReapply;
            confirmInput.checked = confirmDelete;
            keysInput.checked = numberKeys;
            updateAutoHint(); updateConfirmHint(); updateKeysHint();
            await store.set(AUTO_KEY, autoReapply ? '1' : '0');
            await store.set(CONFIRM_KEY, confirmDelete ? '1' : '0');
            await store.set(KEYS_KEY, numberKeys ? '1' : '0');
            await setApplyEverywhere(settings.everywhere === true, true);

            uiState = Object.assign({ left: null, top: null, collapsed: false }, backup.ui || {});
            applyPosition();
            applyCollapsed();
            await saveUiState();

            renderPresets();

            if (backup.applied && Object.keys(backup.applied).length) {
                await store.set(STATE_KEY, JSON.stringify(backup.applied));
                for (const id of Object.keys(backup.applied)) {
                    writeSlotFields(id, backup.applied[id]);
                    if (applyHere()) applySlot(id, backup.applied[id]);
                }
                refreshAllRows();
            }

            await store.set(BACKUP_KEY, '');
            setStatus('Everything restored.', false);
        }

        async function eraseEverything() {
            const fields = {};
            for (const slot of SLOTS) fields[slot.id] = readSlotFields(slot.id);
            const backup = {
                ts: Date.now(),
                presets,
                settings: { auto: autoReapply, confirm: confirmDelete, keys: numberKeys, everywhere: applyEverywhere },
                ui: uiState,
                applied: activeSet(),
                fields,
            };
            const erased = blastRadius();
            await store.set(BACKUP_KEY, JSON.stringify(backup));

            presets = [];
            await savePresets();
            clearAll(true);
            for (const slot of SLOTS) clearSlotFields(slot.id);
            await store.set(STATE_KEY, '');

            autoReapply = true; confirmDelete = false; numberKeys = true;
            autoInput.checked = true; confirmInput.checked = false; keysInput.checked = true;
            updateAutoHint(); updateConfirmHint(); updateKeysHint();
            await store.set(AUTO_KEY, '1');
            await store.set(CONFIRM_KEY, '0');
            await store.set(KEYS_KEY, '1');
            await setApplyEverywhere(false, true);

            uiState = { left: null, top: null, collapsed: false };
            panel.style.left = 'auto';
            panel.style.right = '10px';
            panel.style.top = '10px';
            applyCollapsed();
            await saveUiState();

            renderPresets();
            refreshAllRows();
            offerUndo('Erased: ' + erased + '.', restoreFromBackup, () => { store.set(BACKUP_KEY, ''); });
        }

        nukeBtn.addEventListener('click', async () => {
            if (!nukeArmed) {
                nukeArmed = true;
                nukeBtn.textContent = 'Click again to erase ' + blastRadius();
                nukeBtn.style.background = '#7a1f1f';
                nukeBtn.style.color = '#ffdede';
                setStatus('Export first if you want a copy \u2014 this clears presets and settings.', true);
                nukeTimer = setTimeout(disarmNuke, 3000);
                return;
            }
            disarmNuke();
            await eraseEverything();
        });

        // ---------------- load saved state ----------------

        try {
            const presetsRaw = await store.get(PRESETS_KEY, '');
            if (presetsRaw) presets = JSON.parse(presetsRaw) || [];
        } catch (e) {
            console.warn('[previewer] could not parse saved presets', e);
            presets = [];
        }
        renderPresets();

        try {
            const namesRaw = await store.get(APP_NAMES_KEY, '');
            if (namesRaw) appNames = JSON.parse(namesRaw) || {};
        } catch (e) {
            appNames = {};
        }

        numberKeys = (await store.get(KEYS_KEY, '1')) !== '0';
        keysInput.checked = numberKeys;
        updateKeysHint();

        confirmDelete = (await store.get(CONFIRM_KEY, '0')) === '1';
        confirmInput.checked = confirmDelete;
        updateConfirmHint();

        autoReapply = (await store.get(AUTO_KEY, '1')) !== '0';
        autoInput.checked = autoReapply;
        updateAutoHint();

        try {
            const uiRaw = await store.get(UI_KEY, '');
            if (uiRaw) uiState = Object.assign(uiState, JSON.parse(uiRaw) || {});
        } catch (e) {
            console.warn('[previewer] could not parse saved panel state', e);
        }
        applyPosition();
        applyCollapsed();
        window.addEventListener('resize', applyPosition);

        applyEverywhere = (await store.get(EVERYWHERE_KEY, '0')) === '1';
        everywhereInput.checked = applyEverywhere;
        updateEverywhereHint();
        if (!ON_STORE) await resolveOwnership();

        await loadApplied();
        refreshAllRows();

        // ---------------- cross-tab sync ----------------

        store.subscribe(STATE_KEY, (raw) => {
            if (peeking) peekEnd();
            let saved = {};
            try { saved = raw ? (JSON.parse(raw) || {}) : {}; } catch (e) { return; }

            if (!applyHere()) {
                // A grab-only panel's state lives in its fields, not in
                // activeSet() — which is always empty here, so the diff below
                // would decide nothing had changed and leave stale thumbnails.
                for (const slot of SLOTS) {
                    if (saved[slot.id]) writeSlotFields(slot.id, saved[slot.id]);
                    else clearSlotFields(slot.id);
                }
                refreshAllRows();
                setStatus('Updated from another tab.', false);
                return;
            }

            const current = activeSet();
            const ids = new Set([...Object.keys(current), ...Object.keys(saved)]);
            let changed = false;
            for (const id of ids) {
                if (!SLOT_BY_ID[id]) continue;
                if (!saved[id]) {
                    if (current[id]) { clearSlot(id, true); clearSlotFields(id); changed = true; }
                    continue;
                }
                if (current[id] && sameValue(current[id], saved[id])) continue;
                writeSlotFields(id, saved[id]);
                applySlot(id, saved[id]);
                changed = true;
            }
            if (changed) {
                failedReapplies = 0;
                refreshAllRows();
                setStatus('Updated from another tab.', false);
            }
        });

        store.subscribe(PRESETS_KEY, (raw) => {
            try {
                presets = raw ? (JSON.parse(raw) || []) : [];
                renderPresets();
            } catch (e) {
                console.warn('[previewer] could not parse presets from another tab', e);
            }
        });

        store.subscribe(KEYS_KEY, (raw) => {
            numberKeys = raw !== '0';
            keysInput.checked = numberKeys;
            updateKeysHint();
            renderPresets();
        });
        store.subscribe(CONFIRM_KEY, (raw) => {
            confirmDelete = raw === '1';
            confirmInput.checked = confirmDelete;
            updateConfirmHint();
        });
        store.subscribe(AUTO_KEY, (raw) => {
            autoReapply = raw !== '0';
            autoInput.checked = autoReapply;
            updateAutoHint();
        });
        store.subscribe(EVERYWHERE_KEY, (raw) => { setApplyEverywhere(raw === '1', false); });

        // A fresh backup means an erase probably just happened and the page
        // has since reloaded — keep undo reachable.
        try {
            const backupRaw = await store.get(BACKUP_KEY, '');
            if (backupRaw) {
                const backup = JSON.parse(backupRaw);
                if (backup && backup.ts && Date.now() - backup.ts < 10 * 60 * 1000) {
                    offerUndo('Everything was erased.', restoreFromBackup, () => { store.set(BACKUP_KEY, ''); });
                } else {
                    await store.set(BACKUP_KEY, '');
                }
            }
        } catch (e) {
            console.warn('[previewer] could not read erase backup', e);
        }

        if (ON_STORE) {
            // Nothing here to apply to, so don't offer to.
            $('#ppGrab').textContent = 'Grab previewed item';
            $('#ppGrab').title = 'Grab whatever item preview is open (or press G)';
            $('#ppCopy').title = 'Copy the URL(s) of the open item preview';
            $('#ppApply').title = 'Send the filled slots to your profile tabs';
            $('#ppClear').title = 'Clear everything, here and on your profile tabs';

            // There's no profile here to peek at.
            setPeekAvailable(false, 'Only available on a profile page');

            watchStorePreviews();
            setStatus('Points Shop: open a preview, Grab, then Apply.', false);
        } else {
            updateApplyMode();
            watchForClobber();
            watchForNavigation();
            watchMiniProfile();
        }
    }

    function init() {
        createPanel().catch(e => console.error('[previewer] panel failed', e));
    }

    // @run-at document-start means this runs before Steam's scripts — which is
    // the whole point — but also before <body> exists, so booting waits.
    if (ON_STORE) guardPanelClicks();

    function boot() {
        if (ON_STORE || document.querySelector('.no_header') || document.querySelector('.profile_header_bg')) {
            init();
            return;
        }
        const observer = new MutationObserver((mutations, obs) => {
            if (document.querySelector('.no_header') || document.querySelector('.profile_header_bg')) {
                init();
                obs.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();