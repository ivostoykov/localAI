const originalDebug = console.debug.bind(console);

// The stored debug option is read asynchronously after the background starts, so lines written
// before then cannot reach console.debug. Only these deferred trace lines are held (#118).
let debugFlagResolved = false;
const pendingDebugTraces = [];

console.debug = function(...args) {
    if (!debugEnabled) return;
    originalDebug(...args);
};

function isDebugEnabled() {
    return !!debugEnabled;
}

function debugTrace(...args) {
    if (!debugFlagResolved) {
        pendingDebugTraces.push(args);
        return;
    }
    if (!isDebugEnabled()) { return; }
    originalDebug(...args);
}

function markDebugFlagResolved() {
    if (debugFlagResolved) { return; }
    debugFlagResolved = true;
    const pending = pendingDebugTraces.splice(0);
    if (!isDebugEnabled()) { return; }
    pending.forEach(args => originalDebug(...args));
}

// Payload-bearing diagnostics stay in the console only while the user has debugging enabled.
// The summary message is always written so failures remain diagnosable.
function logDiagnostic(consoleAction, message, ...details) {
    if (!isDebugEnabled()) {
        console[consoleAction](message);
        return;
    }
    console[consoleAction](message, ...details);
}

function setDebugFlag(enabled) {
    console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Debugging is now ${enabled ? 'ON' : 'OFF'}.`);
    debugEnabled = enabled;
    markDebugFlagResolved();
}

async function toggleDebug(enabled) {
    try {
        const options = await getOptions();
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - options`, options);
        if(typeof(enabled) === 'undefined') {  enabled = !options.debug;  }
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Debugging is now ${enabled ? 'ON' : 'OFF'}.`);
        options.debug = enabled;
        await setOptions(options);
    } catch (e) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Failed to toggle debug:`, e);
    }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes[storageOptionKey]) {
        const newOptions = changes[storageOptionKey].newValue;
        if (newOptions?.debug !== undefined) {
            debugEnabled = newOptions.debug;
            markDebugFlagResolved();
        }
    }
});

async function init_log(timeout){
if (Date.now() > timeout) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - init_log timed out`);
        return;
    }
    if(typeof getOptions !== 'function'){
        setTimeout(async () => await init_log(timeout), 1000 );
        return;
    }
    const options = await getOptions();
    setDebugFlag(options?.debug ?? false);
}

init_log(Date.now() + 120000);