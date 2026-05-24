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
  | { ok: true; value: unknown; recovered?: boolean; recoveredCount?: number }
  | { ok: false; message: string };

function extractJsonBody(raw: string): string {
  // 1. Prefer a fenced block (```json … ``` or ``` … ```).
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fence ? fence[1] : raw;

  // 2. Trim surrounding prose to the outermost JSON object braces.
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start >= 0 && end > start) {
    body = body.slice(start, end + 1);
  }
  return body.trim();
}

function findWikiCandidatesArrayStart(body: string): number {
  const match = /"wiki_candidates"\s*:/.exec(body);
  if (!match) return -1;
  return body.indexOf('[', match.index + match[0].length);
}

function scanCompleteObject(body: string, start: number): { text: string; end: number } | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return { text: body.slice(start, i + 1), end: i + 1 };
      }
    }
  }
  return null;
}

/**
 * Recover complete candidate objects from a truncated/malformed
 * `{ "wiki_candidates": [ ... ] }` reply. This is deliberately narrow:
 * only fully balanced candidate objects are parsed, then the normal validator
 * still decides whether each one can be imported.
 */
function recoverWikiCandidates(body: string): ParseResult | null {
  const arrayStart = findWikiCandidatesArrayStart(body);
  if (arrayStart < 0) return null;

  const wiki_candidates: unknown[] = [];
  let i = arrayStart + 1;
  while (i < body.length) {
    const ch = body[i];
    if (/\s|,/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === ']') break;
    if (ch !== '{') {
      i += 1;
      continue;
    }

    const scanned = scanCompleteObject(body, i);
    if (!scanned) break;
    try {
      wiki_candidates.push(JSON.parse(scanned.text));
    } catch {
      // A balanced but invalid object is still untrusted. Skip it and keep
      // looking for later complete objects rather than importing partial data.
    }
    i = scanned.end;
  }

  if (wiki_candidates.length === 0) return null;
  return {
    ok: true,
    value: { wiki_candidates },
    recovered: true,
    recoveredCount: wiki_candidates.length,
  };
}

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

  let body = extractJsonBody(text);
  if (body.length === 0) {
    return { ok: false, message: 'JSON 객체를 찾지 못했습니다. ChatGPT가 출력한 JSON 전체를 붙여넣으세요.' };
  }

  try {
    const value = JSON.parse(body);
    return { ok: true, value };
  } catch (err) {
    const recovered = recoverWikiCandidates(body);
    if (recovered) return recovered;

    const reason = (err as Error)?.message ?? String(err);
    return {
      ok: false,
      message: `JSON 파싱에 실패했습니다(${reason}). 응답이 잘렸는지, 따옴표/쉼표가 올바른지 확인하세요.`,
    };
  }
}
