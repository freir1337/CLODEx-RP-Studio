// M7 «.clodex-pack» for CLODEx RP Studio v1.3: shareable preset packs. Data only, never code.
// Strict whitelist validation: unknown fields are dropped, strings are length-limited and stripped of HTML,
// any <script> rejects the whole pack, API keys / chat state / media are never stored.
// Self-contained (no imports). Flat-bundler safe: every top-level name is pack*/PACK_*-prefixed.
//
// Settings keys used by packBuild / packApply:
//   settings.directorPresets  [{ id, emoji, label, directive }]           ≤ 8  (custom M1 buttons)
//   settings.meterPacks       [{ id, name, meters: [meter…≤8] }]          ≤ 6
//   settings.slopPhrases      string[]                                     ≤ 60 (extra M2 phrases)
//   settings.phoneSkin        'auto' | 'smartphone' | 'grimoire'
//   settings.codexPresets     [{ id, name, prompt }]                       ≤ 8

export const PACK_FORMAT = 'clodex-pack';
export const PACK_VERSION = 1;
export const PACK_MAX_BYTES = 65536;
export const PACK_LIMITS = Object.freeze({
    name: 80,
    author: 40,
    meterPacks: 6,
    meterPackName: 60,
    meters: 8,
    meterLabel: 60,
    meterIcon: 8,
    directorPresets: 8,
    directorLabel: 40,
    directorDirective: 100,
    directorEmoji: 8,
    slopPhrases: 60,
    slopPhrase: 80,
    codexPresets: 8,
    codexName: 60,
    codexPrompt: 1500,
    id: 40,
});
export const PACK_PHONE_SKINS = Object.freeze(['auto', 'smartphone', 'grimoire']);
export const PACK_LOCALES = Object.freeze(['ru', 'en']);
export const PACK_CONTENT_KEYS = Object.freeze(['meterPacks', 'directorPresets', 'slopPhrases', 'phoneSkin', 'codexPresets']);
// Error codes double as locale keys (pack.error.*).
export const PACK_ERRORS = Object.freeze({
    empty: 'pack.error.empty',
    json: 'pack.error.json',
    tooLarge: 'pack.error.tooLarge',
    notObject: 'pack.error.notObject',
    format: 'pack.error.format',
    version: 'pack.error.version',
    script: 'pack.error.script',
    structure: 'pack.error.structure',
});

const PACK_TOP_KEYS = Object.freeze(['format', 'version', 'name', 'author', 'locale', 'contents']);
const PACK_DIRECTOR_RESERVED_IDS = Object.freeze(['suspense', 'twist', 'dialogue', 'slow', 'npc_pov', 'sensory']);
const packScriptRe = /<\s*\/?\s*script/i;
const packSecretRe = /\bsk-[A-Za-z0-9_-]{12,}|\bbearer\s+[A-Za-z0-9._~+/=-]{16,}|\b(?:AIza|ghp_|gho_|xox[abp]-)[A-Za-z0-9_-]{16,}/i;
const packMediaRe = /data:[a-z]+\/[a-z0-9.+-]+;base64,|blob:https?:|[A-Za-z0-9+/]{400,}={0,2}/i;

function packByteLength(text) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
    return unescape(encodeURIComponent(text)).length;
}

function packIsPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function packHasScript(value, depth = 0) {
    if (depth > 32) return null; // structure too deep
    if (typeof value === 'string') return packScriptRe.test(value);
    if (Array.isArray(value)) {
        for (const item of value) {
            const res = packHasScript(item, depth + 1);
            if (res !== false) return res;
        }
        return false;
    }
    if (value && typeof value === 'object') {
        for (const key of Object.keys(value)) {
            if (packScriptRe.test(key)) return true;
            const res = packHasScript(value[key], depth + 1);
            if (res !== false) return res;
        }
    }
    return false;
}

// Single-line text: HTML tags/angle brackets/control chars removed, whitespace collapsed.
function packCleanLine(value, max, { brackets = false } = {}) {
    if (value === null || value === undefined || typeof value === 'object') return '';
    let s = String(value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
        .replace(/javascript\s*:/gi, ' ');
    if (brackets) s = s.replace(/\[/g, '(').replace(/\]/g, ')');
    return s.replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

function packCleanMultiline(value, max) {
    if (value === null || value === undefined || typeof value === 'object') return '';
    return String(value)
        .replace(/\r\n?/g, '\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(/[\u0000-\u0009\u000b-\u001f\u007f<>]/g, ' ')
        .replace(/javascript\s*:/gi, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, max)
        .trim();
}

function packCleanId(value, { lower = true } = {}) {
    const s = String(value ?? '');
    return (lower ? s.toLowerCase() : s).replace(lower ? /[^a-z0-9_-]/g : /[^a-zA-Z0-9_-]/g, '').slice(0, PACK_LIMITS.id);
}

function packIsUnsafeText(value) {
    return typeof value === 'string' && (packSecretRe.test(value) || packMediaRe.test(value));
}

function packNoteUnknown(obj, allowed, path, removed) {
    if (!packIsPlainObject(obj)) return;
    for (const key of Object.keys(obj)) {
        if (!allowed.includes(key)) removed.push(path ? `${path}.${key}` : key);
    }
}

function packInt(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(-1e6, Math.min(1e6, Math.trunc(n)));
}

function packSanitizeMeter(raw, idx, path, removed) {
    if (!packIsPlainObject(raw)) {
        removed.push(path);
        return null;
    }
    packNoteUnknown(raw, ['id', 'label', 'icon', 'min', 'max', 'value', 'showInHud'], path, removed);
    if (packIsUnsafeText(raw.label) || packIsUnsafeText(raw.icon)) {
        removed.push(path);
        return null;
    }
    const min = packInt(raw.min, 0);
    const maxRaw = packInt(raw.max, min + 100);
    const max = maxRaw > min ? maxRaw : min + 100;
    const value = Math.min(max, Math.max(min, packInt(raw.value, min)));
    return {
        id: packCleanId(raw.id, { lower: false }) || `meter_${idx + 1}`,
        label: packCleanLine(raw.label, PACK_LIMITS.meterLabel) || `Meter ${idx + 1}`,
        icon: packCleanLine(raw.icon, PACK_LIMITS.meterIcon) || '📊',
        min,
        max,
        value,
        showInHud: Boolean(raw.showInHud),
    };
}

function packSanitizeMeterPacks(list, removed) {
    const out = [];
    if (list === undefined) return out;
    if (!Array.isArray(list)) {
        removed.push('contents.meterPacks');
        return out;
    }
    list.forEach((raw, i) => {
        const path = `contents.meterPacks[${i}]`;
        if (out.length >= PACK_LIMITS.meterPacks || !packIsPlainObject(raw)) {
            removed.push(path);
            return;
        }
        packNoteUnknown(raw, ['id', 'name', 'meters'], path, removed);
        const id = packCleanId(raw.id);
        if (!id || out.some(p => p.id === id) || packIsUnsafeText(raw.name)) {
            removed.push(path);
            return;
        }
        const meters = [];
        (Array.isArray(raw.meters) ? raw.meters : []).forEach((m, k) => {
            const mPath = `${path}.meters[${k}]`;
            if (meters.length >= PACK_LIMITS.meters) {
                removed.push(mPath);
                return;
            }
            const meter = packSanitizeMeter(m, meters.length, mPath, removed);
            if (!meter) return;
            if (meters.some(x => x.id === meter.id)) {
                removed.push(mPath);
                return;
            }
            meters.push(meter);
        });
        if (!meters.length) {
            removed.push(path);
            return;
        }
        out.push({ id, name: packCleanLine(raw.name, PACK_LIMITS.meterPackName) || id, meters });
    });
    return out;
}

function packSanitizeDirectorPresets(list, removed) {
    const out = [];
    if (list === undefined) return out;
    if (!Array.isArray(list)) {
        removed.push('contents.directorPresets');
        return out;
    }
    list.forEach((raw, i) => {
        const path = `contents.directorPresets[${i}]`;
        if (out.length >= PACK_LIMITS.directorPresets || !packIsPlainObject(raw)) {
            removed.push(path);
            return;
        }
        packNoteUnknown(raw, ['id', 'emoji', 'label', 'directive'], path, removed);
        const id = packCleanId(raw.id);
        const directive = packCleanLine(raw.directive, PACK_LIMITS.directorDirective, { brackets: true });
        const unsafe = [raw.directive, raw.label, raw.emoji].some(packIsUnsafeText);
        if (!id || !directive || unsafe || PACK_DIRECTOR_RESERVED_IDS.includes(id) || out.some(p => p.id === id)) {
            removed.push(path);
            return;
        }
        out.push({
            id,
            emoji: packCleanLine(raw.emoji, PACK_LIMITS.directorEmoji, { brackets: true }) || '🎬',
            label: packCleanLine(raw.label, PACK_LIMITS.directorLabel, { brackets: true }) || directive.slice(0, PACK_LIMITS.directorLabel),
            directive,
        });
    });
    return out;
}

function packSanitizeSlopPhrases(list, removed) {
    const out = [];
    if (list === undefined) return out;
    if (!Array.isArray(list)) {
        removed.push('contents.slopPhrases');
        return out;
    }
    const seen = new Set();
    list.forEach((raw, i) => {
        const path = `contents.slopPhrases[${i}]`;
        const phrase = typeof raw === 'string' ? packCleanLine(raw.replace(/[«»"“”]/g, ' '), PACK_LIMITS.slopPhrase) : '';
        const key = phrase.toLowerCase().replace(/ё/g, 'е');
        if (!phrase || packIsUnsafeText(raw) || seen.has(key) || out.length >= PACK_LIMITS.slopPhrases) {
            removed.push(path);
            return;
        }
        seen.add(key);
        out.push(phrase);
    });
    return out;
}

function packSanitizeCodexPresets(list, removed) {
    const out = [];
    if (list === undefined) return out;
    if (!Array.isArray(list)) {
        removed.push('contents.codexPresets');
        return out;
    }
    list.forEach((raw, i) => {
        const path = `contents.codexPresets[${i}]`;
        if (out.length >= PACK_LIMITS.codexPresets || !packIsPlainObject(raw)) {
            removed.push(path);
            return;
        }
        packNoteUnknown(raw, ['id', 'name', 'prompt'], path, removed);
        const id = packCleanId(raw.id);
        const prompt = packCleanMultiline(raw.prompt, PACK_LIMITS.codexPrompt);
        if (!id || !prompt || packIsUnsafeText(raw.prompt) || packIsUnsafeText(raw.name) || out.some(p => p.id === id)) {
            removed.push(path);
            return;
        }
        out.push({ id, name: packCleanLine(raw.name, PACK_LIMITS.codexName) || id, prompt });
    });
    return out;
}

function packSanitizeContents(raw, removed) {
    const src = packIsPlainObject(raw) ? raw : {};
    if (raw !== undefined && !packIsPlainObject(raw)) removed.push('contents');
    packNoteUnknown(src, PACK_CONTENT_KEYS, 'contents', removed);
    const contents = {
        meterPacks: packSanitizeMeterPacks(src.meterPacks, removed),
        directorPresets: packSanitizeDirectorPresets(src.directorPresets, removed),
        slopPhrases: packSanitizeSlopPhrases(src.slopPhrases, removed),
        codexPresets: packSanitizeCodexPresets(src.codexPresets, removed),
    };
    if (src.phoneSkin !== undefined) {
        const skin = String(src.phoneSkin ?? '').toLowerCase();
        if (PACK_PHONE_SKINS.includes(skin)) contents.phoneSkin = skin;
        else removed.push('contents.phoneSkin');
    }
    return contents;
}

// raw: JSON text, Uint8Array/ArrayBuffer with JSON, or an already parsed object.
// → { ok, pack, errors: string[] (pack.error.* codes), removed: string[] (paths of dropped fields/items) }
export function packValidate(raw) {
    const fail = code => ({ ok: false, pack: null, errors: [code], removed: [] });
    let text = null;
    let data = raw;
    if (raw instanceof ArrayBuffer || (typeof Uint8Array === 'function' && raw instanceof Uint8Array)) {
        if (raw.byteLength > PACK_MAX_BYTES) return fail(PACK_ERRORS.tooLarge);
        if (typeof TextDecoder !== 'function') return fail(PACK_ERRORS.json);
        text = new TextDecoder('utf-8').decode(raw);
    } else if (typeof raw === 'string') {
        text = raw;
    }
    if (text !== null) {
        if (!text.trim()) return fail(PACK_ERRORS.empty);
        if (packByteLength(text) > PACK_MAX_BYTES) return fail(PACK_ERRORS.tooLarge);
        try {
            data = JSON.parse(text.replace(/^\uFEFF/, ''));
        } catch (err) {
            return fail(PACK_ERRORS.json);
        }
    } else {
        if (raw === null || raw === undefined) return fail(PACK_ERRORS.empty);
        let serialized;
        try {
            serialized = JSON.stringify(raw);
        } catch (err) {
            return fail(PACK_ERRORS.structure);
        }
        if (typeof serialized !== 'string') return fail(PACK_ERRORS.notObject);
        if (packByteLength(serialized) > PACK_MAX_BYTES) return fail(PACK_ERRORS.tooLarge);
    }

    if (!packIsPlainObject(data)) return fail(PACK_ERRORS.notObject);
    if (data.format !== PACK_FORMAT) return fail(PACK_ERRORS.format);
    if (!Number.isInteger(data.version) || data.version < 1 || data.version > PACK_VERSION) return fail(PACK_ERRORS.version);
    const scan = packHasScript(data);
    if (scan === null) return fail(PACK_ERRORS.structure);
    if (scan) return fail(PACK_ERRORS.script);

    const removed = [];
    packNoteUnknown(data, PACK_TOP_KEYS, '', removed);
    const meta = {};
    for (const [key, max] of [['name', PACK_LIMITS.name], ['author', PACK_LIMITS.author]]) {
        if (packIsUnsafeText(data[key])) {
            removed.push(key);
            meta[key] = '';
        } else {
            meta[key] = packCleanLine(data[key], max);
        }
    }
    const locale = String(data.locale ?? '').toLowerCase().slice(0, 2);
    const pack = {
        format: PACK_FORMAT,
        version: PACK_VERSION,
        name: meta.name || 'CLODEx pack',
        author: meta.author,
        locale: PACK_LOCALES.includes(locale) ? locale : 'en',
        contents: packSanitizeContents(data.contents, removed),
    };
    if (data.locale !== undefined && !PACK_LOCALES.includes(locale)) removed.push('locale');
    if (packByteLength(JSON.stringify(pack)) > PACK_MAX_BYTES) return fail(PACK_ERRORS.tooLarge);
    return { ok: true, pack, errors: [], removed };
}

// Builds a pack from settings. Only whitelisted preset data is exported (no keys, chat state or media).
export function packBuild(settings, { name = '', author = '', locale = 'en' } = {}) {
    const s = packIsPlainObject(settings) ? settings : {};
    const contents = {
        meterPacks: Array.isArray(s.meterPacks) ? s.meterPacks : [],
        directorPresets: Array.isArray(s.directorPresets) ? s.directorPresets : [],
        slopPhrases: Array.isArray(s.slopPhrases) ? s.slopPhrases : [],
        codexPresets: Array.isArray(s.codexPresets) ? s.codexPresets : [],
    };
    if (PACK_PHONE_SKINS.includes(s.phoneSkin)) contents.phoneSkin = s.phoneSkin;
    const res = packValidate({ format: PACK_FORMAT, version: PACK_VERSION, name, author, locale, contents });
    if (res.ok) return res.pack;
    // Oversized settings: fall back to an empty but valid pack rather than an invalid file.
    return packValidate({ format: PACK_FORMAT, version: PACK_VERSION, name, author, locale, contents: {} }).pack;
}

function packMergeById(current, incoming, cap) {
    const list = Array.isArray(current) ? current.map(item => ({ ...item })) : [];
    let added = 0;
    let replaced = 0;
    let skipped = 0;
    for (const item of incoming) {
        const idx = list.findIndex(x => x && x.id === item.id);
        if (idx >= 0) {
            list[idx] = item;
            replaced += 1;
        } else if (list.length < cap) {
            list.push(item);
            added += 1;
        } else {
            skipped += 1;
        }
    }
    return { list, added, replaced, skipped };
}

// Returns a NEW settings object (input is not mutated) and a summary for the import preview.
export function packApply(settings, pack) {
    const base = packIsPlainObject(settings) ? settings : {};
    const res = packValidate(pack);
    if (!res.ok) return { settings: base, summary: { ok: false, errors: res.errors, removed: [] } };
    const c = res.pack.contents;
    const next = { ...base };
    const summary = {
        ok: true,
        name: res.pack.name,
        author: res.pack.author,
        locale: res.pack.locale,
        added: {},
        replaced: {},
        skipped: {},
        phoneSkin: null,
        removed: res.removed,
    };
    const caps = { meterPacks: PACK_LIMITS.meterPacks, directorPresets: PACK_LIMITS.directorPresets, codexPresets: PACK_LIMITS.codexPresets };
    for (const key of Object.keys(caps)) {
        const merged = packMergeById(base[key], c[key], caps[key]);
        if (c[key].length || Array.isArray(base[key])) next[key] = merged.list;
        summary.added[key] = merged.added;
        summary.replaced[key] = merged.replaced;
        summary.skipped[key] = merged.skipped;
    }
    const phrases = Array.isArray(base.slopPhrases) ? base.slopPhrases.slice() : [];
    const known = new Set(phrases.map(p => String(p).toLowerCase().replace(/ё/g, 'е')));
    let added = 0;
    let skipped = 0;
    for (const phrase of c.slopPhrases) {
        const key = phrase.toLowerCase().replace(/ё/g, 'е');
        if (known.has(key)) continue;
        if (phrases.length >= PACK_LIMITS.slopPhrases) {
            skipped += 1;
            continue;
        }
        known.add(key);
        phrases.push(phrase);
        added += 1;
    }
    if (c.slopPhrases.length || Array.isArray(base.slopPhrases)) next.slopPhrases = phrases;
    summary.added.slopPhrases = added;
    summary.replaced.slopPhrases = 0;
    summary.skipped.slopPhrases = skipped;
    if (c.phoneSkin) {
        next.phoneSkin = c.phoneSkin;
        summary.phoneSkin = c.phoneSkin;
    }
    return { settings: next, summary };
}
