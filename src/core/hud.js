import { base64ToBlob, blobToBase64, ClodexApi, redact, validateKey } from './api.js';
import { normalizeCatalog, pickRecommendedModels, priceView, videoBillingView, walletView } from './catalog.js';
import { buildCodexMessages, CODEX_PRESETS } from './codex.js';
import { formatShortDate, TIME_SLOTS } from './date.js';
import {
    advanceSimulationDays, applyTurnExtraction, BIO_MODES, BOND_TYPES, CONTRACEPTION_TYPES,
    deliverBabies, DISCLOSURE_MODES, getCyclePhase, getVisibleBiologySummary, hatchReadyEggs,
    layEggs, OMEGA_ROLES, SUPPRESSANT_LEVELS, triggerConception,
} from './physiology.js';
import { buildSceneVisualPromptMessages, buildTrackerExtractionMessages, parseTrackerExtraction } from './prompts.js';

const EXORCIST_PRESET_PROMPT = 'Sharp-featured charismatic priest with sculpted jawline and intricate sacred gothic tattoos along neck and hands, wearing a tailored black cassock, holding an ornate silver crucifix aloft during a dramatic exorcism in a candlelit baroque cathedral, swirling incense smoke, golden chiaroscuro lighting, ultra-detailed masterpiece.';

function el(doc, tag, props = {}, ...children) {
    const node = doc.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null) continue;
        if (k === 'className') node.className = v;
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
        node.append(typeof child === 'string' ? doc.createTextNode(child) : child);
    }
    return node;
}

export function createRpStudioController(bridge) {
    const doc = bridge.document ?? globalThis.document;
    const win = doc.defaultView ?? globalThis;
    const t = (key, params) => bridge.t(key, params);

    let drawerOpen = false;
    let activeTab = 'tracker';
    let activeEntityRole = 'char';
    let peekSpoilers = false;
    let busyState = '';
    let sceneStatusText = '';
    let errorBanner = '';
    let codexDraft = '';
    let codexPreset = 'lore_keeper';
    let codexCustomPrompt = '';
    let sceneStyle = 'cinematic';
    let scenePromptDraft = '';
    let woundDraft = '';
    let woundBleedingDraft = true;

    let catalog = [];
    let wallet = null;
    let videoBilling = null;
    let activeAbort = null;

    const api = new ClodexApi({
        getKey: () => bridge.getEffectiveKey(),
        fetchImpl: bridge.fetchImpl ?? globalThis.fetch?.bind(globalThis),
    });

    const hostRoot = el(doc, 'div', { className: 'clodex-rp-root' });
    const backdropEl = el(doc, 'div', { className: 'clodex-rp-video-backdrop', hidden: true });
    const backdropVideo = el(doc, 'video', {
        className: 'clodex-rp-video-el',
        autoplay: true,
        loop: true,
        muted: true,
        playsInline: true,
    });
    const backdropDimEl = el(doc, 'div', { className: 'clodex-rp-video-dim' });
    backdropEl.append(backdropVideo, backdropDimEl);

    const hudPill = el(doc, 'button', {
        type: 'button',
        className: 'clodex-rp-hud-pill',
    });
    const drawerBackdrop = el(doc, 'div', {
        className: 'clodex-rp-drawer-mask',
        hidden: true,
        onClick: e => {
            if (e.target === drawerBackdrop) toggleDrawer(false);
        },
    });
    const drawerPanel = el(doc, 'section', { className: 'clodex-rp-drawer' });
    drawerBackdrop.append(drawerPanel);
    hostRoot.append(backdropEl, hudPill, drawerBackdrop);
    bridge.mountContainer.append(hostRoot);

    // Draggable HUD Pill with mouse & touch support + viewport inset clamping
    let dragState = null;
    function applyPillPosition(pos) {
        const insets = bridge.getInsets?.() ?? { topBar: 10, bottomInput: 64 };
        const vw = Math.max(320, win.innerWidth || 390);
        const vh = Math.max(400, win.innerHeight || 720);
        const rect = hudPill.getBoundingClientRect();
        const pw = Math.max(180, rect.width || 250);
        const ph = Math.max(34, rect.height || 38);
        const minTop = Math.max(6, (insets.topBar || 0) + 8);
        const maxTop = Math.max(minTop, vh - (insets.bottomInput || 56) - ph - 8);

        if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
            hudPill.style.top = `${minTop}px`;
            hudPill.style.left = '50%';
            hudPill.style.transform = 'translateX(-50%)';
            return;
        }
        const clampedX = Math.min(Math.max(8, pos.x), Math.max(8, vw - pw - 8));
        const clampedY = Math.min(Math.max(minTop, pos.y), maxTop);
        hudPill.style.left = `${clampedX}px`;
        hudPill.style.top = `${clampedY}px`;
        hudPill.style.transform = 'none';
    }

    hudPill.addEventListener('pointerdown', event => {
        if (event.button && event.button !== 0) return;
        const rect = hudPill.getBoundingClientRect();
        dragState = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            origLeft: rect.left,
            origTop: rect.top,
            moved: false,
        };
        hudPill.setPointerCapture?.(event.pointerId);
    });

    hudPill.addEventListener('pointermove', event => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;
        if (!dragState.moved && Math.hypot(dx, dy) < 7) return;
        dragState.moved = true;
        applyPillPosition({ x: dragState.origLeft + dx, y: dragState.origTop + dy });
    });

    hudPill.addEventListener('pointerup', event => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        const wasMoved = dragState.moved;
        const rect = hudPill.getBoundingClientRect();
        dragState = null;
        if (wasMoved) {
            bridge.saveHudPosition?.({ x: Math.round(rect.left), y: Math.round(rect.top) });
        } else {
            toggleDrawer(!drawerOpen);
        }
    });

    hudPill.addEventListener('pointercancel', () => {
        dragState = null;
    });

    function toggleDrawer(open) {
        drawerOpen = Boolean(open);
        drawerBackdrop.hidden = !drawerOpen;
        if (drawerOpen) renderDrawer();
    }

    function formatUsd(val) {
        if (typeof val !== 'number' || !Number.isFinite(val)) return '—';
        return new Intl.NumberFormat(bridge.getLocale() === 'ru' ? 'ru-RU' : 'en-US', {
            style: 'currency',
            currency: 'USD',
            maximumFractionDigits: val < 1 ? 4 : 2,
        }).format(val);
    }

    function formatRub(val) {
        if (typeof val !== 'number' || !Number.isFinite(val)) return '';
        return new Intl.NumberFormat('ru-RU', {
            style: 'currency',
            currency: 'RUB',
            maximumFractionDigits: 1,
        }).format(val);
    }

    function formatModelPrice(model) {
        const pv = priceView(model?.price);
        if (!pv) return '';
        if (pv.unit === 'dynamic') return ' · dynamic';
        if (pv.unit === 'request') return ` · ${formatUsd(pv.input)}/req`;
        return ` · ${formatUsd(pv.input)}/1M`;
    }

    function syncVideoBackdrop() {
        const state = bridge.getChatState();
        const settings = bridge.getSettings();
        const dim = Math.min(85, Math.max(0, Number(settings.bgDim ?? 35))) / 100;
        backdropDimEl.style.background = `rgba(8, 10, 16, ${dim})`;

        const videoSrc = bridge.resolveMediaSrc?.(state.scene?.videoPath) || state.scene?.videoPath || '';
        if (videoSrc) {
            if (backdropVideo.getAttribute('src') !== videoSrc) {
                backdropVideo.setAttribute('src', videoSrc);
                backdropVideo.play?.().catch(() => {});
            }
            backdropEl.hidden = false;
        } else {
            backdropVideo.pause?.();
            backdropVideo.removeAttribute('src');
            backdropEl.hidden = true;
        }
    }

    function renderHudPill() {
        const state = bridge.getChatState();
        const hasKey = Boolean(bridge.getEffectiveKey());
        const locale = bridge.getLocale();
        hudPill.setAttribute('title', t('hud.openDrawer'));
        hudPill.setAttribute('aria-label', t('hud.openDrawer'));

        const chips = [];
        const dateStr = formatShortDate(state.world.rpDate, locale);
        const timeStr = t(`time.${state.world.timeOfDay}`);
        chips.push(el(doc, 'span', { className: 'clodex-rp-chip clodex-rp-chip-date' }, `📅 ${dateStr} · ${timeStr}`));

        const primaryRole = state.world.targetMode === 'user' ? 'user' : 'char';
        const entity = state.entities[primaryRole];
        if (state.world.enableVitals && entity) {
            const bleeding = entity.vitals.wounds.some(w => w.bleeding);
            const vitText = bleeding
                ? `🩸 ${t('hud.bleeding')} (${entity.vitals.heartRate})`
                : `❤️ ${entity.vitals.heartRate} ${t('hud.bpm')} · 🫁 ${t(`vitals.resp.${entity.vitals.respiration}`)}`;
            chips.push(el(doc, 'span', {
                className: `clodex-rp-chip ${bleeding ? 'clodex-rp-chip-alert' : ''}`,
            }, vitText));
        }

        if (state.world.enableAdultBiology && entity?.bio?.mode !== 'none') {
            const b = entity.bio;
            const vis = getVisibleBiologySummary(entity, state.world.disclosureMode);
            let bioLabel = '';
            if (b.mode === 'oviposition') {
                if (b.carryingClutch) {
                    bioLabel = `🥚 ${t('hud.clutch', { laid: b.clutchLaid, total: b.clutchTotal })}`;
                } else if (b.nest.active && b.nest.eggs.length) {
                    bioLabel = `🪺 ${t('hud.nest', { count: b.nest.eggs.length })}`;
                } else {
                    bioLabel = `🥚 ${t(`bio.phase.${getCyclePhase(b)}`)}`;
                }
            } else if (b.pregnant && vis.knownPregnant) {
                bioLabel = `🤰 ${t('hud.pregnantWeek', { week: vis.week })}`;
            } else {
                const phase = getCyclePhase(b);
                const icon = phase === 'heat' || phase === 'rut' ? '🔥' : '🌙';
                bioLabel = `${icon} D${b.cycleDay} · ${t(`bio.phase.${phase}`)}`;
            }
            chips.push(el(doc, 'span', { className: 'clodex-rp-chip clodex-rp-chip-bio' }, bioLabel));
        }

        if (state.world.pendingMemoryHint) {
            chips.push(el(doc, 'span', { className: 'clodex-rp-chip clodex-rp-chip-codex' }, `🧠 ${t('hud.memoryArmed')}`));
        }

        if (!hasKey) {
            chips.push(el(doc, 'span', { className: 'clodex-rp-chip clodex-rp-chip-key' }, `🔑 ${t('hud.connectKey')}`));
        } else if (wallet) {
            const rubPart = wallet.rub !== null ? ` (${formatRub(wallet.rub)})` : '';
            chips.push(el(doc, 'span', { className: 'clodex-rp-chip clodex-rp-chip-wallet' }, `💰 ${formatUsd(wallet.usd)}${rubPart}`));
        } else {
            chips.push(el(doc, 'span', { className: 'clodex-rp-chip clodex-rp-chip-wallet' }, '⚡ CLODEx'));
        }

        hudPill.replaceChildren(...chips);
        syncVideoBackdrop();
    }

    async function refreshAccount() {
        const key = bridge.getEffectiveKey();
        if (!key) return;
        validateKey(key);
        errorBanner = '';
        busyState = 'account';
        renderAll();
        try {
            const [modelsRes, quotaRes, pricingRes, statusRes] = await Promise.all([
                api.models(),
                api.quota().catch(() => null),
                api.pricing().catch(() => ({})),
                api.status().catch(() => null),
            ]);
            catalog = normalizeCatalog(modelsRes, pricingRes);
            if (quotaRes) {
                wallet = walletView(quotaRes, statusRes);
                videoBilling = videoBillingView(quotaRes);
            }
            const settings = bridge.getSettings();
            const picked = pickRecommendedModels(catalog, settings);
            await bridge.updateSettings(picked);
        } catch (err) {
            errorBanner = redact(err?.message ?? err, key);
        } finally {
            busyState = '';
            renderAll();
        }
    }

    async function syncTrackerFromChat({ checkpointKey = '', silent = false } = {}) {
        const key = bridge.getEffectiveKey();
        if (!key) {
            if (!silent) {
                activeTab = 'account';
                toggleDrawer(true);
            }
            return false;
        }
        const settings = bridge.getSettings();
        if (!catalog.length) await refreshAccount();
        const model = bridge.getSettings().trackerModel;
        if (!model) {
            if (!silent) errorBanner = 'Select a Tracker model in Key & Models.';
            renderAll();
            return false;
        }
        const rp = await bridge.getRpContext();
        if (!rp.recentMessages?.length) return false;

        busyState = 'tracker';
        errorBanner = '';
        renderAll();
        try {
            const state = bridge.getChatState();
            const messages = buildTrackerExtractionMessages(state, rp.recentMessages, {
                userName: rp.userName,
                charName: rp.charName,
            });
            const raw = await api.chat({ model, messages, temperature: 0.15, maxTokens: 550, jsonMode: true });
            const delta = parseTrackerExtraction(raw);
            applyTurnExtraction(state, delta, { checkpointKey });
            await bridge.saveChatState(state);
            if (!silent) bridge.notify?.(t('notice.trackerUpdated'));
            return true;
        } catch (err) {
            if (!silent) errorBanner = redact(err?.message ?? err, key);
            return false;
        } finally {
            busyState = '';
            renderAll();
        }
    }

    async function runCodexQuery(questionText) {
        const q = String(questionText ?? codexDraft).trim();
        if (!q) return;
        const key = bridge.getEffectiveKey();
        if (!key) {
            activeTab = 'account';
            renderAll();
            return;
        }
        if (!catalog.length) await refreshAccount();
        const settings = bridge.getSettings();
        let model = settings.codexModel;
        if (codexPreset === 'biblical_dante' && catalog.length) {
            const mistralCandidate = catalog.find(m => m.kinds.includes('text') && m.mistral);
            if (mistralCandidate && !model) model = mistralCandidate.id;
        }
        if (!model) model = settings.trackerModel;

        busyState = 'codex';
        errorBanner = '';
        renderAll();
        try {
            const state = bridge.getChatState();
            const rp = await bridge.getRpContext();
            const messages = buildCodexMessages({
                preset: codexPreset,
                customPrompt: codexCustomPrompt,
                question: q,
                history: state.codexHistory,
                charName: rp.charName,
                charDescription: rp.charDescription,
                scenario: rp.scenario,
                recentChat: rp.recentMessages,
                locale: bridge.getLocale(),
            });
            const answer = await api.chat({ model, messages, temperature: 0.45, maxTokens: 900 });
            state.codexHistory.push(
                { role: 'user', content: q, preset: codexPreset, model, at: state.world.rpDate },
                { role: 'assistant', content: answer, preset: codexPreset, model, at: state.world.rpDate },
            );
            state.codexHistory = state.codexHistory.slice(-24);
            codexDraft = '';
            await bridge.saveChatState(state);
        } catch (err) {
            errorBanner = redact(err?.message ?? err, key);
        } finally {
            busyState = '';
            renderAll();
        }
    }

    async function buildOrUseScenePrompt() {
        if (scenePromptDraft.trim()) return scenePromptDraft.trim();
        const rp = await bridge.getRpContext();
        const state = bridge.getChatState();
        const settings = bridge.getSettings();
        const promptModel = settings.trackerModel || settings.codexModel;
        if (promptModel) {
            const msgs = buildSceneVisualPromptMessages({
                charName: rp.charName,
                charDescription: rp.charDescription,
                scenario: rp.scenario,
                location: state.world.location,
                weather: state.world.weather,
                recentMessages: rp.recentMessages,
                stylePreset: sceneStyle,
            });
            const drafted = await api.chat({ model: promptModel, messages: msgs, temperature: 0.5, maxTokens: 240 });
            scenePromptDraft = drafted;
            return drafted;
        }
        return `${rp.charName || 'Character'} in ${state.world.location || 'atmospheric setting'}, ${rp.charDescription?.slice(0, 300) || 'cinematic lighting'}`;
    }

    async function generateSceneBackground({ auto = false } = {}) {
        const key = bridge.getEffectiveKey();
        if (!key) {
            if (!auto) {
                activeTab = 'account';
                toggleDrawer(true);
            }
            return;
        }
        if (!catalog.length) await refreshAccount();
        const settings = bridge.getSettings();
        const model = settings.imageModel;
        if (!model) {
            if (!auto) errorBanner = 'Select an Image model (e.g. Nano Banana) in Key & Models.';
            renderAll();
            return;
        }
        if (!auto && settings.confirmPaid) {
            const ok = await bridge.confirm(t('confirm.paidMedia', { kind: 'Image', model }));
            if (!ok) return;
        }

        activeAbort?.abort();
        const abort = new AbortController();
        activeAbort = abort;
        busyState = 'scene_img';
        sceneStatusText = t('scene.statusGeneratingImg');
        errorBanner = '';
        renderAll();

        try {
            const prompt = await buildOrUseScenePrompt();
            const res = await api.image({ model, prompt }, abort.signal);
            const blob = res.b64_json
                ? base64ToBlob(res.b64_json, 'image/png')
                : await api.downloadImage(res.url, abort.signal);
            const base64 = res.b64_json || await blobToBase64(blob);
            const savedPath = await bridge.applyImageBackground({ blob, base64, prompt });
            const state = bridge.getChatState();
            state.scene.imagePath = savedPath;
            state.scene.imagePrompt = prompt;
            state.scene.turnsSinceAutoImage = 0;
            await bridge.saveChatState(state);
            sceneStatusText = t('scene.statusDone');
            await refreshAccount().catch(() => {});
        } catch (err) {
            if (err?.name !== 'AbortError') errorBanner = redact(err?.message ?? err, key);
            sceneStatusText = '';
        } finally {
            if (activeAbort === abort) activeAbort = null;
            busyState = '';
            renderAll();
        }
    }

    async function generateOrResumeSceneVideo({ resume = false } = {}) {
        const key = bridge.getEffectiveKey();
        if (!key) {
            activeTab = 'account';
            toggleDrawer(true);
            return;
        }
        if (!catalog.length) await refreshAccount();
        const settings = bridge.getSettings();
        const state = bridge.getChatState();
        const model = settings.videoModel;
        if (!resume && !model) {
            errorBanner = 'Select a Video model in Key & Models.';
            renderAll();
            return;
        }
        if (!resume && settings.confirmPaid) {
            const ok = await bridge.confirm(t('confirm.paidMedia', { kind: 'Video', model }));
            if (!ok) return;
        }

        activeAbort?.abort();
        const abort = new AbortController();
        activeAbort = abort;
        busyState = 'scene_vid';
        errorBanner = '';
        renderAll();

        try {
            let taskIdentifier = resume ? state.scene.videoTaskId : '';
            if (!taskIdentifier) {
                const prompt = await buildOrUseScenePrompt();
                const refDataUrl = await bridge.loadCurrentSceneImageDataUrl?.(state.scene.imagePath);
                sceneStatusText = t('scene.statusGeneratingVid', { status: 'submitting' });
                renderAll();
                const created = await api.createVideo({ model, prompt, image: refDataUrl || undefined }, abort.signal);
                taskIdentifier = created.id;
                state.scene.videoTaskId = taskIdentifier;
                state.scene.videoStatus = created.status;
                await bridge.saveChatState(state);
            }

            const videoBlob = await api.pollVideo(taskIdentifier, {
                onProgress: st => {
                    const pct = st.progress !== null ? `${Math.round(st.progress)}%` : st.status;
                    sceneStatusText = t('scene.statusGeneratingVid', { status: pct });
                    renderAll();
                },
            }, abort.signal);

            const base64 = await blobToBase64(videoBlob);
            const savedVideoPath = await bridge.applyVideoBackground({ blob: videoBlob, base64 });
            state.scene.videoPath = savedVideoPath;
            state.scene.videoStatus = 'completed';
            state.scene.videoTaskId = '';
            await bridge.saveChatState(state);
            sceneStatusText = t('scene.statusDone');
            await refreshAccount().catch(() => {});
        } catch (err) {
            if (err?.name !== 'AbortError') errorBanner = redact(err?.message ?? err, key);
        } finally {
            if (activeAbort === abort) activeAbort = null;
            busyState = '';
            renderAll();
        }
    }

    function buildSelect(options, currentValue, onChange) {
        const select = el(doc, 'select', {
            className: 'clodex-rp-input',
            onChange: e => onChange(e.target.value),
        });
        for (const opt of options) {
            const o = el(doc, 'option', { value: opt.value, selected: opt.value === currentValue }, opt.label);
            select.append(o);
        }
        return select;
    }

    function renderTrackerTab(state) {
        const container = el(doc, 'div', { className: 'clodex-rp-tab-body' });

        // Action row
        container.append(el(doc, 'div', { className: 'clodex-rp-btn-row' },
            el(doc, 'button', {
                type: 'button',
                className: 'clodex-rp-btn clodex-rp-btn-primary',
                disabled: busyState === 'tracker',
                onClick: () => syncTrackerFromChat(),
            }, busyState === 'tracker' ? `⏳ ${t('world.syncing')}` : `🔄 ${t('world.syncAi')}`),
            el(doc, 'button', {
                type: 'button',
                className: 'clodex-rp-btn',
                onClick: async () => {
                    advanceSimulationDays(state, 1);
                    await bridge.saveChatState(state);
                    renderAll();
                },
            }, t('world.plus1d')),
            el(doc, 'button', {
                type: 'button',
                className: 'clodex-rp-btn',
                onClick: async () => {
                    advanceSimulationDays(state, 7);
                    await bridge.saveChatState(state);
                    renderAll();
                },
            }, t('world.plus7d')),
        ));

        // World card
        const worldGrid = el(doc, 'div', { className: 'clodex-rp-card' },
            el(doc, 'div', { className: 'clodex-rp-grid-2' },
                el(doc, 'label', { className: 'clodex-rp-field' },
                    el(doc, 'span', {}, t('world.date')),
                    el(doc, 'input', {
                        type: 'date',
                        className: 'clodex-rp-input',
                        value: state.world.rpDate,
                        onChange: async e => {
                            if (e.target.value) state.world.rpDate = e.target.value;
                            await bridge.saveChatState(state);
                            renderAll();
                        },
                    }),
                ),
                el(doc, 'label', { className: 'clodex-rp-field' },
                    el(doc, 'span', {}, t('world.time')),
                    buildSelect(
                        TIME_SLOTS.map(slot => ({ value: slot, label: t(`time.${slot}`) })),
                        state.world.timeOfDay,
                        async val => {
                            state.world.timeOfDay = val;
                            await bridge.saveChatState(state);
                            renderAll();
                        },
                    ),
                ),
                el(doc, 'label', { className: 'clodex-rp-field' },
                    el(doc, 'span', {}, t('world.location')),
                    el(doc, 'input', {
                        type: 'text',
                        className: 'clodex-rp-input',
                        placeholder: t('world.locationPlaceholder'),
                        value: state.world.location,
                        onChange: async e => {
                            state.world.location = e.target.value.slice(0, 140);
                            await bridge.saveChatState(state);
                            renderHudPill();
                        },
                    }),
                ),
                el(doc, 'label', { className: 'clodex-rp-field' },
                    el(doc, 'span', {}, t('world.target')),
                    buildSelect(
                        ['both', 'char', 'user'].map(v => ({ value: v, label: t(`world.target.${v}`) })),
                        state.world.targetMode,
                        async val => {
                            state.world.targetMode = val;
                            if (val !== 'both') activeEntityRole = val;
                            await bridge.saveChatState(state);
                            renderAll();
                        },
                    ),
                ),
            ),
            el(doc, 'div', { className: 'clodex-rp-toggles' },
                el(doc, 'label', { className: 'clodex-rp-check' },
                    el(doc, 'input', {
                        type: 'checkbox',
                        checked: state.world.enableVitals,
                        onChange: async e => {
                            state.world.enableVitals = e.target.checked;
                            await bridge.saveChatState(state);
                            renderAll();
                        },
                    }),
                    el(doc, 'span', {}, t('world.enableVitals')),
                ),
                el(doc, 'label', { className: 'clodex-rp-check' },
                    el(doc, 'input', {
                        type: 'checkbox',
                        checked: state.world.enableAdultBiology,
                        onChange: async e => {
                            state.world.enableAdultBiology = e.target.checked;
                            if (e.target.checked && state.entities[activeEntityRole].bio.mode === 'none') {
                                state.entities[activeEntityRole].bio.mode = 'cycle';
                            }
                            await bridge.saveChatState(state);
                            renderAll();
                        },
                    }),
                    el(doc, 'span', {}, `🔞 ${t('world.enableAdult')}`),
                ),
            ),
        );

        if (state.world.enableAdultBiology) {
            worldGrid.append(el(doc, 'label', { className: 'clodex-rp-field clodex-rp-mt' },
                el(doc, 'span', {}, t('world.disclosure')),
                buildSelect(
                    DISCLOSURE_MODES.map(m => ({ value: m, label: t(`world.disclosure.${m}`) })),
                    state.world.disclosureMode,
                    async val => {
                        state.world.disclosureMode = val;
                        await bridge.saveChatState(state);
                        renderAll();
                    },
                ),
            ));
        }
        container.append(worldGrid);

        // Entity switcher
        container.append(el(doc, 'div', { className: 'clodex-rp-seg' },
            ...['char', 'user'].map(role => el(doc, 'button', {
                type: 'button',
                className: `clodex-rp-seg-btn ${activeEntityRole === role ? 'active' : ''}`,
                onClick: () => {
                    activeEntityRole = role;
                    renderDrawer();
                },
            }, t(`entity.${role}`))),
        ));

        const entity = state.entities[activeEntityRole];

        // Vitals card
        if (state.world.enableVitals) {
            const v = entity.vitals;
            const woundsList = v.wounds.length === 0
                ? el(doc, 'div', { className: 'clodex-rp-muted' }, t('vitals.noWounds'))
                : el(doc, 'div', { className: 'clodex-rp-list' }, ...v.wounds.map(w =>
                    el(doc, 'div', { className: 'clodex-rp-list-item' },
                        el(doc, 'span', {}, `${w.bleeding ? '🩸 ' : '🩹 '}${w.label}`),
                        el(doc, 'button', {
                            type: 'button',
                            className: 'clodex-rp-btn-mini',
                            onClick: async () => {
                                v.wounds = v.wounds.filter(item => item.id !== w.id);
                                await bridge.saveChatState(state);
                                renderAll();
                            },
                        }, t('vitals.removeWound')),
                    )));

            container.append(el(doc, 'div', { className: 'clodex-rp-card' },
                el(doc, 'h4', { className: 'clodex-rp-card-title' }, `❤️ ${t('vitals.title')}`),
                el(doc, 'div', { className: 'clodex-rp-grid-2' },
                    el(doc, 'label', { className: 'clodex-rp-field' },
                        el(doc, 'span', {}, t('vitals.heartRate')),
                        el(doc, 'input', {
                            type: 'number',
                            min: 40,
                            max: 210,
                            className: 'clodex-rp-input',
                            value: v.heartRate,
                            onChange: async e => {
                                v.heartRate = Math.max(40, Math.min(210, Number(e.target.value) || 72));
                                await bridge.saveChatState(state);
                                renderHudPill();
                            },
                        }),
                    ),
                    el(doc, 'label', { className: 'clodex-rp-field' },
                        el(doc, 'span', {}, t('vitals.breathRate')),
                        el(doc, 'input', {
                            type: 'number',
                            min: 8,
                            max: 48,
                            className: 'clodex-rp-input',
                            value: v.breathRate,
                            onChange: async e => {
                                v.breathRate = Math.max(8, Math.min(48, Number(e.target.value) || 14));
                                await bridge.saveChatState(state);
                                renderHudPill();
                            },
                        }),
                    ),
                    el(doc, 'label', { className: 'clodex-rp-field' },
                        el(doc, 'span', {}, t('vitals.respiration')),
                        buildSelect(
                            ['steady', 'deep', 'rapid', 'breathless', 'shallow'].map(r => ({ value: r, label: t(`vitals.resp.${r}`) })),
                            v.respiration,
                            async val => {
                                v.respiration = val;
                                await bridge.saveChatState(state);
                                renderHudPill();
                            },
                        ),
                    ),
                    el(doc, 'label', { className: 'clodex-rp-field' },
                        el(doc, 'span', {}, t('vitals.circulation')),
                        buildSelect(
                            ['normal', 'flushed', 'adrenaline', 'pallor', 'hypovolemia'].map(c => ({ value: c, label: t(`vitals.circ.${c}`) })),
                            v.circulation,
                            async val => {
                                v.circulation = val;
                                await bridge.saveChatState(state);
                                renderHudPill();
                            },
                        ),
                    ),
                    el(doc, 'label', { className: 'clodex-rp-field' },
                        el(doc, 'span', {}, `${t('vitals.bloodLoss')}: ${v.bloodLossPct}%`),
                        el(doc, 'input', {
                            type: 'range',
                            min: 0,
                            max: 45,
                            value: v.bloodLossPct,
                            onChange: async e => {
                                v.bloodLossPct = Number(e.target.value) || 0;
                                await bridge.saveChatState(state);
                                renderAll();
                            },
                        }),
                    ),
                    el(doc, 'label', { className: 'clodex-rp-field' },
                        el(doc, 'span', {}, `${t('vitals.stamina')}: ${v.stamina}% · ${t('vitals.stress')}: ${v.stress}%`),
                        el(doc, 'input', {
                            type: 'range',
                            min: 0,
                            max: 100,
                            value: v.stamina,
                            onChange: async e => {
                                v.stamina = Number(e.target.value) || 0;
                                await bridge.saveChatState(state);
                                renderAll();
                            },
                        }),
                    ),
                ),
                el(doc, 'div', { className: 'clodex-rp-subbox' },
                    el(doc, 'strong', {}, t('vitals.wounds')),
                    woundsList,
                    el(doc, 'div', { className: 'clodex-rp-btn-row clodex-rp-mt' },
                        el(doc, 'input', {
                            type: 'text',
                            className: 'clodex-rp-input',
                            placeholder: t('vitals.woundPlaceholder'),
                            value: woundDraft,
                            onInput: e => { woundDraft = e.target.value; },
                        }),
                        el(doc, 'label', { className: 'clodex-rp-check' },
                            el(doc, 'input', {
                                type: 'checkbox',
                                checked: woundBleedingDraft,
                                onChange: e => { woundBleedingDraft = e.target.checked; },
                            }),
                            el(doc, 'span', {}, t('vitals.bleedingCheck')),
                        ),
                        el(doc, 'button', {
                            type: 'button',
                            className: 'clodex-rp-btn',
                            onClick: async () => {
                                if (!woundDraft.trim()) return;
                                v.wounds.push({
                                    id: `w-${Date.now()}`,
                                    label: woundDraft.trim().slice(0, 90),
                                    bleeding: woundBleedingDraft,
                                    severity: woundBleedingDraft ? 2 : 1,
                                    daysOld: 0,
                                });
                                woundDraft = '';
                                await bridge.saveChatState(state);
                                renderAll();
                            },
                        }, t('vitals.addWound')),
                        v.wounds.some(w => w.bleeding) ? el(doc, 'button', {
                            type: 'button',
                            className: 'clodex-rp-btn',
                            onClick: async () => {
                                v.wounds = v.wounds.map(w => ({ ...w, bleeding: false }));
                                await bridge.saveChatState(state);
                                renderAll();
                            },
                        }, t('vitals.bandageAll')) : null,
                    ),
                ),
            ));
        }

        // 18+ Biology card
        if (state.world.enableAdultBiology) {
            const b = entity.bio;
            const phase = getCyclePhase(b);
            const bioCard = el(doc, 'div', { className: 'clodex-rp-card' },
                el(doc, 'h4', { className: 'clodex-rp-card-title' }, `🧬 ${t('bio.title')}`),
                el(doc, 'label', { className: 'clodex-rp-field' },
                    el(doc, 'span', {}, t('bio.mode')),
                    buildSelect(
                        BIO_MODES.map(m => ({ value: m, label: t(`bio.mode.${m}`) })),
                        b.mode,
                        async val => {
                            b.mode = val;
                            await bridge.saveChatState(state);
                            renderAll();
                        },
                    ),
                ),
            );

            if (b.mode !== 'none') {
                bioCard.append(el(doc, 'div', { className: 'clodex-rp-badge-line clodex-rp-mt' },
                    `${t('bio.phase')}: `,
                    el(doc, 'strong', {}, t(`bio.phase.${phase}`)),
                ));

                if (b.mode === 'cycle' || b.mode === 'omegaverse') {
                    bioCard.append(el(doc, 'div', { className: 'clodex-rp-grid-2 clodex-rp-mt' },
                        el(doc, 'label', { className: 'clodex-rp-field' },
                            el(doc, 'span', {}, t('bio.cycleDay')),
                            el(doc, 'input', {
                                type: 'number',
                                min: 1,
                                max: b.cycleLength,
                                className: 'clodex-rp-input',
                                value: b.cycleDay,
                                onChange: async e => {
                                    b.cycleDay = Math.max(1, Math.min(b.cycleLength, Number(e.target.value) || 1));
                                    await bridge.saveChatState(state);
                                    renderAll();
                                },
                            }),
                        ),
                        el(doc, 'label', { className: 'clodex-rp-field' },
                            el(doc, 'span', {}, t('bio.cycleLength')),
                            el(doc, 'input', {
                                type: 'number',
                                min: 21,
                                max: 35,
                                className: 'clodex-rp-input',
                                value: b.cycleLength,
                                onChange: async e => {
                                    b.cycleLength = Math.max(21, Math.min(35, Number(e.target.value) || 28));
                                    b.cycleDay = Math.min(b.cycleDay, b.cycleLength);
                                    await bridge.saveChatState(state);
                                    renderAll();
                                },
                            }),
                        ),
                        el(doc, 'label', { className: 'clodex-rp-field' },
                            el(doc, 'span', {}, t('bio.contraception')),
                            buildSelect(
                                CONTRACEPTION_TYPES.map(c => ({ value: c, label: t(`bio.contra.${c}`) })),
                                b.contraception,
                                async val => {
                                    b.contraception = val;
                                    await bridge.saveChatState(state);
                                    renderAll();
                                },
                            ),
                        ),
                    ));
                }

                if (b.mode === 'omegaverse') {
                    bioCard.append(el(doc, 'div', { className: 'clodex-rp-grid-2 clodex-rp-mt' },
                        el(doc, 'label', { className: 'clodex-rp-field' },
                            el(doc, 'span', {}, t('bio.omegaRole')),
                            buildSelect(
                                OMEGA_ROLES.map(r => ({ value: r, label: t(`bio.omega.${r}`) })),
                                b.omegaRole,
                                async val => {
                                    b.omegaRole = val;
                                    await bridge.saveChatState(state);
                                    renderAll();
                                },
                            ),
                        ),
                        el(doc, 'label', { className: 'clodex-rp-field' },
                            el(doc, 'span', {}, t('bio.suppressants')),
                            buildSelect(
                                SUPPRESSANT_LEVELS.map(s => ({ value: s, label: t(`bio.supp.${s}`) })),
                                b.suppressants,
                                async val => {
                                    b.suppressants = val;
                                    await bridge.saveChatState(state);
                                    renderAll();
                                },
                            ),
                        ),
                        el(doc, 'label', { className: 'clodex-rp-field' },
                            el(doc, 'span', {}, t('bio.scent')),
                            el(doc, 'input', {
                                type: 'text',
                                className: 'clodex-rp-input',
                                placeholder: t('bio.scentPlaceholder'),
                                value: b.pheromoneScent,
                                onChange: async e => {
                                    b.pheromoneScent = e.target.value.slice(0, 80);
                                    await bridge.saveChatState(state);
                                },
                            }),
                        ),
                        el(doc, 'label', { className: 'clodex-rp-field' },
                            el(doc, 'span', {}, `${t('bio.pheromoneIntensity')}: ${b.pheromoneIntensity}%`),
                            el(doc, 'input', {
                                type: 'range',
                                min: 0,
                                max: 100,
                                value: b.pheromoneIntensity,
                                onChange: async e => {
                                    b.pheromoneIntensity = Number(e.target.value) || 0;
                                    await bridge.saveChatState(state);
                                    renderAll();
                                },
                            }),
                        ),
                        el(doc, 'label', { className: 'clodex-rp-field' },
                            el(doc, 'span', {}, t('bio.bondType')),
                            buildSelect(
                                BOND_TYPES.map(bt => ({ value: bt, label: t(`bio.bond.${bt}`) })),
                                b.bondType,
                                async val => {
                                    b.bondType = val;
                                    await bridge.saveChatState(state);
                                    renderAll();
                                },
                            ),
                        ),
                        el(doc, 'label', { className: 'clodex-rp-field' },
                            el(doc, 'span', {}, t('bio.bondPartner')),
                            el(doc, 'input', {
                                type: 'text',
                                className: 'clodex-rp-input',
                                value: b.bondPartner,
                                onChange: async e => {
                                    b.bondPartner = e.target.value.slice(0, 80);
                                    await bridge.saveChatState(state);
                                },
                            }),
                        ),
                    ));
                    bioCard.append(el(doc, 'div', { className: 'clodex-rp-btn-row clodex-rp-mt' },
                        el(doc, 'button', {
                            type: 'button',
                            className: 'clodex-rp-btn',
                            onClick: async () => {
                                b.inHeatOrRut = !b.inHeatOrRut;
                                b.heatDaysLeft = b.inHeatOrRut ? 4 : 0;
                                b.pheromoneIntensity = b.inHeatOrRut ? 90 : 25;
                                await bridge.saveChatState(state);
                                renderAll();
                            },
                        }, `🔥 ${t('bio.toggleHeat')}`),
                    ));
                }

                // Conception / Pregnancy / Oviposition controls
                if (b.mode === 'oviposition') {
                    const clutchBox = el(doc, 'div', { className: 'clodex-rp-subbox clodex-rp-mt' },
                        el(doc, 'strong', {}, `🥚 ${t('bio.clutchBox')}`),
                    );
                    if (b.carryingClutch) {
                        clutchBox.append(
                            el(doc, 'p', {}, t('bio.clutchProgress', {
                                remaining: b.clutchTotal - b.clutchLaid,
                                days: b.clutchDays,
                                target: b.clutchTargetDays,
                            })),
                            el(doc, 'div', { className: 'clodex-rp-btn-row' },
                                el(doc, 'button', {
                                    type: 'button',
                                    className: 'clodex-rp-btn clodex-rp-btn-primary',
                                    onClick: async () => {
                                        layEggs(entity, state, 1);
                                        await bridge.saveChatState(state);
                                        renderAll();
                                    },
                                }, t('bio.layOne')),
                                el(doc, 'button', {
                                    type: 'button',
                                    className: 'clodex-rp-btn',
                                    onClick: async () => {
                                        layEggs(entity, state, null);
                                        await bridge.saveChatState(state);
                                        renderAll();
                                    },
                                }, t('bio.layAll')),
                            ),
                        );
                    } else {
                        clutchBox.append(el(doc, 'div', { className: 'clodex-rp-btn-row clodex-rp-mt' },
                            el(doc, 'button', {
                                type: 'button',
                                className: 'clodex-rp-btn',
                                onClick: async () => {
                                    triggerConception(entity, state, { force: false });
                                    await bridge.saveChatState(state);
                                    renderAll();
                                },
                            }, `🎲 ${t('bio.rollConception')}`),
                            el(doc, 'button', {
                                type: 'button',
                                className: 'clodex-rp-btn',
                                onClick: async () => {
                                    triggerConception(entity, state, { force: true });
                                    await bridge.saveChatState(state);
                                    renderAll();
                                },
                            }, `🥚 ${t('bio.forceConception')}`),
                        ));
                    }

                    if (b.nest.active && b.nest.eggs.length > 0) {
                        clutchBox.append(
                            el(doc, 'label', { className: 'clodex-rp-field clodex-rp-mt' },
                                el(doc, 'span', {}, t('bio.nestWarmth')),
                                buildSelect(
                                    ['optimal', 'cool', 'overheated'].map(w => ({ value: w, label: t(`bio.warmth.${w}`) })),
                                    b.nest.warmth,
                                    async val => {
                                        b.nest.warmth = val;
                                        await bridge.saveChatState(state);
                                        renderAll();
                                    },
                                ),
                            ),
                            el(doc, 'div', { className: 'clodex-rp-list clodex-rp-mt' },
                                ...b.nest.eggs.map((egg, i) => el(doc, 'div', { className: 'clodex-rp-list-item' },
                                    t('bio.nestEggItem', {
                                        idx: i + 1,
                                        shell: egg.shell,
                                        days: Math.floor(egg.daysIncubated),
                                        target: egg.targetDays,
                                        cracked: egg.cracked ? t('bio.crackedBadge') : '',
                                    }),
                                )),
                            ),
                            el(doc, 'div', { className: 'clodex-rp-btn-row clodex-rp-mt' },
                                el(doc, 'button', {
                                    type: 'button',
                                    className: 'clodex-rp-btn clodex-rp-btn-primary',
                                    onClick: async () => {
                                        hatchReadyEggs(entity, state, { forceAll: false });
                                        await bridge.saveChatState(state);
                                        renderAll();
                                    },
                                }, `🐣 ${t('bio.hatchReady')}`),
                                el(doc, 'button', {
                                    type: 'button',
                                    className: 'clodex-rp-btn',
                                    onClick: async () => {
                                        hatchReadyEggs(entity, state, { forceAll: true });
                                        await bridge.saveChatState(state);
                                        renderAll();
                                    },
                                }, t('bio.hatchAll')),
                            ),
                        );
                    }
                    bioCard.append(clutchBox);
                } else if (b.pregnant) {
                    const vis = getVisibleBiologySummary(entity, state.world.disclosureMode);
                    const showFull = peekSpoilers || (vis.revealCount && vis.revealGender);
                    const gendersStr = b.fetusGenders.map(g => t(`bio.gender.${g}`)).join(', ');
                    bioCard.append(el(doc, 'div', { className: 'clodex-rp-subbox clodex-rp-mt' },
                        el(doc, 'strong', {}, `🤰 ${t('bio.pregnancyBox')}`),
                        !vis.knownPregnant ? el(doc, 'div', { className: 'clodex-rp-muted' }, `🌫️ ${t('bio.hiddenFromAi')}`) : null,
                        el(doc, 'p', {}, showFull
                            ? t('bio.fetusInfo', { days: b.gestationDays, target: b.gestationTarget, week: vis.week, count: b.fetusCount, genders: gendersStr })
                            : t('bio.fetusMasked', { week: vis.week })),
                        el(doc, 'div', { className: 'clodex-rp-btn-row' },
                            el(doc, 'button', {
                                type: 'button',
                                className: 'clodex-rp-btn',
                                onClick: () => {
                                    peekSpoilers = !peekSpoilers;
                                    renderDrawer();
                                },
                            }, peekSpoilers ? t('bio.hideSpoilers') : t('bio.peekSpoilers')),
                            state.world.disclosureMode === 'modern' ? el(doc, 'button', {
                                type: 'button',
                                className: 'clodex-rp-btn',
                                onClick: async () => {
                                    b.testTaken = true;
                                    await bridge.saveChatState(state);
                                    renderAll();
                                },
                            }, t('bio.takeTest')) : null,
                            state.world.disclosureMode === 'modern' ? el(doc, 'button', {
                                type: 'button',
                                className: 'clodex-rp-btn',
                                onClick: async () => {
                                    b.ultrasoundWeek = Math.floor(b.gestationDays / 7) + 1;
                                    await bridge.saveChatState(state);
                                    renderAll();
                                },
                            }, t('bio.doUltrasound')) : null,
                            el(doc, 'button', {
                                type: 'button',
                                className: 'clodex-rp-btn clodex-rp-btn-primary',
                                onClick: async () => {
                                    deliverBabies(entity, state, { method: 'natural' });
                                    await bridge.saveChatState(state);
                                    renderAll();
                                },
                            }, t('bio.deliverNatural')),
                            el(doc, 'button', {
                                type: 'button',
                                className: 'clodex-rp-btn',
                                onClick: async () => {
                                    deliverBabies(entity, state, { method: 'c_section' });
                                    await bridge.saveChatState(state);
                                    renderAll();
                                },
                            }, t('bio.deliverCSection')),
                        ),
                    ));
                } else {
                    bioCard.append(el(doc, 'div', { className: 'clodex-rp-btn-row clodex-rp-mt' },
                        el(doc, 'button', {
                            type: 'button',
                            className: 'clodex-rp-btn',
                            onClick: async () => {
                                triggerConception(entity, state, { force: false });
                                await bridge.saveChatState(state);
                                renderAll();
                            },
                        }, `🎲 ${t('bio.rollConception')}`),
                        el(doc, 'button', {
                            type: 'button',
                            className: 'clodex-rp-btn',
                            onClick: async () => {
                                triggerConception(entity, state, { force: true });
                                await bridge.saveChatState(state);
                                renderAll();
                            },
                        }, `✨ ${t('bio.forceConception')}`),
                    ));
                }
            }

            // Family tree
            bioCard.append(el(doc, 'div', { className: 'clodex-rp-subbox clodex-rp-mt' },
                el(doc, 'strong', {}, `🌳 ${t('bio.familyTitle')}`),
                state.offspring.length === 0
                    ? el(doc, 'div', { className: 'clodex-rp-muted' }, t('bio.noOffspring'))
                    : el(doc, 'div', { className: 'clodex-rp-list clodex-rp-mt' }, ...state.offspring.map(child =>
                        el(doc, 'div', { className: 'clodex-rp-list-item' },
                            el(doc, 'input', {
                                type: 'text',
                                className: 'clodex-rp-input',
                                placeholder: t('bio.childNamePlaceholder'),
                                value: child.name,
                                onChange: async e => {
                                    child.name = e.target.value.slice(0, 80);
                                    await bridge.saveChatState(state);
                                },
                            }),
                            el(doc, 'span', { className: 'clodex-rp-muted' }, `${t(`bio.gender.${child.gender}`)} · ${child.bornDate}`),
                        ))),
            ));

            container.append(bioCard);
        }

        return container;
    }

    function renderCodexTab(state) {
        const container = el(doc, 'div', { className: 'clodex-rp-tab-body' });

        if (state.world.pendingMemoryHint) {
            container.append(el(doc, 'div', { className: 'clodex-rp-banner' },
                el(doc, 'span', {}, `🧠 ${t('codex.memoryBanner', { hint: state.world.pendingMemoryHint.slice(0, 120) })}`),
                el(doc, 'button', {
                    type: 'button',
                    className: 'clodex-rp-btn-mini',
                    onClick: async () => {
                        state.world.pendingMemoryHint = '';
                        await bridge.saveChatState(state);
                        renderAll();
                    },
                }, t('codex.clearMemory')),
            ));
        }

        const headerCard = el(doc, 'div', { className: 'clodex-rp-card' },
            el(doc, 'h4', { className: 'clodex-rp-card-title' }, `📜 ${t('codex.title')}`),
            el(doc, 'label', { className: 'clodex-rp-field' },
                el(doc, 'span', {}, t('codex.preset')),
                buildSelect(
                    Object.keys(CODEX_PRESETS).map(k => ({ value: k, label: t(`codex.preset.${k}`) })),
                    codexPreset,
                    async val => {
                        codexPreset = val;
                        if (val === 'biblical_dante' && catalog.length) {
                            const mistral = catalog.find(m => m.kinds.includes('text') && m.mistral);
                            if (mistral) await bridge.updateSettings({ codexModel: mistral.id });
                        }
                        renderDrawer();
                    },
                ),
            ),
            codexPreset === 'custom' ? el(doc, 'textarea', {
                className: 'clodex-rp-input clodex-rp-mt',
                rows: 2,
                placeholder: t('codex.customPlaceholder'),
                value: codexCustomPrompt,
                onInput: e => { codexCustomPrompt = e.target.value; },
            }) : null,
            el(doc, 'div', { className: 'clodex-rp-chips clodex-rp-mt' },
                ...[
                    ['biblical_dante', t('codex.chip.dante')],
                    ['biblical_dante', t('codex.chip.latin')],
                    ['lore_keeper', t('codex.chip.cardSummary')],
                    ['medical_realism', t('codex.chip.wounds')],
                ].map(([presetId, label]) => el(doc, 'button', {
                    type: 'button',
                    className: 'clodex-rp-chip-btn',
                    onClick: () => {
                        codexPreset = presetId;
                        codexDraft = label;
                        runCodexQuery(label);
                    },
                }, label)),
            ),
        );
        container.append(headerCard);

        const feed = el(doc, 'div', { className: 'clodex-rp-codex-feed' });
        if (state.codexHistory.length === 0) {
            feed.append(el(doc, 'div', { className: 'clodex-rp-muted' }, t('codex.empty')));
        } else {
            for (const msg of state.codexHistory) {
                const bubble = el(doc, 'div', {
                    className: `clodex-rp-codex-msg ${msg.role === 'user' ? 'is-user' : 'is-assistant'}`,
                },
                el(doc, 'div', { className: 'clodex-rp-codex-text' }, msg.content));

                if (msg.role === 'assistant') {
                    bubble.append(el(doc, 'div', { className: 'clodex-rp-btn-row clodex-rp-mt' },
                        el(doc, 'button', {
                            type: 'button',
                            className: 'clodex-rp-btn-mini',
                            onClick: async () => {
                                await bridge.insertIntoComposer(msg.content);
                                bridge.notify?.(t('notice.inserted'));
                            },
                        }, `✍️ ${t('codex.insertReply')}`),
                        el(doc, 'button', {
                            type: 'button',
                            className: 'clodex-rp-btn-mini',
                            onClick: async () => {
                                state.world.pendingMemoryHint = msg.content.slice(0, 1200);
                                await bridge.saveChatState(state);
                                bridge.notify?.(t('notice.memoryArmed'));
                                renderAll();
                            },
                        }, `🧠 ${t('codex.armMemory')}`),
                    ));
                }
                feed.append(bubble);
            }
        }
        container.append(feed);

        container.append(el(doc, 'div', { className: 'clodex-rp-card' },
            el(doc, 'textarea', {
                className: 'clodex-rp-input',
                rows: 2,
                placeholder: t('codex.inputPlaceholder'),
                value: codexDraft,
                onInput: e => { codexDraft = e.target.value; },
            }),
            el(doc, 'div', { className: 'clodex-rp-btn-row clodex-rp-mt' },
                el(doc, 'button', {
                    type: 'button',
                    className: 'clodex-rp-btn clodex-rp-btn-primary',
                    disabled: busyState === 'codex',
                    onClick: () => runCodexQuery(codexDraft),
                }, busyState === 'codex' ? `⏳ ${t('codex.asking')}` : `📜 ${t('codex.askBtn')}`),
                state.codexHistory.length > 0 ? el(doc, 'button', {
                    type: 'button',
                    className: 'clodex-rp-btn',
                    onClick: async () => {
                        state.codexHistory = [];
                        await bridge.saveChatState(state);
                        renderDrawer();
                    },
                }, t('codex.clearBtn')) : null,
            ),
        ));
        return container;
    }

    function renderSceneTab(state) {
        const settings = bridge.getSettings();
        const container = el(doc, 'div', { className: 'clodex-rp-tab-body' });

        const previewBox = el(doc, 'div', { className: 'clodex-rp-scene-preview' });
        const vidSrc = bridge.resolveMediaSrc?.(state.scene.videoPath) || state.scene.videoPath;
        const imgSrc = bridge.resolveMediaSrc?.(state.scene.imagePath) || state.scene.imagePath;
        if (vidSrc) {
            previewBox.append(el(doc, 'video', {
                src: vidSrc,
                autoplay: true,
                loop: true,
                muted: true,
                playsInline: true,
                controls: true,
                className: 'clodex-rp-preview-media',
            }));
        } else if (imgSrc) {
            previewBox.append(el(doc, 'img', {
                src: imgSrc,
                alt: 'Scene preview',
                className: 'clodex-rp-preview-media',
            }));
        }

        container.append(el(doc, 'div', { className: 'clodex-rp-card' },
            el(doc, 'h4', { className: 'clodex-rp-card-title' }, `🍌 ${t('scene.title')}`),
            previewBox.childNodes.length ? previewBox : null,
            el(doc, 'div', { className: 'clodex-rp-muted clodex-rp-mt' }, sceneStatusText || t('scene.statusIdle')),
            el(doc, 'label', { className: 'clodex-rp-field clodex-rp-mt' },
                el(doc, 'span', {}, t('scene.style')),
                buildSelect(
                    ['cinematic', 'dark_gothic', 'anime_illustration'].map(s => ({ value: s, label: t(`scene.style.${s}`) })),
                    sceneStyle,
                    val => {
                        sceneStyle = val;
                        renderDrawer();
                    },
                ),
            ),
            el(doc, 'label', { className: 'clodex-rp-field clodex-rp-mt' },
                el(doc, 'span', {}, t('scene.promptLabel')),
                el(doc, 'textarea', {
                    className: 'clodex-rp-input',
                    rows: 3,
                    placeholder: t('scene.promptPlaceholder'),
                    value: scenePromptDraft || state.scene.imagePrompt || '',
                    onInput: e => { scenePromptDraft = e.target.value; },
                }),
            ),
            el(doc, 'div', { className: 'clodex-rp-chips clodex-rp-mt' },
                el(doc, 'button', {
                    type: 'button',
                    className: 'clodex-rp-chip-btn',
                    onClick: () => {
                        sceneStyle = 'dark_gothic';
                        scenePromptDraft = EXORCIST_PRESET_PROMPT;
                        renderDrawer();
                    },
                }, `✝️ ${t('scene.presetExorcist')}`),
                el(doc, 'button', {
                    type: 'button',
                    className: 'clodex-rp-chip-btn',
                    onClick: async () => {
                        scenePromptDraft = '';
                        await buildOrUseScenePrompt().catch(err => { errorBanner = redact(err?.message ?? err); });
                        renderDrawer();
                    },
                }, `✨ ${t('scene.presetCurrent')}`),
            ),
            el(doc, 'div', { className: 'clodex-rp-btn-row clodex-rp-mt' },
                el(doc, 'button', {
                    type: 'button',
                    className: 'clodex-rp-btn clodex-rp-btn-primary',
                    disabled: busyState.startsWith('scene_'),
                    onClick: () => generateSceneBackground({ auto: false }),
                }, `🍌 ${t('scene.genImage')}`),
                el(doc, 'button', {
                    type: 'button',
                    className: 'clodex-rp-btn',
                    disabled: busyState.startsWith('scene_'),
                    onClick: () => generateOrResumeSceneVideo({ resume: false }),
                }, `🎬 ${t('scene.genVideo')}`),
                state.scene.videoTaskId ? el(doc, 'button', {
                    type: 'button',
                    className: 'clodex-rp-btn',
                    disabled: busyState.startsWith('scene_'),
                    onClick: () => generateOrResumeSceneVideo({ resume: true }),
                }, t('scene.resumeVideo')) : null,
                (state.scene.imagePath || state.scene.videoPath) ? el(doc, 'button', {
                    type: 'button',
                    className: 'clodex-rp-btn',
                    onClick: async () => {
                        await bridge.clearSceneBackground?.();
                        state.scene.imagePath = '';
                        state.scene.videoPath = '';
                        state.scene.videoTaskId = '';
                        await bridge.saveChatState(state);
                        renderAll();
                    },
                }, t('scene.clearBg')) : null,
            ),
            el(doc, 'div', { className: 'clodex-rp-grid-2 clodex-rp-mt' },
                el(doc, 'label', { className: 'clodex-rp-field' },
                    el(doc, 'span', {}, t('scene.autoEvery')),
                    el(doc, 'input', {
                        type: 'number',
                        min: 0,
                        max: 30,
                        className: 'clodex-rp-input',
                        value: Number(settings.autoImageEvery || 0),
                        onChange: async e => {
                            await bridge.updateSettings({ autoImageEvery: Math.max(0, Math.min(30, Number(e.target.value) || 0)) });
                            renderDrawer();
                        },
                    }),
                ),
                el(doc, 'label', { className: 'clodex-rp-field' },
                    el(doc, 'span', {}, `${t('scene.backdropDim')}: ${settings.bgDim ?? 35}%`),
                    el(doc, 'input', {
                        type: 'range',
                        min: 0,
                        max: 80,
                        value: settings.bgDim ?? 35,
                        onChange: async e => {
                            await bridge.updateSettings({ bgDim: Number(e.target.value) || 0 });
                            syncVideoBackdrop();
                            renderDrawer();
                        },
                    }),
                ),
            ),
        ));
        return container;
    }

    function renderAccountTab() {
        const settings = bridge.getSettings();
        const inherited = bridge.isKeyInherited?.() ?? false;
        const container = el(doc, 'div', { className: 'clodex-rp-tab-body' });

        let keyDraft = settings.apiKey || '';
        const textModels = catalog.filter(m => m.kinds.includes('text') || !m.kinds.length);
        const imageModels = catalog.filter(m => m.kinds.includes('image'));
        const videoModels = catalog.filter(m => m.kinds.includes('video'));

        const modelOptions = (list, current) => {
            const opts = list.map(m => ({
                value: m.id,
                label: `${m.nanoBanana ? '🍌 ' : ''}${m.name}${formatModelPrice(m)}`,
            }));
            if (current && !opts.some(o => o.value === current)) {
                opts.unshift({ value: current, label: current });
            }
            if (!opts.length) opts.push({ value: '', label: '—' });
            return opts;
        };

        container.append(el(doc, 'div', { className: 'clodex-rp-card' },
            el(doc, 'h4', { className: 'clodex-rp-card-title' }, `🔑 ${t('account.title')}`),
            inherited ? el(doc, 'div', { className: 'clodex-rp-badge-line' }, `✅ ${t('account.inheritedBadge')}`) : null,
            bridge.allowInlineKeyEdit !== false ? el(doc, 'label', { className: 'clodex-rp-field clodex-rp-mt' },
                el(doc, 'span', {}, t('account.keyLabel')),
                el(doc, 'input', {
                    type: 'password',
                    className: 'clodex-rp-input',
                    placeholder: 'sk-...',
                    value: keyDraft,
                    onInput: e => { keyDraft = e.target.value; },
                }),
            ) : null,
            el(doc, 'div', { className: 'clodex-rp-btn-row clodex-rp-mt' },
                el(doc, 'button', {
                    type: 'button',
                    className: 'clodex-rp-btn clodex-rp-btn-primary',
                    disabled: busyState === 'account',
                    onClick: async () => {
                        if (bridge.allowInlineKeyEdit !== false && keyDraft.trim()) {
                            await bridge.updateSettings({ apiKey: keyDraft.trim() });
                        }
                        await refreshAccount();
                    },
                }, `⚡ ${t('account.connectBtn')}`),
            ),
            el(doc, 'div', { className: 'clodex-rp-subbox clodex-rp-mt' },
                el(doc, 'strong', {}, t('account.walletLabel')),
                el(doc, 'div', {}, wallet
                    ? `${formatUsd(wallet.usd)}${wallet.rub !== null ? ` · ${formatRub(wallet.rub)}` : ''}`
                    : t('account.walletUnavailable')),
                videoBilling?.paidUSD !== null && videoBilling?.paidUSD !== undefined
                    ? el(doc, 'div', { className: 'clodex-rp-muted' }, t('account.videoPaidNote', { usd: formatUsd(videoBilling.paidUSD) }))
                    : null,
            ),
            el(doc, 'div', { className: 'clodex-rp-grid-2 clodex-rp-mt' },
                el(doc, 'label', { className: 'clodex-rp-field' },
                    el(doc, 'span', {}, t('account.trackerModel')),
                    buildSelect(modelOptions(textModels, settings.trackerModel), settings.trackerModel, async v => {
                        await bridge.updateSettings({ trackerModel: v });
                    }),
                ),
                el(doc, 'label', { className: 'clodex-rp-field' },
                    el(doc, 'span', {}, t('account.codexModel')),
                    buildSelect(modelOptions(textModels, settings.codexModel), settings.codexModel, async v => {
                        await bridge.updateSettings({ codexModel: v });
                    }),
                ),
                el(doc, 'label', { className: 'clodex-rp-field' },
                    el(doc, 'span', {}, t('account.imageModel')),
                    buildSelect(modelOptions(imageModels.length ? imageModels : catalog, settings.imageModel), settings.imageModel, async v => {
                        await bridge.updateSettings({ imageModel: v });
                    }),
                ),
                el(doc, 'label', { className: 'clodex-rp-field' },
                    el(doc, 'span', {}, t('account.videoModel')),
                    buildSelect(modelOptions(videoModels.length ? videoModels : catalog, settings.videoModel), settings.videoModel, async v => {
                        await bridge.updateSettings({ videoModel: v });
                    }),
                ),
            ),
            el(doc, 'div', { className: 'clodex-rp-toggles clodex-rp-mt' },
                el(doc, 'label', { className: 'clodex-rp-check' },
                    el(doc, 'input', {
                        type: 'checkbox',
                        checked: settings.autoTrack !== false,
                        onChange: async e => { await bridge.updateSettings({ autoTrack: e.target.checked }); },
                    }),
                    el(doc, 'span', {}, t('account.autoTrack')),
                ),
                el(doc, 'label', { className: 'clodex-rp-check' },
                    el(doc, 'input', {
                        type: 'checkbox',
                        checked: settings.injectContext !== false,
                        onChange: async e => { await bridge.updateSettings({ injectContext: e.target.checked }); },
                    }),
                    el(doc, 'span', {}, t('account.injectPrompt')),
                ),
                el(doc, 'label', { className: 'clodex-rp-check' },
                    el(doc, 'input', {
                        type: 'checkbox',
                        checked: settings.confirmPaid !== false,
                        onChange: async e => { await bridge.updateSettings({ confirmPaid: e.target.checked }); },
                    }),
                    el(doc, 'span', {}, t('account.confirmPaid')),
                ),
            ),
            el(doc, 'p', { className: 'clodex-rp-muted clodex-rp-mt' }, t('account.getKeyLink')),
        ));

        return container;
    }

    function renderDrawer() {
        if (!drawerOpen) return;
        const state = bridge.getChatState();

        const tabs = [
            ['tracker', `🧬 ${t('tab.tracker')}`],
            ['codex', `📜 ${t('tab.codex')}`],
            ['scene', `🍌 ${t('tab.scene')}`],
            ['account', `🔑 ${t('tab.account')}`],
        ];

        const body = activeTab === 'codex' ? renderCodexTab(state)
            : activeTab === 'scene' ? renderSceneTab(state)
                : activeTab === 'account' ? renderAccountTab()
                    : renderTrackerTab(state);

        drawerPanel.replaceChildren(
            el(doc, 'header', { className: 'clodex-rp-drawer-head' },
                el(doc, 'strong', { className: 'clodex-rp-brand' }, t('plugin.name')),
                el(doc, 'div', { className: 'clodex-rp-head-actions' },
                    el(doc, 'button', {
                        type: 'button',
                        className: 'clodex-rp-btn-mini',
                        onClick: () => {
                            bridge.saveHudPosition?.(null);
                            applyPillPosition(null);
                        },
                    }, t('drawer.resetPos')),
                    el(doc, 'button', {
                        type: 'button',
                        className: 'clodex-rp-btn-mini',
                        onClick: () => toggleDrawer(false),
                    }, `✕ ${t('drawer.close')}`),
                ),
            ),
            el(doc, 'nav', { className: 'clodex-rp-tabs' },
                ...tabs.map(([id, label]) => el(doc, 'button', {
                    type: 'button',
                    className: `clodex-rp-tab-btn ${activeTab === id ? 'active' : ''}`,
                    onClick: () => {
                        activeTab = id;
                        renderDrawer();
                    },
                }, label)),
            ),
            errorBanner ? el(doc, 'div', { className: 'clodex-rp-error' }, errorBanner) : null,
            body,
        );
    }

    function renderAll() {
        renderHudPill();
        if (drawerOpen) renderDrawer();
    }

    async function onAssistantMessageCommitted({ checkpointKey = '' } = {}) {
        const settings = bridge.getSettings();
        const state = bridge.getChatState();
        if (state.world.pendingMemoryHint) {
            state.world.pendingMemoryHint = '';
            await bridge.saveChatState(state);
        }
        if (settings.autoTrack !== false && bridge.getEffectiveKey()) {
            await syncTrackerFromChat({ checkpointKey, silent: true });
        }
        const autoEvery = Number(settings.autoImageEvery || 0);
        if (autoEvery > 0 && bridge.getEffectiveKey()) {
            const latestState = bridge.getChatState();
            latestState.scene.turnsSinceAutoImage = (latestState.scene.turnsSinceAutoImage || 0) + 1;
            if (latestState.scene.turnsSinceAutoImage >= autoEvery) {
                latestState.scene.turnsSinceAutoImage = 0;
                await bridge.saveChatState(latestState);
                await generateSceneBackground({ auto: true });
            } else {
                await bridge.saveChatState(latestState);
            }
        }
        renderAll();
    }

    const unsubLocale = bridge.onLocaleChange?.(() => renderAll());
    const unsubInsets = bridge.onInsetsChange?.(() => applyPillPosition(bridge.loadHudPosition?.()));
    const onResize = () => applyPillPosition(bridge.loadHudPosition?.());
    win.addEventListener?.('resize', onResize);

    // Initial render & background catalog load if key already present
    renderAll();
    applyPillPosition(bridge.loadHudPosition?.());
    if (bridge.getEffectiveKey()) {
        refreshAccount().catch(() => {});
    }

    return {
        renderAll,
        openTab(tabId = 'tracker') {
            activeTab = tabId;
            toggleDrawer(true);
        },
        toggleDrawer,
        syncTrackerFromChat,
        generateSceneBackground,
        onAssistantMessageCommitted,
        refreshAccount,
        dispose() {
            activeAbort?.abort();
            unsubLocale?.();
            unsubInsets?.();
            win.removeEventListener?.('resize', onResize);
            hostRoot.remove();
        },
    };
}
