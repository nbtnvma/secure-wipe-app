import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Strict CSP for the packaged app (the dev server needs inline scripts for React Refresh). */
function csp(): Plugin {
  return {
    name: 'securewipe-csp',
    transformIndexHtml(html, ctx) {
      const policy = ctx.server
        ? ''
        : `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`;
      return html.replace('<!--CSP-->', policy);
    },
  };
}

export default defineConfig({
  root: r('./src/renderer'),
  base: './',
  plugins: [react(), tailwindcss(), csp()],
  resolve: {
    alias: {
      '@shared': r('./src/shared'),
      '@': r('./src/renderer'),
    },
  },
  server: { port: 5199, strictPort: true },
  build: {
    outDir: r('./dist/renderer'),
    emptyOutDir: true,
    target: 'chrome140',
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 0,
  },
});
