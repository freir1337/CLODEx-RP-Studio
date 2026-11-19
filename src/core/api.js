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

export function normalizeBaseUrl(rawUrl) {
    const clean = String(rawUrl ?? '').trim();
    if (!clean) return ORIGIN;
    try {
        const parsed = new URL(clean);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return ORIGIN;
        }
        return clean
            .replace(/\/+$/, '')
            .replace(/\/(v1\/chat\/completions|v1\/images\/generations|v1\/models|v1|v1beta)$/i, '');
    } catch {
        return ORIGIN;
    }
}

export function isNativeGoogleBaseUrl(rawUrl) {
    const clean = String(rawUrl ?? '').trim().toLowerCase();
    return clean.includes('/google-ai') || clean.includes('generativelanguage.googleapis.com') || clean.endsWith('/v1beta');
}

export function taskId(value) {
    const id = String(value ?? '');
    if (!/^[a-z\d_:-]{1,200}$/i.test(id)) {
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

function parseImageString(str) {
    const text = String(str ?? '').trim();
    if (!text) return null;

    const dataUriMatch = text.match(/data:image\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=\r\n]+)/i);
    if (dataUriMatch?.[1]) {
        return { b64_json: dataUriMatch[1].replace(/[\r\n\s]+/g, '') };
    }

    const mdUrlMatch = text.match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/i);
    if (mdUrlMatch?.[1]) {
        return { url: mdUrlMatch[1] };
    }

    if (/^https?:\/\/\S+$/i.test(text)) {
        return { url: text };
    }

    const compact = text.replace(/[\r\n\s]+/g, '');
    if (compact.length > 256 && /^[A-Za-z0-9+/]+=*$/.test(compact)) {
        return { b64_json: compact };
    }

    return null;
}

export function extractImageResult(payload) {
    if (!payload || typeof payload !== 'object') return null;

    // 1. Standard OpenAI Images format: data: [{ b64_json, url, b64, base64, image }]
    const list = Array.isArray(payload.data) ? payload.data
        : Array.isArray(payload.images) ? payload.images
            : Array.isArray(payload.output) ? payload.output : [];
    for (const item of list) {
        if (!item) continue;
        if (typeof item === 'string') {
            const parsed = parseImageString(item);
            if (parsed) return parsed;
        }
        const b64 = item.b64_json || item.b64 || item.base64 || item.bytesBase64Encoded || item.image_base64
            || item.inlineData?.data || item.inline_data?.data;
        if (typeof b64 === 'string' && b64.trim()) {
            const parsed = parseImageString(b64) || { b64_json: b64.replace(/^data:[^;]+;base64,/, '').trim() };
            return parsed;
        }
        const url = item.url || item.image_url?.url || (typeof item.image_url === 'string' ? item.image_url : '') || item.uri;
        if (typeof url === 'string' && url.trim()) {
            const parsed = parseImageString(url) || { url: url.trim() };
            return parsed;
        }
    }

    // 2. Direct top-level fields
    const directB64 = payload.b64_json || payload.base64 || payload.image_base64 || payload.image;
    if (typeof directB64 === 'string' && directB64.trim()) {
        const parsed = parseImageString(directB64);
        if (parsed) return parsed;
    }
    if (typeof payload.url === 'string' && payload.url.trim()) {
        const parsed = parseImageString(payload.url);
        if (parsed) return parsed;
    }

    // 3. Google Vertex / Imagen predictions: predictions: [{ bytesBase64Encoded, mimeType }]
    if (Array.isArray(payload.predictions)) {
        for (const pred of payload.predictions) {
            const b64 = pred?.bytesBase64Encoded || pred?.b64_json || pred?.base64 || pred?.image;
            if (typeof b64 === 'string' && b64.trim()) {
                return { b64_json: b64.replace(/^data:[^;]+;base64,/, '').trim() };
            }
        }
    }

    // 4. Google Gemini native generateContent: candidates[0].content.parts[{ inlineData: { data } }]
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    for (const cand of candidates) {
        const parts = Array.isArray(cand?.content?.parts) ? cand.content.parts : [];
        for (const part of parts) {
            const inline = part?.inlineData?.data || part?.inline_data?.data;
            if (typeof inline === 'string' && inline.trim()) {
                return { b64_json: inline.replace(/^data:[^;]+;base64,/, '').trim() };
            }
            const fileUri = part?.fileData?.fileUri || part?.file_data?.file_uri;
            if (typeof fileUri === 'string' && fileUri.trim()) {
                const parsed = parseImageString(fileUri);
                if (parsed) return parsed;
            }
            if (typeof part?.text === 'string' && part.text.trim()) {
                const parsed = parseImageString(part.text);
                if (parsed) return parsed;
            }
        }
    }

    // 5. OpenAI Chat Completions multimodal response (OpenRouter / LiteLLM / Proxy Gemini Image)
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    for (const choice of choices) {
        const msg = choice?.message || choice?.delta || {};
        if (Array.isArray(msg.images)) {
            for (const img of msg.images) {
                if (typeof img === 'string') {
                    const parsed = parseImageString(img);
                    if (parsed) return parsed;
                }
                const b64 = img?.b64_json || img?.base64 || img?.data || img?.inlineData?.data || img?.inline_data?.data;
                if (typeof b64 === 'string' && b64.trim()) {
                    return parseImageString(b64) || { b64_json: b64.replace(/^data:[^;]+;base64,/, '').trim() };
                }
                const url = img?.image_url?.url || (typeof img?.image_url === 'string' ? img.image_url : '') || img?.url;
                if (typeof url === 'string' && url.trim()) {
                    return parseImageString(url) || { url: url.trim() };
                }
            }
        }
        const content = msg.content;
        if (Array.isArray(content)) {
            for (const part of content) {
                const b64 = part?.b64_json || part?.base64 || part?.data || part?.inlineData?.data || part?.inline_data?.data;
                if (typeof b64 === 'string' && b64.trim()) {
                    return parseImageString(b64) || { b64_json: b64.replace(/^data:[^;]+;base64,/, '').trim() };
                }
                const url = part?.image_url?.url || (typeof part?.image_url === 'string' ? part.image_url : '') || part?.url;
                if (typeof url === 'string' && url.trim()) {
                    return parseImageString(url) || { url: url.trim() };
                }
                if (typeof part?.text === 'string') {
                    const parsed = parseImageString(part.text);
                    if (parsed) return parsed;
                }
            }
        } else if (typeof content === 'string' && content.trim()) {
            const parsed = parseImageString(content);
            if (parsed) return parsed;
        }
    }

    return null;
}

export class ClodexApi {
    constructor({
        getKey,
        getBaseUrl,
        chatHandler = null,
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

    resolveOrigin() {
        return normalizeBaseUrl(this.getBaseUrl?.());
    }

    async request(path, { method = 'GET', body, auth = true, signal, timeout = 60_000, blob = false } = {}) {
        if (!path.startsWith('/') || path.includes('..') || path.includes('\\') || path.includes('#')) {
            throw new ApiError('Invalid API path.', { code: 'invalid_path' });
        }
        const rawKey = String(this.getKey?.() ?? '').trim();
        const key = auth ? validateKey(rawKey) : rawKey;
        const headers = new Headers();
        if (key) {
            headers.set('Authorization', `Bearer ${key}`);
            if (path.startsWith('/v1beta/') || isNativeGoogleBaseUrl(this.getBaseUrl?.())) {
                headers.set('x-goog-api-key', key);
            }
        }
        if (body !== undefined) headers.set('Content-Type', 'application/json');

        const controller = new AbortController();
        const onAbort = () => controller.abort(signal.reason);
        signal?.throwIfAborted();
        signal?.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeout);

        const baseUrl = this.resolveOrigin();

        try {
            const response = await this.fetch(`${baseUrl}${path}`, {
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
            throw new ApiError(`Network/CORS error connecting to ${baseUrl}.`, { code: 'network_error' });
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        }
    }

    async models(signal) {
        const rawBase = String(this.getBaseUrl?.() ?? '');
        if (isNativeGoogleBaseUrl(rawBase)) {
            try {
                const googleData = await this.request('/v1beta/models', { signal });
                if (Array.isArray(googleData?.models)) {
                    return {
                        data: googleData.models.map(m => ({
                            id: String(m.name || '').replace(/^models\//, ''),
                            object: 'model',
                        })).filter(m => m.id),
                    };
                }
            } catch {
                // fallback to /v1/models
            }
        }
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

    async chat({ model, messages, temperature = 0.25, maxTokens = 600, jsonMode = false, profileId = '' }, signal) {
        if (typeof this.chatHandler === 'function') {
            signal?.throwIfAborted();
            const text = await this.chatHandler({
                model,
                profileId: profileId || model,
                messages,
                temperature,
                maxTokens,
                jsonMode,
                signal,
            });
            const clean = String(text ?? '').trim();
            if (!clean) throw new ApiError('Empty model response from SillyTavern API.', { code: 'empty_response' });
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
        const cleanModel = String(model ?? '').trim().replace(/^models\//, '');
        if (!cleanModel) throw new ApiError('Select an image model first.', { code: 'model_required' });

        const rawBase = String(this.getBaseUrl?.() ?? '');
        const isGoogleNative = isNativeGoogleBaseUrl(rawBase);
        const isGeminiLike = /gemini|banana|flash|imagen/i.test(cleanModel);

        const tryOpenAiImages = async () => {
            const body = { model: cleanModel, prompt, n: 1 };
            if (size) body.size = size;
            if (quality) body.quality = quality;
            const data = await this.request('/v1/images/generations', {
                method: 'POST',
                body,
                signal,
                timeout: 180_000,
            });
            return extractImageResult(data);
        };

        const tryGoogleGenerateContent = async () => {
            const body = {
                contents: [{ role: 'user', parts: [{ text: String(prompt ?? '') }] }],
                generationConfig: {
                    responseModalities: ['TEXT', 'IMAGE'],
                },
            };
            const data = await this.request(`/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent`, {
                method: 'POST',
                body,
                signal,
                timeout: 180_000,
            });
            return extractImageResult(data);
        };

        const tryOpenAiChatImage = async () => {
            const body = {
                model: cleanModel,
                messages: [{ role: 'user', content: String(prompt ?? '') }],
                modalities: ['text', 'image'],
                stream: false,
            };
            const data = await this.request('/v1/chat/completions', {
                method: 'POST',
                body,
                signal,
                timeout: 180_000,
            });
            return extractImageResult(data);
        };

        const strategies = isGoogleNative
            ? [tryGoogleGenerateContent, tryOpenAiImages, tryOpenAiChatImage]
            : isGeminiLike
                ? [tryOpenAiImages, tryOpenAiChatImage, tryGoogleGenerateContent]
                : [tryOpenAiImages, tryOpenAiChatImage];

        let lastError = null;
        for (const attempt of strategies) {
            try {
                const res = await attempt();
                if (res && (res.b64_json || res.url)) {
                    return res;
                }
            } catch (err) {
                if (signal?.aborted) throw err;
                lastError = err;
            }
        }

        if (lastError) throw lastError;
        throw new ApiError('Image response contains no image.', { code: 'invalid_response' });
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
