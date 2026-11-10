#!/usr/bin/env python3
"""Live fallback test: the real client against injected agent faults.

For each fault mode (429, 500, timeout, offline) it runs a brain dump (2D page), a split
and a delegation (XR, emulated hands), then clears the fault and checks the agent is used
again. For every step it records the status line, whether the buddy said the calm fallback
line, and whether the action completed (no dead buttons). Results: artifacts/fault-test.json.

Needs `npm run dev` (fault injection is on in development and off in production).
Usage: python3 scripts/fault_test.py [429 500 timeout offline none]   (default: all, then none)
"""
import json, subprocess, sys, time
sys.path.insert(0, 'scripts')
import demo_run as d

d.ROOT = '.'
URL = 'https://localhost:8081/api/__fault'
FALLBACK = "The agent's busy, so here's a quick local version."


def set_fault(mode):
    out = subprocess.run(['curl', '-sk', '-X', 'POST', URL, '-H', 'content-type: application/json', '-d', json.dumps({'mode': mode})],
                         capture_output=True, text=True).stdout
    assert json.loads(out)['mode'] == mode, out


def buddy_lines(since_ms=0):
    """What the buddy said since `since_ms` (epoch ms). The log is a rolling window, so match by time, not count."""
    out = subprocess.run(['npx', '@iwsdk/cli', 'browser', 'logs', '--input-json', json.dumps({'count': 200})], capture_output=True, text=True).stdout
    try:
        logs = json.loads(out)['data']['result']
        logs = logs if isinstance(logs, list) else logs.get('logs', logs.get('entries', []))
    except (ValueError, KeyError):
        return []
    return [entry.get('message', '')[8:] for entry in logs
            if entry.get('message', '').startswith('[buddy] ') and entry.get('timestamp', 0) >= since_ms]


def status():
    element = d.panel_layout('status-text')
    return element['text'] if element else ''


def wait_status(done, seconds=20):
    end = time.time() + seconds
    while time.time() < end:
        text = status()
        if done(text):
            return text
        time.sleep(1)
    return status()


def step(name, expect_agent, action, done):
    started = time.time()
    action()
    text = wait_status(done)
    said = buddy_lines(since_ms=started * 1000 - 500)
    result = {
        'step': name,
        'status': text,
        'completed': done(text),
        'seconds': round(time.time() - started, 1),
        'fallback_line': FALLBACK in said,
        'used_agent': text.startswith('Agent'),
    }
    result['pass'] = result['completed'] and (result['used_agent'] if expect_agent else (result['fallback_line'] and not result['used_agent']))
    print(f"   {name:10} {'PASS' if result['pass'] else 'FAIL'}  {result['seconds']:5}s  fallback line: {result['fallback_line']}  | {text}")
    return result


def run(mode):
    expect_agent = mode == ''
    print(f"\n== fault: {mode or 'none (recovery)'}")
    set_fault(mode)
    d.cli('browser', 'interact', payload={'steps': [{'action': 'press', 'key': 'Alt+Shift+KeyR'}]})
    time.sleep(6)
    d.cli('runtime', 'wait', payload={'timeoutMs': 20000})
    results = [step('brain dump', expect_agent,
                    lambda: d.cli('browser', 'interact', payload={'steps': [
                        {'action': 'click', 'locator': {'role': 'button', 'name': 'Use an example'}},
                        {'action': 'click', 'locator': {'role': 'button', 'name': 'Make tiles'}}]}),
                    lambda t: 'tiles' in t and 'Sorting' not in t)]
    d.cli('xr', 'enter', payload={})
    time.sleep(5)
    d.cli('xr', 'set-input-mode', payload={'mode': 'hand'})
    d.cli('xr', 'set-transform', payload={'device': 'headset', 'position': d.SEATED_HEAD})
    d.cli('xr', 'look-at', payload={'device': 'headset', 'target': d.desk_to_world((0, 0.05, -0.05), d.desk_pose())})
    d.hand_rest()
    d.tap('add-120', row_id='add-row')  # a 2h tile always earns a split offer
    big = d.first_tile('inbox', min_minutes=120)

    def split():
        d.to_zone(big, 'now')
        if d.shown('split-card'):
            d.tap('split-accept', card_id='split-card')
    results.append(step('split', expect_agent, split, lambda t: ' into ' in t and 'steps' in t))
    if d.shown('nudge-card'):
        d.tap('nudge-dismiss', card_id='nudge-card')
    small = d.first_tile('inbox') or d.first_tile('later')
    results.append(step('delegate', expect_agent,
                        lambda: d.carry(small, d.desk_to_world((d.BUDDY[0], 0.09, d.BUDDY[1]), d.desk_pose()), duration=1.0),
                        lambda t: 'drafted' in t or 'head start' in t))
    if d.shown('draft-card'):
        d.tap('draft-close', card_id='draft-card')
    # No dead buttons: an ordinary panel button still answers right after the fault.
    capacity = d.panel_layout('capacity-text')['text']
    d.tap('hours-up', from_top=20)
    results.append({'step': 'buttons live', 'pass': d.panel_layout('capacity-text')['text'] != capacity})
    print(f"   buttons    {'PASS' if results[-1]['pass'] else 'FAIL'}  (+1h still answers after the fault)")
    d.cli('xr', 'exit', payload={})
    time.sleep(2)
    return {'mode': mode or 'recovery', 'results': results}


def main():
    modes = sys.argv[1:] or ['429', '500', 'timeout', 'offline', '']
    report = [run('' if mode == 'none' else mode) for mode in modes]
    set_fault('')
    with open('artifacts/fault-test.json' if len(sys.argv) == 1 else 'artifacts/fault-test-rerun.json', 'w') as f:
        json.dump(report, f, indent=2)
    failed = [f"{r['mode']}:{s['step']}" for r in report for s in r['results'] if not s['pass']]
    print('\nALL PASS' if not failed else f"\nFAILED: {', '.join(failed)}")


if __name__ == '__main__':
    main()
