import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { createRpStudioController } from '../src/core/hud.js';
import { EN_CATALOG, RU_CATALOG } from '../src/core/localesData.js';
import { createChatState } from '../src/core/physiology.js';
import { initializeSillyTavern } from '../src/st/adapter.js';

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
        data: { messageId: 'm-42' },
    });
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
