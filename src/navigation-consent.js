const NAVIGATION_CONSENT_KEEP_ALIVE_MS = 15000;
const NAVIGATION_CONSENT_INPUT_DELAY_MS = 750;

const consentRequestId = new URLSearchParams(location.search).get('requestId') || '';
let consentAnswered = false;
let consentKeepAliveTimer = null;
let consentInputReadyAt = Infinity;
let consentInputTimer = null;

function isTrustedUserEvent(e) {
    return e?.isTrusted === true;
}

function isConsentInputReady() {
    return Date.now() >= consentInputReadyAt;
}

function setConsentButtonsDisabled(disabled) {
    document.querySelectorAll('#consentButtons button').forEach(btn => { btn.disabled = disabled; });
}

// The window takes focus when it opens, so a key press or click meant for another window could
// otherwise answer it; input is ignored until the window has been shown for a moment, and again
// whenever it regains focus.
function armConsentInput() {
    if (consentAnswered) { return; }
    consentInputReadyAt = Date.now() + NAVIGATION_CONSENT_INPUT_DELAY_MS;
    setConsentButtonsDisabled(true);
    clearTimeout(consentInputTimer);
    consentInputTimer = setTimeout(() => {
        if (consentAnswered) { return; }
        setConsentButtonsDisabled(false);
        document.getElementById('consentOnce')?.focus();
    }, NAVIGATION_CONSENT_INPUT_DELAY_MS);
}

function showConsentError() {
    document.getElementById('consentError')?.classList.remove('invisible');
    document.getElementById('consentButtons')?.classList.add('invisible');
}

async function sendConsentChoice(choice) {
    if (consentAnswered) { return; }
    consentAnswered = true;
    clearInterval(consentKeepAliveTimer);
    clearTimeout(consentInputTimer);
    setConsentButtonsDisabled(true);

    try {
        await chrome.runtime.sendMessage({ action: 'navigationConsentResponse', requestId: consentRequestId, choice });
    } catch (err) {
        console.error('Failed to send the navigation consent answer', err);
    }
    window.close();
}

function onConsentKeyDown(e) {
    if (!isTrustedUserEvent(e) || !isConsentInputReady()) { return; }
    if (e.key === 'Escape') {
        e.preventDefault();
        sendConsentChoice('cancel');
    } else if (e.key === 'Enter' && e.target?.tagName !== 'BUTTON') {
        e.preventDefault();
        sendConsentChoice('once');
    }
}

async function initNavigationConsent() {
    let response;
    try {
        response = await chrome.runtime.sendMessage({ action: 'getNavigationConsentRequest', requestId: consentRequestId });
    } catch (err) {
        console.error('Failed to load the navigation consent request', err);
    }

    if (response?.status !== 'ok' || typeof response?.url !== 'string') {
        showConsentError();
        return;
    }

    document.getElementById('consentUrl').textContent = response.url;
    document.querySelectorAll('#consentButtons button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (isTrustedUserEvent(e) && isConsentInputReady()) { sendConsentChoice(btn.dataset.choice); }
        });
    });
    document.addEventListener('keydown', onConsentKeyDown);
    window.addEventListener('focus', armConsentInput);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') { armConsentInput(); }
    });
    armConsentInput();

    // Keeps the background service worker alive while the user decides.
    consentKeepAliveTimer = setInterval(() => {
        chrome.runtime.sendMessage({ action: 'navigationConsentKeepAlive', requestId: consentRequestId }).catch(() => {});
    }, NAVIGATION_CONSENT_KEEP_ALIVE_MS);
}

document.addEventListener('DOMContentLoaded', initNavigationConsent);
