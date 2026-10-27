// E2E smoke test: loads dist/ in Chromium, opens tabs on several hosts, organizes, checks groups.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'text/html');
  res.end(`<title>${u.searchParams.get('t') || 'page'}</title><h1>${req.headers.host}</h1>`);
}).listen(8099);

const ext = path.resolve('dist');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-'));
const ctx = await chromium.launchPersistentContext(dir, {
  headless: true, channel: 'chromium',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const errors = [];
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
sw.on('console', (m) => { if (m.type() === 'error') errors.push('sw: ' + m.text()); });
const id = sw.url().split('/')[2];
console.log('extension id', id);

const pages = [
  ['github.localhost', 'espressif/esp-idf: ESP32 IoT framework'],
  ['github.localhost', 'jsamuel1/robot-arm: servo controller'],
  ['docs.espressif.localhost', 'ESP32-S3 Technical Reference Manual'],
  ['shop.localhost', 'Rocket R58 Cinquantotto espresso machine'],
  ['shop.localhost', 'Espresso tamper 58mm'],
  ['news.localhost', 'Tech news today'],
];
for (const [h, t] of pages) {
  const p = await ctx.newPage();
  await p.goto(`http://${h}:8099/?t=${encodeURIComponent(t)}`);
}
const ui = await ctx.newPage();
ui.on('console', (m) => { if (m.type() === 'error') errors.push('ui: ' + m.text()); });
ui.on('pageerror', (e) => errors.push('ui: ' + e.message));
await ui.goto(`chrome-extension://${id}/popup.html`);
await ui.waitForTimeout(1500);

const call = (type, payload = {}) => ui.evaluate(([type, payload]) => chrome.runtime.sendMessage({ target: 'background', type, ...payload }), [type, payload]);
console.log('organize', JSON.stringify(await call('organize', { rediscover: true })));
await ui.waitForTimeout(1500);
const groups = await ui.evaluate(async () => {
  const gs = await chrome.tabGroups.query({});
  const out = [];
  for (const g of gs) out.push({ title: g.title, color: g.color, tabs: (await chrome.tabs.query({ groupId: g.id })).map((t) => new URL(t.url).host) });
  return out;
});
console.log('groups', JSON.stringify(groups, null, 1));
const status = await call('status');
console.log('status.engine', JSON.stringify(status.result?.engine), 'llm', status.result?.llm);
console.log('search', JSON.stringify((await call('search', { query: 'espresso' })).result.open.map((x) => x.title)));

// same-domain invariant
const hostGroups = {};
for (const g of groups) for (const h of g.tabs) (hostGroups[h] ||= new Set()).add(g.title);
const split = Object.entries(hostGroups).filter(([, s]) => s.size > 1);
console.log(split.length ? 'FAIL same-domain split ' + JSON.stringify(split) : 'OK same-domain tabs share a group');

// lazy placeholder renders and does not navigate in background
const lazy = await ctx.newPage();
await lazy.goto(`chrome-extension://${id}/lazy.html#u=${encodeURIComponent('http://news.localhost:8099/?t=Later')}&t=Saved%20title&f=`);
console.log('lazy title', await lazy.title());
await call('organize', {});
const snap = await ui.evaluate(() => chrome.storage.local.get('state').then((s) => s.state.snapshot?.windows?.[0]?.tabs?.length));
console.log('snapshot tabs', snap);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await ctx.close();
server.close();
