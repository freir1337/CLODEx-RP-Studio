export function isSafeVoiceId(value) {
    return typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,200}$/.test(value);
}

export function sanitizeVoiceLabel(value) {
    return String(value ?? '')
        .replace(/<[^>]*>/g, '')
        .replace(/[<>&"'\x00-\x1f\x7f]/g, '')
        .trim()
        .slice(0, 180);
}

export function normalizeVoices(payload) {
    const list = Array.isArray(payload?.voices) ? payload.voices
        : Array.isArray(payload?.data) ? payload.data : [];
    const out = new Map();
    for (const item of list) {
        const id = String(item?.voice_id ?? item?.id ?? '').trim();
        if (!isSafeVoiceId(id) || out.has(id)) continue;
        const label = sanitizeVoiceLabel(item?.name || id);
        const lang = String(item?.locale || item?.language || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
        out.set(id, {
            id,
            name: label && label !== id ? `${label} (${id})` : id,
            lang: lang || 'multi',
        });
    }
    return [...out.values()];
}

export function extractSpokenDialogue(rawMessage, { dialogueOnly = true, maxLength = 4000 } = {}) {
    let cleaned = String(rawMessage ?? '')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .trim();

    if (!cleaned) return '';

    if (!dialogueOnly) {
        // Full narration mode: simply remove markdown formatting markers
        return cleaned
            .replace(/[*_~`]+/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, maxLength);
    }

    // 1) Strip explicit asterisk action blocks first (*sighs*, **...** kept if inside quotes? Wait: strip *action* outside quotes)
    const quoted = [];
    const quoteRegex = /«([^»]{2,})»|“([^”]{2,})”|„([^“”]{2,})[“”]|"([^"\n]{2,})"/g;
    let match;
    while ((match = quoteRegex.exec(cleaned)) !== null) {
        const inner = (match[1] || match[2] || match[3] || match[4] || '')
            .replace(/\*[^*]+\*/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (inner) quoted.push(inner);
    }
    if (quoted.length > 0) {
        return quoted.join(' ').slice(0, maxLength);
    }

    // 2) Russian/literary dash-dialogue lines (e.g. "— Подойди сюда, — тихо сказал он.")
    const dashLines = [];
    for (const line of cleaned.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (/^[—–-]\s+\S/.test(trimmed)) {
            // Remove narrator attribution after ", — " if followed by lowercase verb
            const speechPart = trimmed
                .replace(/^[—–-]\s*/, '')
                .replace(/\*[^*]*\*/g, ' ')
                .replace(/[,!?…]\s*[—–-]\s*[а-яёa-z][^.!?\n]*[.!?]?$/u, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (speechPart) dashLines.push(speechPart);
        }
    }
    if (dashLines.length > 0) {
        return dashLines.join(' ').slice(0, maxLength);
    }

    // 3) Fallback: strip *asterisk actions* and return remaining spoken text (if any)
    const withoutActions = cleaned
        .replace(/\*[^*]+\*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return withoutActions.slice(0, maxLength);
}
