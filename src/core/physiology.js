import { addDaysToIso, diffDaysForward, parseIsoDate, TIME_SLOTS } from './date.js';

export const BIO_MODES = Object.freeze(['none', 'cycle', 'omegaverse', 'oviposition']);
export const DISCLOSURE_MODES = Object.freeze(['modern', 'medieval', 'omniscient']);
export const CONTRACEPTION_TYPES = Object.freeze(['none', 'barrier', 'oral', 'iud', 'infertile']);
export const OMEGA_ROLES = Object.freeze(['omega', 'alpha', 'beta', 'enigma']);
export const SUPPRESSANT_LEVELS = Object.freeze(['none', 'standard', 'heavy']);
export const BOND_TYPES = Object.freeze(['none', 'temporary', 'permanent']);
export const SHELL_TRAITS = Object.freeze(['healthy', 'pearl_smooth', 'calcified', 'thin_fragile', 'warm_runic']);
export const COMPLICATION_POOL = Object.freeze([
    'none', 'morning_sickness', 'mild_anemia', 'fatigue_flare', 'blood_pressure_spike', 'back_strain',
]);

const clamp = (val, min, max) => Math.min(max, Math.max(min, Number.isFinite(val) ? val : min));

export function defaultRng() {
    if (globalThis.crypto?.getRandomValues) {
        const arr = new Uint32Array(1);
        globalThis.crypto.getRandomValues(arr);
        return arr[0] / 0x1_0000_0000;
    }
    return Math.random();
}

export function createEntityState(role = 'char') {
    return {
        role,
        enabled: true,
        // SFW Vitals: Respiration, Circulation, Heart Rate, Wounds, Stamina, Stress
        vitals: {
            heartRate: 72,
            breathRate: 14,
            respiration: 'steady', // steady | deep | rapid | breathless | shallow
            circulation: 'normal', // normal | flushed | adrenaline | pallor | hypovolemia
            bloodLossPct: 0,       // 0..45
            stamina: 90,           // 0..100
            stress: 15,            // 0..100
            wounds: [],            // [{ id, label, bleeding: boolean, severity: 1..3, daysOld: 0 }]
        },
        // 18+ Biology (active only when world.enableAdultBiology && bio.mode !== 'none')
        bio: {
            mode: 'none',          // none | cycle | omegaverse | oviposition
            cycleDay: 1,
            cycleLength: 28,
            contraception: 'none', // none | barrier | oral | iud | infertile
            // Pregnancy (cycle: 280d / 40w, omegaverse: 252d / 36w)
            pregnant: false,
            gestationDays: 0,
            gestationTarget: 280,
            fetusCount: 0,
            fetusGenders: [],      // ['female', 'male']
            complication: 'none',
            testTaken: false,
            ultrasoundWeek: 0,
            postpartumDaysLeft: 0,
            cSectionScarDays: 0,
            // Omegaverse Pro
            omegaRole: role === 'char' ? 'alpha' : 'omega',
            pheromoneScent: '',
            pheromoneIntensity: 20, // 0..100
            suppressants: 'none',   // none | standard | heavy
            inHeatOrRut: false,
            heatDaysLeft: 0,
            bondType: 'none',       // none | temporary | permanent
            bondPartner: '',
            // Oviposition / Clutch & Nest Pro
            carryingClutch: false,
            clutchDays: 0,
            clutchTargetDays: 42,
            clutchTotal: 0,
            clutchLaid: 0,
            clutchShells: [],
            clutchGenders: [],
            nest: {
                active: false,
                warmth: 'optimal', // optimal | cool | overheated
                eggs: [],          // [{ id, shell, gender, daysIncubated, targetDays, cracked }]
            },
        },
    };
}

export function createChatState(initialDate = '2026-09-01') {
    return {
        version: 1,
        world: {
            rpDate: parseIsoDate(initialDate) !== null ? initialDate : '2026-09-01',
            dayCount: 1,
            timeOfDay: 'evening',
            location: '',
            weather: '',
            enableVitals: true,
            enableAdultBiology: false,
            disclosureMode: 'modern', // modern | medieval | omniscient
            targetMode: 'both',       // char | user | both
            pendingMemoryHint: '',
        },
        entities: {
            user: createEntityState('user'),
            char: createEntityState('char'),
        },
        offspring: [],    // [{ id, name, parentRole, originMode, gender, bornDate, notes }]
        scene: {
            imagePath: '',
            imagePrompt: '',
            videoPath: '',
            videoTaskId: '',
            videoStatus: 'idle',
            turnsSinceAutoImage: 0,
        },
        codexHistory: [], // [{ role: 'user'|'assistant', content, preset, model, at }]
        activityLog: [],  // [{ atDate, summary }]
        checkpoints: [],  // [{ key, snapshot }]
    };
}

export function normalizeChatState(raw) {
    const base = createChatState();
    if (!raw || typeof raw !== 'object') return base;
    const out = structuredClone(base);
    if (raw.world && typeof raw.world === 'object') {
        out.world.rpDate = parseIsoDate(raw.world.rpDate) !== null ? raw.world.rpDate : base.world.rpDate;
        out.world.dayCount = Math.max(1, Math.trunc(Number(raw.world.dayCount) || 1));
        out.world.timeOfDay = TIME_SLOTS.includes(raw.world.timeOfDay) ? raw.world.timeOfDay : 'evening';
        out.world.location = String(raw.world.location ?? '').slice(0, 160);
        out.world.weather = String(raw.world.weather ?? '').slice(0, 120);
        out.world.enableVitals = raw.world.enableVitals !== false;
        out.world.enableAdultBiology = Boolean(raw.world.enableAdultBiology);
        out.world.disclosureMode = DISCLOSURE_MODES.includes(raw.world.disclosureMode) ? raw.world.disclosureMode : 'modern';
        out.world.targetMode = ['char', 'user', 'both'].includes(raw.world.targetMode) ? raw.world.targetMode : 'both';
        out.world.pendingMemoryHint = String(raw.world.pendingMemoryHint ?? '').slice(0, 2000);
    }
    for (const key of ['user', 'char']) {
        const src = raw.entities?.[key];
        if (!src || typeof src !== 'object') continue;
        const dst = out.entities[key];
        dst.enabled = src.enabled !== false;
        if (src.vitals && typeof src.vitals === 'object') {
            dst.vitals.heartRate = Math.round(clamp(Number(src.vitals.heartRate), 40, 210));
            dst.vitals.breathRate = Math.round(clamp(Number(src.vitals.breathRate), 8, 50));
            dst.vitals.respiration = ['steady', 'deep', 'rapid', 'breathless', 'shallow'].includes(src.vitals.respiration)
                ? src.vitals.respiration : 'steady';
            dst.vitals.circulation = ['normal', 'flushed', 'adrenaline', 'pallor', 'hypovolemia'].includes(src.vitals.circulation)
                ? src.vitals.circulation : 'normal';
            dst.vitals.bloodLossPct = Math.round(clamp(Number(src.vitals.bloodLossPct), 0, 45));
            dst.vitals.stamina = Math.round(clamp(Number(src.vitals.stamina), 0, 100));
            dst.vitals.stress = Math.round(clamp(Number(src.vitals.stress), 0, 100));
            dst.vitals.wounds = Array.isArray(src.vitals.wounds) ? src.vitals.wounds.slice(0, 8).map(w => ({
                id: String(w.id || Math.random().toString(36).slice(2, 8)),
                label: String(w.label ?? '').slice(0, 100),
                bleeding: Boolean(w.bleeding),
                severity: Math.round(clamp(Number(w.severity) || 1, 1, 3)),
                daysOld: Math.max(0, Math.trunc(Number(w.daysOld) || 0)),
            })).filter(w => w.label) : [];
        }
        if (src.bio && typeof src.bio === 'object') {
            const b = src.bio;
            dst.bio.mode = BIO_MODES.includes(b.mode) ? b.mode : 'none';
            dst.bio.cycleLength = Math.round(clamp(Number(b.cycleLength) || 28, 21, 35));
            dst.bio.cycleDay = Math.round(clamp(Number(b.cycleDay) || 1, 1, dst.bio.cycleLength));
            dst.bio.contraception = CONTRACEPTION_TYPES.includes(b.contraception) ? b.contraception : 'none';
            dst.bio.pregnant = Boolean(b.pregnant);
            dst.bio.gestationDays = Math.max(0, Math.trunc(Number(b.gestationDays) || 0));
            dst.bio.gestationTarget = Math.round(clamp(Number(b.gestationTarget) || 280, 120, 310));
            dst.bio.fetusCount = Math.round(clamp(Number(b.fetusCount) || 0, 0, 4));
            dst.bio.fetusGenders = Array.isArray(b.fetusGenders)
                ? b.fetusGenders.slice(0, 4).map(g => (g === 'male' ? 'male' : 'female')) : [];
            dst.bio.complication = COMPLICATION_POOL.includes(b.complication) ? b.complication : 'none';
            dst.bio.testTaken = Boolean(b.testTaken);
            dst.bio.ultrasoundWeek = Math.max(0, Math.trunc(Number(b.ultrasoundWeek) || 0));
            dst.bio.postpartumDaysLeft = Math.max(0, Math.trunc(Number(b.postpartumDaysLeft) || 0));
            dst.bio.cSectionScarDays = Math.max(0, Math.trunc(Number(b.cSectionScarDays) || 0));
            dst.bio.omegaRole = OMEGA_ROLES.includes(b.omegaRole) ? b.omegaRole : dst.bio.omegaRole;
            dst.bio.pheromoneScent = String(b.pheromoneScent ?? '').slice(0, 80);
            dst.bio.pheromoneIntensity = Math.round(clamp(Number(b.pheromoneIntensity) || 20, 0, 100));
            dst.bio.suppressants = SUPPRESSANT_LEVELS.includes(b.suppressants) ? b.suppressants : 'none';
            dst.bio.inHeatOrRut = Boolean(b.inHeatOrRut);
            dst.bio.heatDaysLeft = Math.max(0, Math.trunc(Number(b.heatDaysLeft) || 0));
            dst.bio.bondType = BOND_TYPES.includes(b.bondType) ? b.bondType : 'none';
            dst.bio.bondPartner = String(b.bondPartner ?? '').slice(0, 80);
            dst.bio.carryingClutch = Boolean(b.carryingClutch);
            dst.bio.clutchDays = Math.max(0, Math.trunc(Number(b.clutchDays) || 0));
            dst.bio.clutchTargetDays = Math.round(clamp(Number(b.clutchTargetDays) || 42, 14, 90));
            dst.bio.clutchTotal = Math.round(clamp(Number(b.clutchTotal) || 0, 0, 8));
            dst.bio.clutchLaid = Math.round(clamp(Number(b.clutchLaid) || 0, 0, dst.bio.clutchTotal));
            dst.bio.clutchShells = Array.isArray(b.clutchShells) ? b.clutchShells.slice(0, 8).map(String) : [];
            dst.bio.clutchGenders = Array.isArray(b.clutchGenders) ? b.clutchGenders.slice(0, 8).map(String) : [];
            if (b.nest && typeof b.nest === 'object') {
                dst.bio.nest.active = Boolean(b.nest.active);
                dst.bio.nest.warmth = ['optimal', 'cool', 'overheated'].includes(b.nest.warmth) ? b.nest.warmth : 'optimal';
                dst.bio.nest.eggs = Array.isArray(b.nest.eggs) ? b.nest.eggs.slice(0, 12).map((egg, idx) => ({
                    id: String(egg.id || `egg-${idx + 1}`),
                    shell: SHELL_TRAITS.includes(egg.shell) ? egg.shell : 'healthy',
                    gender: egg.gender === 'male' ? 'male' : 'female',
                    daysIncubated: Math.max(0, Number(egg.daysIncubated) || 0),
                    targetDays: Math.round(clamp(Number(egg.targetDays) || 60, 14, 120)),
                    cracked: Boolean(egg.cracked),
                })) : [];
            }
        }
    }
    if (Array.isArray(raw.offspring)) {
        out.offspring = raw.offspring.slice(0, 40).map((child, idx) => ({
            id: String(child.id || `child-${idx + 1}`),
            name: String(child.name ?? '').slice(0, 80),
            parentRole: child.parentRole === 'user' ? 'user' : 'char',
            originMode: String(child.originMode || 'cycle'),
            gender: child.gender === 'male' ? 'male' : 'female',
            bornDate: String(child.bornDate || out.world.rpDate),
            notes: String(child.notes ?? '').slice(0, 140),
        }));
    }
    if (raw.scene && typeof raw.scene === 'object') {
        out.scene.imagePath = String(raw.scene.imagePath ?? '').slice(0, 500);
        out.scene.imagePrompt = String(raw.scene.imagePrompt ?? '').slice(0, 2000);
        out.scene.videoPath = String(raw.scene.videoPath ?? '').slice(0, 500);
        out.scene.videoTaskId = String(raw.scene.videoTaskId ?? '').slice(0, 200);
        out.scene.videoStatus = String(raw.scene.videoStatus || 'idle').slice(0, 40);
        out.scene.turnsSinceAutoImage = Math.max(0, Math.trunc(Number(raw.scene.turnsSinceAutoImage) || 0));
    }
    if (Array.isArray(raw.codexHistory)) {
        out.codexHistory = raw.codexHistory.slice(-24).map(item => ({
            role: item.role === 'user' ? 'user' : 'assistant',
            content: String(item.content ?? '').slice(0, 6000),
            preset: String(item.preset ?? 'lore_keeper'),
            model: String(item.model ?? ''),
            at: String(item.at ?? ''),
        })).filter(item => item.content);
    }
    if (Array.isArray(raw.activityLog)) {
        out.activityLog = raw.activityLog.slice(-40).map(entry => ({
            atDate: String(entry.atDate ?? ''),
            summary: String(entry.summary ?? '').slice(0, 240),
        })).filter(e => e.summary);
    }
    if (Array.isArray(raw.checkpoints)) {
        out.checkpoints = raw.checkpoints.slice(-25).filter(cp => cp && typeof cp.key === 'string' && cp.snapshot);
    }
    return out;
}

export function getCyclePhase(bio) {
    if (bio.postpartumDaysLeft > 0) return 'postpartum';
    if (bio.pregnant) {
        const week = Math.floor(bio.gestationDays / 7) + 1;
        return week <= 13 ? 'trimester_1' : week <= 27 ? 'trimester_2' : 'trimester_3';
    }
    if (bio.mode === 'omegaverse') {
        if (bio.inHeatOrRut) return bio.omegaRole === 'alpha' || bio.omegaRole === 'enigma' ? 'rut' : 'heat';
        if (bio.omegaRole === 'beta') return 'stable_beta';
        const preWindow = bio.cycleLength - 2;
        if (bio.cycleDay >= preWindow) return 'pre_heat';
        return 'baseline';
    }
    if (bio.mode === 'oviposition') {
        if (bio.carryingClutch) return bio.clutchDays >= bio.clutchTargetDays - 5 ? 'ready_to_lay' : 'gravid';
        if (bio.nest.active && bio.nest.eggs.length > 0) return 'nesting';
        return 'fertile_cycle';
    }
    // Realistic cycle (scaled proportionally to cycleLength around ovulation at length - 14)
    const ovulationCenter = Math.max(8, bio.cycleLength - 14);
    if (bio.cycleDay <= 5) return 'menstruation';
    if (bio.cycleDay < ovulationCenter - 1) return 'follicular';
    if (bio.cycleDay <= ovulationCenter + 1) return 'ovulation';
    return 'luteal';
}

export function computeConceptionChance(bio, { knotted = false } = {}) {
    if (bio.pregnant || bio.carryingClutch || bio.postpartumDaysLeft > 7) return 0;
    if (bio.contraception === 'infertile') return 0;

    let base = 0;
    if (bio.mode === 'cycle') {
        const phase = getCyclePhase(bio);
        base = phase === 'ovulation' ? 0.34
            : phase === 'follicular' && bio.cycleDay >= bio.cycleLength - 17 ? 0.16
                : phase === 'menstruation' ? 0.01 : 0.04;
    } else if (bio.mode === 'omegaverse') {
        if (bio.omegaRole !== 'omega') return 0;
        base = bio.inHeatOrRut ? 0.65 : (getCyclePhase(bio) === 'pre_heat' ? 0.22 : 0.05);
        if (knotted) base = Math.min(0.92, base + 0.2);
        if (bio.suppressants === 'standard') base *= 0.25;
        if (bio.suppressants === 'heavy') base *= 0.03;
    } else if (bio.mode === 'oviposition') {
        base = 0.55;
        if (bio.contraception === 'barrier') base *= 0.1;
    } else {
        return 0;
    }

    const mult = bio.contraception === 'barrier' ? 0.06
        : bio.contraception === 'oral' ? 0.015
            : bio.contraception === 'iud' ? 0.005 : 1;
    return clamp(base * mult, 0, 0.98);
}

export function recomputeDerivedVitals(vitals) {
    const bleedingCount = vitals.wounds.filter(w => w.bleeding).reduce((acc, w) => acc + w.severity, 0);
    if (vitals.bloodLossPct >= 28) {
        vitals.circulation = 'hypovolemia';
        vitals.heartRate = Math.max(vitals.heartRate, 128);
        vitals.respiration = 'shallow';
        vitals.breathRate = Math.max(vitals.breathRate, 26);
    } else if (vitals.bloodLossPct >= 14 || bleedingCount >= 2) {
        vitals.circulation = 'pallor';
        vitals.heartRate = Math.max(vitals.heartRate, 106);
    } else if (vitals.stress >= 75 && vitals.circulation === 'normal') {
        vitals.circulation = 'adrenaline';
    }
}

export function triggerConception(entity, state, { rng = defaultRng, knotted = false, force = false } = {}) {
    const { bio } = entity;
    if (bio.mode === 'none') return false;
    if (!force) {
        const chance = computeConceptionChance(bio, { knotted });
        if (chance <= 0 || rng() >= chance) return false;
    }
    if (bio.mode === 'oviposition') {
        if (bio.carryingClutch) return false;
        const count = 2 + Math.floor(rng() * 5); // 2..6 eggs
        bio.carryingClutch = true;
        bio.clutchDays = 1;
        bio.clutchTargetDays = 42;
        bio.clutchTotal = count;
        bio.clutchLaid = 0;
        bio.clutchShells = Array.from({ length: count }, () => SHELL_TRAITS[Math.floor(rng() * SHELL_TRAITS.length)]);
        bio.clutchGenders = Array.from({ length: count }, () => (rng() < 0.5 ? 'female' : 'male'));
        logEvent(state, `${entity.role}: clutch fertilized`);
        return true;
    }

    if (bio.pregnant) return false;
    const multiRoll = rng();
    const count = multiRoll < 0.004 ? 3 : multiRoll < 0.04 ? 2 : 1;
    bio.pregnant = true;
    bio.gestationDays = 1;
    bio.gestationTarget = bio.mode === 'omegaverse' ? 252 : 280;
    bio.fetusCount = count;
    bio.fetusGenders = Array.from({ length: count }, () => (rng() < 0.5 ? 'female' : 'male'));
    bio.complication = rng() < 0.22
        ? COMPLICATION_POOL[1 + Math.floor(rng() * (COMPLICATION_POOL.length - 1))]
        : 'none';
    bio.testTaken = false;
    bio.ultrasoundWeek = 0;
    bio.inHeatOrRut = false;
    bio.heatDaysLeft = 0;
    logEvent(state, `${entity.role}: conception occurred`);
    return true;
}

export function deliverBabies(entity, state, { method = 'natural' } = {}) {
    const { bio } = entity;
    if (!bio.pregnant || bio.fetusCount <= 0) return [];
    const created = [];
    for (let i = 0; i < bio.fetusCount; i += 1) {
        const child = {
            id: `child-${Date.now()}-${i + 1}-${Math.random().toString(36).slice(2, 6)}`,
            name: '',
            parentRole: entity.role,
            originMode: bio.mode,
            gender: bio.fetusGenders[i] || 'female',
            bornDate: state.world.rpDate,
            notes: method === 'c_section' ? 'C-section' : 'Natural birth',
        };
        state.offspring.push(child);
        created.push(child);
    }
    bio.pregnant = false;
    bio.gestationDays = 0;
    bio.fetusCount = 0;
    bio.fetusGenders = [];
    bio.complication = 'none';
    bio.testTaken = false;
    bio.ultrasoundWeek = 0;
    bio.postpartumDaysLeft = 42;
    bio.cSectionScarDays = method === 'c_section' ? 56 : 0;
    bio.cycleDay = 1;
    logEvent(state, `${entity.role}: delivered ${created.length} (${method})`);
    return created;
}

export function layEggs(entity, state, count = null) {
    const { bio } = entity;
    if (!bio.carryingClutch || bio.clutchTotal <= bio.clutchLaid) return 0;
    const remaining = bio.clutchTotal - bio.clutchLaid;
    const toLay = count === null ? remaining : clamp(Math.trunc(count), 1, remaining);
    for (let i = 0; i < toLay; i += 1) {
        const idx = bio.clutchLaid + i;
        bio.nest.eggs.push({
            id: `egg-${Date.now()}-${idx + 1}-${Math.random().toString(36).slice(2, 5)}`,
            shell: bio.clutchShells[idx] || 'healthy',
            gender: bio.clutchGenders[idx] || 'female',
            daysIncubated: 0,
            targetDays: 60,
            cracked: false,
        });
    }
    bio.clutchLaid += toLay;
    bio.nest.active = bio.nest.eggs.length > 0;
    if (bio.clutchLaid >= bio.clutchTotal) {
        bio.carryingClutch = false;
        bio.clutchDays = 0;
        bio.clutchTotal = 0;
        bio.clutchLaid = 0;
        bio.clutchShells = [];
        bio.clutchGenders = [];
        bio.postpartumDaysLeft = 10;
    }
    logEvent(state, `${entity.role}: laid ${toLay} egg(s)`);
    return toLay;
}

export function hatchReadyEggs(entity, state, { forceAll = false } = {}) {
    const { bio } = entity;
    if (!bio.nest.active || !bio.nest.eggs.length) return [];
    const hatched = [];
    const remaining = [];
    for (const egg of bio.nest.eggs) {
        if (forceAll || egg.daysIncubated >= egg.targetDays) {
            const hatchling = {
                id: `hatch-${Date.now()}-${hatched.length + 1}-${Math.random().toString(36).slice(2, 5)}`,
                name: '',
                parentRole: entity.role,
                originMode: 'oviposition',
                gender: egg.gender,
                bornDate: state.world.rpDate,
                notes: `Hatched (${egg.shell})`,
            };
            state.offspring.push(hatchling);
            hatched.push(hatchling);
        } else {
            remaining.push(egg);
        }
    }
    bio.nest.eggs = remaining;
    bio.nest.active = remaining.length > 0;
    if (hatched.length) logEvent(state, `${entity.role}: hatched ${hatched.length}`);
    return hatched;
}

export function advanceSimulationDays(state, deltaDays, { rng = defaultRng } = {}) {
    const days = clamp(Math.trunc(Number(deltaDays) || 0), 0, 365);
    if (days <= 0) return state;

    state.world.rpDate = addDaysToIso(state.world.rpDate, days);
    state.world.dayCount += days;

    for (const key of ['user', 'char']) {
        const entity = state.entities[key];
        const { vitals, bio } = entity;

        // Natural vitals recovery over days
        if (vitals.bloodLossPct > 0) {
            vitals.bloodLossPct = Math.max(0, vitals.bloodLossPct - days * 3);
        }
        vitals.stamina = clamp(vitals.stamina + days * 25, 0, 100);
        vitals.stress = clamp(vitals.stress - days * 10, 0, 100);
        vitals.wounds = vitals.wounds
            .map(w => ({ ...w, bleeding: days >= 1 ? false : w.bleeding, daysOld: w.daysOld + days }))
            .filter(w => w.daysOld < w.severity * 7);
        if (vitals.bloodLossPct === 0 && vitals.wounds.length === 0) {
            vitals.circulation = 'normal';
            vitals.respiration = 'steady';
            vitals.heartRate = 72;
            vitals.breathRate = 14;
        } else {
            recomputeDerivedVitals(vitals);
        }

        if (!state.world.enableAdultBiology || bio.mode === 'none') continue;

        for (let d = 0; d < days; d += 1) {
            if (bio.cSectionScarDays > 0) bio.cSectionScarDays -= 1;
            // External nest eggs continue incubating even while the parent recovers from laying!
            if (bio.mode === 'oviposition' && bio.nest.active && bio.nest.eggs.length > 0) {
                const rate = bio.nest.warmth === 'optimal' ? 1 : bio.nest.warmth === 'cool' ? 0.5 : 0.75;
                for (const egg of bio.nest.eggs) {
                    egg.daysIncubated = Math.min(egg.targetDays, egg.daysIncubated + rate);
                    if (egg.daysIncubated >= egg.targetDays * 0.9) egg.cracked = true;
                }
            }
            if (bio.postpartumDaysLeft > 0) {
                bio.postpartumDaysLeft -= 1;
                continue;
            }
            if (bio.pregnant) {
                bio.gestationDays += 1;
                if (bio.gestationDays >= 98 && bio.complication === 'none' && rng() < 0.004) {
                    bio.complication = COMPLICATION_POOL[1 + Math.floor(rng() * (COMPLICATION_POOL.length - 1))];
                }
                continue;
            }
            if (bio.mode === 'oviposition') {
                if (bio.carryingClutch) {
                    bio.clutchDays = Math.min(bio.clutchTargetDays + 14, bio.clutchDays + 1);
                } else {
                    bio.cycleDay = (bio.cycleDay % bio.cycleLength) + 1;
                }
                continue;
            }
            // Cycle & Omegaverse day progression
            if (bio.mode === 'omegaverse' && bio.inHeatOrRut) {
                bio.heatDaysLeft -= 1;
                if (bio.heatDaysLeft <= 0) {
                    bio.inHeatOrRut = false;
                    bio.pheromoneIntensity = 25;
                }
            }
            bio.cycleDay += 1;
            if (bio.cycleDay > bio.cycleLength) {
                bio.cycleDay = 1;
                if (bio.mode === 'omegaverse' && bio.omegaRole !== 'beta' && bio.suppressants !== 'heavy') {
                    bio.inHeatOrRut = true;
                    bio.heatDaysLeft = bio.suppressants === 'standard' ? 2 : 4;
                    bio.pheromoneIntensity = bio.suppressants === 'standard' ? 55 : 90;
                }
            }
        }
    }
    logEvent(state, `+${days}d → ${state.world.rpDate}`);
    return state;
}

export function saveCheckpoint(state, checkpointKey) {
    if (!checkpointKey) return;
    const copy = structuredClone(state);
    delete copy.checkpoints;
    delete copy.codexHistory;
    const filtered = state.checkpoints.filter(cp => cp.key !== checkpointKey);
    filtered.push({ key: String(checkpointKey), snapshot: copy });
    state.checkpoints = filtered.slice(-25);
}

export function restoreCheckpointBefore(state, checkpointKey) {
    const idx = state.checkpoints.findIndex(cp => cp.key === checkpointKey);
    if (idx <= 0) return false;
    const target = state.checkpoints[idx - 1];
    const preservedCodex = state.codexHistory;
    const preservedCheckpoints = state.checkpoints.slice(0, idx);
    const restored = normalizeChatState(target.snapshot);
    Object.assign(state, restored);
    state.codexHistory = preservedCodex;
    state.checkpoints = preservedCheckpoints;
    return true;
}

export function applyTurnExtraction(state, delta, { checkpointKey = '', rng = defaultRng } = {}) {
    if (!delta || typeof delta !== 'object') return state;

    let forwardDays = Math.max(0, Math.trunc(Number(delta.daysElapsed) || 0));
    if (delta.newRpDate) {
        const byIso = diffDaysForward(state.world.rpDate, delta.newRpDate);
        if (byIso > forwardDays) forwardDays = byIso;
    }
    if (forwardDays > 0) {
        advanceSimulationDays(state, forwardDays, { rng });
    }
    if (TIME_SLOTS.includes(delta.timeOfDay)) state.world.timeOfDay = delta.timeOfDay;
    if (typeof delta.location === 'string' && delta.location.trim()) {
        state.world.location = delta.location.trim().slice(0, 140);
    }
    if (typeof delta.weather === 'string' && delta.weather.trim()) {
        state.world.weather = delta.weather.trim().slice(0, 100);
    }

    for (const role of ['user', 'char']) {
        const ed = delta.entities?.[role];
        if (!ed || typeof ed !== 'object') continue;
        const entity = state.entities[role];
        const { vitals, bio } = entity;

        if (state.world.enableVitals) {
            if (Number.isFinite(ed.heartRate)) vitals.heartRate = Math.round(clamp(ed.heartRate, 42, 205));
            if (Number.isFinite(ed.breathRate)) vitals.breathRate = Math.round(clamp(ed.breathRate, 8, 48));
            if (['steady', 'deep', 'rapid', 'breathless', 'shallow'].includes(ed.respiration)) {
                vitals.respiration = ed.respiration;
            }
            if (['normal', 'flushed', 'adrenaline', 'pallor', 'hypovolemia'].includes(ed.circulation)) {
                vitals.circulation = ed.circulation;
            }
            if (Number.isFinite(ed.bloodLossDelta) && ed.bloodLossDelta !== 0) {
                vitals.bloodLossPct = Math.round(clamp(vitals.bloodLossPct + ed.bloodLossDelta, 0, 45));
            }
            if (Number.isFinite(ed.staminaDelta)) {
                vitals.stamina = Math.round(clamp(vitals.stamina + ed.staminaDelta, 0, 100));
            }
            if (Number.isFinite(ed.stressDelta)) {
                vitals.stress = Math.round(clamp(vitals.stress + ed.stressDelta, 0, 100));
            }
            if (typeof ed.newWound === 'string' && ed.newWound.trim()) {
                const label = ed.newWound.trim().slice(0, 90);
                if (!vitals.wounds.some(w => w.label.toLowerCase() === label.toLowerCase())) {
                    vitals.wounds.push({
                        id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                        label,
                        bleeding: Boolean(ed.woundBleeding),
                        severity: clamp(Math.round(Number(ed.woundSeverity) || 1), 1, 3),
                        daysOld: 0,
                    });
                }
            }
            if (ed.treatedWounds) {
                vitals.wounds = vitals.wounds.map(w => ({ ...w, bleeding: false }));
            }
            recomputeDerivedVitals(vitals);
        }

        if (state.world.enableAdultBiology && bio.mode !== 'none') {
            if (Number.isFinite(ed.pheromoneIntensity) && bio.mode === 'omegaverse') {
                bio.pheromoneIntensity = Math.round(clamp(ed.pheromoneIntensity, 0, 100));
            }
            if (ed.bondFormed && bio.mode === 'omegaverse') {
                bio.bondType = ed.bondFormed === 'permanent' ? 'permanent' : 'temporary';
                if (typeof ed.bondPartner === 'string' && ed.bondPartner.trim()) {
                    bio.bondPartner = ed.bondPartner.trim().slice(0, 80);
                }
            }
            if (ed.pregnancyTestTaken && bio.pregnant && bio.gestationDays >= 10) {
                bio.testTaken = true;
            }
            if (ed.ultrasoundPerformed && bio.pregnant) {
                const week = Math.floor(bio.gestationDays / 7) + 1;
                bio.ultrasoundWeek = Math.max(bio.ultrasoundWeek, week);
            }
            if (ed.unprotectedIntimacy || ed.intimacyOccurred) {
                triggerConception(entity, state, { rng, knotted: Boolean(ed.knotted) });
            }
            if (ed.birthOccurred && bio.pregnant) {
                deliverBabies(entity, state, { method: ed.birthMethod === 'c_section' ? 'c_section' : 'natural' });
            }
            if (ed.eggsLaidCount && bio.mode === 'oviposition' && bio.carryingClutch) {
                const n = ed.eggsLaidCount === 'all' ? null : Number(ed.eggsLaidCount) || 1;
                layEggs(entity, state, n);
            }
            if (ed.eggsHatched && bio.mode === 'oviposition' && bio.nest.active) {
                hatchReadyEggs(entity, state, { forceAll: true });
            }
        }
    }

    if (checkpointKey) saveCheckpoint(state, checkpointKey);
    return state;
}

export function getVisibleBiologySummary(entity, disclosureMode = 'modern') {
    const { bio } = entity;
    const phase = getCyclePhase(bio);
    if (bio.mode === 'none') return { phase: 'off', knownPregnant: false, revealCount: false, revealGender: false };

    if (!bio.pregnant) {
        return { phase, knownPregnant: false, revealCount: false, revealGender: false };
    }

    const week = Math.floor(bio.gestationDays / 7) + 1;
    if (disclosureMode === 'omniscient') {
        return { phase, week, knownPregnant: true, revealCount: true, revealGender: true };
    }
    if (disclosureMode === 'medieval') {
        const suspected = week >= 6;
        return { phase, week, knownPregnant: suspected, revealCount: false, revealGender: false };
    }
    // modern: suspected after missed period (~week 4+) or testTaken; count at US >= 12w; gender at US >= 20w
    const knownPregnant = bio.testTaken || week >= 5;
    const revealCount = bio.ultrasoundWeek >= 12;
    const revealGender = bio.ultrasoundWeek >= 20;
    return { phase, week, knownPregnant, revealCount, revealGender };
}

export function activeEntitiesForTarget(targetMode) {
    if (targetMode === 'user') return ['user'];
    if (targetMode === 'char') return ['char'];
    return ['char', 'user'];
}

function logEvent(state, summary) {
    state.activityLog.push({ atDate: state.world.rpDate, summary });
    if (state.activityLog.length > 40) state.activityLog = state.activityLog.slice(-40);
}
