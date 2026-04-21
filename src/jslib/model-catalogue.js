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

function inferModelSourceFromName(modelName = '') {
    return /(?:-cloud|:cloud)$/i.test(modelName) ? 'cloud' : 'local';
}

function normaliseModelSummary(model = {}, sourceHint = 'local') {
    const name = model?.name || model?.model || '';
    const source = getModelSource(model, sourceHint);
    const remoteModel = model?.remote_model || model?.remoteModel || '';
    const summary = {
        name,
        model: model?.model || name,
        source,
        remoteHost: model?.remote_host || model?.remoteHost || '',
        remoteModel,
        size: model?.size ?? null,
        digest: model?.digest || '',
        modifiedAt: model?.modified_at || model?.modifiedAt || '',
        details: model?.details || {},
        availableLocally: Boolean(model?.availableLocally),
        localModelName: model?.localModelName || ''
    };

    summary.matchNames = getComparableModelNames(summary);

    return summary;
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

function getModelNameVariants(modelName = '') {
    const variants = [];
    const push = value => {
        if (!value || variants.includes(value)) { return; }
        variants.push(value);
    };

    push(modelName);
    push(modelName.replace(/:latest$/i, ''));
    push(modelName.replace(/-cloud$/i, ''));
    push(modelName.replace(/:cloud$/i, ''));

    return variants.filter(Boolean);
}

function getComparableModelNames(modelSummary = {}) {
    const comparableNames = new Set();

    [modelSummary?.name, modelSummary?.model, modelSummary?.remoteModel].forEach(value => {
        getModelNameVariants(value).forEach(name => comparableNames.add(name));
    });

    return [...comparableNames].filter(Boolean);
}

function modelSummaryMatchesName(modelSummary = {}, modelName = '') {
    const requested = getModelNameVariants(modelName);
    if (requested.length < 1) { return false; }

    const available = new Set(modelSummary?.matchNames?.length
        ? modelSummary.matchNames
        : getComparableModelNames(modelSummary));

    return requested.some(name => available.has(name));
}

function findMatchingModelSummary(catalogue = null, modelName = '') {
    const models = catalogue?.models || [];
    return models.find(model => modelSummaryMatchesName(model, modelName)) || null;
}

function buildModelNameCandidates(modelName = '', catalogue = null) {
    const candidates = [];
    const push = value => {
        if (!value || candidates.includes(value)) { return; }
        candidates.push(value);
    };

    const catalogueModels = catalogue?.models || [];
    const exactMatches = catalogueModels.filter(model => model?.name === modelName || model?.model === modelName);
    const relatedMatches = catalogueModels.filter(model => !exactMatches.includes(model) && modelSummaryMatchesName(model, modelName));

    exactMatches.forEach(model => {
        push(model?.name || '');
        push(model?.model || '');
    });

    relatedMatches.forEach(model => {
        push(model?.name || '');
        push(model?.model || '');
        push(model?.remoteModel || '');
    });

    getModelNameVariants(modelName).forEach(baseName => {
        push(baseName);
        if (/:latest$/i.test(baseName) || /-cloud$/i.test(baseName) || /:cloud$/i.test(baseName)) { return; }
        push(`${baseName}:cloud`);
        push(`${baseName}-cloud`);
        push(`${baseName}:latest`);
    });

    return candidates;
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

function mergeCloudModelCatalogue(remoteModels = [], localCloudModels = []) {
    const mergedModels = [];
    const matchedLocalModels = new Set();

    for (let index = 0; index < remoteModels.length; index++) {
        const remoteModel = normaliseModelSummary(remoteModels[index], 'cloud');
        const localMatch = localCloudModels.find(localModel => modelSummaryMatchesName(localModel, remoteModel?.name || remoteModel?.model || ''));

        if (localMatch?.name) {
            matchedLocalModels.add(localMatch.name);
        }

        const mergedModel = {
            ...remoteModel,
            source: 'cloud',
            remoteHost: localMatch?.remoteHost || remoteModel.remoteHost || '',
            remoteModel: localMatch?.remoteModel || remoteModel.remoteModel || remoteModel.model || remoteModel.name || '',
            availableLocally: Boolean(localMatch),
            localModelName: localMatch?.name || ''
        };
        mergedModel.matchNames = [...new Set([
            ...getComparableModelNames(mergedModel),
            ...(localMatch?.matchNames || [])
        ])];

        mergedModels.push(mergedModel);
    }

    for (let index = 0; index < localCloudModels.length; index++) {
        const localModel = normaliseModelSummary(localCloudModels[index], 'cloud');
        if (matchedLocalModels.has(localModel.name)) { continue; }

        mergedModels.push({
            ...localModel,
            source: 'cloud',
            availableLocally: true,
            localModelName: localModel.name,
            matchNames: [...new Set([
                ...getComparableModelNames(localModel),
                ...(localModel?.matchNames || [])
            ])]
        });
    }

    return sortModelsByName(mergedModels);
}

function buildLocalCloudGroups(localGroups = {}) {
    return (localGroups?.cloud || []).map(model => ({
        ...normaliseModelSummary(model, 'cloud'),
        availableLocally: true,
        localModelName: model?.name || ''
    }));
}

async function fetchModelCatalogueFromApi(apiUrl = '', includeCloud = false, fallbackCatalogue = null) {
    const endpointKey = getModelEndpointCacheKey(apiUrl);
    if (!endpointKey) {
        throw new Error(`Invalid API endpoint - ${apiUrl}`);
    }

    const localPayload = await fetchModelCataloguePayload(apiUrl);
    const localGroups = groupModelsBySource(localPayload.payload?.models || [], 'local');
    const errors = {};
    let cloudGroups = buildLocalCloudGroups(localGroups);
    let cloudCatalogueFallbackSource = '';

    if (includeCloud) {
        try {
            const remotePayload = await fetchModelCataloguePayload(ollamaCloudTagsUrl);
            const remoteGroups = groupModelsBySource(remotePayload.payload?.models || [], 'cloud');
            cloudGroups = mergeCloudModelCatalogue(remoteGroups?.cloud || [], cloudGroups);
        } catch (error) {
            errors.cloud = error?.message || 'Failed to load cloud catalogue';
            const cachedCloudGroups = fallbackCatalogue?.groups?.cloud || [];
            if (cachedCloudGroups.length > 0) {
                cloudGroups = mergeCloudModelCatalogue(cachedCloudGroups, cloudGroups);
                cloudCatalogueFallbackSource = 'cache';
            } else {
                cloudCatalogueFallbackSource = 'local';
            }
        }
    }

    const groups = {
        local: localGroups?.local || [],
        cloud: sortModelsByName(cloudGroups)
    };

    const catalogue = {
        endpoint: endpointKey,
        updatedAt: new Date().toISOString(),
        groups,
        models: flattenModelGroups(groups),
        errors,
        scope: includeCloud ? 'all' : 'daemon',
        cloudCatalogueLoaded: includeCloud && !errors?.cloud,
        cloudCatalogueFallback: includeCloud && Boolean(errors?.cloud),
        cloudCatalogueFallbackSource
    };

    await cacheModelCatalogue(apiUrl, catalogue);

    return catalogue;
}

async function getModelCatalogue(apiUrl = '', forceRefresh = false, includeCloud = false, refreshCloud = false) {
    const cached = await getCachedModelCatalogue(apiUrl);

    if (!forceRefresh && !refreshCloud) {
        const hasCurrentCloudMetadata = cached?.cloudCatalogueLoaded === true || cached?.cloudCatalogueFallback === true;
        const cacheCoversRequest = !includeCloud || hasCurrentCloudMetadata;
        if (cached?.models?.length > 0 && cacheCoversRequest) {
            return cached;
        }
    }

    return fetchModelCatalogueFromApi(apiUrl, includeCloud, cached);
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
        if (cached?.resolvedModelName) {
            return cached;
        }
    }

    const endpointKey = getModelEndpointCacheKey(apiUrl);
    if (!endpointKey) {
        throw new Error(`Invalid API endpoint - ${apiUrl}`);
    }

    const showUrl = new URL('/api/show', endpointKey).href;
    let catalogue = null;
    try {
        catalogue = await getModelCatalogue(apiUrl, false, false);
    } catch (error) {
        console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to load model catalogue whilst resolving ${modelName}`, error);
    }

    const candidates = buildModelNameCandidates(modelName, catalogue);
    let lastFailure = null;

    for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index];
        const response = await fetch(showUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: candidate })
        });
        if (!response.ok) {
            lastFailure = { candidate, status: response.status, statusText: response.statusText };
            continue;
        }

        const fullData = await response.json();
        const modelSummary = findMatchingModelSummary(catalogue, candidate) || findMatchingModelSummary(catalogue, modelName);
        const cleanData = sanitiseModelInfo(fullData, modelName, modelSummary);
        cleanData.requestedModelName = modelName;
        cleanData.resolvedModelName = candidate;
        if (!modelSummary) {
            cleanData.source = inferModelSourceFromName(candidate);
        }

        await cacheModelInfo(apiUrl, modelName, cleanData);
        return cleanData;
    }

    if (lastFailure) {
        throw new Error(`Failed to load model info for ${modelName} via ${lastFailure.candidate} (${lastFailure.status}: ${lastFailure.statusText})`);
    }

    throw new Error(`Failed to load model info for ${modelName}`);
}
