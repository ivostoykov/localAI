const modelCatalogueCacheStorageKey = 'modelCatalogueCache';
const modelInfoCacheStorageKey = 'modelInfoCache';
const ollamaCloudTagsUrl = 'https://ollama.com/api/tags';

function getModelEndpointCacheKey(apiUrl = '') {
    if (!apiUrl) { return ''; }

    try {
        return new URL(apiUrl).origin;
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Invalid model endpoint`, { apiUrl, error });
        return '';
    }
}

function getModelSource(model = {}, sourceHint = 'local') {
    return model?.remote_host ? 'cloud' : sourceHint;
}

function normaliseModelSummary(model = {}, sourceHint = 'local') {
    const name = model?.name || model?.model || '';
    const source = getModelSource(model, sourceHint);

    return {
        name,
        model: model?.model || name,
        source,
        remoteHost: model?.remote_host || '',
        remoteModel: model?.remote_model || '',
        size: model?.size ?? null,
        digest: model?.digest || '',
        modifiedAt: model?.modified_at || '',
        details: model?.details || {}
    };
}

function sortModelsByName(models = []) {
    return [...models].sort((left, right) => {
        return (left?.name || '').localeCompare(right?.name || '');
    });
}

function groupModelsBySource(models = [], sourceHint = 'local') {
    const groups = {
        local: [],
        cloud: []
    };

    for (let index = 0; index < models.length; index++) {
        const model = normaliseModelSummary(models[index], sourceHint);
        if (!model.name) { continue; }
        groups[model.source].push(model);
    }

    groups.local = sortModelsByName(groups.local);
    groups.cloud = sortModelsByName(groups.cloud);

    return groups;
}

function flattenModelGroups(groups = {}) {
    return [
        ...(groups?.local || []),
        ...(groups?.cloud || [])
    ];
}

function extractContextWindow(modelInfo = {}) {
    const info = modelInfo?.model_info || {};

    for (const [key, value] of Object.entries(info)) {
        if (!/\.context_length$/i.test(key)) { continue; }

        const parsedValue = Number(value);
        if (Number.isFinite(parsedValue) && parsedValue > 0) {
            return parsedValue;
        }
    }

    return null;
}

function sanitiseModelInfo(fullData = {}, modelName = '', modelSummary = null) {
    const { license, modelfile, template, tensors, ...cleanData } = fullData || {};

    cleanData.modelName = modelName;
    cleanData.contextWindow = extractContextWindow(fullData);
    cleanData.source = modelSummary?.source || 'local';
    cleanData.remoteHost = modelSummary?.remoteHost || '';
    cleanData.remoteModel = modelSummary?.remoteModel || '';
    cleanData.details = cleanData?.details || modelSummary?.details || {};

    return cleanData;
}

async function readModelCatalogueCache() {
    const stored = await chrome.storage.local.get([modelCatalogueCacheStorageKey]);
    return stored?.[modelCatalogueCacheStorageKey] || {};
}

async function writeModelCatalogueCache(cache = {}) {
    await chrome.storage.local.set({ [modelCatalogueCacheStorageKey]: cache });
}

async function readModelInfoCache() {
    const stored = await chrome.storage.local.get([modelInfoCacheStorageKey]);
    return stored?.[modelInfoCacheStorageKey] || {};
}

async function writeModelInfoCache(cache = {}) {
    await chrome.storage.local.set({ [modelInfoCacheStorageKey]: cache });
}

async function getCachedModelCatalogue(apiUrl = '') {
    const endpointKey = getModelEndpointCacheKey(apiUrl);
    if (!endpointKey) { return null; }

    const cache = await readModelCatalogueCache();
    return cache?.[endpointKey] || null;
}

async function cacheModelCatalogue(apiUrl = '', catalogue = null) {
    const endpointKey = getModelEndpointCacheKey(apiUrl);
    if (!endpointKey || !catalogue) { return; }

    const cache = await readModelCatalogueCache();
    cache[endpointKey] = catalogue;
    await writeModelCatalogueCache(cache);
}

async function getCachedModelInfo(apiUrl = '', modelName = '') {
    const endpointKey = getModelEndpointCacheKey(apiUrl);
    if (!endpointKey || !modelName) { return null; }

    const cache = await readModelInfoCache();
    return cache?.[endpointKey]?.[modelName] || null;
}

async function cacheModelInfo(apiUrl = '', modelName = '', modelInfo = null) {
    const endpointKey = getModelEndpointCacheKey(apiUrl);
    if (!endpointKey || !modelName || !modelInfo) { return; }

    const cache = await readModelInfoCache();
    if (!cache[endpointKey]) {
        cache[endpointKey] = {};
    }

    cache[endpointKey][modelName] = modelInfo;
    await writeModelInfoCache(cache);
}

async function fetchModelCataloguePayload(apiUrl = '') {
    let tagsUrl = '';
    let endpointKey = '';

    if (/^https?:\/\//i.test(apiUrl) && /\/api\/tags\/?$/i.test(apiUrl)) {
        tagsUrl = apiUrl;
        endpointKey = getModelEndpointCacheKey(apiUrl);
    } else {
        endpointKey = getModelEndpointCacheKey(apiUrl);
        if (!endpointKey) {
            throw new Error(`Invalid API endpoint - ${apiUrl}`);
        }
        tagsUrl = new URL('/api/tags', endpointKey).href;
    }

    if (!endpointKey || !tagsUrl) {
        throw new Error(`Invalid API endpoint - ${apiUrl}`);
    }

    const response = await fetch(tagsUrl, {
        headers: {
            'Content-Type': 'application/json; charset=utf-8'
        }
    });
    if (!response.ok) {
        throw new Error(`Failed to load models (${response.status}: ${response.statusText})`);
    }

    return {
        endpoint: endpointKey,
        payload: await response.json()
    };
}

function buildCatalogueFromPayload(endpoint = '', payload = {}, sourceHint = 'local') {
    const groups = groupModelsBySource(payload?.models || [], sourceHint);
    return {
        endpoint,
        groups,
        models: flattenModelGroups(groups)
    };
}

async function fetchModelCatalogueFromApi(apiUrl = '', includeCloud = false) {
    const endpointKey = getModelEndpointCacheKey(apiUrl);
    if (!endpointKey) {
        throw new Error(`Invalid API endpoint - ${apiUrl}`);
    }

    const localPayload = await fetchModelCataloguePayload(apiUrl);
    const groups = {
        local: groupModelsBySource(localPayload.payload?.models || [], 'local').local,
        cloud: []
    };
    const errors = {};

    if (includeCloud) {
        try {
            const cloudPayload = await fetchModelCataloguePayload(ollamaCloudTagsUrl);
            groups.cloud = groupModelsBySource(cloudPayload.payload?.models || [], 'cloud').cloud;
        } catch (error) {
            errors.cloud = error?.message || 'Failed to load cloud models';
            console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Cloud model catalogue unavailable`, error);
        }
    }

    const catalogue = {
        endpoint: endpointKey,
        updatedAt: new Date().toISOString(),
        groups,
        models: flattenModelGroups(groups),
        errors,
        scope: includeCloud ? 'all' : 'local'
    };

    await cacheModelCatalogue(apiUrl, catalogue);

    return catalogue;
}

async function getModelCatalogue(apiUrl = '', forceRefresh = false, includeCloud = false) {
    if (!forceRefresh) {
        const cached = await getCachedModelCatalogue(apiUrl);
        const cachedScope = cached?.scope || 'local';
        const hasCachedCloudData = (cached?.groups?.cloud || []).length > 0 || typeof cached?.errors?.cloud === 'string';
        const cacheCoversRequest = !includeCloud || cachedScope === 'all' || hasCachedCloudData;
        if (cached?.models?.length > 0 && cacheCoversRequest) {
            return cached;
        }
    }

    return fetchModelCatalogueFromApi(apiUrl, includeCloud);
}

async function getModelSummary(apiUrl = '', modelName = '', forceRefresh = false, includeCloud = false) {
    if (!modelName) { return null; }

    const catalogue = await getModelCatalogue(apiUrl, forceRefresh, includeCloud);
    const models = catalogue?.models || [];

    return models.find(model => model?.name === modelName) || null;
}

async function getModelInfoFromApi(apiUrl = '', modelName = '', forceRefresh = false) {
    if (!modelName) {
        throw new Error('Model name is missing');
    }

    if (!forceRefresh) {
        const cached = await getCachedModelInfo(apiUrl, modelName);
        if (cached) {
            return cached;
        }
    }

    const endpointKey = getModelEndpointCacheKey(apiUrl);
    if (!endpointKey) {
        throw new Error(`Invalid API endpoint - ${apiUrl}`);
    }

    const includeCloud = /-cloud$/i.test(modelName);
    const modelSummary = await getModelSummary(apiUrl, modelName, false, includeCloud);
    const showUrl = new URL('/api/show', endpointKey).href;
    const response = await fetch(showUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName })
    });
    if (!response.ok) {
        throw new Error(`Failed to load model info for ${modelName} (${response.status}: ${response.statusText})`);
    }
    const fullData = await response.json();
    const cleanData = sanitiseModelInfo(fullData, modelName, modelSummary);

    await cacheModelInfo(apiUrl, modelName, cleanData);

    return cleanData;
}
