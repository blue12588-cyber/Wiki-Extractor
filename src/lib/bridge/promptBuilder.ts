/**
 * ChatGPT copy-paste prompt builder — Slice 5b (AC-PROMPT-BUILD).
 *
 * Authority: agreed_contract.json#AC-PROMPT-BUILD + AC-OFFLINE-CORE.
 *
 * Turns ONE rule-engine candidate (plus the chunks that back it and the user's
 * outline/topic schema) into a single deterministic TEXT prompt the user copies
 * into chatgpt.com. The app NEVER calls the LLM itself (5b is copy-paste only);
 * this module only assembles the text.
 *
 * Codex-agreed prompt shape:
 *   [역할 지시] 추측 금지 · chunk_id 근거 필수 · 가톨릭 용어 우선(개신교 금지)
 *   [SCHEMA]            사용자 목차/위키 스키마 (outline node titles + topic terms)
 *   [CANDIDATE_CHUNKS]  chunk_id / page / text (verbatim — preservation)
 *   [OUTPUT_FORMAT]     wiki_candidates JSON
 *                       (title / schema_field / summary_ko /
 *                        evidence[chunk_id + quote] / confidence / reason)
 *
 * Determinism contract:
 *   - Pure function of its inputs. No Date, no random, no I/O, no network.
 *   - Chunks are emitted in document order (the order they are passed in).
 *   - The same (candidate, chunks, schema) → byte-identical prompt text.
 *
 * Offline guarantee: this module imports zero network/LLM symbols. The
 * `T1-slice5b offline-no-network` scenario asserts that statically.
 */

import type { ScoredCandidate } from '../candidate/scoringEngine';
import type { Chunk } from '../chunk/chunker';

/** Inputs for one candidate's copy-paste prompt. */
export interface PromptInput {
  /** The rule-engine candidate the user is sending to ChatGPT. */
  candidate: ScoredCandidate;
  /**
   * Chunks to include as CANDIDATE_CHUNKS. The caller selects which chunks back
   * the candidate (at minimum the chunk that contains the candidate span; the
   * user may add adjacent chunks). Emitted verbatim, in the given order.
   */
  chunks: Chunk[];
  /**
   * Schema lines — the user's outline node titles and/or free-text topic terms.
   * Shown under [SCHEMA] so ChatGPT classifies into the user's own structure.
   */
  schema: string[];
}

/** Static role-instruction block (Codex-agreed). Catholic terminology default. */
const ROLE_BLOCK = [
  '너는 개인 학술 위키 후보 정리 도우미다.',
  '아래 스키마와 후보 청크만 사용해서 위키 후보를 뽑아라.',
  '추측하지 말고, 반드시 chunk_id를 근거로 표시하라.',
  '근거로 제시하는 chunk_id는 아래 [CANDIDATE_CHUNKS]에 실제로 있는 id여야 한다(없는 id를 지어내지 마라).',
  '한글 번역은 가톨릭 용어 우선(개신교 번역 금지).',
  '출력은 아래 JSON 형식만 사용하라(코드펜스 ```json 으로 감싸도 된다).',
].join('\n');

/** The OUTPUT_FORMAT exemplar (kept in sync with responseValidator). */
const OUTPUT_FORMAT = [
  '{',
  '  "wiki_candidates": [',
  '    {',
  '      "title": "...",',
  '      "schema_field": "...",',
  '      "summary_ko": "...",',
  '      "evidence": [{ "chunk_id": "...", "quote": "..." }],',
  '      "confidence": "high|medium|low",',
  '      "reason": "..."',
  '    }',
  '  ]',
  '}',
].join('\n');

function schemaBlock(schema: string[]): string {
  const cleaned = schema.map((s) => s.trim()).filter((s) => s.length > 0);
  if (cleaned.length === 0) {
    // No outline / topic terms supplied — say so explicitly so ChatGPT does not
    // hallucinate a structure. Deterministic single line.
    return '(사용자 목차/주제어가 입력되지 않았습니다. 후보 자체의 주제로 schema_field 를 제안하세요.)';
  }
  return cleaned.map((s) => `- ${s}`).join('\n');
}

function chunkBlock(chunks: Chunk[]): string {
  if (chunks.length === 0) {
    return '(근거 청크가 없습니다.)';
  }
  return chunks
    .map((c) => {
      const page = c.location.page == null ? '(없음)' : String(c.location.page);
      // Verbatim chunk text — preservation invariant. Indented two spaces so the
      // block is readable; the text itself is NOT mutated.
      const body = c.text.split('\n').map((ln) => `    ${ln}`).join('\n');
      return [`- chunk_id: ${c.chunk_id}`, `  page: ${page}`, '  text:', body].join('\n');
    })
    .join('\n');
}

/**
 * Build the deterministic copy-paste prompt for one candidate. Pure.
 */
export function buildPrompt(input: PromptInput): string {
  const cand = input.candidate.candidate;
  const sections: string[] = [];
  sections.push(ROLE_BLOCK);
  sections.push('');
  sections.push(`[CANDIDATE]`);
  sections.push(`- title: ${cand.title}`);
  sections.push(`- type: ${cand.type}`);
  if (input.candidate.target_entry_title) {
    sections.push(`- 관련 기존 항목: ${input.candidate.target_entry_title}`);
  }
  sections.push('');
  sections.push('[SCHEMA]');
  sections.push(schemaBlock(input.schema));
  sections.push('');
  sections.push('[CANDIDATE_CHUNKS]');
  sections.push(chunkBlock(input.chunks));
  sections.push('');
  sections.push('[OUTPUT_FORMAT]');
  sections.push(OUTPUT_FORMAT);
  return sections.join('\n');
}

/** The set of chunk_ids that a prompt presented to ChatGPT (for binding check). */
export function promptChunkIds(input: PromptInput): string[] {
  return input.chunks.map((c) => c.chunk_id);
}
