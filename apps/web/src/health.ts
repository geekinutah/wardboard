/** The subset of a fetch `Response` the shell needs. */
export type HealthResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

/** Asks the server for its health. Injectable so tests need no network. */
export type HealthClient = () => Promise<HealthResponse>;

export type HealthState = 'pending' | 'ok' | 'unreachable';

export const HEALTH_PATH = '/api/health';

/** Same-origin `GET /api/health`. Reads `fetch` at call time so it can be stubbed at the global boundary. */
export const defaultHealthClient: HealthClient = () =>
  fetch(HEALTH_PATH, { headers: { accept: 'application/json' } });

function isOkBody(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok';
}

/** `ok` only for a 200 whose JSON body is `{"status":"ok"}`; anything else, including errors, is `unreachable`. */
export async function checkHealth(client: HealthClient): Promise<Exclude<HealthState, 'pending'>> {
  try {
    const response = await client();
    if (response.status !== 200) return 'unreachable';
    return isOkBody(await response.json()) ? 'ok' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}
