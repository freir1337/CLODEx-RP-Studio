export const TIME_SLOTS = Object.freeze(['morning', 'day', 'evening', 'night']);

export function parseIsoDate(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
    return Math.floor(utc.getTime() / 86_400_000);
}

export function formatEpochDays(epochDays) {
    const utc = new Date(Math.round(epochDays) * 86_400_000);
    const y = String(utc.getUTCFullYear()).padStart(4, '0');
    const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
    const d = String(utc.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function addDaysToIso(isoDate, deltaDays) {
    const base = parseIsoDate(isoDate) ?? parseIsoDate('2026-09-01');
    const step = Number.isFinite(deltaDays) ? Math.trunc(deltaDays) : 0;
    return formatEpochDays(base + step);
}

export function diffDaysForward(currentIso, proposedIso) {
    const cur = parseIsoDate(currentIso);
    const next = parseIsoDate(proposedIso);
    if (cur === null || next === null) return 0;
    // Anti-rollback guard: flashbacks in dialogue must never rewind physiological timelines.
    const diff = next - cur;
    return diff > 0 && diff <= 3650 ? diff : 0;
}

export function formatShortDate(isoDate, locale = 'ru') {
    const epoch = parseIsoDate(isoDate);
    if (epoch === null) return String(isoDate || 'Day 1');
    const date = new Date(epoch * 86_400_000);
    try {
        return new Intl.DateTimeFormat(locale.startsWith('ru') ? 'ru-RU' : 'en-US', {
            day: 'numeric',
            month: 'short',
            timeZone: 'UTC',
        }).format(date);
    } catch {
        return isoDate;
    }
}
