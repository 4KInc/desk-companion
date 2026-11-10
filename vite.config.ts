/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import type { IncomingMessage } from 'node:http';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Serves /api/brain-dump during `npm run dev` with the same handler the Vercel
 * function uses (server/brain-dump.ts). Reads ANTHROPIC_* from .env or the shell.
 */
function brainDumpDevApi(): Plugin {
  const readBody = async (req: IncomingMessage): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  };
  return {
    name: 'desk-companion-brain-dump-api',
    configureServer(server) {
      Object.assign(process.env, loadEnv(server.config.mode, process.cwd(), 'ANTHROPIC_'));
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (!['/api/brain-dump', '/api/split-task', '/api/calendar', '/api/delegate', '/api/__fault', '/api/diagnostics'].includes(path)) {
          return next();
        }
        const body = req.method === 'POST' ? await readBody(req) : undefined;
        if (path === '/api/diagnostics') {
          // Dev only: print ?playtest=1 samples to the dev log (production whitelists and logs them).
          console.log(`[playtest] ${body ? new TextDecoder().decode(body) : ''}`);
          res.statusCode = 204;
          res.end();
          return;
        }
        const fault = await server.ssrLoadModule('/server/fault.ts');
        const asRequest = () =>
          new Request(`http://localhost${path}`, {
            method: req.method,
            headers: { 'content-type': 'application/json' },
            body: body ? new Uint8Array(body) : undefined,
          });
        if (path === '/api/__fault') {
          const response: Response = await fault.handleFaultControl(asRequest());
          res.statusCode = response.status;
          res.setHeader('content-type', 'application/json');
          res.end(await response.text());
          return;
        }
        if (fault.AGENT_PATHS.includes(path)) {
          const injected = await fault.faultResponse();
          if (injected === 'offline') {
            req.socket.destroy();
            return;
          }
          if (injected) {
            res.statusCode = injected.status;
            res.setHeader('content-type', 'application/json');
            res.end(await injected.text());
            return;
          }
        }
        const api = await server.ssrLoadModule('/server/brain-dump.ts');
        const calendar = await server.ssrLoadModule('/server/calendar.ts');
        const handler =
          path === '/api/split-task'
            ? api.handleSplitRequest
            : path === '/api/calendar'
              ? calendar.handleCalendarRequest
              : path === '/api/delegate'
                ? api.handleDelegateRequest
                : api.handleBrainDumpRequest;
        const response: Response = await handler(
          new Request(`http://localhost${path}`, {
            method: req.method,
            headers: { 'content-type': 'application/json' },
            body: body ? new Uint8Array(body) : undefined,
          }),
        );
        res.statusCode = response.status;
        res.setHeader('content-type', 'application/json');
        res.end(await response.text());
      });
    },
  };
}

export default defineConfig({
  plugins: [iwsdkDev(), brainDumpDevApi()],
  server: { host: '0.0.0.0', port: 8081, open: false },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (three@0.185 vs app super-three@0.181). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
