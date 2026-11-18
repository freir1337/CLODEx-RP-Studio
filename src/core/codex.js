export const CODEX_PRESETS = Object.freeze({
    lore_keeper: {
        id: 'lore_keeper',
        system: 'You are the Lore Keeper & Continuity Navigator inside CLODEx RP Studio. '
            + 'Help the roleplayer quickly recall character card details, world lore, past events, relationships, or brainstorm in-character actions without breaking immersion. '
            + 'Answer concisely and clearly in the language of the user\'s question.',
    },
    biblical_dante: {
        id: 'biblical_dante',
        preferMistral: true,
        system: 'You are the Theological, Classical & Dantean Navigator ("Biblical Mistral") inside CLODEx RP Studio. '
            + 'You are an expert in the Old & New Testaments, Apocrypha, Dante Alighieri\'s Divine Comedy (Inferno, Purgatorio, Paradiso — exact circles, bolgias, contrapasso, guardians), Christian demonology/angelology, and ecclesiastical Latin phrases/prayers. '
            + 'Give accurate references (book/chapter:verse or canto), explain symbolism concisely, and when useful provide a short atmospheric phrase or Latin line ready for roleplay. '
            + 'Respond in the language of the user\'s question.',
    },
    medical_realism: {
        id: 'medical_realism',
        system: 'You are the Anatomy, Physiology & Medical Realism Consultant for fiction writers inside CLODEx RP Studio. '
            + 'Explain realistic symptoms of wounds, blood loss, respiration, shock, exertion, pharmacology, pregnancy, or recovery so the writer can portray scenes accurately in roleplay. '
            + 'Respond concisely in the language of the user\'s question.',
    },
    custom: {
        id: 'custom',
        system: '',
    },
});

export function buildCodexMessages({
    preset = 'lore_keeper',
    customPrompt = '',
    question = '',
    history = [],
    charName = '',
    charDescription = '',
    scenario = '',
    recentChat = [],
    locale = 'ru',
} = {}) {
    const cleanQuestion = String(question ?? '').trim();
    if (!cleanQuestion) throw new Error('Enter a question for the Codex.');

    const selected = CODEX_PRESETS[preset] ?? CODEX_PRESETS.lore_keeper;
    const baseSystem = preset === 'custom' && customPrompt.trim()
        ? customPrompt.trim()
        : selected.system || CODEX_PRESETS.lore_keeper.system;

    const contextBlock = [
        charName ? `Active RP Character: ${charName}` : '',
        charDescription ? `Character Card Summary:\n${String(charDescription).slice(0, 2400)}` : '',
        scenario ? `Scenario:\n${String(scenario).slice(0, 1200)}` : '',
        recentChat.length
            ? `Recent RP Chat Excerpt:\n${recentChat.slice(-6).map(m => `${m.name || m.role}: ${String(m.content ?? '').slice(0, 700)}`).join('\n')}`
            : '',
        `Default UI Locale: ${locale}`,
    ].filter(Boolean).join('\n\n');

    const messages = [
        {
            role: 'system',
            content: contextBlock ? `${baseSystem}\n\n--- ACTIVE ROLEPLAY CONTEXT ---\n${contextBlock}` : baseSystem,
        },
        ...history.slice(-8).map(entry => ({
            role: entry.role === 'user' ? 'user' : 'assistant',
            content: String(entry.content ?? '').slice(0, 3000),
        })),
        { role: 'user', content: cleanQuestion },
    ];
    return messages;
}
