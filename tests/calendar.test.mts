import assert from 'node:assert/strict';
import { meetingsBetween, normaliseCalendarUrl } from '../server/calendar.ts';

const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:standup@test
SUMMARY:Team standup
DTSTART;TZID=America/New_York:20260105T093000
DTEND;TZID=America/New_York:20260105T094500
RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
END:VEVENT
BEGIN:VEVENT
UID:standup@test
RECURRENCE-ID;TZID=America/New_York:20261008T093000
SUMMARY:Team standup (moved)
DTSTART;TZID=America/New_York:20261008T110000
DTEND;TZID=America/New_York:20261008T111500
END:VEVENT
BEGIN:VEVENT
UID:standup@test
RECURRENCE-ID;TZID=America/New_York:20261009T093000
SUMMARY:Team standup
STATUS:CANCELLED
DTSTART;TZID=America/New_York:20261009T093000
DTEND;TZID=America/New_York:20261009T094500
END:VEVENT
BEGIN:VEVENT
UID:offsite@test
SUMMARY:Company offsite
DTSTART;VALUE=DATE:20261008
DTEND;VALUE=DATE:20261009
END:VEVENT
BEGIN:VEVENT
UID:review@test
SUMMARY:Design review
DTSTART;TZID=America/New_York:20261008T140000
DTEND;TZID=America/New_York:20261008T153000
END:VEVENT
BEGIN:VEVENT
UID:late@test
SUMMARY:Late release
DTSTART;TZID=America/New_York:20261008T230000
DTEND;TZID=America/New_York:20261009T010000
END:VEVENT
END:VCALENDAR`;

// 8 Oct 2026 in New York (EDT, UTC-4): 04:00Z on the 8th to 04:00Z on the 9th.
const day = (d: number) => [Date.UTC(2026, 9, d, 4), Date.UTC(2026, 9, d + 1, 4)] as const;
const hm = (ms: number) => new Date(ms - 4 * 3600e3).toISOString().slice(11, 16); // New York clock

const thursday = meetingsBetween(ics, ...day(8)).map((m) => [m.title, hm(m.start), hm(m.end)]);
assert.deepEqual(thursday, [
  ['Team standup (moved)', '11:00', '11:15'],
  ['Design review', '14:00', '15:30'],
  ['Late release', '23:00', '00:00'],
], 'moved instance, one-off, clipped at midnight; all-day ignored');

const friday = meetingsBetween(ics, ...day(9)).map((m) => [m.title, hm(m.start), hm(m.end)]);
assert.deepEqual(friday, [['Late release', '00:00', '01:00']], 'cancelled standup dropped; overnight tail kept');

const wednesday = meetingsBetween(ics, ...day(7)).map((m) => [m.title, hm(m.start)]);
assert.deepEqual(wednesday, [['Team standup', '09:30']], 'normal recurring instance');

assert.ok(normaliseCalendarUrl('webcal://p52-caldav.icloud.com/published/2/abc'), 'webcal on iCloud accepted');
assert.ok(normaliseCalendarUrl('https://calendar.google.com/calendar/ical/x/private-y/basic.ics'));
assert.equal(normaliseCalendarUrl('https://evil.example/basic.ics'), undefined, 'unknown host rejected');
assert.equal(normaliseCalendarUrl('http://calendar.google.com/x.ics'), undefined, 'plain http rejected');
assert.equal(normaliseCalendarUrl('https://calendar.google.com.evil.example/x.ics'), undefined, 'look-alike host rejected');
console.log('calendar parsing: all assertions passed');
