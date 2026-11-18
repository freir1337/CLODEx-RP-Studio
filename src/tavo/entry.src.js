/* global tavo */
import { createChatState, normalizeChatState, restoreCheckpointBefore } from '../core/physiology.js';
import { buildSystemContext } from '../core/prompts.js';

const CHAT_VAR_KEY = 'clodex_rp_state';
const GLOBAL_PREFS_KEY = 'clodex_rp_prefs';

async function loadStateWithDefaults() {
    const raw = await tavo.variable.get(CHAT_VAR_KEY);
    if (raw && typeof raw === 'object') return normalizeChatState(raw);
    const fresh = createChatState();
    fresh.world.enableVitals = tavo.plugin.config.get('enableVitals') !== false;
    fresh.world.enableAdultBiology = Boolean(tavo.plugin.config.get('enableAdultBio'));
    return fresh;
}

tavo.plugin.onInputAction('toggle-studio', async () => {
    tavo.plugin.emit('clodex-command', { action: 'open-tracker' });
});

tavo.plugin.onInputAction('ask-codex', async () => {
    tavo.plugin.emit('clodex-command', { action: 'open-codex' });
});

tavo.plugin.onSidebarAction('open-studio', async () => {
    tavo.plugin.emit('clodex-command', { action: 'open-tracker' });
});

tavo.plugin.onSidebarAction('open-forge', async () => {
    tavo.plugin.emit('clodex-command', { action: 'open-forge' });
});

tavo.plugin.onSidebarAction('sync-tracker', async () => {
    tavo.plugin.emit('clodex-command', { action: 'sync-tracker' });
});

tavo.plugin.onSidebarAction('generate-bg', async () => {
    tavo.plugin.emit('clodex-command', { action: 'generate-bg' });
});

tavo.plugin.onLastMessageAction('speak-last-turn', async ({ messageId }) => {
    const msg = messageId && tavo.message?.get
        ? await tavo.message.get(messageId).catch(() => null)
        : null;
    tavo.plugin.emit('clodex-command', {
        action: 'speak-reply',
        text: String(msg?.content ?? ''),
    });
});

tavo.plugin.onLastMessageAction('sync-last-turn', async ({ messageId }) => {
    tavo.plugin.emit('clodex-command', { action: 'sync-tracker', messageId: String(messageId ?? '') });
});

tavo.plugin.on('generation:prepare', async event => {
    if (typeof event.addContext !== 'function') return;
    const prefs = (await tavo.variable.get(GLOBAL_PREFS_KEY, 'global')) ?? {};
    const injectAllowed = prefs.injectContext !== undefined
        ? Boolean(prefs.injectContext)
        : tavo.plugin.config.get('injectContext') !== false;
    if (!injectAllowed) return;

    const [state, chat] = await Promise.all([
        loadStateWithDefaults(),
        tavo.chat.current().catch(() => null),
    ]);
    const charName = chat?.characters?.[0]?.name || '{{char}}';
    const userName = chat?.persona?.name || '{{user}}';
    const block = buildSystemContext(state, { userName, charName });
    if (block) {
        event.addContext({
            text: block,
            role: 'system',
            position: { type: 'afterMainPrompt' },
        });
    }
});

tavo.plugin.on('message:added', async event => {
    if (event.message?.role !== 'assistant') return;
    tavo.plugin.emit('clodex-assistant-turn', {
        messageId: String(event.message.id ?? ''),
    });
});

tavo.plugin.on('message:deleted', async event => {
    const id = String(event.message?.id ?? '');
    if (!id) return;
    const state = await loadStateWithDefaults();
    if (restoreCheckpointBefore(state, id)) {
        await tavo.variable.set(CHAT_VAR_KEY, state);
        tavo.plugin.emit('clodex-state-updated', {});
    }
});

tavo.plugin.on('chat:opened', async () => {
    tavo.plugin.emit('clodex-state-updated', {});
});
