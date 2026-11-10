# Release checklist (freeze 16 Nov, submit 17 Nov, live until 11 Dec)

Nothing here is run without the owner's go-ahead: deploys, pushes, merges and cloud
changes are asked for first.

## 1. Before the final deploy

```sh
./scripts/gate.sh                       # tests, typecheck, build, server build
git grep -n "sk-ant-[A-Za-z0-9]" -- . ':!*.md'   # must print nothing
python3 scripts/fov_check.py            # UI within the comfortable view
npm run latency -- 3                    # optional: agent p50/p95 per endpoint (costs a few cents)
```

## 2. Deploy

```sh
CLOUDSDK_CORE_ACCOUNT=gcp-dev-cli@quick-catcher-470218-b0.iam.gserviceaccount.com npm run deploy
```

`npm run deploy` already sets: one instance (`--max-instances 1`, so the in-memory rate
limit and daily cap are exact), `--concurrency 80`, 512 MiB, 1 CPU, 60 s timeout, and the
Anthropic key from Secret Manager (`desk-companion-anthropic-key`).

Environment variables (all optional; defaults in code):

| Variable | Default | Purpose |
|---|---|---|
| `DC_MODEL_BRAIN_DUMP` | `claude-sonnet-5-5` | brain dump -> tasks |
| `DC_MODEL_SPLIT` | `claude-sonnet-5-5` | split a big task |
| `DC_MODEL_DELEGATE` | `claude-sonnet-5-5` | first drafts |
| `BRAIN_DUMP_DAILY_CAP` | `300` | agent + calendar requests per day, all visitors |

Set one with `gcloud run services update desk-companion --project quick-catcher-470218-b0 --region us-central1 --update-env-vars KEY=value`.

**Recommended for judging (owner's call, small cost):** keep one instance warm from 17 Nov
to 11 Dec so the first visit never waits for a cold start:
`gcloud run services update desk-companion --project quick-catcher-470218-b0 --region us-central1 --min-instances 1`
(roughly USD 10-15 for the period at this size; set back to 0 after 11 Dec).

## 3. Verify the live build

```sh
U=https://desk-companion-1031148889398.us-central1.run.app
for p in / /manifest.webmanifest /icons/icon-512.png /.well-known/assetlinks.json; do
  curl -s -o /dev/null -w "$p %{http_code} %{content_type}\n" "$U$p"; done
curl -s -o /dev/null -w 'no-origin POST %{http_code} (want 403)\n' -X POST "$U/api/delegate" -d '{}'
curl -s -X POST "$U/api/delegate" -H 'content-type: application/json' -H "Origin: $U" \
  -d '{"title":"Reply to the recruiter","minutes":15,"category":"communication"}' | head -c 200; echo
```

Then open the URL once on the 2D page: the buddy greets, the sample day loads, **Use an
example** makes tiles.

## 3b. Live fallback test (fault injection)

`python3 scripts/fault_test.py` against `npm run dev` drives the real client: brain dump on the
2D page, split and delegate in XR with emulated hands, then `+1h` to prove the panel still
answers, then clears the fault. Run on 10 Nov 2026 after all changes; **20 of 20 steps pass**.

| Fault | Brain dump | Split | Delegate | Buttons live after | Calm line spoken |
|---|---|---|---|---|---|
| 429 | Made (offline), 2.1 s | Split (offline) | Offline head start | yes | yes, all three |
| 500 | Made (offline), 2.5 s | Split (offline) | Offline head start | yes | yes, all three |
| timeout | Made (offline), 11.0 s (9 s client limit) | Split (offline) | Offline head start | yes | yes, all three |
| offline (socket dropped) | Made (offline), 1.8 s | Split (offline) | Offline head start | yes | yes, all three |
| none (recovery) | Agent made, 3.6 s | Agent split | Agent drafted | yes | not needed |

Split and delegate step times (17-32 s) are mostly the scripted hand carrying the tile.
Fault injection is ignored in production (`NODE_ENV=production`) unless `FAULT_INJECTION=1` is
set; checked against a local production build. Results: `artifacts/fault-test.json`.

## 4. Expected cost through 11 Dec

- Agent: about USD 0.004 per call on Sonnet 5.5 (measured: about 1,000 input and 200 output
  tokens; USD 2 / 10 per million). The daily cap makes the worst case USD 1.20 a day,
  about USD 30 from 17 Nov to 11 Dec. Realistic judge traffic: well under USD 5.
- Cloud Run: free tier or a few dollars at min-instances 0; USD 10-15 with one warm instance.
- Set a monthly spend limit on the Anthropic key (console) of USD 50 as a backstop.

## 5. Rule compliance (section 0 of the brief)

| Rule | Status | Evidence |
|---|---|---|
| Fully usable without a controller | Pass | Every action has a hand gesture and a panel button; hand-only emulator runs (`scripts/demo_run.py`) cover the whole day |
| No identifiable real people | Pass | Example names are fictional first names ("Alex", "Sam"); no photos or likenesses |
| No brand names, logos or slogans in the app | Pass | Calendar copy is generic ("your calendar's private iCal link (.ics)"); provider names remain only in the server allowlist and the Devpost text |
| Not a thin wrapper | Pass | Time buttons, sorting, capacity, meetings, focus, jar and wind-down all work without the agent; offline fallbacks unit-tested and live-tested under 429/500/timeout/offline (section 3b) |
| English only | Pass | All UI and voice lines are English |
| Free to access | Pass | Public URL, no account, no payment |
| Works in a stranger's room | Pass in emulator, needs device check | Table plane, pinch-to-place and Move tray fallbacks; persistent anchors discard implausible poses. Needs a run at a desk never used before (section 6) |
| 60 fps on Quest | Needs device check | Emulator worst case p50 8.6 ms on desktop; Quest numbers come from `?playtest=1` |

## 6. Only the owner can do these

1. **Two real headsets, two desks.** On a Quest 3 and a Quest 3S, open the URL with
   `?playtest=1` at a desk (one never used before), do the first run, wind down, exit and
   re-enter. Then read the samples:
   `gcloud logging read 'resource.labels.service_name="desk-companion" AND jsonPayload.type="desk-companion-playtest"' --project quick-catcher-470218-b0 --limit 50 --format=json`
   and send them over: frame p50/p95, `msToTrayPlaced`, `anchors`, `placementSource`.
2. **Anchor across a reboot.** Place the tray, exit, restart the headset, open the URL,
   Enter XR: the panel should say "Welcome back. Your desk is where you left it".
3. **Record the real-passthrough beats** in the video plan (`docs/SUBMISSION.md`).
4. **Membership:** confirm the Devpost entry uses the email on the Meta VR Start account.
5. **Fund and cap the Anthropic key**, rotate it if it was ever shared, and keep Cloud Run
   live and unchanged until 11 Dec.
6. **Submit on Devpost by 17 Nov** with the text in `docs/SUBMISSION.md`.

## 7. Known gaps, stated honestly

- Nothing has run on a physical Quest yet: hand-pinch feel, real frame rate, anchor
  relocalisation and Quest Browser speech are emulator-verified only.
- Live calendar fetches from Cloud Run can get HTTP 429 from Google (shared egress IPs);
  the sample day and local links work. A static egress IP (Cloud NAT) would fix it.
- Look to select follows the head; true eye gaze only exists on eye-tracking headsets.
- Off-centre trays: the panel and buddy swing around the user into view; on a narrow real desk
  the buddy could end up past the desk edge (floating). Device test step 4b checks it.
- The comfort reference is the seated resting gaze at the tray's back edge (about 37 degrees
  down), not the tray centre: from the tray centre no layout fits the panel within +-20 degrees
  vertically without it sinking into the desk (`scripts/fov_check.py`).

## 8. If a Quest phase's p95 frame time is above 13.9 ms

Trigger: any `phaseIdleP95Ms`, `phaseSortingP95Ms` or `phaseHeavyP95Ms` above 13.9 from the
device test (`docs/DEVICE-TEST.md`). Then, in this order, re-measuring with the same
`?playtest=1&stress=1` run after each step and stopping as soon as every phase is under:

1. **Shared materials.** Tile bodies use one material per tile colour (priority/kind) instead
   of one per tile; labels keep their own canvas texture. Fewer state changes, same draw calls.
2. **Instanced bodies, separate labels.** Draw all tile bodies through one InstancedMesh per
   colour, updated from each tile entity's transform every frame; keep each tile's entity as a
   label mesh (its own canvas) so OneHandGrabbable, hover lift and the drop logic still work
   per tile. Expected: about 25 fewer draw calls at 25 tiles.
3. **Jar strata in one mesh.** The weekly layers as one merged geometry with vertex colours
   (up to 7 fewer draw calls).

Emulator baseline (desktop host, worst case): 176 draw calls, 36k triangles; p95 idle 11.9 ms,
sorting 11.7 ms, heavy 11.8 ms.
