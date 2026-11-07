// Chrome Web Store screenshots (1280 × 800) of a real Chromium window with dist/ loaded, using sample
// pages for a fictional company, Northwind. Run on a Mac with a display, after `npm run build`:
//   node scripts/store-screenshots.mjs
// The browser has no classifier, so the tab groups are created here, with the titles and colours
// TabSage gives them. The extension pages (the popup's Recent list, "Why?" card, onboarding, Settings) are real,
// and the window uses Chrome's vertical tabs, the layout TabSage suggests.
// Writes docs/store/screenshot-*.png. Needs Playwright (npm install --no-save playwright@1) and, for
// screencapture, Screen Recording permission for the terminal.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = path.resolve('docs/store');
const PORT = 8099;
fs.mkdirSync(OUT, { recursive: true });

// --- sample pages: one look per site
const SITES = {
  'tracker.northwind.localhost': { name: 'Northwind Tracker', color: '#1f6feb' },
  'people.northwind.localhost': { name: 'Northwind People', color: '#8250df' },
  'wiki.northwind.localhost': { name: 'Northwind Wiki', color: '#1a7f37' },
  'skyfare.localhost': { name: 'Skyfare', color: '#d97706' },
  'stayfinder.localhost': { name: 'StayFinder', color: '#db2777' },
  'simmer.localhost': { name: 'Simmer', color: '#c2410c' },
  'dailybrief.localhost': { name: 'The Daily Brief', color: '#475569' },
};
const PAGES = {
  'tracker.northwind.localhost/ATLAS-142': ['ATLAS-142 · Migrate billing to the new ledger', 'Atlas project · In progress · Due Friday', 'Move invoice generation onto the shared ledger service and retire the nightly batch job.'],
  'tracker.northwind.localhost/ATLAS-157': ['ATLAS-157 · Ledger reconciliation report', 'Atlas project · In review', 'A daily report that compares ledger totals with the payment provider.'],
  'wiki.northwind.localhost/atlas/architecture': ['Atlas architecture overview', 'Atlas · Engineering wiki', 'How the ledger, invoicing and reporting services fit together.'],
  'wiki.northwind.localhost/payroll/runbook': ['Payroll run checklist', 'Payroll · Operations wiki', 'Steps for the fortnightly payroll run, with approvals and cut-off times.'],
  'tracker.northwind.localhost/PAY-88': ['PAY-88 · Overtime rates for weekend shifts', 'Payroll project · To do', 'Apply the new overtime multipliers from the 1 December award.'],
  'people.northwind.localhost/priya': ['Priya Raman · Engineering Manager', 'Northwind People directory', 'Atlas team lead. Sydney office, level 12.'],
  'wiki.northwind.localhost/handbook/leave': ['Leave and time off', 'Northwind handbook', 'How to book annual leave and what counts as a public holiday.'],
  'skyfare.localhost/kyoto': ['Flights to Kyoto (KIX) · 14–28 March', 'Skyfare · Compare flights', 'Return flights from Sydney, 2 adults.'],
  'stayfinder.localhost/gion': ['Ryokan stay in Gion, Kyoto', 'StayFinder · 4 nights', 'Traditional inn with breakfast, a short walk from Yasaka Shrine.'],
  'simmer.localhost/ramen': ['Weeknight miso ramen', 'Simmer · 30-minute dinners', 'A quick miso broth with soft eggs and greens.'],
  'simmer.localhost/dumplings': ['Pork and cabbage dumplings', 'Simmer · Weekend cooking', 'Fold, steam and pan-fry a batch for the freezer.'],
  'dailybrief.localhost/today': ['Morning briefing', 'The Daily Brief', 'The stories to know about today.'],
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const page = (host, p) => {
  const [title, kicker, body] = PAGES[`${host}${p}`] || ['Page', '', ''];
  const site = SITES[host] || { name: host, color: '#334155' };
  const icon = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='${site.color}'/><text x='16' y='22.5' font-family='Arial,sans-serif' font-size='18' font-weight='700' text-anchor='middle' fill='white'>${site.name[0]}</text></svg>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(icon)}">
<meta name="description" content="${esc(body)}"><meta property="og:site_name" content="${esc(site.name)}">
<style>body{margin:0;font:16px/1.55 -apple-system,system-ui,sans-serif;color:#1f2937;background:#f8fafc}
header{background:${site.color};color:#fff;padding:14px 32px;font-weight:600;letter-spacing:.01em}
main{max-width:760px;margin:40px auto;padding:0 32px}.k{color:#64748b;font-size:14px}
h1{font-size:30px;line-height:1.25;margin:6px 0 16px}.card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px 24px;margin-top:24px}
.bar{height:10px;border-radius:5px;background:#e2e8f0;margin:12px 0}.bar.s{width:60%}.bar.m{width:80%}</style></head>
<body><header>${esc(site.name)}</header><main><div class="k">${esc(kicker)}</div><h1>${esc(title)}</h1><p>${esc(body)}</p>
<div class="card"><div class="bar m"></div><div class="bar"></div><div class="bar s"></div><div class="bar m"></div></div></main></body></html>`;
};
const server = http.createServer((req, res) => {
  const host = (req.headers.host || '').split(':')[0];
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(page(host, new URL(req.url, 'http://x').pathname));
}).listen(PORT);
const url = (k) => `http://${k.split('/')[0]}:${PORT}/${k.split('/').slice(1).join('/')}`;

// --- a real window with the extension
const ext = path.resolve('dist');
// Vertical tabs (Chrome 156+), the layout TabSage suggests: written into the new profile before launch.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-shots-'));
fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({
  vertical_tabs: { enabled: true, enabled_first_time: true, uncollapsed_width: 250 },
}));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false, channel: 'chromium', viewport: null,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--enable-features=VerticalTabs',
    '--window-position=0,40', '--window-size=1280,800', '--hide-crash-restore-bubble'],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = sw.url().split('/')[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1500);
for (const p of ctx.pages()) if (!p.url().startsWith('http')) await p.close().catch(() => {}); // the onboarding tab opened on install

// Chrome's tab APIs are driven from the extension's service worker, so no helper tab is photographed.
const api = (fn, arg) => sw.evaluate(fn, arg);
// The profile is saved through TabSage itself, from a short-lived extension page.
const helper = await ctx.newPage();
await helper.goto(`chrome-extension://${id}/options.html`);
const bg = (type, payload = {}) => helper.evaluate(([type, payload]) => chrome.runtime.sendMessage({ target: 'background', type, ...payload }), [type, payload]);
await bg('saveProfile', { profile: {
  company: 'Northwind', companyDomains: ['northwind.localhost'], work: 'an engineering lead on billing and payroll',
  projects: ['Atlas', 'Payroll'], style: 'specific-work', categories: ['Travel', 'Recipes'],
} });
await helper.close();

// open the sample pages, then use them a little so Recent and Most used have something to show
const tabs = {};
for (const k of Object.keys(PAGES)) {
  const p = await ctx.newPage();
  await p.goto(url(k));
  tabs[k] = p;
}
const tabId = (k) => api((u) => chrome.tabs.query({}).then((ts) => ts.find((t) => t.url === u)?.id), url(k));
const activate = async (k) => api((id) => chrome.tabs.update(id, { active: true }), await tabId(k));
for (const k of ['dailybrief.localhost/today', 'people.northwind.localhost/priya', 'wiki.northwind.localhost/payroll/runbook', 'simmer.localhost/ramen',
  'tracker.northwind.localhost/ATLAS-157', 'wiki.northwind.localhost/atlas/architecture', 'tracker.northwind.localhost/ATLAS-142']) {
  for (let i = 0; i < 3; i++) { await activate(k); await wait(250); }
}

// close whatever Chrome opened by itself (its new-tab page), so only the sample pages and TabSage's
// Recent tab show
await api((port) => chrome.tabs.query({}).then((ts) => {
  const keep = (u) => u.includes(`:${port}/`) || u.endsWith('/recent.html');
  const extra = ts.filter((t) => !keep(t.url || t.pendingUrl || '')).map((t) => t.id);
  return extra.length && chrome.tabs.remove(extra);
}), PORT);
// groups, titled and coloured as TabSage titles them. An ungrouped tab is active meanwhile: TabSage
// asks "Why?" when you move the tab you are looking at, and these moves are not yours.
await activate('dailybrief.localhost/today');
const GROUPS = [
  ['Northwind · Atlas', 'blue', ['tracker.northwind.localhost/ATLAS-142', 'tracker.northwind.localhost/ATLAS-157', 'wiki.northwind.localhost/atlas/architecture']],
  ['Northwind · Payroll', 'green', ['wiki.northwind.localhost/payroll/runbook', 'tracker.northwind.localhost/PAY-88']],
  ['Northwind', 'purple', ['people.northwind.localhost/priya', 'wiki.northwind.localhost/handbook/leave']],
  ['Travel', 'yellow', ['skyfare.localhost/kyoto', 'stayfinder.localhost/gion']],
  ['Recipes', 'orange', ['simmer.localhost/ramen', 'simmer.localhost/dumplings']],
];
for (const [title, color, keys] of GROUPS) {
  const ids = [];
  for (const k of keys) ids.push(await tabId(k));
  await api(async ([ids, title, color]) => {
    const gid = await chrome.tabs.group({ tabIds: ids });
    await chrome.tabGroups.update(gid, { title, color });
    await chrome.tabGroups.move(gid, { index: -1 });
  }, [ids, title, color]);
}
await api(async (id) => { await chrome.tabs.update(id, { pinned: true }); }, await tabId('dailybrief.localhost/today'));

async function capture(name) {
  await wait(900);
  const s = await ctx.newCDPSession(tabs['tracker.northwind.localhost/ATLAS-142']);
  const { windowId } = await s.send('Browser.getWindowForTarget');
  const { bounds: b } = await s.send('Browser.getWindowBounds', { windowId });
  const file = path.join(OUT, `${name}.png`);
  execFileSync('screencapture', ['-x', '-o', `-R${b.left},${b.top},${b.width},${b.height}`, file]);
  execFileSync('sips', ['-z', '800', '1280', file], { stdio: 'ignore' });
  console.log('wrote', path.relative(process.cwd(), file));
}

// 1. the tab groups, down the side
const mainWindow = await api((u) => chrome.tabs.query({}).then((ts) => ts.find((t) => t.url === u).windowId), url('tracker.northwind.localhost/ATLAS-142'));
const inMain = async (file) => {
  const next = ctx.waitForEvent('page');
  await api(([w, u]) => chrome.tabs.create({ windowId: w, url: u, active: true }), [mainWindow, `chrome-extension://${id}/${file}`]);
  const p = await next;
  await p.waitForLoadState();
  return p;
};
await activate('tracker.northwind.localhost/ATLAS-142');
await capture('screenshot-1-groups');

// 2. TabSage's Recent tab, pinned first: the tab you were on is ready, one Enter away
const recentTab = await api(() => chrome.tabs.query({}).then((ts) => ts.find((t) => (t.url || '').endsWith('/recent.html'))?.id));
await api((id) => chrome.tabs.update(id, { active: true }), recentTab);
await wait(800);
await capture('screenshot-2-recent-tab');
await activate('tracker.northwind.localhost/ATLAS-142');

// 3. the toolbar menu, which opens on your recent and most-used tabs
await activate('wiki.northwind.localhost/atlas/architecture');
await wait(300);
await activate('tracker.northwind.localhost/ATLAS-142');
// Chrome only shows the popup for the focused window, and focus can take a moment to arrive
let opened = '';
for (let i = 0; i < 6 && opened !== 'ok'; i++) {
  opened = await api(async (w) => {
    await chrome.windows.update(w, { focused: true });
    return chrome.action.openPopup({ windowId: w }).then(() => 'ok', (e) => e.message);
  }, mainWindow);
  if (opened !== 'ok') await wait(500);
}
if (opened !== 'ok') throw new Error(`could not open the toolbar menu: ${opened}`);
await wait(1200);
await capture('screenshot-3-menu');


// 4. the "Why?" card: move a tab into another group by hand
await activate('wiki.northwind.localhost/handbook/leave');
await wait(400);
await api(async ([id, title]) => {
  const g = (await chrome.tabGroups.query({ title }))[0];
  await chrome.tabs.group({ tabIds: [id], groupId: g.id });
}, [await tabId('wiki.northwind.localhost/handbook/leave'), 'Northwind · Payroll']);
await wait(1500);
await capture('screenshot-4-why-card');

// 5. onboarding, on the projects step with answers filled in
const onboard = await inMain('onboarding.html');
await onboard.fill('#company', 'Northwind');
await onboard.click('#next');
await onboard.fill('#work', 'an engineering lead on billing and payroll');
await onboard.click('#next');
await onboard.fill('#projects', 'Atlas\nPayroll');
await capture('screenshot-5-onboarding');

await onboard.close();


await ctx.close();
server.close();
