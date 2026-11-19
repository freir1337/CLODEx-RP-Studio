import assert from 'node:assert/strict';
import test from 'node:test';

import { CTX_MAX_TOKENS, ctxPack } from '../src/core/context.js';
import { tnEstimateTokens } from '../src/core/textnorm.js';

const DIRECTOR = '[Director: heighten suspense; slow the pacing. Note: пусть он заметит кровь на рукаве]';
const SCENE = [
    '[CLODEx RP Studio — Active Scene & Physiology State]',
    'Treat the facts below as subtle background continuity for this turn.',
    'Current RP Date & Time: 2026-09-01 (evening, Day 1) | Location: Часовня',
    '• Маттео: Vitals: Pulse ~110 bpm, breathing: rapid (22/min), circulation: adrenaline, stamina: 70%, stress: 60%.',
].join('\n');
const SLOP = 'Style variety: find fresh phrasing instead of repeating: «дрожь пробежала по спине», «запах озона», «ухмыльнулся», «глаза потемнели», «сердце пропустило удар», «прикусила губу».';
const wikiRows = n => ['[Session wiki — relevant]', ...Array.from({ length: n }, (_, i) => `• NPC Персонаж${i + 1}: стражник у ворот собора, относится к игроку настороженно, видел его вчера ночью`)].join('\n');

const outTokens = r => (r.depth0 ? tnEstimateTokens(r.depth0) : 0) + (r.main ? tnEstimateTokens(r.main) : 0);

test('ctxPack keeps everything when within budget and splits depth0 / main', () => {
    const r = ctxPack({ director: DIRECTOR, scene: SCENE, wiki: wikiRows(1), slop: SLOP });
    assert.equal(CTX_MAX_TOKENS, 250);
    assert.equal(r.depth0, `${DIRECTOR}\n${SLOP}`);
    assert.equal(r.main, `${SCENE}\n${wikiRows(1)}`);
    assert.equal(r.tokens.director, tnEstimateTokens(DIRECTOR));
    assert.equal(r.tokens.scene, tnEstimateTokens(SCENE));
    assert.equal(r.tokens.slop, tnEstimateTokens(SLOP));
    assert.equal(r.tokens.total, outTokens(r));
    assert.ok(r.tokens.total <= 250);
});

test('ctxPack handles empty and partial inputs', () => {
    assert.deepEqual(ctxPack({}), {
        depth0: '', main: '', tokens: { director: 0, scene: 0, wiki: 0, slop: 0, total: 0 },
    });
    const onlySlop = ctxPack({ slop: `  ${SLOP}  ` });
    assert.equal(onlySlop.depth0, SLOP);
    assert.equal(onlySlop.main, '');
    const onlyScene = ctxPack({ scene: SCENE });
    assert.equal(onlyScene.depth0, '');
    assert.equal(onlyScene.main, SCENE);
});

test('ctxPack trims anti-slop first: down to 3 phrases, then drops it', () => {
    const big = wikiRows(3);
    // budget chosen so that the full slop rule does not fit but a 3-phrase rule does
    const full = outTokens(ctxPack({ director: DIRECTOR, scene: SCENE, wiki: big, slop: SLOP, maxTokens: 10_000 }));
    const r = ctxPack({ director: DIRECTOR, scene: SCENE, wiki: big, slop: SLOP, maxTokens: full - 12 });
    assert.match(r.depth0, /«дрожь пробежала по спине», «запах озона», «ухмыльнулся»\.$/);
    assert.doesNotMatch(r.depth0, /глаза потемнели/);
    assert.equal(r.main, `${SCENE}\n${big}`, 'wiki untouched while slop can still be cut');

    const tighter = ctxPack({ director: DIRECTOR, scene: SCENE, wiki: big, slop: SLOP, maxTokens: full - 45 });
    assert.equal(tighter.depth0, DIRECTOR, 'slop dropped entirely before wiki is touched');
    assert.equal(tighter.tokens.slop, 0);
    assert.ok(tighter.tokens.total <= full - 45);
});

test('ctxPack then cuts wiki rows from the end, then scene; director survives', () => {
    const wiki = wikiRows(12);
    const r = ctxPack({ director: DIRECTOR, scene: SCENE, wiki, slop: SLOP });
    assert.ok(r.tokens.total <= 250, `total ${r.tokens.total}`);
    assert.equal(outTokens(r), r.tokens.total);
    assert.equal(r.tokens.slop, 0);
    assert.ok(r.depth0.startsWith(DIRECTOR));
    assert.ok(r.main.startsWith(SCENE), 'scene intact while wiki rows remain cuttable');
    const keptRows = r.main.split('\n').filter(l => l.startsWith('• NPC'));
    assert.ok(keptRows.length > 0 && keptRows.length < 12);
    assert.equal(keptRows[0], wiki.split('\n')[1], 'first (most relevant) rows kept');

    // Huge scene: wiki gone entirely (header never left alone), scene truncated, director intact
    const hugeScene = `${SCENE}\n${'Очень длинная строка состояния сцены с подробностями. '.repeat(60)}`;
    const r2 = ctxPack({ director: DIRECTOR, scene: hugeScene, wiki, slop: SLOP });
    assert.equal(r2.depth0, DIRECTOR);
    assert.equal(r2.tokens.wiki, 0);
    assert.ok(!r2.main.includes('[Session wiki'));
    assert.ok(r2.main.startsWith('[CLODEx RP Studio'));
    assert.ok(r2.tokens.total <= 250, `total ${r2.tokens.total}`);

    const oneLineScene = 'Сцена '.repeat(400).trim();
    const r3 = ctxPack({ director: DIRECTOR, scene: oneLineScene });
    assert.ok(r3.main.endsWith('…'));
    assert.ok(r3.tokens.total <= 250 && r3.tokens.total >= 240, `total ${r3.tokens.total}`);
});

test('ctxPack truncates the director only when it alone exceeds the budget', () => {
    const r = ctxPack({ director: 'Режиссёрская заметка '.repeat(100), scene: SCENE, wiki: wikiRows(2), slop: SLOP, maxTokens: 60 });
    assert.equal(r.main, '');
    assert.ok(r.depth0.endsWith('…'));
    assert.ok(r.tokens.total <= 60);
    assert.deepEqual(ctxPack({ director: DIRECTOR, maxTokens: 0 }).depth0, '');
});

test('ctxPack never exceeds the hard 250-token ceiling for realistic maxima', () => {
    for (const n of [0, 1, 4, 20]) {
        const r = ctxPack({
            director: '[Director: inject a sudden twist; focus on dialogue. Note: ' + 'н'.repeat(140) + ']',
            scene: SCENE + '\n' + `[Lore / Canon Guidance for This Turn]: ${'канон '.repeat(150)}`,
            wiki: wikiRows(n),
            slop: SLOP,
        });
        assert.ok(outTokens(r) <= 250, `n=${n}: ${outTokens(r)}`);
        assert.ok(r.depth0.startsWith('[Director:'));
    }
});
