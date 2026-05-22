/**
 * ChatGPT response parser — Slice 5b (AC-PASTE-PARSE).
 *
 * Authority: agreed_contract.json#AC-PASTE-PARSE + AC-OFFLINE-CORE.
 *
 * The user pastes ChatGPT's reply into a textarea. ChatGPT commonly wraps JSON
 * in a ```json … ``` code fence and/or surrounds it with prose. This module
 * tolerantly extracts the JSON object and parses it. It does NOT validate the
 * SHAPE (that is responseValidator) — it only turns text → an `unknown` object
 * or a clear Korean parse error.
 *
 * Pure: no I/O, no network, no LLM. Same text → same result.
 */

export type ParseResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

/**
 * Tolerantly extract the JSON body from a pasted ChatGPT reply:
 *   1. If a ```json … ``` (or bare ``` … ```) fence exists, use its contents.
 *   2. Otherwise, slice from the first `{` to the last `}` to drop prose.
 *   3. Parse. On failure return a Korean error (never throw).
 */
export function parseResponse(raw: string): ParseResult {
  const text = (raw ?? '').trim();
  if (text.length === 0) {
    return { ok: false, message: '붙여넣은 내용이 비어 있습니다. ChatGPT 응답(JSON)을 붙여넣으세요.' };
  }

  // 1. Prefer a fenced block (```json … ``` or ``` … ```).
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fence ? fence[1] : text;

  // 2. Trim surrounding prose to the outermost JSON object braces.
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start >= 0 && end > start) {
    body = body.slice(start, end + 1);
  }

  body = body.trim();
  if (body.length === 0) {
    return { ok: false, message: 'JSON 객체를 찾지 못했습니다. ChatGPT가 출력한 JSON 전체를 붙여넣으세요.' };
  }

  try {
    const value = JSON.parse(body);
    return { ok: true, value };
  } catch (err) {
    const reason = (err as Error)?.message ?? String(err);
    return {
      ok: false,
      message: `JSON 파싱에 실패했습니다(${reason}). 응답이 잘렸는지, 따옴표/쉼표가 올바른지 확인하세요.`,
    };
  }
}
