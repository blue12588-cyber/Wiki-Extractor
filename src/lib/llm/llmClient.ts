/**
 * LLM client wrapper — renderer-side bridge to the Rust llm_cmd commands.
 *
 * Authority: agreed_contract.json#AC-LLM-EXTRACT + AC-CLASSIFY-MAP +
 *            AC-TRANSLATE + AC-OFFLINE.
 *
 * Every method degrades gracefully: on auth/call failure it returns a
 * structured `{ ok: false, degraded, message }` result. The caller keeps
 * view/edit/save fully working; only the LLM-dependent step is skipped, with a
 * clear Korean message. The app NEVER crashes on a failed LLM call.
 *
 * The model id (GPT-5.4) lives in src-tauri/llm.config.json (single source).
 * Outside the Tauri shell (Vite preview), the LLM path is reported as
 * unreachable so the offline fallbacks engage.
 */

import type { Chunk } from '../chunk/chunker';
import type { CandidateItem } from '../extract/candidateExtractor';
import type { CandidateMapping } from '../wiki/wikiBuilder';

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function resolveInvoke(): Invoke | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { __TAURI__?: { core?: { invoke?: Invoke } } };
  const fn = w.__TAURI__?.core?.invoke;
  return typeof fn === 'function' ? fn : null;
}

export interface LlmConfigSnapshot {
  model: string;
  auth: string;
  endpoint_base: string | null;
  reachable: boolean;
}

interface LlmErr {
  kind: string;
  reason: string;
  degraded: boolean;
}

export type LlmResult<T> =
  | { ok: true; value: T }
  | { ok: false; degraded: boolean; message: string };

export async function llmConfig(): Promise<LlmConfigSnapshot> {
  const invoke = resolveInvoke();
  if (!invoke) {
    return { model: 'gpt-5.4', auth: 'oauth_subscription', endpoint_base: null, reachable: false };
  }
  try {
    return await invoke<LlmConfigSnapshot>('llm_config');
  } catch {
    return { model: 'gpt-5.4', auth: 'oauth_subscription', endpoint_base: null, reachable: false };
  }
}

function offlineResult<T>(): LlmResult<T> {
  return {
    ok: false,
    degraded: true,
    message: 'LLM 경로를 사용할 수 없습니다(오프라인/Tauri 외부). 보기·편집·저장은 그대로 동작합니다.',
  };
}

function toResult<T>(err: unknown): LlmResult<T> {
  if (typeof err === 'string') {
    return { ok: false, degraded: true, message: err };
  }
  if (err instanceof Error && err.message) {
    return { ok: false, degraded: true, message: err.message };
  }
  const e = err as Partial<LlmErr>;
  return {
    ok: false,
    degraded: e?.degraded ?? true,
    message: e?.reason ?? 'LLM 호출에 실패했습니다. 보기·편집·저장은 계속 가능합니다.',
  };
}

/** Tolerant JSON extraction: LLMs sometimes wrap JSON in prose / code fences. */
function parseJsonLoose<T>(content: string): T {
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : content;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  const slice = start >= 0 && end > start ? body.slice(start, end + 1) : body;
  return JSON.parse(slice) as T;
}

/** AC-LLM-EXTRACT: run the source-extractor role over chunks. */
export async function llmExtract(chunks: Chunk[]): Promise<LlmResult<CandidateItem[]>> {
  const invoke = resolveInvoke();
  if (!invoke) return offlineResult();
  try {
    const content = await invoke<string>('llm_extract', { args: { chunks_json: JSON.stringify(chunks) } });
    const parsed = parseJsonLoose<{ candidate_items?: unknown[] }>(content);
    const items = Array.isArray(parsed.candidate_items) ? (parsed.candidate_items as CandidateItem[]) : [];
    return { ok: true, value: items };
  } catch (err) {
    return toResult(err);
  }
}

/** AC-CLASSIFY-MAP: map candidates onto outline nodes. */
export async function llmClassify(
  candidates: CandidateItem[],
  outline: Array<{ id: string; title: string; level: number }>,
): Promise<LlmResult<CandidateMapping[]>> {
  const invoke = resolveInvoke();
  if (!invoke) return offlineResult();
  try {
    const content = await invoke<string>('llm_classify', {
      args: { candidates_json: JSON.stringify(candidates), outline_json: JSON.stringify(outline) },
    });
    const parsed = parseJsonLoose<{ mappings?: Array<Record<string, unknown>> }>(content);
    const mappings: CandidateMapping[] = (parsed.mappings ?? []).map((m) => ({
      local_candidate_id: String(m.local_candidate_id ?? ''),
      outline_node_id: (m.outline_node_id as string | null) ?? null,
      recommended_action: String(m.recommended_action ?? 'defer'),
      rationale: String(m.rationale ?? ''),
    }));
    return { ok: true, value: mappings };
  } catch (err) {
    return toResult(err);
  }
}

/** AC-TRANSLATE: Catholic-terminology Korean translation of an original passage.
 *  The original is preserved by the caller; this only returns the translation. */
export async function llmTranslate(originalText: string): Promise<LlmResult<string>> {
  const invoke = resolveInvoke();
  if (!invoke) return offlineResult();
  try {
    const content = await invoke<string>('llm_translate', { args: { original_text: originalText } });
    const parsed = parseJsonLoose<{ translation?: string }>(content);
    return { ok: true, value: String(parsed.translation ?? '') };
  } catch (err) {
    return toResult(err);
  }
}
