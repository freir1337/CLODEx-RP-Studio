import { activeEntitiesForTarget, getCyclePhase, getVisibleBiologySummary } from './physiology.js';

export function buildSystemContext(state, { userName = '{{user}}', charName = '{{char}}' } = {}) {
    if (!state?.world) return '';
    const lines = [
        '[CLODEx RP Studio — Active Scene & Physiology State]',
        'Treat the facts below as subtle background continuity for this turn. Depict physical sensations naturally; never output raw stat numbers or meta-labels unless asked in-character.',
        `Current RP Date & Time: ${state.world.rpDate} (${state.world.timeOfDay}, Day ${state.world.dayCount})`
            + (state.world.location ? ` | Location: ${state.world.location}` : '')
            + (state.world.weather ? ` | Weather: ${state.world.weather}` : ''),
    ];

    const names = { user: userName || '{{user}}', char: charName || '{{char}}' };
    for (const role of activeEntitiesForTarget(state.world.targetMode)) {
        const entity = state.entities?.[role];
        if (!entity?.enabled) continue;
        const label = names[role];
        const parts = [];

        if (state.world.enableVitals) {
            const v = entity.vitals;
            const vitalsNote = `Pulse ~${v.heartRate} bpm, breathing: ${v.respiration} (${v.breathRate}/min), circulation: ${v.circulation}`
                + (v.bloodLossPct > 0 ? `, blood loss: ~${v.bloodLossPct}%` : '')
                + `, stamina: ${v.stamina}%, stress: ${v.stress}%`;
            parts.push(`Vitals: ${vitalsNote}.`);
            if (v.wounds.length > 0) {
                const woundsStr = v.wounds
                    .map(w => `${w.label}${w.bleeding ? ' (actively bleeding)' : ' (stabilized/healing)'}`)
                    .join('; ');
                parts.push(`Active injuries: ${woundsStr}.`);
            }
        }

        if (state.world.enableAdultBiology && entity.bio.mode !== 'none') {
            const b = entity.bio;
            const vis = getVisibleBiologySummary(entity, state.world.disclosureMode);
            if (b.postpartumDaysLeft > 0) {
                parts.push(`Postpartum recovery (${b.postpartumDaysLeft} days remaining)`
                    + (b.cSectionScarDays > 0 ? `, healing surgical incision (${b.cSectionScarDays}d left).` : '.'));
            } else if (b.mode === 'oviposition') {
                if (b.carryingClutch) {
                    const stage = b.clutchDays >= b.clutchTargetDays - 4
                        ? 'clutch fully formed, strong pressure/contractions to lay soon'
                        : `carrying developing clutch (day ${b.clutchDays}/${b.clutchTargetDays}, progressive abdominal heaviness)`;
                    const countHint = state.world.disclosureMode === 'omniscient' ? ` (${b.clutchTotal - b.clutchLaid} eggs)` : '';
                    parts.push(`Oviposition biology: ${stage}${countHint}.`);
                }
                if (b.nest.active && b.nest.eggs.length > 0) {
                    const cracked = b.nest.eggs.filter(e => e.cracked).length;
                    parts.push(`Active nest: ${b.nest.eggs.length} egg(s) incubating (warmth: ${b.nest.warmth}`
                        + (cracked > 0 ? `, ${cracked} showing shell cracks near hatching` : '') + ').');
                }
            } else if (b.pregnant) {
                if (!vis.knownPregnant) {
                    // Fog of war: AI must NOT know or reveal pregnancy yet!
                    const subtle = vis.week >= 3 ? 'very subtle early fatigue or mild nausea, cause unknown to characters' : 'normal baseline';
                    parts.push(`Reproductive state: cycle day ${b.cycleDay} (${subtle}; characters DO NOT know about any conception yet — do not meta-game or reveal pregnancy).`);
                } else {
                    let pregText = `Pregnant (approx. week ${vis.week}, phase: ${vis.phase})`;
                    if (vis.revealCount) pregText += `, carrying ${b.fetusCount} fetus(es)`;
                    else pregText += ' (exact number of babies unknown)';
                    if (vis.revealGender && b.fetusGenders.length) pregText += `, sex: ${b.fetusGenders.join(', ')}`;
                    else pregText += ' (fetal sex unknown — do not guess as fact)';
                    if (b.complication !== 'none') pregText += `, current symptom/complication: ${b.complication.replace(/_/g, ' ')}`;
                    parts.push(`Reproductive state: ${pregText}.`);
                }
            } else if (b.mode === 'omegaverse') {
                const phase = getCyclePhase(b);
                let omegaStr = `Omegaverse dynamic: ${b.omegaRole.toUpperCase()}, cycle day ${b.cycleDay}/${b.cycleLength} (${phase}), pheromone intensity ${b.pheromoneIntensity}%`
                    + (b.pheromoneScent ? ` (scent: ${b.pheromoneScent})` : '');
                if (b.suppressants !== 'none') omegaStr += `, suppressants: ${b.suppressants}`;
                if (b.bondType !== 'none') omegaStr += `, ${b.bondType} bond mark${b.bondPartner ? ` with ${b.bondPartner}` : ''}`;
                parts.push(`${omegaStr}.`);
            } else if (b.mode === 'cycle') {
                const phase = getCyclePhase(b);
                parts.push(`Cycle tracking: day ${b.cycleDay}/${b.cycleLength} (phase: ${phase}).`);
            }
        }

        if (parts.length > 0) {
            lines.push(`• ${label}: ${parts.join(' ')}`);
        }
    }

    if (state.offspring.length > 0 && state.world.enableAdultBiology) {
        const kids = state.offspring.slice(-6)
            .map(k => `${k.name || 'Unnamed child'} (${k.gender}, born ${k.bornDate})`)
            .join(', ');
        lines.push(`• Recorded offspring / family tree: ${kids}.`);
    }

    if (Array.isArray(state.customMeters) && state.customMeters.length > 0) {
        const metersStr = state.customMeters
            .map(m => `${m.label}: ${m.value}/${m.max}${m.min < 0 ? ` (min ${m.min})` : ''}`)
            .join(' | ');
        lines.push(`• Active Story Meters: ${metersStr}.`);
    }

    if (state.inventory) {
        for (const role of activeEntitiesForTarget(state.world.targetMode)) {
            const items = state.inventory[role];
            if (Array.isArray(items) && items.length > 0) {
                lines.push(`• ${names[role]} Inventory / Active Items: ${items.join(', ')}.`);
            }
        }
    }

    if (state.world.pendingMemoryHint) {
        lines.push(`[Lore / Canon Guidance for This Turn]: ${state.world.pendingMemoryHint}`);
    }

    return lines.length > 3 ? lines.join('\n') : '';
}

export function buildTrackerExtractionMessages(state, recentMessages, { userName = 'User', charName = 'Character' } = {}) {
    const dialogue = recentMessages
        .slice(-4)
        .map(m => `${m.role === 'user' ? userName : charName}: ${String(m.content ?? '').slice(0, 1800)}`)
        .join('\n\n');

    const meterSchemaHint = Array.isArray(state.customMeters) && state.customMeters.length > 0
        ? state.customMeters.map(m => `"${m.id}": ${m.value} /* ${m.label}, range ${m.min}..${m.max}, adjust if latest scene changed it */`).join(', ')
        : '';

    const systemPrompt = [
        'You are a strict JSON state-delta extractor for a roleplay simulation engine.',
        'Analyze ONLY what explicitly happened in the latest exchange (ignoring flashbacks or hypothetical speech) and return ONE valid JSON object with no markdown fences.',
        `Current RP Date: ${state.world.rpDate}, Time: ${state.world.timeOfDay}, Location: ${state.world.location || 'unknown'}.`,
        'JSON schema:',
        '{',
        '  "daysElapsed": 0, // integer >= 0; only > 0 if a day changed or a timeskip occurred',
        '  "newRpDate": null, // "YYYY-MM-DD" string ONLY if an explicit calendar date is stated in the present, else null',
        '  "timeOfDay": "morning" | "day" | "evening" | "night",',
        '  "location": "short current location or empty string",',
        '  "weather": "short weather/atmosphere or empty string",',
        meterSchemaHint ? `  "customMeters": { ${meterSchemaHint} },` : '  "customMeters": {},',
        '  "inventoryAdd": { "user": [], "char": [] }, // short item names newly acquired/equipped this turn',
        '  "inventoryRemove": { "user": [], "char": [] }, // items lost/consumed/dropped this turn',
        '  "entities": {',
        '    "user": {',
        '      "heartRate": 72, // integer 45..200 reflecting physical exertion, fear, arousal, shock, or rest',
        '      "breathRate": 14, // integer 10..44',
        '      "respiration": "steady" | "deep" | "rapid" | "breathless" | "shallow",',
        '      "circulation": "normal" | "flushed" | "adrenaline" | "pallor" | "hypovolemia",',
        '      "bloodLossDelta": 0, // integer -10..35; positive ONLY on fresh bleeding trauma',
        '      "staminaDelta": 0, // integer -40..40',
        '      "stressDelta": 0, // integer -30..35',
        '      "newWound": "", // short wound description if newly injured in this turn, else ""',
        '      "woundBleeding": false,',
        '      "woundSeverity": 1, // 1..3',
        '      "treatedWounds": false, // true if bandaged/healed this turn',
        '      "pheromoneIntensity": null, // integer 0..100 or null',
        '      "intimacyOccurred": false, // true ONLY if reproductive intimacy completed in the latest turn',
        '      "knotted": false,',
        '      "bondFormed": null, // null | "temporary" | "permanent"',
        '      "bondPartner": "",',
        '      "pregnancyTestTaken": false,',
        '      "ultrasoundPerformed": false,',
        '      "birthOccurred": false,',
        '      "birthMethod": "natural", // "natural" | "c_section"',
        '      "eggsLaidCount": 0, // integer >= 0 or "all"',
        '      "eggsHatched": false',
        '    },',
        '    "char": { /* same fields as user */ }',
        '  }',
        '}',
    ].join('\n');

    return [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Extract JSON state delta from this roleplay exchange:\n\n${dialogue}` },
    ];
}

export function parseTrackerExtraction(rawText) {
    const text = String(rawText ?? '').trim();
    if (!text) throw new Error('Empty tracker extraction response.');
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    const candidate = fenced ? fenced[1].trim() : text;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('Tracker response did not contain JSON.');
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid tracker JSON object.');
    return parsed;
}

export function buildSceneVisualPromptMessages({
    charName = '',
    charDescription = '',
    scenario = '',
    location = '',
    weather = '',
    recentMessages = [],
    stylePreset = 'cinematic',
} = {}) {
    const styleGuide = stylePreset === 'dark_gothic'
        ? 'Dark gothic sacred chiaroscuro, dramatic candlelight, ornate architecture, expressive anatomy, oil-painted cinematic realism.'
        : stylePreset === 'anime_illustration'
            ? 'Masterpiece anime key visual, cel-shaded atmospheric lighting, expressive eyes, rich background detail.'
            : 'Cinematic atmospheric digital art, dramatic lighting, shallow depth of field, rich environmental storytelling.';

    const dialogue = recentMessages
        .slice(-4)
        .map(m => `${m.name || m.role}: ${String(m.content ?? '').slice(0, 1200)}`)
        .join('\n');

    return [
        {
            role: 'system',
            content: 'Write ONE concise, vivid English visual-generation prompt (60–130 words) for an atmospheric roleplay scene background/illustration. '
                + 'Preserve character visual traits (hair, eyes, attire, tattoos, build), setting, lighting, and action. '
                + 'Do not include text overlays, speech bubbles, or meta commentary. Return ONLY the prompt.',
        },
        {
            role: 'user',
            content: [
                `Visual style: ${styleGuide}`,
                charName ? `Main character: ${charName}` : '',
                charDescription ? `Character appearance/card: ${String(charDescription).slice(0, 2500)}` : '',
                scenario ? `Scenario: ${String(scenario).slice(0, 1000)}` : '',
                location ? `Current location: ${location}` : '',
                weather ? `Atmosphere/weather: ${weather}` : '',
                `Recent scene:\n${dialogue}`,
            ].filter(Boolean).join('\n\n'),
        },
    ];
}
