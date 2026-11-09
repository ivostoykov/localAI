import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const decisionModelCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/decision-model.js'),
    'utf-8'
);

const STATE = { url: 'https://a.example/', title: 'A', text: 'Some page text.' };
const QUESTIONS = {
    pageState: {
        type: 'choice',
        instructions: 'Decide what kind of page this is.',
        criteria: { 'content': 'a real page', 'login wall': 'a sign-in requirement' }
    }
};

function loadModule(laiOptions = {}) {
    const chrome = {
        storage: {
            sync: {
                get: vi.fn(async () => ({ laiOptions }))
            }
        }
    };
    const module = new Function(
        'chrome', 'manifest', 'getLineNumber', 'storageOptionKey',
        `${decisionModelCode}
        return { askDecision, resolveDecisionModelSettings,
            DECISION_MODEL_TIMEOUT_MS, DECISION_MODEL_DEFAULT_MODEL };`
    )(chrome, { name: 'Local AI helper' }, () => 'test', 'laiOptions');
    return { chrome, module };
}

// Behaves like fetch against a hanging server: resolves only through the request signal.
function hangingFetch() {
    return (_url, options = {}) => {
        if (options.signal?.aborted) {
            return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
        }
        return new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () =>
                reject(new DOMException('The operation was aborted.', 'AbortError')));
        });
    };
}

const okResponse = (body) => ({ ok: true, status: 200, statusText: 'OK', json: async () => body });

describe('decision-model.js', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    const enabledOptions = {
        decisionModelEnabled: true,
        aiUrl: 'http://localhost:11434/api/chat'
    };

    it('returns null and does not fetch while the feature is disabled', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        for (const laiOptions of [{}, { decisionModelEnabled: false }]) {
            const { module } = loadModule(laiOptions);
            await expect(module.askDecision(STATE, QUESTIONS)).resolves.toBeNull();
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('posts model, state and questions to the configured decision model URL', async () => {
        const fetchMock = vi.fn(async () => okResponse({ answers: { pageState: { choice: 'content', confidence: 0.9 } } }));
        vi.stubGlobal('fetch', fetchMock);
        const { module } = loadModule({ ...enabledOptions, decisionModelUrl: 'http://localhost:11434/v1/systemone', decisionModel: 'm:1' });

        const answers = await module.askDecision(STATE, QUESTIONS);

        expect(answers).toEqual({ pageState: { choice: 'content', confidence: 0.9 } });
        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('http://localhost:11434/v1/systemone');
        expect(options.method).toBe('POST');
        expect(options.headers['Content-Type']).toBe('application/json');
        expect(JSON.parse(options.body)).toEqual({ model: 'm:1', state: STATE, questions: QUESTIONS });
    });

    it('falls back to the origin of aiUrl and the default model when the settings are empty', async () => {
        const fetchMock = vi.fn(async () => okResponse({ answers: {} }));
        vi.stubGlobal('fetch', fetchMock);
        const { module } = loadModule({ ...enabledOptions, decisionModelUrl: ' ', decisionModel: '' });

        await module.askDecision(STATE, QUESTIONS);

        const [url, options] = fetchMock.mock.calls[0];
        expect(url).toBe('http://localhost:11434/v1/systemone');
        expect(JSON.parse(options.body).model).toBe(module.DECISION_MODEL_DEFAULT_MODEL);
    });

    it('returns null without fetching when no endpoint can be resolved', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const noAiUrl = loadModule({ decisionModelEnabled: true });
        await expect(noAiUrl.module.askDecision(STATE, QUESTIONS)).resolves.toBeNull();
        const badUrl = loadModule({ decisionModelEnabled: true, aiUrl: 'http://localhost:11434/api/chat', decisionModelUrl: 'ftp://localhost/v1/systemone' });
        await expect(badUrl.module.askDecision(STATE, QUESTIONS)).resolves.toBeNull();
        const relativeUrl = loadModule({ decisionModelEnabled: true, decisionModelUrl: '/v1/systemone' });
        await expect(relativeUrl.module.askDecision(STATE, QUESTIONS)).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        ['an HTTP error', () => ({ ok: false, status: 500, statusText: 'Server Error', json: async () => ({}) })],
        ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
        ['a malformed body', () => okResponse({ nothing: true })],
        ['a body without answers', () => okResponse('not an object with answers')],
        ['invalid JSON', () => ({ ok: true, status: 200, statusText: 'OK', json: async () => { throw new SyntaxError('Unexpected token'); } })]
    ])('returns null on %s', async (label, makeResponse) => {
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
        const fetchMock = vi.fn(async () => makeResponse());
        vi.stubGlobal('fetch', fetchMock);
        const { module } = loadModule(enabledOptions);

        await expect(module.askDecision(STATE, QUESTIONS)).resolves.toBeNull();
        expect(debug).toHaveBeenCalled();
    });

    it('returns null after the timeout without failing the caller', async () => {
        vi.stubGlobal('fetch', hangingFetch());
        const { module } = loadModule(enabledOptions);
        const signal = new AbortController().signal;

        let settled = false;
        const promise = module.askDecision(STATE, QUESTIONS, signal).then(
            value => { settled = true; return value; },
            () => { settled = true; }
        );
        for (let i = 0; i < 100 && !settled; i++) {
            await vi.advanceTimersByTimeAsync(100);
        }

        await expect(promise).resolves.toBeNull();
        expect(signal.aborted).toBe(false);
    });

    it('propagates the caller abort while the request is in flight', async () => {
        vi.stubGlobal('fetch', hangingFetch());
        const { module } = loadModule(enabledOptions);
        const controller = new AbortController();

        const promise = module.askDecision(STATE, QUESTIONS, controller.signal);
        promise.catch(() => {});
        await vi.advanceTimersByTimeAsync(0);
        controller.abort('User aborted last request.');

        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('propagates a caller that was already aborted and never reaches the endpoint', async () => {
        const fetchMock = vi.fn(hangingFetch());
        vi.stubGlobal('fetch', fetchMock);
        const { module } = loadModule(enabledOptions);
        const controller = new AbortController();
        controller.abort('User aborted last request.');

        await expect(module.askDecision(STATE, QUESTIONS, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
