/**
 * Extraction diagnostic report — safe-by-default payload for feedback.
 *
 * The report is intended for opt-in study / pre-disclosed distribution. It
 * never includes API keys, OAuth tokens, auth.json contents, or local absolute
 * paths. Source identity is reduced to the app's source hash/id. Advanced raw
 * LLM fields are emitted only when `includeAdvancedDebug` is true.
 */

import type { CandidateBundle, CandidateItem, CandidateType } from '$lib/extract/candidateExtractor';
import type { TextQualityReport } from '$lib/extract/textQuality';
import type { Chunk } from '$lib/chunk/chunker';
import type { ParsedOutline, OutlineNode } from '$lib/outline/outlineParser';
import type { WikiEntry } from '$lib/wiki/wikiTypes';
import type { CandidateCardModel } from '$lib/candidate/candidateEngine';
import type { RecommendedAction } from '$lib/candidate/scoringEngine';
import type { LlmConfigSnapshot } from '$lib/llm/llmClient';
import type { Confidence, ValidatedCandidate } from '$lib/bridge/responseValidator';
import { tokenSimilarity } from '$lib/candidate/keywordMatch';

export const EXTRACTION_REPORT_SCHEMA = 'llmwiki.extraction_diagnostic_report.v1';

export interface AutoLlmCandidateTrace {
  index: number;
  title: string;
  type: CandidateType | null;
  discipline_profile: string;
  discipline_unit: string;
  schema_field: string;
  mapping_reason: string;
  confidence: Confidence | null;
  importable: boolean;
  violations: string[];
  standard_terms: string[];
  reuse_reason: string;
  boundary_note: string;
  evidence: Array<{
    chunk_id: string;
    quote_excerpt: string;
    translation_ko_excerpt: string;
  }>;
  rejected_evidence: Array<{
    claimed_chunk_id: string;
    reason: string;
  }>;
}

export interface AutoLlmBatchTrace {
  source_id: string;
  batch_index: number;
  total_batches: number;
  chunk_orders: number[];
  chunk_ids: string[];
  prompt_version: string;
  prompt_char_count: number;
  raw_response: string | null;
  provider_ok: boolean;
  provider_error: string | null;
  parse_ok: boolean;
  parse_error: string | null;
  parse_recovered: boolean;
  parse_recovered_count: number | null;
  validation_shape_ok: boolean | null;
  validation_top_level_error: string | null;
  candidates: AutoLlmCandidateTrace[];
}

export interface BuildExtractionReportInput {
  bundle: CandidateBundle | null;
  chunks: Chunk[];
  textQuality: TextQualityReport | null;
  outline: ParsedOutline | null;
  entries: WikiEntry[];
  candidateCards: CandidateCardModel[];
  llmCfg: LlmConfigSnapshot;
  autoWikiProgress: {
    source_id: string;
    outline_signature: string;
    nextBatch: number;
    totalBatches: number;
    imported: number;
    mapped: number;
    updated_at: string;
  } | null;
  autoLlmTraces: AutoLlmBatchTrace[];
  includeAdvancedDebug: boolean;
}

type StepStatus = 'passed' | 'blocked' | 'warning' | 'not_applicable';

interface StepJudgment {
  step: string;
  status: StepStatus;
  reason: string;
}

function compact(text: string): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function excerpt(text: string, max = 360): string {
  const clean = compact(text);
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function countBy<T extends string>(items: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[item] = (out[item] ?? 0) + 1;
  return out;
}

function outlineLabel(node: OutlineNode): string {
  return node.label ? `${node.label} ${node.title}` : node.title;
}

function compactForMatch(text: string): string {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function bigramSimilarity(a: string, b: string): number {
  const ca = compactForMatch(a);
  const cb = compactForMatch(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;
  if (ca.length >= 3 && cb.length >= 3 && (ca.includes(cb) || cb.includes(ca))) return 0.92;
  const grams = (s: string) => {
    const out = new Set<string>();
    if (s.length < 2) {
      out.add(s);
      return out;
    }
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  };
  const ga = grams(ca);
  const gb = grams(cb);
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter += 1;
  const union = ga.size + gb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function bestOutlineMapping(
  outline: ParsedOutline | null,
  primary: string,
  context = '',
): { node_id: string; title: string; score: 'exact' | 'strong' | 'weak' } | null {
  const nodes = outline?.nodes ?? [];
  if (nodes.length === 0) return null;
  const query = `${primary}\n${context}`.trim();
  const compactQuery = compactForMatch(primary || context);

  let best: { node: OutlineNode; score: number } | null = null;
  for (const node of nodes) {
    const text = outlineLabel(node);
    const compactNode = compactForMatch(text);
    if (compactQuery && compactNode && compactQuery === compactNode) {
      return { node_id: node.id, title: text, score: 'exact' };
    }
    const score = Math.max(
      tokenSimilarity(query, text),
      bigramSimilarity(query, text),
      bigramSimilarity(primary, text),
    );
    if (!best || score > best.score) best = { node, score };
  }
  if (!best || best.score < 0.18) return null;
  return {
    node_id: best.node.id,
    title: outlineLabel(best.node),
    score: best.score >= 0.5 ? 'strong' : 'weak',
  };
}

function chunkForCandidate(candidate: CandidateItem, chunks: Chunk[]): Chunk | null {
  return (
    chunks.find(
      (ch) =>
        ch.source_id === candidate.source_id &&
        candidate.span.start >= ch.location.char_start &&
        candidate.span.start < ch.location.char_end,
    ) ?? null
  );
}

function parseLineLocation(refs: string[]): { page: number | null; line: number | null } {
  for (const ref of refs) {
    const pageLine = ref.match(/#page-(\d+)-line-(\d+)/);
    if (pageLine) return { page: Number(pageLine[1]), line: Number(pageLine[2]) };
    const line = ref.match(/#line-(\d+)/);
    if (line) return { page: null, line: Number(line[1]) };
  }
  return { page: null, line: null };
}

function contextFromChunk(chunk: Chunk | null, needle: string): string {
  if (!chunk) return '';
  const text = chunk.text;
  const cleanNeedle = compact(needle);
  if (!cleanNeedle) return excerpt(text);
  const idx = text.toLocaleLowerCase().indexOf(cleanNeedle.toLocaleLowerCase().slice(0, 80));
  if (idx < 0) return excerpt(text);
  const start = Math.max(0, idx - 160);
  const end = Math.min(text.length, idx + cleanNeedle.length + 160);
  return excerpt(text.slice(start, end));
}

function entryForCandidate(candidate: CandidateItem, entries: WikiEntry[]): WikiEntry | null {
  return entries.find((e) => e.created_from_candidates.includes(candidate.local_candidate_id)) ?? null;
}

function reportSourceId(input: BuildExtractionReportInput): string | null {
  return input.bundle?.source_id ?? input.autoWikiProgress?.source_id ?? input.chunks[0]?.source_id ?? null;
}

function entriesForSource(entries: WikiEntry[], sourceId: string | null): WikiEntry[] {
  if (!sourceId) return [];
  return entries.filter((entry) => entry.source_ids.includes(sourceId));
}

function actionLabel(action: RecommendedAction): string {
  const labels: Record<RecommendedAction, string> = {
    create_new: '새 위키 항목 생성 후보',
    update_existing: '기존 항목 보강 후보',
    link_only: '관련 항목 링크 후보',
    ignore: '위키 저장 제외 후보',
  };
  return labels[action];
}

function candidateSteps(card: CandidateCardModel, mapped: boolean, imported: boolean): StepJudgment[] {
  const { scored } = card;
  const steps: StepJudgment[] = [
    {
      step: 'candidate_created',
      status: 'passed',
      reason: '업로드 원문에서 결정적 추출기로 후보가 생성되었습니다.',
    },
    {
      step: 'structure_filter',
      status: scored.recommended_action === 'ignore' ? 'blocked' : 'passed',
      reason:
        scored.rationale.demotion.join(' · ') ||
        (scored.recommended_action === 'ignore'
          ? '재사용 가능한 지식 후보로 보기 어려워 위키 저장에서 제외되었습니다.'
          : '목차/저자명/참고문헌성 구조 조각으로 판정되지 않았습니다.'),
    },
    {
      step: 'evidence_anchor',
      status: scored.candidate.evidence_refs.length > 0 ? 'passed' : 'warning',
      reason:
        scored.candidate.evidence_refs.length > 0
          ? `근거 참조 ${scored.candidate.evidence_refs.length}개가 후보에 연결되어 있습니다.`
          : '근거 참조가 비어 있어 검토가 필요합니다.',
    },
    {
      step: 'outline_mapping',
      status: mapped ? 'passed' : 'warning',
      reason: mapped
        ? '목차 항목과 유사도가 있어 자동 매핑되었습니다.'
        : '충분히 맞는 목차 항목을 찾지 못했습니다.',
    },
    {
      step: 'wiki_import',
      status: imported ? 'passed' : scored.recommended_action === 'ignore' ? 'blocked' : 'not_applicable',
      reason: imported ? '위키 초안 항목으로 저장되었습니다.' : actionLabel(scored.recommended_action),
    },
  ];
  return steps;
}

function sanitizeAutoTrace(
  trace: AutoLlmBatchTrace,
  chunksById: Map<string, Chunk>,
  includeAdvancedDebug: boolean,
) {
  const basicCandidates = trace.candidates.map((cand) => ({
    index: cand.index,
    title: cand.title,
    type: cand.type,
    discipline_profile: cand.discipline_profile,
    discipline_unit: cand.discipline_unit,
    mapped_schema_field: cand.schema_field,
    mapping_reason: cand.mapping_reason,
    confidence: cand.confidence,
    importable: cand.importable,
    violations: cand.violations,
    standard_terms: cand.standard_terms,
    reuse_reason: cand.reuse_reason,
    boundary_note: cand.boundary_note,
    evidence: cand.evidence.map((ev) => {
      const chunk = chunksById.get(ev.chunk_id) ?? null;
      return {
        chunk_id: ev.chunk_id,
        page: chunk?.location.page ?? null,
        line: null,
        quote_excerpt: excerpt(ev.quote_excerpt, 220),
        translation_ko_excerpt: excerpt(ev.translation_ko_excerpt, 220),
        context_excerpt: contextFromChunk(chunk, ev.quote_excerpt),
      };
    }),
    rejected_evidence: cand.rejected_evidence,
    step_judgment: [
      {
        step: 'discipline_profile',
        status: cand.discipline_profile || cand.discipline_unit ? 'passed' : 'warning',
        reason:
          cand.discipline_profile || cand.discipline_unit
            ? `전공 판단: ${[cand.discipline_profile, cand.discipline_unit].filter(Boolean).join(' / ')}`
            : '전공/자료 성격 판단 필드가 비어 있습니다.',
      },
      {
        step: 'reuse_reason',
        status: cand.reuse_reason ? 'passed' : 'warning',
        reason: cand.reuse_reason || '이 전공에서 왜 재사용 가능한 후보인지 설명이 비어 있습니다.',
      },
      {
        step: 'mapping_reason',
        status: cand.mapping_reason ? 'passed' : 'warning',
        reason: cand.mapping_reason || '목차 매핑 이유가 비어 있습니다.',
      },
      {
        step: 'parse',
        status: trace.parse_ok ? 'passed' : 'blocked',
        reason: trace.parse_error ?? 'JSON 응답을 해석했습니다.',
      },
      {
        step: 'shape_validation',
        status: trace.validation_shape_ok === false ? 'blocked' : 'passed',
        reason: trace.validation_top_level_error ?? 'wiki_candidates 형식을 확인했습니다.',
      },
      {
        step: 'chunk_id_binding',
        status: cand.rejected_evidence.length > 0 ? 'blocked' : 'passed',
        reason:
          cand.rejected_evidence.length > 0
            ? '존재하지 않는 chunk_id가 있어 가져오기에서 제외되었습니다.'
            : '모든 근거 chunk_id가 실제 업로드 청크에 묶였습니다.',
      },
      {
        step: 'importable',
        status: cand.importable ? 'passed' : 'blocked',
        reason: cand.importable ? '위키 초안으로 가져올 수 있습니다.' : cand.violations.join(' · '),
      },
    ] satisfies StepJudgment[],
  }));

  return {
    source_id: trace.source_id,
    provider_ok: trace.provider_ok,
    provider_error: trace.provider_error,
    parse_ok: trace.parse_ok,
    parse_error: trace.parse_error,
    parse_recovered: trace.parse_recovered,
    parse_recovered_count: trace.parse_recovered_count,
    validation_shape_ok: trace.validation_shape_ok,
    validation_top_level_error: trace.validation_top_level_error,
    candidates: basicCandidates,
    advanced_debug: includeAdvancedDebug
      ? {
          batch_index: trace.batch_index,
          total_batches: trace.total_batches,
          chunk_orders: trace.chunk_orders,
          chunk_ids: trace.chunk_ids,
          prompt_version: trace.prompt_version,
          prompt_char_count: trace.prompt_char_count,
          raw_response: trace.raw_response,
          source_chunk_samples: trace.chunk_ids.slice(0, 4).map((id) => {
            const chunk = chunksById.get(id);
            return {
              chunk_id: id,
              page: chunk?.location.page ?? null,
              order: chunk?.order ?? null,
              text_excerpt: chunk ? excerpt(chunk.text, 900) : '',
            };
          }),
        }
      : null,
  };
}

export function validatedCandidateToTrace(cand: ValidatedCandidate): AutoLlmCandidateTrace {
  return {
    index: cand.index,
    title: cand.title,
    type: cand.type,
    discipline_profile: cand.discipline_profile,
    discipline_unit: cand.discipline_unit,
    schema_field: cand.schema_field,
    mapping_reason: cand.mapping_reason,
    confidence: cand.confidence,
    importable: cand.importable,
    violations: cand.violations,
    standard_terms: cand.standard_terms,
    reuse_reason: cand.reuse_reason,
    boundary_note: cand.boundary_note,
    evidence: cand.evidence.map((ev) => ({
      chunk_id: ev.chunk_id,
      quote_excerpt: ev.quote,
      translation_ko_excerpt: ev.translation_ko,
    })),
    rejected_evidence: cand.rejectedEvidence,
  };
}

export function buildExtractionDiagnosticReport(input: BuildExtractionReportInput) {
  const chunksById = new Map(input.chunks.map((ch) => [ch.chunk_id, ch]));
  const sourceId = reportSourceId(input);
  const relevantEntries = entriesForSource(input.entries, sourceId);

  const offlineCandidateReports = input.candidateCards.map((card) => {
    const candidate = card.scored.candidate;
    const chunk = chunkForCandidate(candidate, input.chunks);
    const lineLoc = parseLineLocation(candidate.evidence_refs);
    const mapping = bestOutlineMapping(
      input.outline,
      candidate.title,
      `${candidate.summary}\n${candidate.evidence_text}`,
    );
    const importedEntry = entryForCandidate(candidate, relevantEntries);

    return {
      candidate_id: candidate.local_candidate_id,
      title: candidate.title,
      type: candidate.type,
      original_terms: candidate.original_terms ?? [],
      mapped_outline: mapping,
      recommended_action: card.scored.recommended_action,
      user_decision: card.decision,
      target_entry_title: card.scored.target_entry_title,
      wiki_entry: importedEntry
        ? {
            id: importedEntry.id,
            title: importedEntry.title,
            status: importedEntry.status,
            mapped_outline_node_id: importedEntry.outline_node_id,
          }
        : null,
      evidence: [
        {
          evidence_refs: candidate.evidence_refs,
          chunk_id: chunk?.chunk_id ?? null,
          page: lineLoc.page ?? chunk?.location.page ?? candidate.page ?? null,
          line: lineLoc.line,
          char_start: candidate.span.start,
          char_end: candidate.span.end,
          chunk_content_hash: chunk?.content_hash ?? null,
          context_excerpt: contextFromChunk(chunk, candidate.evidence_text),
        },
      ],
      rationale: {
        why: card.scored.rationale.why,
        matched_keywords: card.scored.rationale.matched_keywords,
        claim_verbs: card.scored.rationale.claim_verbs,
        boundary: card.scored.rationale.boundary,
        demotion: card.scored.rationale.demotion,
      },
      step_judgment: candidateSteps(card, Boolean(mapping), Boolean(importedEntry)),
    };
  });

  const llmBatchReports = input.autoLlmTraces.map((trace) =>
    sanitizeAutoTrace(trace, chunksById, input.includeAdvancedDebug),
  );

  const llmParseFailures = input.autoLlmTraces
    .filter((trace) => !trace.parse_ok || trace.validation_shape_ok === false || !trace.provider_ok)
    .map((trace) => ({
      batch_index: input.includeAdvancedDebug ? trace.batch_index : null,
      reason: trace.provider_error ?? trace.parse_error ?? trace.validation_top_level_error,
      provider_ok: trace.provider_ok,
      parse_ok: trace.parse_ok,
      validation_shape_ok: trace.validation_shape_ok,
    }));

  return {
    schema: EXTRACTION_REPORT_SCHEMA,
    created_at: new Date().toISOString(),
    consent: {
      basic_diagnostic_included: true,
      advanced_debug_included: input.includeAdvancedDebug,
      advanced_debug_notice:
        '추출 진단 리포트를 첨부하면 raw LLM 응답, 프롬프트 버전/길이, 배치 번호, 일부 원문 청크 발췌가 함께 포함됩니다.',
    },
    privacy_guards: {
      local_absolute_paths_included: false,
      api_keys_included: false,
      oauth_tokens_included: false,
      auth_json_included: false,
      file_name_included: false,
      source_hash_included: Boolean(input.bundle?.source_id),
    },
    app_context: {
      llm_model: input.llmCfg.model,
      llm_auth: input.llmCfg.auth,
      llm_reachable: input.llmCfg.reachable,
      endpoint_base_recorded: false,
    },
    source: {
      source_hash: sourceId,
      source_kind: input.bundle?.source_kind ?? null,
      normalized_text_chars: input.bundle?.normalized_text.length ?? 0,
      chunk_count: input.chunks.length,
      page_count_estimate:
        Math.max(0, ...input.chunks.map((ch) => ch.location.page ?? 0)) || null,
    },
    text_quality: input.textQuality
      ? {
          kind: input.textQuality.kind,
          level: input.textQuality.level,
          page_count: input.textQuality.page_count,
          extractable_pages: input.textQuality.extractable_pages,
          low_text_pages: input.textQuality.low_text_pages,
          blank_pages: input.textQuality.blank_pages,
          total_chars: input.textQuality.total_chars,
          avg_chars_per_page: input.textQuality.avg_chars_per_page,
          suspicious_ratio: input.textQuality.suspicious_ratio,
          summary_ko: input.textQuality.summary_ko,
          suggestion_ko: input.textQuality.suggestion_ko,
        }
      : null,
    outline: {
      node_count: input.outline?.nodes.length ?? 0,
      root_count: input.outline?.roots.length ?? 0,
      nodes: (input.outline?.nodes ?? []).map((node) => ({
        id: node.id,
        label: node.label,
        title: node.title,
        level: node.level,
        parent: node.parent,
      })),
    },
    counts: {
      extracted_candidates: input.bundle?.candidate_items.length ?? 0,
      candidate_cards: input.candidateCards.length,
      wiki_entries_current: relevantEntries.length,
      candidates_by_type: countBy((input.bundle?.candidate_items ?? []).map((c) => c.type)),
      card_actions: countBy(input.candidateCards.map((c) => c.scored.recommended_action)),
      user_decisions: countBy(input.candidateCards.map((c) => c.decision)),
      llm_batches_recorded: input.autoLlmTraces.length,
      llm_candidates_recorded: input.autoLlmTraces.reduce((n, t) => n + t.candidates.length, 0),
      llm_importable_recorded: input.autoLlmTraces.reduce(
        (n, t) => n + t.candidates.filter((c) => c.importable).length,
        0,
      ),
      llm_rejected_chunk_ids: input.autoLlmTraces.reduce(
        (n, t) => n + t.candidates.reduce((m, c) => m + c.rejected_evidence.length, 0),
        0,
      ),
    },
    auto_wiki_progress: input.autoWikiProgress,
    offline_candidates: offlineCandidateReports,
    llm_batches: llmBatchReports,
    llm_failure_summary: llmParseFailures,
    persisted_entries_summary: relevantEntries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      status: entry.status,
      outline_node_id: entry.outline_node_id,
      source_ids: entry.source_ids,
      created_from_candidates: entry.created_from_candidates,
      claim_count: entry.claims.length,
    })),
    redaction_note:
      '이 리포트는 로컬 절대 경로, API 키, OAuth 토큰, auth.json 내용, 원본 파일명을 포함하지 않도록 생성되었습니다.',
  };
}

export type ExtractionDiagnosticReport = ReturnType<typeof buildExtractionDiagnosticReport>;

export function summarizeExtractionReport(report: ExtractionDiagnosticReport): string {
  const source = report.source.source_hash ? `source ${report.source.source_hash}` : '원문 없음';
  const llmFailures = report.llm_failure_summary.length;
  return [
    source,
    `후보 ${report.counts.extracted_candidates}개`,
    `카드 ${report.counts.candidate_cards}개`,
    `청크 ${report.source.chunk_count}개`,
    `LLM 배치 ${report.counts.llm_batches_recorded}개`,
    llmFailures ? `LLM 문제 ${llmFailures}건` : 'LLM 문제 0건',
  ].join(' · ');
}
