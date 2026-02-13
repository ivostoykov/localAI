const originalDebug = console.debug.bind(console);

console.debug = function(...args) {
    if (!debugEnabled) return;
    originalDebug(...args);
};

function setDebugFlag(enabled) {
    console.log(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Debugging is now ${enabled ? 'ON' : 'OFF'}.`);
    debugEnabled = enabled;
}

async function toggleDebug(enabled) {
    try {
        const options = await getOptions();
        console.log(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - options`, options);
        if(typeof(enabled) === 'undefined') {  enabled = !options.debug;  }
        console.log(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Debugging is now ${enabled ? 'ON' : 'OFF'}.`);
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