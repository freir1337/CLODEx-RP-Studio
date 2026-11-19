/* global tavo */
// M3 «Hidden thoughts & action buttons» for Tavo. Mounted by ui/turn.html on
// `/messages/end?role=character&position=last`, i.e. only under the latest
// character reply. Data comes from clodex_rp_state.turnExtras and is shown only
// when turnExtras.turnKey matches this message's current variant. Everything
// produced by the background model is written via textContent only.
import { tavoIsCharacterRole, tavoMessageTurnKey } from './turnkey.js';

(async function bootstrapTavoTurn() {
    const CHAT_VAR_KEY = 'clodex_rp_state';
    const GLOBAL_PREFS_KEY = 'clodex_rp_prefs';
    const mount = document.getElementById('clodex-rp-turn-mount') || document.body;
    const i18n = tavo.plugin?.i18n;
    let renderSeq = 0;

    function t(key, params = {}) {
        try {
            const out = i18n?.t?.(key, params);
            if (typeof out === 'string' && out && out !== key) return out;
        } catch {
            // fall through to built-in fallback
        }
        const ru = String(i18n?.locale || '').toLowerCase().startsWith('ru');
        const fallback = {
            'turn.thoughtsTitle': ru ? '💭 Мысли {char}' : '💭 {char}’s thoughts',
            'turn.reveal': ru ? 'Показать' : 'Reveal',
            'turn.actionsTitle': ru ? 'Что дальше?' : 'What next?',
            'turn.insertHint': ru ? 'Вставить в поле ввода (без отправки)' : 'Insert into the input (not sent)',
        }[key] ?? key;
        return String(fallback).replace(/\{(\w+)\}/g, (m, k) => String(params[k] ?? m));
    }

    function node(tag, { className = '', text = '', title = '' } = {}, ...children) {
        const elNode = document.createElement(tag);
        if (className) elNode.className = className;
        if (text) elNode.textContent = text;
        if (title) elNode.setAttribute?.('title', title);
        for (const child of children) {
            if (child) elNode.append(child);
        }
        return elNode;
    }

    function cleanLine(value, max) {
        return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
    }

    function fragmentMessageId() {
        const candidates = [
            tavo.fragment?.context?.messageId,
            tavo.fragment?.messageId,
            tavo.plugin?.fragment?.context?.messageId,
            tavo.plugin?.fragment?.messageId,
        ];
        try {
            const search = globalThis.location?.search;
            if (search && typeof URLSearchParams === 'function') {
                candidates.push(new URLSearchParams(search).get('messageId'));
            }
        } catch {
            // no location in this runtime
        }
        for (const value of candidates) {
            if (value !== undefined && value !== null && value !== '') return String(value);
        }
        return '';
    }

    async function currentMessage() {
        const id = fragmentMessageId();
        if (id && typeof tavo.message?.get === 'function') {
            const msg = await tavo.message.get(id).catch(() => null);
            if (msg) return { ...msg, id: msg.id ?? id };
        }
        if (typeof tavo.message?.find !== 'function') return null;
        const recent = await tavo.message.find([-4, -1], { hidden: false }).catch(() => []);
        const list = Array.isArray(recent) ? recent : [];
        for (let i = list.length - 1; i >= 0; i -= 1) {
            if (tavoIsCharacterRole(list[i]?.role)) return list[i];
        }
        return null;
    }

    function prefFlag(prefs, key) {
        if (prefs && prefs[key] !== undefined) return prefs[key] !== false;
        const fromConfig = tavo.plugin?.config?.get?.(key);
        return fromConfig === undefined || fromConfig === null ? true : fromConfig !== false;
    }

    function clear() {
        mount.replaceChildren();
        mount.hidden = true;
        if (mount.style) mount.style.display = 'none';
    }

    async function render() {
        const seq = ++renderSeq;
        const [rawState, prefs, chat, msg] = await Promise.all([
            tavo.variable.get(CHAT_VAR_KEY).catch(() => null),
            tavo.variable.get(GLOBAL_PREFS_KEY, 'global').catch(() => null),
            tavo.chat?.current?.().catch(() => null) ?? null,
            currentMessage(),
        ]);
        if (seq !== renderSeq) return;
        const extras = rawState && typeof rawState === 'object' ? rawState.turnExtras : null;
        const turnKey = msg ? tavoMessageTurnKey(msg) : '';
        if (!extras || !extras.turnKey || !turnKey || String(extras.turnKey) !== turnKey) {
            clear();
            return;
        }

        const showThoughts = prefFlag(prefs ?? {}, 'showInnerThoughts');
        const showActions = prefFlag(prefs ?? {}, 'showSuggestedActions');
        const blurred = prefFlag(prefs ?? {}, 'thoughtsBlurred');
        const thought = showThoughts ? cleanLine(extras.innerThought, 160) : '';
        const actions = showActions && Array.isArray(extras.suggestedActions)
            ? extras.suggestedActions.map(a => cleanLine(a, 90)).filter(Boolean).slice(0, 3)
            : [];
        if (!thought && !actions.length) {
            clear();
            return;
        }

        const charName = cleanLine(chat?.characters?.[0]?.name || msg?.name || '{{char}}', 48);
        const blocks = [];
        if (thought) {
            const details = node('details', { className: 'clodex-rp-turn-thoughts' },
                node('summary', { text: t('turn.thoughtsTitle', { char: charName }), title: t('turn.reveal') }),
                node('p', { className: 'clodex-rp-turn-thought', text: thought }),
            );
            details.open = !blurred;
            blocks.push(details);
        }
        if (actions.length) {
            const row = node('div', { className: 'clodex-rp-turn-actions' },
                node('span', { className: 'clodex-rp-turn-actions-title', text: t('turn.actionsTitle') }));
            for (const action of actions) {
                const btn = node('button', { className: 'clodex-rp-turn-btn', text: action, title: t('turn.insertHint') });
                btn.type = 'button';
                btn.addEventListener('click', () => {
                    // Inserts into the composer, never sends.
                    Promise.resolve(tavo.input?.append?.(action)).catch(() => {});
                });
                row.append(btn);
            }
            blocks.push(row);
        }
        mount.replaceChildren(node('div', { className: 'clodex-rp-turn' }, ...blocks));
        mount.hidden = false;
        if (mount.style) mount.style.display = '';
    }

    const rerender = () => {
        render().catch(() => clear());
    };
    for (const type of ['clodex-turn-extras', 'clodex-state-updated', 'message:added', 'message:updated', 'message:deleted', 'chat:opened']) {
        try {
            tavo.plugin.on(type, rerender);
        } catch {
            // event not supported in this context
        }
    }
    try {
        i18n?.onChange?.(rerender);
    } catch {
        // locale change hook unavailable
    }
    await render().catch(() => clear());
})();
