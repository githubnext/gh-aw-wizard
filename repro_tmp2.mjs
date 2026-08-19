import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

const root = '/home/runner/work/gh-aw-wizard/gh-aw-wizard';
const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');

const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only' });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Event = dom.window.Event;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.CustomEvent = dom.window.CustomEvent;
global.localStorage = dom.window.localStorage;
global.fetch = () => Promise.reject(new Error('no fetch in test'));
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);

const ui = await import(path.join(root, 'src/js/ui.js'));
ui.initWizard();

await new Promise((r) => setTimeout(r, 50));

const doc = document;
const radios = [...doc.querySelectorAll('input[name="archetype"]')];
radios[0].focus();
console.log('focused', doc.activeElement.value);

// simulate real native radiogroup ArrowDown: browser moves focus+checked to next radio and fires input+change (no separate keydown handling needed in app since native browser handles arrow key)
radios[1].checked = true;
radios[1].focus();
radios[1].dispatchEvent(new dom.window.Event('input', { bubbles: true }));
radios[1].dispatchEvent(new dom.window.Event('change', { bubbles: true }));

await new Promise((r) => setTimeout(r, 50));
const active = doc.activeElement;
console.log('after arrowdown activeElement tag:', active.tagName, 'value:', active.value, 'text:', active.textContent && active.textContent.trim().slice(0,30));
console.log('checked value:', doc.querySelector('input[name=archetype]:checked').value);
