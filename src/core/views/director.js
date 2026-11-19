// CLODEx RP Studio v1.3 — Director strip view (M1) + shared safe DOM helper for all views.
// Flat-bundler rules: only `export function` / `export const`, unique top-level names (vEl, vDir*).
// All LLM / user-provided strings are rendered as text nodes or textContent — never innerHTML.

const VDIR_BLOCKED_PROPS = Object.freeze(['innerHTML', 'outerHTML', 'srcdoc', 'insertAdjacentHTML']);

export function vEl(doc, tag, props = {}, ...children) {
    const node = doc.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
        if (v === undefined || v === null || v === false && k !== 'checked' && k !== 'disabled' && k !== 'hidden') continue;
        if (VDIR_BLOCKED_PROPS.includes(k)) continue;
        if (k === 'className') node.className = v;
        else if (k === 'textContent') node.textContent = String(v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') {
            node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k in node) {
            node[k] = v;
        } else {
            node.setAttribute(k, String(v));
        }
    }
    for (const child of children.flat()) {
        if (child === null || child === undefined || child === false) continue;
        node.append(typeof child === 'string' || typeof child === 'number' ? doc.createTextNode(String(child)) : child);
    }
    return node;
}

export function vDirPresetLabel(t, preset) {
    if (!preset || typeof preset !== 'object') return '';
    if (preset.labelKey) {
        const viaKey = t(preset.labelKey);
        if (viaKey && viaKey !== preset.labelKey) return viaKey;
    }
    if (preset.id) {
        const key = `director.preset.${preset.id}`;
        const viaId = t(key);
        if (viaId && viaId !== key) return viaId;
    }
    return String(preset.label || preset.name || preset.id || '').slice(0, 48);
}

export function vDirActiveCount(director) {
    const ids = Array.isArray(director?.activeIds) ? director.activeIds.length : 0;
    const note = String(director?.customNote ?? '').trim() ? 1 : 0;
    return ids + note;
}

/**
 * Renders the collapsible director strip shown above the chat composer.
 * model: { presets, customPresets, director: { activeIds, customNote }, expanded, maxActive, noteMax }
 * actions: { onToggleExpand(), onToggle(id), onNote(text), onClear() }
 */
export function vDirRenderBar(doc, t, model = {}, actions = {}) {
    const presets = Array.isArray(model.presets) ? model.presets : [];
    const customPresets = Array.isArray(model.customPresets) ? model.customPresets : [];
    const director = model.director && typeof model.director === 'object' ? model.director : {};
    const activeIds = Array.isArray(director.activeIds) ? director.activeIds : [];
    const note = String(director.customNote ?? '');
    const maxActive = Number(model.maxActive) > 0 ? Number(model.maxActive) : 2;
    const noteMax = Number(model.noteMax) > 0 ? Number(model.noteMax) : 140;
    const expanded = Boolean(model.expanded);
    const count = vDirActiveCount(director);

    const bar = vEl(doc, 'div', {
        className: `clodex-rp-director-bar${expanded ? ' is-open' : ''}${count ? ' is-armed' : ''}`,
        role: 'region',
        'aria-label': t('director.title'),
        dataset: { rpView: 'director' },
    });

    bar.append(vEl(doc, 'button', {
        type: 'button',
        className: 'clodex-rp-director-toggle',
        title: t('director.toggleHint'),
        'aria-expanded': expanded ? 'true' : 'false',
        dataset: { rpAction: 'director-toggle' },
        onClick: () => actions.onToggleExpand?.(),
    },
    `🎬 ${t('director.title')}`,
    count ? vEl(doc, 'span', { className: 'clodex-rp-director-count' }, String(count)) : null,
    vEl(doc, 'span', { className: 'clodex-rp-director-caret' }, expanded ? '▾' : '▴')));

    if (!expanded) return bar;

    const body = vEl(doc, 'div', { className: 'clodex-rp-director-body' });
    body.append(vEl(doc, 'div', { className: 'clodex-rp-muted' }, t('director.hint', { max: maxActive })));

    const chipRow = vEl(doc, 'div', { className: 'clodex-rp-chips clodex-rp-mt' });
    const allPresets = [...presets, ...customPresets.slice(0, 8)];
    for (const preset of allPresets) {
        if (!preset?.id) continue;
        const isActive = activeIds.includes(preset.id);
        const locked = !isActive && activeIds.length >= maxActive;
        chipRow.append(vEl(doc, 'button', {
            type: 'button',
            className: `clodex-rp-chip-btn${isActive ? ' active' : ''}`,
            disabled: locked,
            'aria-pressed': isActive ? 'true' : 'false',
            dataset: { rpAction: 'director-preset', presetId: String(preset.id) },
            onClick: () => actions.onToggle?.(preset.id),
        }, `${preset.emoji ? `${preset.emoji} ` : ''}${vDirPresetLabel(t, preset)}`));
    }
    body.append(chipRow);

    const counter = vEl(doc, 'span', { className: 'clodex-rp-muted clodex-rp-director-counter' }, `${note.length}/${noteMax}`);
    const noteInput = vEl(doc, 'input', {
        type: 'text',
        className: 'clodex-rp-input',
        maxLength: noteMax,
        placeholder: t('director.notePlaceholder'),
        value: note,
        'aria-label': t('director.noteLabel'),
        dataset: { rpAction: 'director-note' },
        onInput: e => {
            const len = String(e?.target?.value ?? '').length;
            counter.textContent = `${Math.min(len, noteMax)}/${noteMax}`;
        },
        onChange: e => actions.onNote?.(String(e?.target?.value ?? '').slice(0, noteMax)),
    });
    body.append(vEl(doc, 'label', { className: 'clodex-rp-field clodex-rp-mt' },
        vEl(doc, 'span', {}, t('director.noteLabel')),
        noteInput,
    ));

    body.append(vEl(doc, 'div', { className: 'clodex-rp-btn-row clodex-rp-mt' },
        counter,
        count ? vEl(doc, 'button', {
            type: 'button',
            className: 'clodex-rp-btn-mini',
            dataset: { rpAction: 'director-clear' },
            onClick: () => actions.onClear?.(),
        }, t('director.clear')) : null,
        vEl(doc, 'span', { className: 'clodex-rp-muted' }, t('director.oneTurn')),
    ));

    bar.append(body);
    return bar;
}
