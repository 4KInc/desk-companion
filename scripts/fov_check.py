#!/usr/bin/env python3
"""Angular offsets of the desk UI from a seated user's resting gaze, for a centred tray and an
off-centre one (before and after the panel/buddy swing in src/fov-swing.ts).

Reference gaze: from the seated eye to the tray's back edge where the panel meets it (about 37
degrees below horizontal), the natural resting point between the panel and the work on the
tray. Target: within +-25 deg horizontally and +-20 deg vertically. Reads positions from
public/scenes/main.iwsdk.scene.json and the bubble offset from src/companion.ts.
"""
import json, math, re, sys

LIMIT_H, LIMIT_V = 25.0, 20.0
EYE_ABOVE_DESK, TRAY_REACH = 0.5, 0.45          # DeskPlacementSystem: tray centre 0.45 m in front
FOCUS_SPOT = (0.0, 0.2, 0.1)                    # planner-system.ts FOCUS_SPOT (tray-local)
TIMER = (FOCUS_SPOT[0], FOCUS_SPOT[1] + 0.01, FOCUS_SPOT[2] - 0.02)

scene = json.load(open('public/scenes/main.iwsdk.scene.json'))
companion = open('src/companion.ts').read()
offset = {k: float(v) for k, v in re.findall(r'(inward|up|forward): ([\d.]+)', companion.split('BUBBLE_OFFSET =')[1].split('}')[0])}

def node(nodes, node_id):
    for n in nodes:
        if n.get('id') == node_id:
            return n
        found = node(n.get('children', []), node_id)
        if found:
            return found

panel = tuple(node(scene['nodes'], 'planner-panel')['transform']['position'])
buddy = tuple(node(scene['nodes'], 'desk-buddy')['transform']['position'])
jar = tuple(node(scene['nodes'], 'done-jar')['transform']['position'])

def norm(v):
    length = math.sqrt(sum(c * c for c in v))
    return tuple(c / length for c in v)

def tray_to_world(local, tray_pos, yaw):
    x, y, z = local
    c, s = math.cos(yaw), math.sin(yaw)
    return (tray_pos[0] + x * c + z * s, tray_pos[1] + y, tray_pos[2] - x * s + z * c)

def rotate_about(p, pivot, a):  # same as src/fov-swing.ts rotateAbout
    dx, dz = p[0] - pivot[0], p[2] - pivot[2]
    c, s = math.cos(a), math.sin(a)
    return (pivot[0] + dx * c + dz * s, p[1], pivot[2] - dx * s + dz * c)

def scene_points(tray_pos, yaw, swing, head):
    """World positions of the key UI; panel, buddy and bubble swung about the head by `swing`."""
    world = lambda local: tray_to_world(local, tray_pos, yaw)
    swung = lambda p: rotate_about(p, head, swing)
    b = (buddy[0], 0.08, buddy[2])
    bubble = (buddy[0] - math.copysign(offset['inward'], buddy[0]), buddy[1] + offset['up'], buddy[2] + offset['forward'])
    return {
        'panel centre': swung(world(panel)),
        'buddy': swung(world(b)),
        'buddy bubble': swung(world(bubble)),
        'done jar': world((jar[0], 0.07, jar[2])),
        'focus timer': swung(world(TIMER)),  # planner-system focusSpot() swings it too
        'tray centre': world((0.0, 0.0, 0.0)),
    }

def angles(p, head, forward_yaw):
    # resting gaze: toward the tray back edge, straight ahead of the head
    target = (head[0] - math.sin(forward_yaw) * (TRAY_REACH + 0.18), head[1] - EYE_ABOVE_DESK + 0.02, head[2] - math.cos(forward_yaw) * (TRAY_REACH + 0.18))
    f = norm(tuple(t - h for t, h in zip(target, head)))
    r = norm((math.cos(forward_yaw), 0.0, -math.sin(forward_yaw)))
    u = norm((r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]))
    d = tuple(a - b for a, b in zip(p, head))
    x, y, z = (sum(a * b for a, b in zip(d, axis)) for axis in (r, u, f))
    return math.degrees(math.atan2(x, z)), math.degrees(math.atan2(y, z))

def off_axis(head, point):  # head-forward is -Z (forward_yaw 0); positive = left
    return math.atan2(-(point[0] - head[0]), -(point[2] - head[2]))

def swing_for(theta, limit=math.radians(LIMIT_H)):
    return 0.0 if abs(theta) <= limit else -(theta - math.copysign(limit, theta))

def report(title, tray_pos, swing_enabled=True):
    head = (0.0, EYE_ABOVE_DESK, 0.0)
    yaw = math.atan2(head[0] - tray_pos[0], head[2] - tray_pos[2])  # tray faces the user
    theta = off_axis(head, tray_pos)
    swing = swing_for(theta) if swing_enabled else 0.0
    print(f'\n{title}: tray centre {math.degrees(theta):+.1f} deg off head-forward, swing {math.degrees(swing):+.1f} deg')
    bad = 0
    for name, p in scene_points(tray_pos, yaw, swing, head).items():
        h, v = angles(p, head, 0.0)
        info = name in ('tray centre', 'done jar') and abs(theta) > math.radians(LIMIT_H)
        outside = (abs(h) > LIMIT_H or abs(v) > LIMIT_V) and name != 'tray centre'
        note = '  (stays with the tray: placed there by the user)' if info else ('  <-- outside' if outside else '')
        if outside and not info:
            bad += 1
        print(f'  {name:13} {h:+6.1f} H {v:+6.1f} V{note}')
    return bad

bad = report('Centred tray', (0.0, 0.0, -TRAY_REACH))
OFF_CENTRE = (0.55 * math.sin(math.radians(45)), 0.0, -0.55 * math.cos(math.radians(45)))  # 45 deg to the right
report('Off-centre tray, 45 deg right, without the swing', OFF_CENTRE, swing_enabled=False)
bad += report('Off-centre tray, 45 deg right, with the swing', OFF_CENTRE)
print('\nall key UI inside the cone' if bad == 0 else f'\n{bad} item(s) outside the cone')
sys.exit(1 if bad else 0)
