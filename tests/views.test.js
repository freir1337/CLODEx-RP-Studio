import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createRpStudioController } from '../src/core/hud.js';
import { EN_CATALOG, RU_CATALOG } from '../src/core/localesData.js';
import { packBuild } from '../src/core/pack.js';
import { phoneCreateStore, phoneIngestEvents } from '../src/core/phone.js';
import { createChatState } from '../src/core/physiology.js';
import { TRACKER_MAX_TOKENS } from '../src/core/prompts.js';
import { wikiCreateStore, wikiManualEdit } from '../src/core/wiki.js';

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function makeFakeDom() {
    class FakeText {
        constructor(text) {
            this.nodeType = 3;
            this.textContent = String(text);
            this.parentNode = null;
        }
        remove() {
            if (!this.parentNode) return;
            const idx = this.parentNode.childNodes.indexOf(this);
            if (idx >= 0) this.parentNode.childNodes.splice(idx, 1);
            this.parentNode = null;
        }
    }

    class FakeEl {
        constructor(doc, tag) {
            this.ownerDocument = doc;
            this.nodeType = 1;
            this.tagName = String(tag).toUpperCase();
            this.style = {};
            this.dataset = {};
            this.attributes = {};
            this.childNodes = [];
            this.listeners = new Map();
            this.parentNode = null;
            this.className = '';
            this.hidden = false;
            this.disabled = false;
            this.checked = false;
            this.selected = false;
            this.value = '';
            this.type = '';
            this.id = '';
            this.title = '';
            this.src = '';
            this.alt = '';
            this.rows = 0;
            this.min = '';
            this.max = '';
            this.step = '';
            this.maxLength = 0;
            this.placeholder = '';
            this.role = '';
            this.loading = '';
            this.controls = false;
            this.autoplay = false;
            this.loop = false;
            this.muted = false;
            this.playsInline = false;
        }
        get textContent() {
            return this.childNodes.map(c => c.textContent ?? '').join('');
        }
        set textContent(v) {
            this.replaceChildren(v === '' || v === null || v === undefined ? null : this.ownerDocument.createTextNode(String(v)));
        }
        set innerHTML(_v) {
            throw new Error('innerHTML is forbidden in views');
        }
        set outerHTML(_v) {
            throw new Error('outerHTML is forbidden in views');
        }
        setAttribute(k, v) {
            this.attributes[k] = String(v);
            if (k === 'class') this.className = String(v);
            else if (k === 'id') this.id = String(v);
        }
        getAttribute(k) {
            if (k === 'class') return this.className;
            return this.attributes[k] ?? null;
        }
        removeAttribute(k) {
            delete this.attributes[k];
        }
        addEventListener(type, fn) {
            const key = String(type).toLowerCase();
            const list = this.listeners.get(key) ?? [];
            list.push(fn);
            this.listeners.set(key, list);
        }
        dispatchEvent(ev) {
            const event = ev && typeof ev === 'object' ? ev : { type: String(ev) };
            event.target ??= this;
            event.currentTarget = this;
            for (const fn of this.listeners.get(String(event.type).toLowerCase()) ?? []) {
                fn(event);
            }
        }
        click() {
            this.dispatchEvent({ type: 'click', target: this });
        }
        focus() {
            this.ownerDocument.activeElement = this;
        }
        blur() {
            if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
        }
        contains(node) {
            let cur = node;
            while (cur) {
                if (cur === this) return true;
                cur = cur.parentNode;
            }
            return false;
        }
        _adopt(nodes) {
            const out = [];
            for (const n of nodes.flat()) {
                if (n === null || n === undefined || n === false) continue;
                const node = typeof n === 'string' || typeof n === 'number'
                    ? this.ownerDocument.createTextNode(String(n))
                    : n;
                if (node.parentNode && node.parentNode !== this) {
                    const idx = node.parentNode.childNodes.indexOf(node);
                    if (idx >= 0) node.parentNode.childNodes.splice(idx, 1);
                }
                node.parentNode = this;
                out.push(node);
            }
            return out;
        }
        append(...nodes) {
            this.childNodes.push(...this._adopt(nodes));
        }
        prepend(...nodes) {
            this.childNodes.unshift(...this._adopt(nodes));
        }
        replaceChildren(...nodes) {
            for (const c of this.childNodes) c.parentNode = null;
            this.childNodes = [];
            this.append(...nodes);
        }
        remove() {
            if (!this.parentNode) return;
            const idx = this.parentNode.childNodes.indexOf(this);
            if (idx >= 0) this.parentNode.childNodes.splice(idx, 1);
            this.parentNode = null;
        }
        getBoundingClientRect() {
            return { left: 20, top: 20, width: 220, height: 34 };
        }
        walk(fn) {
            for (const child of this.childNodes) {
                if (child.nodeType !== 1) continue;
                fn(child);
                child.walk(fn);
            }
        }
        matchesSimple(sel) {
            const tokens = sel.trim().match(/(\.[a-zA-Z0-9_-]+|\[[^\]]+\]|[a-zA-Z0-9_-]+)/g) || [];
            if (!tokens.length) return false;
            return tokens.every(tok => {
                if (tok.startsWith('.')) {
                    return String(this.className || '').split(/\s+/).includes(tok.slice(1));
                }
                const dataMatch = tok.match(/^\[data-([a-z0-9-]+)(?:="([^"]*)")?\]$/i);
                if (dataMatch) {
                    const camel = dataMatch[1].replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
                    const val = this.dataset[camel];
                    return dataMatch[2] === undefined ? val !== undefined : String(val) === dataMatch[2];
                }
                return this.tagName === tok.toUpperCase();
            });
        }
        querySelectorAll(sel) {
            const parts = sel.split(',').map(p => p.trim()).filter(Boolean);
            const out = [];
            const matchPart = (node, part) => {
                const chain = part.split(/\s+/).filter(Boolean);
                if (!chain.length || !node.matchesSimple(chain[chain.length - 1])) return false;
                let anc = node.parentNode;
                for (let i = chain.length - 2; i >= 0; i -= 1) {
                    while (anc && !(anc.nodeType === 1 && anc.matchesSimple(chain[i]))) anc = anc.parentNode;
                    if (!anc) return false;
                    anc = anc.parentNode;
                }
                return true;
            };
            this.walk(node => {
                if (parts.some(p => matchPart(node, p))) out.push(node);
            });
            return out;
        }
        querySelector(sel) {
            return this.querySelectorAll(sel)[0] ?? null;
        }
    }

    const doc = {
        defaultView: { innerWidth: 390, innerHeight: 844, addEventListener() {}, removeEventListener() {} },
        createElement(t) { return new FakeEl(doc, t); },
        createTextNode(txt) { return new FakeText(txt); },
    };
    doc.body = new FakeEl(doc, 'body');
    doc.activeElement = doc.body;
    return doc;
}

function makeTestHarness({ locale = 'ru', bottomInput = 74, chatOverrides = {}, settingsOverrides = {}, fetchHandler = null } = {}) {
    const doc = makeFakeDom();
    let currentLocale = locale;
    let currentInsets = { topBar: 12, bottomInput };
    const localeListeners = new Set();
    const insetListeners = new Set();

    let state = createChatState('2026-11-19');
    Object.assign(state.world, chatOverrides.world || {});
    Object.assign(state.counters, chatOverrides.counters || {});
    if (Array.isArray(chatOverrides.companions)) state.companions = chatOverrides.companions;

    const settings = {
        apiKey: 'sk-views_test_123456',
        trackerModel: 'gemini-2.5-flash-lite',
        codexModel: 'gemini-2.5-flash-lite',
        imageModel: 'gemini-2.5-flash-image-nano-banana',
        videoModel: 'kling-v2',
        speechModel: 'eleven_multilingual_v2',
        defaultVoice: 'matteo_voice',
        confirmPaid: true,
        maxAutoSpendUsd: 0.25,
        autoTrack: true,
        slopMode: 'inject',
        slopDisabled: [],
        slopPhrases: [],
        directorPresets: [],
        meterPacks: [],
        codexPresets: [],
        wikiEnabled: true,
        wikiEvery: 8,
        phoneSkin: 'auto',
        showInnerThoughts: true,
        showSuggestedActions: true,
        thoughtsBlurred: true,
        ...settingsOverrides,
    };

    const stores = {
        clodex_rp_phone: chatOverrides.phoneStore ?? null,
        clodex_rp_wiki: chatOverrides.wikiStore ?? null,
    };
    let activeKeys = chatOverrides.activeKeys ?? ['1:0', '2:0'];
    let latestTurnKey = chatOverrides.latestTurnKey ?? '2:0';
    let rpContext = chatOverrides.rpContext ?? {
        chatId: 'chat-v13',
        userName: 'Данте',
        charName: 'Маттео',
        charDescription: 'Татуированный экзорцист средневековой инквизиции в старом монастыре Данте.',
        scenario: 'Ночной собор.',
        recentMessages: [
            { role: 'user', name: 'Данте', content: 'Что скрывает орден?' },
            { role: 'assistant', name: 'Маттео', content: '*Он усмехнулся, и дрожь пробежала по спине.* «Тише.»' },
            { role: 'assistant', name: 'Маттео', content: '*Усмехнулся снова, и дрожь пробежала по спине в соборе.*' },
            { role: 'assistant', name: 'Маттео', content: '*Дрожь пробежала по спине Маттео, когда свечи задрожали.*' },
        ],
    };

    const calls = { chat: [], image: [], speech: [], confirm: [], exported: [], savedMedia: [] };
    let nextImportPack = null;

    const mockFetch = async (url, init = {}) => {
        const u = String(url);
        if (u.endsWith('/v1/models')) {
            return new Response(JSON.stringify({
                data: [
                    { id: 'gemini-2.5-flash-lite' },
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
        if (fetchHandler) {
            const custom = await fetchHandler(u, init, calls);
            if (custom) return custom;
        }
        if (u.endsWith('/v1/chat/completions')) {
            const body = JSON.parse(init.body);
            calls.chat.push(body);
            return new Response(JSON.stringify({
                choices: [{
                    message: {
                        content: JSON.stringify({
                            timeOfDay: 'night',
                            innerThought: '<script>alert(1)</script>Он боится, что правда выйдет наружу.',
                            suggestedActions: ['Спросить про печать', 'Осмотреть алтарь', 'Отступить назад'],
                            phoneEvents: [{ kind: 'note', author: 'Маттео', text: '<b>Скрыть</b> следы до рассвета.' }],
                        }),
                    },
                }],
            }), { status: 200 });
        }
        if (u.endsWith('/v1/images/generations')) {
            calls.image.push(JSON.parse(init.body));
            return new Response(JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }] }), { status: 200 });
        }
        if (u.endsWith('/v1/audio/speech')) {
            calls.speech.push(JSON.parse(init.body));
            return new Response(new Uint8Array([0x49, 0x44, 0x33, 0x03]), {
                status: 200,
                headers: { 'content-type': 'audio/mpeg' },
            });
        }
        throw new Error(`Unhandled URL: ${u}`);
    };

    const missingKeys = [];
    const t = (k, p = {}) => {
        const dict = currentLocale === 'ru' ? RU_CATALOG : EN_CATALOG;
        const raw = dict[k];
        if (!raw) missingKeys.push(`${currentLocale}:${k}`);
        return String(raw ?? k).replace(/\{(\w+)\}/g, (m, x) => String(p[x] ?? m));
    };

    const controller = createRpStudioController({
        document: doc,
        fetchImpl: mockFetch,
        mountContainer: doc.body,
        getLocale: () => currentLocale,
        onLocaleChange: cb => { localeListeners.add(cb); return () => localeListeners.delete(cb); },
        getInsets: () => currentInsets,
        onInsetsChange: cb => { insetListeners.add(cb); return () => insetListeners.delete(cb); },
        t,
        confirm: async msg => { calls.confirm.push(msg); return true; },
        getEffectiveKey: () => settings.apiKey,
        getSettings: () => settings,
        async updateSettings(patch) { Object.assign(settings, patch); },
        getChatState: () => state,
        async saveChatState(next) { state = next; },
        getActiveTurnKeys: async () => activeKeys,
        getLatestTurnKey: async () => latestTurnKey,
        loadStore: async name => (stores[name] ? structuredClone(stores[name]) : null),
        saveStore: async (name, value) => { stores[name] = structuredClone(value); },
        savePhoneMedia: async ({ entryId, kind }) => {
            const path = `files/chat/clodex-phone-${entryId}.${kind === 'voice' ? 'mp3' : 'png'}`;
            calls.savedMedia.push(path);
            return path;
        },
        exportPack: async pack => { calls.exported.push(pack); },
        importPack: async () => nextImportPack,
        getRpContext: async ({ limit = 6 } = {}) => ({
            ...rpContext,
            recentMessages: rpContext.recentMessages.slice(-limit),
        }),
        insertIntoComposer: async () => {},
        saveSpeechAudio: async () => 'files/chat/tts.mp3',
    });

    return {
        doc,
        controller,
        calls,
        stores,
        getState: () => state,
        getSettings: () => settings,
        setActiveKeys: k => { activeKeys = k; },
        setLatestTurnKey: k => { latestTurnKey = k; },
        setImportPack: p => { nextImportPack = p; },
        setInsets: next => {
            currentInsets = next;
            for (const cb of insetListeners) cb();
        },
        setLocale: next => {
            currentLocale = next;
            for (const cb of localeListeners) cb();
        },
        getMissingKeys: () => missingKeys,
    };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 15));

test('All screens, header order, single-row 4 tabs, HUD <= 4 chips, and RU/EN localization parity', async () => {
    const h = makeTestHarness({
        locale: 'ru',
        chatOverrides: {
            world: {
                enableVitals: true,
                enableAdultBiology: true,
                pendingMemoryHint: 'Armed clue',
                director: { activeIds: ['suspense'], customNote: '' },
            },
            companions: [{ id: 'c1', name: 'Люкс', stage: 'infant', mood: 90, archetype: 'familiar_fox' }],
            phoneStore: phoneIngestEvents(phoneCreateStore(), [
                { kind: 'note', author: 'Маттео', text: 'Тайная запись' },
                { kind: 'feed', author: 'Слухи', text: 'Ночной звон в соборе' },
            ], '2:0'),
            wikiStore: wikiManualEdit(wikiCreateStore(), 'npcs', { name: 'Маттео', role: 'Экзорцист' }, '1:0'),
        },
    });
    await flush();

    // HUD pill never exceeds 4 chips even when all modules + phone + director + memory hint are active
    const pill = h.doc.body.querySelector('.clodex-rp-hud-pill');
    const chips = pill.querySelectorAll('.clodex-rp-chip');
    assert.equal(chips.length, 4);
    assert.match(chips[0].textContent, /📅/);
    assert.match(chips[1].textContent, /❤️|🩸/);
    assert.match(chips[2].textContent, /🐣/);
    assert.match(chips[3].textContent, /📱 \+2.*🎬/);

    // Check every screen & sub-tab in both RU and EN with zero missing / raw keys
    for (const lang of ['ru', 'en']) {
        h.setLocale(lang);
        for (const tab of ['tracker', 'cradle', 'codex', 'wiki', 'style', 'scene', 'forge', 'packs', 'account', 'phone']) {
            h.controller.openTab(tab);
            await flush();

            const drawer = h.doc.body.querySelector('.clodex-rp-drawer');
            assert.ok(drawer, `Drawer must exist for ${tab}`);

            // Primary navigation stays strictly 4 tabs in 1 row
            const tabBtns = drawer.querySelectorAll('.clodex-rp-tabs .clodex-rp-tab-btn');
            assert.equal(tabBtns.length, 4);

            // Header action order: 📱 · ⚒️ · 🔑 · ⌖ · ✕
            const headBtns = drawer.querySelectorAll('.clodex-rp-drawer-head .clodex-rp-head-actions button');
            assert.equal(headBtns.length, 5);
            assert.ok(headBtns[0].textContent.startsWith('📱'));
            assert.equal(headBtns[1].textContent, '⚒️');
            assert.equal(headBtns[2].textContent, '🔑');
            assert.equal(headBtns[3].textContent, '⌖');
            assert.equal(headBtns[4].textContent, '✕');

            // No raw unresolved keys leaked into visible text
            const text = drawer.textContent;
            assert.ok(!/\b(?:director|slop|turn|phone|wiki|pack|codex|tab|hud|account)\.[a-z0-9_]+\b/i.test(text),
                `Raw key found in ${lang}/${tab}: ${text}`);
        }
    }

    assert.deepEqual(h.getMissingKeys(), []);
    h.controller.dispose();
});

test('Director strip starts collapsed, tracks bottomInput inset, enforces max 2, and clears only on committed reply', async () => {
    const h = makeTestHarness({ locale: 'ru', bottomInput: 82 });
    await flush();

    const host = h.doc.body.querySelector('.clodex-rp-director-host');
    assert.equal(host.style.bottom, '88px');

    // Collapsed by default: toggle exists, body/presets are hidden until clicked
    let bar = host.querySelector('.clodex-rp-director-bar');
    assert.ok(bar);
    assert.equal(host.querySelector('[data-rp-action="director-preset"]'), null);

    // Update insets dynamically
    h.setInsets({ topBar: 10, bottomInput: 0 });
    assert.equal(host.style.bottom, '6px');

    // Expand bar
    host.querySelector('[data-rp-action="director-toggle"]').click();
    const presetBtns = host.querySelectorAll('[data-rp-action="director-preset"]');
    assert.equal(presetBtns.length, 6);

    // Pick 3 presets -> max 2 remain active (oldest dropped)
    host.querySelector('[data-preset-id="suspense"]').click();
    await flush();
    host.querySelector('[data-preset-id="twist"]').click();
    await flush();
    host.querySelector('[data-preset-id="dialogue"]').click();
    await flush();
    assert.deepEqual(h.getState().world.director.activeIds, ['twist', 'dialogue']);

    // Custom note is trimmed to 140 chars
    const noteInput = host.querySelector('[data-rp-action="director-note"]');
    noteInput.value = 'x'.repeat(180);
    noteInput.dispatchEvent({ type: 'change', target: noteInput });
    await flush();
    assert.equal(h.getState().world.director.customNote.length, 140);

    // Clear on committed assistant reply
    await h.controller.onAssistantMessageCommitted({ checkpointKey: '2:0' });
    assert.deepEqual(h.getState().world.director, { activeIds: [], customNote: '' });

    // Verified syncTrackerFromChat used TRACKER_MAX_TOKENS
    assert.ok(h.calls.chat.length >= 1);
    assert.equal(h.calls.chat[0].max_tokens, TRACKER_MAX_TOKENS);

    h.controller.dispose();
});

test('Phone screen renders safely without paid calls until Click-to-Reveal, respects confirmPaid/maxAutoSpendUsd, and arms pendingMemoryHint', async () => {
    const store = phoneIngestEvents(phoneCreateStore(), [
        { kind: 'photo', author: 'Маттео', text: 'Свеча на столе <img src=x onerror=alert(1)>', mediaPrompt: 'Candle in cathedral' },
        { kind: 'voice', author: 'Маттео', text: 'Не приходи сюда ночью.' },
    ], '2:0');
    const h = makeTestHarness({
        locale: 'ru',
        chatOverrides: { phoneStore: store },
        settingsOverrides: { maxAutoSpendUsd: 0.05, confirmPaid: true },
    });
    await flush();

    // Open phone and browse every section — ZERO paid requests until user clicks Reveal
    h.controller.openTab('phone');
    await flush();
    const phoneEl = h.doc.body.querySelector('[data-rp-view="phone"]');
    assert.equal(phoneEl.dataset.skin, 'grimoire'); // auto-detected from cathedral/exorcist description

    h.doc.body.querySelector('[data-rp-action="phone-section"][data-section="media"]').click();
    await flush();
    assert.equal(h.calls.image.length, 0);
    assert.equal(h.calls.speech.length, 0);

    // Hidden photo & voice stubs exist; caption/img/audio must NOT be visible before click
    const revealBtns = h.doc.body.querySelectorAll('[data-rp-action="phone-reveal"]');
    assert.equal(revealBtns.length, 2);
    assert.equal(h.doc.body.querySelector('img'), null);
    assert.equal(h.doc.body.querySelector('audio'), null);

    // Click to reveal photo -> asks confirmPaid, generates 1 image, counts spend
    revealBtns[1].click(); // entries reversed (newest first): [1]=photo, [0]=voice
    await flush();
    await flush();
    assert.equal(h.calls.confirm.length, 1);
    assert.equal(h.calls.image.length, 1);
    assert.equal(h.calls.speech.length, 0);
    assert.ok(h.controller.getSessionAutoSpendUsd() > 0);
    assert.ok(h.doc.body.querySelector('.clodex-rp-phone-photo'));

    // Next reveal (voice, est $0.015; total 0.04+0.015 = 0.055 > 0.05 cap) is blocked by FinOps cap!
    const remainingReveal = h.doc.body.querySelector('[data-rp-action="phone-reveal"]');
    remainingReveal.click();
    await flush();
    assert.equal(h.calls.speech.length, 0);
    assert.ok(h.doc.body.querySelector('.clodex-rp-error'));

    // "Present next turn" arms world.pendingMemoryHint
    h.doc.body.querySelector('[data-rp-action="phone-present"]').click();
    await flush();
    assert.match(h.getState().world.pendingMemoryHint, /Matteo|Маттео|photo|voice/i);

    h.controller.dispose();
});

test('Anti-Slop radar, Wiki manual pin & stale-turn guard, and .clodex-pack preview/reject work cleanly', async () => {
    const h = makeTestHarness({
        locale: 'ru',
        chatOverrides: { counters: { turnsSinceLastPhone: 0, turnsSinceWiki: 8 } },
    });
    await flush();

    // Open Codex -> Style: local Anti-Slop finds repeated phrase without any API call
    const beforeChats = h.calls.chat.length;
    h.controller.openTab('style');
    await flush();
    assert.equal(h.calls.chat.length, beforeChats);
    assert.match(h.getState().world.slopRule, /дрож.*пробежал.*спин/i);

    // Open Codex -> Wiki: add pinned manual row
    h.controller.openTab('wiki');
    await flush();
    h.doc.body.querySelector('[data-rp-action="wiki-add"][data-table="npcs"]').click();
    const form = h.doc.body.querySelector('[data-rp-view="wiki-form-npcs"]');
    const nameField = form.querySelector('[data-rp-field="name"]');
    nameField.value = 'Отец Бернард';
    nameField.dispatchEvent({ type: 'input', target: nameField });
    form.querySelector('[data-rp-action="wiki-save"]').click();
    await flush();
    assert.match(h.doc.body.querySelector('[data-rp-view="wiki-npcs"]').textContent, /Отец Бернард/);

    // Stale wiki update: if turnKey is no longer in activeKeys while waiting, patch is discarded
    const staleH = makeTestHarness({
        locale: 'en',
        chatOverrides: { latestTurnKey: '9:0', activeKeys: ['1:0', '9:0'], counters: { turnsSinceLastPhone: 0, turnsSinceWiki: 8 } },
        fetchHandler: async (u, init) => {
            if (!u.endsWith('/v1/chat/completions')) return null;
            // Swipe happened mid-flight: 9:0 replaced by 9:1
            staleH.setActiveKeys(['1:0', '9:1']);
            return new Response(JSON.stringify({
                choices: [{
                    message: {
                        content: JSON.stringify({
                            upsert: [{ table: 'places', name: 'Stale Crypt', description: 'Should be dropped' }],
                            remove: [],
                        }),
                    },
                }],
            }), { status: 200 });
        },
    });
    await flush();
    const ok = await staleH.controller.runWikiUpdate({ manual: true });
    assert.equal(ok, false);
    assert.equal(staleH.getState().counters.turnsSinceWiki, 8);
    assert.equal(staleH.stores.clodex_rp_wiki?.journal?.length ?? 0, 0);
    staleH.controller.dispose();

    // Packs tab: reject <script> pack, preview and confirm valid pack
    h.controller.openTab('packs');
    await flush();
    h.setImportPack({
        format: 'clodex-pack',
        version: 1,
        name: 'Bad',
        contents: { slopPhrases: ['<script>evil()</script>'] },
    });
    h.doc.body.querySelector('[data-rp-action="pack-import"]').click();
    await flush();
    assert.equal(h.doc.body.querySelector('[data-rp-action="pack-confirm"]'), null);
    assert.ok(h.doc.body.querySelector('.clodex-rp-pack-errors'));

    const goodPack = packBuild({
        directorPresets: [{ id: 'gothic', emoji: '🕯️', label: 'Gothic omen', directive: 'add gothic omen' }],
        slopPhrases: ['crimson orbs'],
        phoneSkin: 'grimoire',
    }, { name: 'Dante Pack', author: 'tester', locale: 'en' });
    h.setImportPack(goodPack);
    h.doc.body.querySelector('[data-rp-action="pack-import"]').click();
    await flush();
    h.doc.body.querySelector('[data-rp-action="pack-confirm"]').click();
    await flush();
    assert.equal(h.getSettings().directorPresets.length, 1);
    assert.equal(h.getSettings().phoneSkin, 'grimoire');

    h.controller.dispose();
});

test('syncTrackerFromChat gates phoneEvents via phoneShouldInclude, escapes LLM HTML, runs background wiki, and settings.html exposes phone/wiki', async () => {
    // 1. turnsSinceLastPhone < 3 => phoneEvents must NOT be requested or ingested
    const lowPhone = makeTestHarness({
        locale: 'ru',
        chatOverrides: { counters: { turnsSinceLastPhone: 1, turnsSinceWiki: 0 } },
    });
    await flush();
    await lowPhone.controller.syncTrackerFromChat({ checkpointKey: '2:0', silent: true });
    assert.equal(lowPhone.calls.chat.length, 1);
    assert.ok(!/phoneEvents/.test(JSON.stringify(lowPhone.calls.chat[0].messages)));
    assert.equal(lowPhone.stores.clodex_rp_phone?.journal?.length ?? 0, 0);
    lowPhone.controller.dispose();

    // 2. turnsSinceLastPhone >= 3 + turnsSinceWiki >= 7 (after +1 => 8) => requests phoneEvents & triggers wiki update
    let chatCallIdx = 0;
    const high = makeTestHarness({
        locale: 'ru',
        chatOverrides: { counters: { turnsSinceLastPhone: 3, turnsSinceWiki: 7 } },
        fetchHandler: async u => {
            if (!u.endsWith('/v1/chat/completions')) return null;
            chatCallIdx += 1;
            if (chatCallIdx === 1) {
                return new Response(JSON.stringify({
                    choices: [{
                        message: {
                            content: JSON.stringify({
                                timeOfDay: 'night',
                                phoneEvents: [{ kind: 'dm', author: '<script>evil</script>', text: '<img src=x onerror=alert(1)>Полночь' }],
                            }),
                        },
                    }],
                }), { status: 200 });
            }
            return new Response(JSON.stringify({
                choices: [{
                    message: {
                        content: JSON.stringify({
                            upsert: [{ table: 'places', name: '<script>Собор</script>', description: 'Тёмный неф' }],
                            remove: [],
                        }),
                    },
                }],
            }), { status: 200 });
        },
    });
    await flush();
    await high.controller.syncTrackerFromChat({ checkpointKey: '2:0', silent: true });
    await flush();
    await flush();

    // Phone ingested and rendered as safe textContent (no script/img elements created!)
    high.controller.openTab('phone');
    await flush();
    const phoneViewEl = high.doc.body.querySelector('[data-rp-view="phone"]');
    assert.equal(phoneViewEl.querySelector('script'), null);
    assert.equal(phoneViewEl.querySelector('img'), null);
    assert.match(phoneViewEl.textContent, /Полночь/);

    // Background wiki update ran and reset turnsSinceWiki to 0 after success
    assert.equal(high.getState().counters.turnsSinceWiki, 0);
    assert.ok((high.stores.clodex_rp_wiki?.journal?.length ?? 0) >= 1);
    high.controller.openTab('wiki');
    await flush();
    assert.equal(high.doc.body.querySelector('[data-rp-view="wiki"]').querySelector('script'), null);

    // 3. settings.html contains phone & wiki openers with valid RU/EN locale keys
    const settingsHtml = await readFile(new URL('../settings.html', import.meta.url), 'utf8');
    assert.match(settingsHtml, /data-rp-open="phone"/);
    assert.match(settingsHtml, /data-rp-open="wiki"/);
    for (const m of settingsHtml.matchAll(/data-clodex-rp-i18n="([^"]+)"/g)) {
        assert.ok(EN_CATALOG[m[1]] && RU_CATALOG[m[1]], `Missing locale key in settings.html: ${m[1]}`);
    }

    high.controller.dispose();
});
