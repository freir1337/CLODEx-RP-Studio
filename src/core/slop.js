// M2 «Радар штампов» (Anti-Slop) for CLODEx RP Studio v1.3. Fully local, no API calls.
// Pure functions except an internal bounded stem cache. Depends on textnorm.js.
// Flat-bundler safe: every top-level name is slop*/SLOP_*-prefixed.
import { tnIsStopWord, tnStem, tnWords, tnEstimateTokens } from './textnorm.js';

export const SLOP_BUILTIN_RU = Object.freeze([
    'дрожь пробежала по спине', 'дрожь по спине', 'по спине пробежал холодок', 'холодок по спине',
    'мурашки побежали по коже', 'по коже побежали мурашки', 'мурашки по коже', 'сердце пропустило удар',
    'сердце забилось чаще', 'сердце бешено колотилось', 'сердце ушло в пятки', 'сердце сжалось',
    'дыхание перехватило', 'затаила дыхание', 'затаил дыхание', 'задержала дыхание', 'медленно выдохнула',
    'тяжело вздохнула', 'с тихим вздохом', 'не в силах отвести взгляд', 'не могла отвести взгляд',
    'глаза потемнели', 'в глазах мелькнул огонёк', 'озорной огонёк', 'глаза сверкнули', 'хищная ухмылка',
    'хищная улыбка', 'ухмыльнулся', 'ухмыльнулась', 'кривая усмешка', 'уголки губ дрогнули',
    'уголок губ дёрнулся', 'губы растянулись в улыбке', 'на губах заиграла улыбка', 'улыбка тронула губы',
    'не смогла сдержать улыбку', 'закусила губу', 'прикусила губу', 'облизнула губы', 'щёки залились румянцем',
    'залилась краской', 'румянец залил щёки', 'жар разлился по телу', 'по телу разлилось тепло', 'волна тепла',
    'тепло внизу живота', 'голос стал ниже', 'низким голосом', 'хриплым голосом', 'голос сорвался на шёпот',
    'голос дрогнул', 'прошептала ему на ухо', 'горячее дыхание', 'дыхание обожгло', 'бархатный голос',
    'мурлыкнула', 'промурлыкала', 'низко рассмеялся', 'гортанный смех', 'запах озона', 'пахло озоном',
    'запах сандала', 'аромат ванили', 'мускусный запах', 'металлический привкус', 'привкус меди',
    'воздух сгустился', 'напряжение повисло в воздухе', 'повисла тишина', 'звенящая тишина',
    'оглушительная тишина', 'время словно остановилось', 'мир вокруг перестал существовать', 'мир сузился',
    'сжала кулаки', 'костяшки пальцев побелели', 'стиснул зубы', 'желваки заходили', 'скрестила руки на груди',
    'склонила голову набок', 'приподняла бровь', 'вскинула бровь', 'выгнула бровь', 'закатила глаза',
    'фыркнула', 'хмыкнул', 'прищурился', 'сузил глаза', 'взгляд скользнул по', 'окинул её взглядом',
    'смерил взглядом', 'пронзительный взгляд', 'ком в горле', 'к горлу подступил ком', 'внутри всё перевернулось',
    'бабочки в животе', 'узел в животе', 'колени подогнулись', 'ноги стали ватными', 'голова закружилась',
    'разум затуманился', 'не в силах сопротивляться', 'словно магнитом', 'как будто ток прошёл',
    'электрический разряд', 'искра пробежала между ними', 'в воздухе витало', 'что-то изменилось',
    'впервые за долгое время', 'в тот же миг', 'провёл рукой по волосам', 'заправила прядь за ухо',
    'мягко произнёс', 'тихо произнесла', 'и это было только начало', 'игра только начинается',
    'ты даже не представляешь', 'ты играешь с огнём', 'хороший мальчик', 'хорошая девочка',
    'маленькая лисичка', 'кошки-мышки', 'с хищной грацией', 'опасный блеск', 'едва слышно',
]);

export const SLOP_BUILTIN_EN = Object.freeze([
    'a shiver ran down her spine', 'shiver down her spine', 'shivers down his spine', 'sent shivers down',
    'a chill ran down', 'goosebumps', "breath she didn't know she was holding", 'let out a breath',
    'her breath hitched', 'breath caught in her throat', 'heart skipped a beat', 'heart pounded',
    'heart hammered in her chest', 'pulse quickened', 'smirked', 'a smirk tugged at', 'a sly smirk',
    'a wicked grin', 'grinned wolfishly', 'a predatory grin', 'a predatory smile', 'eyes sparkled with mischief',
    'a glint in his eyes', 'a mischievous glint', 'eyes darkened', 'eyes gleaming', 'eyes twinkling',
    'raised an eyebrow', 'arched an eyebrow', 'quirked an eyebrow', 'rolled her eyes', 'bit her lip',
    'chewed on her lip', 'licked his lips', 'cheeks flushed', 'a blush crept up', 'heat pooled',
    'warmth spread through', 'a wave of warmth', 'a jolt of electricity', 'sent a jolt', 'electricity crackled',
    'sparks flew', 'the air crackled', 'the tension was palpable', 'tension hung in the air', 'the air grew thick',
    'smell of ozone', 'scent of ozone', 'scent of sandalwood', 'hint of vanilla', 'musky scent', 'metallic tang',
    'coppery taste', 'time seemed to stop', 'the world faded away', 'the rest of the world melted away',
    'deafening silence', 'an eerie silence', 'a comfortable silence', 'clenched his jaw', 'jaw tightened',
    'knuckles turned white', 'fists clenched', 'crossed her arms', 'tilted her head', 'cocked his head',
    'voice dropped to a whisper', 'barely above a whisper', 'husky voice', 'low and husky', 'voice like velvet',
    'purred', 'chuckled darkly', 'a low chuckle', 'a throaty laugh', 'whispered in her ear', 'hot breath against',
    'his breath ghosted', 'ghosted over', 'sent a thrill through', 'a thrill of anticipation',
    'knot in her stomach', 'butterflies in her stomach', 'her knees went weak', 'weak at the knees',
    'mind went blank', 'head spun', "couldn't help but", "couldn't tear her eyes away", 'unable to look away',
    'like a moth to a flame', 'ran a hand through his hair', 'tucked a strand of hair', 'padded across the room',
    'the corner of his mouth twitched', 'lips curled into a smile', 'a ghost of a smile', 'a small smile played',
    'maybe just maybe', 'little did she know', 'for the first time in a long time', 'something shifted',
    'a testament to', 'tapestry of', 'eyes never leaving', 'orbs', "you're playing with fire", 'you have no idea',
    'the game has just begun', 'good girl', 'good boy', 'little minx', 'his gaze raked over', 'gaze lingered',
    'eyes roamed', 'searing kiss', 'claimed her lips', 'a mix of fear and excitement', "couldn't shake the feeling",
]);

export const SLOP_MAX_MESSAGES = 20;
export const SLOP_MIN_COUNT = 3;
export const SLOP_MIN_MESSAGES = 3;
export const SLOP_BUILTIN_MIN_COUNT = 2;
export const SLOP_TOP = 20;
export const SLOP_RULE_MAX_PHRASES = 6;
export const SLOP_RULE_MAX_TOKENS = 60;
export const SLOP_RULE_PREFIX = 'Style variety: find fresh phrasing instead of repeating: ';

// Clause boundaries: n-grams never cross sentence punctuation, dashes or quotes.
const slopSegmentRe = /[.!?…;:\n\r()[\]«»"“”„—–]+/;
const slopStemCache = new Map();
const slopBuiltinIndexCache = { key: '', index: null };

function slopStemOf(word) {
    let stem = slopStemCache.get(word);
    if (stem === undefined) {
        if (slopStemCache.size > 20000) slopStemCache.clear();
        stem = tnStem(word);
        slopStemCache.set(word, stem);
    }
    return stem;
}

function slopMessageText(m) {
    if (typeof m === 'string') return m;
    if (m && typeof m === 'object') return String(m.text ?? m.mes ?? m.content ?? '');
    return String(m ?? '');
}

function slopPhraseClean(phrase) {
    return String(phrase ?? '').replace(/[«»"“”<>\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function slopKeyOf(phrase) {
    return tnWords(phrase).map(slopStemOf).filter(Boolean).join(' ');
}

function slopBuiltinIndex(locale, extraPhrases) {
    const primary = String(locale || 'ru').toLowerCase().startsWith('en') ? SLOP_BUILTIN_EN : SLOP_BUILTIN_RU;
    const secondary = primary === SLOP_BUILTIN_EN ? SLOP_BUILTIN_RU : SLOP_BUILTIN_EN;
    const extras = Array.isArray(extraPhrases) ? extraPhrases.map(slopPhraseClean).filter(Boolean).slice(0, 200) : [];
    const cacheKey = `${primary === SLOP_BUILTIN_EN ? 'en' : 'ru'}|${extras.join('|')}`;
    if (slopBuiltinIndexCache.key === cacheKey && slopBuiltinIndexCache.index) return slopBuiltinIndexCache.index;
    const index = new Map();
    const seen = new Set();
    for (const phrase of [...extras, ...primary, ...secondary]) {
        const stems = tnWords(phrase).map(slopStemOf).filter(Boolean);
        const key = stems.join(' ');
        if (!stems.length || seen.has(key)) continue;
        seen.add(key);
        const bucket = index.get(stems[0]) || [];
        bucket.push({ phrase, stems, key });
        index.set(stems[0], bucket);
    }
    slopBuiltinIndexCache.key = cacheKey;
    slopBuiltinIndexCache.index = index;
    return index;
}

// surface: string, or [words, from, to] so the phrase string is only built for a new entry.
function slopBump(map, key, msgIdx, surface, n, builtin) {
    let entry = map.get(key);
    if (!entry) {
        const phrase = typeof surface === 'string' ? surface : surface[0].slice(surface[1], surface[2]).join(' ');
        entry = { key, phrase, count: 0, messageCount: 0, lastMsg: -1, n, builtin };
        map.set(key, entry);
    }
    entry.count += 1;
    if (entry.lastMsg !== msgIdx) {
        entry.lastMsg = msgIdx;
        entry.messageCount += 1;
    }
}

// messages: string[] — the last 20 character replies.
// → [{ phrase, count, messageCount, builtin }] sorted by count desc, top-20.
export function slopAnalyze(messages, { excludeNames = [], locale = 'ru', extraPhrases = [] } = {}) {
    const list = Array.isArray(messages) ? messages.slice(-SLOP_MAX_MESSAGES) : [];
    if (!list.length) return [];

    const excluded = new Set(['char', 'user']);
    for (const name of Array.isArray(excludeNames) ? excludeNames : [excludeNames]) {
        for (const w of tnWords(name)) {
            excluded.add(w);
            excluded.add(slopStemOf(w));
        }
    }

    const builtinIndex = slopBuiltinIndex(locale, extraPhrases);
    const grams = new Map();
    const builtins = new Map();

    for (let msgIdx = 0; msgIdx < list.length; msgIdx += 1) {
        const segments = slopMessageText(list[msgIdx]).split(slopSegmentRe);
        for (const segment of segments) {
            const words = tnWords(segment);
            const len = words.length;
            if (!len) continue;
            const stems = new Array(len);
            const stop = new Array(len);
            const banned = new Array(len);
            for (let i = 0; i < len; i += 1) {
                stems[i] = slopStemOf(words[i]);
                stop[i] = tnIsStopWord(words[i]);
                banned[i] = excluded.has(words[i]) || excluded.has(stems[i]);
            }
            for (let i = 0; i < len; i += 1) {
                // Built-in / custom dictionary phrases.
                const bucket = builtinIndex.get(stems[i]);
                if (bucket) {
                    for (const cand of bucket) {
                        const n = cand.stems.length;
                        if (i + n > len) continue;
                        let ok = true;
                        for (let k = 1; k < n && ok; k += 1) ok = stems[i + k] === cand.stems[k];
                        for (let k = 0; k < n && ok; k += 1) ok = !banned[i + k];
                        if (ok) slopBump(builtins, cand.key, msgIdx, cand.phrase, n, true);
                    }
                }
                // Automatic n-grams (2–5 words), no stop words on the edges, no names anywhere.
                if (stop[i] || banned[i]) continue;
                let key = stems[i];
                for (let n = 2; n <= 5 && i + n <= len; n += 1) {
                    const j = i + n - 1;
                    if (banned[j]) break;
                    key += ` ${stems[j]}`;
                    if (stop[j]) continue;
                    slopBump(grams, key, msgIdx, [words, i, j + 1], n, false);
                }
            }
        }
    }

    const candidates = [];
    for (const entry of grams.values()) {
        if (entry.count >= SLOP_MIN_COUNT && entry.messageCount >= SLOP_MIN_MESSAGES) candidates.push(entry);
    }
    for (const entry of builtins.values()) {
        if (entry.count < SLOP_BUILTIN_MIN_COUNT || entry.messageCount < SLOP_BUILTIN_MIN_COUNT) continue;
        const auto = candidates.find(c => !c.builtin && c.key === entry.key);
        if (auto) {
            auto.builtin = true;
            auto.phrase = entry.phrase;
            auto.count = Math.max(auto.count, entry.count);
            auto.messageCount = Math.max(auto.messageCount, entry.messageCount);
        } else {
            candidates.push(entry);
        }
    }

    // Subsumption: a shorter n-gram contained in a longer one with the same count collapses into it.
    candidates.sort((a, b) => b.n - a.n);
    const kept = [];
    for (const cand of candidates) {
        const padded = ` ${cand.key} `;
        const absorbed = kept.some(long => long.n > cand.n && long.count === cand.count && ` ${long.key} `.includes(padded));
        if (!absorbed) kept.push(cand);
    }

    kept.sort((a, b) => b.count - a.count || b.messageCount - a.messageCount || b.n - a.n || (a.phrase < b.phrase ? -1 : 1));
    return kept.slice(0, SLOP_TOP).map(e => ({
        phrase: e.phrase,
        count: e.count,
        messageCount: e.messageCount,
        builtin: Boolean(e.builtin),
    }));
}

function slopFormatRule(phrases) {
    if (!phrases.length) return '';
    return `${SLOP_RULE_PREFIX}${phrases.map(p => `«${p}»`).join(', ')}.`;
}

// Positive one-line rule (spec 10.5): ≤ 6 phrases, ≤ 60 tokens, or '' when nothing to say.
export function slopBuildRule(hits, { disabled = [], maxPhrases = SLOP_RULE_MAX_PHRASES } = {}) {
    if (!Array.isArray(hits) || !hits.length) return '';
    const off = new Set((Array.isArray(disabled) ? disabled : []).map(slopKeyOf).filter(Boolean));
    const limit = Math.max(0, Math.min(SLOP_RULE_MAX_PHRASES, Math.trunc(Number(maxPhrases)) || 0));
    const phrases = [];
    const keys = new Set();
    for (const hit of hits) {
        if (phrases.length >= limit) break;
        const phrase = slopPhraseClean(typeof hit === 'string' ? hit : hit?.phrase);
        const key = slopKeyOf(phrase);
        if (!phrase || !key || off.has(key) || keys.has(key)) continue;
        keys.add(key);
        phrases.push(phrase);
    }
    while (phrases.length && tnEstimateTokens(slopFormatRule(phrases)) > SLOP_RULE_MAX_TOKENS) phrases.pop();
    return slopFormatRule(phrases);
}

// Helper for ctxPack (spec 10.3): shrink an existing rule to its first N phrases ('' when N ≤ 0).
export function slopRuleLimit(rule, maxPhrases) {
    const text = String(rule ?? '');
    const n = Math.trunc(Number(maxPhrases)) || 0;
    if (!text || n <= 0) return '';
    const phrases = [...text.matchAll(/«([^«»]+)»/g)].map(m => m[1]);
    if (!phrases.length) return text;
    return slopFormatRule(phrases.slice(0, n));
}
