/**
 * @file packages/llm/tests/unit/ollama-gate.ts
 * @description Shared gate for the live-Ollama tests. A reachable daemon is not
 * enough: an unrelated daemon with no models answers /api/tags with
 * `{"models":[]}`, so live tests must also require the needed model to be listed.
 */

const TAGS_URL = 'http://localhost:11434/api/tags';

type FetchLike = (url: string, init?: { method?: string }) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

/** True when GET /api/tags answers ok (daemon up, any model list). */
export async function ollamaReachable(fetchImpl: FetchLike = fetch as FetchLike): Promise<boolean> {
  try {
    const res = await fetchImpl(TAGS_URL, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * True only when /api/tags is ok AND lists `model` exactly (as the `name` or
 * `model` field, the same strings the adapter and the daemon use; no implicit
 * ":latest" expansion because the adapter does none).
 */
export async function ollamaHasModel(
  model: string,
  fetchImpl: FetchLike = fetch as FetchLike,
): Promise<boolean> {
  try {
    const res = await fetchImpl(TAGS_URL, { method: 'GET' });
    if (!res.ok) return false;
    const body = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
    if (!Array.isArray(body?.models)) return false;
    return body.models.some((m) => m?.name === model || m?.model === model);
  } catch {
    return false;
  }
}
