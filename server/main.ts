import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { handleBrainDumpRequest, handleSplitRequest } from './brain-dump.js';

/**
 * Production server (Cloud Run): serves the Vite build and the brain-dump API
 * from one HTTPS origin. Cloud Run terminates TLS and sets PORT.
 */
const PORT = Number(process.env.PORT ?? 8080);
const ROOT = resolve(process.env.STATIC_DIR ?? 'dist');
const MAX_BODY_BYTES = 16 * 1024;
/** The API spends the owner's Anthropic credits: cap requests per client address... */
const RATE_LIMIT = { max: 20, windowMs: 10 * 60 * 1000 };
/** ...and in total per instance per day (Cloud Run runs at most 2 instances). */
const DAILY_CAP = Number(process.env.BRAIN_DUMP_DAILY_CAP ?? 300);

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
let dailyCount = 0;
let dailyResetAt = Date.now() + 24 * 60 * 60 * 1000;

function underDailyCap(): boolean {
  if (Date.now() > dailyResetAt) {
    dailyCount = 0;
    dailyResetAt = Date.now() + 24 * 60 * 60 * 1000;
  }
  if (dailyCount >= DAILY_CAP) return false;
  dailyCount++;
  return true;
}

/**
 * The real client address. Cloud Run's front end appends the connecting IP as the
 * LAST X-Forwarded-For entry; anything before it was supplied by the client and
 * can be forged, so it must never key the rate limiter.
 */
function clientAddress(req: IncomingMessage): string {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return forwarded[forwarded.length - 1] ?? req.socket.remoteAddress ?? 'unknown';
}

/** Only the app's own page may call the API from a browser (blocks hot-linking from other sites). */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

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

async function readBody(req: IncomingMessage): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk as Buffer);
  }
  // Copy into a fresh ArrayBuffer-backed array: a valid fetch body under strict DOM typings.
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

function send(res: ServerResponse, status: number, body: string, type = 'application/json'): void {
  res.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff' });
  res.end(body);
}

async function api(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  if (req.method === 'POST' && !sameOrigin(req)) {
    send(res, 403, JSON.stringify({ error: 'Forbidden' }));
    return;
  }
  if (req.method === 'POST' && !allowed(clientAddress(req))) {
    send(res, 429, JSON.stringify({ error: 'Too many brain dumps, try again in a few minutes' }));
    return;
  }
  if (req.method === 'POST' && !underDailyCap()) {
    send(res, 429, JSON.stringify({ error: 'The agent is resting for today. Add tasks by hand' }));
    return;
  }
  const body = req.method === 'POST' ? await readBody(req) : undefined;
  if (req.method === 'POST' && !body) {
    send(res, 413, JSON.stringify({ error: 'Request too large' }));
    return;
  }
  const handler = pathname === '/api/split-task' ? handleSplitRequest : handleBrainDumpRequest;
  const response = await handler(
    new Request(`http://localhost${pathname}`, {
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
  const isApi = pathname === '/api/brain-dump' || pathname === '/api/split-task';
  const handled = isApi ? api(req, res, pathname) : staticFile(req, res, pathname);
  handled.catch((error) => {
    console.error('[server]', error);
    if (!res.headersSent) send(res, 500, JSON.stringify({ error: 'Server error' }));
  });
}).listen(PORT, () => console.log(`Desk Companion on :${PORT}, serving ${ROOT}`));
