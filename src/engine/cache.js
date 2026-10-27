// Download model files once into Cache Storage, with progress.

const CACHE = 'tabsage-models-v1';

export async function isCached(url) {
  const c = await caches.open(CACHE);
  return !!(await c.match(url));
}

export async function cachedFiles() {
  const c = await caches.open(CACHE);
  return (await c.keys()).map((r) => r.url);
}

export async function clearModelCache() {
  await caches.delete(CACHE);
}

/**
 * Ensure `url` is cached; returns a Response from the cache.
 * onProgress(loadedBytes, totalBytes) is called while downloading.
 */
export async function fetchCached(url, onProgress = () => {}) {
  const c = await caches.open(CACHE);
  const hit = await c.match(url);
  if (hit) return hit;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let loaded = 0;
  let lastTick = 0;
  const counting = res.body.pipeThrough(
    new TransformStream({
      transform(chunk, ctrl) {
        loaded += chunk.byteLength;
        const now = performance.now();
        if (now - lastTick > 250) {
          lastTick = now;
          onProgress(loaded, total);
        }
        ctrl.enqueue(chunk);
      },
    })
  );
  const headers = new Headers({ 'content-type': res.headers.get('content-type') || 'application/octet-stream' });
  await c.put(url, new Response(counting, { headers }));
  onProgress(loaded, total || loaded);
  // (loaded can exceed total when the server compressed the body; only a short read is an error)
  if (total && loaded < total) {
    await c.delete(url);
    throw new Error(`Incomplete download for ${url} (${loaded}/${total})`);
  }
  return c.match(url);
}

export async function fetchJsonCached(url, onProgress) {
  return (await fetchCached(url, onProgress)).json();
}

export async function fetchBytesCached(url, onProgress) {
  return new Uint8Array(await (await fetchCached(url, onProgress)).arrayBuffer());
}
