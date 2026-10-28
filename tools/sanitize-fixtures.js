#!/usr/bin/env node
// Sanitises Steam page dumps so they can be committed.
//
//   node tools/sanitize-fixtures.js
//
// Reads fixtures/raw/ (gitignored), writes fixtures/clean/ (committed).
// Raw dumps carry the logged-in account's webapi_token, session ID, login
// name and SteamID, plus other users' names, SteamIDs, real names and
// comments. Everything detection relies on — class names, item asset URLs,
// avatar URLs, theme variables, structure — is left alone.
//
// Identifiers are collected from every file before any is rewritten, and the
// same person gets the same placeholder in every file. That keeps owner vs
// visitor comparisons (data-miniprofile ids) meaningful across fixtures.
//
// Fails loudly: after rewriting, each file is scanned for every original
// value. A file with anything left over is not written, and the run exits 1.

'use strict';

const fs = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const RAW = path.join(FIXTURES, 'raw');
const CLEAN = path.join(FIXTURES, 'clean');

const STEAMID_BASE = 76561197960265728n;
// Data attributes hold JSON with &quot; for quotes; inline scripts use ".
const Q = '(?:"|&quot;)';

// Too generic to replace page-wide without wrecking markup. A harvested name
// on this list is reported and left for a human to deal with.
const STOP_WORDS = new Set(['steam', 'valve', 'online', 'offline', 'profile', 'user',
    'friends', 'games', 'comments', 'anonymous', 'level', 'badge', 'group', 'store']);

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wholeWord = s => new RegExp('(?<![A-Za-z0-9_])' + escapeRe(s) + '(?![A-Za-z0-9_])', 'g');

const steamIds = new Map();   // real SteamID64 -> fake
const names = new Map();      // real display/login/real name -> 'User N'
const vanities = new Map();   // real vanity (lowercase) -> 'user-N'
const sessionIds = new Set();
const warnings = [];

function fakeSteamId(real) {
    if (!steamIds.has(real)) steamIds.set(real, String(STEAMID_BASE + 1000000n + BigInt(steamIds.size + 1)));
    return steamIds.get(real);
}
const accountOf = id64 => String(BigInt(id64) - STEAMID_BASE);
const steamIdOf = account => String(BigInt(account) + STEAMID_BASE);

function addName(raw, where) {
    const name = (raw || '').trim();
    if (!name || names.has(name)) return;
    if (name.length < 3 || STOP_WORDS.has(name.toLowerCase())) {
        warnings.push(`name "${name}" (${where}) not replaced: too short or too generic — check by hand`);
        return;
    }
    names.set(name, 'User ' + (names.size + 1));
}

// ---------------- harvest ----------------

const ACCOUNT_CONTEXTS = [
    /(data-miniprofile=")(\d{5,10})(")/g,
    new RegExp('(accountid' + Q + '\\s*:\\s*)(\\d{5,10})()', 'g'),
    /(g_AccountID\s*=\s*)(\d{5,10})()/g,
    /(\/miniprofile\/)(\d{5,10})()/g,
];
// Slashes come plain, JSON-escaped (\/) or URL-encoded (%2F, in ?goto= links).
const SLASH = '(?:\\\\?\\/|%2F)';
const VANITY = new RegExp('(steamcommunity\\.com' + SLASH + 'id' + SLASH + ')([A-Za-z0-9_-]+)', 'gi');
const SESSION = /(sessionid\W{1,16}|name="sessionid" value=")([0-9a-f]{24})/gi;
const JWT = /ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

const NAME_SOURCES = [
    [/<bdi>([^<]+)<\/bdi>/g, '<bdi>'],
    [/actual_persona_name">([^<]+)</g, 'actual_persona_name'],
    [/data-miniprofile="\d+"[^>]*>([^<]+)</g, 'miniprofile link'],
    [/id="account_pulldown"[^>]*>([^<]+)</g, 'account pulldown'],
    [/friendBlockContent">\s*([^<]+?)\s*<br/g, 'friend list'],
    [new RegExp('personaname' + Q + '\\s*:\\s*' + Q + '([^"&]+)' + Q, 'g'), 'personaname'],
    [new RegExp('account_name' + Q + '\\s*:\\s*' + Q + '([^"&]+)' + Q, 'g'), 'account_name'],
];

function harvest(text) {
    for (const m of text.matchAll(/7656119\d{10}/g)) fakeSteamId(m[0]);
    for (const re of ACCOUNT_CONTEXTS) {
        for (const m of text.matchAll(re)) fakeSteamId(steamIdOf(m[2]));
    }
    for (const m of text.matchAll(VANITY)) {
        const v = m[2].toLowerCase();
        if (!vanities.has(v)) vanities.set(v, 'user-' + (vanities.size + 1));
    }
    for (const m of text.matchAll(SESSION)) sessionIds.add(m[2].toLowerCase());
    for (const [re, where] of NAME_SOURCES) {
        for (const m of text.matchAll(re)) addName(m[1], where);
    }
}

// ---------------- rewrite ----------------

function sanitize(text) {
    let out = text;

    out = out.replace(JWT, 'REDACTED.TOKEN.VALUE');
    out = out.replace(new RegExp('(webapi_token' + Q + '?\\s*[:=]\\s*' + Q + '+)[^"&]+', 'g'), '$1REDACTED');
    // Known values are replaced wherever they turn up, not just in the
    // contexts they were harvested from: Steam also passes them as bare
    // function arguments, e.g. GDynamicStore.Init(<accountid>, …).
    for (const s of sessionIds) out = out.replace(new RegExp(s, 'gi'), '0'.repeat(24));

    out = out.replace(/7656119\d{10}/g, id => fakeSteamId(id));
    for (const [real, fake] of steamIds) {
        if (real === fake) continue;
        out = out.replace(wholeWord(accountOf(real)), accountOf(fake));
    }
    out = out.replace(VANITY, (_, pre, v) => pre + (vanities.get(v.toLowerCase()) || 'user-x'));

    out = out.replace(/(<div class="commentthread_comment_text"[^>]*>)[\s\S]*?(<\/div>)/g, '$1Comment removed.$2');
    out = out.replace(/(<div class="profile_summary[^"]*"[^>]*>)[\s\S]*?(<\/div>)/g, '$1Summary removed.$2');
    out = out.replace(/("summary"\s*:\s*")(?:[^"\\]|\\.)*(")/g, '$1$2');
    out = out.replace(/(<img class="profile_flag"[^>]*>)\s*([^<]*?)(\s*<)/g, '$1 Somewhere$3');
    out = out.replace(new RegExp('(country_?code' + Q + '\\s*:\\s*' + Q + ')[A-Z]{2}', 'g'), '$1XX');

    // Longest first, so "Jo Smith" goes before a separate user called "Jo".
    const byLength = [...names.keys()].sort((a, b) => b.length - a.length);
    for (const name of byLength) out = out.replace(wholeWord(name), names.get(name));

    return out;
}

// Every original value that must not survive, with a label for the report.
function leftovers(text) {
    const found = [];
    const check = (label, re) => {
        const m = re.exec(text);
        if (m) found.push(`${label}: …${text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).replace(/\s+/g, ' ')}…`);
    };
    check('token', new RegExp(JWT.source));
    for (const id of steamIds.keys()) {
        check('SteamID64', new RegExp(id));
        check('account id', wholeWord(accountOf(id)));
    }
    for (const s of sessionIds) check('session id', new RegExp(s, 'i'));
    for (const v of vanities.keys()) {
        check('vanity URL', new RegExp(SLASH + 'id' + SLASH + escapeRe(v) + '(?![A-Za-z0-9_-])', 'i'));
        if (v.length >= 4 && !STOP_WORDS.has(v)) {
            check('vanity URL', new RegExp('(?<![A-Za-z0-9_])' + escapeRe(v) + '(?![A-Za-z0-9_])', 'i'));
        }
    }
    for (const name of names.keys()) check('name', wholeWord(name));
    return found;
}

// ---------------- main ----------------

function main() {
    if (!fs.existsSync(RAW)) {
        console.error(`No ${path.relative(process.cwd(), RAW)} directory. Put raw dumps there first.`);
        process.exit(1);
    }
    const files = fs.readdirSync(RAW).filter(f => /\.(html?|json)$/i.test(f)).sort();
    if (!files.length) {
        console.error('No .html or .json files in fixtures/raw/.');
        process.exit(1);
    }

    const texts = new Map(files.map(f => [f, fs.readFileSync(path.join(RAW, f), 'utf8')]));
    for (const text of texts.values()) harvest(text);

    fs.mkdirSync(CLEAN, { recursive: true });
    let failed = 0;
    for (const [file, text] of texts) {
        const clean = sanitize(text);
        const left = leftovers(clean);
        if (left.length) {
            failed++;
            console.error(`FAIL ${file} — not written. Still contains:`);
            for (const line of left.slice(0, 10)) console.error('    ' + line);
            continue;
        }
        fs.writeFileSync(path.join(CLEAN, file), clean, 'utf8');
        console.log(`ok   ${file}`);
    }

    console.log(`\nReplaced ${steamIds.size} SteamIDs, ${vanities.size} vanity URLs, ` +
        `${names.size} names, ${sessionIds.size} session IDs.`);
    for (const w of warnings) console.warn('WARN ' + w);
    if (failed) {
        console.error(`\n${failed} file(s) not written. Extend the rules above, then rerun.`);
        process.exit(1);
    }
}

main();
