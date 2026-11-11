# 10-minute on-device test (Quest 3 and Quest 3S)

One run per headset, at a desk the headset has **never seen**, with **no table in Space
Setup** (so placement falls back to point-and-pinch). Hands only: put the controllers away
before you start and never pick them up. Sound on.

Live URL: https://desk-companion-1031148889398.us-central1.run.app

## Before you start (1 min)

1. Quest Settings > Physical space > Space Setup: if this desk is set up as a table, clear
   the room's furniture (or use a desk in a room you have not scanned).
2. Put the controllers down out of reach. Hand tracking on.
3. Note the headset model and the time.

## The run (about 8 min)

| # | Do this (hands only) | Expect | Note down |
|---|---|---|---|
| 1 | Open Quest Browser, go to the URL with `?playtest=1` added | 2D page, buddy says hello, sample day loaded | anything odd on the page |
| 2 | Tap **Use an example**, then **Make tiles** | "N tiles are on your tray" within about 5 s | seconds it took |
| 3 | Tap **Enter XR**, allow the permissions | Passthrough, then "Point at your desk and pinch" after about 2.5 s | did the prompts work by hand? |
| 4 | Point your right hand at the desk, pinch | Tray lands on the desk facing you | was it at desk height? |
| 4b | Pinch **Move tray**, then place the tray well off to one side (about 45 degrees) while still facing forward | Tray stays where you put it, turned toward you; the panel and buddy swing toward the middle of your view | did the buddy end up off the desk edge? |
| 4c | Pinch **Move tray** again and place it straight in front of you | Panel and buddy back in their usual places | |
| 5 | Pinch a tile from the Inbox, drop it on **Now**. Repeat until the line turns red | Tiles lift as your hand nears, snap; red line, wobble, buddy says why | any missed pinches? labels readable? |
| 6 | Pinch **Move to Later** on the panel | One tile moves, buddy confirms | |
| 7 | Carry a tile over the buddy and let go | Buddy raises hands, types, a draft sheet appears; pick the sheet up and put it elsewhere | did the sheet stay where you put it? |
| 8 | **Options > Look to select: On > Done**. Hold your head on **+1h** for about 1 s without moving your hands | A ring fills, +1h is pressed | how long it felt; any accidental presses? |
| 9 | Look at a tile for 1 s, then at **Later** for 1 s | The tile moves to Later | |
| 10 | Turn Look to select off again by hand | | |
| 11 | Pull a tile to your chest (focus), set it back | Floating timer near you, buddy typing | was the timer in front of you? |
| 12 | Pinch **Exit**, then **Enter XR** again | "Welcome back. Your desk is where you left it" and the tray in the same place | did it come back? where? |
| 13 | Take the headset off, **restart the Quest**, open the URL again, Enter XR | Same "Welcome back", tray on the same spot | did it come back after the reboot? |
| 14 | **One forced fault (optional, Quest 3 only):** ask me to switch the live build to fault mode for 5 minutes, then do step 2 again | Buddy: "The agent's busy, so here's a quick local version"; tiles still appear | did anything hang? |
| 15 | **Worst case (1 min):** open the URL with `?playtest=1&stress=1`, Enter XR, place the tray, then just look around the desk for 30 s and grab two tiles | 25 tiles, a jar with 8 weekly layers; it stays smooth | any stutter? |

Step 15 replaces this headset's planner data with a test day, so do it last. The link
loads it once per browser tab.

Then do the same run on the other headset, at a different desk if you can.

## Send back

1. Per headset: the "Note down" column (one line each is plenty), and a screenshot or
   short clip of step 5 (the red line).
2. The playtest samples (they arrive every 15 s while `?playtest=1` is on):

   ```sh
   gcloud logging read 'resource.labels.service_name="desk-companion" AND jsonPayload.type="desk-companion-playtest"' \
     --project quick-catcher-470218-b0 --limit 200 --format=json > playtest.json
   ```

   The fields that answer the questions: `device`, `phaseIdleP95Ms`, `phaseSortingP95Ms`,
   `phaseHeavyP95Ms` (frame time per phase), `msToTrayPlaced`, `msToFirstTile`,
   `msToFirstSort`, `anchors`, `planeLabels`, `placementSource`, `depth`, `gaze`.
3. If any phase's p95 is above 13.9 ms, say which; that triggers the draw-call work
   (release checklist, section 8).

## Step 14 (forced fault): how it is switched

Only with your go-ahead, for five minutes, then switched back:

```sh
gcloud run services update desk-companion --project quick-catcher-470218-b0 --region us-central1 \
  --update-env-vars FAULT_INJECTION=1,FAULT_MODE=429
# after the test:
gcloud run services update desk-companion --project quick-catcher-470218-b0 --region us-central1 \
  --remove-env-vars FAULT_INJECTION,FAULT_MODE
```
