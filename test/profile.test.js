import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = {
  runtime: { getURL: (p) => `chrome-extension://x/${p}` },
  bookmarks: {
    getTree: async () => [{
      id: '0', title: '', children: [
        { id: '1', title: 'Bookmarks Bar', children: [
          { id: '10', title: 'House', children: [
            { id: '100', title: 'Roof', url: 'https://example.com/roof#top' },
          ] },
          { id: '11', title: 'Loose', url: 'https://example.com/loose' },
        ] },
        { id: '2', title: 'Other bookmarks', children: [] },
      ],
    }],
  },
};
const { profileText } = await import('../src/lib/profile.js');
const { bookmarkFolders, bookmarkHint } = await import('../src/lib/bookmarks.js');

const base = {
  company: 'Amazon', companyDomains: ['amazon.com', 'a2z.com'], work: 'a solutions architect',
  projects: ['Acme', 'Payroll'], style: 'specific-work', categories: [], onboarded: true,
};

test('profileText mentions the company and both domains', () => {
  const t = profileText(base);
  assert.match(t, /Amazon/);
  assert.match(t, /amazon\.com/);
  assert.match(t, /a2z\.com/);
  assert.match(t, /Current projects: Acme, Payroll\./);
});

test('profileText stays within 600 characters with 30 projects', () => {
  const projects = Array.from({ length: 30 }, (_, i) => `Customer number ${i}`);
  const t = profileText({ ...base, projects });
  assert.ok(t.length <= 600, String(t.length));
  assert.match(t, /Amazon/);
});

test('profileText is empty for an empty, not onboarded profile', () => {
  assert.equal(profileText({ company: '', companyDomains: [], work: '', projects: [], categories: [], onboarded: false }), '');
});

test('bookmarkHint gives the folder a page is bookmarked in', async () => {
  const folders = await bookmarkFolders();
  assert.equal(bookmarkHint('https://example.com/roof', folders), 'House');
  assert.equal(bookmarkHint('https://example.com/loose', folders), null);
  assert.equal(bookmarkHint('https://example.com/none', folders), null);
});
