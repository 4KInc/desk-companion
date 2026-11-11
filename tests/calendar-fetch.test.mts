import assert from 'node:assert/strict';
import { CalendarFetchError, fetchCalendarText, isPrivateAddress } from '../server/calendar.ts';

const ICS = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';
const publicDns = async () => ['142.250.1.1'];

/** A fake fetch that answers from a route table and records every URL it was asked for. */
function fakeFetch(routes: Record<string, () => Response>) {
  const asked: string[] = [];
  const impl = (async (input: URL | string) => {
    const url = String(input);
    asked.push(url);
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route();
  }) as typeof fetch;
  return { impl, asked };
}
const redirect = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });
const ok = (body: string, headers: Record<string, string> = {}) => () => new Response(body, { status: 200, headers });

async function rejects(promise: Promise<unknown>, pattern: RegExp, label: string) {
  await assert.rejects(promise, (error) => error instanceof CalendarFetchError && pattern.test(error.message), label);
}

const start = new URL('https://calendar.google.com/a.ics');

// A normal allowed redirect still works.
{
  const f = fakeFetch({
    'https://calendar.google.com/a.ics': redirect('https://calendar.google.com/b.ics'),
    'https://calendar.google.com/b.ics': ok(ICS),
  });
  assert.equal(await fetchCalendarText(start, { fetch: f.impl, lookup: publicDns }), ICS);
}

// Redirect to a host outside the allowlist is refused before it is fetched.
{
  const f = fakeFetch({ 'https://calendar.google.com/a.ics': redirect('https://evil.example/x') });
  await rejects(fetchCalendarText(start, { fetch: f.impl, lookup: publicDns }), /redirected to evil.example/, 'disallowed host');
  assert.deepEqual(f.asked, ['https://calendar.google.com/a.ics'], 'never fetched the disallowed host');
}

// Downgrade to http is refused.
{
  const f = fakeFetch({ 'https://calendar.google.com/a.ics': redirect('http://calendar.google.com/a.ics') });
  await rejects(fetchCalendarText(start, { fetch: f.impl, lookup: publicDns }), /left https/, 'http downgrade');
}

// Redirect to an IP literal (e.g. cloud metadata) is refused.
{
  const f = fakeFetch({ 'https://calendar.google.com/a.ics': redirect('https://169.254.169.254/latest') });
  await rejects(fetchCalendarText(start, { fetch: f.impl, lookup: publicDns }), /IP address/, 'ip literal');
}

// An allowed name that resolves to a private address is refused.
{
  const f = fakeFetch({});
  await rejects(fetchCalendarText(start, { fetch: f.impl, lookup: async () => ['10.0.0.5'] }), /private address/, 'private dns');
  assert.equal(f.asked.length, 0);
}

// Redirect loops stop after three hops.
{
  const f = fakeFetch({ 'https://calendar.google.com/a.ics': redirect('https://calendar.google.com/a.ics') });
  await rejects(fetchCalendarText(start, { fetch: f.impl, lookup: publicDns }), /too many/, 'redirect loop');
  assert.equal(f.asked.length, 4);
}

// Oversized bodies are refused, by header and by streamed size.
{
  const f = fakeFetch({ 'https://calendar.google.com/a.ics': ok(ICS, { 'content-length': String(10 * 1024 * 1024) }) });
  await rejects(fetchCalendarText(start, { fetch: f.impl, lookup: publicDns }), /too large/, 'declared size');
  const big = 'BEGIN:VCALENDAR\r\n' + 'X'.repeat(4 * 1024 * 1024);
  const g = fakeFetch({ 'https://calendar.google.com/a.ics': ok(big) });
  await rejects(fetchCalendarText(start, { fetch: g.impl, lookup: publicDns }), /too large/, 'streamed size');
}

// 429 is marked retryable; a sign-in page is not an iCal file.
{
  const f = fakeFetch({ 'https://calendar.google.com/a.ics': () => new Response('', { status: 429 }) });
  await assert.rejects(fetchCalendarText(start, { fetch: f.impl, lookup: publicDns }), (e) => e instanceof CalendarFetchError && e.retryable);
  const g = fakeFetch({ 'https://calendar.google.com/a.ics': ok('<html>sign in</html>', { 'content-type': 'text/html' }) });
  await rejects(fetchCalendarText(start, { fetch: g.impl, lookup: publicDns }), /not an iCal file/, 'html page');
}

for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
  assert.ok(isPrivateAddress(address), `${address} is private`);
}
for (const address of ['142.250.1.1', '8.8.8.8', '172.32.0.1', '2607:f8b0::1']) assert.ok(!isPrivateAddress(address), `${address} is public`);

console.log('calendar fetch guards: all assertions passed');
