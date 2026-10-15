// Production build: bundles main + preload with esbuild, renderer with Vite.
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const watch = process.argv.includes('--watch');

export const mainConfigs = [
  {
    entryPoints: ['src/main/main.ts'],
    outfile: 'dist/main/main.js',
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  },
  {
    // Sandboxed preload: must be a single file that only requires 'electron'.
    entryPoints: ['src/preload/preload.ts'],
    outfile: 'dist/preload/preload.js',
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  },
].map((c) => ({
  ...c,
  absWorkingDir: root,
  bundle: true,
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  legalComments: 'none',
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
}));

async function main() {
  rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
  await Promise.all(mainConfigs.map((c) => esbuild(c)));
  await viteBuild({ configFile: fileURLToPath(new URL('../vite.config.mts', import.meta.url)), logLevel: 'warn' });
  console.log('Build complete -> dist/');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
