// ==UserScript==
// @name         Steam Profile Background Swapper 9.11
// @namespace    http://tampermonkey.net/
// @version      9.11
// @description  Preview any Steam profile theme with your own custom static or animated background
// @author       You
// @match        https://steamcommunity.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'customBg';
    const PRESETS_KEY = 'customBgPresets';
    const AUTO_KEY = 'customBgAuto';
    const UI_KEY = 'customBgUi';
    const CONFIRM_KEY = 'customBgConfirmDelete';
    const KEYS_KEY = 'customBgNumberKeys';
    const BACKUP_KEY = 'customBgEraseBackup';
    const BASE_CLASS = 'no_header profile_page has_profile_background';
    const VIDEO_WRAPPER_ID = 'bg-swapper-video-bg';

    // =================================================================
    // Storage shim
    //
    // Front door for saved settings. Behind it: Tampermonkey's GM
    // storage, or chrome.storage.local when running as an extension
    // content script, or localStorage as a last resort. Everything is
    // async so the extension backend (which returns Promises) needs no
    // call-site changes at port time.
    // =================================================================
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
                console.warn('[bg-swapper] storage read failed', e);
                return fallback;
            }
        },
        // Notify this tab when another tab changes a stored value. Every
        // tab runs its own copy of the script, so without this an already
        // open tab has no idea anything changed until it reloads.
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
                console.warn('[bg-swapper] could not subscribe to', key, e);
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
                console.warn('[bg-swapper] storage write failed', e);
            }
        },
    };

    // =================================================================
    // Defensive detection
    //
    // Every selector below is Valve's private internal naming, not a
    // published API — it can be renamed in any redesign. So: try several
    // independent strategies in order and take the first that works, so
    // one rename breaks one strategy rather than the whole script.
    // =================================================================
    function urlFromCssValue(value) {
        const m = /url\(\s*["']?(.*?)["']?\s*\)/.exec(value || '');
        return m ? m[1] : '';
    }

    const DETECTION_STRATEGIES = [
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
            find() {
                return document.querySelector('.profile_page.has_profile_background');
            },
        },
        {
            name: 'last .no_header (fallback)',
            find() {
                const c = document.querySelectorAll('.no_header');
                return c[c.length - 1] || null;
            },
        },
    ];

    let lastStrategy = 'none';

    function findHeaderEl() {
        for (const strategy of DETECTION_STRATEGIES) {
            let el = null;
            try { el = strategy.find(); } catch (e) { /* strategy failed, try next */ }
            if (el) {
                if (lastStrategy !== strategy.name) {
                    console.log('[bg-swapper] target found via:', strategy.name);
                }
                lastStrategy = strategy.name;
                return el;
            }
        }
        lastStrategy = 'none';
        console.warn('[bg-swapper] no strategy matched — Steam layout may have changed');
        return null;
    }

    const NOT_FOUND_MSG = "Couldn't find the profile background on this page. Either this isn't a profile/preview page, or Steam changed their layout.";

    // =================================================================

    let original = null;
    let targetEl = null;
    let activeBg = null;   // what is actually applied right now
    let peekState = null;  // non-null while peeking at the theme's own background
    let autoReapply = true;
    let failedReapplies = 0;
    let confirmDelete = false;
    let numberKeys = true;
    let neutralized = [];
    let statusEl = null;

    // The theme's own background, captured once before we touch anything.
    let pageSnapshot = { image: '', mp4: '', webm: '', poster: '' };
    let snapshotTaken = false;

    function setStatus(msg, isError) {
        console.log('[bg-swapper]', msg);
        if (!statusEl) return;
        statusEl.textContent = msg;
        statusEl.style.color = isError ? '#ff6b6b' : '#8fbc8f';
    }

    function snapshotPageBackground() {
        if (snapshotTaken) return;
        const snap = { image: '', mp4: '', webm: '', poster: '' };

        const el = findHeaderEl();
        if (el) {
            const cs = window.getComputedStyle(el);
            snap.image = urlFromCssValue(el.style.backgroundImage) ||
                         urlFromCssValue(cs.backgroundImage);
            // How the theme itself sized and placed that image. We strip the
            // theme's classes when applying, which throws these away — so keep
            // them and put them back, instead of inheriting base-class defaults.
            snap.imageStyle = {
                size: cs.backgroundSize,
                position: cs.backgroundPosition,
                repeat: cs.backgroundRepeat,
                attachment: cs.backgroundAttachment,
                origin: cs.backgroundOrigin,
                clip: cs.backgroundClip,
            };
            const rect = el.getBoundingClientRect();
            snap.targetRect = { width: Math.round(rect.width), height: Math.round(rect.height),
                                top: Math.round(rect.top), left: Math.round(rect.left) };
        }

        const themeWrapper = document.querySelector('.profile_animated_background');
        if (themeWrapper) {
            const ws = window.getComputedStyle(themeWrapper);
            const wr = themeWrapper.getBoundingClientRect();
            snap.themeVideoBox = {
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
            snap.themeVideoStyle = {
                objectFit: vs.objectFit, objectPosition: vs.objectPosition,
                width: vs.width, height: vs.height, position: vs.position,
                top: vs.top, left: vs.left, transform: vs.transform,
                intrinsic: (video.videoWidth || 0) + 'x' + (video.videoHeight || 0),
                rect: { width: Math.round(vr.width), height: Math.round(vr.height),
                        top: Math.round(vr.top), left: Math.round(vr.left) },
            };
            snap.poster = video.getAttribute('poster') || '';
            for (const s of video.querySelectorAll('source')) {
                const src = s.getAttribute('src') || '';
                const type = s.getAttribute('type') || '';
                if (/\.webm/i.test(src) || type.includes('webm')) snap.webm = snap.webm || src;
                else if (/\.mp4/i.test(src) || type.includes('mp4')) snap.mp4 = snap.mp4 || src;
            }
            if (!snap.mp4 && !snap.webm && video.currentSrc) snap.mp4 = video.currentSrc;
        }

        pageSnapshot = snap;
        snapshotTaken = true;
        console.log('[bg-swapper] page snapshot:', snap);
    }

    function captureOriginal(el) {
        if (original) return;
        const animatedBg = el.querySelector(':scope > .profile_animated_background');
        original = {
            className: el.className,
            styleCssText: el.style.cssText,
            animatedBgNode: animatedBg || null,
            animatedBgNextSibling: animatedBg ? animatedBg.nextSibling : null,
        };
    }

    function removeExistingAnimatedBg(el) {
        const animatedBg = el.querySelector(':scope > .profile_animated_background');
        if (animatedBg) animatedBg.remove();
    }

    function hasVisibleBg(cs) {
        const img = cs.backgroundImage;
        if (img && img !== 'none') return true;
        const m = (cs.backgroundColor || '').match(/rgba?\(([^)]+)\)/);
        if (!m) return false;
        const parts = m[1].split(',').map(s => parseFloat(s));
        const alpha = parts.length > 3 ? parts[3] : 1;
        return alpha > 0;
    }

    function neutralizeAncestorBackgrounds(el) {
        restoreAncestorBackgrounds();
        let node = el;
        while (node && node.nodeType === 1 && node !== document.body) {
            const cs = window.getComputedStyle(node);
            if (hasVisibleBg(cs)) {
                neutralized.push({
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
        console.log('[bg-swapper] neutralised', neutralized.length, 'ancestor background(s)');
    }

    function restoreAncestorBackgrounds() {
        for (const rec of neutralized) {
            rec.el.style.removeProperty('background-color');
            rec.el.style.removeProperty('background-image');
            if (rec.color) rec.el.style.setProperty('background-color', rec.color, rec.colorPriority);
            if (rec.image) rec.el.style.setProperty('background-image', rec.image, rec.imagePriority);
        }
        neutralized = [];
    }

    function removeInjectedVideo() {
        const existing = document.getElementById(VIDEO_WRAPPER_ID);
        if (existing) existing.remove();
    }

    // ---------------- input validation ----------------
    //
    // Three different failures, deliberately handled differently:
    //   can't work      -> block, with the reason
    //   wrong field     -> block, and say which field it belongs in
    //   not a Steam URL -> apply it, mention it once
    // Previewing your own images is a legitimate use; only impossibilities
    // are refused.

    const STEAM_CDN = /(^|\.)steamstatic\.com$|(^|\.)akamaihd\.net$|(^|\.)steamcommunity\.com$/i;

    // Fix what can be fixed rather than refusing it. A missing scheme is a
    // typo, not a decision, and browsers already auto-upgrade http:// media to
    // https:// on secure pages — so http:// links are fine to accept, and we
    // retry over https ourselves if one genuinely fails.
    function normalizeUrl(raw) {
        let url = (raw || '').trim();
        if (!url) return '';
        if (/^\/\//.test(url)) return 'https:' + url;            // //host/path
        if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;        // already has a scheme
        if (/^[^\s/]+\.[^\s/]+\//.test(url) || /^[^\s/]+\.[^\s/]+$/.test(url)) {
            return 'https://' + url;                             // host/path, no scheme
        }
        return url;
    }

    function toHttps(url) {
        return url ? url.replace(/^http:/i, 'https:') : url;
    }

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

    // Applying is instant; whether the URL actually resolves is not knowable
    // until it loads. So apply first, then report a failure if one arrives —
    // but only if that background is still the current one.
    function probeImage(url) {
        const stillCurrent = () => activeBg && activeBg.mode === 'image' && activeBg.url === url;

        const probe = new Image();
        probe.onerror = () => {
            if (!stillCurrent()) return;
            if (/^http:\/\//i.test(url)) {
                // Try the secure version before reporting failure.
                const secure = toHttps(url);
                const retry = new Image();
                retry.onload = () => {
                    if (!stillCurrent()) return;
                    applyImageBackground(secure);
                    setStatus('Loaded it over https:// instead.', false);
                };
                retry.onerror = () => {
                    if (!stillCurrent()) return;
                    setStatus('That URL didn\u2019t load as an image \u2014 check the link is correct and public.', true);
                };
                retry.src = secure;
                return;
            }
            setStatus('That URL didn\u2019t load as an image \u2014 check the link is correct and public.', true);
        };
        probe.onload = () => {
            if (!stillCurrent()) return;
            if (!isSteamCdn(url)) setStatus('Image applied (not a Steam CDN link).', false);
        };
        probe.src = url;
    }

    // ---------------- image mode ----------------

    function applyImageBackground(url) {
        url = normalizeUrl(url);
        const el = findHeaderEl();
        if (!el) { setStatus(NOT_FOUND_MSG, true); return; }
        if (!url) { setStatus('Enter an image URL.', true); return; }

        const problem = urlProblem(url);
        if (problem) { setStatus(problem, true); return; }
        if (looksLikeVideo(url)) {
            setStatus('That looks like a video file \u2014 switch to Video mode for it.', true);
            return;
        }

        targetEl = el;
        captureOriginal(el);

        removeInjectedVideo();
        restoreAncestorBackgrounds();
        removeExistingAnimatedBg(el);
        el.className = BASE_CLASS;
        el.style.cssText = `background-image: url('${url}');`;

        // Put the theme's own sizing back. Stripping the theme classes (which
        // is what stops golden_profile / full_width_background breaking the
        // layout) also drops their background-size, so the image would render
        // at natural size instead of the 100% width Steam uses.
        //
        // These values are valid whether or not the theme's own background was
        // an image — an animated theme's classes still describe how a static
        // background should be sized. Only 'auto' means "nothing useful here",
        // in which case fall back to Steam's convention: full width, top edge.
        const themeStyle = pageSnapshot.imageStyle || {};
        const usableSize = themeStyle.size && themeStyle.size !== 'auto';
        el.style.setProperty('background-size', usableSize ? themeStyle.size : '100%');
        el.style.setProperty('background-position', usableSize ? themeStyle.position : '50% 0');
        el.style.setProperty('background-attachment', themeStyle.attachment || 'scroll');
        // Never inherit 'repeat': a tiled profile background is always wrong.
        el.style.setProperty('background-repeat', 'no-repeat');
        if (themeStyle.origin) el.style.setProperty('background-origin', themeStyle.origin);
        if (themeStyle.clip) el.style.setProperty('background-clip', themeStyle.clip);

        // Verify rather than assume: confirm the page actually ended up
        // showing our image, so a silent CSS conflict can't look like success.
        const applied = urlFromCssValue(window.getComputedStyle(el).backgroundImage);
        if (!applied) {
            setStatus('Applied, but the element shows no background image. Steam may have changed their CSS.', true);
        } else if (applied.split('/').pop() !== url.split('/').pop()) {
            setStatus('Applied, but a different image is winning — CSS conflict on this page.', true);
        } else {
            activeBg = { mode: 'image', url };
            setStatus('Image applied.', false);
            probeImage(url);
        }
    }

    // ---------------- video mode ----------------

    const MEDIA_ERRORS = {
        1: 'ABORTED (1) — load cancelled',
        2: 'NETWORK (2) — URL unreachable / blocked',
        3: 'DECODE (3) — file corrupt or unsupported encoding',
        4: 'SRC_NOT_SUPPORTED (4) — bad URL or codec the browser refuses',
    };

    function applyVideoBackground(mp4Url, webmUrl, posterUrl, httpsRetried) {
        mp4Url = normalizeUrl(mp4Url);
        webmUrl = normalizeUrl(webmUrl);
        posterUrl = normalizeUrl(posterUrl);
        const el = findHeaderEl();
        if (!el) { setStatus(NOT_FOUND_MSG, true); return; }
        if (!mp4Url && !webmUrl) { setStatus('Enter an .mp4 or .webm URL.', true); return; }

        for (const [label, candidate] of [['mp4', mp4Url], ['webm', webmUrl]]) {
            if (!candidate) continue;
            const issue = urlProblem(candidate);
            if (issue) { setStatus(label + ' \u2014 ' + issue, true); return; }
            if (looksLikeImage(candidate)) {
                setStatus('The ' + label + ' URL looks like an image \u2014 use Image mode for stills.', true);
                return;
            }
        }
        // A broken poster shouldn't block a working video: drop it instead.
        if (posterUrl && urlProblem(posterUrl)) {
            console.warn('[bg-swapper] ignoring unusable poster URL:', posterUrl);
            posterUrl = '';
        }

        targetEl = el;
        captureOriginal(el);

        removeInjectedVideo();
        removeExistingAnimatedBg(el);
        el.className = BASE_CLASS;
        el.style.cssText = '';

        const wrapper = document.createElement('div');
        // No Steam class name here — reusing .profile_animated_background
        // pulled in Steam's own rules for that class.
        //
        // Geometry now mirrors what Steam itself does, measured from a live
        // themed page: an absolutely positioned, full-page-height wrapper with
        // overflow hidden, containing a video left at its NATURAL size,
        // anchored to the top and centred horizontally.
        //
        // The early attempt that blew the video up stretched the *video* to
        // 100% of this container. Steam stretches the *wrapper* and leaves the
        // video alone — that distinction is the whole fix.
        wrapper.id = VIDEO_WRAPPER_ID;
        wrapper.style.setProperty('position', 'absolute', 'important');
        wrapper.style.setProperty('top', '0', 'important');
        wrapper.style.setProperty('left', '0', 'important');
        wrapper.style.setProperty('width', '100%', 'important');
        wrapper.style.setProperty('height', '100%', 'important');
        wrapper.style.setProperty('overflow', 'hidden', 'important');
        wrapper.style.setProperty('pointer-events', 'none', 'important');
        wrapper.style.setProperty('background', 'transparent', 'important');
        // Behind the page's own content, but above the element's background.
        wrapper.style.setProperty('z-index', '-1', 'important');

        const video = document.createElement('video');
        video.autoplay = true;
        video.muted = true;
        video.defaultMuted = true;
        video.loop = true;
        video.playsInline = true;
        video.setAttribute('muted', '');
        video.setAttribute('playsinline', '');
        if (posterUrl) video.poster = posterUrl;
        video.style.setProperty('position', 'absolute', 'important');
        video.style.setProperty('top', '0', 'important');
        video.style.setProperty('left', '50%', 'important');
        video.style.setProperty('transform', 'translateX(-50%)', 'important');
        video.style.setProperty('object-fit', 'contain', 'important');
        video.style.setProperty('display', 'block', 'important');
        // Until metadata arrives the natural size is unknown, so fall back to
        // container width with a proportional height.
        video.style.setProperty('width', '100%', 'important');
        video.style.setProperty('height', 'auto', 'important');

        function sizeToNatural() {
            if (video.videoWidth && video.videoHeight) {
                video.style.setProperty('width', video.videoWidth + 'px', 'important');
                video.style.setProperty('height', video.videoHeight + 'px', 'important');
            }
        }

        video.addEventListener('loadedmetadata', () => {
            sizeToNatural();
            console.log('[bg-swapper] video natural size:', video.videoWidth + 'x' + video.videoHeight);
        });
        video.addEventListener('playing', () => {
            const fromSteam = isSteamCdn(mp4Url || '') || isSteamCdn(webmUrl || '');
            setStatus(fromSteam ? 'Video playing.' : 'Video playing (not a Steam CDN link).', false);
        });
        video.addEventListener('error', () => {
            const usesHttp = /^http:\/\//i.test(mp4Url || '') || /^http:\/\//i.test(webmUrl || '');
            if (usesHttp && !httpsRetried) {
                setStatus('Retrying over https\u2026', false);
                applyVideoBackground(toHttps(mp4Url), toHttps(webmUrl), toHttps(posterUrl), true);
                return;
            }
            const code = video.error ? video.error.code : 0;
            setStatus('Video error: ' + (MEDIA_ERRORS[code] || 'unknown'), true);
        });

        if (webmUrl) {
            const s = document.createElement('source');
            s.src = webmUrl;
            s.type = 'video/webm';
            s.addEventListener('error', () => console.warn('[bg-swapper] webm source failed:', webmUrl));
            video.appendChild(s);
        }
        if (mp4Url) {
            const s = document.createElement('source');
            s.src = mp4Url;
            s.type = 'video/mp4';
            s.addEventListener('error', () => console.warn('[bg-swapper] mp4 source failed:', mp4Url));
            video.appendChild(s);
        }

        wrapper.appendChild(video);
        // Inside the themed element, exactly where Steam puts its own — so it
        // scrolls with the page instead of staying pinned to the viewport.
        el.insertBefore(wrapper, el.firstChild);
        neutralizeAncestorBackgrounds(el);

        // Verify the wrapper survived and has real size on screen.
        const rect = wrapper.getBoundingClientRect();
        if (!wrapper.isConnected || rect.width < 1 || rect.height < 1) {
            setStatus('Video container has no size — page CSS may be interfering.', true);
            return;
        }

        activeBg = { mode: 'video', mp4: mp4Url, webm: webmUrl, poster: posterUrl };
        setStatus('Loading video…', false);
        video.load();
        const p = video.play();
        if (p && p.catch) p.catch(err => setStatus('Autoplay blocked: ' + err.name, true));
    }

    // A <video> pauses when it's removed from the DOM and does not resume on
    // re-insertion — the autoplay attribute only fires on initial load. Both
    // Clear and Peek put the theme's own animated background back, so both
    // need this; keeping it in one place is what stops them drifting apart.
    function resumeThemeVideo(node) {
        if (!node) return;
        const video = node.querySelector('video');
        if (!video) return;
        const attempt = () => {
            const pr = video.play();
            if (pr && pr.catch) {
                pr.catch(() => {
                    try { video.load(); } catch (e) {}
                    const retry = video.play();
                    if (retry && retry.catch) retry.catch(() => {});
                });
            }
        };
        attempt();
    }

    function clearBackground() {
        removeInjectedVideo();
        restoreAncestorBackgrounds();

        if (!targetEl || !original) {
            activeBg = null;
            setStatus('Cleared.', false);
            return;
        }

        targetEl.className = original.className;
        targetEl.style.cssText = original.styleCssText;

        if (original.animatedBgNode) {
            if (original.animatedBgNextSibling && original.animatedBgNextSibling.parentNode === targetEl) {
                targetEl.insertBefore(original.animatedBgNode, original.animatedBgNextSibling);
            } else {
                targetEl.insertBefore(original.animatedBgNode, targetEl.firstChild);
            }
            resumeThemeVideo(original.animatedBgNode);
        }

        original = null;
        targetEl = null;
        activeBg = null;
        setStatus('Cleared.', false);
    }

    // ---------------- peek original ----------------
    //
    // Temporarily put the page back the way Steam had it, so you can flip
    // between the theme's intended background and yours. Deliberately does
    // NOT go through clearBackground(), because that discards the state
    // needed to put things back — and it hides our video rather than
    // destroying it, so releasing is instant instead of a reload.

    function peekStart() {
        if (peekState || !activeBg || !targetEl || !original) return;

        peekState = {
            className: targetEl.className,
            cssText: targetEl.style.cssText,
        };

        const wrapper = document.getElementById(VIDEO_WRAPPER_ID);
        if (wrapper) {
            wrapper.style.setProperty('display', 'none', 'important');
            peekState.hadVideo = true;
        }

        // Ancestors were made transparent to let our video show through;
        // the theme needs its own backgrounds back to look right.
        restoreAncestorBackgrounds();

        targetEl.className = original.className;
        targetEl.style.cssText = original.styleCssText;

        // Put the theme's own animated background back, if it had one.
        if (original.animatedBgNode && !original.animatedBgNode.isConnected) {
            targetEl.insertBefore(original.animatedBgNode, targetEl.firstChild);
            resumeThemeVideo(original.animatedBgNode);
            peekState.reinsertedThemeBg = true;
        }

        setStatus('Peeking at the theme\u2019s own background\u2026', false);
    }

    function peekEnd() {
        if (!peekState) return;

        if (peekState.reinsertedThemeBg && original.animatedBgNode) {
            original.animatedBgNode.remove();
        }

        if (targetEl) {
            targetEl.className = peekState.className;
            targetEl.style.cssText = peekState.cssText;
        }

        if (peekState.hadVideo) {
            const wrapper = document.getElementById(VIDEO_WRAPPER_ID);
            if (wrapper) wrapper.style.removeProperty('display');
            if (targetEl) neutralizeAncestorBackgrounds(targetEl);
        }

        peekState = null;
        setStatus('Back to your background.', false);
    }

    function isTypingTarget(el) {
        if (!el) return false;
        const tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    }

    // ---------------- auto-reapply ----------------
    //
    // Two different things can lose the background: navigating to the next
    // theme, and Steam's own scripts rewriting the element under us. They
    // need different handling — a navigation means re-reading the new page
    // from scratch, while a clobber means re-applying over state we already
    // captured. Conflating them would corrupt what Clear and Peek restore.

    function isStillApplied() {
        if (!activeBg) return true;
        if (!targetEl || !targetEl.isConnected) return false;
        if (activeBg.mode === 'video') {
            const wrapper = document.getElementById(VIDEO_WRAPPER_ID);
            return !!(wrapper && wrapper.isConnected);
        }
        const applied = urlFromCssValue(window.getComputedStyle(targetEl).backgroundImage);
        if (!applied) return false;
        return applied.split('/').pop() === (activeBg.url || '').split('/').pop();
    }

    function reapplyActive(reason) {
        if (!autoReapply || !activeBg || peekState) return;
        const bg = activeBg;
        console.log('[bg-swapper] re-applying:', reason);
        if (bg.mode === 'image') applyImageBackground(bg.url);
        else applyVideoBackground(bg.mp4, bg.webm, bg.poster);
    }

    function handleUrlChange() {
        // New page: everything captured about the old one is stale.
        restoreAncestorBackgrounds();
        removeInjectedVideo();
        original = null;
        targetEl = null;
        peekState = null;
        snapshotTaken = false;
        failedReapplies = 0;

        setTimeout(() => {
            snapshotPageBackground();
            reapplyActive('navigation');
        }, 300);
    }

    let clobberTimer = null;

    function watchForClobber() {
        const observer = new MutationObserver(() => {
            if (!autoReapply || !activeBg || peekState) return;
            clearTimeout(clobberTimer);
            clobberTimer = setTimeout(() => {
                if (peekState || isStillApplied()) { failedReapplies = 0; return; }
                if (failedReapplies >= 3) {
                    // Something is fighting us and winning. Stop rather than
                    // loop forever re-applying a background that won't stick.
                    if (autoReapply) {
                        autoReapply = false;
                        setStatus('Background keeps being reset by the page — auto-reapply paused.', true);
                    }
                    return;
                }
                failedReapplies++;
                reapplyActive('page reset the background');
            }, 300);
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style'],
        });
    }

    function watchForNavigation() {
        let lastUrl = location.href;
        // Polling rather than patching history.pushState: the userscript
        // sandbox and the page see different window objects, so a patch
        // isn't reliably visible to Steam's own navigation calls.
        setInterval(() => {
            if (location.href === lastUrl) return;
            lastUrl = location.href;
            handleUrlChange();
        }, 1000);
        window.addEventListener('popstate', handleUrlChange);
    }

    // ---------------- panel ----------------

    async function createPanel() {
        if (document.getElementById('bg-swapper-panel')) return;

        // Snapshot the theme's own background BEFORE anything is applied,
        // otherwise "Grab from this page" would just grab our own edit.
        snapshotPageBackground();

        const panel = document.createElement('div');
        panel.id = 'bg-swapper-panel';
        panel.style.cssText = `
            position: fixed; top: 10px; right: 10px; z-index: 99999;
            background: #1b2838; border: 1px solid #66c0f4; border-radius: 6px;
            padding: 10px; font-family: Arial, sans-serif; color: #c7d5e0;
            box-shadow: 0 2px 8px rgba(0,0,0,0.5); width: 280px;
        `;
        panel.innerHTML = `
            <div id="bgPanelHeader" title="Drag to move"
                style="display:flex; align-items:center; gap:6px; margin-bottom:8px;
                cursor:move; user-select:none;">
                <div style="flex:1; font-weight:bold;">Custom Background</div>
                <span id="bgCollapseBtn" title="Collapse"
                    style="cursor:pointer; padding:0 4px; font-size:12px; color:#7a8b99;">&#9662;</span>
            </div>
            <div id="bgPanelBody">
            <div style="display:flex; gap:6px; margin-bottom:8px;">
                <button id="bgGrabBtn" title="Fill the fields below with this page's own theme background"
                    style="flex:1; padding:5px; cursor:pointer;
                    background:#2a475e; border:1px solid #66c0f4; border-radius:3px; color:#c7d5e0;">
                    Grab from this page
                </button>
                <button id="bgCopyBtn" title="Copy the URL(s) of this page's own theme background (not the one you've applied)"
                    style="flex:none; padding:5px 10px; cursor:pointer; background:#2a475e;
                    border:1px solid #2a475e; border-radius:3px; color:#c7d5e0;">
                    Copy
                </button>
            </div>
            <div style="font-size:11px; color:#7a8b99; margin-bottom:4px;">Presets</div>
            <div id="bgPresetList" style="max-height:132px; overflow-y:auto; margin-bottom:6px;
                border:1px solid #2a475e; border-radius:3px;"></div>
            <div id="bgUndoBar" style="display:none; align-items:center; gap:6px; margin-bottom:6px;
                padding:4px 6px; border:1px solid #66c0f4; border-radius:3px;
                background:#22394d; font-size:11px;">
                <span id="bgUndoMsg" style="flex:1; min-width:0;"></span>
                <button id="bgUndoBtn" title="Undo the change described here"
                    style="flex:none; padding:2px 8px; cursor:pointer;
                    background:#66c0f4; border:none; border-radius:3px; color:#1b2838;
                    font-weight:bold; font-size:11px;">Undo</button>
                <span id="bgUndoDismiss" title="Dismiss"
                    style="flex:none; cursor:pointer; color:#7a8b99; padding:0 2px; font-size:14px;">&times;</span>
            </div>
            <div style="display:flex; gap:6px; margin-bottom:10px;">
                <input id="bgPresetName" type="text" placeholder="Preset name (optional)"
                    style="flex:1; min-width:0; box-sizing:border-box; padding:4px;">
                <button id="bgPresetSave" title="Save the current URL(s) as a preset. Uses the applied background if the fields are empty."
                    style="flex:none; padding:4px 10px; cursor:pointer;
                    background:#2a475e; border:none; border-radius:3px; color:#c7d5e0;">Save</button>
            </div>
            <div style="margin-bottom:6px; font-size:12px;">
                <label style="margin-right:10px; cursor:pointer;">
                    <input type="radio" name="bgMode" value="image" checked> Image
                </label>
                <label style="cursor:pointer;">
                    <input type="radio" name="bgMode" value="video"> Video
                </label>
            </div>
            <div id="imageFields">
                <input id="bgImageUrl" type="text" placeholder="Image URL"
                    style="width:100%; box-sizing:border-box; margin-bottom:6px; padding:4px;">
            </div>
            <div id="videoFields" style="display:none;">
                <input id="bgVideoMp4" type="text" placeholder="Video URL (.mp4)"
                    style="width:100%; box-sizing:border-box; margin-bottom:6px; padding:4px;">
                <input id="bgVideoWebm" type="text" placeholder="Video URL (.webm, optional)"
                    style="width:100%; box-sizing:border-box; margin-bottom:6px; padding:4px;">
                <input id="bgVideoPoster" type="text" placeholder="Poster image URL (optional)"
                    style="width:100%; box-sizing:border-box; margin-bottom:6px; padding:4px;">
                <div style="font-size:11px; color:#7a8b99; margin-bottom:6px;">
                    Poster only shows before the first frame decodes. For a still image, use Image mode.
                </div>
            </div>
            <div style="display:flex; gap:6px;">
                <button id="bgApplyBtn" title="Apply the URL(s) above as this page's background"
                    style="flex:1; padding:5px; cursor:pointer;
                    background:#66c0f4; border:none; border-radius:3px; color:#1b2838; font-weight:bold;">
                    Apply
                </button>
                <button id="bgClearBtn" title="Remove your background and put the page's own theme back"
                    style="flex:1; padding:5px; cursor:pointer;
                    background:#2a475e; border:none; border-radius:3px; color:#c7d5e0;">
                    Clear
                </button>
                <button id="bgPeekBtn" title="Hold to see the theme's own background (or hold P)"
                    style="flex:1; padding:5px; cursor:pointer; background:#2a475e;
                    border:1px solid #66c0f4; border-radius:3px; color:#c7d5e0;">
                    Peek
                </button>
            </div>
            <div id="bgAdvancedToggle" title="Settings you shouldn't normally need"
                style="margin-top:8px; font-size:11px; color:#7a8b99; cursor:pointer; user-select:none;">
                &#9656; Advanced
            </div>
            <div id="bgAdvanced" style="display:none; margin-top:6px; padding:6px;
                border:1px solid #2a475e; border-radius:3px;">
                <label title="Press 1-9 anywhere on the page to apply that preset. Numbers follow the list order."
                    style="display:block; margin-top:6px; font-size:11px; cursor:pointer; color:#7a8b99;">
                    <input id="bgNumberKeys" type="checkbox" checked> Number keys apply presets<span
                        id="bgKeysDefaultHint" style="display:none; color:#b8873c;"> — default: on</span>
                </label>
                <label title="Off by default — deleting a preset can be undone from the status line."
                    style="display:block; margin-top:6px; font-size:11px; cursor:pointer; color:#7a8b99;">
                    <input id="bgConfirmDelete" type="checkbox"> Ask before deleting a preset<span
                        id="bgConfirmDefaultHint" style="display:none; color:#b8873c;"> — default: off</span>
                </label>
                <label title="Puts your background back if the page resets it, or if Steam swaps the page content without a reload."
                    style="display:block; font-size:11px; cursor:pointer; color:#7a8b99;">
                    <input id="bgAutoReapply" type="checkbox" checked> Keep applied while browsing<span
                        id="bgAutoDefaultHint" style="display:none; color:#b8873c;"> — default: on</span>
                </label>
                <div style="display:flex; gap:6px; margin-top:6px;">
                    <button id="bgExportBtn" title="Download all presets as a .json file"
                        style="flex:1; padding:4px; cursor:pointer; background:#2a475e;
                        border:none; border-radius:3px; color:#c7d5e0; font-size:11px;">
                        Export
                    </button>
                    <button id="bgImportBtn" title="Add presets from a .json file. Existing presets are kept."
                        style="flex:1; padding:4px; cursor:pointer; background:#2a475e;
                        border:none; border-radius:3px; color:#c7d5e0; font-size:11px;">
                        Import
                    </button>
                </div>
                <input id="bgImportFile" type="file" accept="application/json,.json" style="display:none;">
                <button id="bgDeleteAllBtn" title="Delete every saved preset. Always asks first."
                    style="width:100%; margin-top:6px; padding:4px; cursor:pointer; background:#5a2a2a;
                    border:none; border-radius:3px; color:#e8c7c7; font-size:11px;">
                    Delete all presets
                </button>
                <button id="bgResetBtn" title="Restore default settings. Saved presets are kept."
                    style="width:100%; margin-top:6px; padding:4px; cursor:pointer; background:#2a475e;
                    border:none; border-radius:3px; color:#c7d5e0; font-size:11px;">
                    Reset settings to defaults
                </button>
                <button id="bgDiagBtn" title="Copy measurements of this page's own background, for debugging sizing"
                    style="width:100%; margin-top:6px; padding:4px; cursor:pointer; background:#2a475e;
                    border:none; border-radius:3px; color:#c7d5e0; font-size:11px;">
                    Copy sizing diagnostics
                </button>
                <div style="margin-top:12px; padding-top:10px; border-top:1px solid #2a475e;">
                    <button id="bgNukeBtn" title="Erases presets, settings, panel position and the applied background. A backup is kept so it can be undone."
                        style="width:100%; padding:5px; cursor:pointer; background:#0d0d0d;
                        border:1px solid #3a1f1f; border-radius:3px; color:#c78787; font-size:11px;">
                        Erase everything
                    </button>
                </div>
            </div>
            <div id="bg-swapper-status" style="margin-top:6px; font-size:11px; min-height:14px;
                word-break:break-word; color:#8fbc8f;"></div>
            <div id="bgTextOut" style="display:none; margin-top:6px;">
                <div id="bgTextOutLabel" style="font-size:11px; color:#7a8b99; margin-bottom:4px;"></div>
                <textarea id="bgTextOutArea" readonly rows="5" style="width:100%; box-sizing:border-box;
                    font-size:10px; font-family:monospace; background:#0e1620; color:#c7d5e0;
                    border:1px solid #2a475e; border-radius:3px; resize:vertical;"></textarea>
                <button id="bgTextOutClose" title="Hide this text box"
                    style="width:100%; margin-top:4px; padding:3px; cursor:pointer;
                    background:#2a475e; border:none; border-radius:3px; color:#c7d5e0; font-size:11px;">
                    Close
                </button>
            </div>
            </div>
        `;
        document.body.appendChild(panel);

        const modeInputs = panel.querySelectorAll('input[name="bgMode"]');
        const imageFields = panel.querySelector('#imageFields');
        const videoFields = panel.querySelector('#videoFields');
        const imageUrlInput = panel.querySelector('#bgImageUrl');
        const videoMp4Input = panel.querySelector('#bgVideoMp4');
        const videoWebmInput = panel.querySelector('#bgVideoWebm');
        const videoPosterInput = panel.querySelector('#bgVideoPoster');
        const grabBtn = panel.querySelector('#bgGrabBtn');
        const presetList = panel.querySelector('#bgPresetList');
        const presetNameInput = panel.querySelector('#bgPresetName');
        const presetSaveBtn = panel.querySelector('#bgPresetSave');
        const undoBar = panel.querySelector('#bgUndoBar');
        const undoMsg = panel.querySelector('#bgUndoMsg');
        const undoBtn = panel.querySelector('#bgUndoBtn');
        const undoDismiss = panel.querySelector('#bgUndoDismiss');
        const applyBtn = panel.querySelector('#bgApplyBtn');
        const clearBtn = panel.querySelector('#bgClearBtn');
        const peekBtn = panel.querySelector('#bgPeekBtn');
        const autoInput = panel.querySelector('#bgAutoReapply');
        const autoHint = panel.querySelector('#bgAutoDefaultHint');
        const copyBtn = panel.querySelector('#bgCopyBtn');
        const panelHeader = panel.querySelector('#bgPanelHeader');
        const panelBody = panel.querySelector('#bgPanelBody');
        const collapseBtn = panel.querySelector('#bgCollapseBtn');
        const advancedToggle = panel.querySelector('#bgAdvancedToggle');
        const advancedBox = panel.querySelector('#bgAdvanced');
        const resetBtn = panel.querySelector('#bgResetBtn');
        const confirmInput = panel.querySelector('#bgConfirmDelete');
        const keysInput = panel.querySelector('#bgNumberKeys');
        const keysHint = panel.querySelector('#bgKeysDefaultHint');
        const confirmHint = panel.querySelector('#bgConfirmDefaultHint');
        const deleteAllBtn = panel.querySelector('#bgDeleteAllBtn');
        const diagBtn = panel.querySelector('#bgDiagBtn');
        const exportBtn = panel.querySelector('#bgExportBtn');
        const nukeBtn = panel.querySelector('#bgNukeBtn');
        const textOut = panel.querySelector('#bgTextOut');
        const textOutLabel = panel.querySelector('#bgTextOutLabel');
        const textOutArea = panel.querySelector('#bgTextOutArea');
        const textOutClose = panel.querySelector('#bgTextOutClose');
        const importBtn = panel.querySelector('#bgImportBtn');
        const importFile = panel.querySelector('#bgImportFile');
        statusEl = panel.querySelector('#bg-swapper-status');

        function getMode() {
            for (const r of modeInputs) if (r.checked) return r.value;
            return 'image';
        }

        function setMode(mode) {
            for (const r of modeInputs) r.checked = (r.value === mode);
            imageFields.style.display = mode === 'image' ? '' : 'none';
            videoFields.style.display = mode === 'video' ? '' : 'none';
        }

        modeInputs.forEach(r => r.addEventListener('change', () => setMode(getMode())));

        grabBtn.addEventListener('click', () => {
            const s = pageSnapshot;
            if (s.mp4 || s.webm) {
                videoMp4Input.value = s.mp4 || '';
                videoWebmInput.value = s.webm || '';
                videoPosterInput.value = s.poster || '';
                setMode('video');
                setStatus('Grabbed this page\u2019s own animated background. Press Apply to keep it.', false);
            } else if (s.image) {
                imageUrlInput.value = s.image;
                setMode('image');
                setStatus('Grabbed this page\u2019s own background image. Press Apply to keep it.', false);
            } else {
                setStatus('No background found on this page to grab.', true);
            }
        });

        applyBtn.addEventListener('click', async () => {
            if (getMode() === 'image') {
                // Write the tidied URL back so the field shows what was used.
                const url = normalizeUrl(imageUrlInput.value);
                imageUrlInput.value = url;
                if (url) await store.set(STORAGE_KEY, JSON.stringify({ mode: 'image', url }));
                applyImageBackground(url);
            } else {
                const mp4 = normalizeUrl(videoMp4Input.value);
                const webm = normalizeUrl(videoWebmInput.value);
                const poster = normalizeUrl(videoPosterInput.value);
                videoMp4Input.value = mp4;
                videoWebmInput.value = webm;
                videoPosterInput.value = poster;
                if (mp4 || webm) await store.set(STORAGE_KEY, JSON.stringify({ mode: 'video', mp4, webm, poster }));
                applyVideoBackground(mp4, webm, poster);
            }
        });

        clearBtn.addEventListener('click', async () => {
            await store.set(STORAGE_KEY, '');
            imageUrlInput.value = '';
            videoMp4Input.value = '';
            videoWebmInput.value = '';
            videoPosterInput.value = '';
            clearBackground();
        });

        // Hold the button, or hold P anywhere on the page.
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

        // ---------------- panel chrome ----------------

        let uiState = { left: null, top: null, collapsed: false };

        async function saveUiState() {
            await store.set(UI_KEY, JSON.stringify(uiState));
        }

        function applyCollapsed() {
            panelBody.style.display = uiState.collapsed ? 'none' : '';
            collapseBtn.innerHTML = uiState.collapsed ? '&#9656;' : '&#9662;';
            collapseBtn.title = uiState.collapsed ? 'Expand' : 'Collapse';
        }

        function clampToViewport(left, top) {
            const w = panel.offsetWidth || 280;
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
        panelHeader.addEventListener('mousedown', (e) => {
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

        resetBtn.addEventListener('click', async () => {
            if (!window.confirm('Reset settings to defaults?\n\nYour saved presets are kept.')) return;
            autoReapply = true;
            autoInput.checked = true;
            failedReapplies = 0;
            updateAutoHint();
            await store.set(AUTO_KEY, '1');

            confirmDelete = false;
            confirmInput.checked = false;
            updateConfirmHint();
            await store.set(CONFIRM_KEY, '0');

            numberKeys = true;
            keysInput.checked = true;
            updateKeysHint();
            await store.set(KEYS_KEY, '1');
            renderPresets();

            uiState = { left: null, top: null, collapsed: false };
            panel.style.left = 'auto';
            panel.style.right = '10px';
            panel.style.top = '10px';
            applyCollapsed();
            await saveUiState();

            setStatus('Settings reset to defaults.', false);
        });

        // Say nothing while the setting is at its default; only speak up once
        // it has been changed, when "is this how it shipped?" is the question.
        function updateAutoHint() {
            autoHint.style.display = autoInput.checked ? 'none' : '';
        }

        // Last-resort output a normal person can actually use. Every path that
        // previously ended at console.log now ends here — DevTools is not an
        // acceptable place to leave someone's only copy of their data.
        function showTextFallback(label, text) {
            textOutLabel.textContent = label;
            textOutArea.value = text;
            textOut.style.display = '';
            textOutArea.focus();
            textOutArea.select();
        }

        textOutClose.addEventListener('click', () => {
            textOut.style.display = 'none';
            textOutArea.value = '';
        });

        async function writeClipboard(text) {
            if (typeof GM_setClipboard !== 'undefined') {
                GM_setClipboard(text, 'text');
                return;
            }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return;
            }
            // Older fallback: the clipboard API needs a secure context and
            // isn't guaranteed inside every injected context.
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed; opacity:0; pointer-events:none;';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }

        async function copyThemeUrls() {
            const s2 = pageSnapshot;
            const lines = [];
            if (s2.mp4 || s2.webm) {
                if (s2.mp4) lines.push(s2.mp4);
                if (s2.webm) lines.push(s2.webm);
                if (s2.poster) lines.push(s2.poster);
            } else if (s2.image) {
                lines.push(s2.image);
            }

            if (!lines.length) {
                setStatus('This page has no theme background of its own to copy.', true);
                return;
            }

            const text = lines.join('\n');
            try {
                await writeClipboard(text);
                setStatus(lines.length === 1
                    ? 'Copied this page\u2019s own theme background URL.'
                    : 'Copied ' + lines.length + ' URLs from this page\u2019s own theme.', false);
            } catch (e) {
                console.warn('[bg-swapper] clipboard write failed', e);
                setStatus('Clipboard blocked — the URL(s) are below.', true);
                showTextFallback('This page\u2019s own theme background URL(s):', text);
            }
        }

        copyBtn.addEventListener('click', copyThemeUrls);

        // An undo affordance beats a confirmation dialog: no friction on the
        // common case, full recovery on the bad one. It lives in its own bar
        // under the preset list — next to where the deletion happened, and out
        // of reach of unrelated status messages that would otherwise wipe it.
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

        undoBtn.addEventListener('click', async () => {
            const restore = pendingUndo;
            hideUndo();
            if (restore) await restore();
        });
        undoDismiss.addEventListener('click', () => {
            const dismissed = pendingDismiss;
            hideUndo();
            if (dismissed) dismissed();
        });

        function updateKeysHint() {
            keysHint.style.display = keysInput.checked ? 'none' : '';
        }

        keysInput.addEventListener('change', async () => {
            numberKeys = keysInput.checked;
            updateKeysHint();
            await store.set(KEYS_KEY, numberKeys ? '1' : '0');
            renderPresets();   // show or hide the row numbers
            setStatus(numberKeys ? 'Number keys apply presets 1-9.' : 'Number-key shortcuts off.', false);
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

        function updateConfirmHint() {
            confirmHint.style.display = confirmInput.checked ? '' : 'none';
        }

        confirmInput.addEventListener('change', async () => {
            confirmDelete = confirmInput.checked;
            updateConfirmHint();
            await store.set(CONFIRM_KEY, confirmDelete ? '1' : '0');
            setStatus(confirmDelete ? 'Will ask before deleting a preset.' : 'Deleting presets no longer asks.', false);
        });

        // ---------------- erase everything ----------------
        //
        // Deliberately awkward: separated from everything else, armed by a
        // first click that disarms itself, and stating exactly what it will
        // take. The backup goes to storage rather than memory so undo still
        // works after a reload — the moment you'd most want it.

        let nukeArmed = false;
        let nukeTimer = null;

        function blastRadius() {
            const bits = [presets.length + ' preset' + (presets.length === 1 ? '' : 's')];
            if (activeBg) bits.push('applied background');
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
            } catch (e) {
                backup = null;
            }
            if (!backup) {
                setStatus('The backup is no longer available.', true);
                return;
            }

            presets = Array.isArray(backup.presets) ? backup.presets : [];
            await savePresets();

            const settings = backup.settings || {};
            autoReapply = settings.auto !== false;
            confirmDelete = settings.confirm === true;
            numberKeys = settings.keys !== false;
            autoInput.checked = autoReapply;
            confirmInput.checked = confirmDelete;
            keysInput.checked = numberKeys;
            updateAutoHint();
            updateConfirmHint();
            updateKeysHint();
            await store.set(AUTO_KEY, autoReapply ? '1' : '0');
            await store.set(CONFIRM_KEY, confirmDelete ? '1' : '0');
            await store.set(KEYS_KEY, numberKeys ? '1' : '0');

            uiState = Object.assign({ left: null, top: null, collapsed: false }, backup.ui || {});
            applyPosition();
            applyCollapsed();
            await saveUiState();

            const fields = backup.fields || {};
            imageUrlInput.value = fields.image || '';
            videoMp4Input.value = fields.mp4 || '';
            videoWebmInput.value = fields.webm || '';
            videoPosterInput.value = fields.poster || '';

            renderPresets();

            if (backup.applied) {
                await store.set(STORAGE_KEY, JSON.stringify(backup.applied));
                if (backup.applied.mode === 'image') applyImageBackground(backup.applied.url);
                else applyVideoBackground(backup.applied.mp4, backup.applied.webm, backup.applied.poster);
            }

            await store.set(BACKUP_KEY, '');
            setStatus('Everything restored.', false);
        }

        async function eraseEverything() {
            const backup = {
                ts: Date.now(),
                presets,
                settings: { auto: autoReapply, confirm: confirmDelete, keys: numberKeys },
                ui: uiState,
                applied: activeBg,
                fields: {
                    image: imageUrlInput.value,
                    mp4: videoMp4Input.value,
                    webm: videoWebmInput.value,
                    poster: videoPosterInput.value,
                },
            };
            const erased = blastRadius();
            await store.set(BACKUP_KEY, JSON.stringify(backup));

            presets = [];
            await savePresets();

            clearBackground();
            imageUrlInput.value = '';
            videoMp4Input.value = '';
            videoWebmInput.value = '';
            videoPosterInput.value = '';
            await store.set(STORAGE_KEY, '');

            autoReapply = true;
            confirmDelete = false;
            numberKeys = true;
            autoInput.checked = true;
            confirmInput.checked = false;
            keysInput.checked = true;
            updateAutoHint();
            updateConfirmHint();
            updateKeysHint();
            await store.set(AUTO_KEY, '1');
            await store.set(CONFIRM_KEY, '0');
            await store.set(KEYS_KEY, '1');

            uiState = { left: null, top: null, collapsed: false };
            panel.style.left = 'auto';
            panel.style.right = '10px';
            panel.style.top = '10px';
            applyCollapsed();
            await saveUiState();

            renderPresets();
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

        // Presets outlive the script that made them: renaming @name before
        // release, and moving from Tampermonkey to the extension, both land in
        // a fresh storage bucket with no migration path. A file is the bridge.

        function newPresetId() {
            return Date.now() + Math.floor(Math.random() * 1000);
        }

        function sanitizeUrl(value) {
            if (typeof value !== 'string') return '';
            const trimmed = normalizeUrl(value);
            // Only real web URLs — an imported file is untrusted input, and
            // there's no legitimate reason for any other scheme here.
            return /^https?:\/\//i.test(trimmed) ? trimmed : '';
        }

        function sanitizePreset(raw) {
            if (!raw || typeof raw !== 'object') return null;
            const name = (typeof raw.name === 'string' && raw.name.trim())
                ? raw.name.trim().slice(0, 60) : '';

            if (raw.mode === 'image') {
                const url = sanitizeUrl(raw.url);
                if (!url) return null;
                const p = { mode: 'image', url };
                p.name = name || deriveName(p);
                p.id = newPresetId();
                return p;
            }
            if (raw.mode === 'video') {
                const mp4 = sanitizeUrl(raw.mp4);
                const webm = sanitizeUrl(raw.webm);
                if (!mp4 && !webm) return null;
                const p = { mode: 'video', mp4, webm, poster: sanitizeUrl(raw.poster) };
                p.name = name || deriveName(p);
                p.id = newPresetId();
                return p;
            }
            return null;
        }

        exportBtn.addEventListener('click', async () => {
            if (!presets.length) {
                setStatus('There are no presets to export.', true);
                return;
            }
            const payload = JSON.stringify({
                app: 'steam-bg-swapper',
                formatVersion: 1,
                exported: new Date().toISOString(),
                presets,
            }, null, 2);

            let url = '';
            try {
                const blob = new Blob([payload], { type: 'application/json' });
                url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'steam-bg-presets-' + new Date().toISOString().slice(0, 10) + '.json';
                document.body.appendChild(a);
                a.click();
                a.remove();
                setStatus('Exported ' + presets.length + ' presets.', false);
                setTimeout(() => URL.revokeObjectURL(url), 10000);
            } catch (e) {
                console.warn('[bg-swapper] export download failed', e);
                if (url) URL.revokeObjectURL(url);
                try {
                    await writeClipboard(payload);
                    setStatus('Download blocked — presets copied to the clipboard instead.', true);
                } catch (e2) {
                    setStatus('Couldn\u2019t download or copy — select the text below and save it as a .json file.', true);
                    showTextFallback('Your presets — copy this and save it as a .json file:', payload);
                }
            }
        });

        importBtn.addEventListener('click', () => importFile.click());

        importFile.addEventListener('change', async () => {
            const file = importFile.files && importFile.files[0];
            if (!file) return;
            try {
                const data = JSON.parse(await file.text());
                const list = Array.isArray(data)
                    ? data
                    : (data && Array.isArray(data.presets) ? data.presets : null);
                if (!list) {
                    setStatus('That file doesn\u2019t look like a preset export.', true);
                    return;
                }

                // Merge rather than replace: importing should never be able to
                // destroy presets you already have. Deep copy for the undo,
                // since merging and renaming mutate the objects in place.
                const backup = presets.map(item => Object.assign({}, item));
                let added = 0, duplicate = 0, invalid = 0, filled = 0;
                const nameConflicts = [];

                for (const raw of list) {
                    const p = sanitizePreset(raw);
                    if (!p) { invalid++; continue; }
                    const dupe = presets.find(existing => samePreset(existing, p));
                    if (dupe) {
                        duplicate++;
                        if (mergeInto(dupe, p)) filled++;
                        const importedName = typeof raw.name === 'string' ? raw.name.trim() : '';
                        if (importedName && importedName !== dupe.name) {
                            nameConflicts.push({ preset: dupe, name: importedName.slice(0, 60) });
                        }
                        continue;
                    }
                    presets.push(p);
                    added++;
                }

                // Only ask when it's genuinely ambiguous — same background,
                // two different names, no way to know which you meant.
                let renamed = 0;
                if (nameConflicts.length) {
                    const useImported = window.confirm(
                        nameConflicts.length + ' imported preset' +
                        (nameConflicts.length === 1 ? '' : 's') +
                        ' match what you already have but use different names.\n\n' +
                        'OK — use the imported names\n' +
                        'Cancel — keep your current names'
                    );
                    if (useImported) {
                        for (const conflict of nameConflicts) conflict.preset.name = conflict.name;
                        renamed = nameConflicts.length;
                    }
                }

                if (!added && !filled && !renamed) {
                    setStatus('Nothing to import — ' + duplicate + ' already saved, ' + invalid + ' unusable.', true);
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
                offerUndo(
                    'Imported: ' + parts.join(', ') +
                        (extras.length ? ' (' + extras.join(', ') + ').' : '.'),
                    async () => {
                        presets = backup;
                        await savePresets();
                        renderPresets();
                        setStatus('Import undone.', false);
                    }
                );
            } catch (e) {
                console.warn('[bg-swapper] import failed', e);
                setStatus('Could not read that file — is it a valid .json export?', true);
            } finally {
                // Reset so re-selecting the same file fires change again.
                importFile.value = '';
            }
        });

        deleteAllBtn.addEventListener('click', async () => {
            if (!presets.length) {
                setStatus('There are no presets to delete.', true);
                return;
            }
            // Always confirms, regardless of the per-preset setting: this one
            // is unrecoverable and the checkbox above is about single deletes.
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

        diagBtn.addEventListener('click', async () => {
            const el = findHeaderEl();
            const report = {
                url: location.href,
                viewport: { w: window.innerWidth, h: window.innerHeight },
                detectionStrategy: lastStrategy,
                themeSnapshot: pageSnapshot,
                applied: activeBg,
            };
            if (el) {
                const cs = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                report.appliedTargetNow = {
                    className: el.className,
                    backgroundSize: cs.backgroundSize,
                    backgroundPosition: cs.backgroundPosition,
                    backgroundAttachment: cs.backgroundAttachment,
                    backgroundRepeat: cs.backgroundRepeat,
                    rect: { width: Math.round(rect.width), height: Math.round(rect.height),
                            top: Math.round(rect.top), left: Math.round(rect.left) },
                };
            }
            const ourWrapper = document.getElementById(VIDEO_WRAPPER_ID);
            if (ourWrapper) {
                const ws = window.getComputedStyle(ourWrapper);
                const wr = ourWrapper.getBoundingClientRect();
                const v = ourWrapper.querySelector('video');
                report.ourVideoBox = {
                    position: ws.position, top: ws.top, left: ws.left,
                    width: ws.width, height: ws.height, zIndex: ws.zIndex,
                    rect: { width: Math.round(wr.width), height: Math.round(wr.height),
                            top: Math.round(wr.top), left: Math.round(wr.left) },
                    intrinsic: v ? (v.videoWidth + 'x' + v.videoHeight) : null,
                    objectFit: v ? window.getComputedStyle(v).objectFit : null,
                    objectPosition: v ? window.getComputedStyle(v).objectPosition : null,
                };
            }
            const text = JSON.stringify(report, null, 2);
            console.log('[bg-swapper] diagnostics\n' + text);
            try {
                await writeClipboard(text);
                setStatus('Sizing diagnostics copied (also logged to console).', false);
            } catch (e) {
                setStatus('Clipboard blocked — the diagnostics are below.', true);
                showTextFallback('Sizing diagnostics:', text);
            }
        });

        autoInput.addEventListener('change', async () => {
            autoReapply = autoInput.checked;
            updateAutoHint();
            failedReapplies = 0;
            await store.set(AUTO_KEY, autoReapply ? '1' : '0');
            if (autoReapply && activeBg && !isStillApplied()) reapplyActive('auto re-enabled');
            setStatus(autoReapply ? 'Auto-reapply on.' : 'Auto-reapply off.', false);
        });

        // ---------------- presets ----------------

        let presets = [];

        function currentFields() {
            if (getMode() === 'image') {
                return { mode: 'image', url: imageUrlInput.value.trim() };
            }
            return {
                mode: 'video',
                mp4: videoMp4Input.value.trim(),
                webm: videoWebmInput.value.trim(),
                poster: videoPosterInput.value.trim(),
            };
        }

        function fillFields(p) {
            if (p.mode === 'image') {
                imageUrlInput.value = p.url || '';
                setMode('image');
            } else {
                videoMp4Input.value = p.mp4 || '';
                videoWebmInput.value = p.webm || '';
                videoPosterInput.value = p.poster || '';
                setMode('video');
            }
        }

        async function applyPreset(p) {
            fillFields(p);
            if (p.mode === 'image') {
                await store.set(STORAGE_KEY, JSON.stringify({ mode: 'image', url: p.url }));
                applyImageBackground(p.url);
            } else {
                await store.set(STORAGE_KEY, JSON.stringify({
                    mode: 'video', mp4: p.mp4, webm: p.webm, poster: p.poster,
                }));
                applyVideoBackground(p.mp4, p.webm, p.poster);
            }
        }

        function deriveName(p) {
            const src = p.mode === 'image' ? p.url : (p.webm || p.mp4);
            const file = (src || '').split('/').pop().split('?')[0];
            return file ? file.slice(0, 20) : (p.mode === 'image' ? 'Image' : 'Video');
        }

        async function savePresets() {
            await store.set(PRESETS_KEY, JSON.stringify(presets));
        }

        // Only fetch a thumbnail once its row is actually scrolled into view.
        // The list shows ~4 rows at a time, so without this a long preset
        // list fires a request per row on every profile page you open.
        const thumbObserver = new IntersectionObserver((entries, obs) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const node = entry.target;
                if (node.dataset.src) {
                    node.src = node.dataset.src;
                    delete node.dataset.src;
                }
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
            thumb.style.cssText = 'position:relative; width:40px; height:24px; flex:none;' +
                'border-radius:2px; background:#0e1620; overflow:hidden; display:flex;' +
                'align-items:center; justify-content:center;';

            const stillUrl = p.mode === 'image' ? p.url : p.poster;
            const clipUrl = p.mode === 'video' ? (p.mp4 || p.webm) : '';
            // Recorded even when a poster exists, so hover can animate anything.
            if (clipUrl) thumb.dataset.clip = clipUrl;

            if (stillUrl) {
                const img = document.createElement('img');
                img.dataset.src = stillUrl;
                img.style.cssText = 'width:100%; height:100%; object-fit:cover; display:block;';
                img.addEventListener('error', () => {
                    thumb.innerHTML = '';
                    thumb.appendChild(placeholder(p.mode === 'video' ? 'VID' : 'IMG'));
                });
                thumb.appendChild(img);
                thumbObserver.observe(img);
            } else if (clipUrl) {
                // No poster: seek to 0.1s and let the browser paint that frame.
                // No canvas capture — Steam's CDN would taint the canvas.
                const vid = document.createElement('video');
                vid.dataset.src = clipUrl + '#t=0.1';
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
                thumb.appendChild(vid);
                thumbObserver.observe(vid);
            } else {
                thumb.appendChild(placeholder(p.mode === 'video' ? 'VID' : 'IMG'));
            }

            return thumb;
        }

        // The poster (or first frame) is the cheap resting state. The playing
        // video is built on first hover only, so presets you never hover cost
        // nothing, and every video preset can animate — poster or not.
        function startThumbPreview(thumb) {
            const clip = thumb.dataset.clip;
            if (!clip) return;
            let v = thumb.querySelector('video');
            if (!v) {
                v = document.createElement('video');
                v.muted = true;
                v.defaultMuted = true;
                v.loop = true;
                v.playsInline = true;
                v.setAttribute('muted', '');
                v.setAttribute('playsinline', '');
                v.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%;' +
                    'object-fit:cover; display:block;';
                v.src = clip + '#t=0.1';
                thumb.appendChild(v);
            }
            if (v.dataset.src) {           // lazy loader hadn't fired yet
                v.src = v.dataset.src;
                delete v.dataset.src;
            }
            v.style.display = 'block';
            const pr = v.play();
            if (pr && pr.catch) pr.catch(() => {});
        }

        function stopThumbPreview(thumb) {
            const v = thumb.querySelector('video');
            if (!v) return;
            v.pause();
            try { v.currentTime = 0.1; } catch (e) {}
            // Only hide it if there's a poster underneath to fall back to.
            if (thumb.querySelector('img')) v.style.display = 'none';
        }

        function samePreset(a, b) {
            if (a.mode !== b.mode) return false;
            if (a.mode === 'image') return (a.url || '') === (b.url || '');
            // The same clip however it was saved: mp4 only, webm only, or both.
            // Requiring both fields to match let one background be saved three
            // times over as three "different" presets.
            if (a.mp4 && a.mp4 === b.mp4) return true;
            if (a.webm && a.webm === b.webm) return true;
            // mp4-only and webm-only versions of one background share no URL at
            // all — their hashes are unrelated. The poster is the link: it's the
            // item's own hash-named still, identical across both variants.
            //
            // Not the items/<id>/ path segment, tempting as it looks: that id is
            // the appid, and one game can ship several different backgrounds.
            if (a.poster && a.poster === b.poster) return true;
            return false;
        }

        // A match carrying a URL the saved one lacks is an upgrade, not a
        // rejection — fold the missing fields in.
        function mergeInto(existing, incoming) {
            if (existing.mode !== 'video') return false;
            let changed = false;
            for (const key of ['mp4', 'webm', 'poster']) {
                if (!existing[key] && incoming[key]) {
                    existing[key] = incoming[key];
                    changed = true;
                }
            }
            return changed;
        }

        let dragIndex = null;

        function clearDropMarkers() {
            for (const child of presetList.children) child.style.boxShadow = '';
        }

        function renderPresets() {
            thumbObserver.disconnect();
            presetList.innerHTML = '';
            if (!presets.length) {
                const empty = document.createElement('div');
                empty.style.cssText = 'padding:6px; font-size:11px; color:#7a8b99;';
                empty.textContent = 'No presets yet — Grab or paste a URL, then Save.';
                presetList.appendChild(empty);
                return;
            }
            presets.forEach((p, index) => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex; align-items:center; gap:6px; padding:4px;' +
                    'cursor:pointer; border-bottom:1px solid #2a475e;';
                // Three interactions overlap on this one row, so describe them
                // in one place rather than a different hint per sub-element.
                const applyHint = (numberKeys && index < 9)
                    ? 'Click to apply or press ' + (index + 1)
                    : 'Click to apply';
                row.title = p.name + '\n' + applyHint + ' \u00b7 double-click the name to rename';

                const thumb = buildThumb(p);

                const label = document.createElement('div');
                label.style.cssText = 'flex:1; min-width:0; font-size:11px; overflow:hidden;' +
                    'text-overflow:ellipsis; white-space:nowrap;';
                label.textContent = p.name;
                // No title of its own: inherit the row's, so hovering the name
                // says the same thing as hovering the thumbnail.
                label.removeAttribute('title');

                function beginRename() {
                    if (label.querySelector('input')) return;
                    // Dragging a row mid-edit would tear the input out of the DOM.
                    row.draggable = false;

                    const input = document.createElement('input');
                    input.type = 'text';
                    input.value = p.name;
                    input.style.cssText = 'width:100%; box-sizing:border-box; padding:1px 2px;' +
                        'font-size:11px; background:#0e1620; color:#c7d5e0;' +
                        'border:1px solid #66c0f4; border-radius:2px;';
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

                    // Keep clicks and keys inside the editor: the row applies the
                    // preset on click, and P triggers peek.
                    ['click', 'dblclick', 'mousedown'].forEach(evt =>
                        input.addEventListener(evt, e => e.stopPropagation()));
                    input.addEventListener('keydown', (e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
                        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
                    });
                    input.addEventListener('blur', () => finish(true));
                }

                // A double-click fires two clicks first, which would apply the
                // preset twice before the rename begins. Hold the name's click
                // just long enough to see whether a second one follows — only on
                // the name itself, so the rest of the row still applies instantly.
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

                const del = document.createElement('span');
                del.textContent = '\u00d7';
                del.title = 'Delete preset';
                del.style.cssText = 'flex:none; padding:0 4px; color:#7a8b99; font-size:15px; line-height:1;';

                // Numbers follow list position, so reordering re-binds the keys.
                if (numberKeys && index < 9) {
                    const badge = document.createElement('span');
                    badge.textContent = String(index + 1);
                    badge.style.cssText = 'flex:none; width:9px; text-align:center;' +
                        'font-size:10px; color:#7a8b99;';
                    row.appendChild(badge);
                }

                row.appendChild(thumb);
                row.appendChild(label);
                row.appendChild(del);

                row.addEventListener('mouseenter', () => {
                    row.style.background = '#2a475e';
                    startThumbPreview(thumb);
                });
                row.addEventListener('mouseleave', () => {
                    row.style.background = '';
                    stopThumbPreview(thumb);
                });
                // Native drag-and-drop: the browser only starts a drag after
                // real movement, and suppresses the click when it does — so a
                // slightly wobbly click still applies the preset.
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
                    row.style.boxShadow = below
                        ? 'inset 0 -2px 0 #66c0f4'
                        : 'inset 0 2px 0 #66c0f4';
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
                        presets.splice(Math.min(index, presets.length), 0, removed);
                        await savePresets();
                        renderPresets();
                        setStatus('Restored "' + removed.name + '".', false);
                    });
                });

                presetList.appendChild(row);
            });
        }

        presetSaveBtn.addEventListener('click', async () => {
            // Prefer whatever is typed in the fields. If they're empty but a
            // background is applied, save that instead — so clearing the inputs
            // after applying doesn't lose what you're currently looking at.
            let p = currentFields();
            let source = 'fields';
            const hasFieldData = p.mode === 'image' ? !!p.url : !!(p.mp4 || p.webm);
            if (!hasFieldData && activeBg) {
                p = Object.assign({}, activeBg);
                source = 'applied';
            }

            const hasData = p.mode === 'image' ? !!p.url : !!(p.mp4 || p.webm);
            if (!hasData) {
                setStatus('Nothing to save — press Grab, paste a URL, or apply a background first.', true);
                return;
            }

            const dupe = presets.find(existing => samePreset(existing, p));
            if (dupe) {
                if (mergeInto(dupe, p)) {
                    await savePresets();
                    renderPresets();
                    setStatus('Already saved as "' + dupe.name + '" — added the missing URL(s).', false);
                } else {
                    setStatus('Already saved as "' + dupe.name + '".', true);
                }
                return;
            }

            p.name = presetNameInput.value.trim() || deriveName(p);
            p.id = Date.now();
            presets.push(p);
            await savePresets();
            presetNameInput.value = '';
            renderPresets();
            setStatus('Saved preset "' + p.name + '" (from ' + source + ').', false);
        });

        try {
            const presetsRaw = await store.get(PRESETS_KEY, '');
            if (presetsRaw) presets = JSON.parse(presetsRaw) || [];
        } catch (e) {
            console.warn('[bg-swapper] could not parse saved presets', e);
            presets = [];
        }
        renderPresets();

        // ---------------- restore last used ----------------

        const savedRaw = await store.get(STORAGE_KEY, '');
        if (savedRaw) {
            try {
                const saved = JSON.parse(savedRaw);
                if (saved.mode === 'image' && saved.url) {
                    imageUrlInput.value = saved.url;
                    applyImageBackground(saved.url);
                } else if (saved.mode === 'video' && (saved.mp4 || saved.webm)) {
                    videoMp4Input.value = saved.mp4 || '';
                    videoWebmInput.value = saved.webm || '';
                    videoPosterInput.value = saved.poster || '';
                    setMode('video');
                    applyVideoBackground(saved.mp4, saved.webm, saved.poster);
                }
            } catch (e) {
                console.warn('[bg-swapper] could not parse saved settings', e);
            }
        }

        autoReapply = (await store.get(AUTO_KEY, '1')) !== '0';
        autoInput.checked = autoReapply;
        updateAutoHint();

        numberKeys = (await store.get(KEYS_KEY, '1')) !== '0';
        keysInput.checked = numberKeys;
        updateKeysHint();

        confirmDelete = (await store.get(CONFIRM_KEY, '0')) === '1';
        confirmInput.checked = confirmDelete;
        updateConfirmHint();

        try {
            const uiRaw = await store.get(UI_KEY, '');
            if (uiRaw) uiState = Object.assign(uiState, JSON.parse(uiRaw) || {});
        } catch (e) {
            console.warn('[bg-swapper] could not parse saved panel state', e);
        }
        applyPosition();
        applyCollapsed();
        window.addEventListener('resize', applyPosition);

        // ---------------- cross-tab sync ----------------

        function matchesActive(saved) {
            if (!activeBg || !saved || saved.mode !== activeBg.mode) return false;
            if (saved.mode === 'image') return (saved.url || '') === (activeBg.url || '');
            return (saved.mp4 || '') === (activeBg.mp4 || '') &&
                   (saved.webm || '') === (activeBg.webm || '') &&
                   (saved.poster || '') === (activeBg.poster || '');
        }

        store.subscribe(STORAGE_KEY, (raw) => {
            if (peekState) peekEnd();

            if (!raw) {
                if (activeBg) {
                    clearBackground();
                    imageUrlInput.value = '';
                    videoMp4Input.value = '';
                    videoWebmInput.value = '';
                    videoPosterInput.value = '';
                    setStatus('Cleared from another tab.', false);
                }
                return;
            }

            let saved;
            try { saved = JSON.parse(raw); } catch (e) { return; }
            if (matchesActive(saved)) return;   // already showing it

            failedReapplies = 0;
            if (saved.mode === 'image' && saved.url) {
                fillFields(saved);
                applyImageBackground(saved.url);
            } else if (saved.mode === 'video' && (saved.mp4 || saved.webm)) {
                fillFields(saved);
                applyVideoBackground(saved.mp4, saved.webm, saved.poster);
            }
            setStatus('Updated from another tab.', false);
        });

        store.subscribe(PRESETS_KEY, (raw) => {
            try {
                presets = raw ? (JSON.parse(raw) || []) : [];
                renderPresets();
            } catch (e) {
                console.warn('[bg-swapper] could not parse presets from another tab', e);
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

        // A backup from the last few minutes means an erase probably just
        // happened and the page has since reloaded — keep undo reachable.
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
            console.warn('[bg-swapper] could not read erase backup', e);
        }

        watchForClobber();
        watchForNavigation();
    }

    function init() {
        createPanel().catch(e => console.error('[bg-swapper] panel failed', e));
    }

    if (document.querySelector('.no_header') || document.querySelector('.profile_header_bg')) {
        init();
    } else {
        const observer = new MutationObserver((mutations, obs) => {
            if (document.querySelector('.no_header') || document.querySelector('.profile_header_bg')) {
                init();
                obs.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
})();