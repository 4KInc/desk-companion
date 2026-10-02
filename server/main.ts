import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { handleBrainDumpRequest } from './brain-dump.js';

/**
 * Production server (Cloud Run): serves the Vite build and the brain-dump API
 * from one HTTPS origin. Cloud Run terminates TLS and sets PORT.
 */
const PORT = Number(process.env.PORT ?? 8080);
const ROOT = resolve(process.env.STATIC_DIR ?? 'dist');
const MAX_BODY_BYTES = 16 * 1024;
/** The API spends the owner's Anthropic credits: cap requests per client address. */
const RATE_LIMIT = { max: 20, windowMs: 10 * 60 * 1000 };

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.uikitml': 'text/plain; charset=utf-8',
  '.gltf': 'model/gltf+json',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ktx2': 'image/ktx2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const hits = new Map<string, number[]>();

function allowed(client: string): boolean {
  const now = Date.now();
  const recent = (hits.get(client) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs);
  if (recent.length >= RATE_LIMIT.max) {
    hits.set(client, recent);
    return false;
  }
  recent.push(now);
  hits.set(client, recent);
  if (hits.size > 5000) hits.clear(); // bound memory on a long-lived instance
  return true;
}

async function readBody(req: IncomingMessage): Promise<Uint8Array | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function send(res: ServerResponse, status: number, body: string, type = 'application/json'): void {
  res.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff' });
  res.end(body);
}

async function api(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const client = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown').split(',')[0].trim();
  if (req.method === 'POST' && !allowed(client)) {
    send(res, 429, JSON.stringify({ error: 'Too many brain dumps, try again in a few minutes' }));
    return;
  }
  const body = req.method === 'POST' ? await readBody(req) : undefined;
  if (req.method === 'POST' && !body) {
    send(res, 413, JSON.stringify({ error: 'Request too large' }));
    return;
  }
  const response = await handleBrainDumpRequest(
    new Request('http://localhost/api/brain-dump', {
      method: req.method,
      headers: { 'content-type': 'application/json' },
      body,
    }),
  );
  send(res, response.status, await response.text());
}

async function staticFile(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method not allowed', 'text/plain');
    return;
  }
  let path = normalize(join(ROOT, decodeURIComponent(pathname)));
  if (path !== ROOT && !path.startsWith(ROOT + sep)) {
    send(res, 404, 'Not found', 'text/plain'); // path traversal
    return;
  }
  try {
    if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
    const data = await readFile(path);
    const hashed = pathname.startsWith('/assets/');
    res.writeHead(200, {
      'content-type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'content-length': data.length,
      // Vite fingerprints everything under /assets; the page itself must always revalidate.
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}

createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  const handled = pathname === '/api/brain-dump' ? api(req, res) : staticFile(req, res, pathname);
  handled.catch((error) => {
    console.error('[server]', error);
    if (!res.headersSent) send(res, 500, JSON.stringify({ error: 'Server error' }));
  });
}).listen(PORT, () => console.log(`Desk Companion on :${PORT}, serving ${ROOT}`));
