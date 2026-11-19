// Shared Tavo helpers for the unified turn key (`<messageId>:<variant>`), bundled
// into entry.js, ui/hud.js and ui/turn.js. Names are prefixed with `tavo*` so they
// never collide with core modules inside the flat classic-script bundles.
import { jrTurnKey } from '../core/journal.js';

export function tavoHashString(text) {
    // FNV-1a 32-bit, base36 — short, deterministic, no crypto dependency.
    let h = 0x811c9dc5;
    const str = String(text ?? '');
    for (let i = 0; i < str.length; i += 1) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
}

export function tavoIsCharacterRole(role) {
    return role === 'assistant' || role === 'character';
}

// The selected variant (swipe / alternative) of a Tavo message. Falls back to a
// content hash when the runtime does not expose a variant index, so regenerated
// variants still get distinct keys.
export function tavoMessageVariant(msg) {
    if (!msg || typeof msg !== 'object') return 0;
    const candidates = [msg.swipeId, msg.alternativeIndex, msg.selectedAlternative, msg.variantIndex, msg.variantId];
    for (const value of candidates) {
        if (value !== undefined && value !== null && value !== '') return String(value);
    }
    if (typeof msg.content === 'string' && msg.content) return `h${tavoHashString(msg.content)}`;
    return 0;
}

export function tavoMessageTurnKey(msg) {
    const id = String(msg?.id ?? '');
    if (!id) return '';
    return jrTurnKey(id, tavoMessageVariant(msg));
}

// `<id>:<variant>#salt` → `<id>`
export function tavoTurnKeyMessageId(turnKey) {
    const bare = String(turnKey ?? '').split('#')[0];
    const cut = bare.lastIndexOf(':');
    return cut >= 0 ? bare.slice(0, cut) : bare;
}

export function tavoJournalKeysForMessage(store, messageId) {
    const id = String(messageId ?? '');
    const out = new Set();
    for (const op of Array.isArray(store?.journal) ? store.journal : []) {
        if (op && typeof op.turnKey === 'string' && tavoTurnKeyMessageId(op.turnKey) === id) out.add(op.turnKey);
    }
    return [...out];
}

// Earliest snapshot key of a message (any variant, or the legacy bare id key).
export function tavoFirstCheckpointKeyForMessage(state, messageId) {
    const id = String(messageId ?? '');
    const list = Array.isArray(state?.checkpoints) ? state.checkpoints : [];
    const hit = list.find(cp => cp && (cp.key === id || tavoTurnKeyMessageId(cp.key) === id));
    return hit ? hit.key : '';
}
