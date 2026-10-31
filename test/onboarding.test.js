// Onboarding: the profile becomes folders, and suggestions come from the user's own tabs and bookmarks.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://x/${p}` } };
const { saveProfile, onboardingSuggestions, registrableDomain, withoutNames } = await import('../src/lib/onboarding.js');

const fresh = () => ({ categories: {}, profile: {} });

test('saveProfile makes a company folder, a work folder under it per project, and a personal folder per category', () => {
  const st = fresh();
  saveProfile(st, { company: 'Amazon', companyDomains: ['amazon.com'], work: 'architect', projects: ['Acme'], style: 'specific-work', categories: ['Travel'] });
  const cats = Object.values(st.categories);
  assert.equal(cats.length, 3);
  const company = cats.find((c) => c.name === 'Amazon');
  const acme = cats.find((c) => c.name === 'Acme');
  const travel = cats.find((c) => c.name === 'Travel');
  assert.equal(company.kind, 'company');
  assert.equal(company.parentId, null);
  assert.equal(acme.kind, 'work');
  assert.equal(acme.parentId, company.id);
  assert.equal(travel.kind, 'personal');
  assert.equal(travel.parentId, null);
  assert.equal(st.profile.onboarded, true);
  assert.equal(st.profile.company, 'Amazon');
  assert.deepEqual(st.profile.projects, ['Acme']);
});

test('saveProfile run again keeps one folder per name and trims blanks', () => {
  const st = fresh();
  saveProfile(st, { company: 'Amazon', projects: ['Acme', ' '], categories: ['Travel'] });
  saveProfile(st, { company: ' Amazon ', projects: ['acme', 'Payroll'], categories: ['Travel', ''] });
  const names = Object.values(st.categories).map((c) => c.name).sort();
  assert.deepEqual(names, ['Acme', 'Amazon', 'Payroll', 'Travel']);
  const company = Object.values(st.categories).find((c) => c.kind === 'company');
  assert.ok(Object.values(st.categories).filter((c) => c.kind === 'work').every((c) => c.parentId === company.id));
  assert.deepEqual(st.profile.projects, ['acme', 'Payroll']);
});

test('saveProfile with no company files projects as work with no parent', () => {
  const st = fresh();
  saveProfile(st, { company: '', projects: ['Acme'], categories: [] });
  const [acme] = Object.values(st.categories);
  assert.equal(acme.kind, 'work');
  assert.equal(acme.parentId, null);
});

test('registrableDomain keeps the site a company owns', () => {
  assert.equal(registrableDomain('https://w.amazon.com/x'), 'amazon.com');
  assert.equal(registrableDomain('https://shop.example.co.uk/'), 'example.co.uk');
  assert.equal(registrableDomain('https://www.bbc.com.au/'), 'bbc.com.au');
  assert.equal(registrableDomain('http://localhost:3000/'), 'localhost');
  assert.equal(registrableDomain('http://192.168.1.4/'), '');
  assert.equal(registrableDomain('chrome://newtab/'), '');
});

test('onboardingSuggestions: domains most frequent first; categories from bookmarks then tab terms, de-duplicated, at most 15', () => {
  const tabs = [
    { url: 'https://w.amazon.com/a', title: 'Acme quarterly review' },
    { url: 'https://code.amazon.com/b', title: 'Acme pipeline' },
    { url: 'https://amazon.com/c', title: 'Kyoto hotels' },
    { url: 'https://booking.com/d', title: 'Kyoto ryokan' },
    { url: 'https://news.example.org/e', title: 'Weather' },
    { url: 'https://bikes.example.net/f', title: 'Bike repair' },
    { url: 'chrome://settings', title: 'Settings' },
  ];
  const folders = [{ name: 'Travel' }, { name: 'travel' }, { name: 'House' }];
  const r = onboardingSuggestions(tabs, folders);
  assert.deepEqual(r.domains.slice(0, 1), ['amazon.com']);
  assert.ok(!r.domains.includes(''));
  assert.deepEqual(r.categories.slice(0, 2), ['Travel', 'House']);
  assert.ok(r.categories.includes('Acme'), r.categories.join(', '));
  assert.ok(r.categories.includes('Kyoto'), r.categories.join(', '));

  const many = Array.from({ length: 30 }, (_, i) => ({ name: `Folder ${i}` }));
  assert.equal(onboardingSuggestions(tabs, many).categories.length, 15);
});

test('saveProfile with a new company name renames the company folder instead of adding a second', () => {
  const st = fresh();
  saveProfile(st, { company: 'Amazon', projects: ['Acme'] });
  const id = Object.values(st.categories).find((c) => c.kind === 'company').id;
  saveProfile(st, { company: 'AWS', projects: ['Acme'] });
  const companies = Object.values(st.categories).filter((c) => c.kind === 'company');
  assert.deepEqual(companies.map((c) => [c.id, c.name]), [[id, 'AWS']]);
  assert.equal(Object.values(st.categories).find((c) => c.name === 'Acme').parentId, id);
});

test('saveProfile leaves out a category named after the company or a project, so neither becomes personal', () => {
  // onboardingSuggestions offers these names: bookmark folders carry the employer's name, and the company's tabs dominate the terms.
  const tabs = [
    { url: 'https://w.amazon.com/a', title: 'Acme quarterly review - Amazon Wiki' },
    { url: 'https://code.amazon.com/b', title: 'Acme pipeline - Amazon Code' },
    { url: 'https://amazon.com/c', title: 'Kyoto hotels' },
    { url: 'https://booking.com/d', title: 'Kyoto ryokan' },
    { url: 'https://x.org/e', title: 'Weather' },
  ];
  const offered = onboardingSuggestions(tabs, [{ name: 'Amazon' }]).categories;
  assert.ok(offered.includes('Amazon') && offered.includes('Acme'), offered.join(', '));

  const st = fresh();
  saveProfile(st, { company: 'Amazon', projects: ['Acme', 'amazon'], categories: ['acme', 'AMAZON', 'Kyoto'] });
  const byName = Object.fromEntries(Object.values(st.categories).map((c) => [c.name, c]));
  assert.deepEqual(Object.keys(byName).sort(), ['Acme', 'Amazon', 'Kyoto']);
  assert.equal(byName.Amazon.kind, 'company');
  assert.equal(byName.Amazon.parentId, null);
  assert.equal(byName.Acme.kind, 'work');
  assert.equal(byName.Acme.parentId, byName.Amazon.id);
  assert.equal(byName.Kyoto.kind, 'personal');
  assert.deepEqual(st.profile.projects, ['Acme']);
  assert.deepEqual(st.profile.categories, ['Kyoto']);
});

test('withoutNames drops names already taken, ignoring case and blanks', () => {
  assert.deepEqual(withoutNames([' Acme ', 'Travel', 'amazon', ''], ['Amazon', ' acme', '']), ['Travel']);
  assert.deepEqual(withoutNames(['Travel'], []), ['Travel']);
});
