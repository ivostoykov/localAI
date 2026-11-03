import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf-8');
const SECTIONS = ['general', 'filtering', 'prompts', 'tools'];

// jsdom resolves the cascade but performs no layout, so this asserts the CSS
// height chain that lets each section's container scroll, not rendered geometry.
function loadOptionsPage() {
    const css = read('src/css/options.css');
    const html = read('src/options.html')
        .replace(/<link[^>]*href="css\/options\.css"[^>]*>/, `<style>${css}</style>`)
        .replace(/<script[\s\S]*?<\/script>/g, '');
    return new JSDOM(html).window;
}

function expectShrinkableFlexItem(style, label) {
    expect(style.flexGrow, label).toBe('1');
    expect(style.minHeight, label).toMatch(/^0(px)?$/);
}

describe('options page layout', () => {
    const window = loadOptionsPage();
    const { document } = window;
    const styleOf = el => window.getComputedStyle(el);

    it('constrains the form to the content area as a column flex container', () => {
        const contentArea = document.querySelector('.content-area');
        const form = document.getElementById('laiOptionsForm');
        expect(form.parentElement).toBe(contentArea);
        expect(styleOf(contentArea).display).toBe('flex');
        expect(styleOf(contentArea).flexDirection).toBe('column');

        const formStyle = styleOf(form);
        expect(formStyle.display).toBe('flex');
        expect(formStyle.flexDirection).toBe('column');
        expectShrinkableFlexItem(formStyle, 'form');
    });

    it.each(SECTIONS)('makes the %s section container scroll within the available height', id => {
        const section = document.getElementById(id);
        const container = section.querySelector(':scope > .container');
        expect(section.parentElement.id).toBe('laiOptionsForm');
        expect(container).not.toBeNull();

        const wasHidden = section.classList.contains('invisible');
        section.classList.remove('invisible');
        try {
            const sectionStyle = styleOf(section);
            expect(sectionStyle.display).toBe('flex');
            expect(sectionStyle.flexDirection).toBe('column');
            expectShrinkableFlexItem(sectionStyle, `#${id}`);

            const containerStyle = styleOf(container);
            expectShrinkableFlexItem(containerStyle, `#${id} > .container`);
            expect(containerStyle.overflowY).toBe('auto');
        } finally {
            if (wasHidden) { section.classList.add('invisible'); }
        }
    });

    it('keeps inactive sections hidden', () => {
        for (const id of SECTIONS.slice(1)) {
            expect(styleOf(document.getElementById(id)).display, id).toBe('none');
        }
    });
});
