async function parseAndRender(markdownText, rootEl, options = {}) {
    if (!rootEl) {
        console.error('[solomd2html] parseAndRender: missing rootEl');
        return;
    }
    const defaults = { codeCopy: true, streamReply: true, abortSignal: null, onAbort: null, onRenderStarted: null, onRendering: null, onRenderComplete: null };
    const config = Object.assign({}, defaults, options);
    const { abortSignal } = config;
    if (abortSignal) {
        abortSignal.addEventListener('abort', handleAbort, { once: true });
    }

    rootEl.dataset.status = 'parsing';
    rootEl.dispatchEvent(new CustomEvent('renderStarted', { bubbles: true }));
    config.onRenderStarted?.();

    const lines = normaliseMd(markdownText.replace(/\r\n/g, '\n')).split('\n');
    let blocks = processLines(lines);
    blocks = mergeConsecutiveHtmlBlocks(blocks);

    rootEl.dataset.status = 'rendering';
    for (const bl of blocks) {
        if (abortSignal?.aborted) { return; }

        const el = renderBlock(bl);
        if (!el) { continue; }
        const nodes = Array.isArray(el) ? el : (el instanceof DocumentFragment ? Array.from(el.childNodes) : [el]);
        for (const node of nodes) {
            if (node.tagName.toLowerCase() === 'details') {
                node.open = true;
            } else {
                const openDetail = rootEl.querySelector('details[open]');
                if (openDetail) openDetail.open = false;
            }

            if (config.streamReply) {
                await streamNode(node, rootEl);
            } else {
                rootEl.appendChild(node);
                rootEl.dispatchEvent(new CustomEvent('rendering', { detail: { newElement: node }, bubbles: true }));
                config.onRendering?.(bl);
            }
        }
    }
    rootEl.dataset.status = 'renderCompleted';
    rootEl.dispatchEvent(new CustomEvent('renderComplete', { bubbles: true }));
    config.onRenderComplete?.();
    cleanup();
    /// end of the main block

    function cleanup() {
        delete rootEl.dataset.status;
        abortSignal?.removeEventListener('abort', handleAbort);
    }

    function handleAbort() {
        rootEl.dispatchEvent(new CustomEvent('renderAborted', { bubbles: true }));
        cleanup();
        config.onAbort?.();
    }

    function processLines(lines) {
        const result = [];
        let currentBlock = null;

        for (const line of lines) {
            const trimmed = line.trim();
            const blockType = ['fence', 'think'].includes(currentBlock?.type ) ? currentBlock?.type : detectBlockType(trimmed);

            if (!currentBlock) { currentBlock = { type: blockType, content: [] }; }

            if (shouldSwitchBlock(currentBlock, blockType, trimmed)) {
                if (['fence', 'think'].includes(currentBlock?.type)) { currentBlock.content.push(line); }
                result.push({ ...currentBlock, content: currentBlock.content.join('\n') });
                currentBlock = ['fence', 'think'].includes(currentBlock?.type ) ? null : (trimmed ? { type: blockType, content: [line] } : null);
            } else {
                currentBlock.content.push(line);
            }
        }

        if (currentBlock) {
            result.push({ ...currentBlock, content: currentBlock.content.join('\n') });
        }

        return result;
    }

    function mergeConsecutiveHtmlBlocks(blocks) {
        if (!blocks || blocks.length < 1) { return blocks; }

        const result = [];
        let htmlContent = [];

        blocks.forEach(block => {
            if (block.type === 'html') {
                htmlContent.push(`${block.content}\n`);
            } else {
                if (htmlContent.length > 0) {
                    result.push({ type: 'html', content: htmlContent.join('') });
                    htmlContent = [];
                } else {
                    result.push(block);
                }
            }
        });

        if (htmlContent.length > 0) {
            result.push({ type: 'html', content: htmlContent.join('') });
        }

        return result;
    }

    function renderBlock(block) {
        let tag = getElementTagName(block);
        if (!tag) { return null; }
        let el = document.createElement(tag);
        if (block.type === 'html') { tag = 'html'; }

        switch (tag) {
            case 'hr':
                break;
            case 'heading':
                el = renderHeading(block.content);
                break;
            case 'pre':
                el = renderCodeBlock(block.content, el);
                break;
            case 'ul':
            case 'ol':
                return renderListContent(block.content);
            case 'blockquote':
                const bq = renderBlockquoteContent(block.content);
                el.appendChild(bq);
                break;
            case 'html':
                el.textContent = block.content;
                break;
            case 'table':
                return renderTable(block.content);
            case 'details':
                const det = document.createElement('details');
                det.className = 'think-block';
                const sum = document.createElement('summary');
                sum.textContent = '🤔 Thought';
                det.appendChild(sum);

                const inner = renderMultilineContent(block.content.replace(/<\/?think>/g, '').trim());
                inner.forEach(el => det.appendChild(el));
                return det;
            default:
                const res = renderMultilineContent(block.content);
                if (Array.isArray(res)) return res; // <- return array directly
                return res;
        }

        return el;
    }

    async function streamNode(srcNode, targetParent) {
        if (srcNode.nodeType === Node.TEXT_NODE) {
            const text = srcNode.textContent;
            let i = 0;
            const span = document.createTextNode('');
            targetParent.appendChild(span);
            await new Promise(resolve => {
                async function typeChar() {
                    if (i < text.length) {
                        span.textContent += text[i++];
                        if (i % 10 === 0 || text[i - 1] === '\n' || i >= text.length) {
                            rootEl.dispatchEvent(new CustomEvent('rendering', { newElement: srcNode }, { bubbles: true }));
                            config.onRendering?.(bl);
                        }
                        await new Promise(resolve => setTimeout(resolve));
                        requestAnimationFrame(typeChar);
                    } else {
                        resolve();
                    }
                }
                typeChar();
            });
        } else if (srcNode.nodeType === Node.ELEMENT_NODE) {
            const clone = document.createElement(srcNode.tagName);
            for (const attr of srcNode.attributes) {
                try {  clone.setAttribute(attr.name, attr.value);  }
                catch (err) {  console.error(`[${_getLineNumber()}] - ${err.message}`, err);  }
            }
            attachCopyHandler(clone); // reattach click on the copy button
            targetParent.appendChild(clone);
            for (const child of Array.from(srcNode.childNodes)) {
                await streamNode(child, clone);
            }
        }
    }

    function renderCodeBlock(content, el) {
        const lines = content.split('\n');
        const firstLine = lines[0];
        const lastLine = lines[lines.length - 1];

        const fenceMatch = firstLine.match(/^([`']{3,})(\s*\w+)?/);
        const isFenced = fenceMatch !== null;
        const language = fenceMatch?.[2]?.trim() || 'code';

        if (isFenced) {
            lines.shift();
            if (/^([`']{3,})\s*$/.test(lastLine)) {
                lines.pop();
            }
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'code-block';

        const ribbon = document.createElement('div');
        ribbon.className = 'code-ribbon';
        ribbon.textContent = language;

        const code = document.createElement('code');
        code.textContent = lines.join('\n');

        el.textContent = '';
        el.appendChild(code);

        // 👇 Add copy button if enabled
        if (typeof config !== 'undefined' && config.codeCopy) {
            const btn = document.createElement('button');
            btn.className = 'code-copy-btn';
            btn.textContent = '📋';
            btn.title = 'Copy';

            btn.addEventListener('click', () => {
                navigator.clipboard.writeText(code.textContent).then(() => {
                    btn.textContent = '✅';
                    setTimeout(() => btn.textContent = '📋', 1500);
                });
            });

            ribbon.appendChild(btn);
        }

        wrapper.appendChild(ribbon);
        wrapper.appendChild(el);
        return wrapper;
    }


    function renderListContent(content) {
        const lines = content.split('\n');
        const firstType = /^\d+\./.test(lines[0].trim()) ? 'ol' : 'ul';
        const root = document.createElement(firstType);
        const stack = [{ indent: 0, el: root }];

        lines.forEach(line => {
            const match = line.match(/^(\s*)([-+*]|\d+\.)\s+(.*)/);
            if (!match) return;

            const indent = match[1].length;
            const marker = match[2];
            const text = match[3];
            const isOrdered = /^\d+\./.test(marker);

            while (stack.length && indent < stack[stack.length - 1].indent) {
                stack.pop();
            }

            let parent = stack[stack.length - 1];

            if (indent > parent.indent) {
                const lastItem = parent.el.lastElementChild;
                if (!lastItem) return;

                const newList = document.createElement(isOrdered ? 'ol' : 'ul');
                lastItem.appendChild(newList);
                parent = { indent, el: newList };
                stack.push(parent);
            }

            const li = document.createElement('li');
            li.appendChild(renderInline(text));
            parent.el.appendChild(li);
        });

        return root;
    }


    function renderMultilineContent(content) {
        const lines = content.split('\n');
        const elements = [];

        lines.forEach(line => {
            const p = document.createElement('p');
            p.appendChild(renderInline(line));
            elements.push(p);
        });

        return elements;
    }

    function renderHeading(content) {
        const fragment = document.createDocumentFragment();
        content.split(/\s*\n{1,}/g).forEach(line => {
            const match = line.match(/^#{1,6}/);
            const tag = match ? `h${line.match(/^#{1,6}/)[0].length}` : 'p';
            const h = document.createElement(tag);
            h.appendChild(renderInline(line.replace(/^#{1,6}\s+/, '')));
            fragment.appendChild(h);
        });
        return fragment;
    }

    function renderGridTable(lines) {
        const table = document.createElement('table');
        const tbody = document.createElement('tbody');
        table.appendChild(tbody);

        // Filter out horizontal lines (e.g. +---+---+)
        const contentLines = lines.filter(line => !/^\s*\+[-+=+]+\+\s*$/.test(line));

        contentLines.forEach(line => {
            const row = document.createElement('tr');
            const cells = line.split('|').map(c => c.trim()).filter(Boolean);
            cells.forEach(cellText => {
                const td = document.createElement('td');
                td.textContent = cellText;
                row.appendChild(td);
            });
            tbody.appendChild(row);
        });

        return table;
    }

    function renderTable(content) {
        const lines = content.trim().split('\n');

        if (lines.some(line => /^\s*\+[-+]+\+\s*$/.test(line))) {
            return renderGridTable(lines);
        }

        if (lines.length < 2) return null;

        const table = document.createElement('table');
        const thead = document.createElement('thead');
        const tbody = document.createElement('tbody');

        const headerCells = lines[0].split('|').map(c => c.trim()).filter(Boolean);
        const alignInfo = lines[1].split('|').map(c => c.trim());

        const headerRow = document.createElement('tr');
        headerCells.forEach((cell, i) => {
            const th = document.createElement('th');
            th.textContent = cell;
            if (alignInfo[i]?.startsWith(':') && alignInfo[i]?.endsWith(':')) th.style.textAlign = 'center';
            else if (alignInfo[i]?.endsWith(':')) th.style.textAlign = 'right';
            else if (alignInfo[i]?.startsWith(':')) th.style.textAlign = 'left';
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        lines.slice(2).forEach(rowLine => {
            const row = document.createElement('tr');
            rowLine.split('|').map(c => c.trim()).filter(Boolean).forEach(cellText => {
                const td = document.createElement('td');
                td.textContent = cellText;
                row.appendChild(td);
            });
            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        return table;
    }


    function renderBlockquoteContent(content) {
        const lines = content.split('\n');
        let root = document.createElement('blockquote');

        lines.forEach(line => {
            const match = line.match(/^\s{0,3}((?:>\s*)+)(.*)/);
            if (!match) { return; }

            // const depth = match[1].length;
            const depth = (match[1].match(/>/g) || []).length;
            const text = match[2];

            let target = root;
            for (let i = 1; i < depth; i++) {
                if (!target.lastElementChild || target.lastElementChild.tagName !== 'BLOCKQUOTE') {
                    const inner = document.createElement('blockquote');
                    target.appendChild(inner);
                }
                target = target.lastElementChild;
            }

            const p = document.createElement('p');
            p.appendChild(renderInline(text));
            target.appendChild(p);
        });

        return root;
    }

    function renderInline(content) {
        const span = document.createElement('span');
        span.innerHTML = content
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/__(.*?)__/g, '<strong>$1</strong>')
            .replace(/\s\*(.*?)\*\s/g, '<em>$1</em>')
            .replace(/\s_(.*?)_\s/g, '<em>$1</em>')
            .replace(/~~(.*?)~~/g, '<del>$1</del>');
        return span;
    }

    function getElementTagName(block) {
        let type = block?.type || '';
        if (!type) { return ''; }

        if ((/^(_{3,}|\-{3,}|\*{3,})/).test(block.content)) { type = 'hr'; }
        const el = {
            "general": "p",
            "blockquote": "blockquote",
            "list": "ul",
            "indented": "pre",
            "fence": "pre",
            "html": "pre",
            "hr": "hr",
            "heading": "heading",
            "table": "table",
            "think": "details"
        }

        return el[type];
    }

    function detectBlockType(line) {
        if (/^\s*([`']{3,})\s{0,}(\w+)?\s*$/.test(line)) return 'fence';
        if (/^\s{0,3}>/.test(line)) return 'blockquote';
        if (/^\s*([-+*]|\d+\.)\s/.test(line)) return 'list';
        if (/^(\s{4,}|\t)/.test(line)) return 'indented';
        if (/^#{1,6}\s+/.test(line)) return 'heading';
        if (line === '') return 'empty';
        if (/^\s*(\||\+).+(\||\+)\s*$/.test(line)) return 'table';
        if (/^\s*<\/?think>\s*$/.test(line)) return 'think';
        if (/^\s*<.+?>/.test(line)) return 'html';
        // if (/^\s*<(?!think\b).+?>/.test(line)) return 'html';
        return 'general';
    }

    function shouldSwitchBlock(currentBlock, newType, trimmed) {
        const currentType = currentBlock.type;
        if (currentType === 'indented') return !(trimmed.startsWith('    ') || trimmed.startsWith('\t'));
        if (currentType === 'blockquote') return !/^\s{0,3}>/.test(trimmed);
        if (currentType === 'html') return /<\/.+?>/.test(trimmed);
        if (currentType === 'general') return trimmed === '';
        if (currentType === 'fence') {
            // Determine if a fenced code block has been opened
            const isFenceOpened = currentBlock.content.length > 1 && (/^\s*([`']{3,})/).test(currentBlock.content?.[0]);
            const isSameBlockType = currentType === newType;
            const isFenceTerminator = isFenceOpened && (/^\s*([`']{3,})/).test(trimmed);
            return isFenceOpened && isSameBlockType && isFenceTerminator;
        }
        if (currentType === 'think') {  return /^\s*<\/think>\s*$/.test(trimmed) || newType !== 'think';  }

        return currentType !== newType;
    }

    function attachCopyHandler(el) {
        if (el.classList.contains('code-copy-btn') && !el.dataset.bound) {
            el.dataset.bound = '1';  // prevents attaching duplicate event listeners.
            el.addEventListener('click', () => {
                const code = el.closest('.code-block')?.querySelector('code')?.textContent;
                if (!code) return;
                navigator.clipboard.writeText(code).then(() => {
                    el.textContent = '✅';
                    setTimeout(() => el.textContent = '📋', 1500);
                });
            });
        }
    }

    function _getLineNumber() {
        const e = new Error();
        const lines = e.stack.split('\n').map(l => l.trim());
        const frame = lines[2] || lines[1] || lines[0] || '';
        return frame.replace(/^at\s+/, '');
    }

    function normaliseMd(text) {
        return text
            .replace(/([^\n])\n([`']{3,}.*?\n)([^\n])/g, '$1\n\n$2\n$3')
            .replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2')             // headings
            .replace(/([^\n])\n(>)/g, '$1\n\n$2')                    // blockquotes
            // .replace(/([^\n])\n(\s*([-+*]|\d+\.)\s)/g, '$1\n\n$2')   // lists
            .replace(/([^\n])\n(\|.*\|)/g, '$1\n\n$2')               // tables
            .replace(/([^\n])\n(<[a-zA-Z])/g, '$1\n\n$2');           // HTML
    }
}

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = { parse: parseAndRender };
}