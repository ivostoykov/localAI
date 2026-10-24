const NAVIGATION_CONSENT_KEEP_ALIVE_MS = 15000;

const consentRequestId = new URLSearchParams(location.search).get('requestId') || '';
let consentAnswered = false;
let consentKeepAliveTimer = null;

function isTrustedUserEvent(e) {
    return e?.isTrusted === true;
}

function showConsentError() {
    document.getElementById('consentError')?.classList.remove('invisible');
    document.getElementById('consentButtons')?.classList.add('invisible');
}

async function sendConsentChoice(choice) {
    if (consentAnswered) { return; }
    consentAnswered = true;
    clearInterval(consentKeepAliveTimer);
    document.querySelectorAll('#consentButtons button').forEach(btn => { btn.disabled = true; });

    try {
        await chrome.runtime.sendMessage({ action: 'navigationConsentResponse', requestId: consentRequestId, choice });
    } catch (err) {
        console.error('Failed to send the navigation consent answer', err);
    }
    window.close();
}

function onConsentKeyDown(e) {
    if (!isTrustedUserEvent(e)) { return; }
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
            if (isTrustedUserEvent(e)) { sendConsentChoice(btn.dataset.choice); }
        });
    });
    document.addEventListener('keydown', onConsentKeyDown);
    document.getElementById('consentOnce')?.focus();

    // Keeps the background service worker alive while the user decides.
    consentKeepAliveTimer = setInterval(() => {
        chrome.runtime.sendMessage({ action: 'navigationConsentKeepAlive', requestId: consentRequestId }).catch(() => {});
    }, NAVIGATION_CONSENT_KEEP_ALIVE_MS);
}

document.addEventListener('DOMContentLoaded', initNavigationConsent);
