// Shared text normalisation helpers (RU/EN) for CLODEx RP Studio v1.3.
// Pure functions, no dependencies. Flat-bundler safe: every top-level name is tn*-prefixed.
// Unicode property escapes are avoided on purpose (older embedded JS runtimes).

// Apostrophes are glued (don't → dont); every other punctuation/symbol becomes a space.
const tnApostropheRe = /['\u2019\u02bc`\u00b4]/g;
const tnSeparatorRe = /[\u0000-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u00bf\u00d7\u00f7\u02b9-\u02ff\u2000-\u2bff\u2e00-\u2e7f\u3000-\u303f\ufe00-\ufe6f\uff00-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65\ud800-\udfff]+/g;
const tnCyrillicRe = /[\u0400-\u04ff]/;

export function tnNormalize(text) {
    const raw = String(text ?? '');
    return (typeof raw.normalize === 'function' ? raw.normalize('NFC') : raw)
        .toLowerCase()
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ё/g, 'е')
        .replace(tnApostropheRe, '')
        .replace(tnSeparatorRe, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function tnWords(text) {
    const norm = tnNormalize(text);
    return norm ? norm.split(' ') : [];
}

// Reflexive suffixes are removed first, then the longest matching ending.
// Past-tense "-л" is intentionally kept so ухмыльнулся / ухмыльнулась / ухмыльнулись → ухмыльнул.
const TN_RU_REFLEXIVE = Object.freeze(['ся', 'сь']);
const TN_RU_ENDINGS = Object.freeze([
    'иями', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ешь', 'ишь', 'ете', 'ите', 'ией', 'иям', 'иях',
    'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ую', 'юю', 'ой', 'ей', 'ий', 'ый', 'ым', 'им', 'ых', 'их',
    'ах', 'ях', 'ов', 'ев', 'ом', 'ем', 'ам', 'ям', 'ия', 'ье', 'ья', 'ью', 'ьи',
    'ет', 'ут', 'ют', 'ит', 'ат', 'ят', 'ть', 'ти',
    'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю', 'ь', 'й',
]);
const TN_RU_MIN_STEM = 3;
const TN_EN_MIN_STEM = 3;

function tnStemRu(word) {
    let w = word;
    for (const suf of TN_RU_REFLEXIVE) {
        if (w.length - suf.length >= TN_RU_MIN_STEM && w.endsWith(suf)) {
            w = w.slice(0, -suf.length);
            break;
        }
    }
    for (const suf of TN_RU_ENDINGS) {
        if (w.length - suf.length >= TN_RU_MIN_STEM && w.endsWith(suf)) {
            return w.slice(0, -suf.length);
        }
    }
    return w;
}

function tnUndouble(w) {
    const n = w.length;
    if (n >= 4 && w[n - 1] === w[n - 2] && !'aeioulsz'.includes(w[n - 1])) return w.slice(0, -1);
    return w;
}

function tnStemEn(word) {
    let w = word;
    if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
    if (w.length > 4 && w.endsWith('ied')) return `${w.slice(0, -3)}y`;
    for (const suf of ['ingly', 'edly', 'ing', 'ed']) {
        if (w.length - suf.length >= TN_EN_MIN_STEM && w.endsWith(suf)) {
            w = tnUndouble(w.slice(0, -suf.length));
            return w.length > TN_EN_MIN_STEM && w.endsWith('e') ? w.slice(0, -1) : w;
        }
    }
    if (w.length - 2 >= TN_EN_MIN_STEM && w.endsWith('ly')) return w.slice(0, -2);
    if (w.length - 2 >= TN_EN_MIN_STEM && /(?:ss|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
    if (w.length - 1 >= TN_EN_MIN_STEM && w.endsWith('s') && !/(?:ss|us|is)$/.test(w)) w = w.slice(0, -1);
    if (w.length > TN_EN_MIN_STEM && w.endsWith('e')) w = w.slice(0, -1);
    return w;
}

export function tnStem(word) {
    const w = tnNormalize(word).replace(/ /g, '');
    if (!w) return '';
    if (/^[0-9]+$/.test(w)) return w;
    if (tnCyrillicRe.test(w)) return tnStemRu(w);
    if (/^[a-z]+$/.test(w)) return tnStemEn(w);
    return w;
}

const TN_STOP_WORDS = new Set([
    // RU: pronouns
    'я', 'ты', 'он', 'она', 'оно', 'мы', 'вы', 'они', 'меня', 'тебя', 'его', 'ее', 'нас', 'вас', 'их', 'мне', 'тебе',
    'ему', 'ей', 'нам', 'вам', 'им', 'мной', 'мною', 'тобой', 'тобою', 'ним', 'ней', 'нею', 'нами', 'вами', 'ими', 'ними',
    'него', 'нее', 'нему', 'них', 'себя', 'себе', 'собой', 'собою', 'свой', 'своя', 'свое', 'свои', 'своего', 'своей',
    'своему', 'своим', 'своих', 'своими', 'свою', 'мой', 'моя', 'мое', 'мои', 'моего', 'моей', 'моему', 'моим', 'моих',
    'мою', 'твой', 'твоя', 'твое', 'твои', 'твоего', 'твоей', 'твоим', 'твоих', 'твою', 'наш', 'наша', 'наше', 'наши',
    'ваш', 'ваша', 'ваше', 'ваши', 'этот', 'эта', 'это', 'эти', 'этого', 'этой', 'этому', 'этим', 'этих', 'эту', 'тот',
    'та', 'то', 'те', 'того', 'той', 'тому', 'тем', 'тех', 'ту', 'кто', 'что', 'кого', 'чего', 'кому', 'чему', 'кем',
    'чем', 'ком', 'чём', 'весь', 'вся', 'все', 'всё', 'всего', 'всей', 'всем', 'всех', 'всю', 'сам', 'сама', 'само',
    'сами', 'самой', 'самого', 'который', 'которая', 'которое', 'которые', 'которого', 'которой', 'которых', 'какой',
    'какая', 'какое', 'какие', 'такой', 'такая', 'такое', 'такие', 'чей', 'чья',
    // RU: prepositions
    'в', 'во', 'на', 'с', 'со', 'к', 'ко', 'по', 'за', 'из', 'изо', 'от', 'ото', 'до', 'о', 'об', 'обо', 'у', 'над',
    'под', 'подо', 'при', 'про', 'для', 'без', 'через', 'между', 'перед', 'передо', 'около', 'вокруг', 'после', 'среди',
    'сквозь', 'вдоль', 'возле', 'против', 'ради', 'кроме',
    // RU: conjunctions & particles
    'и', 'а', 'но', 'или', 'либо', 'да', 'нет', 'не', 'ни', 'же', 'ли', 'бы', 'б', 'ведь', 'вот', 'вон', 'уж', 'уже',
    'еще', 'ещё', 'лишь', 'только', 'даже', 'тоже', 'также', 'если', 'когда', 'чтобы', 'чтоб', 'как', 'так', 'будто',
    'словно', 'точно', 'хотя', 'пока', 'потому', 'поэтому', 'зато', 'однако', 'тогда', 'затем', 'потом', 'где', 'куда',
    'откуда', 'там', 'тут', 'здесь', 'туда', 'сюда', 'ну', 'ох', 'ах', 'эх', 'ой', 'разве', 'неужели', 'пусть', 'дескать',
    'мол', 'чуть', 'очень', 'всего', 'был', 'была', 'было', 'были', 'быть', 'есть', 'будет', 'будут',
    // EN
    'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'so', 'yet', 'if', 'then', 'than', 'as', 'of', 'in', 'on', 'at', 'to',
    'for', 'from', 'by', 'with', 'without', 'into', 'onto', 'over', 'under', 'up', 'down', 'out', 'off', 'about',
    'above', 'below', 'across', 'after', 'before', 'behind', 'between', 'through', 'toward', 'towards', 'upon', 'against',
    'along', 'around', 'among', 'within', 'i', 'me', 'my', 'mine', 'myself', 'you', 'your', 'yours', 'yourself', 'he',
    'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself', 'we', 'us', 'our', 'ours', 'they',
    'them', 'their', 'theirs', 'themselves', 'this', 'that', 'these', 'those', 'who', 'whom', 'whose', 'which', 'what',
    'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would',
    'shall', 'should', 'can', 'could', 'may', 'might', 'must', 'not', 'no', 'just', 'very', 'too', 'also', 'only',
    'even', 'still', 'there', 'here', 'when', 'where', 'while', 'how', 'why', 'all', 'any', 'each', 'some', 'such',
    'own', 'same', 'other', 'again', 'once', 'dont', 'didnt', 'doesnt', 'cant', 'wont', 'im', 'youre', 'hes', 'shes',
    'its', 'theyre', 'oh', 'ah',
]);

export function tnIsStopWord(word) {
    const w = tnNormalize(word);
    if (!w) return true;
    return TN_STOP_WORDS.has(w) || /^[0-9]+$/.test(w);
}

// Unified token estimate (spec 10.3): ceil(latin/4 + cyrillic/2.2 + other/3).
// "latin" = ASCII letters and Latin-1/Extended-A/B letters; "cyrillic" = U+0400..U+04FF; "other" = every other code unit.
export function tnEstimateTokens(text) {
    const s = String(text ?? '');
    if (!s) return 0;
    let latin = 0;
    let cyrillic = 0;
    let other = 0;
    for (let i = 0; i < s.length; i += 1) {
        const c = s.charCodeAt(i);
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 0xc0 && c <= 0x24f && c !== 0xd7 && c !== 0xf7)) latin += 1;
        else if (c >= 0x400 && c <= 0x4ff) cyrillic += 1;
        else other += 1;
    }
    return Math.ceil(latin / 4 + cyrillic / 2.2 + other / 3);
}
