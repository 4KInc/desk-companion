# Desk Companion: submission kit

Meta VR Start Developer Competition 2026. Everything below matches the build at
https://desk-companion-1031148889398.us-central1.run.app (final deploy after the
16 Nov freeze). Paste the sections into Devpost; do not claim anything the build
or the video does not show.

## Form fields

| Field | Value |
|---|---|
| Name | Desk Companion |
| Tagline (under 140 characters) | Your workload, made physical on your real desk: see an overbooked day before you live it, with an AI desk buddy that helps. |
| Track | Productivity |
| Division | New Experience (first commit 29 Sep 2026, after the window opened) |
| Build path | IWSDK (WebXR) |
| Project link | https://desk-companion-1031148889398.us-central1.run.app |
| Target launch | Public web release, Q1 2027 |

## Description (about 500 words)

**Tasks have size here.** A to-do list looks the same whether it holds two hours or twelve, which is why we keep planning nine hours of work into a five-hour day. Desk Companion puts your workload on your real desk in mixed reality. Every task is a tile whose thickness is its time estimate, 1 cm per 30 minutes. A glowing capacity line marks the hours you actually have. Stack past it and the line turns red and the top tiles wobble. You see an overbooked day before you live it.

**A day on the desk.** Say or type what is on your mind; an agent turns it into estimated, prioritised tiles on a tray on your real desk. Today's meetings arrive from your calendar's private iCal link as fixed blocks, so the stack shows the hours really left. You pinch tiles into Now, Later and Drop. When Now overflows, the desk buddy beside the tray says why it suggests moving one task ("Meetings fill 3h 30m, so 'Book flights' isn't urgent and can wait"); one pinch accepts. Big tasks crack into steps. Pull a tile to your chest to focus while the buddy works alongside you, with a heads-up before each meeting. Hand a tile to the buddy and it drafts the task itself, an email, outline or checklist, as a paper sheet on your desk. In the evening finished tiles fill a done jar that grows a layer every week; unfinished ones flick to tomorrow.

**A reason to come back.** The tray comes back on the same desk next session through a persistent spatial anchor, where the browser supports it. Each new day the buddy opens with one line built only from your own data: tiles that came back from yesterday, and what it has learned about your estimates ("your writing tasks run 41% low, so I'll nudge new estimates to match").

**Hands-first and accessible.** Everything is a pinch, grab, flick or pull, with a panel button for each; no controller is needed. Options offer larger tiles, high contrast, reduced motion, sound, and Look to select: hold your gaze on a button to press it, or on a tile and then a zone to move it, with no hand movement at all.

**How we built it.** Immersive Web SDK (WebXR) in passthrough: plane detection finds a labelled table (point-and-pinch placement otherwise), persistent anchors restore the tray, hand tracking drives pinch grabbing, depth sensing lets real hands occlude lifted tiles on Quest 3, and eye gaze drives look-and-pinch where eye tracking exists. The agent is Claude behind a small Cloud Run server, with structured output, rate limits and a timeout; no key reaches the headset and there are no accounts.

**Take it away.** Without the agent you can still add tiles with the time buttons, sort them, see capacity and meetings, focus, wind down and fill the jar; the overflow suggestion, the bias model and calendar parsing are local, tested code. If the agent is busy or offline the buddy says so and a local version stands in.

**What's next.** Shared desks for pairs, a weekly review at the jar, and a Horizon Store release (the signed Quest package is already built).

## Hand interactions (form question)

- **Pinch-grab** a tile: the nearest tile lifts 1.5 cm and glows as your hand approaches, so the pinch closes in free air. Only the top of each pile can be grabbed.
- **Drop** it over Now, Later, Drop, the Inbox or the done jar; it snaps and restacks.
- **Flick** a held tile left to push it to tomorrow; **pull it to your chest** to focus. Both have panel buttons, and destructive moves offer Undo for 8 seconds.
- **Hand a tile to the buddy**: carry it over the buddy (it raises its hands, the panel says "Let go") and release to get a first draft; the Draft button does the same. **Pick up the draft sheet** and put it anywhere on the desk.
- **Ray-pinch** panel buttons; **point and pinch** at any surface to place the tray.
- **Look to select** (Options): hold your head on a button, or on a tile and then a zone, to act with no hand movement.

## Testing instructions for judges

1. Open the link in the Quest Browser on Meta Quest 3 or 3S, seated at a desk or table. Sound on is recommended (the buddy speaks).
2. On the page, tap **Use an example** then **Make tiles** (or type your own morning). A sample day of meetings is already loaded; paste your own calendar's private iCal link to replace it.
3. Tap **Enter XR** and allow the permissions. The tray lands on a table labelled in Space Setup; otherwise point at your desk and pinch. Inside the headset, **Try an example morning** on the panel works too.
4. Follow the one-line hints on the panel; they walk through the first sort, the capacity line and the jar.
5. Enter XR a second time: the tray comes back where you left it.

Device notes, stated plainly:
- **Quest 3:** real-hand occlusion of lifted tiles (depth sensing).
- **Quest 3S:** everything except occlusion, which needs a depth sensor.
- **Eye gaze:** look-and-pinch uses real eye tracking only on headsets that have it (for example Quest Pro). Look to select works on every headset because it follows the head.
- **Persistent anchors:** used where the Quest Browser exposes them; otherwise the tray finds the table again (about 2 seconds) or you pinch to place it.

## Privacy

Brain-dump text and the title of a task you choose to split or hand to the agent are sent to Anthropic's API to create tasks or drafts; the server does not store or log them. A calendar link is used only to fetch today's meetings and is never stored or logged; meeting titles stay in your browser. Planner data stays in your browser's storage; the tray's anchor is an opaque id kept on the device. The optional `?playtest=1` mode sends anonymous device and performance numbers only, never text.

## Video plan (under 2:50)

The hook and the key moments are real Quest 3 passthrough footage at a real desk (recorded on the headset); emulator capture (`python3 scripts/demo_run.py`) fills the gaps. Best material first.

| Time | Beat | Source |
|---|---|---|
| 0:00 - 0:10 | **Hook:** a tile drops onto a real desk, the stack rises past the glowing line, it turns red and wobbles; the buddy: "That's more than your day holds." | **Quest 3 footage** |
| 0:10 - 0:30 | Brain dump becomes tiles dropping onto the desk; meetings already fixed in Now | Quest 3 footage (or emulator) |
| 0:30 - 0:55 | Sorting by hand: hover lift, pinch, snap; the capacity line reacting | **Quest 3 footage** (hands on screen) |
| 0:55 - 1:15 | Overflow: the buddy says why, one pinch moves it to Later | Emulator |
| 1:15 - 1:35 | A big task cracks into steps | Emulator |
| 1:35 - 1:55 | Hand a tile to the buddy; it types; the draft sheet lands; pick it up and set it aside | **Quest 3 footage** |
| 1:55 - 2:10 | Focus at your chest, buddy working alongside; meeting heads-up | Emulator |
| 2:10 - 2:25 | Evening: flick to tomorrow, finished tiles into the jar, the weekly layers | Emulator |
| 2:25 - 2:38 | Next morning: the tray is back on the same desk; "3 tiles came back from yesterday..."; Look to select in one shot | Quest 3 footage (anchor) + emulator |
| 2:38 - 2:48 | Title card: "See an overbooked day before you live it." | Edit |

Show one manual tile (time buttons) somewhere for the take-it-away point. Use only real
footage for any claim about the headset.
