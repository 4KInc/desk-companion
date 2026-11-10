/**
 * Fault injection for the agent endpoints (brain dump, split, delegate), so the real client
 * can be tested against 429, 500, a timeout and a dropped connection. Off in production:
 * NODE_ENV=production ignores it unless FAULT_INJECTION=1 is set explicitly.
 */
export type FaultMode = '' | '429' | '500' | 'timeout' | 'offline';

const MODES: readonly FaultMode[] = ['', '429', '500', 'timeout', 'offline'];
/** Longer than the client's 9 s agent timeout, so the client gives up first. */
export const FAULT_TIMEOUT_MS = 12000;

type Env = Record<string, string | undefined>;

/** Set at runtime through /api/__fault (only reachable when injection is enabled). */
let runtimeMode: FaultMode | undefined;

export function faultInjectionEnabled(env: Env = process.env): boolean {
  return env.FAULT_INJECTION === '1' || env.NODE_ENV !== 'production';
}

function parse(value: unknown): FaultMode | undefined {
  return MODES.includes(value as FaultMode) ? (value as FaultMode) : undefined;
}

export function currentFault(env: Env = process.env): FaultMode {
  if (!faultInjectionEnabled(env)) return '';
  return runtimeMode ?? parse(env.FAULT_MODE ?? '') ?? '';
}

export function setFault(mode: FaultMode | undefined): void {
  runtimeMode = mode;
}

/**
 * What an agent endpoint should do under the current fault: a Response to send, 'offline' to
 * drop the connection without answering, or undefined to run normally.
 */
export async function faultResponse(
  mode: FaultMode = currentFault(),
  timeoutMs = FAULT_TIMEOUT_MS,
): Promise<Response | 'offline' | undefined> {
  switch (mode) {
    case '429':
      return Response.json({ error: 'Rate limited (fault injection)' }, { status: 429 });
    case '500':
      return Response.json({ error: 'Agent error (fault injection)' }, { status: 500 });
    case 'timeout':
      await new Promise((resolve) => setTimeout(resolve, timeoutMs));
      return Response.json({ error: 'Timed out (fault injection)' }, { status: 504 });
    case 'offline':
      return 'offline';
    default:
      return undefined;
  }
}

/** POST { mode } sets the fault ('' clears it); GET reports it. Callers must check faultInjectionEnabled(). */
export async function handleFaultControl(request: Request): Promise<Response> {
  if (request.method === 'POST') {
    let body: { mode?: unknown } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ error: 'Expected JSON { mode }' }, { status: 400 });
    }
    const mode = parse(body.mode ?? '');
    if (mode === undefined) return Response.json({ error: `mode must be one of ${MODES.join(', ')}` }, { status: 400 });
    setFault(mode);
  }
  return Response.json({ mode: currentFault() });
}

export const AGENT_PATHS = ['/api/brain-dump', '/api/split-task', '/api/delegate'];
