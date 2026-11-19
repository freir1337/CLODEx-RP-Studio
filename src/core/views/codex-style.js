// CLODEx RP Studio v1.3 — Codex → Style sub-tab view (M2 Anti-Slop radar).
// Pure renderer over slopAnalyze() hits. Phrases come from model replies → text nodes only.
import { vEl } from './director.js';

export const VSTYLE_MODES = Object.freeze(['off', 'highlight', 'inject']);

/**
 * model: { mode, hits: [{ phrase, count, messageCount, builtin }], disabled: string[], rule, analyzed }
 * actions: { onMode(mode), onToggle(phrase, enabled), onRecompute() }
 */
export function vStyleRender(doc, t, model = {}, actions = {}) {
    const mode = VSTYLE_MODES.includes(model.mode) ? model.mode : 'inject';
    const hits = Array.isArray(model.hits) ? model.hits : [];
    const disabled = new Set(Array.isArray(model.disabled) ? model.disabled : []);
    const container = vEl(doc, 'div', { className: 'clodex-rp-style', dataset: { rpView: 'style' } });

    container.append(vEl(doc, 'div', { className: 'clodex-rp-card' },
        vEl(doc, 'h4', { className: 'clodex-rp-card-title' }, `🎯 ${t('slop.title')}`),
        vEl(doc, 'p', { className: 'clodex-rp-muted' }, t('slop.subtitle')),
        vEl(doc, 'div', { className: 'clodex-rp-seg clodex-rp-seg-3 clodex-rp-mt', role: 'radiogroup', 'aria-label': t('slop.modeLabel') },
            ...VSTYLE_MODES.map(m => vEl(doc, 'button', {
                type: 'button',
                className: `clodex-rp-seg-btn${mode === m ? ' active' : ''}`,
                role: 'radio',
                'aria-checked': mode === m ? 'true' : 'false',
                dataset: { rpAction: 'slop-mode', mode: m },
                onClick: () => actions.onMode?.(m),
            }, t(`slop.mode.${m}`))),
        ),
        vEl(doc, 'div', { className: 'clodex-rp-muted clodex-rp-mt' }, t(`slop.modeHint.${mode}`)),
        vEl(doc, 'div', { className: 'clodex-rp-btn-row clodex-rp-mt' },
            vEl(doc, 'button', {
                type: 'button',
                className: 'clodex-rp-btn',
                disabled: mode === 'off',
                dataset: { rpAction: 'slop-recompute' },
                onClick: () => actions.onRecompute?.(),
            }, `🔍 ${t('slop.recompute')}`),
            vEl(doc, 'span', { className: 'clodex-rp-muted' }, t('slop.analyzed', { count: Number(model.analyzed) || 0 })),
        ),
    ));

    const listCard = vEl(doc, 'div', { className: 'clodex-rp-card' },
        vEl(doc, 'h4', { className: 'clodex-rp-card-title' }, `📈 ${t('slop.topTitle')}`),
    );
    if (mode === 'off') {
        listCard.append(vEl(doc, 'div', { className: 'clodex-rp-muted' }, t('slop.offNote')));
    } else if (!hits.length) {
        listCard.append(vEl(doc, 'div', { className: 'clodex-rp-muted' }, t('slop.empty')));
    } else {
        const list = vEl(doc, 'div', { className: 'clodex-rp-list' });
        for (const hit of hits.slice(0, 20)) {
            const phrase = String(hit?.phrase ?? '').slice(0, 80);
            if (!phrase) continue;
            const enabled = !disabled.has(phrase);
            list.append(vEl(doc, 'label', {
                className: `clodex-rp-list-item clodex-rp-slop-item${enabled && mode !== 'off' ? ' is-flagged' : ' is-muted'}`,
            },
            vEl(doc, 'span', { className: 'clodex-rp-check' },
                vEl(doc, 'input', {
                    type: 'checkbox',
                    checked: enabled,
                    dataset: { rpAction: 'slop-toggle', phrase },
                    onChange: e => actions.onToggle?.(phrase, Boolean(e?.target?.checked)),
                }),
                vEl(doc, 'span', { className: 'clodex-rp-slop-phrase', textContent: `«${phrase}»` }),
            ),
            vEl(doc, 'span', { className: 'clodex-rp-muted' },
                `${hit.builtin ? `${t('slop.builtinTag')} · ` : ''}${t('slop.countLabel', {
                    count: Number(hit.count) || 0,
                    messages: Number(hit.messageCount) || 0,
                })}`),
            ));
        }
        listCard.append(list);
    }
    container.append(listCard);

    container.append(vEl(doc, 'div', { className: 'clodex-rp-card' },
        vEl(doc, 'h4', { className: 'clodex-rp-card-title' }, `🧾 ${t('slop.ruleTitle')}`),
        mode === 'inject' && model.rule
            ? vEl(doc, 'div', { className: 'clodex-rp-subbox clodex-rp-slop-rule', textContent: String(model.rule) })
            : vEl(doc, 'div', { className: 'clodex-rp-muted' }, mode === 'inject' ? t('slop.ruleEmpty') : t('slop.ruleInactive')),
        vEl(doc, 'p', { className: 'clodex-rp-muted clodex-rp-mt' }, t('slop.localNote')),
    ));
    return container;
}
