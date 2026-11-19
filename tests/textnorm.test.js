import assert from 'node:assert/strict';
import test from 'node:test';

import { tnEstimateTokens, tnIsStopWord, tnNormalize, tnStem, tnWords } from '../src/core/textnorm.js';

test('tnNormalize lowercases, folds ё, strips punctuation and collapses spaces', () => {
    assert.equal(tnNormalize('  Ёжик, — сказала  Она!!! «Ну   и?» '), 'ежик сказала она ну и');
    assert.equal(tnNormalize("Don't  STOP… now"), 'dont stop now');
    assert.equal(tnNormalize('{{char}} улыбнулся 😏 {{user}}'), 'char улыбнулся user');
    assert.equal(tnNormalize('е\u0308лка'), 'елка');
    assert.equal(tnNormalize(null), '');
    assert.equal(tnNormalize(''), '');
});

test('tnWords splits normalized text into words', () => {
    assert.deepEqual(tnWords('Дрожь пробежала по спине.'), ['дрожь', 'пробежала', 'по', 'спине']);
    assert.deepEqual(tnWords('A shiver ran down her spine!'), ['a', 'shiver', 'ran', 'down', 'her', 'spine']);
    assert.deepEqual(tnWords('   '), []);
});

test('tnStem maps RU word forms to a shared stem', () => {
    const same = (forms) => {
        const stems = new Set(forms.map(tnStem));
        assert.equal(stems.size, 1, `${forms.join(', ')} → ${[...stems].join(', ')}`);
    };
    same(['дрожь', 'дрожи', 'дрожью']);
    same(['спина', 'спине', 'спину', 'спиной']);
    same(['ухмыльнулся', 'ухмыльнулась', 'ухмыльнулись']);
    same(['пробежала', 'пробежал', 'пробежали']);
    same(['Елена', 'Елены', 'Елене', 'Елену', 'Еленой']);
    same(['Таверна', 'таверне', 'таверну', 'таверной', 'таверны']);
    assert.equal(tnStem('он'), 'он');
    assert.equal(tnStem('ёлка'), tnStem('елка'));
});

test('tnStem maps EN word forms to a shared stem', () => {
    const same = (forms) => {
        const stems = new Set(forms.map(tnStem));
        assert.equal(stems.size, 1, `${forms.join(', ')} → ${[...stems].join(', ')}`);
    };
    same(['smirk', 'smirks', 'smirked', 'smirking']);
    same(['smile', 'smiles', 'smiled', 'smiling']);
    same(['stop', 'stopped', 'stopping']);
    same(['spine', 'spines']);
    same(['story', 'stories']);
    assert.equal(tnStem('glass'), 'glass');
    assert.equal(tnStem(''), '');
    assert.equal(tnStem('42'), '42');
});

test('tnIsStopWord covers RU/EN function words but not content words', () => {
    for (const w of ['и', 'в', 'по', 'она', 'Её', 'же', 'the', 'And', 'her', 'of', '12']) {
        assert.equal(tnIsStopWord(w), true, w);
    }
    for (const w of ['дрожь', 'спине', 'shiver', 'spine', 'ухмыльнулся']) {
        assert.equal(tnIsStopWord(w), false, w);
    }
    assert.equal(tnIsStopWord(''), true);
});

test('tnEstimateTokens follows ceil(latin/4 + cyrillic/2.2 + other/3)', () => {
    assert.equal(tnEstimateTokens(''), 0);
    assert.equal(tnEstimateTokens(null), 0);
    assert.equal(tnEstimateTokens('abcd'), 1);
    assert.equal(tnEstimateTokens('abcde'), 2);
    assert.equal(tnEstimateTokens('абвгд'), Math.ceil(5 / 2.2));
    assert.equal(tnEstimateTokens('   '), 1);
    assert.equal(tnEstimateTokens('ab аб 12'), Math.ceil(2 / 4 + 2 / 2.2 + 4 / 3));
    const cue = '[Director: heighten suspense; slow the pacing]';
    const latin = (cue.match(/[a-z]/gi) || []).length;
    assert.equal(tnEstimateTokens(cue), Math.ceil(latin / 4 + (cue.length - latin) / 3));
    assert.ok(tnEstimateTokens(cue) <= 14);
});
