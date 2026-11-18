const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function modelKinds(model, price = {}) {
    const id = String(model.id ?? '').toLowerCase();
    const endpoints = [model.supported_endpoint_types, price.supported_endpoint_types]
        .flatMap(value => (Array.isArray(value) ? value : []));
    const kinds = new Set();
    const video = endpoints.includes('openai-video') || /seedance|hailuo|wan[-_.]|kling|veo[-_.]|sora|video/.test(id);
    if (endpoints.includes('image-generation')
        || (!video && /gpt-image|nano-banana|gemini.*image|flux|seedream|dall-e|imagen|grok-imagine/.test(id))) {
        kinds.add('image');
    }
    if (video) kinds.add('video');
    if (endpoints.includes('audio-speech')
        || /tts|speech|voice|f5[-_]|cosyvoice|eleven_(?:v\d|multilingual_v|turbo|flash)/.test(id)) {
        kinds.add('speech');
    }
    if (/whisper|transcrib|\bstt\b/.test(id)) kinds.add('transcription');
    if (!kinds.size && !/embed|rerank|moderation|music|suno|3d|rodin/.test(id)
        && (!endpoints.length || endpoints.includes('openai'))) {
        kinds.add('text');
    }
    return [...kinds];
}

export function isNanoBananaModel(id) {
    const lower = String(id ?? '').toLowerCase();
    return /nano-banana|gemini.*image/.test(lower);
}

export function isMistralModel(id) {
    return /mistral|ministral|codestral|pixtral|magistral/i.test(String(id ?? ''));
}

export function normalizeCatalog(models, pricing = {}) {
    if (!Array.isArray(models?.data)) throw new Error('Invalid /v1/models response.');
    const prices = new Map((Array.isArray(pricing.data) ? pricing.data : []).map(p => [p.model_name, p]));
    return [...new Map(models.data.filter(m => typeof m.id === 'string').map(model => {
        const price = prices.get(model.id);
        return [model.id, {
            id: model.id,
            name: price?.display_name || model.id,
            kinds: modelKinds(model, price),
            nanoBanana: isNanoBananaModel(model.id) || isNanoBananaModel(price?.display_name),
            mistral: isMistralModel(model.id),
            price,
        }];
    })).values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function pickRecommendedModels(catalog, current = {}) {
    const textModels = catalog.filter(m => m.kinds.includes('text'));
    const imageModels = catalog.filter(m => m.kinds.includes('image'));
    const videoModels = catalog.filter(m => m.kinds.includes('video'));
    const speechModels = catalog.filter(m => m.kinds.includes('speech'));
    const has = (list, id) => Boolean(id && list.some(m => m.id === id));

    const trackerModel = has(catalog, current.trackerModel) ? current.trackerModel
        : (textModels.find(m => /flash-lite|ministral|mistral-small|gpt-4o-mini|gpt-4\.1-mini|haiku|flash/i.test(m.id))
            ?? textModels[0])?.id ?? '';

    const codexModel = has(catalog, current.codexModel) ? current.codexModel
        : (textModels.find(m => m.mistral)
            ?? textModels.find(m => /deepseek|claude|gemini|gpt/i.test(m.id))
            ?? textModels[0])?.id ?? '';

    const imageModel = has(catalog, current.imageModel) ? current.imageModel
        : (imageModels.find(m => m.nanoBanana)
            ?? imageModels[0])?.id ?? '';

    const videoModel = has(catalog, current.videoModel) ? current.videoModel
        : videoModels[0]?.id ?? '';

    const speechModel = has(catalog, current.speechModel) ? current.speechModel
        : (speechModels.find(m => /eleven|tts-1|gpt-4o-mini-tts/i.test(m.id))
            ?? speechModels[0])?.id ?? '';

    return { trackerModel, codexModel, imageModel, videoModel, speechModel };
}

export function priceView(price) {
    if (!price) return null;
    const isDynamicMode = ['expression', 'quote_based'].includes(price.billing_mode) || Boolean(price.billing_expr);
    if (isDynamicMode) {
        const groups = Array.isArray(price.enable_groups) ? price.enable_groups : [];
        const ratios = price.group_ratio && typeof price.group_ratio === 'object' ? price.group_ratio : null;
        const primaryGroup = ratios
            ? groups.find(g => Object.prototype.hasOwnProperty.call(ratios, g) && finite(ratios[g]) && ratios[g] > 0)
            : undefined;
        const groupRatio = primaryGroup !== undefined ? ratios[primaryGroup] : 1;

        if (finite(price.quote_base_credits) && price.quote_base_credits > 0) {
            const perThousandUsd = finite(price.model_price) && price.model_price > 0 ? price.model_price : 0.5;
            const est = Number(((price.quote_base_credits / 1000) * perThousandUsd * groupRatio).toFixed(6));
            if (est > 0) return { unit: 'request', input: est };
        }
        if (finite(price.model_price) && price.model_price > 0) {
            const est = Number((price.model_price * groupRatio).toFixed(6));
            if (est > 0) return { unit: 'request', input: est };
        }
        if (finite(price.usage_fixed_price) && price.usage_fixed_price > 0) {
            return {
                unit: price.usage_fixed_price_unit || 'per_1m_total_tokens',
                input: price.usage_fixed_price,
                cached: finite(price.cached_usage_fixed_price) ? price.cached_usage_fixed_price : null,
            };
        }
        if (price.quota_type === 0 && finite(price.model_ratio) && price.model_ratio > 0) {
            const input = Number((price.model_ratio * 2 * groupRatio).toFixed(6));
            return {
                unit: 'per_1m_tokens',
                input,
                output: finite(price.completion_ratio) ? Number((input * price.completion_ratio).toFixed(6)) : null,
                cached: finite(price.cache_ratio) ? Number((input * price.cache_ratio).toFixed(6)) : null,
            };
        }
        return { unit: 'dynamic' };
    }
    if (finite(price.usage_fixed_price)) {
        return {
            unit: price.usage_fixed_price_unit || 'per_1m_total_tokens',
            input: price.usage_fixed_price,
            cached: finite(price.cached_usage_fixed_price) ? price.cached_usage_fixed_price : null,
        };
    }
    if (price.quota_type === 1 && finite(price.model_price)) return { unit: 'request', input: price.model_price };
    if (price.quota_type === 0 && finite(price.model_ratio)) {
        const input = price.model_ratio * 2;
        return {
            unit: 'per_1m_tokens',
            input,
            output: finite(price.completion_ratio) ? input * price.completion_ratio : null,
            cached: finite(price.cache_ratio) ? input * price.cache_ratio : null,
        };
    }
    return null;
}

export function quotaView(payload, metadata) {
    const quota = payload?.data;
    if (!quota || !finite(quota.total_available)) throw new Error('Invalid API key quota response.');
    const unit = quota.quota_per_unit ?? metadata?.data?.quota_per_unit;
    const usd = finite(unit) && unit > 0 ? quota.total_available / unit : null;
    const status = metadata?.data;
    const rubRate = ['₽', 'RUB', 'руб', 'руб.'].includes(status?.custom_currency_symbol)
        && finite(status?.custom_currency_exchange_rate) && status.custom_currency_exchange_rate > 0
        ? status.custom_currency_exchange_rate : null;
    return {
        unlimited: quota.unlimited_quota === true,
        units: quota.total_available,
        usd,
        rub: usd !== null && rubRate !== null ? usd * rubRate : null,
        expiresAt: quota.expires_at > 0 ? quota.expires_at : null,
    };
}

export function walletView(payload, metadata) {
    const wallet = payload?.data;
    const signed = value => typeof value === 'number' && Number.isFinite(value);
    if (!wallet || !signed(wallet.wallet_balance_usd)) return null;
    const usd = wallet.wallet_balance_usd;
    const status = metadata?.data;
    const rate = finite(wallet.usd_to_rub) && wallet.usd_to_rub > 0 ? wallet.usd_to_rub
        : ['₽', 'RUB', 'руб', 'руб.'].includes(status?.custom_currency_symbol)
            && finite(status?.custom_currency_exchange_rate) && status.custom_currency_exchange_rate > 0
            ? status.custom_currency_exchange_rate : null;
    return {
        usd,
        rub: signed(wallet.wallet_balance_rub) ? wallet.wallet_balance_rub : rate === null ? null : usd * rate,
    };
}

export function videoBillingView(payload) {
    const policy = payload?.data?.video_billing;
    if (policy?.version !== 1 || policy?.funding_source !== 'paid_wallet'
        || policy?.promotional_balance_eligible !== false || policy?.free_generation_available !== false) return null;
    return {
        paidOnly: true,
        freeAvailable: false,
        paidUSD: finite(policy.paid_balance_usd) ? policy.paid_balance_usd : null,
    };
}
