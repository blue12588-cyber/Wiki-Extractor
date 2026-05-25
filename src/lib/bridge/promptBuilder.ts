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
 *   [역할 지시] 추측 금지 · chunk_id 근거 필수 · 전공 표준 용어
 *   [SCHEMA]            사용자 목차/위키 스키마 (outline node titles + topic terms)
 *   [CANDIDATE_CHUNKS]  chunk_id / page / text (verbatim — preservation)
 *   [OUTPUT_FORMAT]     wiki_candidates JSON
 *                       (title / type / schema_field / discipline_* /
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
import { MAX_EVIDENCE_QUOTE_CHARS } from './evidenceLimits';

export const PROMPT_VERSION = 'llmwiki-wiki-candidate-json-v3-domain-profile';

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

/** Inputs for a whole-source automatic extraction prompt. */
export interface GlobalPromptInput {
  /** Source chunks to expose to the LLM. Emitted verbatim, in document order. */
  chunks: Chunk[];
  /** User outline node titles and/or free-text topic terms. */
  schema: string[];
}

/**
 * Static role-instruction block (Codex-agreed; Slice-9 강화).
 *
 * The auto-LLM path (codexProvider → autoExtract) and the manual copy-paste path
 * use the BYTE-IDENTICAL prompt this block leads — so the LLM is doing the SAME
 * academic source-extraction the academic source-extractor workflow defines:
 *   - the 7 reusable-knowledge candidate TYPES
 *     (개념/주장/방법/학자/종교텍스트/반론/인용 — harness-core's concept/argument/
 *     method/scholar/religious_text/objection/quotation, renamed for this domain),
 *   - 목차(table-of-contents) CLASSIFICATION: each candidate is classified against
 *     the user's [SCHEMA] outline so the result drops into the user's own
 *     structure (mirrors the candidate-evaluator's outline-node mapping).
 *
 * Catholic terminology stays hard for biblical/religious material; other
 * disciplines use their own standard Korean terminology. The chunk_id
 * anti-forgery instruction is preserved verbatim (responseValidator enforces it
 * as a hard gate — this prompt only ASKS for honest evidence; the validator
 * REJECTS forged chunk_ids).
 */
const ROLE_BLOCK = [
  '너는 개인 학술 위키의 "원문 추출·분류 도우미"다. 아래 [SCHEMA](목차)와 [CANDIDATE_CHUNKS](원문 청크)만 사용한다.',
  '하는 일은 두 가지다. (1) 원문에서 "다시 읽지 않아도 재사용 가능한 지식 단위"를 후보로 뽑는다(전체 요약이 아니라 재사용 단위 우선). (2) 각 후보를 사용자의 목차에 분류한다.',
  '먼저 [SCHEMA]와 원문에서 전공/자료 성격을 추론하라(예: 법학 판례/요건, 의학 기전/근거수준, 역사학 사료/해석, 문학 모티프/비평, 사회과학 개념/변수/연구결과). 이 판단을 discipline_profile 에 짧게 남겨라.',
  '고정 후보 유형은 앱 분류용 큰 틀이다. type은 아래 enum 중 하나로 고르되, discipline_unit에는 그 전공에서 실제로 재사용되는 단위 이름을 자유롭게 적어라(예: 판례 원칙, 실험 결과, 질병 기전, 사료 증언, 비평 개념, 통계 변수, 정책 쟁점).',
  '후보 유형(아래 중 가장 맞는 하나를 골라 reason에 명시): 개념(concept) · 주장(argument) · 방법(method) · 학자/인물(scholar) · 종교 텍스트(religious_text) · 반론(objection) · 인용(quotation) · 기타(other).',
  '분류: 각 후보의 schema_field 에는 [SCHEMA]의 목차 항목 중 가장 잘 맞는 항목을 그대로 적는다. 맞는 항목이 없으면 후보 자체의 주제로 schema_field 를 제안한다(없는 목차 항목을 지어내지 마라). mapping_reason에는 왜 그 목차에 붙였는지 또는 왜 새 주제로 제안했는지 적어라.',
  '목차/장·절 제목/표제, 단독 저자명·편집자명, 참고문헌·각주·색인·판권 조각은 후보로 출력하지 마라. 그런 정보는 구조 파악과 분류에만 사용한다.',
  '추측하지 말고, 반드시 chunk_id를 근거로 표시하라. 각 후보는 evidence 에 최소 1개의 chunk_id 근거를 포함해야 한다.',
  '근거로 제시하는 chunk_id는 아래 [CANDIDATE_CHUNKS]에 실제로 있는 id여야 한다(없는 id를 지어내지 마라). 지어낸 chunk_id는 거부되어 위키에 들어가지 못한다.',
  'quote 에는 해당 chunk_id 청크의 원문을 그대로(축자) 인용하라(요약·바꿔쓰기 금지). 원문 텍스트는 절대 변경하지 마라.',
  '재사용성 판정: "이 후보를 원문을 다시 읽지 않고도 나중에 재사용할 수 있는가?" — 아니면 그 후보는 빼라. reuse_reason에는 이 전공에서 왜 재사용 가능한지 적어라.',
  'boundary_note에는 이 근거만으로 말할 수 없는 한계(단일 사례, 상관/인과, 해석 가능성, 적용 범위 등)를 적어라.',
  'standard_terms에는 원문에 보이는 원어·전문용어·고유명사·약어 중 보존해야 할 핵심 용어를 0~8개 적어라.',
  `이번 응답에서는 중요한 후보 최대 8개만 출력하라. 각 후보의 evidence는 가장 강한 chunk_id 1개만 넣고, quote는 해당 청크 안의 축자 인용 ${MAX_EVIDENCE_QUOTE_CHARS}자 이하로 제한하라. evidence에는 quote에 대응하는 한국어 번역 translation_ko를 함께 넣어라. 많은 후보보다 완성된 JSON을 우선하라.`,
  '한글 번역·요약은 해당 전공의 표준 한국어 용어를 우선하라. 성서학/종교/성경 관련 내용은 가톨릭 용어 우선(개신교 번역 금지). 예: 사사기→판관기, 출애굽기/출애굽→탈출기/탈출, 마가복음→마르코 복음, 마태복음→마태오 복음, 누가복음→루카 복음, 여호와→주님/하느님, 칭의/이신칭의→의화, 은혜→은총. 원어(히브리어/그리스어/라틴어 등) 용어와 원문 제목은 그대로 보존하라.',
  '출력은 아래 [OUTPUT_FORMAT] JSON 형식만 사용하라(코드펜스 ```json 으로 감싸도 된다). 형식 외 다른 텍스트는 출력하지 마라.',
].join('\n');

const GLOBAL_ROLE_BLOCK = [
  '너는 개인 학술 위키의 "원문 추출·분류 도우미"다. 아래 [SCHEMA](목차)와 [CANDIDATE_CHUNKS](원문 청크)만 사용한다.',
  '원문 전체를 한 문서로 요약하지 말고, 나중에 논문/위키에서 재사용 가능한 지식 단위를 여러 후보로 뽑아라.',
  '먼저 [SCHEMA]와 원문에서 전공/자료 성격을 추론하라(예: 법학 판례/요건, 의학 기전/근거수준, 역사학 사료/해석, 문학 모티프/비평, 사회과학 개념/변수/연구결과). 이 판단을 discipline_profile 에 짧게 남겨라.',
  '고정 후보 유형은 앱 분류용 큰 틀이다. type은 아래 enum 중 하나로 고르되, discipline_unit에는 그 전공에서 실제로 재사용되는 단위 이름을 자유롭게 적어라(예: 판례 원칙, 실험 결과, 질병 기전, 사료 증언, 비평 개념, 통계 변수, 정책 쟁점).',
  '후보 유형(아래 중 가장 맞는 하나를 골라 reason에 명시): 개념(concept) · 주장(argument) · 방법(method) · 학자/인물(scholar) · 종교 텍스트(religious_text) · 반론(objection) · 인용(quotation) · 기타(other).',
  '각 후보의 schema_field 에는 [SCHEMA]의 목차 항목 중 가장 잘 맞는 항목을 그대로 적는다. 맞는 항목이 없으면 후보 자체의 주제로 schema_field 를 제안한다(없는 목차 항목을 지어내지 마라). mapping_reason에는 왜 그 목차에 붙였는지 또는 왜 새 주제로 제안했는지 적어라.',
  '목차/장·절 제목/표제, 단독 저자명·편집자명, 참고문헌·각주·색인·판권 조각은 후보로 출력하지 마라. 그런 정보는 구조 파악과 분류에만 사용한다.',
  '추측하지 말고, 반드시 chunk_id를 근거로 표시하라. 각 후보는 evidence 에 최소 1개의 chunk_id 근거를 포함해야 한다.',
  '근거로 제시하는 chunk_id는 아래 [CANDIDATE_CHUNKS]에 실제로 있는 id여야 한다(없는 id를 지어내지 마라). 지어낸 chunk_id는 거부되어 위키에 들어가지 못한다.',
  'quote 에는 해당 chunk_id 청크의 원문을 그대로(축자) 인용하라(요약·바꿔쓰기 금지). 원문 텍스트는 절대 변경하지 마라.',
  '재사용성 판정: "이 후보를 원문을 다시 읽지 않고도 나중에 재사용할 수 있는가?" — 아니면 그 후보는 빼라. reuse_reason에는 이 전공에서 왜 재사용 가능한지 적어라.',
  'boundary_note에는 이 근거만으로 말할 수 없는 한계(단일 사례, 상관/인과, 해석 가능성, 적용 범위 등)를 적어라.',
  'standard_terms에는 원문에 보이는 원어·전문용어·고유명사·약어 중 보존해야 할 핵심 용어를 0~8개 적어라.',
  `이번 응답에서는 중요한 후보 최대 8개만 출력하라. 각 후보의 evidence는 가장 강한 chunk_id 1개만 넣고, quote는 해당 청크 안의 축자 인용 ${MAX_EVIDENCE_QUOTE_CHARS}자 이하로 제한하라. evidence에는 quote에 대응하는 한국어 번역 translation_ko를 함께 넣어라. 많은 후보보다 완성된 JSON을 우선하라.`,
  '한글 번역·요약은 해당 전공의 표준 한국어 용어를 우선하라. 성서학/종교/성경 관련 내용은 가톨릭 용어 우선(개신교 번역 금지). 예: 사사기→판관기, 출애굽기/출애굽→탈출기/탈출, 마가복음→마르코 복음, 마태복음→마태오 복음, 누가복음→루카 복음, 여호와→주님/하느님, 칭의/이신칭의→의화, 은혜→은총. 원어(히브리어/그리스어/라틴어 등) 용어와 원문 제목은 그대로 보존하라.',
  '출력은 아래 [OUTPUT_FORMAT] JSON 형식만 사용하라(코드펜스 ```json 으로 감싸도 된다). 형식 외 다른 텍스트는 출력하지 마라.',
].join('\n');

/** The OUTPUT_FORMAT exemplar (kept in sync with responseValidator). */
const OUTPUT_FORMAT = [
  '{',
  '  "wiki_candidates": [',
  '    {',
  '      "title": "...",',
  '      "type": "concept|argument|method|scholar|religious_text|objection|quotation|other",',
  '      "discipline_profile": "전공/자료 성격(예: 법학/판례, 의학/임상연구, 문학/비평, 역사학/사료해석)",',
  '      "discipline_unit": "이 전공에서의 지식 단위 이름",',
  '      "schema_field": "...",',
  '      "mapping_reason": "...",',
  '      "summary_ko": "...",',
  '      "evidence": [{ "chunk_id": "...", "quote": "...", "translation_ko": "..." }],',
  '      "standard_terms": ["..."],',
  '      "reuse_reason": "...",',
  '      "boundary_note": "...",',
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

/**
 * Build the deterministic whole-source prompt used by the advanced automatic
 * LLM path. The response is still validated by responseValidator before import.
 */
export function buildGlobalPrompt(input: GlobalPromptInput): string {
  const sections: string[] = [];
  sections.push(GLOBAL_ROLE_BLOCK);
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
