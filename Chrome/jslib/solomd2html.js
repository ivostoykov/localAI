function parse(markdownText, rootEl, options = {}) {
    const config = Object.assign({ codeCopy: true }, options);
    const lines = markdownText.replace(/\r\n/g, '\n').split('\n');
    let blocks = processLines(lines);
    blocks = mergeConsecutiveHtmlBlocks(blocks);
    // return blocks;
    blocks.forEach((bl, idx) => {
        const el = renderBlock(bl);
        if (el) { rootEl.appendChild(el); }
    });

    function processLines(lines) {
        const result = [];
        let currentBlock = null;

        for (const line of lines) {
            const trimmed = line.trim();
            const blockType = currentBlock?.type === 'fence' ? 'fence' : detectBlockType(trimmed);

            if (!currentBlock) { currentBlock = { type: blockType, content: [] }; }

            if (shouldSwitchBlock(currentBlock, blockType, trimmed)) {
                if (blockType === 'fence') { currentBlock.content.push(line); }
                result.push({ ...currentBlock, content: currentBlock.content.join('\n') });
                currentBlock = blockType === 'fence' ? null : (trimmed ? { type: blockType, content: [line] } : null);
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
            case 'pre':
                // el.textContent = block.content;
                el = renderCodeBlock(block.content, el);
                break;
            case 'ul':
                el = renderListContent(block.content);
                break;
            case 'blockquote':
                const bq = renderBlockquoteContent(block.content);
                el.appendChild(bq);
                break;
            case 'html':
                // el.textContent = escapeHTML(block.content);
                el.textContent = block.content;
                break;
            case 'table':
                return renderTable(block.content);
            default:
                const inline = renderMultilineContent(block.content);
                el.appendChild(inline);
                break;
        }

        return el;
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

            // Find correct parent level
            while (stack.length && indent < stack[stack.length - 1].indent) {
                stack.pop();
            }

            let parent = stack[stack.length - 1];

            // If deeper indent, nest into new sublist
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
        const container = document.createDocumentFragment();
        const lines = content.split('\n');

        lines.forEach(line => {
            const heading = line.match(/^#{1,6}\s+(.*)/);
            if (heading) {
                const level = line.match(/^#+/)[0].length;
                const h = document.createElement(`h${level}`);
                h.appendChild(renderInline(heading[1]));
                container.appendChild(h);
            } else {
                const p = document.createElement('p');
                p.appendChild(renderInline(line));
                container.appendChild(p);
            }
        });

        return container;
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
            // const match = line.match(/^\s{0,3}(>+)\s?(.*)/);
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
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/_(.*?)_/g, '<em>$1</em>')
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
            "table": "table"
        }

        return el[type];
    }

    function detectBlockType(line) {
        if (/^\s{0,3}>/.test(line)) return 'blockquote';
        if (/^\s*([-+*]|\d+\.)\s/.test(line)) return 'list';
        if (/^\s*([`']{3,})\s{0,}(\w+)?\s*$/.test(line)) return 'fence';
        if (/^(\s{4,}|\t)/.test(line)) return 'indented';
        if (/^\s*<.+?>/.test(line)) return 'html';
        if (line === '') return 'empty';
        if (/^\s*(\||\+).+(\||\+)\s*$/.test(line)) return 'table';
        return 'general';
    }

    function shouldSwitchBlock(currentBlock, newType, trimmed) {
        const currentType = currentBlock.type;
        if (currentType === 'indented') return !(trimmed.startsWith('    ') || trimmed.startsWith('\t'));
        if (currentType === 'blockquote') return !/^\s{0,3}>/.test(trimmed);
        if (currentType === 'html') return /<\/.+?>/.test(trimmed);
        if (currentType === 'general') return trimmed === '';
        if (currentType === 'fence') {
            const iaFneceOpened = currentBlock.content.length > 1 && (/^\s*([`']{3,})/).test(currentBlock.content?.[0]);
            const isSameBlockType = currentType === newType;
            const isFenceTerminator = (/^\s*([`']{3,})/).test(trimmed);
            return iaFneceOpened && isSameBlockType && isFenceTerminator;
        }
        return currentType !== newType;
    }

    function escapeHTML(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
}

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = { parse };
}