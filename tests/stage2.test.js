import assert from 'node:assert/strict';
import test from 'node:test';

import { base64ToBlob } from '../src/core/api.js';
import { buildForgePromptMessages, parseForgedCardV2 } from '../src/core/forge.js';
import { createRpStudioController } from '../src/core/hud.js';
import { EN_CATALOG, RU_CATALOG } from '../src/core/localesData.js';
import { applyMeterPresetPack, applyTurnExtraction, createChatState, restoreCheckpointBefore } from '../src/core/physiology.js';
import { embedCharacterCardInPng, extractCharacterCardFromPng } from '../src/core/pngCard.js';
import { buildSystemContext, buildTrackerExtractionMessages } from '../src/core/prompts.js';
import { extractSpokenDialogue, isSafeVoiceId, normalizeVoices } from '../src/core/voice.js';

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('Voice module extracts spoken quotes and skips *asterisk actions*', () => {
    const rpSample = '*Медленно поднимает серебряный крест и делает шаг вперёд.* «Изыди во тьму, дух нечистый!» *Свечи дрожат на ветру.* «Тебе здесь нет власти.»';
    assert.equal(
        extractSpokenDialogue(rpSample, { dialogueOnly: true }),
        'Изыди во тьму, дух нечистый! Тебе здесь нет власти.',
    );

    const dashSample = '*Он хмурится.*\n— Подойди ближе, не бойся, — тихо произносит священник.';
    assert.equal(
        extractSpokenDialogue(dashSample, { dialogueOnly: true }),
        'Подойди ближе, не бойся',
    );

    const engSample = '*She exhales sharply.* "Stay behind me," *she whispers, drawing her blade.* "Now!"';
    assert.equal(
        extractSpokenDialogue(engSample, { dialogueOnly: true }),
        'Stay behind me, Now!',
    );

    assert.equal(isSafeVoiceId('eleven_bella_v2'), true);
    assert.equal(isSafeVoiceId('<script>alert(1)</script>'), false);
    const voices = normalizeVoices({ voices: [{ voice_id: 'v1', name: '<b>Matteo</b>', locale: 'it-IT' }] });
    assert.equal(voices[0].name, 'Matteo (v1)');
});

test('PNG Character Card V2 chunk injector & reader round-trips Unicode CCv2 + Lorebook', async () => {
    const rawBlob = base64ToBlob(TINY_PNG_B64, 'image/png');
    const rawBytes = new Uint8Array(await rawBlob.arrayBuffer());

    const forgeJson = JSON.stringify({
        name: 'Отец Маттео',
        description: 'Татуированный экзорцист ордена Святого Креста.',
        personality: 'Холодный, собранный, преданный.',
        scenario: 'Ночной обряд в соборе Флоренции.',
        first_mes: '*Свечи гаснут одна за другой.* «Ты опоздал.»',
        mes_example: '<START>\n{{user}}: Кто вы?\n{{char}}: «Тот, кто стоит между тобой и Восьмым кругом.»',
        system_prompt: 'Отыгрывай Маттео.',
        tags: ['dante', 'dark-romance'],
        avatarPrompt: 'Charismatic tattooed priest holding silver cross in candlelit gothic cathedral.',
        lorebookName: 'Кодекс Инферно',
        lorebook: [
            { comment: 'Восьмой круг (Злые Щели)', keys: ['восьмой круг', 'Malebolge'], content: 'Десять рвов обманщиков.' },
            { comment: 'Печать Ордена', keys: ['татуировка', 'печать'], content: 'Сдерживает древний обет.' },
        ],
    });

    const msgs = buildForgePromptMessages({ concept: 'Экзорцист по Данте', language: 'ru', loreCount: 2 });
    assert.equal(msgs.length, 2);

    const { card, avatarPrompt } = parseForgedCardV2(forgeJson);
    assert.equal(card.spec, 'chara_card_v2');
    assert.equal(card.data.name, 'Отец Маттео');
    assert.equal(card.data.character_book.entries.length, 2);
    assert.match(avatarPrompt, /tattooed priest/);

    const embedded = embedCharacterCardInPng(rawBytes, card);
    assert.ok(embedded.length > rawBytes.length);

    // Re-embedding replaces previous chara chunk rather than duplicating
    const reEmbedded = embedCharacterCardInPng(embedded, card);
    assert.equal(reEmbedded.length, embedded.length);

    const decoded = extractCharacterCardFromPng(reEmbedded);
    assert.deepEqual(decoded, card);
});

test('Custom Story Meters & Inventory update via AI extraction, inject into prompt, and roll back on swipe', () => {
    const state = createChatState('2026-11-18');
    applyMeterPresetPack(state, 'dark_romance', 'ru');
    assert.equal(state.customMeters.length, 3);
    assert.equal(state.customMeters[0].id, 'obsession');

    // Checkpoint 1
    applyTurnExtraction(state, {
        customMeters: { obsession: 30, trust: 10 },
        inventoryAdd: { char: ['Серебряный крест'], user: ['Старинный фолиант'] },
    }, { checkpointKey: 'turn-1' });

    assert.equal(state.customMeters.find(m => m.id === 'obsession').value, 30);
    assert.deepEqual(state.inventory.char, ['Серебряный крест']);

    const sysCtx = buildSystemContext(state, { userName: 'Игрок', charName: 'Маттео' });
    assert.match(sysCtx, /Одержимость: 30\/100/);
    assert.match(sysCtx, /Серебряный крест/);

    const extMsgs = buildTrackerExtractionMessages(state, [{ role: 'assistant', content: 'Тест' }]);
    assert.match(extMsgs[0].content, /"obsession": 30/);

    // Checkpoint 2 (dramatic spike + item lost)
    applyTurnExtraction(state, {
        customMeters: { obsession: 85, trust: -40 },
        inventoryRemove: { user: ['Старинный фолиант'] },
    }, { checkpointKey: 'turn-2' });

    assert.equal(state.customMeters.find(m => m.id === 'obsession').value, 85);
    assert.deepEqual(state.inventory.user, []);

    // Swipe / rollback turn-2 -> restores exact meters & inventory from turn-1!
    assert.equal(restoreCheckpointBefore(state, 'turn-2'), true);
    assert.equal(state.customMeters.find(m => m.id === 'obsession').value, 30);
    assert.equal(state.customMeters.find(m => m.id === 'trust').value, 10);
    assert.deepEqual(state.inventory.user, ['Старинный фолиант']);
});

test('End-to-end HUD v1.1: TTS sends dialogue-only text to /v1/audio/speech and Forge produces importable PNG card', async () => {
    class MiniEl {
        constructor(doc, tag) {
            this.ownerDocument = doc;
            this.tagName = tag;
            this.style = {};
            this.dataset = {};
            this.attributes = {};
            this.childNodes = [];
            this.listeners = new Map();
        }
        setAttribute(k, v) { this.attributes[k] = String(v); }
        getAttribute(k) { return this.attributes[k] ?? null; }
        removeAttribute(k) { delete this.attributes[k]; }
        addEventListener(type, fn) {
            const arr = this.listeners.get(type) ?? [];
            arr.push(fn);
            this.listeners.set(type, arr);
        }
        append(...nodes) { this.childNodes.push(...nodes.filter(Boolean)); }
        replaceChildren(...nodes) { this.childNodes = []; this.append(...nodes); }
        remove() {}
        getBoundingClientRect() { return { left: 20, top: 20, width: 220, height: 34 }; }
    }
    const doc = {
        defaultView: { innerWidth: 390, innerHeight: 844, addEventListener() {}, removeEventListener() {} },
        createElement(t) { return new MiniEl(doc, t); },
        createTextNode(txt) { return { nodeType: 3, textContent: String(txt) }; },
    };
    doc.body = new MiniEl(doc, 'body');

    let state = createChatState('2026-11-18');
    const settings = {
        apiKey: 'sk-stage2_test_key_999',
        trackerModel: 'gemini-2.5-flash-lite',
        codexModel: 'mistral-large-latest',
        imageModel: 'gemini-2.5-flash-image-nano-banana',
        videoModel: 'kling-v2',
        speechModel: 'eleven_multilingual_v2',
        defaultVoice: 'matteo_voice',
        dialogueOnly: true,
        autoSpeak: false,
        confirmPaid: false,
    };

    let sentSpeechBody = null;
    const mockFetch = async (url, init) => {
        const u = String(url);
        if (u.endsWith('/v1/models')) {
            return new Response(JSON.stringify({
                data: [
                    { id: 'gemini-2.5-flash-lite' },
                    { id: 'mistral-large-latest' },
                    { id: 'gemini-2.5-flash-image-nano-banana' },
                    { id: 'eleven_multilingual_v2' },
                ],
            }), { status: 200 });
        }
        if (u.endsWith('/api/usage/token/')) {
            return new Response(JSON.stringify({ data: { total_available: 100, quota_per_unit: 100, wallet_balance_usd: 10 } }), { status: 200 });
        }
        if (u.endsWith('/api/pricing') || u.endsWith('/api/status')) {
            return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        if (u.endsWith('/v1/audio/speech')) {
            sentSpeechBody = JSON.parse(init.body);
            return new Response(new Uint8Array([0x49, 0x44, 0x33, 0x03]), {
                status: 200,
                headers: { 'content-type': 'audio/mpeg' },
            });
        }
        if (u.endsWith('/v1/chat/completions')) {
            return new Response(JSON.stringify({
                choices: [{
                    message: {
                        content: JSON.stringify({
                            name: 'Vergil',
                            description: 'Poet guide',
                            personality: 'Wise',
                            scenario: 'Dark Wood',
                            first_mes: '"Follow me."',
                            avatarPrompt: 'Roman poet portrait',
                            lorebook: [{ comment: 'Limbo', keys: ['Limbo'], content: 'First circle.' }],
                        }),
                    },
                }],
            }), { status: 200 });
        }
        if (u.endsWith('/v1/images/generations')) {
            return new Response(JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }] }), { status: 200 });
        }
        throw new Error(`Unhandled URL: ${u}`);
    };

    const controller = createRpStudioController({
        document: doc,
        fetchImpl: mockFetch,
        mountContainer: doc.body,
        getLocale: () => 'ru',
        t: (k, p = {}) => String(RU_CATALOG[k] ?? EN_CATALOG[k] ?? k).replace(/\{(\w+)\}/g, (m, x) => String(p[x] ?? m)),
        confirm: async () => true,
        getEffectiveKey: () => settings.apiKey,
        getSettings: () => settings,
        async updateSettings(patch) { Object.assign(settings, patch); },
        getChatState: () => state,
        async saveChatState(next) { state = next; },
        async getRpContext() {
            return {
                chatId: 'c2',
                userName: 'Dante',
                charName: 'Matteo',
                charDescription: 'Exorcist',
                scenario: 'Cathedral',
                recentMessages: [{
                    role: 'assistant',
                    name: 'Matteo',
                    content: '*Поднимает серебряный крест.* «Vade retro, Satana!» *Пламя свечей вспыхивает.*',
                }],
            };
        },
        async insertIntoComposer() {},
        async saveSpeechAudio() { return 'files/chat/clodex-rp-tts-a.mp3'; },
    });

    await controller.refreshAccount();
    const audioPath = await controller.speakLatestReply({ auto: false });
    assert.equal(audioPath, 'files/chat/clodex-rp-tts-a.mp3');
    assert.equal(sentSpeechBody.input, 'Vade retro, Satana!');
    assert.equal(sentSpeechBody.voice, 'matteo_voice');

    // Open all 5 tabs including new Forge tab cleanly
    for (const tab of ['tracker', 'codex', 'scene', 'forge', 'account']) {
        controller.openTab(tab);
    }
    controller.dispose();
});
