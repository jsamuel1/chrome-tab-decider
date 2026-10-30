// The engine (offscreen document) must stay open while work is in flight, and only unload once idle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivity } from '../src/offscreen/activity.js';
import { modelError } from '../src/engine/models.js';
import { progressText } from '../src/lib/ui-common.js';

test('activity reports busy while a request runs, then idle time since it finished', async () => {
  let t = 1000;
  const a = createActivity(() => t);
  let release;
  const job = a.run(() => new Promise((r) => (release = r)));
  t += 30 * 60000; // a 30-minute download
  assert.deepEqual(a.idle(), { busy: 1, idleMs: 0 });
  release('done');
  assert.equal(await job, 'done');
  t += 5000;
  assert.deepEqual(a.idle(), { busy: 0, idleMs: 5000 });
});

test('activity counts a failed request as finished', async () => {
  let t = 0;
  const a = createActivity(() => t);
  await assert.rejects(a.run(async () => { throw new Error('boom'); }), /boom/);
  t += 10;
  assert.deepEqual(a.idle(), { busy: 0, idleMs: 10 });
});

function fakeChrome({ open = true, idle }) {
  const log = { closed: 0, asked: 0 };
  globalThis.chrome = {
    runtime: {
      getURL: (p) => `chrome-extension://id/${p}`,
      getContexts: async () => (open ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []),
      sendMessage: async (msg) => {
        assert.deepEqual(msg, { target: 'offscreen', type: 'engine.idle' });
        log.asked++;
        return { ok: true, result: idle };
      },
    },
    offscreen: { closeDocument: async () => { log.closed++; } },
  };
  return log;
}

const { unloadIfIdle } = await import('../src/lib/ai.js');

test('unloadIfIdle keeps the engine open while a download is in flight', async () => {
  const log = fakeChrome({ idle: { busy: 1, idleMs: 0 } });
  assert.equal(await unloadIfIdle(10), false);
  assert.equal(log.closed, 0);
});

test('unloadIfIdle keeps the engine open until the idle time passes', async () => {
  const log = fakeChrome({ idle: { busy: 0, idleMs: 9 * 60000 } });
  assert.equal(await unloadIfIdle(10), false);
  assert.equal(log.closed, 0);
});

test('unloadIfIdle closes an engine idle for longer than the setting', async () => {
  const log = fakeChrome({ idle: { busy: 0, idleMs: 11 * 60000 } });
  assert.equal(await unloadIfIdle(10), true);
  assert.equal(log.closed, 1);
});

test('unloadIfIdle does not start an engine just to ask', async () => {
  const log = fakeChrome({ open: false, idle: { busy: 0, idleMs: 1e9 } });
  assert.equal(await unloadIfIdle(10), false);
  assert.equal(log.asked, 0);
});

test('modelError flags an unfinished custom model, so nothing tries to download it', () => {
  assert.equal(modelError({ model: 'custom', customModel: { repo: '', modelFile: '' } }), 'Custom model needs a repo and model file');
  assert.equal(modelError({ model: 'custom', customModel: { repo: 'a/b', modelFile: 'm.onnx' } }), null);
  assert.equal(modelError({ model: 'decider-v1-2610-q4f16' }), null);
});

test('progressText shows file, bytes and overall share', () => {
  assert.equal(
    progressText({ file: 'onnx/model_q4f16.onnx_data', loaded: 555_000_000, total: 1_100_000_000, overall: 0.5 }),
    'Downloading onnx/model_q4f16.onnx_data — 555 MB / 1.10 GB (50% overall)'
  );
  assert.equal(progressText({ file: 'session', stage: 'compiling', overall: 1 }), 'Creating WebGPU session…');
});
