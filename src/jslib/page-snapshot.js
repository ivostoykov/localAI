async function setActiveSessionPageData(tabId) {
    try {
        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Called setActiveSessionPageData`, {
            tabId,
            url: location.href,
            readyState: document.readyState,
            bodyExists: !!document.body,
            bodyLength: document.body?.innerText?.length ?? 0
        });

        await waitForDOMToSettle(1000, 120000);

        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - After waitForDOMToSettle`, {
            readyState: document.readyState,
            bodyLength: document.body?.innerText?.length ?? 0
        });

        const url = location.href;
        const waitfor = Date.now() + 3000;
        while(Date.now() < waitfor){
            await new Promise(resolve => setTimeout(resolve, Math.min(500, waitfor - Date.now())));
            if(typeof getEnhancedPageContent === "function"){  break;  }
        }
        let pageContent
        try{
            pageContent = await getEnhancedPageContent() ?? null;
            if(!pageContent) {
                console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Empty page content! url: ${url}; readyState: ${document.readyState}; bodyExists: ${!!document.body}; bodyLength: ${document.body?.innerText?.length ?? 0}`);
                logDiagnostic('warn', `>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Empty page content detail`, {
                    bodyFirstChars: document.body?.innerText?.substring(0, 100) ?? ''
                });
                return false;
            }
        }
        catch(theError){
            console.warn(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - getEnhancedPageContent is not available yet`, theError);
            return false;
        }


        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Successfully extracted page content`, {
            url,
            contentLength: pageContent.length,
            contentFirstChars: pageContent.substring(0, 100)
        });

        const pageHash = await generatePageHash(url, pageContent);
        console.debug(`>>> ${manifest?.name} - [${getLineNumber()}] - current hash`, pageHash);
        const key = tabId ? `${activePageStorageKey}:${tabId}` : activePageStorageKey;
        const title = document?.title || 'Untitled';
        await chrome.storage.local.set({ [key]: {url, title, pageContent, pageHash} });

        console.debug(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Successfully stored page data`, {
            key,
            url,
            contentLength: pageContent.length
        });
        return true;
    } catch (error) {
        console.error(`>>> ${manifest?.name ?? ''} - [${getLineNumber()}] - Error`, {
            error, tabId, url: location.href, readyState: document.readyState });
        return false;
    }
}

