import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { findBundleCollisions, resolveBundleFiles, scanTopLevelNames, TAVO_BUNDLES } from '../scripts/bundles.mjs';
import { dirSetNote, dirToggle } from '../src/core/director.js';
import { createRpStudioController } from '../src/core/hud.js';
import { EN_CATALOG, RU_CATALOG } from '../src/core/localesData.js';
import { phoneCreateStore, phoneIngestEvents } from '../src/core/phone.js';
import { applyTurnExtraction, createChatState } from '../src/core/physiology.js';
import { tnEstimateTokens } from '../src/core/textnorm.js';
import { wikiApplyPatch, wikiCreateStore, wikiView } from '../src/core/wiki.js';
import { initializeSillyTavern, stTurnKey, stTurnKeyIsDead } from '../src/st/adapter.js';

const root = fileURLToPath(new URL('../', import.meta.url));

class FakeElement {
    constructor(doc, tag) {
        this.ownerDocument = doc;
        this.tagName = tag.toUpperCase();
        this.className = '';
        this.style = {};
        this.dataset = {};
        this.attributes = {};
        this.childNodes = [];
        this.listeners = new Map();
        this.hidden = false;
        this.value = '';
        this.checked = false;
        this.textContent = '';
    }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k] ?? null; }
    removeAttribute(k) { delete this.attributes[k]; }
    addEventListener(type, fn) {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
    }
    dispatch(type, event = {}) {
        for (const fn of this.listeners.get(type) ?? []) {
            fn({ target: this, currentTarget: this, ...event });
        }
    }
    append(...nodes) {
        for (const n of nodes) {
            if (n !== null && n !== undefined) this.childNodes.push(n);
        }
    }
    replaceChildren(...nodes) {
        this.childNodes = [];
        this.append(...nodes);
    }
    remove() {}
    getBoundingClientRect() { return { left: 100, top: 20, width: 240, height: 36 }; }
}

function makeFakeDoc() {
    const doc = {
        defaultView: {
            innerWidth: 390,
            innerHeight: 844,
            addEventListener() {},
            removeEventListener() {},
        },
        createElement(tag) { return new FakeElement(doc, tag); },
        createTextNode(txt) { return { nodeType: 3, textContent: String(txt) }; },
    };
    doc.body = new FakeElement(doc, 'body');
    return doc;
}

function collectText(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.textContent;
    return (node.textContent || '') + (node.childNodes ?? []).map(collectText).join(' ');
}

test('Bundled Tavo entry.js injects system context in generation:prepare and rolls back on message:deleted', async () => {
    const entryCode = await readFile(resolve(root, 'tavo/entry.js'), 'utf8');
    const handlers = new Map();
    const emitted = [];
    const store = new Map();

    const mockTavo = {
        plugin: {
            config: {
                get(key) {
                    const defaults = { enableVitals: true, enableAdultBio: true, injectContext: true };
                    return defaults[key] ?? null;
                },
            },
            on(type, fn) { handlers.set(type, fn); return () => {}; },
            onInputAction(id, fn) { handlers.set(`input:${id}`, fn); },
            onSidebarAction(id, fn) { handlers.set(`sidebar:${id}`, fn); },
            onLastMessageAction(id, fn) { handlers.set(`last:${id}`, fn); },
            emit(type, data) { emitted.push({ type, data }); },
        },
        variable: {
            async get(name, scope = 'chat') { return store.get(`${scope}:${name}`) ?? null; },
            async set(name, val, scope = 'chat') { store.set(`${scope}:${name}`, structuredClone(val)); },
        },
        chat: {
            async current() {
                return {
                    id: 7,
                    characters: [{ id: 1, name: 'Vergil' }],
                    persona: { id: 2, name: 'Dante' },
                };
            },
        },
    };

    const sandbox = vm.createContext({
        tavo: mockTavo,
        structuredClone,
        Math,
        Number,
        String,
        Boolean,
        Array,
        Object,
        Date,
        RegExp,
        JSON,
    });
    new vm.Script(entryCode, { filename: 'tavo/entry.js' }).runInContext(sandbox);

    assert.ok(handlers.has('generation:prepare'), 'generation:prepare hook registered');
    assert.ok(handlers.has('message:added'), 'message:added hook registered');
    assert.ok(handlers.has('message:deleted'), 'message:deleted hook registered');

    const addedContexts = [];
    await handlers.get('generation:prepare')({
        addContext(ctx) { addedContexts.push(ctx); },
    });
    assert.equal(addedContexts.length, 1);
    assert.equal(addedContexts[0].role, 'system');
    assert.match(addedContexts[0].text, /\[CLODEx RP Studio — Active Scene & Physiology State\]/);
    assert.match(addedContexts[0].text, /Vergil/);
    assert.match(addedContexts[0].text, /Pulse ~72 bpm/);

    await handlers.get('message:added')({ message: { id: 'm-42', role: 'assistant' } });
    assert.deepEqual(JSON.parse(JSON.stringify(emitted.at(-1))), {
        type: 'clodex-assistant-turn',
        data: { messageId: 'm-42', turnKey: 'm-42:0' },
    });
    // Same turn delivered twice (e.g. added + regenerated signal) commits once.
    await handlers.get('message:added')({ message: { id: 'm-42', role: 'assistant' } });
    assert.equal(emitted.filter(e => e.type === 'clodex-assistant-turn').length, 1);
});

test('HUD Controller renders all 4 tabs, switches RU/EN locales cleanly, syncs tracker, and generates Nano Banana background', async () => {
    const doc = makeFakeDoc();
    let locale = 'ru';
    let localeListener = null;
    let state = createChatState('2026-11-18');
    const settings = {
        apiKey: 'sk-live_clodex_demo_key',
        trackerModel: '',
        codexModel: '',
        imageModel: '',
        videoModel: '',
        autoTrack: true,
        injectContext: true,
        confirmPaid: false,
        autoImageEvery: 0,
        bgDim: 35,
    };
    let appliedBg = '';

    // 1x1 transparent PNG base64
    const tinyPngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    const mockFetch = async url => {
        const u = String(url);
        if (u.endsWith('/v1/models')) {
            return new Response(JSON.stringify({
                data: [
                    { id: 'gemini-2.5-flash-lite' },
                    { id: 'mistral-large-latest' },
                    { id: 'gemini-2.5-flash-image-nano-banana' },
                    { id: 'kling-video-v2' },
                ],
            }), { status: 200 });
        }
        if (u.endsWith('/api/usage/token/')) {
            return new Response(JSON.stringify({
                data: { total_available: 1_000_000, quota_per_unit: 500_000, wallet_balance_usd: 9.75, usd_to_rub: 95 },
            }), { status: 200 });
        }
        if (u.endsWith('/api/pricing') || u.endsWith('/api/status')) {
            return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        if (u.endsWith('/v1/chat/completions')) {
            return new Response(JSON.stringify({
                choices: [{
                    message: {
                        content: JSON.stringify({
                            daysElapsed: 1,
                            timeOfDay: 'night',
                            location: 'Cathedral Choir',
                            entities: { char: { heartRate: 112, respiration: 'rapid' } },
                        }),
                    },
                }],
            }), { status: 200 });
        }
        if (u.endsWith('/v1/images/generations')) {
            return new Response(JSON.stringify({ data: [{ b64_json: tinyPngB64 }] }), { status: 200 });
        }
        throw new Error(`Unexpected fetch URL: ${u}`);
    };

    const controller = createRpStudioController({
        document: doc,
        fetchImpl: mockFetch,
        mountContainer: doc.body,
        getLocale: () => locale,
        t(key, params = {}) {
            const cat = locale === 'ru' ? RU_CATALOG : EN_CATALOG;
            return String(cat[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => String(params[k] ?? m));
        },
        onLocaleChange(cb) { localeListener = cb; return () => {}; },
        confirm: async () => true,
        getEffectiveKey: () => settings.apiKey,
        getSettings: () => settings,
        async updateSettings(patch) { Object.assign(settings, patch); },
        getChatState: () => state,
        async saveChatState(next) { state = next; },
        async getRpContext() {
            return {
                chatId: 'c1',
                userName: 'Player',
                charName: 'Father Lorenzo',
                charDescription: 'Tattooed exorcist priest',
                scenario: 'Midnight ritual',
                recentMessages: [{ role: 'assistant', name: 'Father Lorenzo', content: 'He raises the silver cross.' }],
            };
        },
        async insertIntoComposer() {},
        async applyImageBackground() {
            appliedBg = 'files/chat/clodex-rp-bg-a.png';
            return appliedBg;
        },
        async applyVideoBackground() { return 'files/chat/clodex-rp-bg-a.mp4'; },
    });

    await controller.refreshAccount();
    assert.equal(settings.imageModel, 'gemini-2.5-flash-image-nano-banana');
    assert.equal(settings.codexModel, 'mistral-large-latest');

    // Sync tracker via AI
    await controller.syncTrackerFromChat({ checkpointKey: 'turn-1' });
    assert.equal(state.world.rpDate, '2026-11-19');
    assert.equal(state.world.location, 'Cathedral Choir');
    assert.equal(state.entities.char.vitals.heartRate, 112);

    // Generate Nano Banana background
    await controller.generateSceneBackground({ auto: false });
    assert.equal(appliedBg, 'files/chat/clodex-rp-bg-a.png');
    assert.equal(state.scene.imagePath, 'files/chat/clodex-rp-bg-a.png');

    // Open all 4 tabs and switch RU -> EN dynamically
    for (const tab of ['tracker', 'codex', 'scene', 'account']) {
        controller.openTab(tab);
    }
    assert.match(collectText(doc.body), /Ключ CLODEx/);
    locale = 'en';
    localeListener?.();
    assert.match(collectText(doc.body), /CLODEx API Key/);

    controller.dispose();
});

test('Bundled Tavo ui/hud.js boots in VM, responds to clodex-command, and rotates background files', async () => {
    const hudCode = await readFile(resolve(root, 'tavo/ui/hud.js'), 'utf8');
    const doc = makeFakeDoc();
    const mountDiv = new FakeElement(doc, 'div');
    doc.getElementById = id => (id === 'clodex-rp-tavo-mount' ? mountDiv : null);

    const pluginListeners = new Map();
    const savedFiles = [];
    let updatedBg = null;

    const mockTavo = {
        plugin: {
            i18n: {
                locale: 'ru',
                t: (k, params = {}) => String(RU_CATALOG[k] ?? k).replace(/\{(\w+)\}/g, (m, p) => String(params[p] ?? m)),
                onChange: () => () => {},
            },
            config: {
                get: k => (k === 'apiKey' ? 'sk-tavo_key_123456' : k === 'confirmPaid' ? false : true),
            },
            on(type, fn) { pluginListeners.set(type, fn); return () => {}; },
        },
        variable: {
            async get() { return null; },
            async set() {},
        },
        chat: {
            async current() { return { id: 1, characters: [{ id: 2, name: 'Beatrice' }], persona: { name: 'Dante' } }; },
            async update(patch) { updatedBg = patch.background; },
        },
        message: {
            async find() { return [{ role: 'assistant', content: 'Welcome to Paradiso.' }]; },
        },
        file: {
            async save(name) { savedFiles.push(name); return `files/chat/${name}`; },
            async delete() {},
            async exists() { return false; },
        },
        input: { async append() {} },
        ui: {
            getInsets: () => ({ topBar: 44, bottomInput: 64 }),
            onInsetsChanged: () => () => {},
        },
    };

    const tinyPngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const mockFetch = async url => {
        const u = String(url);
        if (u.endsWith('/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'gemini-2.5-flash-image-nano-banana' }, { id: 'gemini-2.5-flash-lite' }] }), { status: 200 });
        if (u.endsWith('/api/usage/token/')) return new Response(JSON.stringify({ data: { total_available: 100, quota_per_unit: 100, wallet_balance_usd: 5 } }), { status: 200 });
        if (u.endsWith('/api/pricing') || u.endsWith('/api/status')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
        if (u.endsWith('/v1/chat/completions')) return new Response(JSON.stringify({ choices: [{ message: { content: 'A gothic cathedral.' } }] }), { status: 200 });
        if (u.endsWith('/v1/images/generations')) return new Response(JSON.stringify({ data: [{ b64_json: tinyPngB64 }] }), { status: 200 });
        throw new Error(`Unexpected URL: ${u}`);
    };

    const sandbox = vm.createContext({
        tavo: mockTavo,
        document: doc,
        fetch: mockFetch,
        Headers,
        Response,
        Blob,
        URL,
        AbortController,
        DOMException,
        Intl,
        atob,
        btoa,
        setTimeout,
        clearTimeout,
        structuredClone,
        confirm: () => true,
        Math, Number, String, Boolean, Array, Object, Date, RegExp, JSON, Promise, Uint8Array,
    });
    sandbox.globalThis = sandbox;
    new vm.Script(hudCode, { filename: 'tavo/ui/hud.js' }).runInContext(sandbox);

    // Allow async bootstrap to settle
    await new Promise(r => setTimeout(r, 30));
    assert.ok(mountDiv.childNodes.length > 0, 'Tavo HUD mounted into #clodex-rp-tavo-mount');
    assert.ok(pluginListeners.has('clodex-command'));

    await pluginListeners.get('clodex-command')({ action: 'generate-bg' });
    assert.equal(savedFiles[0], 'clodex-rp-bg-a.png');
    assert.equal(updatedBg?.image, 'files/chat/clodex-rp-bg-a.png');
});

test('SillyTavern adapter auto-inherits key from SillyTavern-CLODEx and injects extension prompt', async () => {
    const doc = makeFakeDoc();
    const extContainer = new FakeElement(doc, 'div');
    doc.querySelector = sel => (sel === '#extensions_settings' ? extContainer : null);
    doc.body.prepend = (...n) => doc.body.append(...n);
    doc.createElement = tag => {
        if (tag === 'template') {
            return {
                set innerHTML(_v) {},
                content: {
                    firstElementChild: Object.assign(new FakeElement(doc, 'div'), {
                        querySelectorAll: () => [],
                    }),
                },
            };
        }
        return new FakeElement(doc, tag);
    };

    const prompts = new Map();
    const stContext = {
        chatId: 'chat-st-1',
        name1: 'Player',
        name2: ' Beatrice ',
        characterId: 0,
        characters: [{ name: 'Beatrice', description: 'Guide through Paradise', scenario: 'Ascent' }],
        chat: [{ is_user: false, is_system: false, name: 'Beatrice', mes: 'Follow the light.' }],
        chatMetadata: {},
        extensionSettings: {
            clodex: { savedKey: 'sk-inherited_from_st_clodex' },
        },
        getCurrentLocale: () => 'ru-RU',
        setExtensionPrompt(key, value) { prompts.set(key, value); },
        saveSettingsDebounced() {},
        saveMetadataDebounced() {},
    };

    const enRaw = await readFile(resolve(root, 'i18n/en-us.json'), 'utf8');
    const ruRaw = await readFile(resolve(root, 'i18n/ru-ru.json'), 'utf8');
    const settingsHtml = await readFile(resolve(root, 'settings.html'), 'utf8');

    const app = await initializeSillyTavern({
        getContext: () => stContext,
        document: doc,
        confirm: () => true,
        fetchImpl: async url => {
            const u = String(url);
            if (u.endsWith('settings.html')) return new Response(settingsHtml, { status: 200 });
            if (u.endsWith('en-us.json')) return new Response(enRaw, { status: 200 });
            if (u.endsWith('ru-ru.json')) return new Response(ruRaw, { status: 200 });
            if (u.endsWith('/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'gemini-2.5-flash-lite' }] }), { status: 200 });
            return new Response(JSON.stringify({ data: [] }), { status: 200 });
        },
    });

    assert.ok(app, 'SillyTavern app initialized');
    assert.match(prompts.get('clodex_rp_studio_context') ?? '', /Pulse ~72 bpm/);
    app.dispose();
    assert.equal(prompts.get('clodex_rp_studio_context'), '');
});

// ---------------------------------------------------------------------------
// v1.3 «Director & Living World» platform runtime tests
// ---------------------------------------------------------------------------

function sliceRange(list, [from, to]) {
    const n = list.length;
    const a = from < 0 ? Math.max(0, n + from) : from;
    const b = to < 0 ? n + to : to;
    return list.slice(a, b + 1);
}

function makeEntrySandbox({ messages = [], store = new Map(), prefs = null } = {}) {
    const handlers = new Map();
    const emitted = [];
    if (prefs) store.set('global:clodex_rp_prefs', structuredClone(prefs));
    const mockTavo = {
        plugin: {
            config: {
                get(key) {
                    const defaults = { enableVitals: true, enableAdultBio: true, injectContext: true };
                    return defaults[key] ?? null;
                },
            },
            on(type, fn) { handlers.set(type, fn); return () => {}; },
            onInputAction(id, fn) { handlers.set(`input:${id}`, fn); },
            onSidebarAction(id, fn) { handlers.set(`sidebar:${id}`, fn); },
            onLastMessageAction(id, fn) { handlers.set(`last:${id}`, fn); },
            emit(type, data) { emitted.push({ type, data }); },
        },
        variable: {
            async get(name, scope = 'chat') { return structuredClone(store.get(`${scope}:${name}`) ?? null); },
            async set(name, val, scope = 'chat') { store.set(`${scope}:${name}`, structuredClone(val)); },
        },
        chat: {
            async current() {
                return { id: 7, characters: [{ id: 1, name: 'Vergil' }], persona: { id: 2, name: 'Dante' } };
            },
        },
        message: {
            async find(range) { return structuredClone(sliceRange(messages, range)); },
            async get(id) { return structuredClone(messages.find(m => m.id === id) ?? null); },
        },
    };
    const sandbox = vm.createContext({
        tavo: mockTavo, structuredClone, Math, Number, String, Boolean, Array, Object, Date, RegExp, JSON, Set, Map, Promise,
    });
    return { sandbox, handlers, emitted, store };
}

test('Bundled Tavo entry.js: generation:prepare packs main + depth0 through ctxPack within 250 tokens', async () => {
    const entryCode = await readFile(resolve(root, 'tavo/entry.js'), 'utf8');
    const messages = [
        { id: 'm-1', role: 'user', swipeId: 0, content: 'Dante asks Vergil about the Tower and Lady Mary.' },
        { id: 'm-2', role: 'assistant', swipeId: 0, content: 'Vergil glances toward the Temen-ni-gru tower where Mary waits.' },
    ];
    const store = new Map();

    const state = createChatState('2026-11-18');
    state.world.enableAdultBiology = true;
    dirToggle(state, 'suspense');
    dirToggle(state, 'twist');
    dirSetNote(state, 'Let the storm outside mirror the brothers\u2019 rivalry; Mary must interrupt them at the worst moment possible ok');
    state.world.slopRule = `Style variety: find fresh phrasing instead of repeating: ${Array.from({ length: 6 }, (_, i) => `«a shiver ran down spine number ${i}»`).join(', ')}.`;
    store.set('chat:clodex_rp_state', state);

    const wiki = wikiCreateStore();
    wikiApplyPatch(wiki, {
        upsert: [
            ...Array.from({ length: 14 }, (_, i) => ({ table: 'npcs', name: i === 0 ? 'Vergil' : `Mary ${i}`, role: 'demon hunter and reluctant ally of the twins', attitude: 'wary but loyal', appearance: 'red coat, silver hair, very long description of scars and tattoos' })),
            { table: 'places', name: 'Temen-ni-gru', description: 'A demonic tower risen from the earth, full of traps and old ghosts' },
            { table: 'quests', title: 'Climb the Tower', status: 'active', note: 'Reach the top before Arkham completes the ritual' },
        ],
    }, 'm-2:0', wikiView(wiki, []));
    store.set('chat:clodex_rp_wiki', wiki);

    const { sandbox, handlers } = makeEntrySandbox({ messages, store });
    new vm.Script(entryCode, { filename: 'tavo/entry.js' }).runInContext(sandbox);
    assert.ok(handlers.has('sidebar:open-phone'), 'open-phone sidebar action registered');

    const added = [];
    await handlers.get('generation:prepare')({ addContext(ctx) { added.push(JSON.parse(JSON.stringify(ctx))); } });
    assert.equal(added.length, 2, 'exactly two addContext calls (main + depth0)');
    const main = added.find(c => c.position?.type === 'afterMainPrompt');
    const depth0 = added.find(c => c.position?.type === 'atDepth');
    assert.ok(main && depth0);
    assert.equal(depth0.position.depth, 0);
    assert.equal(main.role, 'system');
    assert.match(main.text, /Vergil/);
    assert.match(depth0.text, /\[Director:/);
    const total = tnEstimateTokens(main.text) + tnEstimateTokens(depth0.text);
    assert.ok(total <= 250, `context addition must be ≤ 250 tokens, got ${total}`);

    // Disabled anti-slop + no director → only the main block is injected.
    const quiet = createChatState('2026-11-18');
    quiet.world.slopRule = 'Style variety: find fresh phrasing instead of repeating: «x y».';
    store.set('chat:clodex_rp_state', quiet);
    store.set('global:clodex_rp_prefs', { slopMode: 'highlight' });
    const second = [];
    await handlers.get('generation:prepare')({ addContext(ctx) { second.push(ctx); } });
    assert.equal(second.length, 1);
    assert.equal(second[0].position.type, 'afterMainPrompt');
});

test('Bundled Tavo entry.js: swipe A → B → A restores exact variant snapshots and keeps the director cue', async () => {
    const entryCode = await readFile(resolve(root, 'tavo/entry.js'), 'utf8');
    const messages = [
        { id: 'm-1', role: 'assistant', swipeId: 0, content: 'Hall' },
        { id: 'm-2', role: 'assistant', swipeId: 0, content: 'A' },
    ];
    const store = new Map();
    const state = createChatState('2026-11-18');
    applyTurnExtraction(state, { location: 'Hall' }, { checkpointKey: 'm-1:0' });
    applyTurnExtraction(state, { location: 'Crypt A' }, { checkpointKey: 'm-2:0' });
    store.set('chat:clodex_rp_state', state);

    const { sandbox, handlers } = makeEntrySandbox({ messages, store });
    new vm.Script(entryCode, { filename: 'tavo/entry.js' }).runInContext(sandbox);

    // Swipe to a brand-new variant B: no exact snapshot → roll back before the turn.
    messages[1] = { id: 'm-2', role: 'assistant', swipeId: 1, content: 'B' };
    await handlers.get('message:updated')({ message: messages[1] });
    let saved = store.get('chat:clodex_rp_state');
    assert.equal(saved.world.location, 'Hall');

    // Tracker runs for B (as the HUD would), then the player enables a director modifier.
    applyTurnExtraction(saved, { location: 'Tower B' }, { checkpointKey: 'm-2:1' });
    dirToggle(saved, 'twist');
    store.set('chat:clodex_rp_state', saved);

    // Swipe back to A: exact snapshot of A, director cue survives the restore.
    messages[1] = { id: 'm-2', role: 'assistant', swipeId: 0, content: 'A' };
    await handlers.get('message:updated')({ message: messages[1] });
    saved = store.get('chat:clodex_rp_state');
    assert.equal(saved.world.location, 'Crypt A');
    assert.deepEqual([...saved.world.director.activeIds], ['twist']);

    // And forward to B again.
    messages[1] = { id: 'm-2', role: 'assistant', swipeId: 1, content: 'B' };
    await handlers.get('message:updated')({ message: messages[1] });
    assert.equal(store.get('chat:clodex_rp_state').world.location, 'Tower B');
});

test('Bundled Tavo entry.js: message:deleted garbage-collects phone/wiki journal ops of that message only', async () => {
    const entryCode = await readFile(resolve(root, 'tavo/entry.js'), 'utf8');
    const messages = [
        { id: 'm-1', role: 'assistant', swipeId: 0, content: 'one' },
        { id: 'm-5', role: 'assistant', swipeId: 0, content: 'five' },
    ];
    const store = new Map();
    const phone = phoneCreateStore();
    phoneIngestEvents(phone, [{ kind: 'note', author: 'Vergil', text: 'Power. I need more power.' }], 'm-1:0');
    phoneIngestEvents(phone, [{ kind: 'feed', author: 'Forum', text: 'Who rang the tower bell?' }], 'm-5:0');
    phoneIngestEvents(phone, [{ kind: 'dm', author: 'Vergil', text: 'Alternative branch' }], 'm-5:1');
    store.set('chat:clodex_rp_phone', phone);

    const { sandbox, handlers, emitted } = makeEntrySandbox({ messages, store });
    new vm.Script(entryCode, { filename: 'tavo/entry.js' }).runInContext(sandbox);

    messages.pop();
    await handlers.get('message:deleted')({ message: { id: 'm-5' } });
    const after = store.get('chat:clodex_rp_phone');
    const keys = after.journal.map(op => op.turnKey);
    assert.ok(keys.includes('m-1:0'));
    assert.ok(!keys.some(k => k.startsWith('m-5:')), 'all variants of the deleted message are collected');
    assert.equal(emitted.at(-1).type, 'clodex-state-updated');
});

function makeTurnDoc() {
    const doc = makeFakeDoc();
    const mount = new FakeElement(doc, 'div');
    doc.getElementById = id => (id === 'clodex-rp-turn-mount' ? mount : null);
    return { doc, mount };
}

function findAll(node, pred, out = []) {
    if (!node || typeof node !== 'object') return out;
    if (pred(node)) out.push(node);
    for (const child of node.childNodes ?? []) findAll(child, pred, out);
    return out;
}

test('Bundled Tavo ui/turn.js renders hidden thoughts + action buttons only for the matching variant', async () => {
    const turnCode = await readFile(resolve(root, 'tavo/ui/turn.js'), 'utf8');
    assert.ok(!/innerHTML/.test(turnCode), 'turn.js must never use innerHTML');
    const turnHtml = await readFile(resolve(root, 'tavo/ui/turn.html'), 'utf8');
    assert.match(turnHtml, /ui\/turn\.js/);
    const manifest = JSON.parse(await readFile(resolve(root, 'tavo/manifest.json'), 'utf8'));
    assert.ok(manifest.contributes.htmlFragments.some(f => f.src === 'ui/turn.html' && f.mount === '/messages/end?role=character&position=last'));

    const { doc, mount } = makeTurnDoc();
    const listeners = new Map();
    const appended = [];
    const messages = [
        { id: 'm-8', role: 'user', content: 'hi' },
        { id: 'm-9', role: 'assistant', swipeId: 1, content: 'reply B' },
    ];
    const state = createChatState('2026-11-18');
    state.turnExtras = {
        turnKey: 'm-9:1',
        innerThought: '<img src=x onerror=alert(1)> He is terrified she will leave.',
        suggestedActions: ['Take his hand', 'Ask about the scar', 'Leave in silence'],
    };
    const vars = new Map([['chat:clodex_rp_state', structuredClone(state)], ['global:clodex_rp_prefs', { thoughtsBlurred: true }]]);
    const mockTavo = {
        plugin: {
            i18n: {
                locale: 'ru',
                t: (k, params = {}) => String(RU_CATALOG[k] ?? k).replace(/\{(\w+)\}/g, (m, p) => String(params[p] ?? m)),
                onChange: () => () => {},
            },
            config: { get: () => null },
            on(type, fn) { listeners.set(type, fn); return () => {}; },
        },
        variable: {
            async get(name, scope = 'chat') { return structuredClone(vars.get(`${scope}:${name}`) ?? null); },
            async set() {},
        },
        chat: { async current() { return { characters: [{ name: 'Vergil' }] }; } },
        message: {
            async find(range) { return structuredClone(sliceRange(messages, range)); },
            async get(id) { return structuredClone(messages.find(m => m.id === id) ?? null); },
        },
        input: { async append(text) { appended.push(text); } },
    };
    const sandbox = vm.createContext({
        tavo: mockTavo, document: doc, Math, Number, String, Boolean, Array, Object, Date, RegExp, JSON, Promise, Set, Map,
    });
    sandbox.globalThis = sandbox;
    new vm.Script(turnCode, { filename: 'tavo/ui/turn.js' }).runInContext(sandbox);
    await new Promise(r => setTimeout(r, 20));

    assert.equal(mount.hidden, false);
    const details = findAll(mount, n => n.tagName === 'DETAILS');
    assert.equal(details.length, 1);
    assert.equal(details[0].open, false, 'spoiler is closed when thoughtsBlurred');
    assert.match(collectText(mount), /Vergil/);
    assert.match(collectText(mount), /terrified she will leave/);
    const buttons = findAll(mount, n => n.tagName === 'BUTTON');
    assert.equal(buttons.length, 3);
    buttons[1].dispatch('click');
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(appended, ['Ask about the scar'], 'button appends to composer without sending');

    // Swipe to another variant: stale extras must disappear.
    messages[1] = { id: 'm-9', role: 'assistant', swipeId: 2, content: 'reply C' };
    await listeners.get('message:updated')?.({ message: messages[1] });
    await new Promise(r => setTimeout(r, 20));
    assert.equal(mount.hidden, true);
    assert.equal(mount.childNodes.length, 0);

    // Extras for the new variant arrive → rendered again.
    const next = structuredClone(state);
    next.turnExtras = { turnKey: 'm-9:2', innerThought: '', suggestedActions: ['Smile'] };
    vars.set('chat:clodex_rp_state', next);
    await listeners.get('clodex-turn-extras')?.({ turnKey: 'm-9:2' });
    await new Promise(r => setTimeout(r, 20));
    assert.equal(findAll(mount, n => n.tagName === 'DETAILS').length, 0, 'no thoughts block without innerThought');
    assert.equal(findAll(mount, n => n.tagName === 'BUTTON').length, 1);
});

test('SillyTavern adapter: depth-0 director prompt, unified turn keys, M3 under the last .mes, journal GC on delete', async () => {
    const doc = makeFakeDoc();
    const extContainer = new FakeElement(doc, 'div');
    const mesEl = new FakeElement(doc, 'div');
    const textEl = new FakeElement(doc, 'div');
    let inserted = null;
    textEl.after = node => { inserted = node; };
    mesEl.attributes.mesid = '1';
    mesEl.querySelector = sel => (sel === '.mes_text' ? textEl : null);
    doc.querySelector = sel => (sel === '#extensions_settings' ? extContainer : null);
    doc.querySelectorAll = sel => (sel === '#chat .mes' ? [mesEl] : []);
    doc.getElementById = id => (id === 'clodex-rp-st-turn' ? inserted : null);
    doc.body.prepend = (...n) => doc.body.append(...n);
    doc.createElement = tag => {
        if (tag === 'template') {
            return {
                set innerHTML(_v) {},
                content: { firstElementChild: Object.assign(new FakeElement(doc, 'div'), { querySelectorAll: () => [] }) },
            };
        }
        const node = new FakeElement(doc, tag);
        node.remove = () => { if (inserted === node) inserted = null; };
        return node;
    };

    const chat = [
        { is_user: true, is_system: false, name: 'Player', mes: 'Where is Beatrice?', send_date: 'Nov 18, 2026 10:00pm', swipe_id: 0 },
        { is_user: false, is_system: false, name: 'Beatrice', mes: 'Follow the light.', send_date: 'Nov 18, 2026 10:01pm', swipe_id: 0,
            swipe_info: [{ send_date: 'Nov 18, 2026 10:01pm' }] },
    ];
    const state = createChatState('2026-11-18');
    dirToggle(state, 'slow');
    state.turnExtras = { turnKey: stTurnKey(1, chat[1]), innerThought: 'She fears the light will fail him.', suggestedActions: ['Take her hand', 'Look up'] };
    const phone = phoneCreateStore();
    phoneIngestEvents(phone, [{ kind: 'note', author: 'Beatrice', text: 'Kept for the living turn' }], stTurnKey(1, chat[1]));
    phoneIngestEvents(phone, [{ kind: 'note', author: 'Beatrice', text: 'From a deleted turn' }], '2:0#zzz');

    const prompts = new Map();
    const listeners = new Map();
    const commands = [];
    const stContext = {
        chatId: 'chat-st-2',
        name1: 'Player',
        name2: 'Beatrice',
        characterId: 0,
        characters: [{ name: 'Beatrice', description: 'Guide through Paradise', scenario: 'Ascent' }],
        chat,
        chatMetadata: { clodex_rp_studio: state, clodex_rp_phone: phone },
        extensionSettings: { clodex: { savedKey: 'sk-inherited_from_st_clodex' } },
        event_types: { MESSAGE_DELETED: 'message_deleted', MESSAGE_SWIPED: 'message_swiped', CHAT_CHANGED: 'chat_changed' },
        eventSource: { on(type, fn) { listeners.set(type, fn); }, removeListener() {} },
        getCurrentLocale: () => 'ru-RU',
        setExtensionPrompt(key, value, position, depth) { prompts.set(key, { value, position, depth }); },
        registerSlashCommand(name) { commands.push(name); },
        saveSettingsDebounced() {},
        saveMetadataDebounced() {},
    };

    const enRaw = await readFile(resolve(root, 'i18n/en-us.json'), 'utf8');
    const ruRaw = await readFile(resolve(root, 'i18n/ru-ru.json'), 'utf8');
    const settingsHtml = await readFile(resolve(root, 'settings.html'), 'utf8');
    const app = await initializeSillyTavern({
        getContext: () => stContext,
        document: doc,
        confirm: () => true,
        fetchImpl: async url => {
            const u = String(url);
            if (u.endsWith('settings.html')) return new Response(settingsHtml, { status: 200 });
            if (u.endsWith('en-us.json')) return new Response(enRaw, { status: 200 });
            if (u.endsWith('ru-ru.json')) return new Response(ruRaw, { status: 200 });
            return new Response(JSON.stringify({ data: [] }), { status: 200 });
        },
    });

    const depth0 = prompts.get('clodex_rp_studio_depth0');
    assert.ok(depth0, 'depth-0 extension prompt registered');
    assert.equal(depth0.depth, 0);
    assert.match(depth0.value, /\[Director:/);
    const main = prompts.get('clodex_rp_studio_context');
    assert.equal(main.depth, 1);
    assert.ok(tnEstimateTokens(main.value) + tnEstimateTokens(depth0.value) <= 250);

    for (const name of ['clodex-phone', 'clodex-wiki', 'clodex-director']) assert.ok(commands.includes(name), `/${name} registered`);

    const bridgeKey = await app.controller && stTurnKey(1, chat[1]);
    assert.match(bridgeKey, /^1:0#[0-9a-z]+$/);
    assert.equal(stTurnKeyIsDead(chat, bridgeKey), false);
    assert.equal(stTurnKeyIsDead(chat, '2:0#zzz'), true);
    assert.equal(stTurnKeyIsDead(chat, '1:0#other'), true, 'index shift detected via send_date hash');

    // M3 container rendered after .mes_text of the last character message, textContent only.
    assert.ok(inserted, 'turn extras container inserted');
    assert.equal(inserted.id, 'clodex-rp-st-turn');
    assert.match(collectText(inserted), /fears the light/);
    assert.equal(findAll(inserted, n => n.tagName === 'BUTTON').length, 2);

    // Delete from the tail (ST passes the new chat length): GC dead journal ops only.
    listeners.get('message_deleted')(2);
    const keys = stContext.chatMetadata.clodex_rp_phone.journal.map(op => op.turnKey);
    assert.deepEqual(keys, [stTurnKey(1, chat[1])]);

    // Swipe A -> B -> A via MESSAGE_SWIPED restores exact variant snapshots and preserves director cue
    const key1 = stTurnKey(1, chat[1]);
    applyTurnExtraction(stContext.chatMetadata.clodex_rp_studio, { location: 'Gate' }, { checkpointKey: key1 });
    chat.push({
        is_user: false, is_system: false, name: 'Beatrice', mes: 'Variant A',
        send_date: 'Nov 18, 2026 10:02pm', swipe_id: 0,
        swipe_info: [{ send_date: 'Nov 18, 2026 10:02pm' }, { send_date: 'Nov 18, 2026 10:03pm' }],
    });
    const key2A = stTurnKey(2, chat[2]);
    applyTurnExtraction(stContext.chatMetadata.clodex_rp_studio, { location: 'Sphere A' }, { checkpointKey: key2A });
    // Sync adapter's chatState with metadata as CHAT_CHANGED does
    listeners.get('chat_changed')();

    // Swipe to brand-new variant B → rolls back before turn 2 ('Gate') while keeping director cue
    chat[2].swipe_id = 1;
    chat[2].send_date = 'Nov 18, 2026 10:03pm';
    chat[2].mes = 'Variant B';
    listeners.get('message_swiped')(2);
    assert.equal(stContext.chatMetadata.clodex_rp_studio.world.location, 'Gate');
    assert.deepEqual(stContext.chatMetadata.clodex_rp_studio.world.director.activeIds, ['slow']);

    // Swipe back to existing variant A → restoreCheckpointExact restores 'Sphere A'
    chat[2].swipe_id = 0;
    chat[2].send_date = 'Nov 18, 2026 10:02pm';
    chat[2].mes = 'Variant A';
    listeners.get('message_swiped')(2);
    assert.equal(stContext.chatMetadata.clodex_rp_studio.world.location, 'Sphere A');

    // Delete message 2 → prune checkpoint 2 and roll back to 'Gate'
    chat.pop();
    listeners.get('message_deleted')(2);
    assert.equal(stContext.chatMetadata.clodex_rp_studio.world.location, 'Gate');
    assert.ok(!stContext.chatMetadata.clodex_rp_studio.checkpoints.some(cp => cp.key === key2A));

    app.dispose();
    assert.equal(prompts.get('clodex_rp_studio_depth0').value, '');
    assert.equal(inserted, null, 'turn container removed on dispose');
});

test('Bundled Tavo ui/hud.js handles open-phone, store load/save, phone media scope:chat and pack export', async () => {
    const hudCode = await readFile(resolve(root, 'tavo/ui/hud.js'), 'utf8');
    const doc = makeFakeDoc();
    const mountDiv = new FakeElement(doc, 'div');
    doc.getElementById = id => (id === 'clodex-rp-tavo-mount' ? mountDiv : null);

    const pluginListeners = new Map();
    const savedChatFiles = [];
    const exportedFiles = [];
    const vars = new Map();
    const phone = phoneCreateStore();
    phoneIngestEvents(phone, [{ kind: 'photo', author: 'Beatrice', text: 'Selfie', mediaPrompt: 'Golden light' }], 'm-1:0');
    vars.set('chat:clodex_rp_phone', phone);

    const tinyPngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const mockTavo = {
        plugin: {
            i18n: {
                locale: 'en',
                t: (k, params = {}) => String(EN_CATALOG[k] ?? k).replace(/\{(\w+)\}/g, (m, p) => String(params[p] ?? m)),
                onChange: () => () => {},
            },
            config: { get: k => (k === 'apiKey' ? 'sk-tavo_key_123456' : k === 'confirmPaid' ? false : true) },
            on(type, fn) { pluginListeners.set(type, fn); return () => {}; },
            emit() {},
        },
        variable: {
            async get(name, scope = 'chat') { return structuredClone(vars.get(`${scope}:${name}`) ?? null); },
            async set(name, val, scope = 'chat') { vars.set(`${scope}:${name}`, structuredClone(val)); },
        },
        chat: {
            async current() { return { id: 1, characters: [{ id: 2, name: 'Beatrice' }], persona: { name: 'Dante' } }; },
            async update() {},
        },
        message: {
            async find() { return [{ id: 'm-1', role: 'assistant', swipeId: 0, content: 'Look up.' }]; },
        },
        file: {
            async save(name, _data, opts) { savedChatFiles.push({ name, opts }); return `files/chat/${name}`; },
            async export(name, data, opts) { exportedFiles.push({ name, data, opts }); },
            async delete() {},
            async exists() { return false; },
        },
        input: { async append() {} },
        ui: { getInsets: () => ({ topBar: 44, bottomInput: 64 }), onInsetsChanged: () => () => {} },
    };

    const mockFetch = async url => {
        const u = String(url);
        if (u.endsWith('/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'gemini-2.5-flash-image-nano-banana' }, { id: 'gemini-2.5-flash-lite' }] }), { status: 200 });
        if (u.endsWith('/api/usage/token/')) return new Response(JSON.stringify({ data: { total_available: 100, quota_per_unit: 100, wallet_balance_usd: 5 } }), { status: 200 });
        if (u.endsWith('/api/pricing') || u.endsWith('/api/status')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
        if (u.endsWith('/v1/images/generations')) return new Response(JSON.stringify({ data: [{ b64_json: tinyPngB64 }] }), { status: 200 });
        throw new Error(`Unexpected URL: ${u}`);
    };

    const sandbox = vm.createContext({
        tavo: mockTavo, document: doc, fetch: mockFetch, Headers, Response, Blob, URL, AbortController, DOMException,
        Intl, atob, btoa, setTimeout, clearTimeout, structuredClone, confirm: () => true,
        Math, Number, String, Boolean, Array, Object, Date, RegExp, JSON, Promise, Uint8Array,
    });
    sandbox.globalThis = sandbox;
    new vm.Script(hudCode, { filename: 'tavo/ui/hud.js' }).runInContext(sandbox);
    await new Promise(r => setTimeout(r, 30));

    await pluginListeners.get('clodex-command')({ action: 'open-phone' });
    await new Promise(r => setTimeout(r, 20));
    const mediaBtn = findAll(mountDiv, n => n.dataset?.rpAction === 'phone-section' && n.dataset?.section === 'media')[0];
    assert.ok(mediaBtn, 'open-phone renders Phone sections including Media');
    mediaBtn.dispatch('click');
    const revealBtn = findAll(mountDiv, n => n.dataset?.rpAction === 'phone-reveal')[0];
    assert.ok(revealBtn, 'Media section renders Click-to-Reveal button');
    revealBtn.dispatch('click');
    await new Promise(r => setTimeout(r, 40));

    assert.equal(savedChatFiles.length, 1);
    assert.match(savedChatFiles[0].name, /^clodex-phone-ph-[0-9a-z]+\.png$/);
    assert.equal(savedChatFiles[0].opts.scope, 'chat');

    // Export pack through Packs screen
    await pluginListeners.get('clodex-command')({ action: 'open-forge' });
    const packsSub = findAll(mountDiv, n => n.dataset?.rpAction === 'forge-sub' && n.dataset?.sub === 'packs')[0];
    packsSub?.dispatch('click');
    const exportBtn = findAll(mountDiv, n => n.dataset?.rpAction === 'pack-export')[0];
    assert.ok(exportBtn, 'pack-export button present');
    exportBtn.dispatch('click');
    await new Promise(r => setTimeout(r, 20));
    assert.equal(exportedFiles.length, 1);
    assert.match(exportedFiles[0].name, /\.clodex-pack$/);
    const decoded = JSON.parse(Buffer.from(exportedFiles[0].data, 'base64').toString('utf8'));
    assert.equal(decoded.format, 'clodex-pack');
});

test('Bundler dependency resolver and collision gate (spec 10.8) cover every Tavo bundle', async () => {
    for (const { out, entry } of TAVO_BUNDLES) {
        const files = await resolveBundleFiles(root, entry);
        assert.ok(files.length >= 3, `${out} resolved modules`);
        const collisions = await findBundleCollisions(root, files);
        assert.deepEqual(collisions, [], `${out} has no top-level name collisions`);
    }
    const scanned = scanTopLevelNames('const fn = async () => {}, x = 2\nexport async function runIt() {}\nclass Demo {}');
    assert.deepEqual(scanned, ['fn', 'x', 'runIt', 'Demo']);
});
