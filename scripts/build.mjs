// Bundles the extension into dist/ (load it via chrome://extensions → Load unpacked → dist).
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/ort', { recursive: true });
cpSync('static', 'dist', { recursive: true });

// Version: package.json major.minor + CI build number (Chrome needs 1-4 dot-separated integers).
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
const [maj, min] = pkg.version.split('.');
manifest.version = `${maj}.${min}.${process.env.BUILD_NUMBER || 0}`;
writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2));

// ONNX Runtime Web WebGPU build loads this wasm at runtime from the extension package.
for (const f of ['ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.asyncify.mjs']) {
  copyFileSync(`node_modules/onnxruntime-web/dist/${f}`, `dist/ort/${f}`);
}

const opts = {
  entryPoints: {
    background: 'src/background.js',
    offscreen: 'src/offscreen/offscreen.js',
    popup: 'src/popup/popup.js',
    options: 'src/options/options.js',
    lazy: 'src/lazy/lazy.js',
  },
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  target: 'chrome138',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
} else {
  await esbuild.build(opts);
}
