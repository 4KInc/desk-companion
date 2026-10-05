# Desk Companion: submission kit

Meta VR Start Developer Competition 2026. Everything below matches the build at
https://desk-companion-1031148889398.us-central1.run.app. Re-check it against the
final build before submitting on 17 Nov.

## Form fields

| Field | Value |
|---|---|
| Name | Desk Companion |
| Tagline (under 140 characters) | Plan your day by stacking it on your real desk, and see overcommitment before you live it. |
| Track | Productivity |
| Division | New Experience |
| Project link | https://desk-companion-1031148889398.us-central1.run.app |
| Target launch | Public web release Q1 2027 |

## Description (about 500 words)

**Inspiration.** To-do lists hide the thing that actually hurts: planning nine hours of work into a five-hour day. A list stays the same length whether it holds two hours or twelve. In mixed reality, tasks can have physical size. Desk Companion turns your workload into objects on your real desk, so overcommitment is something you see and feel before you live it.

**What it does.** Each morning you brain-dump what is on your mind. An agent turns it into task tiles whose thickness is their time estimate: 1 cm per 30 minutes. You pinch the tiles into three zones on a tray placed on your real desk: Now, Later and Drop. A glowing capacity line over Now marks the hours you actually have. Stack past it and the top tiles turn red and wobble, and the agent suggests the lowest-priority work to move to Later; one pinch accepts. Big tasks can crack into smaller steps in place. During the day you can pull a tile to your chest to focus on it with a floating timer. In the evening you sweep finished tiles into a done jar that never resets and grows a new layer every week, flick unfinished ones left to push them to tomorrow, and get a short recap. Over time it learns how long your work really takes ("your estimates on writing tasks run 40% low") and quietly corrects new estimates.

**Hands-first.** Every action is a pinch, grab, flick or pull, and every gesture also has a button fallback on the panel. No controller is ever needed.

**Accessible by default.** Every gesture has a button alternative, destructive actions can be undone, and an Options card offers larger tiles (easier to see and pinch), high contrast, reduced motion and sound off. All feedback is visual as well as audible.

**Why passthrough.** The tray, the zones and the stacks live on your real desk at real scale; a stack taller than your coffee mug is a signal you read instantly. With passthrough off the idea breaks.

**How we built it.** Immersive Web SDK (WebXR) with plane detection to find your desk and a pinch-to-place fallback for any surface, hand-pinch grabbing with a hover lift so the pinch closes in free air, real-hand occlusion of lifted tiles where depth sensing is available (Quest 3), procedural spatial sound with no audio files, and IndexedDB storage with no accounts. The agent is Claude, behind a small server on Google Cloud Run so the key never reaches the headset, with structured output for reliable task data, a per-visitor rate limit and a daily cap. The deterministic parts (capacity check, nudge selection, estimation-bias model) run locally and are covered by tests.

**Take it away test.** Without the agent you can still create tiles with the time buttons, sort them by hand, see capacity, focus, wind down and fill the jar. The agent makes it faster, not possible.

**What's next.** Persistent anchors so the tray reappears without re-detecting the desk, and a Horizon Store PWA.

## Hand interactions (form question)

- **Pinch-grab** a tile (the nearest tile lifts 1.5 cm and glows as your hand approaches, so the pinch never fights the desk). Only the top of each pile is grabbable.
- **Drop** it over Now, Later, Drop, the Inbox or the done jar; it snaps and restacks.
- **Flick** a held tile left to push it to tomorrow; **pull it to your chest** to focus. Both have buttons on the panel too, and destructive actions offer Undo for 8 seconds.
- **Ray-pinch** panel buttons; **point and pinch** at any surface to place the tray.

## Testing instructions for judges

1. On Meta Quest 3 or 3S, open the link in the Quest Browser while seated at a desk or table.
2. Tap Enter XR and allow the requested permissions. If Space Setup labelled your table, the tray appears on it; otherwise point at your desk and pinch, or use Move tray later.
3. Type a brain dump in the box on the page before entering, or use the time buttons in XR (Dictate appears where the browser supports speech).
4. Follow the one-line hints on the panel: they walk through the first run.

## Privacy

Brain-dump text and the title of a task you choose to split are sent to Anthropic's API to create tasks; the server does not store or log them. Everything else stays in your browser's storage. Optional playtest diagnostics (`?playtest=1`) send only anonymous device and performance numbers.

## Video plan (under 3 minutes)

Record in the IWER emulator (allowed by the rules) with `python3 scripts/demo_run.py`, then edit.

| Time | Beat | Script section |
|---|---|---|
| 0:00 - 0:08 | Hook: a stack rising past the red line, wobbling | "Keep stacking until the day overflows" |
| 0:08 - 0:35 | Brain dump becomes tiles that drop onto the desk | Fresh start and brain dump |
| 0:35 - 1:10 | Sorting by hand, hover lift, snapping | "Sort the smaller tasks" |
| 1:10 - 1:35 | The agent splits a big task; the tile cracks | "Split a big task" |
| 1:35 - 1:55 | Overflow and the one-pinch nudge | Overflow and nudge beats |
| 1:55 - 2:15 | Focus timer; flick to tomorrow with Undo | Focus and flick beats |
| 2:15 - 2:45 | Wind down: jar, recap, streak; the jar's weekly layers | Jar and wind-down beats |
| 2:45 - 2:58 | Title: "See overcommitment before you live it" | |

Also show one manual tile creation (time buttons) to satisfy the wrapper rule. Do not
claim device-specific results the video does not show.
