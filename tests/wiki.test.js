import assert from 'node:assert/strict';
import test from 'node:test';

import { jrSizeBytes, jrTurnKey } from '../src/core/journal.js';
import { tnEstimateTokens } from '../src/core/textnorm.js';
import {
    WIKI_MANUAL_TURN_KEY, wikiApplyPatch, wikiBuildUpdateMessages, wikiCreateStore, wikiGc, wikiIsTargetActive,
    wikiManualEdit, wikiManualRemove, wikiNormalizeStore, wikiParsePatch, wikiSelectRelevant, wikiShouldUpdate,
    wikiUnpin, wikiView,
} from '../src/core/wiki.js';

const T1 = jrTurnKey(8, 0);
const A = jrTurnKey(16, 0);
const B = jrTurnKey(16, 1);

const PATCH_1 = {
    upsert: [
        { table: 'npcs', name: 'Алиса', role: 'трактирщица', attitude: 'дружелюбна', appearance: 'рыжая, веснушки' },
        { table: 'places', name: 'Таверна «Пони»', description: 'шумная таверна у тракта', present: 'Алиса' },
        { table: 'quests', title: 'Найти амулет', status: 'active', note: 'амулет украли в порту' },
        { table: 'timeline', date: '1 сентября', event: 'Герой прибыл в город' },
    ],
    remove: [],
};

test('wikiParsePatch: fences, aliases, sanitization, caps and garbage', () => {
    const raw = '```json\n{"upsert":[{"type":"npc","name":"<b>Грей</b>","relation":"враждебен","looks":"шрам"},'
        + '{"table":"quests","name":"Спасти принца","status":"completed"},{"table":"bogus","name":"x"},{"table":"npcs","role":"no name"}],'
        + '"remove":[{"table":"places","key":"Старый мост"}],"evil":"<script>"}\n```';
    const p = wikiParsePatch(raw);
    assert.equal(p.upsert.length, 2);
    assert.deepEqual(p.upsert[0], { table: 'npcs', name: 'Грей', attitude: 'враждебен', appearance: 'шрам' });
    assert.deepEqual(p.upsert[1], { table: 'quests', title: 'Спасти принца', status: 'done' });
    assert.equal(p.remove.length, 1);
    assert.equal(p.remove[0].table, 'places');
    assert.deepEqual(wikiParsePatch('not json at all'), { upsert: [], remove: [] });
    assert.deepEqual(wikiParsePatch('{"upsert": [broken'), { upsert: [], remove: [] });
    assert.deepEqual(wikiParsePatch(null), { upsert: [], remove: [] });
    const many = { upsert: Array.from({ length: 80 }, (_, i) => ({ table: 'npcs', name: `NPC ${i}`, appearance: 'x'.repeat(500) })) };
    const capped = wikiParsePatch(many);
    assert.equal(capped.upsert.length, 40);
    assert.ok(capped.upsert[0].appearance.length <= 160);
    // Shape { npcs: [...] } without upsert/remove is accepted as upserts.
    assert.equal(wikiParsePatch({ npcs: [{ name: 'Ян' }], places: [{ name: 'Порт' }] }).upsert.length, 2);
});

test('wikiApplyPatch upsert/remove and replay by activeTurnKeys', () => {
    const store = wikiCreateStore();
    assert.deepEqual(store, { version: 1, journal: [] });
    wikiApplyPatch(store, PATCH_1, T1, wikiView(store, []));
    let view = wikiView(store, [T1]);
    assert.equal(view.npcs.length, 1);
    assert.equal(view.npcs[0].name, 'Алиса');
    assert.equal(view.npcs[0].pinned, false);
    assert.ok(view.npcs[0].id);
    assert.equal(view.places.length, 1);
    assert.equal(view.quests[0].status, 'active');
    assert.equal(view.timeline.length, 1);
    // Merge: declined form updates the same row and keeps the original spelling.
    wikiApplyPatch(store, { upsert: [{ table: 'npcs', name: 'Алисы', attitude: 'влюблена' }], remove: [{ table: 'places', key: 'Таверна «Пони»' }] }, A, view);
    view = wikiView(store, [T1, A]);
    assert.equal(view.npcs.length, 1);
    assert.equal(view.npcs[0].name, 'Алиса');
    assert.equal(view.npcs[0].attitude, 'влюблена');
    assert.equal(view.npcs[0].role, 'трактирщица');
    assert.equal(view.places.length, 0);
    // An inactive turn does not contribute.
    assert.equal(wikiView(store, []).npcs.length, 0);
});

test('wiki A → B → A: swipe deletes nothing, return restores A', () => {
    const store = wikiCreateStore();
    wikiApplyPatch(store, PATCH_1, T1, null);
    wikiApplyPatch(store, { upsert: [{ table: 'npcs', name: 'Грей', role: 'капитан' }] }, A, wikiView(store, [T1]));
    const viewA = wikiView(store, [T1, A]);
    wikiApplyPatch(store, { upsert: [{ table: 'npcs', name: 'Мира', role: 'воровка' }], remove: [{ table: 'quests', key: 'Найти амулет' }] }, B, wikiView(store, [T1]));
    const viewB = wikiView(store, [T1, B]);
    assert.deepEqual(viewB.npcs.map((r) => r.name), ['Алиса', 'Мира']);
    assert.equal(viewB.quests.length, 0);
    const len = store.journal.length;
    assert.deepEqual(wikiView(store, [T1, A]), viewA);
    assert.equal(store.journal.length, len);
});

test('pinned rows are never changed by background patches', () => {
    const store = wikiCreateStore();
    wikiApplyPatch(store, PATCH_1, T1, null);
    const row = wikiView(store, [T1]).npcs[0];
    wikiManualEdit(store, 'npcs', { ...row, attitude: 'тайно ненавидит' }, A);
    let view = wikiView(store, [T1]);
    assert.equal(view.npcs.length, 1);
    assert.equal(view.npcs[0].id, row.id);
    assert.equal(view.npcs[0].pinned, true);
    assert.equal(view.npcs[0].attitude, 'тайно ненавидит');
    assert.equal(store.journal.at(-1).turnKey, WIKI_MANUAL_TURN_KEY);

    // With the view: the items are dropped before recording.
    const before = store.journal.length;
    wikiApplyPatch(store, { upsert: [{ table: 'npcs', name: 'Алиса', attitude: 'дружелюбна' }], remove: [{ table: 'npcs', key: 'Алиса' }] }, B, view);
    assert.equal(store.journal.length, before);
    // Without the view: the reducer still protects the pinned row on replay.
    wikiApplyPatch(store, { upsert: [{ table: 'npcs', name: 'Алисе', attitude: 'равнодушна' }], remove: [{ table: 'npcs', key: 'Алиса' }] }, B, null);
    view = wikiView(store, [T1, B]);
    assert.equal(view.npcs[0].attitude, 'тайно ненавидит');
    // The manual edit survives a swipe of the turn it was made on.
    assert.equal(wikiView(store, [T1]).npcs[0].pinned, true);

    // Manual add without id, then unpin and remove.
    wikiManualEdit(store, 'places', { name: 'Порт', description: 'туманный порт' }, B);
    const port = wikiView(store, [T1]).places.find((p) => p.name === 'Порт');
    assert.ok(port.id && port.pinned);
    wikiUnpin(store, 'npcs', row.id);
    wikiApplyPatch(store, { upsert: [{ table: 'npcs', name: 'Алиса', attitude: 'простила' }] }, B, null);
    assert.equal(wikiView(store, [T1, B]).npcs[0].attitude, 'простила');
    wikiManualRemove(store, 'places', port.id, B);
    assert.equal(wikiView(store, [T1]).places.some((p) => p.name === 'Порт'), false);
});

test('table limits 60/30/40/150, pinned rows kept', () => {
    const store = wikiCreateStore();
    wikiManualEdit(store, 'npcs', { name: 'Закреплённый' }, T1);
    for (let batch = 0; batch < 4; batch += 1) {
        const upsert = [];
        for (let i = 0; i < 40; i += 1) {
            const n = batch * 40 + i;
            upsert.push({ table: 'npcs', name: `Npc${n}` }, { table: 'timeline', date: `day ${n}`, event: `event ${n}` });
        }
        upsert.length = 40;
        wikiApplyPatch(store, { upsert }, jrTurnKey(batch + 1, 0), null);
    }
    const tableFill = (table, count, prefix) => {
        for (let start = 0; start < count; start += 40) {
            const upsert = [];
            for (let i = start; i < Math.min(count, start + 40); i += 1) upsert.push({ table, name: `${prefix}${i}`, title: `${prefix}${i}`, event: `${prefix}${i}`, date: 'd' });
            wikiApplyPatch(store, { upsert }, jrTurnKey(100 + start, 0), null);
        }
    };
    tableFill('npcs', 80, 'Extra');
    tableFill('quests', 45, 'Quest');
    tableFill('places', 55, 'Place');
    tableFill('timeline', 200, 'Ev');
    const keys = store.journal.map((op) => op.turnKey);
    const view = wikiView(store, keys);
    assert.equal(view.npcs.length, 60);
    assert.ok(view.npcs.some((r) => r.name === 'Закреплённый' && r.pinned));
    assert.equal(view.quests.length, 30);
    assert.equal(view.places.length, 40);
    assert.equal(view.timeline.length, 150);
    assert.equal(view.timeline.at(-1).event, 'Ev199');
});

test('wikiSelectRelevant: declension-insensitive matching, active quests, ≤ 120 tokens', () => {
    const store = wikiCreateStore();
    wikiApplyPatch(store, PATCH_1, T1, null);
    wikiApplyPatch(store, { upsert: [
        { table: 'npcs', name: 'Грей', role: 'капитан стражи' },
        { table: 'quests', title: 'Старый долг', status: 'done' },
    ] }, A, null);
    const view = wikiView(store, [T1, A]);

    const text = wikiSelectRelevant(view, 'Я подошёл к стойке и спросил у Алисы про ночлег.', {});
    assert.match(text, /NPC Алиса/);
    assert.doesNotMatch(text, /Грей/);
    assert.match(text, /Найти амулет/, 'active quests are always included');
    assert.doesNotMatch(text, /Старый долг/, 'done quests are not included');

    const t2 = wikiSelectRelevant(view, ['Мы вернулись в таверне вечером.', { content: 'Тихо.' }], {});
    assert.match(t2, /Place Таверна «Пони»/);
    assert.doesNotMatch(t2, /NPC Алиса/);

    assert.equal(wikiSelectRelevant({ npcs: [], quests: [], places: [], timeline: [] }, 'Алиса', {}), '');

    // Budget: many matching rows are cut to ≤ 120 tokens.
    const big = wikiCreateStore();
    const upsert = [];
    for (let i = 0; i < 30; i += 1) upsert.push({ table: 'npcs', name: `Воин${i}`, role: 'наёмник с длинным описанием роли', appearance: 'высокий, мрачный, с тяжёлым мечом за спиной' });
    wikiApplyPatch(big, { upsert }, T1, null);
    const bigText = wikiSelectRelevant(wikiView(big, [T1]), upsert.map((r) => r.name).join(' '), { maxTokens: 120 });
    assert.ok(bigText.length > 0);
    assert.ok(tnEstimateTokens(bigText) <= 120, `tokens=${tnEstimateTokens(bigText)}`);
    assert.ok(tnEstimateTokens(wikiSelectRelevant(wikiView(big, [T1]), upsert.map((r) => r.name).join(' '), { maxTokens: 40 })) <= 40);
});

test('stale targetTurnKey: patch is discarded when the turn is no longer active (10.7)', () => {
    const store = wikiCreateStore();
    const targetTurnKey = A; // captured when the request was sent
    const activeAfterSwipe = [T1, B];
    assert.equal(wikiIsTargetActive(targetTurnKey, activeAfterSwipe), false);
    assert.equal(wikiIsTargetActive(targetTurnKey, [T1, A]), true);
    assert.equal(wikiIsTargetActive('', [T1]), false);
    assert.equal(wikiIsTargetActive(A, null), false);
    if (wikiIsTargetActive(targetTurnKey, activeAfterSwipe)) wikiApplyPatch(store, PATCH_1, targetTurnKey, null);
    assert.equal(store.journal.length, 0);
});

test('wikiGc: deleting a turn drops its patch, manual edits survive; compaction keeps the view', () => {
    const store = wikiCreateStore();
    wikiApplyPatch(store, PATCH_1, T1, null);
    wikiManualEdit(store, 'npcs', { name: 'Ручной' }, T1);
    wikiApplyPatch(store, { upsert: [{ table: 'npcs', name: 'Грей' }] }, A, null);
    wikiApplyPatch(store, { upsert: [{ table: 'npcs', name: 'Мира' }] }, B, null);
    wikiGc(store, { deletedTurnKeys: [A, B, WIKI_MANUAL_TURN_KEY], activeTurnKeys: [T1] });
    assert.equal(store.journal.length, 2);
    assert.deepEqual(wikiView(store, [T1, A, B]).npcs.map((r) => r.name).sort(), ['Алиса', 'Ручной']);

    // Compaction under a tiny byte budget folds old history into a base snapshot.
    const big = wikiCreateStore();
    const keys = [];
    for (let i = 0; i < 30; i += 1) {
        const key = jrTurnKey(i + 1, 0);
        keys.push(key);
        wikiApplyPatch(big, { upsert: [{ table: 'npcs', name: `Npc${i}`, appearance: 'подробное описание внешности персонажа' }, { table: 'timeline', date: `day ${i}`, event: `событие ${i}` }] }, key, null);
    }
    wikiApplyPatch(big, { upsert: [{ table: 'npcs', name: 'Dead' }] }, jrTurnKey(5, 1), null);
    const before = wikiView(big, keys);
    const size = jrSizeBytes(big.journal);
    wikiGc(big, { activeTurnKeys: keys, maxBytes: Math.floor(size / 2), keepRecentOps: 5 });
    assert.ok(big.journal.length <= 6);
    assert.equal(big.journal[0].kind, 'wiki.base');
    assert.deepEqual(wikiView(big, keys), before);
    // Recent ops remain individually revertible.
    assert.equal(wikiView(big, keys.slice(0, -1)).npcs.some((r) => r.name === 'Npc29'), false);
    assert.deepEqual(wikiView(wikiNormalizeStore(JSON.parse(JSON.stringify(big))), keys), before);
});

test('wikiShouldUpdate, wikiBuildUpdateMessages and wikiNormalizeStore', () => {
    assert.equal(wikiShouldUpdate({ counters: { turnsSinceWiki: 7 } }), false);
    assert.equal(wikiShouldUpdate({ counters: { turnsSinceWiki: 8 } }), true);
    assert.equal(wikiShouldUpdate({ counters: { turnsSinceWiki: 4 } }, 2), true, 'every is clamped to ≥ 4');
    assert.equal(wikiShouldUpdate({ counters: { turnsSinceWiki: 19 } }, 50), false, 'every is clamped to ≤ 20');
    assert.equal(wikiShouldUpdate({}), false);

    const store = wikiCreateStore();
    wikiApplyPatch(store, PATCH_1, T1, null);
    wikiManualEdit(store, 'npcs', { name: 'Грей', role: 'капитан' }, T1);
    const msgs = wikiBuildUpdateMessages(wikiView(store, [T1]), [
        { role: 'user', name: 'Герой', content: 'Привет, Алиса!' },
        { role: 'assistant', name: 'Алиса', content: 'Добро пожаловать <script>x</script>' },
        'plain string message',
    ], { locale: 'ru' });
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, 'system');
    assert.match(msgs[0].content, /JSON/);
    assert.match(msgs[0].content, /pinned/);
    assert.match(msgs[0].content, /Russian/);
    assert.match(msgs[1].content, /"pinned":true/);
    assert.match(msgs[1].content, /Привет, Алиса!/);
    assert.doesNotMatch(msgs[1].content, /<script>/);
    assert.match(wikiBuildUpdateMessages({}, [], { locale: 'en' })[0].content, /English/);

    const raw = JSON.parse(JSON.stringify(store));
    raw.journal.push({ kind: 'wiki.patch', turnKey: A, payload: '<<<garbage' }, { kind: 'evil', turnKey: A, payload: {} }, null);
    const norm = wikiNormalizeStore(raw);
    assert.equal(norm.journal.length, 2);
    assert.deepEqual(wikiView(norm, [T1]), wikiView(store, [T1]));
    assert.deepEqual(wikiNormalizeStore(undefined), wikiCreateStore());
});
