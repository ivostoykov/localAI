import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const solomdCode = fs.readFileSync(
    path.join(__dirname, '../src/jslib/solomd2html.js'),
    'utf-8'
);

function loadParser(window) {
    return new Function(
        'document',
        'DocumentFragment',
        'CustomEvent',
        'Node',
        'navigator',
        solomdCode + '; return parseAndRender;'
    )(
        window.document,
        window.DocumentFragment,
        window.CustomEvent,
        window.Node,
        window.navigator
    );
}

describe('solomd2html table rendering', () => {
    it('renders one markdown table as one html table', async () => {
        const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
        const parseAndRender = loadParser(dom.window);
        const root = dom.window.document.getElementById('root');

        await parseAndRender([
            'Extracted LinkedIn Profile Information',
            '',
            '| Field | Value |',
            '| --- | --- |',
            '| **First name** | Terry |',
            '| **Current position / job title** | Chief Marketing Officer at Options Technology |',
            '| **Location** | Belfast Metropolitan Area |'
        ].join('\n'), root, { streamReply: false });

        const tables = root.querySelectorAll('table');
        expect(tables).toHaveLength(1);
        expect(tables[0].querySelectorAll('tbody tr')).toHaveLength(3);
        expect(tables[0].textContent).toContain('First name');
        expect(tables[0].textContent).toContain('Chief Marketing Officer at Options Technology');
        expect(tables[0].querySelector('tbody strong').textContent).toBe('First name');
    });

    it('separates prose from a following markdown table', async () => {
        const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
        const parseAndRender = loadParser(dom.window);
        const root = dom.window.document.getElementById('root');

        await parseAndRender([
            'Profile data',
            '| Field | Value |',
            '| --- | --- |',
            '| First name | Terry |'
        ].join('\n'), root, { streamReply: false });

        expect(root.querySelectorAll('p')).toHaveLength(1);
        expect(root.querySelectorAll('table')).toHaveLength(1);
        expect(root.querySelector('table tbody tr').textContent).toContain('Terry');
    });

    it('renders inline markdown inside table cells', async () => {
        const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>');
        const parseAndRender = loadParser(dom.window);
        const root = dom.window.document.getElementById('root');

        await parseAndRender([
            '| **Field** | Value |',
            '| --- | --- |',
            '| **Email** | *Not available* |'
        ].join('\n'), root, { streamReply: false });

        const table = root.querySelector('table');
        expect(table.querySelector('thead strong').textContent).toBe('Field');
        expect(table.querySelector('tbody strong').textContent).toBe('Email');
        expect(table.querySelector('tbody em').textContent).toBe('Not available');
    });
});
