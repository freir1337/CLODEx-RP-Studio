// Shared bundle graph for scripts/package.mjs and scripts/check.mjs.
// Tavo runs classic scripts only, so each bundle is the dependency-ordered
// (topologically sorted) set of ES modules reachable from its entry, flattened
// into a single IIFE. Order comes from the import graph, never from a hand list.
import { readFile } from 'node:fs/promises';
import { dirname, posix, relative, resolve, sep } from 'node:path';

export const TAVO_BUNDLES = Object.freeze([
    Object.freeze({ out: 'tavo/entry.js', entry: 'src/tavo/entry.src.js' }),
    Object.freeze({ out: 'tavo/ui/hud.js', entry: 'src/tavo/hud.src.js' }),
    Object.freeze({ out: 'tavo/ui/turn.js', entry: 'src/tavo/turn.src.js' }),
]);

const IMPORT_RE = /^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"];?\s*$/gm;

function toPosix(p) {
    return p.split(sep).join(posix.sep);
}

export function listImports(source) {
    const out = [];
    for (const match of source.matchAll(IMPORT_RE)) out.push(match[1]);
    return out;
}

// Depth-first post-order walk: dependencies are emitted before dependents, in
// the order they are imported. Import cycles are rejected because a flat bundle
// cannot guarantee top-level initialisation order inside a cycle.
export async function resolveBundleFiles(root, entryRel) {
    const order = [];
    const state = new Map(); // rel -> 'visiting' | 'done'
    async function visit(rel, chain) {
        const status = state.get(rel);
        if (status === 'done') return;
        if (status === 'visiting') {
            throw new Error(`Import cycle in bundle: ${[...chain, rel].join(' -> ')}`);
        }
        state.set(rel, 'visiting');
        const abs = resolve(root, rel);
        const src = await readFile(abs, 'utf8');
        for (const spec of listImports(src)) {
            if (!spec.startsWith('.')) {
                throw new Error(`${rel}: bare import "${spec}" cannot be bundled for Tavo`);
            }
            const depRel = toPosix(relative(root, resolve(dirname(abs), spec)));
            await visit(depRel, [...chain, rel]);
        }
        state.set(rel, 'done');
        order.push(rel);
    }
    await visit(toPosix(entryRel), []);
    return order;
}

// ---------------------------------------------------------------------------
// Top-level declaration scanner (bundler collision gate, spec 10.8).
// A tiny tokenizer that understands comments, strings, template literals and
// regex literals well enough to track bracket depth; declarations at depth 0
// are the names that share one scope once the files are flattened.
// ---------------------------------------------------------------------------
const REGEX_PREFIX_KEYWORDS = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
    'case', 'do', 'else', 'yield', 'await',
]);

function tokenize(src) {
    const tokens = [];
    let i = 0;
    let depth = 0;
    const templateStack = []; // depth at which each `${` was opened
    const n = src.length;
    const isIdStart = c => /[A-Za-z_$\u0080-\uffff]/.test(c);
    const isId = c => /[A-Za-z0-9_$\u0080-\uffff]/.test(c);
    const prevSignificant = () => tokens[tokens.length - 1];

    function readTemplateChunk() {
        // positioned just after ` or after the } closing a ${...}
        while (i < n) {
            const c = src[i];
            if (c === '\\') { i += 2; continue; }
            if (c === '`') { i += 1; return 'end'; }
            if (c === '$' && src[i + 1] === '{') {
                i += 2;
                templateStack.push(depth);
                depth += 1;
                return 'expr';
            }
            i += 1;
        }
        return 'end';
    }

    while (i < n) {
        const c = src[i];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' || c === '\u00a0' || c === '\ufeff') {
            i += 1;
            continue;
        }
        if (c === '/' && src[i + 1] === '/') {
            while (i < n && src[i] !== '\n') i += 1;
            continue;
        }
        if (c === '/' && src[i + 1] === '*') {
            const end = src.indexOf('*/', i + 2);
            i = end < 0 ? n : end + 2;
            continue;
        }
        if (c === '"' || c === "'") {
            const q = c;
            i += 1;
            while (i < n && src[i] !== q) {
                if (src[i] === '\\') i += 1;
                i += 1;
            }
            i += 1;
            tokens.push({ type: 'string', value: '', depth });
            continue;
        }
        if (c === '`') {
            i += 1;
            readTemplateChunk();
            tokens.push({ type: 'template', value: '', depth });
            continue;
        }
        if (isIdStart(c)) {
            let j = i + 1;
            while (j < n && isId(src[j])) j += 1;
            tokens.push({ type: 'ident', value: src.slice(i, j), depth });
            i = j;
            continue;
        }
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
            let j = i + 1;
            while (j < n && /[0-9A-Za-z_.]/.test(src[j])) j += 1;
            tokens.push({ type: 'number', value: src.slice(i, j), depth });
            i = j;
            continue;
        }
        if (c === '/') {
            const prev = prevSignificant();
            const regexAllowed = !prev
                || (prev.type === 'punct' && !/^[)\]}]$/.test(prev.value))
                || (prev.type === 'ident' && REGEX_PREFIX_KEYWORDS.has(prev.value));
            if (regexAllowed) {
                let j = i + 1;
                let inClass = false;
                while (j < n) {
                    const d = src[j];
                    if (d === '\\') { j += 2; continue; }
                    if (d === '[') inClass = true;
                    else if (d === ']') inClass = false;
                    else if (d === '/' && !inClass) break;
                    else if (d === '\n') break;
                    j += 1;
                }
                j += 1;
                while (j < n && /[a-z]/i.test(src[j])) j += 1;
                tokens.push({ type: 'regex', value: '', depth });
                i = j;
                continue;
            }
        }
        if (c === '(' || c === '[' || c === '{') {
            tokens.push({ type: 'punct', value: c, depth });
            depth += 1;
            i += 1;
            continue;
        }
        if (c === ')' || c === ']' || c === '}') {
            if (c === '}' && templateStack.length && templateStack[templateStack.length - 1] === depth - 1) {
                templateStack.pop();
                depth -= 1;
                i += 1;
                readTemplateChunk();
                tokens.push({ type: 'template', value: '', depth });
                continue;
            }
            depth = Math.max(0, depth - 1);
            tokens.push({ type: 'punct', value: c, depth });
            i += 1;
            continue;
        }
        tokens.push({ type: 'punct', value: c, depth });
        i += 1;
    }
    return tokens;
}

function collectPatternNames(tokens, start) {
    // Destructuring pattern starting at tokens[start] ('{' or '['): collect
    // binding identifiers (skips property keys followed by ':' and defaults).
    const names = [];
    const baseDepth = tokens[start].depth;
    let k = start + 1;
    while (k < tokens.length && !(tokens[k].type === 'punct' && /[}\]]/.test(tokens[k].value) && tokens[k].depth === baseDepth)) {
        const tok = tokens[k];
        if (tok.type === 'ident' && tok.depth === baseDepth + 1) {
            const next = tokens[k + 1];
            const prev = tokens[k - 1];
            const isKey = next && next.type === 'punct' && next.value === ':';
            const isDefaultValue = prev && prev.type === 'punct' && prev.value === '=';
            if (!isKey && !isDefaultValue) names.push(tok.value);
        }
        k += 1;
    }
    return { names, end: k };
}

export function scanTopLevelNames(source) {
    const tokens = tokenize(source);
    const names = [];
    for (let k = 0; k < tokens.length; k += 1) {
        const tok = tokens[k];
        if (tok.depth !== 0 || tok.type !== 'ident') continue;
        const prev = tokens[k - 1];
        // Ignore member access / object keys like `x.function` (never at depth 0 in practice).
        if (prev && prev.type === 'punct' && prev.value === '.') continue;
        if (tok.value === 'function') {
            let j = k + 1;
            if (tokens[j]?.type === 'punct' && tokens[j].value === '*') j += 1;
            if (tokens[j]?.type === 'ident' && tokens[j].depth === 0) names.push(tokens[j].value);
            continue;
        }
        if (tok.value === 'class') {
            const next = tokens[k + 1];
            if (next?.type === 'ident' && next.value !== 'extends') names.push(next.value);
            continue;
        }
        if (tok.value === 'const' || tok.value === 'let' || tok.value === 'var') {
            // Walk the declarator list: name/pattern, optional initialiser, commas at depth 0.
            let j = k + 1;
            while (j < tokens.length) {
                const head = tokens[j];
                if (head.type === 'ident') {
                    names.push(head.value);
                    j += 1;
                } else if (head.type === 'punct' && (head.value === '{' || head.value === '[')) {
                    const { names: bound, end } = collectPatternNames(tokens, j);
                    names.push(...bound);
                    j = end + 1;
                } else {
                    break;
                }
                // Skip the initialiser up to a depth-0 ',' (next declarator) or statement end.
                let more = false;
                while (j < tokens.length) {
                    const t = tokens[j];
                    if (t.depth === 0 && t.type === 'punct' && t.value === ',') { more = true; j += 1; break; }
                    if (t.depth === 0 && t.type === 'punct' && t.value === ';') break;
                    if (t.depth === 0 && t.type === 'ident' && j > k + 1) {
                        const prevTok = tokens[j - 1];
                        const afterDot = prevTok?.type === 'punct' && prevTok.value === '.';
                        if (!afterDot) {
                            const isStmtKw = ['const', 'let', 'var', 'export', 'import'].includes(t.value);
                            const isFnOrClass = ['function', 'class', 'async'].includes(t.value);
                            const prevCanEndStmt = prevTok && (
                                prevTok.type === 'number' || prevTok.type === 'string'
                                || prevTok.type === 'template' || prevTok.type === 'regex'
                                || (prevTok.type === 'punct' && /^[)\]}]$/.test(prevTok.value))
                                || (prevTok.type === 'ident' && !['return', 'yield', 'await', 'typeof', 'export', 'default'].includes(prevTok.value))
                            );
                            if (isStmtKw || (isFnOrClass && prevCanEndStmt)) break;
                        }
                    }
                    j += 1;
                }
                if (!more) break;
            }
            k = j - 1;
        }
    }
    return names;
}

// Returns [{ name, files: [relA, relB, ...] }] for every name declared at the
// top level of more than one file in the bundle (or twice in one file).
export async function findBundleCollisions(root, files) {
    const owners = new Map();
    for (const rel of files) {
        const src = await readFile(resolve(root, rel), 'utf8');
        const stripped = src.replace(IMPORT_RE, '');
        for (const name of scanTopLevelNames(stripped)) {
            const list = owners.get(name) ?? [];
            list.push(rel);
            owners.set(name, list);
        }
    }
    return [...owners.entries()]
        .filter(([, list]) => list.length > 1)
        .map(([name, list]) => ({ name, files: list }));
}
