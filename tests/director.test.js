import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DIRECTOR_CUE_MAX_TOKENS,
    DIRECTOR_MAX_ACTIVE,
    DIRECTOR_NOTE_MAX,
    DIRECTOR_PRESETS,
    dirBuildCue,
    dirClear,
    dirIsActive,
    dirNormalize,
    dirNormalizeCustomPresets,
    dirSetNote,
    dirToggle,
} from '../src/core/director.js';
import { tnEstimateTokens } from '../src/core/textnorm.js';

const freshState = () => ({ world: { director: { activeIds: [], customNote: '' }, pendingMemoryHint: '' } });

test('DIRECTOR_PRESETS: 6 frozen presets with short English directives', () => {
    assert.deepEqual(DIRECTOR_PRESETS.map(p => p.id), ['suspense', 'twist', 'dialogue', 'slow', 'npc_pov', 'sensory']);
    assert.ok(Object.isFrozen(DIRECTOR_PRESETS));
    for (const p of DIRECTOR_PRESETS) {
        assert.ok(Object.isFrozen(p));
        assert.equal(p.labelKey, `director.preset.${p.id}`);
        assert.ok(p.emoji);
        assert.match(p.directive, /^[a-z][A-Za-z ',-]+$/);
        assert.ok(tnEstimateTokens(p.directive) <= 12, p.directive);
    }
    assert.equal(DIRECTOR_MAX_ACTIVE, 2);
    assert.equal(DIRECTOR_NOTE_MAX, 140);
});

test('dirToggle keeps at most 2 active modifiers and toggles off', () => {
    const state = freshState();
    dirToggle(state, 'suspense');
    dirToggle(state, 'slow');
    assert.deepEqual(state.world.director.activeIds, ['suspense', 'slow']);
    dirToggle(state, 'twist');
    assert.deepEqual(state.world.director.activeIds, ['slow', 'twist']);
    dirToggle(state, 'slow');
    assert.deepEqual(state.world.director.activeIds, ['twist']);
    dirToggle(state, '');
    assert.deepEqual(state.world.director.activeIds, ['twist']);
    const bare = {};
    dirToggle(bare, 'dialogue');
    assert.deepEqual(bare.world.director, { activeIds: ['dialogue'], customNote: '' });
});

test('dirSetNote trims to 140 chars, sanitizes brackets/HTML and newlines', () => {
    const state = freshState();
    dirSetNote(state, 'x'.repeat(500));
    assert.equal(state.world.director.customNote.length, 140);
    dirSetNote(state, '  <b>Пусть</b> [он]\nсоврёт  ');
    assert.equal(state.world.director.customNote, 'Пусть (он) соврёт');
});

test('dirBuildCue formats presets and note', () => {
    assert.equal(dirBuildCue({ activeIds: [], customNote: '' }), '');
    assert.equal(dirBuildCue(null), '');
    assert.equal(dirBuildCue({ activeIds: ['suspense', 'slow'], customNote: '' }), '[Director: heighten suspense; slow the pacing]');
    assert.ok(tnEstimateTokens('[Director: heighten suspense; slow the pacing]') <= 14);
    assert.equal(
        dirBuildCue({ activeIds: ['twist'], customNote: 'Пусть войдёт стража' }),
        '[Director: introduce a sudden plot twist. Note: Пусть войдёт стража]',
    );
    assert.equal(dirBuildCue({ activeIds: [], customNote: 'Kiss her' }), '[Director note: Kiss her]');
    assert.equal(dirBuildCue({ activeIds: ['unknown'], customNote: '' }), '');
});

test('dirBuildCue resolves custom presets and never exceeds 60 tokens', () => {
    const custom = [{ id: 'rain', emoji: '🌧', label: 'Дождь', directive: 'make it rain heavily' }];
    assert.equal(dirBuildCue({ activeIds: ['rain'] }, custom), '[Director: make it rain heavily]');

    const longCustom = [
        { id: 'c1', label: 'a', directive: 'Сделай так, чтобы каждая реплика персонажа звучала как цитата из старинного романа' },
        { id: 'c2', label: 'b', directive: 'Пусть погода резко меняется и отражает внутреннее состояние героини в этой сцене' },
    ];
    const note = 'Очень длинная русская заметка режиссёра, которая описывает желаемое развитие сцены во всех подробностях без пауз и сокращений вообще';
    const director = { activeIds: ['c1', 'c2'], customNote: note.slice(0, 140) };
    const cue = dirBuildCue(director, longCustom);
    assert.ok(cue.startsWith('[Director'));
    assert.ok(cue.endsWith(']'));
    assert.ok(tnEstimateTokens(cue) <= DIRECTOR_CUE_MAX_TOKENS, `${tnEstimateTokens(cue)}: ${cue}`);

    const maxNote = 'й'.repeat(140);
    const cue2 = dirBuildCue({ activeIds: ['npc_pov', 'sensory'], customNote: maxNote });
    assert.ok(tnEstimateTokens(cue2) <= DIRECTOR_CUE_MAX_TOKENS, cue2);
    assert.ok(cue2.includes("show the scene through an NPC's eyes"));
});

test('cue reaches exactly one generation: survives failures/swipe, cleared after committed reply', () => {
    const state = freshState();
    const generations = [];
    const generate = () => generations.push(dirBuildCue(state.world.director));
    const onAssistantMessageCommitted = () => dirClear(state);

    dirToggle(state, 'twist');
    dirSetNote(state, 'Ворвётся стража');
    assert.equal(dirIsActive(state.world.director), true);

    generate(); // 429 / Stop: nothing committed, cue must survive
    generate(); // swipe / retry on the new variant
    onAssistantMessageCommitted();
    generate(); // next turn

    assert.equal(generations[0], '[Director: introduce a sudden plot twist. Note: Ворвётся стража]');
    assert.equal(generations[1], generations[0]);
    assert.equal(generations[2], '');
    assert.deepEqual(state.world.director, { activeIds: [], customNote: '' });
    assert.equal(dirIsActive(state.world.director), false);
    assert.equal(state.world.pendingMemoryHint, '');
});

test('dirNormalize and dirNormalizeCustomPresets sanitize stored data', () => {
    assert.deepEqual(dirNormalize({ activeIds: ['A!', 'slow', 'slow', 'twist'], customNote: 5 }), { activeIds: ['slow', 'twist'], customNote: '5' });
    assert.deepEqual(dirNormalize('junk'), { activeIds: [], customNote: '' });
    const list = dirNormalizeCustomPresets([
        { id: 'suspense', directive: 'collides with builtin' },
        { id: 'ok', directive: '<script>x</script>be terse' },
        { id: 'ok', directive: 'duplicate' },
        { id: 'empty', directive: '' },
        ...Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, label: `P${i}`, directive: `do thing ${i}` })),
    ]);
    assert.equal(list.length, 8);
    assert.deepEqual(list[0], { id: 'ok', emoji: '🎬', label: 'x be terse', directive: 'x be terse' });
});
