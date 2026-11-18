/* global tavo */
import { blobToBase64, validateKey } from '../core/api.js';
import { createRpStudioController } from '../core/hud.js';
import { createChatState, normalizeChatState } from '../core/physiology.js';

(async function bootstrapTavoHud() {
    const CHAT_VAR_KEY = 'clodex_rp_state';
    const GLOBAL_PREFS_KEY = 'clodex_rp_prefs';

    function normalizeMaxAutoSpend(val) {
        if (val === undefined || val === null || val === '') return 0.25;
        const num = Number(val);
        return Number.isFinite(num) && num >= 0 ? num : 0.25;
    }

    const mountContainer = document.getElementById('clodex-rp-tavo-mount') || document.body;
    const i18n = tavo.plugin.i18n;
    const lastCompanionMediaSlot = Object.create(null);

    let cachedState = createChatState();
    let cachedPrefs = {
        apiKey: '',
        trackerModel: '',
        codexModel: '',
        imageModel: '',
        videoModel: '',
        speechModel: '',
        defaultVoice: 'alloy',
        dialogueOnly: true,
        autoSpeak: false,
        voiceMap: {},
        autoTrack: tavo.plugin.config.get('autoTrack') !== false,
        injectContext: tavo.plugin.config.get('injectContext') !== false,
        confirmPaid: tavo.plugin.config.get('confirmPaid') !== false,
        maxAutoSpendUsd: 0.25,
        autoImageEvery: 0,
        bgDim: Number(tavo.plugin.config.get('bgDim') ?? 35),
        hudPos: null,
    };

    async function reloadFromTavo() {
        const [rawState, rawPrefs] = await Promise.all([
            tavo.variable.get(CHAT_VAR_KEY).catch(() => null),
            tavo.variable.get(GLOBAL_PREFS_KEY, 'global').catch(() => null),
        ]);
        if (rawState && typeof rawState === 'object') {
            cachedState = normalizeChatState(rawState);
        } else {
            cachedState = createChatState();
            cachedState.world.enableVitals = tavo.plugin.config.get('enableVitals') !== false;
            cachedState.world.enableAdultBiology = Boolean(tavo.plugin.config.get('enableAdultBio'));
        }
        if (rawPrefs && typeof rawPrefs === 'object') {
            cachedPrefs = {
                ...cachedPrefs,
                ...rawPrefs,
                maxAutoSpendUsd: normalizeMaxAutoSpend(rawPrefs.maxAutoSpendUsd ?? cachedPrefs.maxAutoSpendUsd),
            };
        }
    }

    await reloadFromTavo();

    const bridge = {
        document,
        mountContainer,
        getLocale: () => (String(i18n.locale || 'en').toLowerCase().startsWith('ru') ? 'ru' : 'en'),
        t: (key, params) => i18n.t(key, params),
        onLocaleChange: cb => i18n.onChange(() => cb()),
        confirm: async msg => globalThis.confirm(msg),
        notify: msg => tavo.utils?.toast?.(msg),
        getEffectiveKey() {
            const candidate = cachedPrefs.apiKey || tavo.plugin.config.get('apiKey') || '';
            try {
                return candidate ? validateKey(candidate) : '';
            } catch {
                return '';
            }
        },
        getSettings: () => cachedPrefs,
        async updateSettings(patch) {
            for (const [k, v] of Object.entries(patch)) {
                if (k === 'apiKey') {
                    cachedPrefs.apiKey = v ? validateKey(v) : '';
                } else if (k === 'maxAutoSpendUsd') {
                    cachedPrefs.maxAutoSpendUsd = normalizeMaxAutoSpend(v);
                } else {
                    cachedPrefs[k] = v;
                }
            }
            await tavo.variable.set(GLOBAL_PREFS_KEY, cachedPrefs, 'global');
        },
        getChatState: () => cachedState,
        async saveChatState(nextState) {
            cachedState = normalizeChatState(nextState);
            await tavo.variable.set(CHAT_VAR_KEY, cachedState);
        },
        async getRpContext() {
            const [chat, recent] = await Promise.all([
                tavo.chat.current().catch(() => null),
                tavo.message.find([-6, -1], { hidden: false }).catch(() => []),
            ]);
            const charSummary = chat?.characters?.[0];
            let charDetail = null;
            if (charSummary?.id && tavo.character?.get) {
                charDetail = await tavo.character.get(charSummary.id).catch(() => null);
            }
            return {
                chatId: String(chat?.id ?? 'default'),
                userName: chat?.persona?.name || 'User',
                charName: charDetail?.name || charSummary?.name || 'Character',
                charDescription: String(charDetail?.description ?? ''),
                scenario: String(charDetail?.scenario ?? ''),
                recentMessages: (Array.isArray(recent) ? recent : []).map(m => ({
                    role: m.role === 'user' ? 'user' : 'assistant',
                    name: m.role === 'user' ? (chat?.persona?.name || 'User') : (charSummary?.name || 'Character'),
                    content: String(m.content ?? ''),
                })),
            };
        },
        async insertIntoComposer(text) {
            await tavo.input.append(text);
        },
        resolveMediaSrc(virtualPath) {
            if (!virtualPath) return '';
            if (typeof tavo.file?.url === 'function' && !/^(https?:|data:|blob:)/i.test(virtualPath)) {
                try {
                    return tavo.file.url(virtualPath, { scope: 'chat' }) || virtualPath;
                } catch {
                    return virtualPath;
                }
            }
            return virtualPath;
        },
        async applyImageBackground({ base64 }) {
            const prev = cachedState.scene?.imagePath;
            const nextName = prev?.endsWith('bg-a.png') ? 'clodex-rp-bg-b.png' : 'clodex-rp-bg-a.png';
            const oldName = nextName === 'clodex-rp-bg-a.png' ? 'clodex-rp-bg-b.png' : 'clodex-rp-bg-a.png';
            const savedPath = await tavo.file.save(nextName, base64, { encoding: 'base64', scope: 'chat' });
            await tavo.file.delete(oldName, { scope: 'chat' }).catch(() => {});
            const opacity = Math.max(0.2, Math.min(1, 1 - Number(cachedPrefs.bgDim ?? 35) / 140));
            await tavo.chat.update({ background: { image: savedPath, opacity } });
            return savedPath;
        },
        async applyVideoBackground({ base64 }) {
            const prev = cachedState.scene?.videoPath;
            const nextName = prev?.endsWith('bg-a.mp4') ? 'clodex-rp-bg-b.mp4' : 'clodex-rp-bg-a.mp4';
            const oldName = nextName === 'clodex-rp-bg-a.mp4' ? 'clodex-rp-bg-b.mp4' : 'clodex-rp-bg-a.mp4';
            const savedPath = await tavo.file.save(nextName, base64, { encoding: 'base64', scope: 'chat' });
            await tavo.file.delete(oldName, { scope: 'chat' }).catch(() => {});
            return savedPath;
        },
        async clearSceneBackground() {
            await tavo.chat.update({ background: null }).catch(() => {});
            for (const f of ['clodex-rp-bg-a.png', 'clodex-rp-bg-b.png', 'clodex-rp-bg-a.mp4', 'clodex-rp-bg-b.mp4']) {
                await tavo.file.delete(f, { scope: 'chat' }).catch(() => {});
            }
        },
        async loadCurrentSceneImageDataUrl(currentPath) {
            const target = currentPath !== undefined ? String(currentPath ?? '') : String(cachedState.scene?.imagePath ?? '');
            if (!target) return '';
            if (/^data:image\//i.test(target)) return target;
            if (!await tavo.file.exists(target, { scope: 'chat' }).catch(() => false)) return '';
            const b64 = await tavo.file.load(target, { encoding: 'base64', scope: 'chat' }).catch(() => null);
            return b64 ? `data:image/png;base64,${b64}` : '';
        },
        async saveSpeechAudio({ base64 }) {
            const prev = cachedState.scene?.lastAudioPath;
            const nextName = prev?.endsWith('tts-a.mp3') ? 'clodex-rp-tts-b.mp3' : 'clodex-rp-tts-a.mp3';
            const oldName = nextName === 'clodex-rp-tts-a.mp3' ? 'clodex-rp-tts-b.mp3' : 'clodex-rp-tts-a.mp3';
            const savedPath = await tavo.file.save(nextName, base64, { encoding: 'base64', scope: 'chat' });
            await tavo.file.delete(oldName, { scope: 'chat' }).catch(() => {});
            return savedPath;
        },
        async saveCompanionMedia({ companionId, kind = 'image', blob, base64 } = {}) {
            const safeId = String(companionId || 'main').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'main';
            const ext = kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'png';
            let rawB64 = typeof base64 === 'string' && base64.trim()
                ? base64.replace(/^data:[^;]+;base64,/, '').trim()
                : '';
            if (!rawB64 && blob) {
                rawB64 = await blobToBase64(blob);
            }
            if (!rawB64) throw new Error('Companion media payload is empty.');

            const comp = Array.isArray(cachedState.companions)
                ? cachedState.companions.find(item => item && String(item.id) === String(companionId))
                : null;
            const statePrev = kind === 'video'
                ? comp?.videoPath
                : kind === 'image'
                    ? comp?.portraitPath
                    : '';
            const slotKey = `${safeId}:${ext}`;
            const prev = String(statePrev || lastCompanionMediaSlot[slotKey] || '');
            const nameA = `clodex-comp-${safeId}-a.${ext}`;
            const nameB = `clodex-comp-${safeId}-b.${ext}`;
            const nextName = prev.endsWith(`-a.${ext}`) ? nameB : nameA;
            const oldName = nextName === nameA ? nameB : nameA;

            const savedPath = await tavo.file.save(nextName, rawB64, { encoding: 'base64', scope: 'chat' });
            lastCompanionMediaSlot[slotKey] = nextName;
            await tavo.file.delete(oldName, { scope: 'chat' }).catch(() => {});
            return savedPath;
        },
        playAudioPreview(path) {
            if (!path || typeof Audio !== 'function') return;
            const resolved = bridge.resolveMediaSrc(path);
            const audio = new Audio(resolved);
            audio.play().catch(() => {});
        },
        async importForgedCharacter({ base64Png, fileName, card }) {
            const safeName = String(fileName || 'clodex-forged-card.png').replace(/[^a-zA-Z0-9._-]/g, '_');
            if (tavo.file?.save && tavo.character?.import) {
                const savedPath = await tavo.file.save(safeName, base64Png, { encoding: 'base64', scope: 'chat' });
                return await tavo.character.import(savedPath);
            }
            if (tavo.character?.import) {
                return await tavo.character.import(card);
            }
            throw new Error('tavo.character.import is unavailable in this Tavo version.');
        },
        async exportForgedCharacter({ base64Png, fileName }) {
            const safeName = String(fileName || 'clodex-forged-card.png').replace(/[^a-zA-Z0-9._-]/g, '_');
            await tavo.file.export(safeName, base64Png, { encoding: 'base64' });
        },
        loadHudPosition: () => cachedPrefs.hudPos,
        saveHudPosition(pos) {
            cachedPrefs.hudPos = pos;
            tavo.variable.set(GLOBAL_PREFS_KEY, cachedPrefs, 'global').catch(() => {});
        },
        getInsets() {
            if (tavo.ui && typeof tavo.ui.getInsets === 'function') {
                return tavo.ui.getInsets();
            }
            return { topBar: 48, bottomInput: 68 };
        },
        onInsetsChange(cb) {
            if (tavo.ui && typeof tavo.ui.onInsetsChanged === 'function') {
                return tavo.ui.onInsetsChanged(() => cb());
            }
            return () => {};
        },
    };

    const controller = createRpStudioController(bridge);

    tavo.plugin.on('clodex-command', async payload => {
        const action = payload?.action;
        if (action === 'open-tracker') controller.openTab('tracker');
        else if (action === 'open-cradle') controller.openTab('cradle');
        else if (action === 'open-codex') controller.openTab('codex');
        else if (action === 'open-forge') controller.openTab('forge');
        else if (action === 'sync-tracker') {
            await controller.syncTrackerFromChat({ checkpointKey: payload?.messageId || '' });
        } else if (action === 'generate-bg') {
            await controller.generateSceneBackground({ auto: false });
        } else if (action === 'speak-reply') {
            await controller.speakLatestReply({ explicitText: payload?.text || '', auto: false });
        }
    });

    tavo.plugin.on('clodex-assistant-turn', async payload => {
        await controller.onAssistantMessageCommitted({ checkpointKey: payload?.messageId || '' });
    });

    tavo.plugin.on('clodex-state-updated', async () => {
        await reloadFromTavo();
        controller.renderAll();
    });
})();
