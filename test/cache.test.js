// fetchCached must share one download per URL: a file only counts as cached once cache.put has
// consumed the whole stream, so a second caller arriving mid-download would otherwise start over.
import test from 'node:test';
import assert from 'node:assert/strict';

class FakeCache {
  constructor() { this.entries = new Map(); }
  async match(url) {
    const e = this.entries.get(url);
    return e && new Response(e.bytes, { headers: e.headers });
  }
  async put(url, res) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    this.entries.set(url, { bytes, headers: res.headers });
  }
  async delete(url) { return this.entries.delete(url); }
  async keys() { return [...this.entries.keys()].map((url) => ({ url })); }
}

const store = new Map();
globalThis.caches = {
  async open(name) {
    if (!store.has(name)) store.set(name, new FakeCache());
    return store.get(name);
  },
  async delete(name) { return store.delete(name); },
};

/** A fetch whose body the test feeds by hand, so downloads stay in flight until released. */
function controlledFetch(size) {
  const calls = [];
  globalThis.fetch = async (url) => {
    let ctrl;
    const body = new ReadableStream({ start: (c) => (ctrl = c) });
    const call = {
      url,
      send(n) { ctrl.enqueue(new Uint8Array(n).fill(7)); },
      end() { ctrl.close(); },
      fail(e) { ctrl.error(e); },
    };
    calls.push(call);
    return new Response(body, { headers: { 'content-length': String(size) } });
  };
  return calls;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const { fetchCached, isCached } = await import('../src/engine/cache.js');

test('a second caller joins the download in flight instead of starting another', { timeout: 2000 }, async () => {
  const calls = controlledFetch(1000);
  const url = 'https://huggingface.co/x/resolve/main/a.onnx_data';
  const seenA = [];
  const seenB = [];
  const a = fetchCached(url, (l, t) => seenA.push([l, t]));
  await tick();
  calls[0].send(400);
  await tick();
  const b = fetchCached(url, (l, t) => seenB.push([l, t]));
  await tick();
  calls[0].send(600);
  calls[0].end();
  const [ra, rb] = await Promise.all([a, b]);

  assert.equal(calls.length, 1);
  assert.equal((await ra.arrayBuffer()).byteLength, 1000);
  assert.equal((await rb.arrayBuffer()).byteLength, 1000);
  assert.deepEqual(seenB.at(-1), [1000, 1000]);
  assert.ok(await isCached(url));
});

test('a later call is served from the cache without fetching', { timeout: 2000 }, async () => {
  const calls = controlledFetch(10);
  const url = 'https://huggingface.co/x/resolve/main/b.json';
  const first = fetchCached(url);
  await tick();
  calls[0].send(10);
  calls[0].end();
  await first;
  await fetchCached(url);
  assert.equal(calls.length, 1);
});

test('a failed download rejects every waiter, and the next call retries', { timeout: 2000 }, async () => {
  const calls = controlledFetch(100);
  const url = 'https://huggingface.co/x/resolve/main/c.onnx';
  const a = fetchCached(url);
  await tick();
  const b = fetchCached(url);
  await tick();
  calls[0].send(50);
  calls[0].end();
  await assert.rejects(a, /Incomplete download/);
  await assert.rejects(b, /Incomplete download/);
  assert.equal(await isCached(url), false);

  const c = fetchCached(url);
  await tick();
  assert.equal(calls.length, 2);
  calls[1].send(100);
  calls[1].end();
  assert.equal((await (await c).arrayBuffer()).byteLength, 100);
});
