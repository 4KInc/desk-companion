#!/usr/bin/env python3
"""Angular offsets of key desk UI from a seated gaze at the tray centre.

Reads public/scenes/main.iwsdk.scene.json and the bubble offset in src/companion.ts.
The seated head is modelled where DeskPlacementSystem puts it relative to the tray:
0.45 m in front and 0.5 m above the desk. Target: within about +-25 deg horizontally
and +-20 deg vertically (the panel is a deliberate glance up, like a monitor).
"""
import json, math, re

scene = json.load(open('public/scenes/main.iwsdk.scene.json'))
companion = open('src/companion.ts').read()
offset = dict(re.findall(r'(inward|up|forward): ([\d.]+)', companion.split('BUBBLE_OFFSET =')[1].split('}')[0]))
offset = {k: float(v) for k, v in offset.items()}

def find(nodes, node_id):
    for n in nodes:
        if n.get('id') == node_id:
            return n
        r = find(n.get('children', []), node_id)
        if r:
            return r

head, target = (0.0, 0.5, 0.45), (0.0, 0.0, 0.0)
def norm(v):
    length = math.sqrt(sum(c * c for c in v))
    return tuple(c / length for c in v)
f = norm(tuple(t - h for t, h in zip(target, head)))
r = (1.0, 0.0, 0.0)
u = norm((r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]))
def angles(p):
    d = tuple(a - b for a, b in zip(p, head))
    x, y, z = (sum(a * b for a, b in zip(d, axis)) for axis in (r, u, f))
    return round(math.degrees(math.atan2(x, z)), 1), round(math.degrees(math.atan2(y, z)), 1)

panel = find(scene['nodes'], 'planner-panel')['transform']
buddy = find(scene['nodes'], 'desk-buddy')['transform']['position']
jar = find(scene['nodes'], 'done-jar')['transform']['position']
bubble = (buddy[0] - math.copysign(offset['inward'], buddy[0]), buddy[1] + offset['up'], buddy[2] + offset['forward'])
points = {
    'panel centre': tuple(panel['position']),
    'buddy': (buddy[0], 0.08, buddy[2]),
    'buddy bubble': bubble,
    'done jar': (jar[0], 0.07, jar[2]),
    'tray left edge': (-0.3, 0.0, 0.0),
    'tray right edge': (0.3, 0.0, 0.0),
}
for name, p in points.items():
    h, v = angles(p)
    flag = '' if abs(h) <= 27 and (abs(v) <= 20 or name == 'panel centre') else '  <-- outside'
    print(f'{name:15} {h:6.1f} deg horizontal {v:6.1f} deg vertical{flag}')
