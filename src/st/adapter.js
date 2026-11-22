/**
 * SillyTavern Adapter & Bridge for CLODEx RP Studio
 * Handles ST context, chat storage, Connection Manager profiles, and extension settings UI.
 */

export const MODULE_NAME = 'clodex_rp_studio';
const STORAGE_PREFIX = 'clodex_rp_studio_v1:';
const SETTINGS_CONTAINER_ID = 'clodex-rp-studio-extension-settings';

export const DEFAULT_SETTINGS = {
    enabled: true,
    language: 'ru',

    // SillyTavern Connection Profiles ('' = Current active SillyTavern API)
    stTextProfileId: '',
    stCodexProfileId: '',

    // Text Model Overrides (optional, leave empty to use ST preset model)
    textProvider: 'st_default',
    textApiUrl: '',
    textApiKey: '',
    textModel: '',
    codexModel: '',

    // Image Generation Settings (Dedicated Custom / OpenAI-compatible / Proxy endpoint)
    imageApiUrl: '',
    imageApiKey: '',
    imageModel: 'dall-e-3',

    // Scene Generation Preferences
    promptStyle: 'illustrious',
    appearance: '',
    sceneStyle: 'After peak intimacy, warm glow',
    imageRatio: '1:1',
    imageQuality: 'standard',

    // Companion / Familiar
    familiarType: 'cat',
    familiarName: 'Familiar',

    // Automation Toggles
    autoTrack: true,
    autoCodex: false,
    autoImagePrompt: false,
    customPrompt: '',

    // Theme & Layout
    customTheme: {
        bg: '#0c0a0e',
        text: '#e6d8df',
        accent: '#d48ca6',
        border: '#382b34',
        panel: 'rgba(18, 14, 21, 0.90)',
    },
    panelPosition: null,
    minimizedPosition: null,
    isMinimized: false,
};

/**
 * Safely retrieves SillyTavern context
 */
export function getStContext() {
    try {
        if (typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function') {
            return SillyTavern.getContext();
        }
    } catch (err) {
        console.warn('[CLODEx-RP-Studio] Failed to get SillyTavern context:', err);
    }
    return null;
}

/**
 * Loads and normalizes extension settings
 */
export function getSettings() {
    const context = getStContext();
    const extSettings = context?.extensionSettings || window?.extension_settings;

    if (extSettings) {
        if (!extSettings[MODULE_NAME]) {
            extSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
        }
        const current = extSettings[MODULE_NAME];
        for (const [key, val] of Object.entries(DEFAULT_SETTINGS)) {
            if (current[key] === undefined) {
                current[key] = typeof val === 'object' && val !== null ? structuredClone(val) : val;
            }
        }
        if (!current.customTheme || typeof current.customTheme !== 'object') {
            current.customTheme = structuredClone(DEFAULT_SETTINGS.customTheme);
        } else {
            for (const [tKey, tVal] of Object.entries(DEFAULT_SETTINGS.customTheme)) {
                if (!current.customTheme[tKey]) current.customTheme[tKey] = tVal;
            }
        }
        // Clear legacy default Claude model string if user hasn't explicitly configured custom text API
        if (current.textModel === 'claude-3-7-sonnet-20250219' && !current.textApiUrl) {
            current.textModel = '';
        }
        return current;
    }

    try {
        const raw = localStorage.getItem(`${STORAGE_PREFIX}settings`);
        if (raw) {
            const parsed = JSON.parse(raw);
            return {
                ...structuredClone(DEFAULT_SETTINGS),
                ...parsed,
                customTheme: {
                    ...structuredClone(DEFAULT_SETTINGS.customTheme),
                    ...(parsed.customTheme || {}),
                },
            };
        }
    } catch (err) {
        console.warn('[CLODEx-RP-Studio] Failed reading settings from localStorage:', err);
    }

    return structuredClone(DEFAULT_SETTINGS);
}

/**
 * Saves extension settings
 */
export function saveSettings(partial = {}) {
    const context = getStContext();
    const current = getSettings();

    Object.assign(current, partial);
    if (partial.customTheme) {
        current.customTheme = {
            ...DEFAULT_SETTINGS.customTheme,
            ...current.customTheme,
            ...partial.customTheme,
        };
    }

    const extSettings = context?.extensionSettings || window?.extension_settings;
    if (extSettings) {
        extSettings[MODULE_NAME] = current;
    }

    if (typeof context?.saveSettingsDebounced === 'function') {
        context.saveSettingsDebounced();
    } else if (typeof window?.saveSettingsDebounced === 'function') {
        window.saveSettingsDebounced();
    }

    try {
        localStorage.setItem(`${STORAGE_PREFIX}settings`, JSON.stringify(current));
    } catch (err) {
        console.warn('[CLODEx-RP-Studio] Failed saving settings to localStorage:', err);
    }

    return current;
}

/**
 * Resets extension settings to defaults
 */
export function resetSettings() {
    const fresh = structuredClone(DEFAULT_SETTINGS);
    return saveSettings(fresh);
}

/**
 * Checks if a string looks like HTML page markup rather than chat text
 */
function isHtmlLikeString(str) {
    if (!str || typeof str !== 'string') return false;
    const trimmed = str.trim();
    if (/^<!DOCTYPE\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return true;
    if (/<(head|body|script|style|meta|link)\b/i.test(trimmed)) return true;
    return false;
}

/**
 * Strips raw HTML tags while preserving readable text
 */
function sanitizePossibleHtmlText(str) {
    if (!str || typeof str !== 'string') return '';
    if (isHtmlLikeString(str)) return '';
    return str
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .trim();
}

/**
 * Extracts message text from a SillyTavern chat message entry
 */
function extractMessageText(msg) {
    if (!msg || typeof msg !== 'object') return '';
    const raw =
        typeof msg.mes === 'string'
            ? msg.mes
            : typeof msg.message === 'string'
              ? msg.message
              : typeof msg.content === 'string'
                ? msg.content
                : '';
    return sanitizePossibleHtmlText(raw);
}

/**
 * Retrieves normalized recent chat messages from SillyTavern
 */
export function getChatMessages(limit = 20) {
    const context = getStContext();
    const rawChat = Array.isArray(context?.chat) ? context.chat : [];
    const results = [];

    for (let i = 0; i < rawChat.length; i++) {
        const item = rawChat[i];
        if (!item || item.is_system) continue;
        const mes = extractMessageText(item);
        if (!mes) continue;

        results.push({
            index: i,
            name: item.name || (item.is_user ? 'User' : 'Character'),
            is_user: Boolean(item.is_user),
            mes,
        });
    }

    if (limit > 0 && results.length > limit) {
        return results.slice(-limit);
    }
    return results;
}

/**
 * Returns active character name
 */
export function getActiveCharacterName() {
    const context = getStContext();
    if (!context) return '';
    if (context.name2) return String(context.name2);
    const charId = context.characterId;
    if (charId !== undefined && charId !== null && Array.isArray(context.characters)) {
        return context.characters[charId]?.name || '';
    }
    return '';
}

/**
 * Returns current character avatar URL if available
 */
export function getCurrentCharacterAvatar() {
    const context = getStContext();
    if (!context) return '';

    try {
        const charId = context.characterId;
        if (charId !== undefined && charId !== null && Array.isArray(context.characters)) {
            const char = context.characters[charId];
            if (char?.avatar) {
                if (typeof context.getThumbnailUrl === 'function') {
                    return context.getThumbnailUrl('avatar', char.avatar);
                }
                return `/characters/${encodeURIComponent(char.avatar)}`;
            }
        }
    } catch {
        // Fallback to DOM check
    }

    const avatarImg = document.querySelector('#avatar_load_preview, .mes:not([is_user="true"]) .avatar img');
    if (avatarImg && avatarImg.src) return avatarImg.src;
    return '';
}

/**
 * Builds unique chat ID for local state persistence
 */
export function getChatId() {
    const context = getStContext();
    if (typeof context?.getCurrentChatId === 'function') {
        const id = context.getCurrentChatId();
        if (id) return String(id);
    }
    if (context?.chatId) return String(context.chatId);
    const charName = getActiveCharacterName() || 'default_char';
    const group = context?.groupId ? `group_${context.groupId}` : charName;
    return `${group}_chat`;
}

function getStorageKey(chatId = getChatId()) {
    return `${STORAGE_PREFIX}chat_state:${chatId}`;
}

export function loadChatState(chatId = getChatId()) {
    try {
        const raw = localStorage.getItem(getStorageKey(chatId));
        if (raw) return JSON.parse(raw);
    } catch (err) {
        console.warn('[CLODEx-RP-Studio] Failed loading chat state:', err);
    }
    return null;
}

export function saveChatState(state, chatId = getChatId()) {
    try {
        localStorage.setItem(getStorageKey(chatId), JSON.stringify(state));
        return true;
    } catch (err) {
        console.warn('[CLODEx-RP-Studio] Failed saving chat state:', err);
        return false;
    }
}

export function clearChatState(chatId = getChatId()) {
    try {
        localStorage.removeItem(getStorageKey(chatId));
        return true;
    } catch (err) {
        console.warn('[CLODEx-RP-Studio] Failed clearing chat state:', err);
        return false;
    }
}

/**
 * Lists available SillyTavern Connection Manager profiles
 */
export function getStProfiles() {
    const context = getStContext();
    const profiles =
        context?.extensionSettings?.connectionManager?.profiles ||
        window?.extension_settings?.connectionManager?.profiles ||
        [];

    if (!Array.isArray(profiles)) return [];

    return profiles
        .filter((p) => p && typeof p === 'object' && p.id)
        .map((p) => ({
            id: String(p.id),
            name: String(p.name || p.id),
            api: String(p.api || ''),
            model: String(p.model || ''),
        }));
}

/**
 * Returns default base URL for image generation fallback
 */
export function getImageBaseUrl() {
    const settings = getSettings();
    if (settings.imageApiUrl && settings.imageApiUrl.trim()) {
        return settings.imageApiUrl.trim().replace(/\/+$/, '');
    }
    return `${window.location.origin}/api/openai/v1`;
}

/**
 * Extracts usable text or JSON from any SillyTavern / LLM response structure,
 * including reasoning fields (reasoning, reasoning_content) when content is empty.
 */
function extractTextFromStResponse(res, jsonMode = false) {
    if (!res) return '';
    if (typeof res === 'string') return res.trim();

    if (typeof res === 'object') {
        const directContent =
            res.content ??
            res.text ??
            res.response ??
            res.message?.content ??
            res.choices?.[0]?.message?.content ??
            res.choices?.[0]?.text ??
            res.data?.content ??
            '';

        const directReasoning =
            res.reasoning ??
            res.reasoning_content ??
            res.message?.reasoning_content ??
            res.message?.reasoning ??
            res.choices?.[0]?.message?.reasoning_content ??
            res.choices?.[0]?.message?.reasoning ??
            res.data?.reasoning ??
            '';

        const contentStr = typeof directContent === 'string' ? directContent.trim() : '';
        const reasoningStr = typeof directReasoning === 'string' ? directReasoning.trim() : '';

        if (contentStr) {
            // If jsonMode is requested and content has no JSON braces, but reasoning has JSON braces, combine them
            if (jsonMode && !contentStr.includes('{') && reasoningStr.includes('{')) {
                return `${reasoningStr}\n${contentStr}`.trim();
            }
            return contentStr;
        }

        if (reasoningStr) {
            return reasoningStr;
        }
    }

    return '';
}

/**
 * Sends a chat/text completion request through SillyTavern's native connection or Connection Manager profile
 */
export async function sendTextRequestViaSillyTavern({
    profileId = '',
    model = '',
    messages = [],
    temperature = 0.3,
    maxTokens = 1100,
    jsonMode = false,
} = {}) {
    const context = getStContext();
    if (!context) {
        throw new Error('SillyTavern context is not available.');
    }

    const normalizedMessages = (Array.isArray(messages) ? messages : [])
        .map((m) => ({
            role: m?.role === 'system' || m?.role === 'assistant' ? m.role : 'user',
            content: typeof m?.content === 'string' ? m.content.trim() : String(m?.content ?? '').trim(),
        }))
        .filter((m) => m.content.length > 0);

    if (!normalizedMessages.length) {
        throw new Error('No prompt messages provided for generation.');
    }

    // Ensure sufficient token budget so reasoning models (e.g. Boulesis / Gemma / Qwen / DeepSeek)
    // do not run out of tokens inside <think> / reasoning_content before writing the JSON output.
    const requestedTokens = Number(maxTokens) || 1100;
    const safeMaxTokens = jsonMode
        ? Math.max(requestedTokens, 3200)
        : Math.max(requestedTokens, 1024);

    const customModel = typeof model === 'string' ? model.trim() : '';

    // 1. If a specific Connection Manager profile is selected, try ConnectionManagerRequestService
    const cmService = context.ConnectionManagerRequestService || window?.ConnectionManagerRequestService;
    if (profileId && cmService && typeof cmService.sendRequest === 'function') {
        const overridePayload = {};
        if (Number.isFinite(Number(temperature))) {
            overridePayload.temperature = Number(temperature);
        }
        if (customModel) {
            overridePayload.model = customModel;
        }

        try {
            // Try with extractData: false first so we can inspect both content and reasoning_content from raw response
            const rawResponse = await cmService.sendRequest(
                profileId,
                normalizedMessages,
                safeMaxTokens,
                {
                    extractData: false,
                    includePreset: false,
                    includeInstruct: false,
                },
                overridePayload,
            );
            const extracted = extractTextFromStResponse(rawResponse, jsonMode);
            if (extracted) return extracted;
        } catch (firstErr) {
            console.warn('[CLODEx-RP-Studio] ConnectionManager raw request failed, retrying with extractData: true:', firstErr);
            try {
                const fallbackResponse = await cmService.sendRequest(
                    profileId,
                    normalizedMessages,
                    safeMaxTokens,
                    {
                        extractData: true,
                        includePreset: false,
                        includeInstruct: false,
                    },
                );
                const extracted = extractTextFromStResponse(fallbackResponse, jsonMode);
                if (extracted) return extracted;
            } catch (secondErr) {
                console.warn('[CLODEx-RP-Studio] ConnectionManager fallback failed, falling back to default ST generator:', secondErr);
            }
        }
    }

    // Build systemPrompt and userPrompt for SillyTavern's native generation functions
    const systemParts = [];
    const conversationParts = [];

    for (const msg of normalizedMessages) {
        if (msg.role === 'system') {
            systemParts.push(msg.content);
        } else if (msg.role === 'assistant') {
            conversationParts.push(`Assistant:\n${msg.content}`);
        } else {
            conversationParts.push(msg.content);
        }
    }

    const systemPrompt = systemParts.join('\n\n').trim();
    const userPrompt = conversationParts.join('\n\n').trim() || systemPrompt;
    const effectiveSystemPrompt = conversationParts.length > 0 ? systemPrompt : '';

    // 2. Prefer context.generateRawData (modern ST API that returns { content, reasoning } without throwing on empty content)
    if (typeof context.generateRawData === 'function') {
        try {
            const rawData = await context.generateRawData({
                prompt: userPrompt,
                systemPrompt: effectiveSystemPrompt,
                responseLength: safeMaxTokens,
                trimNames: false,
            });
            const extracted = extractTextFromStResponse(rawData, jsonMode);
            if (extracted) {
                if (jsonMode && !extracted.includes('{')) {
                    throw new Error(
                        `Модель потратила все ${safeMaxTokens} токенов на размышления (<think>) и не успела вывести JSON. Увеличьте лимит токенов или отключите Reasoning.`,
                    );
                }
                return extracted;
            }
        } catch (err) {
            console.warn('[CLODEx-RP-Studio] generateRawData warning:', err);
            if (String(err?.message || '').includes('потратила все')) {
                throw err;
            }
        }
    }

    // 3. Fallback to context.generateRaw with modern options object ONLY (never pass positional string arguments)
    if (typeof context.generateRaw === 'function') {
        const res = await context.generateRaw({
            prompt: userPrompt,
            systemPrompt: effectiveSystemPrompt,
            responseLength: safeMaxTokens,
            trimNames: false,
        });
        const extracted = extractTextFromStResponse(res, jsonMode);
        if (extracted) return extracted;

        throw new Error(
            'Модель вернула пустой ответ (все токены ушли в блок размышлений reasoning_content / <think>). Отключите Reasoning или выберите другую модель.',
        );
    }

    // 4. Final fallback to generateQuietPrompt
    if (typeof context.generateQuietPrompt === 'function') {
        const combinedPrompt = [effectiveSystemPrompt, userPrompt].filter(Boolean).join('\n\n');
        const res = await context.generateQuietPrompt({
            quietPrompt: combinedPrompt,
            responseLength: safeMaxTokens,
        });
        const extracted = extractTextFromStResponse(res, jsonMode);
        if (extracted) return extracted;
    }

    throw new Error('В SillyTavern не найден доступный метод генерации текста.');
}

/**
 * Injects a minimalist status section into SillyTavern's Extensions Settings panel
 */
export function mountExtensionSettingsPanel(onToggleEnabled, onOpenSettings) {
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host || document.getElementById(SETTINGS_CONTAINER_ID)) return;

    const settings = getSettings();
    const wrapper = document.createElement('div');
    wrapper.id = SETTINGS_CONTAINER_ID;
    wrapper.className = 'clodex_st_settings_block';
    wrapper.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>CLODEx RP Studio</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content" style="padding: 10px 0;">
                <label class="checkbox_label" style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <input id="clodex-st-enabled-checkbox" type="checkbox" ${settings.enabled ? 'checked' : ''} />
                    <span>Enable CLODEx RP Studio HUD</span>
                </label>
                <button id="clodex-st-open-hud-settings" class="menu_button" type="button" style="width:100%;min-height:38px;">
                    <i class="fa-solid fa-sliders"></i>&nbsp; Open Studio Settings
                </button>
            </div>
        </div>
    `;

    host.appendChild(wrapper);

    const checkbox = wrapper.querySelector('#clodex-st-enabled-checkbox');
    if (checkbox) {
        checkbox.addEventListener('change', (e) => {
            const enabled = Boolean(e.target.checked);
            saveSettings({ enabled });
            if (typeof onToggleEnabled === 'function') onToggleEnabled(enabled);
        });
    }

    const openBtn = wrapper.querySelector('#clodex-st-open-hud-settings');
    if (openBtn) {
        openBtn.addEventListener('click', () => {
            if (typeof onOpenSettings === 'function') onOpenSettings();
        });
    }
}

/**
 * Registers SillyTavern lifecycle & chat events
 */
export function registerStEvents(handlers = {}) {
    const context = getStContext();
    const eventSource = context?.eventSource || window?.eventSource;
    const eventTypes = context?.event_types || context?.eventTypes || window?.event_types || {};

    if (!eventSource || typeof eventSource.on !== 'function') {
        console.warn('[CLODEx-RP-Studio] SillyTavern eventSource not found.');
        return () => {};
    }

    const subscriptions = [];
    const bind = (evtName, fn) => {
        if (!evtName || typeof fn !== 'function') return;
        eventSource.on(evtName, fn);
        subscriptions.push(() => {
            if (typeof eventSource.removeListener === 'function') {
                eventSource.removeListener(evtName, fn);
            } else if (typeof eventSource.off === 'function') {
                eventSource.off(evtName, fn);
            }
        });
    };

    bind(eventTypes.CHAT_CHANGED || 'chat_id_changed', () => {
        if (typeof handlers.onChatChanged === 'function') handlers.onChatChanged();
    });

    bind(eventTypes.MESSAGE_RECEIVED || 'message_received', (data) => {
        if (typeof handlers.onMessageReceived === 'function') handlers.onMessageReceived(data);
    });

    bind(eventTypes.CHARACTER_MESSAGE_RENDERED || 'character_message_rendered', (data) => {
        if (typeof handlers.onCharacterMessageRendered === 'function') handlers.onCharacterMessageRendered(data);
    });

    bind(eventTypes.MESSAGE_SENT || 'message_sent', (data) => {
        if (typeof handlers.onMessageSent === 'function') handlers.onMessageSent(data);
    });

    return () => {
        subscriptions.forEach((unsub) => {
            try {
                unsub();
            } catch {
                // Ignore teardown errors
            }
        });
    };
}

/**
 * Unified Bridge Object consumed by HUD and API modules
 */
export function createStBridge() {
    return {
        getContext: getStContext,
        getSettings,
        saveSettings,
        resetSettings,
        getChatMessages,
        getActiveCharacterName,
        getCurrentCharacterAvatar,
        getChatId,
        loadChatState,
        saveChatState,
        clearChatState,
        getStProfiles,
        getConnectionProfiles: getStProfiles,
        getImageBaseUrl,
        chatViaSt: sendTextRequestViaSillyTavern,
        stChat: sendTextRequestViaSillyTavern,
        mountExtensionSettingsPanel,
        registerStEvents,
    };
                }
