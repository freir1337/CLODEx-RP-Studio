// CLODEx RP Studio v1.3 — ⚒️ → Packs screen (M7 .clodex-pack export / import with preview).
// Packs are data-only; the preview lists what will be added before anything is applied.
import { vEl } from './director.js';

export const VPACK_CONTENT_KEYS = Object.freeze(['meterPacks', 'directorPresets', 'slopPhrases', 'phoneSkin', 'codexPresets']);

export function vPackSummarize(pack) {
    const contents = pack && typeof pack.contents === 'object' && pack.contents ? pack.contents : {};
    const out = {};
    for (const key of VPACK_CONTENT_KEYS) {
        const val = contents[key];
        if (Array.isArray(val)) out[key] = val.length;
        else if (typeof val === 'string' && val) out[key] = val;
        else out[key] = 0;
    }
    return out;
}

/**
 * model: { name, author, preview: { pack, errors } | null, status, busy, counts: { directorPresets, slopPhrases, meterPacks, codexPresets } }
 * actions: { onName(v), onAuthor(v), onExport(), onPickImport(), onConfirmImport(), onCancelImport() }
 */
export function vPackRender(doc, t, model = {}, actions = {}) {
    const container = vEl(doc, 'div', { className: 'clodex-rp-packs', dataset: { rpView: 'packs' } });
    const counts = model.counts && typeof model.counts === 'object' ? model.counts : {};

    container.append(vEl(doc, 'div', { className: 'clodex-rp-card' },
        vEl(doc, 'h4', { className: 'clodex-rp-card-title' }, `📦 ${t('pack.title')}`),
        vEl(doc, 'p', { className: 'clodex-rp-muted' }, t('pack.subtitle')),
        vEl(doc, 'div', { className: 'clodex-rp-grid-2 clodex-rp-mt' },
            vEl(doc, 'label', { className: 'clodex-rp-field' },
                vEl(doc, 'span', {}, t('pack.nameLabel')),
                vEl(doc, 'input', {
                    type: 'text',
                    className: 'clodex-rp-input',
                    maxLength: 80,
                    placeholder: t('pack.namePlaceholder'),
                    value: String(model.name ?? ''),
                    dataset: { rpAction: 'pack-name' },
                    onInput: e => actions.onName?.(String(e?.target?.value ?? '').slice(0, 80)),
                }),
            ),
            vEl(doc, 'label', { className: 'clodex-rp-field' },
                vEl(doc, 'span', {}, t('pack.authorLabel')),
                vEl(doc, 'input', {
                    type: 'text',
                    className: 'clodex-rp-input',
                    maxLength: 40,
                    placeholder: t('pack.authorPlaceholder'),
                    value: String(model.author ?? ''),
                    dataset: { rpAction: 'pack-author' },
                    onInput: e => actions.onAuthor?.(String(e?.target?.value ?? '').slice(0, 40)),
                }),
            ),
        ),
        vEl(doc, 'div', { className: 'clodex-rp-muted clodex-rp-mt' }, t('pack.currentContents', {
            director: Number(counts.directorPresets) || 0,
            slop: Number(counts.slopPhrases) || 0,
            meters: Number(counts.meterPacks) || 0,
            codex: Number(counts.codexPresets) || 0,
        })),
        vEl(doc, 'div', { className: 'clodex-rp-btn-row clodex-rp-mt' },
            vEl(doc, 'button', {
                type: 'button',
                className: 'clodex-rp-btn clodex-rp-btn-primary',
                disabled: Boolean(model.busy),
                dataset: { rpAction: 'pack-export' },
                onClick: () => actions.onExport?.(),
            }, `💾 ${t('pack.exportBtn')}`),
            vEl(doc, 'button', {
                type: 'button',
                className: 'clodex-rp-btn',
                disabled: Boolean(model.busy),
                dataset: { rpAction: 'pack-import' },
                onClick: () => actions.onPickImport?.(),
            }, `📂 ${t('pack.importBtn')}`),
        ),
        model.status ? vEl(doc, 'div', { className: 'clodex-rp-badge-line clodex-rp-mt', textContent: String(model.status) }) : null,
        vEl(doc, 'p', { className: 'clodex-rp-muted clodex-rp-mt' }, t('pack.safetyNote')),
    ));

    const preview = model.preview;
    if (preview) {
        const errors = Array.isArray(preview.errors) ? preview.errors : [];
        const pack = preview.pack;
        const card = vEl(doc, 'div', { className: 'clodex-rp-card clodex-rp-pack-preview', dataset: { rpView: 'pack-preview' } },
            vEl(doc, 'h4', { className: 'clodex-rp-card-title' }, `🔎 ${t('pack.previewTitle')}`),
        );
        if (pack) {
            const sum = vPackSummarize(pack);
            card.append(
                vEl(doc, 'div', {},
                    vEl(doc, 'strong', { textContent: String(pack.name ?? '').slice(0, 80) || '—' }),
                    pack.author ? vEl(doc, 'span', { className: 'clodex-rp-muted', textContent: ` · ${String(pack.author).slice(0, 40)}` }) : null,
                ),
                vEl(doc, 'ul', { className: 'clodex-rp-pack-list' },
                    ...VPACK_CONTENT_KEYS.map(key => vEl(doc, 'li', {},
                        `${t(`pack.content.${key}`)}: `,
                        vEl(doc, 'strong', {
                            textContent: key === 'phoneSkin'
                                ? (sum.phoneSkin ? t(`phone.skin.${['auto', 'smartphone', 'grimoire'].includes(sum.phoneSkin) ? sum.phoneSkin : 'auto'}`) : '—')
                                : String(sum[key] || 0),
                        }),
                    )),
                ),
            );
        }
        const removed = Array.isArray(preview.removed) ? preview.removed : [];
        if (pack && removed.length) {
            card.append(vEl(doc, 'div', { className: 'clodex-rp-badge-line clodex-rp-mt clodex-rp-pack-removed' },
                vEl(doc, 'span', {}, `🧹 ${t('pack.removedFields', { count: removed.length })}: `),
                vEl(doc, 'span', { textContent: removed.slice(0, 12).map(r => String(r).slice(0, 40)).join(', ') }),
            ));
        }
        if (errors.length) {
            card.append(vEl(doc, 'div', { className: 'clodex-rp-error clodex-rp-pack-errors' },
                vEl(doc, 'strong', {}, pack ? t('pack.warningsTitle') : t('pack.rejectedTitle')),
                vEl(doc, 'ul', {}, ...errors.slice(0, 8).map(err => vEl(doc, 'li', { textContent: String(err).slice(0, 160) }))),
            ));
        }
        card.append(vEl(doc, 'div', { className: 'clodex-rp-btn-row clodex-rp-mt' },
            pack ? vEl(doc, 'button', {
                type: 'button',
                className: 'clodex-rp-btn clodex-rp-btn-primary',
                dataset: { rpAction: 'pack-confirm' },
                onClick: () => actions.onConfirmImport?.(),
            }, `✅ ${t('pack.confirmBtn')}`) : null,
            vEl(doc, 'button', {
                type: 'button',
                className: 'clodex-rp-btn',
                dataset: { rpAction: 'pack-cancel' },
                onClick: () => actions.onCancelImport?.(),
            }, t('pack.cancelBtn')),
        ));
        container.append(card);
    }
    return container;
}
