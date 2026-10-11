# Desk Companion

Plan your day by stacking it on your real desk. A hands-first mixed-reality
planner for Meta Quest (WebXR / IWSDK): task tiles whose thickness is their time
estimate, sorted by hand into Now / Later / Drop, with a capacity line that turns
red when your day overflows. Today's meetings arrive from a private iCal link as fixed blocks, a desk buddy works
alongside you and speaks for the agent, and dropping a tile on the buddy gets you a
first draft of the task. Built for the Meta VR Start Developer Competition 2026.

- Live: https://desk-companion-1031148889398.us-central1.run.app
- Concept, status and roadmap: `idea-briefs/06-desk-companion.pdf`
- Submission kit (description, hand interactions, video plan): `docs/SUBMISSION.md`

## Run locally

```sh
npm install
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env   # optional: without it the offline splitter is used
npm run dev                                  # managed browser with the IWER XR emulator
```

`iwsdk.config.json` (not `vite.config.ts`) is the project authority: scene, assets,
components and XR features. In dev, **Alt+Shift+R** resets to a brand-new user.

## Checks

```sh
npm test                 # logic tests: day rollover, streaks, jar layers, bias model, coach steps, calendar parsing, meeting match
npm run typecheck
npm run build && npm run build:server
```

Quest app packaging (optional, Horizon Store): see `docs/PACKAGING.md`.

The concept brief is generated from `docs/briefs-src/` (`python3 docs/briefs-src/build.py`, needs reportlab).

## Demo run (video recording)

With `npm run dev` running, `python3 scripts/demo_run.py` drives the emulator with
emulated hands through the whole day: first-visit greeting and sample day, brain dump,
sorting, agent split, overflow and nudge, handing a task to the buddy, focus, flick to
tomorrow, jar, wind-down. `--pace 1.5` slows it down.

## Deploy (Google Cloud Run)

```sh
npm run deploy
```

Builds from source with the `Dockerfile` and serves the app plus `/api/brain-dump`,
`/api/split-task`, `/api/delegate`, `/api/calendar` and `/api/diagnostics` from one Node
server (`server/main.ts`). The
Anthropic key comes from Secret Manager (`desk-companion-anthropic-key`).

## Remote playtests

Open the live URL with `?playtest=1` to send anonymous device and performance
samples every 15 seconds (never task text). Read them with:

```sh
gcloud logging read 'resource.labels.service_name="desk-companion" AND jsonPayload.type="desk-companion-playtest"' \
  --project quick-catcher-470218-b0 --limit 50 --format=json
```

## Layout

```
src/planner-system.ts        core loop: tiles, zones, capacity, nudge, jar, wind-down, focus, coach wiring
src/desk-placement-system.ts desk detection, pinch-to-place, Move tray
src/planner-store.ts         saved state, day rollover (4 a.m.), weekly jar layers
src/estimates.ts             estimation-bias model
src/brain-dump.ts            agent calls with offline fallbacks
src/companion.ts             desk buddy animation and speech bubble
src/calendar-client.ts       today's meetings and the sample day
src/meeting-match.ts         skips brain-dump tasks that are already meetings
server/                      production server and Claude endpoints
scripts/demo_run.py          scripted emulator demo for the video
```
