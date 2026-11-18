import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, ClodexApi, redact, safeMediaUrl, validateKey } from '../src/core/api.js';
import { normalizeCatalog, pickRecommendedModels, quotaView, videoBillingView, walletView } from '../src/core/catalog.js';
import { buildCodexMessages } from '../src/core/codex.js';
import { addDaysToIso, diffDaysForward } from '../src/core/date.js';
import {
    advanceSimulationDays, applyTurnExtraction, computeConceptionChance, createChatState,
    deliverBabies, getCyclePhase, hatchReadyEggs, layEggs, restoreCheckpointBefore, triggerConception,
} from '../src/core/physiology.js';
import { buildSystemContext, parseTrackerExtraction } from '../src/core/prompts.js';

test('API key validation, redaction, and safe media URL guard', () => {
    assert.equal(validateKey('  sk-clodex_test_12345  '), 'sk-clodex_test_12345');
    assert.throws(() => validateKey('invalid-key'), ApiError);
    assert.equal(redact('Failed with sk-secret999999 token', 'sk-secret999999'), 'Failed with [redacted] token');
    assert.equal(safeMediaUrl('https://cdn.clodex.xyz/media/out.png'), 'https://cdn.clodex.xyz/media/out.png');
    assert.throws(() => safeMediaUrl('http://cdn.clodex.xyz/media/out.png'), ApiError);
    assert.throws(() => safeMediaUrl('https://127.0.0.1/secret.png'), ApiError);
    assert.throws(() => safeMediaUrl('https://localhost/secret.png'), ApiError);
});

test('Catalog normalization prioritizes Nano Banana for images and Mistral for Codex', () => {
    const catalog = normalizeCatalog({
        data: [
            { id: 'gemini-2.5-flash-lite' },
            { id: 'mistral-large-latest' },
            { id: 'flux-dev' },
            { id: 'gemini-2.5-flash-image-nano-banana' },
            { id: 'kling-v2-video' },
        ],
    });
    const picked = pickRecommendedModels(catalog, {});
    assert.equal(picked.trackerModel, 'gemini-2.5-flash-lite');
    assert.equal(picked.codexModel, 'mistral-large-latest');
    assert.equal(picked.imageModel, 'gemini-2.5-flash-image-nano-banana');
    assert.equal(picked.videoModel, 'kling-v2-video');
});

test('Wallet and quota views handle USD/RUB and ignore CNY exchange rate', () => {
    const quotaPayload = {
        data: {
            total_available: 5_000_000,
            quota_per_unit: 500_000,
            unlimited_quota: true,
            wallet_balance_usd: 14.5,
            usd_to_rub: 96,
            video_billing: {
                version: 1,
                funding_source: 'paid_wallet',
                promotional_balance_eligible: false,
                free_generation_available: false,
                paid_balance_usd: 12.25,
            },
        },
    };
    const status = { data: { usd_exchange_rate: 7.2 } };
    const w = walletView(quotaPayload, status);
    assert.equal(w.usd, 14.5);
    assert.equal(w.rub, 14.5 * 96);
    const q = quotaView({ data: { total_available: 1_000_000, quota_per_unit: 500_000 } }, status);
    assert.equal(q.usd, 2);
    assert.equal(q.rub, null); // CNY 7.2 must never be treated as RUB
    assert.equal(videoBillingView(quotaPayload)?.paidUSD, 12.25);
});

test('ClodexApi.chat falls back cleanly when json_object response_format is unsupported', async () => {
    let calls = 0;
    const api = new ClodexApi({
        getKey: () => 'sk-testkey12345',
        fetchImpl: async (_url, init) => {
            calls += 1;
            const body = JSON.parse(init.body);
            if (calls === 1) {
                assert.deepEqual(body.response_format, { type: 'json_object' });
                return new Response(JSON.stringify({ error: { message: 'response_format unsupported' } }), { status: 400 });
            }
            assert.equal(body.response_format, undefined);
            return new Response(JSON.stringify({
                choices: [{ message: { content: '```json\n{"daysElapsed":2,"timeOfDay":"morning"}\n```' } }],
            }), { status: 200 });
        },
    });
    const text = await api.chat({
        model: 'mistral-small',
        messages: [{ role: 'user', content: 'hi' }],
        jsonMode: true,
    });
    const delta = parseTrackerExtraction(text);
    assert.equal(calls, 2);
    assert.equal(delta.daysElapsed, 2);
    assert.equal(delta.timeOfDay, 'morning');
});

test('Anti-rollback calendar guard ignores past flashback dates', () => {
    assert.equal(diffDaysForward('2026-09-10', '2026-08-01'), 0);
    assert.equal(diffDaysForward('2026-09-10', '2026-09-15'), 5);
    assert.equal(addDaysToIso('2026-09-29', 3), '2026-10-02');
});

test('Vitals shock escalation, Cycle Fog-of-War, Ultrasound milestones, and Delivery', () => {
    const state = createChatState('2026-09-01');
    state.world.enableAdultBiology = true;
    state.world.disclosureMode = 'modern';
    const char = state.entities.char;
    char.bio.mode = 'cycle';
    char.bio.cycleDay = 14; // Ovulation peak
    assert.equal(getCyclePhase(char.bio), 'ovulation');
    assert.ok(computeConceptionChance(char.bio) > 0.3);

    // Force conception with deterministic twin RNG
    const rolls = [0.02, 0.2, 0.8, 0.9]; // 0.02 -> twins, female, male, no complication
    let idx = 0;
    const rng = () => rolls[idx++ % rolls.length];
    assert.equal(triggerConception(char, state, { rng, force: true }), true);
    assert.equal(char.bio.fetusCount, 2);

    // Week 1: Fog-of-War hides pregnancy from AI completely
    const earlyCtx = buildSystemContext(state, { userName: 'Player', charName: 'Beatrice' });
    assert.match(earlyCtx, /DO NOT know about any conception yet/);
    assert.doesNotMatch(earlyCtx, /carrying 2/);

    // Advance 140 days (~20 weeks): pregnancy known, but sex/count hidden until Ultrasound
    advanceSimulationDays(state, 140, { rng: () => 0.99 });
    const midMaskedCtx = buildSystemContext(state, { userName: 'Player', charName: 'Beatrice' });
    assert.match(midMaskedCtx, /exact number of babies unknown/);
    assert.match(midMaskedCtx, /fetal sex unknown/);

    // Perform week-21 Ultrasound: count and genders revealed!
    char.bio.ultrasoundWeek = 21;
    const revealedCtx = buildSystemContext(state, { userName: 'Player', charName: 'Beatrice' });
    assert.match(revealedCtx, /carrying 2 fetus\(es\)/);
    assert.match(revealedCtx, /female, male/);

    // Deliver twins -> recorded in Family Tree + postpartum recovery starts
    const babies = deliverBabies(char, state, { method: 'c_section' });
    assert.equal(babies.length, 2);
    assert.equal(state.offspring.length, 2);
    assert.equal(char.bio.pregnant, false);
    assert.equal(char.bio.postpartumDaysLeft, 42);
    assert.equal(char.bio.cSectionScarDays, 56);
});

test('Omegaverse Pro heat trigger, suppressant blocking, and Oviposition clutch/nest lifecycle', () => {
    const state = createChatState('2026-09-01');
    state.world.enableAdultBiology = true;

    // Omegaverse on user
    const user = state.entities.user;
    user.bio.mode = 'omegaverse';
    user.bio.omegaRole = 'omega';
    user.bio.cycleLength = 28;
    user.bio.cycleDay = 28;
    advanceSimulationDays(state, 1, { rng: () => 0.9 });
    assert.equal(user.bio.inHeatOrRut, true);
    assert.equal(getCyclePhase(user.bio), 'heat');

    // Oviposition on char
    const char = state.entities.char;
    char.bio.mode = 'oviposition';
    triggerConception(char, state, { rng: () => 0.3, force: true }); // 2 + floor(0.3*5) = 3 eggs
    assert.equal(char.bio.carryingClutch, true);
    assert.equal(char.bio.clutchTotal, 3);

    // Lay 1 egg first, then remaining 2
    assert.equal(layEggs(char, state, 1), 1);
    assert.equal(char.bio.carryingClutch, true);
    assert.equal(char.bio.nest.eggs.length, 1);
    assert.equal(layEggs(char, state, null), 2);
    assert.equal(char.bio.carryingClutch, false);
    assert.equal(char.bio.nest.eggs.length, 3);

    // Incubate 60 days at optimal warmth -> crack & hatch into offspring
    advanceSimulationDays(state, 60, { rng: () => 0.9 });
    assert.ok(char.bio.nest.eggs.every(e => e.cracked && e.daysIncubated === 60));
    const hatched = hatchReadyEggs(char, state);
    assert.equal(hatched.length, 3);
    assert.equal(char.bio.nest.active, false);
    assert.equal(state.offspring.length, 3);
});

test('Turn checkpoints roll back state cleanly on message swipe or deletion', () => {
    const state = createChatState('2026-09-01');
    applyTurnExtraction(state, {
        daysElapsed: 0,
        timeOfDay: 'evening',
        entities: { char: { heartRate: 80 } },
    }, { checkpointKey: 'msg-1' });

    applyTurnExtraction(state, {
        daysElapsed: 5,
        timeOfDay: 'morning',
        location: 'Eighth Circle of Hell',
        entities: { char: { heartRate: 145, bloodLossDelta: 30, newWound: 'Spear graze', woundBleeding: true } },
    }, { checkpointKey: 'msg-2' });

    assert.equal(state.world.rpDate, '2026-09-06');
    assert.equal(state.entities.char.vitals.circulation, 'hypovolemia');

    // Roll back msg-2 -> restores msg-1 state!
    assert.equal(restoreCheckpointBefore(state, 'msg-2'), true);
    assert.equal(state.world.rpDate, '2026-09-01');
    assert.equal(state.entities.char.vitals.heartRate, 80);
    assert.equal(state.entities.char.vitals.wounds.length, 0);
});

test('Codex builds Biblical/Dante and Lore Keeper prompts with active RP context', () => {
    const msgs = buildCodexMessages({
        preset: 'biblical_dante',
        question: 'Кто охраняет восьмой круг ада у Данте?',
        charName: 'Father Matteo',
        charDescription: 'Exorcist with sacred tattoos.',
        locale: 'ru',
    });
    assert.equal(msgs.length, 2);
    assert.match(msgs[0].content, /Divine Comedy/);
    assert.match(msgs[0].content, /Father Matteo/);
    assert.equal(msgs[1].content, 'Кто охраняет восьмой круг ада у Данте?');
});
