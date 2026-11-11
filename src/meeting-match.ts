/**
 * Brain dumps often repeat what the calendar already says ("1:1 with Alex",
 * "standup"). Those become fixed meeting tiles, so a second, movable tile for the
 * same thing would double-count the time. Preparing for a meeting is real work,
 * though: "prep slides for the demo" is kept even when "Demo" is on the calendar.
 */

/** Words that say nothing about which meeting it is. */
const FILLER = new Set([
  'a', 'an', 'the', 'with', 'and', 'my', 'our', 'to', 'at', 'on', 'for', 'of', 'in',
  'meeting', 'meet', 'call', 'sync', 'chat', 'today', 'attend', 'join', 'go',
]);

/** Words that mean doing work around a meeting rather than being in it. */
const WORK = new Set([
  'prep', 'prepare', 'preparing', 'write', 'draft', 'send', 'reply', 'email', 'notes',
  'agenda', 'slides', 'deck', 'follow', 'followup', 'summarise', 'summarize', 'book', 'schedule',
  'reschedule', 'finish', 'update', 'read',
]);

function words(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/\b1\s*[:-]\s*1\b|\bone[\s-]on[\s-]one\b|\b1\s*on\s*1\b/g, ' oneonone ')
    .replace(/['’]s\b/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function key(list: string[]): Set<string> {
  return new Set(list.filter((word) => !FILLER.has(word)));
}

/** True when a brain-dump task is just a meeting that is already on today's calendar. */
export function isSameAsMeeting(task: string, meeting: string): boolean {
  const taskWords = words(task);
  const meetingWords = words(meeting);
  if (taskWords.join(' ') === meetingWords.join(' ')) return taskWords.length > 0;
  if (taskWords.some((word) => WORK.has(word) && !meetingWords.includes(word))) return false;
  const a = key(taskWords);
  const b = key(meetingWords);
  if (a.size === 0 || b.size === 0) return false;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const word of small) if (!large.has(word)) return false;
  return true;
}

/** The meeting a task duplicates, if any. */
export function matchingMeeting<T extends { title: string }>(task: string, meetings: T[]): T | undefined {
  return meetings.find((meeting) => isSameAsMeeting(task, meeting.title));
}
