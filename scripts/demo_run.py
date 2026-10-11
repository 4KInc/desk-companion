#!/usr/bin/env python3
"""Scripted demo run for recording the Desk Companion video in the IWER emulator.

Drives the managed browser through the iwsdk CLI with emulated *hands* (the
competition is hands-first), at a steady pace you can screen-record. Positions
are computed from live state (desk pose, panel layout, tile names), so it does
not depend on hard-coded coordinates.

Usage (dev server running via `npm run dev`, managed browser open):
    python3 scripts/demo_run.py            # full run from a fresh first-run state
    python3 scripts/demo_run.py --keep     # keep existing tasks (skip reset and brain dump)
    python3 scripts/demo_run.py --pace 1.5 # slower pauses between beats

The reset uses the dev-only Alt+Shift+R shortcut, so this only works against
`npm run dev`, never the deployed site.
"""
import argparse
import json
import math
import subprocess
import time

BRAIN_DUMP = (
    "Finish the Q4 roadmap doc, review Sam's pull request before noon, 1:1 with Alex, "
    "prep slides for Thursday's demo, reply to the recruiter, book flights to Berlin, "
    "maybe tidy up the backlog"
)
# Tray-local zone centres (match src/scene-assets/day-tray.scene-asset.ts) and panel transform
# (match public/scenes/main.iwsdk.scene.json: desk-setup child at (0, 0.26, -0.23), -15 deg, 0.11).
ZONES = {"now": (-0.19, 0.07), "later": (0.0, 0.07), "drop": (0.19, 0.07)}
JAR = (0.37, 0.04)
BUDDY = (-0.38, 0.03)  # desk-buddy in public/scenes/main.iwsdk.scene.json
DELEGATE = "Reply to the recruiter"
PANEL = {"y": 0.26, "z": -0.23, "tilt": math.radians(-15), "scale": 0.11}
SEATED_HEAD = {"x": 0.05, "y": 0.95, "z": 0.12}
PACE = 1.0


def cli(*args, payload=None):
    cmd = ["npx", "@iwsdk/cli", *args]
    if payload is not None:
        cmd += ["--input-json", json.dumps(payload)]
    out = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT).stdout
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        return {}
    return data.get("data", {}).get("result", {}) if data.get("ok") else {}


def pause(seconds):
    time.sleep(seconds * PACE)


def say(text):
    print(f"\n== {text}")


def report():
    """Prints what the panel says after a beat, so a recording run can be checked."""
    status = panel_layout("status-text")
    capacity = panel_layout("capacity-text")
    cards = [c for c in ("nudge-card", "split-card", "took-card", "recap-card", "draft-card", "tile-actions") if shown(c)]
    print(f"   status: {status and status.get('text')}")
    print(f"   {capacity and capacity.get('text')} | cards: {', '.join(cards) or 'none'}")


# --- live state -------------------------------------------------------------------

def entity_index(name_pattern=None, component=None):
    query = {"namePattern": name_pattern} if name_pattern else {"withComponents": [component]}
    found = cli("ecs", "find", payload=query).get("entities", [])
    return found[0]["entityIndex"] if found else None


def components(index):
    return {c["componentId"]: c["values"] for c in cli("ecs", "query", payload={"entityIndex": index}).get("components", [])}


def desk_pose():
    t = components(entity_index(component="DeskPlacement"))["Transform"]
    qx, qy, qz, qw = t["orientation"]
    return t["position"], 2 * math.atan2(qy, qw)


def desk_to_world(local, pose):
    (dx, dy, dz), yaw = pose
    lx, ly, lz = local
    return {"x": dx + lx * math.cos(yaw) + lz * math.sin(yaw), "y": dy + ly, "z": dz - lx * math.sin(yaw) + lz * math.cos(yaw)}


def tiles():
    """{title: (entityIndex, zone, grabbable)} for every tile on the tray."""
    result = {}
    for e in cli("ecs", "find", payload={"withComponents": ["TaskTile"]}).get("entities", []):
        c = components(e["entityIndex"])
        name = e.get("name") or ""
        result[name.removeprefix("tile-")] = (e["entityIndex"], c["TaskTile"]["zone"], "OneHandGrabbable" in c)
    return result


def panel_layout(element_id):
    panel = entity_index("^Planner Panel$")
    found = cli("ui", "inspect", payload={"entityIndex": panel, "selector": f"#{element_id}"}).get("elements", [])
    return found[0] if found else None


def panel_point(button_id, row_id=None, card_id=None, from_top=None, from_bottom=None):
    """World position of a panel button, from UIKit layout (centimetre units, y up)."""
    root = panel_layout("planner-root")["layout"]["size"]
    button = panel_layout(button_id)["layout"]
    x = button["relativeCenter"][0]
    if row_id:
        y = panel_layout(row_id)["layout"]["relativeCenter"][1]
    elif card_id:
        card = panel_layout(card_id)["layout"]
        y = card["relativeCenter"][1] - card["size"][1] / 2 + 34  # button row sits 34 above the card bottom
    elif from_top is not None:
        y = root[1] / 2 - from_top
    else:
        y = -root[1] / 2 + from_bottom
    s, tilt = PANEL["scale"] / 100, PANEL["tilt"]
    local = (x * s, PANEL["y"] + y * s * math.cos(tilt), PANEL["z"] + y * s * math.sin(tilt))
    return desk_to_world(local, desk_pose())


# --- hand actions -------------------------------------------------------------------

def hand_to(point, duration=0.6):
    cli("xr", "animate-to", payload={"device": "hand-right", "position": point, "duration": duration})
    time.sleep(duration + 0.15)


def hand_rest():
    hand_to({"x": 0.35, "y": 0.8, "z": 0.1}, 0.4)


def tap(button_id, **where):
    cli("xr", "look-at", payload={"device": "hand-right", "target": panel_point(button_id, **where)})
    time.sleep(0.4)
    cli("xr", "select", payload={"device": "hand-right", "duration": 0.2})
    pause(0.8)


def carry(title, target, duration=0.9, release_mid_motion=False):
    """Pinch a tile by title and carry it to a world point."""
    index = tiles()[title][0]
    start = components(index)["Transform"]["position"]
    hand_to({"x": start[0], "y": start[1] + 0.05, "z": start[2]}, 0.5)  # approach: hover lift shows
    pause(0.4)
    hand_to({"x": start[0], "y": start[1], "z": start[2]}, 0.25)
    cli("xr", "set-select-value", payload={"device": "hand-right", "value": 1})
    time.sleep(0.3)
    if release_mid_motion:  # a flick lets go while the hand is still moving
        subprocess.Popen(["npx", "@iwsdk/cli", "xr", "animate-to", "--input-json",
                          json.dumps({"device": "hand-right", "position": target, "duration": duration})], cwd=ROOT,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(0.15)  # the release command's own start-up lands it mid-swing
    else:
        hand_to(target, duration)
    cli("xr", "set-select-value", payload={"device": "hand-right", "value": 0})
    pause(0.6)
    hand_rest()


def to_zone(title, zone):
    x, z = ZONES[zone]
    carry(title, desk_to_world((x, 0.12, z), desk_pose()))


def first_tile(zone, min_minutes=0, max_minutes=10_000):
    for title, (index, tile_zone, grabbable) in tiles().items():
        minutes = components(index)["TaskTile"]["minutes"]
        if tile_zone == zone and grabbable and min_minutes <= minutes <= max_minutes:
            return title
    return None


def shown(element_id):
    element = panel_layout(element_id)
    return bool(element and element["state"]["displayed"])


# --- the run --------------------------------------------------------------------------

def main():
    global PACE, ROOT
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--keep", action="store_true", help="keep existing tasks (no reset, no brain dump)")
    parser.add_argument("--pace", type=float, default=1.0, help="multiply all pauses")
    parser.add_argument("--root", default=".", help="project directory")
    args = parser.parse_args()
    PACE, ROOT = args.pace, args.root

    if not args.keep:
        say("Fresh start (dev-only reset): the buddy says hello and a sample day fills Now with meetings")
        cli("browser", "interact", payload={"steps": [{"action": "press", "key": "Alt+Shift+KeyR"}]})
        time.sleep(4)
        cli("runtime", "wait", payload={"timeoutMs": 20000})
        pause(8)  # the greeting, then the meetings
        say("Brain dump on the 2D page; '1:1 with Alex' is already a meeting, so it is skipped")
        cli("browser", "interact", payload={"steps": [
            {"action": "click", "locator": {"role": "button", "name": "Use an example"}},
            {"action": "wait", "durationMs": 1500},
            {"action": "click", "locator": {"role": "button", "name": "Make tiles"}},
        ]})
        for _ in range(30):  # the agent takes a few seconds; wait until the tiles are in
            status = panel_layout("status-text")
            if status and "Sorting" not in status.get("text", ""):
                break
            time.sleep(1)
        pause(3)
        report()

    say("Enter XR seated at the desk, hands only")
    cli("xr", "enter", payload={})
    time.sleep(4)
    cli("xr", "set-input-mode", payload={"mode": "hand"})
    cli("xr", "set-transform", payload={"device": "headset", "position": SEATED_HEAD})
    cli("xr", "look-at", payload={"device": "headset", "target": desk_to_world((0, 0.05, -0.05), desk_pose())})
    hand_rest()
    pause(3)

    # Choreography: small tiles first (a big one would raise the split offer, and the
    # panel shows one card at a time), then the big tile, its split, and the overflow.
    say("Sort the smaller tasks into Now by hand")
    for _ in range(4):
        title = first_tile("inbox", max_minutes=119)
        if not title or shown("nudge-card"):
            break
        to_zone(title, "now")

    say("Split a big task: the agent cracks it into steps")
    big = first_tile("inbox", min_minutes=120)
    if big:
        to_zone(big, "now")
        if shown("split-card"):
            tap("split-accept", card_id="split-card")
            pause(8)
            report()

    say("Keep stacking until the day overflows")
    for _ in range(4):
        if shown("nudge-card"):
            break
        title = first_tile("inbox")
        if not title:
            break
        to_zone(title, "now")
    pause(3)  # the red, wobbling stack: the hook shot
    report()

    say("The agent's nudge: one pinch moves the lowest-priority work to Later")
    if shown("nudge-card"):
        tap("nudge-accept", card_id="nudge-card")
        pause(3)
        report()
    if shown("split-card"):  # a big tile stacked during the overflow: keep it whole this time
        tap("split-dismiss", card_id="split-card")

    say("Hand a task to the buddy: it types, then a first draft lands on the desk")
    current = tiles()
    grabbable = DELEGATE in current and current[DELEGATE][2]
    title = DELEGATE if grabbable else first_tile("later") or first_tile("inbox") or first_tile("now")
    if title:
        pose = desk_pose()
        carry(title, desk_to_world((BUDDY[0], 0.09, BUDDY[1]), pose), duration=1.2)
        pause(12)  # the agent writes; the buddy types
        report()
        if shown("draft-card"):
            pause(4)  # read the draft
            tap("draft-close", card_id="draft-card")

    say("Focus: pull a tile to your chest")
    title = first_tile("now")
    if title:
        head = cli("xr", "get-transform", payload={"device": "headset"})["position"]
        carry(title, {"x": head["x"], "y": head["y"] - 0.35, "z": head["z"] - 0.15})
        pause(5)
        to_zone(title, "now")

    say("Flick an unfinished tile left to push it to tomorrow")
    title = first_tile("later") or first_tile("inbox")
    if title:
        index = tiles()[title][0]
        start = components(index)["Transform"]["position"]
        carry(title, {"x": start[0] - 0.45, "y": start[1] + 0.06, "z": start[2]}, duration=0.25, release_mid_motion=True)
        pause(2)
        report()

    say("Finished work goes in the jar")
    for _ in range(2):
        title = first_tile("now")
        if not title:
            break
        carry(title, desk_to_world((JAR[0], 0.14, JAR[1]), desk_pose()))
        if shown("took-card"):
            tap("took-same", card_id="took-card")
    pause(2)

    say("Evening: wind down and end the day")
    tap("winddown-button", from_bottom=38)
    pause(5)
    tap("recap-end", card_id="recap-card")
    pause(4)
    say("Done")


ROOT = "."
if __name__ == "__main__":
    main()
