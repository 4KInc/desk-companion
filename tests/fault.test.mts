import assert from 'node:assert/strict';
import { currentFault, faultInjectionEnabled, faultResponse, handleFaultControl, setFault } from '../server/fault.ts';

assert.equal(faultInjectionEnabled({ NODE_ENV: 'production' }), false, 'off in production by default');
assert.equal(faultInjectionEnabled({ NODE_ENV: 'production', FAULT_INJECTION: '1' }), true, 'explicit opt-in');
assert.equal(faultInjectionEnabled({ NODE_ENV: 'development' }), true);
assert.equal(currentFault({ NODE_ENV: 'production', FAULT_MODE: '429' }), '', 'FAULT_MODE ignored in production');
assert.equal(currentFault({ NODE_ENV: 'development', FAULT_MODE: '429' }), '429');
assert.equal(currentFault({ NODE_ENV: 'development', FAULT_MODE: 'bogus' }), '', 'unknown modes are ignored');

assert.equal((await faultResponse('429')) instanceof Response && ((await faultResponse('429')) as Response).status, 429);
assert.equal(((await faultResponse('500')) as Response).status, 500);
assert.equal(await faultResponse('offline'), 'offline');
assert.equal(await faultResponse(''), undefined);
const started = Date.now();
assert.equal(((await faultResponse('timeout', 50)) as Response).status, 504);
assert.ok(Date.now() - started >= 45, 'timeout mode waits');

const post = (mode: unknown) => handleFaultControl(new Request('http://x/api/__fault', { method: 'POST', body: JSON.stringify({ mode }) }));
process.env.NODE_ENV = 'development';
assert.deepEqual(await (await post('timeout')).json(), { mode: 'timeout' });
assert.equal((await post('nope')).status, 400);
assert.deepEqual(await (await post('')).json(), { mode: '' }, 'empty clears');
setFault(undefined);
console.log('fault injection: all assertions passed');
