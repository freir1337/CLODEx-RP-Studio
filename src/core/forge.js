export const FORGE_CONCEPT_CHIPS = Object.freeze([
    {
        id: 'dante_inquisitor',
        ru: 'Татуированный священник-экзорцист в сеттинге Божественной комедии Данте: холодный самоконтроль, тайная печать ереси, 5 статей лорбука по кругам и ордену.',
        en: 'Tattooed exorcist priest in a Dantean dark-fantasy setting: icy restraint, hidden heretical seal, and 5 lorebook entries covering his order and infernal circles.',
    },
    {
        id: 'omegaverse_duke',
        ru: 'Северный герцог-альфа в сеттинге политического Омегаверса: вынужденный династический брак с {{user}}, запах морозного кедра и дыма, интриги двора.',
        en: 'Northern Alpha Duke in a political Omegaverse court: arranged dynastic marriage with {{user}}, scent of frost cedar and smoke, courtly intrigue.',
    },
    {
        id: 'cyber_medic',
        ru: 'Подпольный кибер-хирург Нео-Киото: мрачный юмор, спасает раненого {{user}} в дождливом переулке, 5 записей лорбука о синдикатах и имплантах.',
        en: 'Underground cyber-surgeon in rain-slicked Neo-Kyoto: dry wit, patching up an injured {{user}} in a neon back-alley clinic, with syndicate lorebook entries.',
    },
]);

export function buildForgePromptMessages({
    concept,
    language = 'ru',
    loreCount = 5,
} = {}) {
    const cleanConcept = String(concept ?? '').trim();
    if (!cleanConcept) throw new Error('Describe your character idea first.');

    const targetLang = language === 'ru' ? 'Russian' : 'English';
    const entriesTarget = Math.max(2, Math.min(8, Math.trunc(Number(loreCount) || 5)));

    const systemPrompt = [
        'You are a master Roleplay Character Card & Worldbook designer.',
        `Write all roleplay text fields in ${targetLang}, EXCEPT "avatarPrompt" which MUST be a vivid English portrait generation prompt (60–110 words, no text overlays).`,
        'Use {{char}} for the character and {{user}} for the player where appropriate. Make the opening scene ("first_mes") atmospheric, multi-paragraph, with vivid sensory detail and natural dialogue.',
        `Include exactly ${entriesTarget} rich worldbook/lorebook entries in "lorebook" with 2–5 trigger keywords each.`,
        'Return ONLY one valid JSON object (no markdown fences) matching this exact structure:',
        '{',
        '  "name": "Character Name",',
        '  "description": "Detailed appearance, backstory, speech style, secrets, and traits...",',
        '  "personality": "Concise personality summary...",',
        '  "scenario": "Current situation and relationship to {{user}}...",',
        '  "first_mes": "Rich opening scene and dialogue...",',
        '  "alternate_greetings": ["Second alternative opening scene..."],',
        '  "mes_example": "<START>\\n{{user}}: ...\\n{{char}}: ...",',
        '  "system_prompt": "Stay in character as {{char}}, portray emotions and physical details vividly.",',
        '  "tags": ["dark fantasy", "romance"],',
        '  "avatarPrompt": "Detailed English visual portrait prompt of the character, lighting, attire, composition...",',
        '  "lorebookName": "World Lorebook Title",',
        '  "lorebook": [',
        '    { "comment": "Entry Title", "keys": ["keyword1", "keyword2"], "content": "Detailed lore entry..." }',
        '  ]',
        '}',
    ].join('\n');

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Create a complete character card and ${entriesTarget}-entry lorebook from this concept:\n\n${cleanConcept}` },
    ];
}

export function parseForgedCardV2(rawText) {
    const text = String(rawText ?? '').trim();
    if (!text) throw new Error('Empty Forge model response.');
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    const candidate = fenced ? fenced[1].trim() : text;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('Forge response did not contain a JSON object.');

    const raw = JSON.parse(candidate.slice(start, end + 1));
    const name = String(raw.name ?? '').trim().slice(0, 80);
    const firstMes = String(raw.first_mes ?? raw.firstMes ?? '').trim();
    if (!name || !firstMes) {
        throw new Error('Generated card is missing required name or first_mes.');
    }

    const rawEntries = Array.isArray(raw.lorebook) ? raw.lorebook : [];
    const entries = rawEntries.slice(0, 12).map((entry, idx) => {
        const keys = Array.isArray(entry?.keys)
            ? entry.keys.map(k => String(k).trim()).filter(Boolean).slice(0, 8)
            : String(entry?.keys ?? '').split(',').map(k => k.trim()).filter(Boolean).slice(0, 8);
        return {
            id: idx + 1,
            keys: keys.length ? keys : [name],
            secondary_keys: [],
            comment: String(entry?.comment ?? `Lore #${idx + 1}`).slice(0, 120),
            content: String(entry?.content ?? '').trim().slice(0, 3000),
            constant: false,
            selective: false,
            insertion_order: 100 + idx,
            enabled: true,
            position: 'before_char',
        };
    }).filter(e => e.content);

    const card = {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name,
            description: String(raw.description ?? '').trim(),
            personality: String(raw.personality ?? '').trim(),
            scenario: String(raw.scenario ?? '').trim(),
            first_mes: firstMes,
            mes_example: String(raw.mes_example ?? '').trim(),
            creator_notes: 'Forged with CLODEx RP Studio (https://clodex.xyz)',
            system_prompt: String(raw.system_prompt ?? '').trim(),
            post_history_instructions: '',
            alternate_greetings: Array.isArray(raw.alternate_greetings)
                ? raw.alternate_greetings.map(s => String(s).trim()).filter(Boolean).slice(0, 4)
                : [],
            tags: Array.isArray(raw.tags)
                ? raw.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 12)
                : ['clodex-rp-studio'],
            creator: 'CLODEx RP Studio',
            character_version: '1.1.0',
            extensions: {},
            character_book: {
                name: String(raw.lorebookName || `${name} — Lorebook`).slice(0, 120),
                description: '',
                scan_depth: 4,
                token_budget: 1024,
                recursive_scanning: false,
                extensions: {},
                entries,
            },
        },
    };

    const avatarPrompt = String(raw.avatarPrompt ?? '').trim()
        || `Portrait of ${name}, ${String(raw.description ?? '').slice(0, 220)}, cinematic lighting, detailed masterpiece`;

    return { card, avatarPrompt };
}
