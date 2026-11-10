import assert from 'node:assert/strict';
import { callAgent } from '../src/agent-call.ts';

const accept = (json: unknown) => {
  const tasks = (json as { tasks?: string[] }).tasks;
  return tasks?.length ? tasks : undefined;
};
const respond = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch;
const call = (fetchImpl: typeof fetch, timeoutMs = 500) => callAgent('/api/x', { a: 1 }, accept, { timeoutMs, fetchImpl });

assert.deepEqual(await call(respond(200, '{"tasks":["a","b"]}')), ['a', 'b'], 'success passes the parsed value through');
assert.equal(await call(respond(429, '{"error":"Rate limited"}')), undefined, '429 falls back');
assert.equal(await call(respond(503, '{"error":"Agent unavailable"}')), undefined, '5xx falls back');
assert.equal(await call(respond(200, '<html>proxy error</html>')), undefined, 'malformed body falls back');
assert.equal(await call(respond(200, '{"tasks":[]}')), undefined, 'empty result falls back');
assert.equal(await call((async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch), undefined, 'offline falls back');

// A server that never answers is cut off by the timeout, not left hanging.
const hang = ((_url: string, init: RequestInit) =>
  new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch;
const started = Date.now();
assert.equal(await call(hang, 150), undefined, 'timeout falls back');
assert.ok(Date.now() - started < 1000, 'timeout fires promptly');

// The request is a JSON POST carrying the body.
let seen: RequestInit | undefined;
await callAgent('/api/x', { text: 'hi' }, accept, {
  timeoutMs: 500,
  fetchImpl: (async (_url: string, init: RequestInit) => { seen = init; return new Response('{"tasks":["t"]}'); }) as unknown as typeof fetch,
});
assert.equal(seen?.method, 'POST');
assert.equal(seen?.body, '{"text":"hi"}');

console.log('agent fallback: all assertions passed');
