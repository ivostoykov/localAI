const StreamMarkdownProcessor = (function() {
    const triggerBlockChars = "*_`'#-+";

    var processedStreamData = '';
    // const wordEndings = /(?:\w'(?:m|re|ll|s|d|ve|t))[\s.,;:!?]/; // 'm, 're, 's, 'd, 'll, 've, 't and puntuation
    // const wordFormations = /(?:\s'(?:clock|til|bout|cause|em))/; // 'clock, 'til, 'bout, 'cause, 'em

    function closeActiveTag(recipient){
        recipient.removeAttribute("id");
        recipient = recipient.closest('#laiPreviousAiInput');
        recipient.setAttribute("id", "laiActiveAiInput");
        return recipient;
    }

    function handlePreTagTitle(char, recipient){
        const streamLastLine = processedStreamData.split('\n')?.slice(-3).join('\n');
        let match = /(?:\n)(?:`{3}|'{3})([^\n]+)(?:\n)$/.exec(streamLastLine) || [];
        if(match?.[1]){
            recipient.innerHTML = recipient.innerHTML.replace(new RegExp(match[1] + '$', 'ig'), '');
            const sourceTitle = recipient.querySelector('.lai-source-title');
            sourceTitle.innerHTML = sourceTitle.innerHTML.replace(new RegExp('Code', 'gi'), match[1]);
            char = '';
        }

        return char;
    }

    function switchToPreTag(recipient){
        recipient.setAttribute("id", "laiPreviousAiInput");
        const pre = Object.assign(document.createElement('pre'), {
            id: "laiActiveAiInput",
            className: 'lai-source',
            innerHTML: `<span class="lai-source-title">Code</span>\n`
        });
        // recipient.innerHTML += pre.outerHTML;
        recipient.appendChild(pre); // ??? or previous line
        return recipient.querySelector('#laiActiveAiInput');
    }

    function handlePreTag(recipient){
        const recipientTagName = recipient.tagName.toLowerCase();
        if(recipientTagName === 'pre'){
            return closeActiveTag(recipient);
        } else {
            if(recipientTagName === 'code'){
                recipient = fixPreToCodeMissmatch(recipient);
            }
            return switchToPreTag(recipient);
        }
    }

    function fixPreToCodeMissmatch(recipient){
        let codeHtml = recipient.innerHTML;
        const matches = codeHtml.match(/^(`{1,3}|'{1,3}|~{1,3})/);
        if(matches && matches[1]){
            codeHtml = codeHtml.replace(matches[1], '');
        }
        recipient = recipient.closest('#laiPreviousAiInput');
        recipient.querySelector("#laiActiveAiInput").remove();
        recipient.setAttribute("id", "laiActiveAiInput");
        recipient.innerHTML += `${codeHtml}`;
        return recipient;
    }

    function switchOrChangeHTag(rawData, recipient){
        const recipientTagName = recipient.tagName.toLowerCase();
        const level = (rawData.match(/#+/) || [''])[0].length;
        if(recipientTagName.charAt(0) !== 'h'){
            recipient.setAttribute("id", "laiPreviousAiInput");
            recipient.innerHTML += `<h${level} id="laiActiveAiInput"></h${level}>`;
            return recipient.querySelector('#laiActiveAiInput');
        }

        if(recipientTagName === `h${level}`){
            return recipient;
        }

        const parent = recipient.parentElement;
        recipient.remove();
        parent.setAttribute("id", "laiPreviousAiInput");
        parent.innerHTML += `<h${level} id="laiActiveAiInput"></h${level}>`;
        return parent.querySelector('#laiActiveAiInput');
    }

    function checkAndReplaceLinks(recipient, matches){
        const link = `<a href="${matches?.[2] || ''}">${matches?.[1] || ''}</a>`;
        recipient.innerHTML = recipient.innerHTML.replace(matches[0], link);
        return recipient;
    }

    function shitchToCodeTag(recipient, char){
        recipient.setAttribute("id", "laiPreviousAiInput");
        recipient.innerHTML += `<code id="laiActiveAiInput" class="lai-code" data-char="${char}"></code>`;
        return recipient.querySelector('#laiActiveAiInput');
    }

    function switchToItalic(recipient, char){
        recipient.setAttribute("id", "laiPreviousAiInput");
        recipient.innerHTML += `<i id="laiActiveAiInput" data-char="${char}"></i>`;
        return recipient.querySelector('#laiActiveAiInput');
    }

    function switchItalicToBold(recipient, char){
        let currentHtml = recipient.outerHTML;
        let parent = recipient.parentElement;
        recipient.remove();
        parent.innerHTML += currentHtml.replace(/^\<i/, '<b').replace(/i\>$/, 'b>');
        return parent.querySelector('#laiActiveAiInput');
    }

    function changeRecipient(char, recipient){
        let recipientTagName = recipient.tagName.toLowerCase();
        const last4StreamChars = processedStreamData.slice(-4);

        if(recipientTagName.charAt(0) === 'h' && char === '\n'){
            return closeActiveTag(recipient);
        }

        if(recipientTagName !== 'pre') {
            let matches = processedStreamData.match(/\[(.*?)\]\((.*?)\)$/); // links
            if(matches){
                return checkAndReplaceLinks(recipient, matches);
            }

            const pattern = /\n-{3,}\n$/;
            if(pattern.test(processedStreamData + char)){
                recipient.innerHTML = recipient.innerHTML.replace(/-{1,}$/, '<hr>');
                return recipient;
            }

            if(['b', 'strong', 'i', 'em'].includes(recipientTagName) && '*_'.indexOf(char) < 0 && '*_'.indexOf(last4StreamChars.slice(-1)) > -1){
                return closeActiveTag(recipient);
            } else if(!['b', 'strong', 'i', 'em'].includes(recipientTagName) && '*_'.indexOf(char) > -1 && '*_'.indexOf(last4StreamChars.slice(-1)) < 0){
                return switchToItalic(recipient, char);
            } else if(recipientTagName === 'i' && char === last4StreamChars.slice(-1) && '*_'.indexOf(char) > -1){
                return switchItalicToBold(recipient, char);
            } else if(['b', 'strong', 'i', 'em'].includes(recipientTagName)){
                return recipient;
            }
        }

        if(/\n(`{3}|'{3})$/.test(last4StreamChars + char)){
            return handlePreTag(recipient);
        }

        // if(/\n#{1,}[ \t]+$/.test(last4StreamChars) || char === '#'){
        if(recipientTagName !== 'pre' && /\n?#{1,}[ \t]+$/.test(last4StreamChars + char)){
            return switchOrChangeHTag(processedStreamData.slice(-8) + char, recipient);
        }

        if(recipientTagName !== 'pre' && /[\n\s<({\[][`']/.test(last4StreamChars.slice(-1) + char)){
            return shitchToCodeTag(recipient, char);
        }

        if(recipientTagName === 'code' && /[`'][\n\s.,;:!?)\]}>]/.test(last4StreamChars.slice(-1) + char)){
            const openingChar = recipient.getAttribute('data-char') || '';
            if(last4StreamChars.slice(-1) !== openingChar) {  return recipient;  }
            recipient.removeAttribute('data-char');
            recipient.innerHTML = recipient.innerHTML.replace(openingChar, '');
            return closeActiveTag(recipient);
        }

        return recipient;
    }

    function cleanTrailingTriggerChars(recipient){
        const activeTagName = recipient.tagName.toLowerCase();
        let html = recipient.innerHTML;

        if(activeTagName === 'code') {  return html;  }

        if(activeTagName === 'pre'){
            return html.replace(/[`']{1,}$/, '');
        }

        if(/#\s/.test(html)){
            return html;
        }

        return html.replace(/[`'#*_]{1,}$/, '');
    }

    function checkForTrigger(char, lastStreamChar, recipientTagName){
        // const triggerBlockChars = "`'#-+";
        // if(['b', 'strong', 'i', 'em'].includes(recipientTagName) && triggerBlockChars.indexOf(char) < 0){  return false;  }
        if(lastStreamChar === '' && triggerBlockChars.indexOf(char) > -1){  return true;  }
        if(triggerBlockChars.indexOf(lastStreamChar) > -1 && /\s/.test(char)){  return true;  }
        if(/\s/.test(lastStreamChar) && triggerBlockChars.indexOf(char) > -1){  return true;  }
        if((/^h|pre/i.test(recipientTagName) && char === '\n')){  return true;  }
        if(lastStreamChar === ')' || lastStreamChar === '-'){  return true;  }
        if(/[`'][\s.,;:!?)\]}>]|[\s<({\[][`']/.test(lastStreamChar + char)) {  return true;  }
        // if(/[`'][\s.,;:!?]| [`']/.test(lastStreamChar + char)) {  return true;  }
        if(triggerBlockChars.indexOf(lastStreamChar) > -1 && triggerBlockChars.indexOf(char) > -1 && lastStreamChar === char){  return true;  }
        return false;
    }

    function processDataChunk(dataChunk, recipient){
        // const triggerBlockChars = "`'#-+";
        let recipientTagName = recipient.tagName.toLowerCase();

        dataChunk.split('').forEach(char => {
            const rawChar = char;
            // processedStreamData += char;
            const lastStreamChar = processedStreamData.slice(-1)

            let shouldTrigger = checkForTrigger(char, lastStreamChar, recipientTagName);

            if(shouldTrigger){
                let currentRecipientTagName = recipientTagName;

                recipient.innerHTML = cleanTrailingTriggerChars(recipient);
                recipient = changeRecipient(char, recipient);
                recipientTagName = recipient.tagName.toLowerCase();
                if(currentRecipientTagName !== recipientTagName && triggerBlockChars.indexOf(char) > -1){
                    currentRecipientTagName = recipientTagName;
                    char = '';
                }
            }

            processedStreamData += rawChar;
            if(recipientTagName === 'pre' && char === '\n'){
                char = handlePreTagTitle(char, recipient);
            }
            recipient.innerHTML +=  recipientTagName === 'pre' ? char : (char === '\n' ? '<br/>' : char);
            recipient.innerHTML = recipient.innerHTML.replace(/<br\s*\/?>\s*<br\s*\/?>$/, '<p/>');
        });
    }

    // main point
    // recipient is either the element itself or function returning a valid element
    function processStreamChunk(dataChunk, recipient){
        if(!recipient) {  return;  }
        if(typeof(recipient) === 'function'){
            recipient = recipient();
        }
        if(!recipient) {  return;  }
        processDataChunk(dataChunk, recipient);
    }

    function dispose(){
        processedStreamData = '';
    }

    return {
        processStreamChunk: processStreamChunk,
        dispose: dispose,
        getRawContent: () => processedStreamData
    };

})();