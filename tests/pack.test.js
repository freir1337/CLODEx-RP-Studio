import assert from 'node:assert/strict';
import test from 'node:test';

import { dirNormalizeCustomPresets } from '../src/core/director.js';
import {
    PACK_ERRORS,
    PACK_FORMAT,
    PACK_MAX_BYTES,
    PACK_VERSION,
    packApply,
    packBuild,
    packValidate,
} from '../src/core/pack.js';

const sampleSettings = () => ({
    apiKey: 'sk-THIS_MUST_NEVER_LEAVE_1234567890',
    trackerModel: 'gemini-flash',
    directorPresets: [
        { id: 'rain', emoji: '🌧', label: 'Дождь', directive: 'make it rain heavily' },
        { id: 'tavern_brawl', emoji: '🍺', label: 'Драка', directive: 'start a tavern brawl' },
    ],
    meterPacks: [{
        id: 'inquisition',
        name: 'Инквизиция',
        meters: [
            { id: 'suspicion', label: 'Подозрение', icon: '👁', min: 0, max: 100, value: 15, showInHud: true },
            { id: 'faith', label: 'Вера', icon: '✝️', min: 0, max: 50, value: 40, showInHud: false },
        ],
    }],
    slopPhrases: ['запах озона', 'янтарные глаза'],
    phoneSkin: 'grimoire',
    codexPresets: [{ id: 'dark_romance', name: 'Дарк-романс', prompt: 'Отвечай как хронист Инквизиции.\nКоротко.' }],
});

const wrap = contents => ({ format: PACK_FORMAT, version: PACK_VERSION, name: 'Test', author: 'nick', locale: 'ru', contents });

test('export → import on a clean profile restores presets 1:1, without secrets or state', () => {
    const settings = sampleSettings();
    const pack = packBuild(settings, { name: 'Дарк-романс: Инквизиция', author: 'nickname', locale: 'ru' });
    assert.equal(pack.format, 'clodex-pack');
    assert.equal(pack.version, 1);
    assert.equal(pack.name, 'Дарк-романс: Инквизиция');
    assert.deepEqual(Object.keys(pack), ['format', 'version', 'name', 'author', 'locale', 'contents']);
    const json = JSON.stringify(pack);
    assert.ok(!json.includes('sk-'));
    assert.ok(!json.includes('trackerModel'));

    const res = packValidate(json);
    assert.equal(res.ok, true, JSON.stringify(res.errors));
    assert.deepEqual(res.removed, []);
    const { settings: imported, summary } = packApply({}, res.pack);
    for (const key of ['directorPresets', 'meterPacks', 'slopPhrases', 'phoneSkin', 'codexPresets']) {
        assert.deepEqual(imported[key], settings[key], key);
    }
    assert.equal(imported.apiKey, undefined);
    assert.equal(summary.ok, true);
    assert.equal(summary.added.directorPresets, 2);
    assert.equal(summary.added.slopPhrases, 2);
    assert.equal(summary.phoneSkin, 'grimoire');
    // Director presets survive the director normalizer unchanged (same limits on both sides).
    assert.deepEqual(dirNormalizeCustomPresets(imported.directorPresets), settings.directorPresets);
});

test('unknown fields are stripped and reported', () => {
    const raw = {
        ...wrap({
            directorPresets: [{ id: 'a', label: 'A', directive: 'do a', onclick: 'x' }],
            state: { stats: 1 },
            slopPhrases: ['ok phrase'],
        }),
        apiKey: 'whatever',
        extra: 1,
    };
    const res = packValidate(raw);
    assert.equal(res.ok, true);
    assert.deepEqual(res.removed.sort(), ['apiKey', 'contents.directorPresets[0].onclick', 'contents.state', 'extra'].sort());
    assert.equal(res.pack.apiKey, undefined);
    assert.equal(res.pack.contents.state, undefined);
    assert.deepEqual(res.pack.contents.directorPresets[0], { id: 'a', emoji: '🎬', label: 'A', directive: 'do a' });
});

test('<script> anywhere rejects the pack with a clear error; other HTML is stripped', () => {
    const scripted = packValidate(JSON.stringify(wrap({ slopPhrases: ['<script>alert(1)</script>'] })));
    assert.equal(scripted.ok, false);
    assert.deepEqual(scripted.errors, [PACK_ERRORS.script]);
    assert.equal(scripted.pack, null);
    assert.equal(packValidate(JSON.stringify(wrap({})).replace('"Test"', '"\\u003cSCRIPT src=x>"')).ok, false);
    assert.equal(packValidate({ ...wrap({}), hidden: { deep: ['</script >'] } }).errors[0], PACK_ERRORS.script);

    const html = packValidate(wrap({
        directorPresets: [{ id: 'b', label: '<b>Bold</b> <img src=x onerror=alert(1)>', directive: 'javascript:void(0) be [bold]' }],
    }));
    assert.equal(html.ok, true);
    const p = html.pack.contents.directorPresets[0];
    assert.equal(p.label, 'Bold');
    assert.equal(p.directive, 'void(0) be (bold)');
    assert.ok(!JSON.stringify(html.pack).includes('<'));
});

test('format, version, JSON and size errors', () => {
    assert.deepEqual(packValidate('').errors, [PACK_ERRORS.empty]);
    assert.deepEqual(packValidate(null).errors, [PACK_ERRORS.empty]);
    assert.deepEqual(packValidate('{not json').errors, [PACK_ERRORS.json]);
    assert.deepEqual(packValidate('[1,2]').errors, [PACK_ERRORS.notObject]);
    assert.deepEqual(packValidate({ format: 'other', version: 1 }).errors, [PACK_ERRORS.format]);
    assert.deepEqual(packValidate({ format: PACK_FORMAT, version: 2 }).errors, [PACK_ERRORS.version]);
    assert.deepEqual(packValidate({ format: PACK_FORMAT, version: '1' }).errors, [PACK_ERRORS.version]);
    const big = JSON.stringify(wrap({ slopPhrases: ['x'.repeat(PACK_MAX_BYTES)] }));
    assert.deepEqual(packValidate(big).errors, [PACK_ERRORS.tooLarge]);
    assert.deepEqual(packValidate(JSON.parse(big)).errors, [PACK_ERRORS.tooLarge]);
    assert.equal(packValidate(new TextEncoder().encode(JSON.stringify(wrap({})))).ok, true);
    let deep = {};
    const root = deep;
    for (let i = 0; i < 60; i += 1) deep = (deep.x = {});
    assert.deepEqual(packValidate({ ...wrap({}), junk: root }).errors, [PACK_ERRORS.structure]);
});

test('string limits, item caps, keys and media are enforced', () => {
    const res = packValidate(wrap({
        directorPresets: [
            { id: 'suspense', directive: 'collides with built-in' },
            { id: 'key', directive: 'use sk-abcdefghijklmnopqrstuvwxyz123' },
            ...Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, label: 'L'.repeat(100), directive: 'D'.repeat(300) })),
        ],
        slopPhrases: [...Array.from({ length: 70 }, (_, i) => `фраза ${i}`), 'Фраза 1'],
        codexPresets: [{ id: 'img', name: 'img', prompt: 'data:image/png;base64,iVBORw0KGgo=' }],
        meterPacks: [{ id: 'm', name: 'M', meters: [{ id: 'x', label: 'X', min: 10, max: 5, value: 999 }] }],
        phoneSkin: 'hacker',
    }));
    assert.equal(res.ok, true);
    const c = res.pack.contents;
    assert.equal(c.directorPresets.length, 8);
    assert.ok(c.directorPresets.every(p => p.label.length <= 40 && p.directive.length <= 100));
    assert.ok(!c.directorPresets.some(p => p.id === 'suspense' || p.id === 'key'));
    assert.equal(c.slopPhrases.length, 60);
    assert.deepEqual(c.codexPresets, []);
    assert.deepEqual(c.meterPacks[0].meters[0], { id: 'x', label: 'X', icon: '📊', min: 10, max: 110, value: 110, showInHud: false });
    assert.equal(c.phoneSkin, undefined);
    assert.ok(res.removed.includes('contents.phoneSkin'));
    assert.ok(res.removed.includes('contents.directorPresets[0]'));
    assert.ok(res.removed.includes('contents.directorPresets[1]'));
    assert.ok(res.removed.includes('contents.codexPresets[0]'));
});

test('packApply merges by id, caps lists, never mutates the input and rejects invalid packs', () => {
    const current = {
        directorPresets: [{ id: 'rain', emoji: '☔', label: 'Old', directive: 'old rain' }],
        slopPhrases: ['Запах озона'],
        other: 'keep',
    };
    const snapshot = JSON.stringify(current);
    const pack = packBuild(sampleSettings(), { name: 'P' });
    const { settings, summary } = packApply(current, pack);
    assert.equal(JSON.stringify(current), snapshot);
    assert.equal(settings.other, 'keep');
    assert.equal(settings.directorPresets.length, 2);
    assert.equal(settings.directorPresets[0].directive, 'make it rain heavily');
    assert.equal(summary.replaced.directorPresets, 1);
    assert.equal(summary.added.directorPresets, 1);
    assert.deepEqual(settings.slopPhrases, ['Запах озона', 'янтарные глаза']);

    const full = { directorPresets: Array.from({ length: 8 }, (_, i) => ({ id: `f${i}`, label: 'f', directive: 'f' })) };
    const capped = packApply(full, pack);
    assert.equal(capped.settings.directorPresets.length, 8);
    assert.equal(capped.summary.skipped.directorPresets, 2);

    const bad = packApply(current, { format: 'nope' });
    assert.equal(bad.summary.ok, false);
    assert.deepEqual(bad.summary.errors, [PACK_ERRORS.format]);
    assert.equal(bad.settings, current);
});
