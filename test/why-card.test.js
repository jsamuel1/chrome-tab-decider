// The "Why?" card's part in the page: an empty box holding an extension-page frame. The page gets no
// text box to type into, no question and no answers, so key events and typed reasons stay in the frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Just enough of a DOM for the content script.
class El {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.style = { props: {}, setProperty: (k, v) => { this.style.props[k] = v; } };
    this.textContent = '';
    this.parent = null;
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  attachShadow({ mode }) { this.shadow = new El('#shadow'); this.shadow.mode = mode; return this.shadow; }
  all() { return [this, ...(this.shadow ? this.shadow.all() : []), ...this.children.flatMap((c) => c.all())]; }
}
const docEl = new El('html');
const listeners = new Map();
let onMessage = null;
globalThis.document = { createElement: (t) => { const e = new El(t); if (t === 'iframe') e.contentWindow = { frame: true }; return e; }, documentElement: docEl };
globalThis.window = {
  addEventListener: (t, fn) => listeners.set(t, fn),
  removeEventListener: (t, fn) => { if (listeners.get(t) === fn) listeners.delete(t); },
};
globalThis.chrome = {
  runtime: {
    id: 'me',
    getURL: (p) => `chrome-extension://me/${p}`,
    onMessage: { addListener: (fn) => { onMessage = fn; } },
  },
};
await import('../src/content/why.js');
const fromWorker = { id: 'me' };

test('the card in the page is only a frame of the extension page, with nothing to type into', () => {
  onMessage({ target: 'why', show: true, question: 'Why does this belong in Secret Project?' }, fromWorker);
  const [host] = docEl.children;
  assert.equal(host?.tag, 'tabsage-why');
  assert.equal(host.shadow.mode, 'closed');
  const els = host.all();
  const frame = els.find((e) => e.tag === 'iframe');
  assert.equal(frame?.attrs.src, 'chrome-extension://me/why.html');
  assert.ok(!els.some((e) => e.tag === 'input' || e.tag === 'textarea' || e.tag === 'form'), 'the page holds a text box');
  assert.ok(!els.some((e) => /Secret Project/.test(e.textContent)), 'the question reached the page');
});

test('only the frame itself can close or size the card', () => {
  const [host] = docEl.children;
  const frame = host.all().find((e) => e.tag === 'iframe');
  const message = listeners.get('message');
  message({ source: { page: true }, origin: 'https://evil.example.com', data: { tabsageWhy: 'close' } });
  assert.equal(docEl.children.length, 1, 'the page closed the card');
  message({ source: frame.contentWindow, origin: 'chrome-extension://me', data: { tabsageWhy: 'size', height: 9999 } });
  assert.equal(frame.style.height, '420px');
  message({ source: frame.contentWindow, origin: 'chrome-extension://me', data: { tabsageWhy: 'close' } });
  assert.equal(docEl.children.length, 0);
});

test('messages from other tabs or extensions show nothing', () => {
  onMessage({ target: 'why', show: true }, { id: 'me', tab: { id: 1 } });
  onMessage({ target: 'why', show: true }, { id: 'other' });
  assert.equal(docEl.children.length, 0);
});

test('the frame is an extension page the page can load, and it holds the text box', () => {
  const manifest = JSON.parse(readFileSync(new URL('../static/manifest.json', import.meta.url)));
  assert.ok(manifest.web_accessible_resources.some((r) => r.resources.includes('why.html')));
  const html = readFileSync(new URL('../static/why.html', import.meta.url), 'utf8');
  assert.match(html, /<input id="text"/);
  assert.match(html, /src="why-frame.js"/);
});
