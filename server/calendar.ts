import ICAL from 'ical.js';

/**
 * Today's meetings from a calendar's private iCal link (Google Calendar "Secret
 * address in iCal format", Outlook "Publish calendar" ICS link, iCloud public
 * calendar). Read-only, no sign-in, nothing stored: the link stays on the user's
 * device and is only passed through here to fetch it.
 */

/** Calendar hosts we fetch from. A fixed list keeps the server from being used to probe other hosts. */
const ALLOWED_HOSTS = [
  'calendar.google.com',
  'outlook.office365.com',
  'outlook.office.com',
  'outlook.live.com',
  'icloud.com',
  'calendar.yahoo.com',
  'fastmail.com',
  'calendar.proton.me',
];
const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_OCCURRENCE_STEPS = 5000;
const MAX_EVENTS = 30;

export interface Meeting {
  title: string;
  /** Epoch milliseconds. */
  start: number;
  end: number;
}

function allowedHost(host: string): boolean {
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** Accepts https:// or webcal:// links on known calendar hosts. */
export function normaliseCalendarUrl(raw: string): URL | undefined {
  try {
    const url = new URL(raw.trim().replace(/^webcals?:\/\//i, 'https://'));
    return url.protocol === 'https:' && allowedHost(url.hostname) ? url : undefined;
  } catch {
    return undefined;
  }
}

async function fetchIcs(url: URL): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!allowedHost(new URL(response.url).hostname)) throw new Error('redirected off the allow list');
    if (!response.ok) throw new Error(`calendar returned ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_BYTES) throw new Error('calendar too large');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** Every timed (not all-day), non-cancelled occurrence overlapping [from, to). */
export function meetingsBetween(ics: string, from: number, to: number): Meeting[] {
  const calendar = new ICAL.Component(ICAL.parse(ics));
  for (const zone of calendar.getAllSubcomponents('vtimezone')) {
    ICAL.TimezoneService.register(zone);
  }
  const events = calendar.getAllSubcomponents('vevent');
  const exceptions = new Map<string, ICAL.Component[]>();
  for (const event of events) {
    if (!event.hasProperty('recurrence-id')) continue;
    const uid = String(event.getFirstPropertyValue('uid'));
    exceptions.set(uid, [...(exceptions.get(uid) ?? []), event]);
  }

  const meetings: Meeting[] = [];
  const add = (title: string, status: unknown, start: ICAL.Time, end: ICAL.Time) => {
    if (start.isDate || String(status ?? '').toUpperCase() === 'CANCELLED') return;
    const s = start.toJSDate().getTime();
    const e = end.toJSDate().getTime();
    if (e <= from || s >= to) return;
    meetings.push({ title: title.trim().slice(0, 60) || 'Busy', start: Math.max(s, from), end: Math.min(e, to) });
  };

  for (const component of events) {
    if (component.hasProperty('recurrence-id')) continue; // handled through its master
    const uid = String(component.getFirstPropertyValue('uid'));
    const event = new ICAL.Event(component, { exceptions: exceptions.get(uid) ?? [] });
    if (!event.isRecurring()) {
      add(event.summary ?? '', component.getFirstPropertyValue('status'), event.startDate, event.endDate);
      continue;
    }
    const iterator = event.iterator();
    for (let step = 0, next = iterator.next(); next && step < MAX_OCCURRENCE_STEPS; step++, next = iterator.next()) {
      if (next.toJSDate().getTime() >= to) break;
      const details = event.getOccurrenceDetails(next);
      add(
        details.item.summary ?? '',
        details.item.component.getFirstPropertyValue('status'),
        details.startDate,
        details.endDate,
      );
    }
  }
  return meetings.sort((a, b) => a.start - b.start).slice(0, MAX_EVENTS);
}

/** Web-standard handler: POST { url, from, to } -> { meetings }. */
export async function handleCalendarRequest(request: Request): Promise<Response> {
  if (request.method !== 'POST') return Response.json({ error: 'POST only' }, { status: 405 });
  let body: { url?: unknown; from?: unknown; to?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Expected JSON { url, from, to }' }, { status: 400 });
  }
  const url = typeof body.url === 'string' ? normaliseCalendarUrl(body.url) : undefined;
  const from = Number(body.from);
  const to = Number(body.to);
  if (!url) {
    return Response.json(
      { error: 'Use your calendar\'s private iCal link (Google, Outlook, iCloud, Yahoo, Fastmail or Proton)' },
      { status: 400 },
    );
  }
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 36 * 3600 * 1000) {
    return Response.json({ error: 'Bad day range' }, { status: 400 });
  }
  try {
    return Response.json({ meetings: meetingsBetween(await fetchIcs(url), from, to) });
  } catch (error) {
    // Never log the link or event titles: the link is a secret and titles are personal.
    console.error('[calendar] failed:', error instanceof Error ? error.name : typeof error);
    return Response.json({ error: 'Could not read that calendar' }, { status: 502 });
  }
}
