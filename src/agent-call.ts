/**
 * One request to the agent server with a hard timeout. Any failure (offline, 429, 5xx,
 * timeout, malformed body) returns undefined so callers drop to their local fallback:
 * judges and users never see a dead button.
 */
export async function callAgent<T>(
  url: string,
  body: unknown,
  accept: (json: unknown) => T | undefined,
  options: { timeoutMs: number; fetchImpl?: typeof fetch },
): Promise<T | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    return accept(await response.json());
  } catch {
    return undefined; // offline, aborted by the timeout, or not JSON
  } finally {
    clearTimeout(timer);
  }
}

/** The calm line shown when the local fallback stood in for the agent. */
export const LOCAL_FALLBACK_LINE = "The agent's busy, so here's a quick local version.";
