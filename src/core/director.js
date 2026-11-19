// M1 «Панель режиссёра» (CLODEx RP Studio v1.3): one-turn director modifiers.
// Pure helpers. The cue lives in state.world.director = { activeIds: [], customNote: '' } and is cleared
// only by the caller in onAssistantMessageCommitted (dirClear), so it survives 429/Stop and swipes.
// Depends on textnorm.js (tnEstimateTokens). Flat-bundler safe: every top-level name is dir*/DIRECTOR_*-prefixed.
import { tnEstimateTokens } from './textnorm.js';

export const DIRECTOR_PRESETS = Object.freeze([
    Object.freeze({ id: 'suspense', emoji: '😨', labelKey: 'director.preset.suspense', directive: 'heighten suspense' }),
    Object.freeze({ id: 'twist', emoji: '🌀', labelKey: 'director.preset.twist', directive: 'introduce a sudden plot twist' }),
    Object.freeze({ id: 'dialogue', emoji: '💬', labelKey: 'director.preset.dialogue', directive: 'focus on dialogue' }),
    Object.freeze({ id: 'slow', emoji: '🐢', labelKey: 'director.preset.slow', directive: 'slow the pacing' }),
    Object.freeze({ id: 'npc_pov', emoji: '👁️', labelKey: 'director.preset.npc_pov', directive: "show the scene through an NPC's eyes" }),
    Object.freeze({ id: 'sensory', emoji: '🌹', labelKey: 'director.preset.sensory', directive: 'add vivid sensory details' }),
]);

export const DIRECTOR_MAX_ACTIVE = 2;
export const DIRECTOR_NOTE_MAX = 140;
export const DIRECTOR_CUE_MAX_TOKENS = 60;
export const DIRECTOR_CUSTOM_MAX = 8;
export const DIRECTOR_LABEL_MAX = 40;
export const DIRECTOR_DIRECTIVE_MAX = 100;

function dirCleanText(value, max) {
    return String(value ?? '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
        .replace(/\[/g, '(')
        .replace(/\]/g, ')')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
        .trim();
}

function dirCleanId(value) {
    return String(value ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
}

export function dirCreate() {
    return { activeIds: [], customNote: '' };
}

export function dirNormalize(raw) {
    const out = dirCreate();
    if (!raw || typeof raw !== 'object') return out;
    if (Array.isArray(raw.activeIds)) {
        for (const id of raw.activeIds) {
            const clean = dirCleanId(id);
            if (clean && !out.activeIds.includes(clean)) out.activeIds.push(clean);
        }
        out.activeIds = out.activeIds.slice(-DIRECTOR_MAX_ACTIVE);
    }
    out.customNote = dirCleanText(raw.customNote, DIRECTOR_NOTE_MAX);
    return out;
}

// Custom button presets stored in settings (≤ 8), shape { id, emoji, label, directive }.
export function dirNormalizeCustomPresets(list) {
    const out = [];
    if (!Array.isArray(list)) return out;
    const builtinIds = new Set(DIRECTOR_PRESETS.map(p => p.id));
    for (const item of list) {
        if (out.length >= DIRECTOR_CUSTOM_MAX) break;
        if (!item || typeof item !== 'object') continue;
        const id = dirCleanId(item.id);
        const directive = dirCleanText(item.directive, DIRECTOR_DIRECTIVE_MAX);
        if (!id || !directive || builtinIds.has(id) || out.some(p => p.id === id)) continue;
        out.push({
            id,
            emoji: dirCleanText(item.emoji, 8) || '🎬',
            label: dirCleanText(item.label, DIRECTOR_LABEL_MAX) || directive.slice(0, DIRECTOR_LABEL_MAX),
            directive,
        });
    }
    return out;
}

function dirEnsure(state) {
    if (!state.world || typeof state.world !== 'object') state.world = {};
    state.world.director = dirNormalize(state.world.director);
    return state.world.director;
}

// Toggles a modifier. When a third one is switched on, the oldest active one is dropped (max 2).
export function dirToggle(state, id) {
    const director = dirEnsure(state);
    const clean = dirCleanId(id);
    if (!clean) return director;
    const idx = director.activeIds.indexOf(clean);
    if (idx >= 0) {
        director.activeIds.splice(idx, 1);
    } else {
        director.activeIds.push(clean);
        while (director.activeIds.length > DIRECTOR_MAX_ACTIVE) director.activeIds.shift();
    }
    return director;
}

export function dirSetNote(state, text) {
    const director = dirEnsure(state);
    director.customNote = dirCleanText(text, DIRECTOR_NOTE_MAX);
    return director;
}

export function dirClear(state) {
    if (!state || typeof state !== 'object') return state;
    if (!state.world || typeof state.world !== 'object') state.world = {};
    state.world.director = dirCreate();
    return state;
}

export function dirIsActive(director) {
    const d = dirNormalize(director);
    return d.activeIds.length > 0 || Boolean(d.customNote);
}

function dirFormatCue(directives, note) {
    if (!directives.length && !note) return '';
    if (!directives.length) return `[Director note: ${note}]`;
    return `[Director: ${directives.join('; ')}${note ? `. Note: ${note}` : ''}]`;
}

// '[Director: heighten suspense; slow the pacing. Note: …]' or ''. Always ≤ DIRECTOR_CUE_MAX_TOKENS.
export function dirBuildCue(director, customPresets = []) {
    const d = dirNormalize(director);
    const custom = dirNormalizeCustomPresets(customPresets);
    const directives = [];
    for (const id of d.activeIds) {
        const preset = DIRECTOR_PRESETS.find(p => p.id === id) || custom.find(p => p.id === id);
        if (preset && !directives.includes(preset.directive)) directives.push(preset.directive);
    }
    let note = d.customNote;
    let cue = dirFormatCue(directives, note);
    if (tnEstimateTokens(cue) <= DIRECTOR_CUE_MAX_TOKENS) return cue;

    // Over budget: shorten the note word by word, then (custom) directives, then drop parts entirely.
    const trimmed = text => {
        const cut = text.replace(/…$/, '').trim();
        const space = cut.lastIndexOf(' ');
        const next = space > 0 ? cut.slice(0, space) : cut.slice(0, -1);
        return next.trim() ? `${next.trim()}…` : '';
    };
    while (note && tnEstimateTokens(dirFormatCue(directives, note)) > DIRECTOR_CUE_MAX_TOKENS) note = trimmed(note);
    cue = dirFormatCue(directives, note);
    while (directives.length && tnEstimateTokens(cue) > DIRECTOR_CUE_MAX_TOKENS) {
        const longest = directives.reduce((best, cur, i) => (cur.length > directives[best].length ? i : best), 0);
        const short = trimmed(directives[longest]);
        if (short) directives[longest] = short;
        else directives.splice(longest, 1);
        cue = dirFormatCue(directives, note);
    }
    return cue;
}
