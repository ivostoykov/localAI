const StreamMarkdownProcessor = (function () {
    const triggerBlockChars = "*_`'#=+";
    var processedStreamData = '';
    var triggerStack = '';
    var isPre = false;

    function setRecipientId(recipient, id) {
        recipient.setAttribute("id", id);
        return recipient;
    }

    function createElementWithId(tag, id, className) {
        const element = document.createElement(tag);
        element.id = id;
        if (className) element.classList.add(className);
        return element;
    }

    function closeActiveTag(recipient) {
        if (recipient.tagName === 'PRE') {
            isPre = false;
        }

        const previous = recipient.previousEl ?? recipient.closest('#laiPreviousAiInput') ?? recipient.parentElement;
        recipient.removeAttribute("id");
        return setRecipientId(previous, "laiActiveAiInput");
    }

    function switchToPreTag(recipient, char) {
        const pre = createElementWithId('pre', "laiPreviousAiInput", 'lai-source');
        recipient.removeAttribute('id');
        pre.previousEl = recipient;

        let preTitle;
        preTitle = createElementWithId('span', "laiActiveAiInput", 'lai-source-title');
        preTitle.previousEl = pre;
        pre.appendChild(preTitle);
        recipient.appendChild(pre);
        recipient = preTitle;
        if(!/[a-zA-Z0-1]/i.test(char)){
            preTitle.textContent = 'Source';
            recipient = closeActiveTag(preTitle);
        }

        isPre = true;

        return recipient;
    }

    function switchToCodeTag(recipient) {
        recipient = setRecipientId(recipient, "laiPreviousAiInput");
        const code = createElementWithId('code', "laiActiveAiInput", 'lai-code');
        code.previousEl = recipient;
        recipient.appendChild(code);

        return code;
    }

    function switchToBold(recipient) {
        recipient = setRecipientId(recipient, "laiPreviousAiInput");
        const b = createElementWithId('b', "laiActiveAiInput");
        b.previousEl = recipient;
        recipient.appendChild(b);

        return b;
    }

    function transformNewLines(recipient, newlines) {
        switch (newlines) {
            case 0:
                break;
            case 1:
                if (recipient.tagName.indexOf('H') === 0) {
                    recipient = closeActiveTag(recipient);
                } else {
                    let tag = 'br';
                    if(/<br>$/i.test(recipient.innerHTML)){
                        recipient.removeChild(recipient.lastChild);
                        tag = 'p';
                    }
                    recipient.appendChild(document.createElement(tag));
                }
                break;
            default:
                recipient.innerHTML = '&nbsp;';
                recipient.appendChild(document.createElement('p'));
        }
    }

    function changeRecipient(recipient, char) {
        const recipientTagName = recipient.tagName.toLowerCase();

        switch (true) {
            case /^(\*\*|__)*$/.test(triggerStack):
                const newlines = (triggerStack.match(/\n/g) || []).length;
                recipient = recipientTagName === 'b' ? closeActiveTag(recipient) : switchToBold(recipient);
                triggerStack = '';
                transformNewLines(recipient, newlines);
                break;
            case triggerStack === "'" || triggerStack === '`':
                recipient = recipientTagName === 'code' ? closeActiveTag(recipient) : switchToCodeTag(recipient);
                triggerStack = '';
                break;
            case triggerStack === "'''" || triggerStack === '```':
                recipient = recipientTagName === 'code' ? closeActiveTag(recipient) : switchToPreTag(recipient, char);
                triggerStack = '';
                break;
            case /^\-{3,}|={3,}$/.test(triggerStack):
                recipient.appendChild(document.createElement('hr'));
                triggerStack = '';
                break;
        }

        return recipient;
    }

    function fixFaulseCodeTag(recipient) {
        const wordEndings = /(?:\w+'(?:m|re|ll|s|d|ve|t))[\s.,;:!?]?/i;
        const wordFormations = /(?:\s+'(?:clock|til|bout|cause|em))/i;
        const possessions = /\w{1,}s'[\s\.,\?!]{0,1}/i;
        var html;

        switch (true) {
            case wordFormations.test(processedStreamData.slice(-10)):
            case wordEndings.test(processedStreamData.slice(-10)):
            case possessions.test(processedStreamData.slice(-10)):
                html = recipient.innerHTML;
                break;
            default:
                html = undefined;
        }

        if (!html) {
            return recipient;
        }

        recipient.classList.add('delete');
        recipient = closeActiveTag(recipient);
        const forDelete = recipient.querySelector('.delete');
        recipient.removeChild(forDelete);
        recipient.innerHTML += `'${html}`;

        return recipient;
    }

    function handleIsPre(triggerStack, char, recipient) {
        const recipientTagName = recipient.tagName.toLowerCase();
        if (recipientTagName === 'pre') {
            if (/(```|''')\n*$/.test(triggerStack.slice(-3))) {
                recipient.innerHTML = recipient.innerHTML.replace(/('|`)*$/, '');
                recipient = closeActiveTag(recipient);
            } else {
                recipient.innerHTML += char;
            }
        } else {
            if (char === '\n') {
                if (!recipient.textContent) { recipient.textContent = 'Code'; }
                recipient = closeActiveTag(recipient);
            }

            recipient.innerHTML += char;
        }

        return recipient;
    }

    function processDataChunk(dataChunk, recipient) {
        const currentChunk = dataChunk;
        // processedStreamData += currentChunk;

        currentChunk.split('').forEach((char, i, data) => {
            if (triggerBlockChars.includes(char)) {
                triggerStack += char;
                if (!isPre) { return; }
            }

            if (isPre) {
                if(char !== "`"){  triggerStack = ''; /* triggerStack.replace(char, ''); */  }
                recipient = handleIsPre(triggerStack, char, recipient);
                if(recipient.tagName !== 'PRE'){  triggerStack = '';  }
                return
            }

            if (triggerStack) {
                recipient = changeRecipient(recipient, char);
                triggerStack = '';
            }

            if (char === '\n') {
                transformNewLines(recipient, 1);
            } else {
                recipient.innerHTML += `${triggerStack}${char}`;
            }

            if (recipient.tagName === 'CODE') {
                recipient = fixFaulseCodeTag(recipient);
            }
        });

        processedStreamData += currentChunk;
    }

    function processStreamChunk(dataChunk, recipient) {
        if (!recipient) { return; }
        if (typeof (recipient) === 'function') {
            recipient = recipient();
        }
        if (!recipient) { return; }

        processDataChunk(dataChunk, recipient);
    }

    function dispose() {
        processedStreamData = '';
    }

    return {
        processStreamChunk: processStreamChunk,
        dispose: dispose,
        getRawContent: () => processedStreamData
    };

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = StreamMarkdownProcessor;
}
