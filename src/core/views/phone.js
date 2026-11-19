// CLODEx RP Studio v1.3 — Smartphone / Diary & World Feed screen (M4).
// Click-to-Reveal: this view never triggers paid requests by itself; it only reports clicks.
// All author/text strings come from the background model → rendered as text nodes only.
import { vEl } from './director.js';

export const VPHONE_SECTIONS = Object.freeze([
    Object.freeze({ id: 'notes', icon: '📝', kinds: Object.freeze(['note', 'dm']) }),
    Object.freeze({ id: 'feed', icon: '🌐', kinds: Object.freeze(['feed']) }),
    Object.freeze({ id: 'media', icon: '📷', kinds: Object.freeze(['photo', 'voice']) }),
]);

export const VPHONE_SKINS = Object.freeze(['auto', 'smartphone', 'grimoire']);

const VPHONE_KIND_ICONS = Object.freeze({ note: '📝', dm: '💬', feed: '🌐', photo: '📷', voice: '🎙' });

export function vPhoneVoiceDuration(entry) {
    const words = String(entry?.text ?? '').trim().split(/\s+/).filter(Boolean).length;
    const secs = Math.max(2, Math.min(59, Math.round(words / 2.4)));
    return `0:${String(secs).padStart(2, '0')}`;
}

export function vPhoneSectionOf(kind) {
    const hit = VPHONE_SECTIONS.find(s => s.kinds.includes(kind));
    return hit ? hit.id : 'notes';
}

function vPhoneRenderEntry(doc, t, entry, model, actions) {
    const kind = VPHONE_KIND_ICONS[entry.kind] ? entry.kind : 'note';
    const isMedia = kind === 'photo' || kind === 'voice';
    const busy = model.busyEntryId && model.busyEntryId === entry.id;
    const item = vEl(doc, 'article', {
        className: `clodex-rp-phone-entry is-${kind}${model.unseenIds?.has?.(entry.id) ? ' is-new' : ''}`,
        dataset: { entryId: String(entry.id ?? '') },
    });

    item.append(vEl(doc, 'header', { className: 'clodex-rp-phone-entry-head' },
        vEl(doc, 'span', { className: 'clodex-rp-phone-kind' }, `${VPHONE_KIND_ICONS[kind]} ${t(`phone.kind.${kind}`)}`),
        vEl(doc, 'strong', { className: 'clodex-rp-phone-author', textContent: String(entry.author ?? '').slice(0, 60) || '—' }),
    ));

    if (isMedia) {
        const src = entry.mediaPath ? (model.resolveSrc?.(entry.mediaPath) || entry.mediaPath) : '';
        if (src && kind === 'photo') {
            item.append(vEl(doc, 'img', {
                className: 'clodex-rp-phone-photo',
                src,
                alt: t('phone.photoAlt'),
                loading: 'lazy',
            }));
        } else if (src && kind === 'voice') {
            item.append(vEl(doc, 'audio', { className: 'clodex-rp-audio', controls: true, src }));
        } else {
            const duration = (typeof model.voiceDuration === 'function' ? model.voiceDuration(entry) : '') || vPhoneVoiceDuration(entry);
            item.append(vEl(doc, 'button', {
                type: 'button',
                className: 'clodex-rp-phone-reveal',
                disabled: Boolean(model.busyEntryId),
                title: t('phone.revealHint'),
                dataset: { rpAction: 'phone-reveal', entryId: String(entry.id ?? '') },
                onClick: () => actions.onReveal?.(entry),
            },
            busy
                ? `⏳ ${t('phone.revealing')}`
                : kind === 'photo'
                    ? `📷 ${t('phone.hiddenPhoto')}`
                    : `🎙 ${t('phone.hiddenVoice', { duration })}`,
            vEl(doc, 'span', { className: 'clodex-rp-phone-paid' }, ` · ${t('phone.paidTag')}`)));
        }
        // Caption / transcript stays hidden until the player explicitly reveals (pays for) the media.
        if (entry.text && src) {
            item.append(vEl(doc, 'p', { className: 'clodex-rp-phone-text', textContent: String(entry.text).slice(0, 600) }));
        }
    } else {
        item.append(vEl(doc, 'p', { className: 'clodex-rp-phone-text', textContent: String(entry.text ?? '').slice(0, 600) }));
    }

    item.append(vEl(doc, 'div', { className: 'clodex-rp-btn-row clodex-rp-mt' },
        vEl(doc, 'button', {
            type: 'button',
            className: 'clodex-rp-btn-mini',
            title: t('phone.presentHint'),
            dataset: { rpAction: 'phone-present', entryId: String(entry.id ?? '') },
            onClick: () => actions.onPresent?.(entry),
        }, `📎 ${t('phone.present')}`),
    ));
    return item;
}

/**
 * model: { entries (old→new), unseen, unseenIds:Set, section, skin, resolvedSkin, busyEntryId,
 *          charName, resolveSrc(path), voiceDuration(entry), pendingHint }
 * actions: { onSection(id), onSkin(skin), onReveal(entry), onPresent(entry), onClose() }
 */
export function vPhoneRender(doc, t, model = {}, actions = {}) {
    const entries = Array.isArray(model.entries) ? model.entries.filter(e => e && typeof e === 'object') : [];
    const section = VPHONE_SECTIONS.some(s => s.id === model.section) ? model.section : 'notes';
    const resolvedSkin = model.resolvedSkin === 'grimoire' ? 'grimoire' : 'smartphone';
    const skin = VPHONE_SKINS.includes(model.skin) ? model.skin : 'auto';

    const screen = vEl(doc, 'div', {
        className: `clodex-rp-phone is-${resolvedSkin}`,
        dataset: { rpView: 'phone', skin: resolvedSkin },
    });

    screen.append(vEl(doc, 'div', { className: 'clodex-rp-phone-top' },
        vEl(doc, 'strong', { className: 'clodex-rp-phone-title' },
            resolvedSkin === 'grimoire'
                ? `📜 ${t('phone.titleGrimoire', { char: model.charName || '{{char}}' })}`
                : `📱 ${t('phone.titleSmartphone', { char: model.charName || '{{char}}' })}`),
        vEl(doc, 'label', { className: 'clodex-rp-phone-skin' },
            vEl(doc, 'span', { className: 'clodex-rp-muted' }, t('phone.skinLabel')),
            vEl(doc, 'select', {
                className: 'clodex-rp-input',
                dataset: { rpAction: 'phone-skin' },
                onChange: e => actions.onSkin?.(String(e?.target?.value ?? 'auto')),
            }, ...VPHONE_SKINS.map(s => vEl(doc, 'option', { value: s, selected: s === skin }, t(`phone.skin.${s}`)))),
        ),
    ));

    screen.append(vEl(doc, 'nav', { className: 'clodex-rp-seg clodex-rp-seg-3 clodex-rp-mt' },
        ...VPHONE_SECTIONS.map(s => {
            const count = entries.filter(e => s.kinds.includes(e.kind)).length;
            return vEl(doc, 'button', {
                type: 'button',
                className: `clodex-rp-seg-btn${section === s.id ? ' active' : ''}`,
                dataset: { rpAction: 'phone-section', section: s.id },
                onClick: () => actions.onSection?.(s.id),
            }, `${s.icon} ${t(`phone.section.${s.id}`)}${count ? ` (${count})` : ''}`);
        }),
    ));

    if (model.pendingHint) {
        screen.append(vEl(doc, 'div', { className: 'clodex-rp-banner clodex-rp-mt' },
            vEl(doc, 'span', {}, `📎 ${t('phone.presentArmed')}`)));
    }

    const current = VPHONE_SECTIONS.find(s => s.id === section);
    const visible = entries.filter(e => current.kinds.includes(e.kind)).reverse();
    const feed = vEl(doc, 'div', { className: 'clodex-rp-phone-feed clodex-rp-mt' });
    if (!entries.length) {
        feed.append(vEl(doc, 'div', { className: 'clodex-rp-phone-empty' },
            vEl(doc, 'div', { className: 'clodex-rp-phone-empty-icon' }, resolvedSkin === 'grimoire' ? '🕯️' : '📵'),
            vEl(doc, 'strong', {}, t('phone.emptyTitle')),
            vEl(doc, 'p', { className: 'clodex-rp-muted' }, t('phone.emptyBody')),
        ));
    } else if (!visible.length) {
        feed.append(vEl(doc, 'div', { className: 'clodex-rp-muted' }, t(`phone.emptySection.${section}`)));
    } else {
        for (const entry of visible) feed.append(vPhoneRenderEntry(doc, t, entry, model, actions));
    }
    screen.append(feed);
    if (section === 'media') {
        screen.append(vEl(doc, 'p', { className: 'clodex-rp-muted clodex-rp-mt' }, t('phone.mediaNote')));
    }
    return screen;
}
