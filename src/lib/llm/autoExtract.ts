/**
 * Auto-extract orchestrator — Slice 5c (AC-AUTO-EXTRACT + AC-EVIDENCE-REUSE +
 * AC-GRACEFUL).
 *
 * Authority: agreed_contract.json#AC-AUTO-EXTRACT + AC-EVIDENCE-REUSE +
 *            AC-GRACEFUL.
 *
 * This is the single seam where the auto-LLM provider plugs into the EXISTING
 * 5b copy-paste pipeline. It automates the manual round trip while reusing the
 * exact same trust boundary:
 *
 *     buildPrompt(input)            ← 5b promptBuilder (BYTE-IDENTICAL to manual)
 *       → provider.runExtraction()  ← auto: proxy LLM call / manual: no-op
 *       → parseResponse(rawText)    ← 5b responseParser (tolerant JSON extract)
 *       → validateResponse(parsed,  ← 5b responseValidator (chunk_id ANTI-FORGERY
 *           knownChunkIds)             gate — a hallucinated chunk_id is REJECTED)
 *
 * The returned `ValidationResult` is the SAME type the manual BridgePanel
 * produces, so the import path (`buildEntryFromValidated`, original-text
 * preservation) is reused with ZERO changes. A forged chunk_id from the auto
 * LLM is rejected identically to a forged chunk_id from a manual paste — that is
 * the whole point of AC-EVIDENCE-REUSE.
 *
 * Graceful degradation (AC-GRACEFUL): if the provider degrades (no codex / proxy
 * down / call failed), this returns `{ degraded: true, message }` and the caller
 * shows the copy-paste UI. The validator is NEVER bypassed and forged evidence
 * NEVER reaches the wiki on any path.
 */

import { buildPrompt, type PromptInput } from '$lib/bridge/promptBuilder';
import { parseResponse } from '$lib/bridge/responseParser';
import { validateResponse, type ValidationResult } from '$lib/bridge/responseValidator';
import type { ExtractionProvider } from './provider';

/** Outcome of an auto-extract attempt. */
export type AutoExtractOutcome =
  | { ok: true; result: ValidationResult; rawText: string }
  | { ok: false; degraded: boolean; message: string };

/**
 * Run the auto extraction for ONE candidate through the given provider, then
 * validate the reply against the REAL uploaded chunk_ids (anti-forgery). The
 * `knownChunkIds` MUST be scoped to the candidate's own source (same as the
 * manual bridge) so evidence can only bind within that source.
 *
 * Pure orchestration apart from the single `provider.runExtraction` call; the
 * parse + validate steps are the deterministic 5b functions.
 */
export async function autoExtractCandidate(
  provider: ExtractionProvider,
  input: PromptInput,
  knownChunkIds: string[],
): Promise<AutoExtractOutcome> {
  // 1. Build the SAME prompt the manual path copies to chatgpt.com.
  const prompt = buildPrompt(input);

  // 2. Provider produces the raw reply text (or degrades).
  const extraction = await provider.runExtraction(prompt);
  if (!extraction.ok) {
    return { ok: false, degraded: extraction.degraded, message: extraction.message };
  }

  // 3. Parse with the 5b tolerant parser (handles ```json fences / prose).
  const parsed = parseResponse(extraction.rawText);
  if (!parsed.ok) {
    // Treat a malformed auto reply as a degradation: the user can fall back to
    // copy-paste and inspect/repair the reply manually. We DO NOT swallow the
    // reason — the Korean parser message carries the cause.
    return {
      ok: false,
      degraded: true,
      message: `자동 LLM 응답을 해석하지 못했습니다: ${parsed.message} 복붙 모드로 다시 시도할 수 있습니다.`,
    };
  }

  // 4. Validate with the 5b anti-forgery validator — UNCHANGED. A forged
  //    chunk_id is rejected here exactly as in the manual paste path.
  const result = validateResponse(parsed.value, knownChunkIds);
  return { ok: true, result, rawText: extraction.rawText };
}
