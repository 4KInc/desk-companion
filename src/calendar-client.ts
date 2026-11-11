/** A calendar event for the plan day, as shown on the desk. */
export interface DayMeeting {
  title: string;
  /** Epoch milliseconds. */
  start: number;
  end: number;
}

/** Local midnight-to-midnight range for a plan day (YYYY-MM-DD). */
function dayRange(day: string): [number, number] {
  const [y, m, d] = day.split('-').map(Number);
  return [new Date(y, m - 1, d).getTime(), new Date(y, m - 1, d + 1).getTime()];
}

/** Today's timed meetings from a private iCal link, via the server (the link never leaves the user's device otherwise). */
export async function fetchMeetings(url: string, day: string): Promise<DayMeeting[]> {
  const [from, to] = dayRange(day);
  const response = await fetch(`${import.meta.env.BASE_URL}api/calendar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url, from, to }),
  });
  const body = (await response.json().catch(() => ({}))) as { meetings?: DayMeeting[]; error?: string };
  if (!response.ok || !Array.isArray(body.meetings)) throw new Error(body.error ?? 'Could not read that calendar');
  return body.meetings;
}

/**
 * A believable meeting-heavy day for judges and demos who don't want to connect a
 * calendar. Always labelled "Sample day" in the app.
 */
export function sampleMeetings(day: string): DayMeeting[] {
  const [start] = dayRange(day);
  const at = (h: number, m: number) => start + (h * 60 + m) * 60 * 1000;
  return [
    { title: 'Team standup', start: at(9, 30), end: at(9, 45) },
    { title: 'Design review', start: at(11, 0), end: at(12, 0) },
    { title: '1:1 with Alex', start: at(13, 30), end: at(14, 0) },
    { title: 'Customer call', start: at(15, 0), end: at(16, 0) },
    { title: 'Sprint planning', start: at(16, 30), end: at(17, 15) },
  ];
}

export function clockTime(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
