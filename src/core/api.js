// src/core/api.js
export const ORIGIN = 'https://clodex.xyz';
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

export class ApiError extends Error {
    constructor(message, { status = 0, code = 'request_failed' } = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
    }
}

export function redact(value, key = '') {
    let text = String(value ?? 'Request failed');
    if (key) text = text.split(key).join('[redacted]');
    return text.replace(/sk-[a-z\d_-]+/gi, '[redacted]').slice(0, 400);
}

export function validateKey(key) {
    const value = String(key ?? '').trim();
    if (!value) {
        throw new ApiError('Enter a valid API key.', { code: 'key_required' });
    }
    return value;
}

export function taskId(value) {
    const id = String(value ?? '');
    if (!/^[a-z\d_-]{1,200}$/i.test(id)) {
        throw new ApiError('Invalid video task ID.', { code: 'invalid_response' });
    }
    return id;
}

export function safeMediaUrl(value) {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new ApiError('Unsafe media URL rejected.', { code: 'unsafe_url' });
    }
    return url.href;
}

export function normalizeVideo(payload) {
    const data = payload?.data && !Array.isArray(payload.data) ? payload.data : payload;
    if (!data || typeof data !== 'object') {
        throw new ApiError('Invalid video response.', { code: 'invalid_response' });
    }
    const state = String(data.status ?? '').toLowerCase();
    const status = ['completed', 'succeeded', 'success'].includes(state) ? 'completed'
        : ['failed', 'error', 'cancelled', 'canceled', 'expired'].includes(state) ? 'failed'
            : ['queued', 'pending', 'submitted', 'not_start', 'created'].includes(state) ? 'queued'
                : ['in_progress', 'running', 'processing', 'started'].includes(state) ? 'in_progress' : 'unknown';
    const progress = Number.parseFloat(data.progress);
    return {
        id: taskId(data.id ?? data.task_id),
        status,
        progress: Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : null,
        error: redact(data.error?.message ?? data.fail_reason ?? 'Video generation failed.'),
    };
}

export function abortableDelay(ms, signal) {
    return new Promise((resolve, reject) => {
        signal?.throwIfAborted();
        const abort = () => {
            clearTimeout(timer);
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', abort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', abort, { once: true });
    });
}

export async function readMediaBlob(response, expectedType, maxBytes = MAX_MEDIA_BYTES) {
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType && !contentType.startsWith(`${expectedType}/`) && contentType !== 'application/octet-stream') {
        throw new ApiError(`Unexpected media content type: ${contentType}.`, { code: 'invalid_media' });
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        throw new ApiError('Media file exceeds size limit.', { code: 'media_too_large' });
    }
    const blob = await response.blob();
    if (!blob.size || blob.size > maxBytes) {
        throw new ApiError('Invalid or oversized media payload.', { code: 'invalid_media' });
    }
    const finalType = contentType.startsWith(`${expectedType}/`) ? contentType
        : expectedType === 'video' ? 'video/mp4'
            : expectedType === 'audio' ? 'audio/mpeg' : 'image/png';
    return blob.type === finalType ? blob : new Blob([blob], { type: finalType });
}

export function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

export async function blobToBase64(blob) {
    const buffer = await blob.arrayBuffer();
    return bytesToBase64(new Uint8Array(buffer));
}

export function base64ToBlob(base64, mimeType = 'image/png') {
    const clean = String(base64 ?? '').replace(/^data:[^;]+;base64,/, '').trim();
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
}

function normalizeEndpointUrl(baseUrl, path) {
    const rawBase = String(baseUrl || ORIGIN).trim().replace(/\/+$/, '') || ORIGIN;
    // Strip trailing /v1 if the path already starts with /v1/
    const cleanBase = rawBase.replace(/\/v1$/i, '');
    return `${cleanBase}${path}`;
}

export class ClodexApi {
    constructor({
        getKey,
        getBaseUrl,
        chatHandler,
        fetchImpl = globalThis.fetch?.bind(globalThis),
        sleep = abortableDelay,
        now = Date.now,
    } = {}) {
        this.getKey = getKey;
        this.getBaseUrl = getBaseUrl;
        this.chatHandler = chatHandler;
        this.fetch = fetchImpl;
        this.sleep = sleep;
        this.now = now;
    }

    async request(path, { method = 'GET', body, auth = true, signal, timeout = 60_000, blob = false } = {}) {
        if (!/^\/(v1\/|api\/(usage\/token\/|status$|pricing$))/.test(path)
            || path.includes('..') || path.includes('\\') || path.includes('#')) {
            throw new ApiError('Invalid API path.', { code: 'invalid_path' });
        }
        const rawKey = String(this.getKey?.() ?? '').trim();
        const key = auth ? validateKey(rawKey) : rawKey;
        const headers = new Headers();
        if (key) headers.set('Authorization', `Bearer ${key}`);
        if (body !== undefined) headers.set('Content-Type', 'application/json');

        const controller = new AbortController();
        const onAbort = () => controller.abort(signal.reason);
        signal?.throwIfAborted();
        signal?.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeout);

        const targetUrl = normalizeEndpointUrl(this.getBaseUrl?.(), path);

        try {
            const response = await this.fetch(targetUrl, {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body),
                credentials: 'omit',
                redirect: 'follow',
                referrerPolicy: 'no-referrer',
                signal: controller.signal,
            });
            if (!response.ok) {
                const detail = await response.json().catch(() => ({}));
                throw new ApiError(
                    redact(detail.error?.message ?? detail.message ?? `HTTP ${response.status}`, key),
                    { status: response.status, code: 'http_error' },
                );
            }
            if (blob) return await readMediaBlob(response, blob);
            const data = await response.json();
            if (data.error || data.success === false || data.code === false) {
                throw new ApiError(redact(data.error?.message ?? data.message, key), { code: 'api_error' });
            }
            return data;
        } catch (error) {
            if (controller.signal.aborted) throw controller.signal.reason;
            if (error instanceof ApiError) throw error;
            throw new ApiError('Network/CORS error. Check Image API URL and key.', { code: 'network_error' });
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        }
    }

    models(signal) {
        return this.request('/v1/models', { signal });
    }

    quota(signal) {
        return this.request('/api/usage/token/', { signal });
    }

    pricing(signal) {
        return this.request('/api/pricing', { signal, auth: false, timeout: 15_000 });
    }

    status(signal) {
        return this.request('/api/status', { signal, auth: false, timeout: 15_000 });
    }

    voices(model, { search = '', page = 1, signal } = {}) {
        if (!model) throw new ApiError('Select a speech model first.', { code: 'model_required' });
        const query = new URLSearchParams({ model, search, page: String(page), page_size: '100' });
        return this.request(`/v1/audio/voices?${query}`, { signal, timeout: 30_000 });
    }

    speech({ model, input, voice = 'alloy' }, signal) {
        if (!model) throw new ApiError('Select a speech model first.', { code: 'model_required' });
        const text = String(input ?? '').trim();
        if (!text) throw new ApiError('Speech text is empty.', { code: 'empty_input' });
        return this.request('/v1/audio/speech', {
            method: 'POST',
            body: { model, input: text.slice(0, 8000), voice: String(voice || 'alloy'), response_format: 'mp3' },
            blob: 'audio',
            signal,
            timeout: 120_000,
        });
    }

    async chat({ model, messages, temperature = 0.25, maxTokens = 600, jsonMode = false }, signal) {
        if (typeof this.chatHandler === 'function') {
            const text = await this.chatHandler({ model, messages, temperature, maxTokens, jsonMode, signal });
            const clean = String(text ?? '').trim();
            if (!clean) throw new ApiError('Empty model response from SillyTavern profile.', { code: 'empty_response' });
            return clean;
        }
        if (!model) throw new ApiError('Select a text model first.', { code: 'model_required' });
        const body = {
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: false,
        };
        if (jsonMode) body.response_format = { type: 'json_object' };
        let data;
        try {
            data = await this.request('/v1/chat/completions', { method: 'POST', body, signal, timeout: 90_000 });
        } catch (err) {
            if (jsonMode && err instanceof ApiError && err.status >= 400 && err.status < 500) {
                delete body.response_format;
                data = await this.request('/v1/chat/completions', { method: 'POST', body, signal, timeout: 90_000 });
            } else {
                throw err;
            }
        }
        const content = data?.choices?.[0]?.message?.content;
        const text = Array.isArray(content)
            ? content.map(part => (typeof part === 'string' ? part : part?.text ?? '')).join('')
            : String(content ?? '');
        if (!text.trim()) throw new ApiError('Empty model response.', { code: 'empty_response' });
        return text.trim();
    }

    async image({ model, prompt, size = '', quality = '' }, signal) {
        if (!model) throw new ApiError('Enter or select an image model first.', { code: 'model_required' });
        const body = { model, prompt, n: 1 };
        if (size) body.size = size;
        if (quality) body.quality = quality;
        const data = await this.request('/v1/images/generations', { method: 'POST', body, signal, timeout: 180_000 });
        const result = data.data?.[0];
        if (!result?.b64_json && !result?.url) {
            throw new ApiError('Image response contains no image.', { code: 'invalid_response' });
        }
        return result;
    }

    async downloadImage(url, signal) {
        const safe = safeMediaUrl(url);
        const controller = new AbortController();
        const onAbort = () => controller.abort(signal.reason);
        signal?.throwIfAborted();
        signal?.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => controller.abort(new DOMException('Image download timed out', 'TimeoutError')), 90_000);
        try {
            const response = await this.fetch(safe, {
                method: 'GET',
                credentials: 'omit',
                redirect: 'follow',
                referrerPolicy: 'no-referrer',
                signal: controller.signal,
            });
            if (!response.ok) throw new ApiError(`Image download failed (HTTP ${response.status}).`, { status: response.status });
            return await readMediaBlob(response, 'image', 30 * 1024 * 1024);
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        }
    }

    async createVideo({ model, prompt, seconds = '', image }, signal) {
        if (!model) throw new ApiError('Select a video model first.', { code: 'model_required' });
        const body = { model, prompt };
        if (seconds) body.seconds = String(seconds);
        if (image) body.image = image;
        const payload = await this.request('/v1/videos', { method: 'POST', body, signal, timeout: 120_000 });
        return normalizeVideo(payload);
    }

    async videoStatus(id, signal) {
        const payload = await this.request(`/v1/videos/${encodeURIComponent(taskId(id))}`, { signal, timeout: 45_000 });
        return normalizeVideo(payload);
    }

    videoContent(id, signal) {
        return this.request(`/v1/videos/${encodeURIComponent(taskId(id))}/content`, {
            signal,
            timeout: 180_000,
            blob: 'video',
        });
    }

    async pollVideo(id, { onProgress = () => {}, pollIntervalMs = 4_000, maxWaitMs = 420_000 } = {}, signal) {
        const started = this.now();
        const safeId = taskId(id);
        while (this.now() - started < maxWaitMs) {
            const status = await this.videoStatus(safeId, signal);
            onProgress(status);
            if (status.status === 'completed') {
                return await this.videoContent(safeId, signal);
            }
            if (status.status === 'failed') {
                throw new ApiError(status.error || 'Video generation failed.', { code: 'video_failed' });
            }
            await this.sleep(pollIntervalMs, signal);
        }
        throw new ApiError('Video is still processing. Use Resume to fetch when ready.', { code: 'video_timeout' });
    }
}
