import assert from 'node:assert/strict';
import test from 'node:test';

import { jrAppend, jrGc, jrReplay, jrSizeBytes, jrTurnBase, jrTurnKey } from '../src/core/journal.js';

const collect = (acc, op) => [...acc, op.payload];

test('jrTurnKey / jrTurnBase build and parse unified turn keys', () => {
    assert.equal(jrTurnKey('42'), '42:0');
    assert.equal(jrTurnKey(7, 2), '7:2');
    assert.equal(jrTurnKey(7, 2, 'a1b2'), '7:2#a1b2');
    assert.equal(jrTurnKey('msg-uuid', 'variant-3'), 'msg-uuid:variant-3');
    assert.equal(jrTurnBase('7:2#a1b2'), '7');
    assert.equal(jrTurnBase('msg-uuid:variant-3'), 'msg-uuid');
    assert.equal(jrTurnBase('legacy-msg-1'), 'legacy-msg-1');
    assert.equal(jrTurnBase(''), '');
});

test('jrAppend mutates the journal, returns the op, clones payload and assigns unique ids', () => {
    const journal = [];
    const payload = { text: 'Тайная заметка', tags: ['a'] };
    const op = jrAppend(journal, { kind: 'phone.add', turnKey: '3:0', payload });
    assert.equal(journal.length, 1);
    assert.equal(journal[0], op);
    assert.deepEqual(Object.keys(op).sort(), ['at', 'id', 'kind', 'payload', 'turnKey']);
    assert.equal(op.kind, 'phone.add');
    assert.equal(op.turnKey, '3:0');
    assert.equal(typeof op.at, 'number');
    payload.tags.push('mutated');
    assert.deepEqual(op.payload.tags, ['a'], 'payload must be cloned');

    const ids = new Set([op.id]);
    for (let i = 0; i < 200; i += 1) ids.add(jrAppend(journal, { kind: 'x', turnKey: '3:0', payload: i }).id);
    assert.equal(ids.size, 201);
    assert.throws(() => jrAppend(journal, { turnKey: '1:0' }), TypeError);
    assert.throws(() => jrAppend(null, { kind: 'x' }), TypeError);
});

test('jrReplay applies only active turn keys in insertion order', () => {
    const journal = [];
    jrAppend(journal, { kind: 'add', turnKey: '1:0', payload: 'turn1' });
    jrAppend(journal, { kind: 'add', turnKey: '2:0', payload: 'turn2-A' });
    jrAppend(journal, { kind: 'add', turnKey: '2:1', payload: 'turn2-B' });
    jrAppend(journal, { kind: 'add', turnKey: '', payload: 'global-manual' });
    jrAppend(journal, { kind: 'add', turnKey: '3:0', payload: 'turn3' });

    assert.deepEqual(jrReplay(journal, ['1:0', '2:0'], collect, []), ['turn1', 'turn2-A', 'global-manual']);
    assert.deepEqual(jrReplay(journal, new Set(['1:0', '2:1', '3:0']), collect, []), ['turn1', 'turn2-B', 'global-manual', 'turn3']);
    assert.deepEqual(jrReplay(journal, null, collect, []).length, 5, 'null = everything active');
    assert.deepEqual(jrReplay(journal, [], collect, []), ['global-manual'], 'empty-turnKey ops are global');

    // Mutating reducer returning undefined keeps the accumulator
    const counted = jrReplay(journal, ['1:0', '2:0'], (acc, op) => { acc.n += 1; acc.last = op.payload; }, { n: 0, last: '' });
    assert.deepEqual(counted, { n: 3, last: 'global-manual' });
    assert.deepEqual(jrReplay('broken', ['1:0'], collect, ['init']), ['init']);
});

test('Swipe A -> B -> A never deletes journal ops: replay restores variant A exactly', () => {
    const journal = [];
    const view = keys => jrReplay(journal, keys, collect, []);
    jrAppend(journal, { kind: 'add', turnKey: '1:0', payload: 'note-1' });
    jrAppend(journal, { kind: 'add', turnKey: '2:0', payload: 'A-dm' });
    jrAppend(journal, { kind: 'add', turnKey: '2:0', payload: 'A-feed' });
    const variantA = view(['1:0', '2:0']);

    // swipe to B: nothing removed, B adds its own ops
    jrAppend(journal, { kind: 'add', turnKey: '2:1', payload: 'B-note' });
    assert.deepEqual(view(['1:0', '2:1']), ['note-1', 'B-note']);
    assert.equal(journal.length, 4);

    // swipe back to A
    assert.deepEqual(view(['1:0', '2:0']), variantA);
    assert.deepEqual(variantA, ['note-1', 'A-dm', 'A-feed']);
});

test('jrGc: deleting the last 3 messages returns the journal to the state before them', () => {
    const journal = [];
    const keys = ['1:0', '2:0', '3:0', '4:0', '5:0', '6:0'];
    keys.forEach((k, i) => jrAppend(journal, { kind: 'add', turnKey: k, payload: `t${i + 1}` }));
    jrAppend(journal, { kind: 'add', turnKey: '', payload: 'manual' });
    const before = jrReplay(journal, keys.slice(0, 3), collect, []);

    const same = jrGc(journal, { deletedTurnKeys: keys.slice(3), activeTurnKeys: keys.slice(0, 3) });
    assert.equal(same, journal, 'jrGc cleans in place and returns the same array');
    assert.deepEqual(journal.map(op => op.payload), ['t1', 't2', 't3', 'manual']);
    assert.deepEqual(jrReplay(journal, keys.slice(0, 3), collect, []), before);
});

test('jrGc size limit evicts oldest dead-branch ops first, keeps active and global ops', () => {
    const journal = [];
    const big = 'ж'.repeat(400); // 800 bytes in UTF-8
    for (let i = 0; i < 30; i += 1) jrAppend(journal, { kind: 'add', turnKey: `dead:${i}`, payload: big });
    for (let i = 0; i < 10; i += 1) jrAppend(journal, { kind: 'add', turnKey: `live:${i}`, payload: big });
    jrAppend(journal, { kind: 'add', turnKey: '', payload: big });
    const active = Array.from({ length: 10 }, (_, i) => `live:${i}`);
    assert.ok(jrSizeBytes(journal) > 30_000);

    jrGc(journal, { activeTurnKeys: active, maxBytes: 16_000 });
    assert.ok(jrSizeBytes(journal) <= 16_000, `journal ${jrSizeBytes(journal)} > 16000`);
    assert.equal(journal.filter(op => op.turnKey.startsWith('live:')).length, 10);
    assert.equal(journal.filter(op => op.turnKey === '').length, 1);
    const deadLeft = journal.filter(op => op.turnKey.startsWith('dead:')).map(op => Number(op.turnKey.split(':')[1]));
    assert.ok(deadLeft.every(n => n >= 30 - deadLeft.length), 'oldest dead ops evicted first');

    // Only dead ops are evicted by default even if still over the limit
    jrGc(journal, { activeTurnKeys: active, maxBytes: 4_000 });
    assert.equal(journal.length, 11);
    jrGc(journal, { activeTurnKeys: active, maxBytes: 4_000, evictActive: true });
    assert.ok(jrSizeBytes(journal) <= 4_000);
});

test('jrSizeBytes counts UTF-8 bytes of the serialized journal', () => {
    assert.equal(jrSizeBytes([]), 2);
    assert.equal(jrSizeBytes(['ж']), Buffer.byteLength(JSON.stringify(['ж'])));
    const journal = [];
    jrAppend(journal, { kind: 'add', turnKey: '1:0', payload: { text: 'Привет 👋 world' } });
    assert.equal(jrSizeBytes(journal), Buffer.byteLength(JSON.stringify(journal)));
});
