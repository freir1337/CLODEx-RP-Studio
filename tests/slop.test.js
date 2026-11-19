import assert from 'node:assert/strict';
import test from 'node:test';

import {
    SLOP_BUILTIN_EN,
    SLOP_BUILTIN_RU,
    SLOP_RULE_PREFIX,
    slopAnalyze,
    slopBuildRule,
    slopRuleLimit,
} from '../src/core/slop.js';
import { tnEstimateTokens } from '../src/core/textnorm.js';

const FILLER_RU = [
    'Комната тонула в полумраке, и только камин отбрасывал рыжие отблески на стены.',
    'Где-то внизу хлопнула дверь, послышались шаги стражников.',
    'Ветер трепал занавески, принося запах мокрой листвы и дыма.',
    'На столе остывал чай в треснувшей фарфоровой чашке.',
    'Колокол на башне пробил полночь, гулко и протяжно.',
    'Лошади в конюшне беспокойно переступали копытами.',
    'Свеча догорала, оставляя на подсвечнике восковые наплывы.',
    'Снаружи моросил дождь, превращая мостовую в зеркало.',
    'Старый трактирщик протирал кружки, не поднимая головы.',
    'В очаге треснуло полено, рассыпав сноп искр.',
    'Карта королевства лежала развёрнутой, придавленная кинжалом.',
    'По крыше пробежала кошка, сбросив черепицу.',
    'Пахло воском, кожей и чуть-чуть железом.',
    'Где-то вдалеке завыла собака, и снова стало тихо.',
    'Книги на полках покрылись толстым слоем пыли.',
    'Луна выглянула из-за туч и осветила двор.',
    'Мельница на холме лениво вращала крыльями.',
    'Часовой на стене зевнул и поправил копьё.',
    'В котелке булькала похлёбка с травами.',
    'На подоконнике сидел ворон и смотрел внутрь.',
];

function buildRuCorpus() {
    const msgs = FILLER_RU.map((s, i) => `${s} {{char}} посмотрела на {{user}}. Елена улыбнулась ${i % 2 ? 'Арену' : 'Арене'}.`);
    msgs[2] += ' Дрожь по спине заставила её замереть.';
    msgs[7] += ' Она почувствовала, как дрожь по спине поднимается выше.';
    msgs[13] += ' И снова дрожь по спине, такая знакомая.';
    msgs[4] += ' Её янтарные глаза блеснули.';
    msgs[9] += ' Янтарными глазами она следила за ним.';
    msgs[15] += ' В янтарных глазах плясали искры.';
    msgs[17] += ' Янтарные глаза сузились.';
    msgs[5] += ' Старый дубовый стол скрипнул.';
    msgs[11] += ' Она оперлась на старый дубовый стол.';
    msgs[18] += ' За старый дубовый стол сели гости.';
    return msgs;
}

test('built-in dictionaries hold ~120 phrases each', () => {
    assert.ok(SLOP_BUILTIN_RU.length >= 110 && SLOP_BUILTIN_RU.length <= 140, String(SLOP_BUILTIN_RU.length));
    assert.ok(SLOP_BUILTIN_EN.length >= 110 && SLOP_BUILTIN_EN.length <= 140, String(SLOP_BUILTIN_EN.length));
    assert.ok(Object.isFrozen(SLOP_BUILTIN_RU) && Object.isFrozen(SLOP_BUILTIN_EN));
});

test('detects «дрожь по спине» repeated 3 times in 20 replies and puts it into the rule', () => {
    const hits = slopAnalyze(buildRuCorpus(), { excludeNames: ['Елена', 'Арен'], locale: 'ru' });
    const shiver = hits.find(h => h.phrase === 'дрожь по спине');
    assert.ok(shiver, JSON.stringify(hits));
    assert.equal(shiver.count, 3);
    assert.equal(shiver.messageCount, 3);
    assert.equal(shiver.builtin, true);
    const rule = slopBuildRule(hits);
    assert.ok(rule.startsWith(SLOP_RULE_PREFIX));
    assert.ok(rule.includes('«дрожь по спине»'), rule);
});

test('auto n-grams: word forms are stemmed, subsumption collapses nested n-grams', () => {
    const hits = slopAnalyze(buildRuCorpus(), { excludeNames: ['Елена', 'Арен'] });
    const amber = hits.find(h => h.phrase.startsWith('янтарн'));
    assert.ok(amber, JSON.stringify(hits));
    assert.equal(amber.count, 4);
    assert.equal(amber.builtin, false);
    const phrases = hits.map(h => h.phrase);
    assert.ok(phrases.includes('старый дубовый стол'), JSON.stringify(phrases));
    assert.ok(!phrases.includes('старый дубовый'));
    assert.ok(!phrases.includes('дубовый стол'));
});

test('names, {{char}} and {{user}} are never slop; stop words never sit on the edges', () => {
    const hits = slopAnalyze(buildRuCorpus(), { excludeNames: ['Елена', 'Арен'] });
    for (const h of hits) {
        assert.ok(!/елен|арен|char|user/.test(h.phrase), h.phrase);
        if (!h.builtin) {
            const words = h.phrase.split(' ');
            assert.ok(words.length >= 2 && words.length <= 5, h.phrase);
            assert.ok(!['на', 'по', 'и', 'она', 'её', 'ее'].includes(words[0]), h.phrase);
            assert.ok(!['на', 'по', 'и', 'она', 'её', 'ее'].includes(words.at(-1)), h.phrase);
        }
    }
    // Without the exclusion the name phrase would be detected — proves the filter does the work.
    const raw = slopAnalyze(buildRuCorpus(), { excludeNames: [] });
    assert.ok(raw.some(h => /елена улыбнулась/.test(h.phrase)), JSON.stringify(raw.map(h => h.phrase)));
});

test('threshold: ≥ 3 occurrences in ≥ 3 different replies for automatic n-grams', () => {
    const msgs = Array.from({ length: 20 }, (_, i) => `Уникальное предложение номер ${i} про разное.`);
    msgs[0] += ' Серебряная луна. Серебряная луна. Серебряная луна.';
    msgs[1] += ' Ржавый меч. ';
    msgs[2] += ' Ржавый меч.';
    msgs[3] += ' Ржавый меч.';
    const phrases = slopAnalyze(msgs).map(h => h.phrase);
    assert.ok(!phrases.includes('серебряная луна'), 'single-reply repeats are ignored');
    assert.ok(phrases.includes('ржавый меч'));
    assert.deepEqual(slopAnalyze([]), []);
    assert.deepEqual(slopAnalyze(null), []);
});

test('English corpus + extra phrases; result sorted by count and capped at 20', () => {
    const msgs = Array.from({ length: 20 }, (_, i) => `Line ${i}: rain tapped against glass number ${i}.`);
    for (const i of [1, 4, 8, 12]) msgs[i] += ' A shiver ran down her spine as Mara smirked.';
    for (const i of [2, 6]) msgs[i] += ' The neon kraken hummed.';
    const hits = slopAnalyze(msgs, { excludeNames: ['Mara'], locale: 'en', extraPhrases: ['neon kraken'] });
    const shiver = hits.find(h => h.phrase === 'a shiver ran down her spine');
    assert.ok(shiver && shiver.builtin && shiver.count === 4, JSON.stringify(hits));
    assert.ok(hits.some(h => h.phrase === 'neon kraken' && h.count === 2));
    assert.ok(!hits.some(h => /mara/.test(h.phrase)));
    for (let i = 1; i < hits.length; i += 1) assert.ok(hits[i - 1].count >= hits[i].count);

    const many = Array.from({ length: 20 }, () => Array.from({ length: 40 }, (_, k) => `alpha${k} beta${k}.`).join(' '));
    assert.equal(slopAnalyze(many).length, 20);
});

test('slopBuildRule: positive wording, ≤ 6 phrases, ≤ 60 tokens, respects disabled', () => {
    assert.equal(slopBuildRule([]), '');
    assert.equal(slopBuildRule(null), '');
    const hits = Array.from({ length: 10 }, (_, i) => ({ phrase: `phrase number ${i}`, count: 10 - i }));
    const rule = slopBuildRule(hits);
    const quoted = rule.match(/«[^»]+»/g);
    assert.equal(quoted.length, 6);
    assert.ok(tnEstimateTokens(rule) <= 60);
    assert.ok(!/avoid/i.test(rule));

    const ru = Array.from({ length: 10 }, (_, i) => ({ phrase: `очень длинная русская фраза-штамп номер ${i}`, count: 5 }));
    const ruRule = slopBuildRule(ru);
    assert.ok(ruRule.length > 0);
    assert.ok(tnEstimateTokens(ruRule) <= 60, `${tnEstimateTokens(ruRule)}`);

    const withDisabled = slopBuildRule(
        [{ phrase: 'дрожь по спине' }, { phrase: 'запах озона' }, { phrase: 'ухмыльнулся' }],
        { disabled: ['Дрожь по спине', 'ухмыльнулась'] },
    );
    assert.equal(withDisabled, `${SLOP_RULE_PREFIX}«запах озона».`);
    assert.equal(slopBuildRule(hits, { maxPhrases: 2 }).match(/«/g).length, 2);
    assert.equal(slopBuildRule(hits, { maxPhrases: 50 }).match(/«/g).length, 6);
});

test('slopRuleLimit shrinks a rule for ctxPack', () => {
    const rule = slopBuildRule(['a b', 'c d', 'e f', 'g h', 'i j']);
    assert.equal(slopRuleLimit(rule, 3), `${SLOP_RULE_PREFIX}«a b», «c d», «e f».`);
    assert.equal(slopRuleLimit(rule, 0), '');
    assert.equal(slopRuleLimit('', 3), '');
});

test('performance: < 15 ms for 20 realistic replies', () => {
    const base = buildRuCorpus();
    const msgs = base.map((m, i) => `${m} ${FILLER_RU.slice(0, 12).map((s, k) => s.replace(/\./, ` ${i * 31 + k}.`)).join(' ')}`);
    assert.ok(msgs.every(m => m.length > 700));
    slopAnalyze(msgs, { excludeNames: ['Елена'] }); // warm-up (builtin index + stem cache)
    let best = Infinity;
    for (let run = 0; run < 5; run += 1) {
        const fresh = msgs.map(m => `${m} ${run}`);
        const t0 = performance.now();
        slopAnalyze(fresh, { excludeNames: ['Елена'] });
        best = Math.min(best, performance.now() - t0);
    }
    assert.ok(best < 15, `slopAnalyze took ${best.toFixed(2)} ms`);
});
