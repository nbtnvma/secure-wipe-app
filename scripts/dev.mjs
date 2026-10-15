// Dev runner: Vite dev server for the renderer, esbuild watch for main/preload, Electron restart on change.
import { context } from 'esbuild';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mainConfigs } from './build.mjs';

const require = createRequire(import.meta.url);
const electronBin = require('electron');
const root = fileURLToPath(new URL('..', import.meta.url));

const server = await createServer({ configFile: fileURLToPath(new URL('../vite.config.mts', import.meta.url)) });
await server.listen();
const url = server.resolvedUrls.local[0];

let child = null;
let restarting = false;
function startElectron() {
  // Editors such as VS Code export ELECTRON_RUN_AS_NODE to child processes, which would start Electron as plain Node.
  const env = { ...process.env, VITE_DEV_SERVER_URL: url, SECUREWIPE_DEV: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electronBin, ['.'], { cwd: root, stdio: 'inherit', env });
  child.on('exit', () => {
    if (!restarting) {
      server.close();
      process.exit(0);
    }
  });
}

let first = true;
const restartPlugin = {
  name: 'restart-electron',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) return;
      if (first) return;
      if (child) {
        restarting = true;
        child.once('exit', () => {
          restarting = false;
          startElectron();
        });
        child.kill();
      }
    });
  },
};

const ctxs = await Promise.all(
  mainConfigs.map((c) => context({ ...c, sourcemap: 'inline', minify: false, plugins: [restartPlugin] })),
);
await Promise.all(ctxs.map((c) => c.rebuild()));
await Promise.all(ctxs.map((c) => c.watch()));
first = false;
startElectron();
