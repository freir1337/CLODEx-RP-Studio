import { blobToBase64, validateKey } from '../core/api.js';
import { createRpStudioController } from '../core/hud.js';
import { createChatState, normalizeChatState, restoreCheckpointBefore } from '../core/physiology.js';
import { buildSystemContext } from '../core/prompts.js';

export const ST_SETTINGS_KEY = 'clodex_rp_studio';
export const ST_PROMPT_KEY = 'clodex_rp_studio_context';

export const DEFAULT_ST_SETTINGS = Object.freeze({
    apiKey: '',
    trackerModel: '',
    codexModel: '',
    imageModel: '',
    videoModel: '',
    autoTrack: true,
    injectContext: true,
    confirmPaid: true,
    autoImageEvery: 0,
    bgDim: 35,
    hudPos: null,
});

export function loadStSettings(context) {
    const raw = context.extensionSettings?.[ST_SETTINGS_KEY] ?? {};
    const clean = {
        apiKey: '',
        trackerModel: typeof raw.trackerModel === 'string' ? raw.trackerModel : '',
        codexModel: typeof raw.codexModel === 'string' ? raw.codexModel : '',
        imageModel: typeof raw.imageModel === 'string' ? raw.imageModel : '',
        videoModel: typeof raw.videoModel === 'string' ? raw.videoModel : '',
        autoTrack: raw.autoTrack !== false,
        injectContext: raw.injectContext !== false,
        confirmPaid: raw.confirmPaid !== false,
        autoImageEvery: Math.max(0, Math.min(30, Number(raw.autoImageEvery) || 0)),
        bgDim: Math.max(0, Math.min(80, Number(raw.bgDim ?? 35))),
        hudPos: raw.hudPos && Number.isFinite(raw.hudPos.x) && Number.isFinite(raw.hudPos.y)
            ? { x: raw.hudPos.x, y: raw.hudPos.y } : null,
    };
    try {
        clean.apiKey = raw.apiKey ? validateKey(raw.apiKey) : '';
    } catch {
        clean.apiKey = '';
    }
    if (context.extensionSettings) context.extensionSettings[ST_SETTINGS_KEY] = clean;
    return clean;
}

async function uploadMediaToSt(context, fetchImpl, blob, ext) {
    const base64 = await blobToBase64(blob);
    const name = `clodex-rp-${Date.now()}.${ext}`;
    try {
        const headers = new Headers(context.getRequestHeaders?.() ?? {});
        headers.set('Content-Type', 'application/json');
        const res = await fetchImpl('/api/files/upload', {
            method: 'POST',
            headers,
            credentials: 'same-origin',
            body: JSON.stringify({ name, data: base64 }),
        });
        if (res.ok) {
            const payload = await res.json();
            if (payload?.path) return String(payload.path);
        }
    } catch {
        // Fallback to object URL for standalone/test harnesses
    }
    return URL.createObjectURL(blob);
}

export async function initializeSillyTavern({
    getContext = () => globalThis.SillyTavern?.getContext(),
    fetchImpl = globalThis.fetch?.bind(globalThis),
    document = globalThis.document,
    confirm = msg => globalThis.confirm(msg),
} = {}) {
    if (document.querySelector('#clodex-rp-studio-settings')) return null;
    const context = getContext();
    if (!context) throw new Error('SillyTavern context unavailable.');

    const base = new URL('../../', import.meta.url);
    const [settingsHtml, enJson, ruJson] = await Promise.all([
        fetchImpl(new URL('settings.html', base)).then(r => r.text()),
        fetchImpl(new URL('i18n/en-us.json', base)).then(r => r.json()),
        fetchImpl(new URL('i18n/ru-ru.json', base)).then(r => r.json()),
    ]);

    const settings = loadStSettings(context);
    let currentChatId = '';
    let chatState = createChatState();

    const getLocale = () => {
        const raw = context.getCurrentLocale?.() ?? globalThis.navigator?.language ?? 'en';
        return String(raw).toLowerCase().startsWith('ru') ? 'ru' : 'en';
    };

    const t = (key, params = {}) => {
        const dict = getLocale() === 'ru' ? ruJson : enJson;
        const raw = dict[`clodex_rp.${key}`] ?? enJson[`clodex_rp.${key}`] ?? key;
        return String(raw).replace(/\{(\w+)\}/g, (m, k) => String(params[k] ?? m));
    };

    // Mount settings card in SillyTavern Extensions tab
    const tpl = document.createElement('template');
    tpl.innerHTML = settingsHtml;
    const settingsCard = tpl.content.firstElementChild;
    for (const node of settingsCard.querySelectorAll('[data-clodex-rp-i18n]')) {
        node.textContent = t(node.dataset.clodexRpI18n);
    }
    document.querySelector('#extensions_settings')?.append(settingsCard);

    let customImageBgEl = document.querySelector('#clodex-rp-st-image-bg');
    if (!customImageBgEl) {
        customImageBgEl = document.createElement('div');
        customImageBgEl.id = 'clodex-rp-st-image-bg';
        customImageBgEl.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;background-size:cover;background-position:center;transition:opacity .35s ease;opacity:0;';
        document.body.prepend(customImageBgEl);
    }

    function applyStImageOverlay(path) {
        if (path) {
            customImageBgEl.style.backgroundImage = `url("${CSS.escape ? path.replace(/"/g, '\\"') : path}")`;
            customImageBgEl.style.opacity = '0.45';
        } else {
            customImageBgEl.style.backgroundImage = 'none';
            customImageBgEl.style.opacity = '0';
        }
    }

    function loadStateForCurrentChat() {
        const ctx = getContext();
        const cid = String(ctx.getCurrentChatId?.() ?? ctx.chatId ?? 'default');
        currentChatId = cid;
        const raw = ctx.chatMetadata?.[ST_SETTINGS_KEY];
        chatState = raw ? normalizeChatState(raw) : createChatState();
        applyStImageOverlay(chatState.scene.imagePath);
        pushExtensionPrompt();
        return chatState;
    }

    function pushExtensionPrompt() {
        const ctx = getContext();
        if (typeof ctx.setExtensionPrompt !== 'function') return;
        if (!settings.injectContext) {
            ctx.setExtensionPrompt(ST_PROMPT_KEY, '', 1, 1);
            return;
        }
        const charObj = ctx.characters?.[ctx.characterId];
        const block = buildSystemContext(chatState, {
            userName: ctx.name1 || '{{user}}',
            charName: ctx.name2 || charObj?.name || '{{char}}',
        });
        ctx.setExtensionPrompt(ST_PROMPT_KEY, block, 1, 1);
    }

    loadStateForCurrentChat();

    const bridge = {
        document,
        fetchImpl,
        mountContainer: document.body,
        getLocale,
        t,
        confirm,
        notify: msg => globalThis.toastr?.info?.(msg),
        getEffectiveKey() {
            if (settings.apiKey) return settings.apiKey;
            const inherited = getContext()?.extensionSettings?.clodex?.savedKey ?? '';
            try {
                return inherited ? validateKey(inherited) : '';
            } catch {
                return '';
            }
        },
        isKeyInherited() {
            return !settings.apiKey && Boolean(getContext()?.extensionSettings?.clodex?.savedKey);
        },
        getSettings: () => settings,
        async updateSettings(patch) {
            for (const [k, v] of Object.entries(patch)) {
                if (k === 'apiKey') {
                    settings.apiKey = v ? validateKey(v) : '';
                } else if (k in settings) {
                    settings[k] = v;
                }
            }
            getContext().saveSettingsDebounced?.();
            pushExtensionPrompt();
        },
        getChatState() {
            const cid = String(getContext().getCurrentChatId?.() ?? getContext().chatId ?? 'default');
            if (cid !== currentChatId) loadStateForCurrentChat();
            return chatState;
        },
        async saveChatState(nextState) {
            chatState = normalizeChatState(nextState);
            const ctx = getContext();
            if (ctx.chatMetadata) {
                ctx.chatMetadata[ST_SETTINGS_KEY] = chatState;
                ctx.saveMetadataDebounced?.();
            }
            pushExtensionPrompt();
        },
        async getRpContext() {
            const ctx = getContext();
            const charObj = ctx.characters?.[ctx.characterId];
            const card = charObj?.data ?? charObj ?? {};
            const recentMessages = (ctx.chat ?? [])
                .filter(m => !m.is_system)
                .slice(-6)
                .map(m => ({
                    role: m.is_user ? 'user' : 'assistant',
                    name: m.name,
                    content: String(m.mes ?? ''),
                }));
            return {
                chatId: String(ctx.getCurrentChatId?.() ?? ctx.chatId ?? 'default'),
                userName: ctx.name1 || 'User',
                charName: ctx.name2 || card.name || 'Character',
                charDescription: String(card.description ?? ''),
                scenario: String(card.scenario ?? ''),
                recentMessages,
            };
        },
        async insertIntoComposer(text) {
            const area = document.querySelector('#send_textarea');
            if (!area) return;
            area.value = area.value ? `${area.value}\n${text}` : text;
            area.dispatchEvent(new Event('input', { bubbles: true }));
        },
        async applyImageBackground({ blob }) {
            const url = await uploadMediaToSt(getContext(), fetchImpl, blob, 'png');
            applyStImageOverlay(url);
            return url;
        },
        async applyVideoBackground({ blob }) {
            return await uploadMediaToSt(getContext(), fetchImpl, blob, 'mp4');
        },
        async clearSceneBackground() {
            applyStImageOverlay('');
        },
        async loadCurrentSceneImageDataUrl(path) {
            if (!path) return '';
            const res = await fetchImpl(path, { credentials: 'same-origin' });
            if (!res.ok) return '';
            const blob = await res.blob();
            return `data:${blob.type || 'image/png'};base64,${await blobToBase64(blob)}`;
        },
        loadHudPosition: () => settings.hudPos,
        saveHudPosition(pos) {
            settings.hudPos = pos;
            getContext().saveSettingsDebounced?.();
        },
        getInsets: () => ({ topBar: 44, bottomInput: 78 }),
    };

    const controller = createRpStudioController(bridge);

    for (const btn of settingsCard.querySelectorAll('[data-rp-open]')) {
        btn.addEventListener('click', () => controller.openTab(btn.dataset.rpOpen));
    }

    // Hook into SillyTavern chat lifecycle events
    const ev = context.eventSource;
    const types = context.event_types ?? {};
    const cleanups = [];
    const listen = (eventName, fn) => {
        if (!ev || !eventName) return;
        ev.on(eventName, fn);
        cleanups.push(() => ev.removeListener?.(eventName, fn));
    };

    listen(types.CHAT_CHANGED, () => {
        loadStateForCurrentChat();
        controller.renderAll();
    });

    listen(types.MESSAGE_RECEIVED, index => {
        const ctx = getContext();
        const msg = ctx.chat?.[index] ?? ctx.chat?.at(-1);
        const key = `${index ?? ctx.chat?.length ?? 0}:${msg?.swipe_id ?? 0}`;
        controller.onAssistantMessageCommitted({ checkpointKey: key }).catch(() => {});
    });

    listen(types.MESSAGE_SWIPED, index => {
        const ctx = getContext();
        const msg = ctx.chat?.[index];
        const prevKey = `${index}:${Math.max(0, (msg?.swipe_id ?? 1) - 1)}`;
        if (restoreCheckpointBefore(chatState, prevKey)) {
            bridge.saveChatState(chatState);
            controller.renderAll();
        }
    });

    listen(types.MESSAGE_DELETED, index => {
        const keyPrefix = `${index}:`;
        const hit = chatState.checkpoints.find(cp => cp.key.startsWith(keyPrefix));
        if (hit && restoreCheckpointBefore(chatState, hit.key)) {
            bridge.saveChatState(chatState);
            controller.renderAll();
        }
    });

    // Register convenient slash commands if supported
    if (typeof context.registerSlashCommand === 'function') {
        context.registerSlashCommand('clodex-rp', () => controller.openTab('tracker'), [], 'Open CLODEx RP Studio Tracker', true, true);
        context.registerSlashCommand('clodex-codex', () => controller.openTab('codex'), [], 'Open CLODEx Lore Codex', true, true);
        context.registerSlashCommand('clodex-scene', () => controller.openTab('scene'), [], 'Open CLODEx Scene & Video', true, true);
    }

    return {
        controller,
        dispose() {
            for (const fn of cleanups) fn();
            getContext()?.setExtensionPrompt?.(ST_PROMPT_KEY, '', 1, 1);
            controller.dispose();
            customImageBgEl?.remove();
            settingsCard?.remove();
        },
    };
}
