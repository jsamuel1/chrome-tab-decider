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

test('a status check does not count as using the engine, so it cannot keep an idle model loaded', async () => {
  const { handle } = await import('../src/offscreen/activity.js');
  let t = 0;
  const a = createActivity(() => t);
  await handle(a, 'decider.choice', async () => 'answer');
  t += 11 * 60000;
  assert.equal(await handle(a, 'decider.status', async () => ({ downloaded: true })).then((r) => r.downloaded), true);
  assert.deepEqual(a.idle(), { busy: 0, idleMs: 11 * 60000 }, 'a status check reset the idle clock');
  await handle(a, 'decider.choice', async () => 'answer');
  assert.deepEqual(a.idle(), { busy: 0, idleMs: 0 });
});

test('once the classifier is known to be downloaded, the gate check does not start an unloaded engine', async () => {
  const { classifierReady, deciderStatus } = await import('../src/lib/ai.js');
  const session = {};
  const log = { created: 0, sent: [] };
  let open = true;
  globalThis.chrome = {
    storage: { session: { get: async (k) => ({ [k]: session[k] }), set: async (o) => Object.assign(session, o), remove: async (k) => { delete session[k]; } } },
    runtime: {
      getURL: (p) => `chrome-extension://id/${p}`,
      getContexts: async () => (open ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []),
      sendMessage: async (msg) => {
        log.sent.push(msg.type);
        return { ok: true, result: { downloaded: true, device: 'webgpu' } };
      },
    },
    offscreen: { createDocument: async () => { log.created++; open = true; }, closeDocument: async () => { open = false; } },
  };
  const settings = { model: 'decider-v1-2610-q4f16', device: 'webgpu' };
  assert.equal(await classifierReady(settings), true);
  assert.deepEqual(log.sent, ['decider.status']);

  open = false; // unloaded after being idle
  assert.equal(await classifierReady(settings), true);
  assert.equal((await deciderStatus(settings, { passive: true })).device, 'webgpu');
  assert.equal(log.created, 0, 'a gate check created the engine again');
  assert.deepEqual(log.sent, ['decider.status'], 'a gate check woke the engine');

  // other settings (another model) are asked about afresh
  assert.equal(await classifierReady({ ...settings, model: 'other' }), true);
  assert.equal(log.created, 1);
});
