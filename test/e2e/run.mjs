// E2E smoke test: loads dist/ in Chromium with no classifier (Hugging Face is unreachable), opens
// tabs on several hosts and checks that nothing is grouped, page details are stored and onboarding opens.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const t = u.searchParams.get('t') || 'page';
  res.setHeader('content-type', 'text/html');
  res.end(`<html lang="en"><title>${t}</title><meta name="description" content="About ${t}">` +
    `<meta property="og:site_name" content="${req.headers.host}"><h1>${t}</h1><p>Body text is never read.</p></html>`);
}).listen(8099);

const ext = path.resolve('dist');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-'));
const ctx = await chromium.launchPersistentContext(dir, {
  headless: true, channel: 'chromium',
  args: [
    `--disable-extensions-except=${ext}`, `--load-extension=${ext}`,
    // No classifier in this test, so the download must fail rather than arrive part-way through.
    '--host-resolver-rules=MAP huggingface.co ~NOTFOUND, MAP *.huggingface.co ~NOTFOUND, MAP *.hf.co ~NOTFOUND',
  ],
});
const errors = [];
const watch = (p, name) => {
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
};
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
sw.on('console', (m) => { if (m.type() === 'error') errors.push('sw: ' + m.text()); });
const id = sw.url().split('/')[2];
console.log('extension id', id);

const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
};

const onboarding = await until(() => ctx.pages().find((p) => p.url() === `chrome-extension://${id}/onboarding.html`));
if (onboarding) watch(onboarding, 'onboarding');
console.log(onboarding ? 'OK onboarding opened on install' : 'FAIL onboarding did not open on install');

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
  watch(p, h);
  await p.goto(`http://${h}:8099/?t=${encodeURIComponent(t)}`);
}
// Extensions cannot run scripts on Chrome's own pages; opening one must not cause errors.
const internal = await ctx.newPage();
await internal.goto('chrome://version');

const ui = await ctx.newPage();
watch(ui, 'ui');
await ui.goto(`chrome-extension://${id}/popup.html`);
await ui.waitForTimeout(1500);

const call = (type, payload = {}) => ui.evaluate(([type, payload]) => chrome.runtime.sendMessage({ target: 'background', type, ...payload }), [type, payload]);

const stored = await until(async () => {
  const n = (await call('pageDetailsCount'))?.result ?? 0;
  return n >= pages.length && n;
});
console.log(stored ? 'OK page details stored for open tabs' : `FAIL page details stored for ${(await call('pageDetailsCount'))?.result ?? 0} of ${pages.length} tabs`);

console.log('organize', JSON.stringify(await call('organize', { rediscover: true })));
await ui.waitForTimeout(1500);
const layout = await ui.evaluate(async () => ({
  groups: (await chrome.tabGroups.query({})).length,
  grouped: (await chrome.tabs.query({})).filter((t) => t.groupId !== -1 || t.pinned).length,
}));
const status = (await call('status')).result;
console.log('status.ready', status?.ready, 'engine', JSON.stringify(status?.engine), 'llm', status?.llm);
console.log(!status?.ready && !layout.groups && !layout.grouped
  ? 'OK no tabs grouped before the classifier is ready'
  : 'FAIL tabs grouped before the classifier is ready ' + JSON.stringify({ ready: status?.ready, ...layout }));
console.log('search', JSON.stringify((await call('search', { query: 'espresso' })).result.open.map((x) => x.title)));

// lazy placeholder renders and does not navigate in background
const lazy = await ctx.newPage();
await lazy.goto(`chrome-extension://${id}/lazy.html#u=${encodeURIComponent('http://news.localhost:8099/?t=Later')}&t=Saved%20title&f=`);
console.log('lazy title', await lazy.title());
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await ctx.close();
server.close();
