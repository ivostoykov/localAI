/**
 * Decision Model Module
 * Posts state and questions to an auxiliary decision-model endpoint and returns its answers.
 * Any failure (disabled feature, bad settings, HTTP error, network error, timeout, malformed
 * body) yields null so callers keep their current behaviour.
 * Runs in the background service worker context.
 */

const DECISION_MODEL_TIMEOUT_MS = 5000;
const DECISION_MODEL_PATH = '/v1/systemone';
const DECISION_MODEL_DEFAULT_MODEL = 'clef:27b-cloud';

async function resolveDecisionModelSettings() {
    let laiOptions = {};
    try {
        const stored = await chrome.storage.sync.get(storageOptionKey);
        laiOptions = stored?.[storageOptionKey] || {};
    } catch (err) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Decision model settings could not be read: ${err?.message}`);
        return null;
    }

    if (laiOptions.decisionModelEnabled !== true) { return null; }

    let url = (laiOptions.decisionModelUrl || '').trim();
    if (!url) {
        try {
            url = new URL((laiOptions.aiUrl || '').trim()).origin + DECISION_MODEL_PATH;
        } catch {
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Decision model has no usable endpoint: the page-state check is skipped.`);
            return null;
        }
    }
    if (!/^https?:\/\//i.test(url)) {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Decision model URL is not an http(s) endpoint: ${url}`);
        return null;
    }

    const model = (laiOptions.decisionModel || '').trim() || DECISION_MODEL_DEFAULT_MODEL;
    return { url, model };
}

async function askDecision(state, questions, signal = null) {
    const settings = await resolveDecisionModelSettings();
    if (!settings) { return null; }

    const controller = new AbortController();
    const abortWithCaller = () => controller.abort(signal.reason);
    if (signal?.aborted) { abortWithCaller(); }
    signal?.addEventListener?.('abort', abortWithCaller);
    const timer = setTimeout(() => controller.abort(), DECISION_MODEL_TIMEOUT_MS);

    try {
        const response = await fetch(settings.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: settings.model, state, questions }),
            signal: controller.signal
        });

        if (!response.ok) {
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Decision model endpoint responded with ${response.status} ${response.statusText}`);
            return null;
        }

        let answers = null;
        try {
            answers = (await response.json())?.answers;
        } catch {
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Decision model response was not a valid JSON body.`);
            return null;
        }
        if (!answers || typeof answers !== 'object') {
            console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Decision model response carried no answers.`);
            return null;
        }
        return answers;
    } catch (err) {
        if (signal?.aborted) { throw err; }
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Decision model request failed: ${err?.message}`);
        return null;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', abortWithCaller);
    }
}
