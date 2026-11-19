// CLODEx RP Studio v1.3 — Codex → Wiki sub-tab view (M5).
// Pure renderer: data comes from wikiView(); edits are reported back through actions.
// Every value originating from the background model is inserted as a text node only.
import { vEl } from './director.js';

export const VWIKI_TABLES = Object.freeze([
    Object.freeze({ id: 'npcs', icon: '👤', title: 'name', fields: Object.freeze(['name', 'role', 'attitude', 'appearance', 'lastSeen']) }),
    Object.freeze({ id: 'quests', icon: '🗺️', title: 'title', fields: Object.freeze(['title', 'status', 'note']) }),
    Object.freeze({ id: 'places', icon: '📍', title: 'name', fields: Object.freeze(['name', 'description', 'present']) }),
    Object.freeze({ id: 'timeline', icon: '🕰️', title: 'event', fields: Object.freeze(['date', 'event']) }),
]);

export const VWIKI_STATUSES = Object.freeze(['active', 'done', 'failed']);

const VWIKI_FIELD_MAX = Object.freeze({
    name: 60, title: 80, role: 80, attitude: 90, appearance: 160, lastSeen: 60,
    status: 10, note: 200, description: 160, present: 120, date: 40, event: 160,
});

export function vWikiRowSummary(t, tableId, row) {
    const s = v => String(v ?? '').trim();
    if (tableId === 'npcs') {
        return [s(row.role), s(row.attitude), s(row.appearance), s(row.lastSeen) ? `⌚ ${s(row.lastSeen)}` : '']
            .filter(Boolean).join(' · ');
    }
    if (tableId === 'quests') {
        const status = VWIKI_STATUSES.includes(row.status) ? t(`wiki.status.${row.status}`) : s(row.status);
        return [status, s(row.note)].filter(Boolean).join(' · ');
    }
    if (tableId === 'places') {
        return [s(row.description), s(row.present) ? `👥 ${s(row.present)}` : ''].filter(Boolean).join(' · ');
    }
    return s(row.date);
}

function vWikiBuildForm(doc, t, table, row, actions, onDone) {
    const draft = { ...(row || {}) };
    const form = vEl(doc, 'div', { className: 'clodex-rp-wiki-form', dataset: { rpView: `wiki-form-${table.id}` } });
    for (const field of table.fields) {
        const max = VWIKI_FIELD_MAX[field] ?? 120;
        let input;
        if (field === 'status') {
            input = vEl(doc, 'select', {
                className: 'clodex-rp-input',
                dataset: { rpField: field },
                onChange: e => { draft.status = String(e?.target?.value ?? 'active'); },
            }, ...VWIKI_STATUSES.map(st => vEl(doc, 'option', {
                value: st,
                selected: (draft.status || 'active') === st,
            }, t(`wiki.status.${st}`))));
        } else {
            input = vEl(doc, max > 100 ? 'textarea' : 'input', {
                type: max > 100 ? undefined : 'text',
                rows: max > 100 ? 2 : undefined,
                className: 'clodex-rp-input',
                maxLength: max,
                value: String(draft[field] ?? ''),
                dataset: { rpField: field },
                onInput: e => { draft[field] = String(e?.target?.value ?? '').slice(0, max); },
            });
        }
        form.append(vEl(doc, 'label', { className: 'clodex-rp-field clodex-rp-mt' },
            vEl(doc, 'span', {}, t(`wiki.field.${field}`)),
            input,
        ));
    }
    form.append(vEl(doc, 'div', { className: 'clodex-rp-btn-row clodex-rp-mt' },
        vEl(doc, 'button', {
            type: 'button',
            className: 'clodex-rp-btn clodex-rp-btn-primary',
            dataset: { rpAction: 'wiki-save', table: table.id },
            onClick: () => {
                const titleVal = String(draft[table.title] ?? '').trim();
                if (!titleVal) return;
                if (table.id === 'quests' && !draft.status) draft.status = 'active';
                actions.onSave?.(table.id, { ...draft, pinned: true });
                onDone?.();
            },
        }, `📌 ${t('wiki.saveRow')}`),
        vEl(doc, 'button', {
            type: 'button',
            className: 'clodex-rp-btn',
            dataset: { rpAction: 'wiki-cancel' },
            onClick: () => onDone?.(),
        }, t('wiki.cancel')),
    ));
    return form;
}

function vWikiRenderRow(doc, t, table, row, actions) {
    const wrap = vEl(doc, 'div', { className: `clodex-rp-wiki-row${row.pinned ? ' is-pinned' : ''}` });
    const titleText = String(row[table.title] ?? '').trim() || '—';
    const summary = vWikiRowSummary(t, table.id, row);
    const view = vEl(doc, 'div', { className: 'clodex-rp-wiki-row-main' },
        vEl(doc, 'div', { className: 'clodex-rp-wiki-row-title' },
            row.pinned ? vEl(doc, 'span', { title: t('wiki.pinnedHint') }, '📌 ') : null,
            vEl(doc, 'strong', { textContent: titleText }),
        ),
        summary ? vEl(doc, 'div', { className: 'clodex-rp-muted', textContent: summary }) : null,
    );
    const btns = vEl(doc, 'div', { className: 'clodex-rp-btn-row' },
        vEl(doc, 'button', {
            type: 'button',
            className: 'clodex-rp-btn-mini',
            title: t('wiki.editRow'),
            'aria-label': t('wiki.editRow'),
            dataset: { rpAction: 'wiki-edit', table: table.id, rowId: String(row.id ?? '') },
            onClick: () => {
                const form = vWikiBuildForm(doc, t, table, row, actions, () => wrap.replaceChildren(view, btns));
                wrap.replaceChildren(form);
            },
        }, '✏️'),
        actions.onRemove ? vEl(doc, 'button', {
            type: 'button',
            className: 'clodex-rp-btn-mini',
            title: t('wiki.removeRow'),
            'aria-label': t('wiki.removeRow'),
            dataset: { rpAction: 'wiki-remove', table: table.id, rowId: String(row.id ?? '') },
            onClick: () => actions.onRemove(table.id, row),
        }, '🗑') : null,
    );
    wrap.append(view, btns);
    return wrap;
}

/**
 * model: { view: { npcs, quests, places, timeline }, enabled, every, busy, status, canRefresh }
 * actions: { onRefresh(), onSave(table,row), onRemove(table,row), onToggleEnabled(bool), onEvery(n) }
 */
export function vWikiRender(doc, t, model = {}, actions = {}) {
    const view = model.view && typeof model.view === 'object' ? model.view : {};
    const container = vEl(doc, 'div', { className: 'clodex-rp-wiki', dataset: { rpView: 'wiki' } });
    const every = Math.max(4, Math.min(20, Number(model.every) || 8));

    container.append(vEl(doc, 'div', { className: 'clodex-rp-card' },
        vEl(doc, 'h4', { className: 'clodex-rp-card-title' }, `📚 ${t('wiki.title')}`),
        vEl(doc, 'p', { className: 'clodex-rp-muted' }, t('wiki.subtitle', { every })),
        vEl(doc, 'div', { className: 'clodex-rp-btn-row clodex-rp-mt' },
            vEl(doc, 'button', {
                type: 'button',
                className: 'clodex-rp-btn clodex-rp-btn-primary',
                disabled: Boolean(model.busy),
                dataset: { rpAction: 'wiki-refresh' },
                onClick: () => actions.onRefresh?.(),
            }, model.busy ? `⏳ ${t('wiki.refreshing')}` : `🔄 ${t('wiki.refreshNow')}`),
            vEl(doc, 'label', { className: 'clodex-rp-check' },
                vEl(doc, 'input', {
                    type: 'checkbox',
                    checked: model.enabled !== false,
                    dataset: { rpAction: 'wiki-enabled' },
                    onChange: e => actions.onToggleEnabled?.(Boolean(e?.target?.checked)),
                }),
                vEl(doc, 'span', {}, t('wiki.autoUpdate')),
            ),
            vEl(doc, 'label', { className: 'clodex-rp-check' },
                vEl(doc, 'span', {}, t('wiki.every')),
                vEl(doc, 'input', {
                    type: 'number',
                    min: 4,
                    max: 20,
                    className: 'clodex-rp-input clodex-rp-input-num',
                    value: every,
                    dataset: { rpAction: 'wiki-every' },
                    onChange: e => actions.onEvery?.(Math.max(4, Math.min(20, Number(e?.target?.value) || 8))),
                }),
            ),
        ),
        model.status ? vEl(doc, 'div', { className: 'clodex-rp-badge-line clodex-rp-mt', textContent: String(model.status) }) : null,
        vEl(doc, 'p', { className: 'clodex-rp-muted clodex-rp-mt' }, t('wiki.costNote')),
    ));

    for (const table of VWIKI_TABLES) {
        const rows = Array.isArray(view[table.id]) ? view[table.id] : [];
        const ordered = table.id === 'timeline' ? [...rows].reverse() : rows;
        const card = vEl(doc, 'div', { className: 'clodex-rp-card', dataset: { rpView: `wiki-${table.id}` } });
        const list = vEl(doc, 'div', { className: 'clodex-rp-list' });
        const addBtn = vEl(doc, 'button', {
            type: 'button',
            className: 'clodex-rp-btn-mini',
            dataset: { rpAction: 'wiki-add', table: table.id },
            onClick: () => {
                const holder = vEl(doc, 'div', { className: 'clodex-rp-wiki-row' });
                holder.append(vWikiBuildForm(doc, t, table, table.id === 'quests' ? { status: 'active' } : {}, actions, () => holder.remove?.()));
                list.prepend ? list.prepend(holder) : list.append(holder);
            },
        }, `＋ ${t('wiki.addRow')}`);
        card.append(vEl(doc, 'div', { className: 'clodex-rp-wiki-head' },
            vEl(doc, 'h4', { className: 'clodex-rp-card-title' }, `${table.icon} ${t(`wiki.table.${table.id}`)} (${rows.length})`),
            addBtn,
        ));
        if (!ordered.length) {
            list.append(vEl(doc, 'div', { className: 'clodex-rp-muted' }, t('wiki.emptyTable')));
        } else {
            for (const row of ordered.slice(0, 150)) {
                if (row && typeof row === 'object') list.append(vWikiRenderRow(doc, t, table, row, actions));
            }
        }
        card.append(list);
        container.append(card);
    }
    return container;
}
