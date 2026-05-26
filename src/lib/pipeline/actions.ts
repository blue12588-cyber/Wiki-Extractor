/**
 * Pipeline actions — the extract / build / save / translate logic, lifted out
 * of the old monolithic +page.svelte so the tabbed Main + Wiki views can share
 * it against the layout-level `pipeline` store.
 *
 * Authority: agreed_contract.json (Slice 4)#AC-MAIN-TAB + AC-WIKI-TAB +
 *            AC-REGRESS (slice 1/2/3 behaviour unchanged — this is a pure
 *            relocation; logic is byte-for-byte equivalent to slice 3).
 *
 * No string here was paraphrased from slice 3; all notices were already Korean.
 */

import { pipeline, type SourceSummary } from './store.svelte';
import { verifyMagicBytes } from '$lib/upload/magicBytes';
import { computeSourceId } from '$lib/upload/sourceId';
import {
  extractCandidates,
  type CandidateBundle,
  type CandidateItem,
} from '$lib/extract/candidateExtractor';
import { chunksFromBundle } from '$lib/chunk/chunkFromBundle';
import { chunksToJsonl } from '$lib/chunk/chunker';
import { parseOutline, type OutlineNode, type ParsedOutline } from '$lib/outline/outlineParser';
import {
  persistChunksJsonl,
  readCandidateReviewState,
  saveEntryAndIndex,
  loadAllEntries,
  writeCandidateReviewState,
} from '$lib/wiki/wikiStore';
import {
  buildEntriesFromCandidates,
  type CandidateMapping,
} from '$lib/wiki/wikiBuilder';
import type { WikiEntry } from '$lib/wiki/wikiTypes';
import { llmReviewClaim, llmTranslate, llmConfig } from '$lib/llm/llmClient';
import { autoModeActive } from '$lib/llm/modeStore.svelte';
import { codexProvider, ensureProxy } from '$lib/llm/codexProvider';
import {
  carryCandidateDecisions,
  runCandidateEngine,
  selectOfflineWikiCardsForSave,
  type CandidateDecision,
} from '$lib/candidate/candidateEngine';
import { outlineKeywords } from '$lib/candidate/candidateEngine';
import { candidateReviewKey, type CandidateReviewState } from '$lib/candidate/reviewState';
import { overlapTerms, tokenSimilarity, tokenize } from '$lib/candidate/keywordMatch';
import type { Chunk } from '$lib/chunk/chunker';
import { buildGlobalPrompt, PROMPT_VERSION, type BatchPromptInput, type PromptInput } from '$lib/bridge/promptBuilder';
import { parseResponse } from '$lib/bridge/responseParser';
import { validateResponse, type ValidatedCandidate } from '$lib/bridge/responseValidator';
import { buildEntryFromValidated } from '$lib/bridge/wikiImport';
import {
  validatedCandidateToTrace,
  type AutoLlmBatchTrace,
} from '$lib/diagnostics/extractionReport';
import { inferBibliographicMetadata } from '$lib/source/bibliography';

const AUTO_CHUNKS_PER_BATCH = 8;
const AUTO_BATCHES_PER_RUN = 5;
const OUTLINE_STORAGE_KEY = 'llmwiki:outline:v1';
const SOURCE_SUMMARY_STORAGE_KEY = 'llmwiki:sources:v1';
const AUTO_PROGRESS_PREFIX = 'llmwiki:auto-wiki-progress:';
const NO_OUTLINE_SIGNATURE = 'outline:none';

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function resolveInvoke(): Invoke | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { __TAURI__?: { core?: { invoke?: Invoke } } };
  const fn = w.__TAURI__?.core?.invoke;
  return typeof fn === 'function' ? fn : null;
}

type UploadResponse = {
  source_id: string;
  written_path: string;
  byte_count: number;
  detected_type: string;
};
type UploadErr = { kind: string; reason: string };

interface UploadZoneHandle {
  set_success(msg: string): void;
  set_reject(msg: string): void;
}

function duplicateSourceMessage(source_id: string, fallbackName: string): string | null {
  const existing = pipeline.sources.find((source) => source.source_id === source_id);
  if (!existing || !sourceIdsInSession().includes(source_id)) return null;
  const label = existing.bibliography?.display_title || existing.filename || fallbackName;
  return `똑같은 자료를 또 넣었어요: ${label}. 이미 올린 PDF/원문이라 다시 위키를 만들지 않고 건너뛰었습니다.`;
}

function existingSourceOnDiskMessage(source_id: string, fallbackName: string): string {
  return `똑같은 자료를 또 넣었어요: ${fallbackName}. data/sources/${source_id}/에 이미 있어서 다시 위키를 만들지 않고 건너뛰었습니다.`;
}

function sourceKindFromFilename(filename: string): SourceSummary['source_kind'] {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  return 'plaintext';
}

function lsGet(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    /* preview/host storage can fail; outline/progress persistence is best-effort */
  }
}

function lsRemove(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch {
    /* best-effort */
  }
}

function normalizeSourceSummary(value: unknown): SourceSummary | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<SourceSummary>;
  if (typeof raw.source_id !== 'string' || typeof raw.filename !== 'string') return null;
  const bibliography = raw.bibliography ?? inferBibliographicMetadata({
    filename: raw.filename,
    normalizedText: '',
  });
  return {
    source_id: raw.source_id,
    filename: raw.filename,
    bibliography,
    source_kind: raw.source_kind === 'pdf' || raw.source_kind === 'markdown' ? raw.source_kind : 'plaintext',
    candidate_count: Number.isFinite(raw.candidate_count) ? Number(raw.candidate_count) : 0,
    chunk_count: Number.isFinite(raw.chunk_count) ? Number(raw.chunk_count) : 0,
    text_quality_level: raw.text_quality_level ?? null,
  };
}

function readPersistedSourceSummaries(): SourceSummary[] {
  const raw = lsGet(SOURCE_SUMMARY_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeSourceSummary)
      .filter((item): item is SourceSummary => !!item);
  } catch {
    return [];
  }
}

function persistSourceSummaries(sources = pipeline.sources): void {
  lsSet(SOURCE_SUMMARY_STORAGE_KEY, JSON.stringify(sources));
}

function rememberSourceSummary(summary: SourceSummary): void {
  pipeline.sources = [
    ...pipeline.sources.filter((source) => source.source_id !== summary.source_id),
    summary,
  ];
  persistSourceSummaries();
}

function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function outlineSignature(outline = pipeline.outline): string {
  const nodes = outline?.nodes ?? [];
  if (nodes.length === 0) return NO_OUTLINE_SIGNATURE;
  const normalized = nodes
    .map((n) => `${n.level}\t${n.label ?? ''}\t${n.title.trim().replace(/\s+/g, ' ')}`)
    .join('\n');
  return `outline:${shortHash(normalized)}`;
}

function makeCombinedBundle(bundles: CandidateBundle[]): CandidateBundle | null {
  if (bundles.length === 0) return null;
  if (bundles.length === 1) return bundles[0];
  return {
    source_id: `multi-${shortHash(bundles.map((b) => b.source_id).join('\n'))}`,
    source_kind: 'plaintext',
    candidate_items: bundles.flatMap((b) => b.candidate_items),
    normalized_text: bundles.map((b) => b.normalized_text).join('\n\n'),
  };
}

function sourceIdsInSession(): string[] {
  const ids = new Set<string>();
  for (const bundle of pipeline.bundles) ids.add(bundle.source_id);
  for (const chunk of pipeline.chunks) ids.add(chunk.source_id);
  return [...ids];
}

function resetSourceSession() {
  pipeline.bundle = null;
  pipeline.bundles = [];
  pipeline.chunks = [];
  pipeline.sources = readPersistedSourceSummaries();
  pipeline.chunkStatus = null;
  pipeline.textQuality = null;
  pipeline.candidateCards = [];
  pipeline.bridgeCandidateId = null;
  pipeline.batchBridgeOpen = false;
  pipeline.autoWikiProgress = null;
  pipeline.autoLlmTraces = [];
}

function applyReviewState(cards: typeof pipeline.candidateCards): typeof pipeline.candidateCards {
  return cards.map((card) => {
    const cand = card.scored.candidate;
    const record = pipeline.candidateReviewState[candidateReviewKey(cand.source_id, cand.local_candidate_id)];
    return record ? { ...card, decision: record.decision } : card;
  });
}

async function persistReviewState(state: CandidateReviewState = pipeline.candidateReviewState) {
  try {
    await writeCandidateReviewState(state);
  } catch (err) {
    pipeline.notice = `후보 리뷰 상태 저장 중 오류: ${(err as Error).message}`;
  }
}

export async function loadPersistedCandidateReviewState() {
  try {
    pipeline.candidateReviewState = await readCandidateReviewState();
  } catch {
    pipeline.candidateReviewState = {};
  }
}

export function loadPersistedOutline() {
  const raw = lsGet(OUTLINE_STORAGE_KEY) ?? '';
  pipeline.outlineRaw = raw;
  pipeline.outline = raw.trim() ? parseOutline(raw) : null;
  refreshAutoProgressForCurrentOutline();
}

export function loadPersistedSourceSummaries() {
  pipeline.sources = readPersistedSourceSummaries();
}

export function onOutlineRawChanged(raw: string) {
  pipeline.outlineRaw = raw;
  if (raw.trim()) {
    lsSet(OUTLINE_STORAGE_KEY, raw);
  } else {
    lsRemove(OUTLINE_STORAGE_KEY);
  }
}

function autoProgressKey(source_id: string, signature = outlineSignature()): string {
  return `${AUTO_PROGRESS_PREFIX}${source_id}:${signature}`;
}

function clampInt(value: unknown, min: number, max: number, fallback = min): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function removeAutoProgressForSource(source_id: string) {
  const prefix = `${AUTO_PROGRESS_PREFIX}${source_id}:`;
  try {
    if (typeof localStorage === 'undefined') return;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    /* best-effort */
  }
}

function loadAutoProgress(source_id: string, totalBatches: number, signature = outlineSignature()) {
  const raw = lsGet(autoProgressKey(source_id, signature));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<NonNullable<typeof pipeline.autoWikiProgress>>;
    if (parsed.source_id !== source_id) return null;
    if (parsed.outline_signature && parsed.outline_signature !== signature) return null;
    return {
      source_id,
      outline_signature: signature,
      nextBatch: clampInt(parsed.nextBatch, 0, totalBatches),
      totalBatches,
      imported: clampInt(parsed.imported, 0, Number.MAX_SAFE_INTEGER),
      mapped: clampInt(parsed.mapped, 0, Number.MAX_SAFE_INTEGER),
      updated_at: String(parsed.updated_at ?? new Date().toISOString()),
    };
  } catch {
    return null;
  }
}

function saveAutoProgress(progress: NonNullable<typeof pipeline.autoWikiProgress>) {
  const normalized = {
    ...progress,
    outline_signature: progress.outline_signature || outlineSignature(),
  };
  pipeline.autoWikiProgress = normalized;
  lsSet(autoProgressKey(normalized.source_id, normalized.outline_signature), JSON.stringify(normalized));
}

function refreshAutoProgressForCurrentOutline() {
  const source_id = pipeline.bundle?.source_id;
  if (!source_id || pipeline.chunks.length === 0) return;
  pipeline.autoWikiProgress = loadAutoProgress(
    source_id,
    Math.ceil(pipeline.chunks.length / AUTO_CHUNKS_PER_BATCH),
    outlineSignature(),
  );
}

function badTextQualityNotice(): string | null {
  if (pipeline.bundles.length > 1) return null;
  const q =
    pipeline.bundles.map((b) => b.text_quality).find((report) => report?.level === 'bad') ??
    pipeline.textQuality;
  if (!q || q.level !== 'bad') return null;
  return `${q.summary_ko} ${q.suggestion_ko} OCR 처리된 PDF나 txt/md로 다시 올린 뒤 추출·위키 생성을 진행하세요.`;
}

export function resetAutoWikiProgress() {
  const source_id = pipeline.bundle?.source_id ?? pipeline.autoWikiProgress?.source_id;
  if (source_id) removeAutoProgressForSource(source_id);
  pipeline.autoWikiProgress = null;
  pipeline.notice = '자동 LLM 진행 상태를 초기화했습니다. 다음 “위키 생성”은 첫 배치부터 시작합니다.';
}

/** Deterministic, no-LLM extraction + AC-CHUNK auto-persist. */
async function runExtraction(
  file: File,
  full: Uint8Array,
  source_id: string,
  zone: UploadZoneHandle | null,
  opts: { reset?: boolean } = {},
): Promise<boolean> {
  pipeline.extracting = true;
  if (opts.reset ?? true) resetSourceSession();
  try {
    const bundle = await extractCandidates({ source_id, filename: file.name, buffer: full });
    const bundles = [...pipeline.bundles.filter((b) => b.source_id !== source_id), bundle];
    pipeline.bundles = bundles;
    pipeline.bundle = makeCombinedBundle(bundles);
    pipeline.textQuality = bundle.text_quality ?? null;
    const chunks = await chunksFromBundle(bundle);
    const bibliography = inferBibliographicMetadata({
      filename: file.name,
      normalizedText: bundle.normalized_text,
    });
    pipeline.chunks = [
      ...pipeline.chunks.filter((ch) => ch.source_id !== source_id),
      ...chunks,
    ];
    rememberSourceSummary({
      source_id,
      filename: file.name,
      bibliography,
      source_kind: bundle.source_kind,
      candidate_count: bundle.candidate_items.length,
      chunk_count: chunks.length,
      text_quality_level: bundle.text_quality?.level ?? null,
    });
    if (bundles.length === 1) {
      pipeline.autoWikiProgress = loadAutoProgress(source_id, Math.ceil(chunks.length / AUTO_CHUNKS_PER_BATCH));
    } else {
      pipeline.autoWikiProgress = null;
    }
    const jsonl = chunksToJsonl(chunks);
    const persisted = await persistChunksJsonl(source_id, jsonl);
    pipeline.chunkStatus = persisted
      ? `${file.name}: ${persisted.chunk_count}개 청크 저장됨 → ${persisted.path}`
      : `${file.name}: ${chunks.length}개 청크 생성됨`;
    return true;
  } catch (err) {
    const e = err as { message?: string };
    zone?.set_reject(`추출 실패: ${e?.message ?? String(err)}`);
    return false;
  } finally {
    pipeline.extracting = false;
  }
}

async function uploadAndExtractFile(
  file: File,
  zone: UploadZoneHandle | null,
  opts: { reset?: boolean; quietSuccess?: boolean } = {},
): Promise<{ ok: true; source_id: string; chunk_count: number } | { ok: false; reason: string }> {
  const headLen = Math.min(256, file.size);
  const head = new Uint8Array(await file.slice(0, headLen).arrayBuffer());
  const mb = verifyMagicBytes(file.name, head);
  if (!mb.ok) {
    const reason = mb.reason ?? '매직 바이트 서명이 일치하지 않습니다.';
    zone?.set_reject(reason);
    return { ok: false, reason };
  }
  const full = new Uint8Array(await file.arrayBuffer());
  const source_id = await computeSourceId(full);
  const duplicateMessage = duplicateSourceMessage(source_id, file.name);
  if (duplicateMessage) {
    zone?.set_reject(duplicateMessage);
    pipeline.notice = duplicateMessage;
    return { ok: false, reason: duplicateMessage };
  }

  const invoke = resolveInvoke();
  if (invoke) {
    try {
      const alreadyExists = await invoke<boolean>('source_exists', { sourceId: source_id });
      if (alreadyExists) {
        const reason = existingSourceOnDiskMessage(source_id, file.name);
        rememberSourceSummary({
          source_id,
          filename: file.name,
          bibliography: inferBibliographicMetadata({ filename: file.name, normalizedText: '' }),
          source_kind: sourceKindFromFilename(file.name),
          candidate_count: 0,
          chunk_count: 0,
          text_quality_level: null,
        });
        zone?.set_reject(reason);
        pipeline.notice = reason;
        return { ok: false, reason };
      }
    } catch {
      /* Duplicate-on-disk detection is best-effort; upload still has path guards. */
    }
  }
  if (!invoke) {
    if (!opts.quietSuccess) zone?.set_success(`(미리보기) ${file.name} → data/sources/${source_id}/`);
    const extracted = await runExtraction(file, full, source_id, zone, { reset: opts.reset });
    if (!extracted) return { ok: false, reason: '추출 실패' };
    return { ok: true, source_id, chunk_count: chunksForSource(source_id).length };
  }

  // A WebView2 `File` object exposes no usable OS path (the non-standard
  // Electron `.path` field does not exist), so we hand the host the bytes we
  // already read above. This works for BOTH the file picker and drag-drop —
  // no OS path required.
  try {
    const result = await invoke<UploadResponse>('upload_bytes', {
      filename: file.name,
      bytes: Array.from(full),
    });
    if (!opts.quietSuccess) {
      zone?.set_success(
        `${file.name} → data/sources/${result.source_id}/ (${result.byte_count} 바이트, ${result.detected_type})`,
      );
    }
    const extracted = await runExtraction(file, full, result.source_id, zone, { reset: opts.reset });
    if (!extracted) return { ok: false, reason: '추출 실패' };
    return { ok: true, source_id: result.source_id, chunk_count: chunksForSource(result.source_id).length };
  } catch (err) {
    const e = err as UploadErr;
    const reason = e?.reason ?? '업로드 실패';
    zone?.set_reject(reason);
    return { ok: false, reason };
  }
}

export async function onFileSelected(file: File, zone: UploadZoneHandle | null) {
  await uploadAndExtractFile(file, zone, { reset: true });
}

export async function onFilesSelected(files: File[], zone: UploadZoneHandle | null) {
  const accepted = files.filter((file) => file.size > 0);
  if (accepted.length === 0) {
    zone?.set_reject('읽을 수 있는 파일이 없습니다.');
    return;
  }

  resetSourceSession();
  pipeline.notice = `${accepted.length}개 원서를 순차 처리합니다.`;
  let ok = 0;
  const failures: string[] = [];
  for (const [idx, file] of accepted.entries()) {
    pipeline.notice = `${idx + 1}/${accepted.length} 처리 중: ${file.name}`;
    const result = await uploadAndExtractFile(file, zone, { reset: false, quietSuccess: true });
    if (result.ok) ok += 1;
    else failures.push(`${file.name}: ${result.reason}`);
  }

  pipeline.bundle = makeCombinedBundle(pipeline.bundles);
  const sourceCount = sourceIdsInSession().length;
  const chunkCount = pipeline.chunks.length;
  if (ok > 0) {
    zone?.set_success(`${ok}개 원서 처리 완료 · 원문 ${sourceCount}개 · 청크 ${chunkCount}개`);
  } else {
    zone?.set_reject(`모든 파일 처리 실패: ${failures.join(' / ')}`);
  }
  const failNotice = failures.length > 0 ? ` 실패 ${failures.length}개(${failures.slice(0, 3).join(' / ')})` : '';
  pipeline.notice =
    `${ok}/${accepted.length}개 원서를 처리했습니다. 후보 추출/일괄 ChatGPT 프롬프트는 이 세션의 전체 후보 풀을 기준으로 작동합니다.` +
    failNotice;
}

export function onOutlineParsed(parsed: ParsedOutline) {
  pipeline.outline = parsed;
  if (pipeline.outlineRaw.trim()) {
    lsSet(OUTLINE_STORAGE_KEY, pipeline.outlineRaw);
  }
  refreshAutoProgressForCurrentOutline();
}

/**
 * AC-RULE-ENGINE + AC-CLASSIFY + AC-DEDUP + AC-DEMOTE + AC-SCHEMA-INPUT.
 *
 * Run the OFFLINE, deterministic rule engine over the current bundle + chunks,
 * using the pasted outline as the schema-fit keyword source and the loaded
 * wiki entries for the dedup/novelty check. NO network, NO LLM. Same inputs →
 * same cards (the engine is pure; we only attach an in-memory decision state).
 */
export function runRuleEngine() {
  if (!pipeline.bundle) {
    pipeline.notice = '먼저 원문을 업로드하세요.';
    return;
  }
  const qualityNotice = badTextQualityNotice();
  if (qualityNotice) {
    pipeline.candidateCards = [];
    pipeline.notice = qualityNotice;
    return;
  }
  pipeline.scoring = true;
  try {
    const cards = applyReviewState(carryCandidateDecisions(
      runCandidateEngine({
        bundle: pipeline.bundle,
        chunks: pipeline.chunks,
        outline: pipeline.outline,
        existingEntries: pipeline.entries,
      }),
      pipeline.candidateCards,
    ));
    pipeline.candidateCards = cards;
    pipeline.notice =
      cards.length > 0
        ? `규칙 기반 후보 ${cards.length}개를 찾았습니다(오프라인, 점수 비표시).`
        : '추출 가능한 위키 후보를 찾지 못했습니다.';
  } catch (err) {
    pipeline.notice = `후보 추출 중 오류: ${(err as Error).message}`;
  } finally {
    pipeline.scoring = false;
  }
}

/** Record a per-card user decision (승인/보류/폐기) and persist it under data/candidates/. */
export function onCandidateDecision(sourceId: string, candidateId: string, next: CandidateDecision) {
  const key = candidateReviewKey(sourceId, candidateId);
  pipeline.candidateCards = pipeline.candidateCards.map((c) =>
    c.scored.candidate.source_id === sourceId && c.scored.candidate.local_candidate_id === candidateId
      ? { ...c, decision: next }
      : c,
  );
  pipeline.candidateReviewState = {
    ...pipeline.candidateReviewState,
    [key]: {
      source_id: sourceId,
      local_candidate_id: candidateId,
      decision: next,
      updated_at: new Date().toISOString(),
    },
  };
  void persistReviewState();
}

function outlineTitleMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const n of pipeline.outline?.nodes ?? []) map[n.id] = n.label ? `${n.label} ${n.title}` : n.title;
  return map;
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

function outlineNodeText(node: OutlineNode): string {
  return `${node.label ?? ''} ${node.title}`.trim();
}

function bestOutlineNodeId(primary: string, context = ''): string | null {
  const nodes = pipeline.outline?.nodes ?? [];
  if (nodes.length === 0) return null;

  const query = `${primary}\n${context}`.trim();
  if (!query) return null;
  const compactQuery = compactForMatch(primary || context);

  let best: { id: string; score: number } | null = null;
  for (const node of nodes) {
    const nodeText = outlineNodeText(node);
    const compactNode = compactForMatch(nodeText);
    if (compactQuery && compactNode && compactQuery === compactNode) return node.id;
    if (
      compactQuery.length >= 3 &&
      compactNode.length >= 3 &&
      (compactQuery.includes(compactNode) || compactNode.includes(compactQuery))
    ) {
      return node.id;
    }

    const outlineMatchCount = overlapTerms(tokenize(nodeText), query).length;
    const outlineMatchScore =
      outlineMatchCount > 0 ? Math.min(0.34, 0.18 + outlineMatchCount * 0.05) : 0;
    const score = Math.max(
      tokenSimilarity(query, nodeText),
      bigramSimilarity(query, nodeText),
      bigramSimilarity(primary, nodeText),
      outlineMatchScore,
    );
    if (!best || score > best.score) best = { id: node.id, score };
  }

  return best && best.score >= 0.18 ? best.id : null;
}

function outlineNodeIdForSchema(schemaField: string, context = ''): string | null {
  return bestOutlineNodeId(schemaField, context);
}

function fallbackMappingsWithOutline(candidates: CandidateItem[]): CandidateMapping[] {
  return candidates.map((c) => {
    const outline_node_id = bestOutlineNodeId(
      c.title,
      `${c.summary}\n${c.evidence_text}`,
    );
    return {
      local_candidate_id: c.local_candidate_id,
      outline_node_id,
      recommended_action: c.suggested_action,
      rationale: outline_node_id
        ? '오프라인 목차 유사도 매핑 — 저장 후 위키 탭에서 조정하세요.'
        : '목차와 충분히 맞는 항목을 찾지 못했습니다 — 수동으로 목차 항목을 지정하세요.',
    };
  });
}

function chunkBatches(chunks: Chunk[], size: number): Chunk[][] {
  const out: Chunk[][] = [];
  for (let i = 0; i < chunks.length; i += size) out.push(chunks.slice(i, i + size));
  return out;
}

function candidateDedupeKey(cand: ValidatedCandidate): string {
  return [
    cand.type ?? 'other',
    cand.title.trim().replace(/\s+/g, ' ').toLocaleLowerCase(),
    cand.summary_ko.trim().replace(/\s+/g, ' ').toLocaleLowerCase(),
  ].join('\u0000');
}

function mergeStringList(left: string[] = [], right: string[] = [], max = 12): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of [...left, ...right]) {
    const clean = value.trim();
    const key = clean.toLocaleLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

function mergeValidatedCandidates(
  left: ValidatedCandidate,
  right: ValidatedCandidate,
): ValidatedCandidate {
  const evidence = [...left.evidence];
  const evidenceIndex = new Map(evidence.map((ev, idx) => [`${ev.chunk_id}\u0000${ev.quote}`, idx]));
  for (const ev of right.evidence) {
    const key = `${ev.chunk_id}\u0000${ev.quote}`;
    const idx = evidenceIndex.get(key);
    if (idx == null) {
      evidenceIndex.set(key, evidence.length);
      evidence.push(ev);
    } else if (!evidence[idx].translation_ko && ev.translation_ko) {
      evidence[idx] = { ...evidence[idx], translation_ko: ev.translation_ko };
    }
  }
  const rejectedEvidence = [...left.rejectedEvidence];
  const rejectedSeen = new Set(rejectedEvidence.map((ev) => `${ev.claimed_chunk_id}\u0000${ev.reason}`));
  for (const ev of right.rejectedEvidence) {
    const key = `${ev.claimed_chunk_id}\u0000${ev.reason}`;
    if (rejectedSeen.has(key)) continue;
    rejectedSeen.add(key);
    rejectedEvidence.push(ev);
  }
  return {
    ...left,
    evidence,
    rejectedEvidence,
    standard_terms: mergeStringList(left.standard_terms, right.standard_terms, 12),
    mapping_reason: left.mapping_reason || right.mapping_reason,
    reuse_reason: left.reuse_reason || right.reuse_reason,
    boundary_note: left.boundary_note || right.boundary_note,
    reason: left.reason || right.reason,
  };
}

function appendAutoLlmTrace(trace: AutoLlmBatchTrace) {
  pipeline.autoLlmTraces = [...pipeline.autoLlmTraces, trace];
}

async function saveEntries(entries: WikiEntry[]) {
  for (const e of entries) await saveEntryAndIndex(e);
  pipeline.entries = await loadAllEntries();
}

async function buildWikiOffline(bundle: NonNullable<typeof pipeline.bundle>) {
  const cards = applyReviewState(carryCandidateDecisions(
    runCandidateEngine({
      bundle,
      chunks: pipeline.chunks,
      outline: pipeline.outline,
      existingEntries: pipeline.entries,
    }),
    pipeline.candidateCards,
  ));
  pipeline.candidateCards = cards;
  const saveCards = selectOfflineWikiCardsForSave(cards);
  const candidates: CandidateItem[] = saveCards.map((card) => card.scored.candidate);
  const structuralExcluded = cards.filter((card) => card.scored.recommended_action === 'ignore').length;
  const decisionExcluded = cards.filter(
    (card) =>
      card.scored.recommended_action !== 'ignore' &&
      (card.decision === 'held' || card.decision === 'discarded'),
  ).length;
  const excluded = structuralExcluded + decisionExcluded;
  if (candidates.length === 0) {
    pipeline.notice =
      `위키로 저장할 재사용 후보를 찾지 못했습니다. 구조/목차성 후보 ${structuralExcluded}개와 ` +
      `사용자가 보류/폐기한 후보 ${decisionExcluded}개는 위키 항목으로 만들지 않습니다.`;
    return;
  }
  const outlineTitleById = outlineTitleMap();
  const candidatesBySource = new Map<string, CandidateItem[]>();
  for (const cand of candidates) {
    const arr = candidatesBySource.get(cand.source_id) ?? [];
    arr.push(cand);
    candidatesBySource.set(cand.source_id, arr);
  }
  const built: WikiEntry[] = [];
  const allMappings: CandidateMapping[] = [];
  for (const [source_id, sourceCandidates] of candidatesBySource) {
    const mappings = fallbackMappingsWithOutline(sourceCandidates);
    allMappings.push(...mappings);
    built.push(...buildEntriesFromCandidates({
      source_id,
      candidates: sourceCandidates,
      mappings,
      outlineTitleById,
      chunks: chunksForSource(source_id),
    }));
  }
  await saveEntries(built);
  const mapped = allMappings.filter((m) => m.outline_node_id).length;
  const excludedNotice = excluded > 0
    ? ` 구조/목차성 후보 ${structuralExcluded}개와 보류/폐기 후보 ${decisionExcluded}개는 위키 저장에서 제외했습니다.`
    : '';
  pipeline.notice =
    `결정적 추출(오프라인)로 위키 항목을 생성했습니다. 목차 매핑 ${mapped}/${allMappings.length}개. ` +
    'LLM 후보는 카드별 복붙/자동 추출에서 검증 후 가져올 수 있습니다.' +
    excludedNotice;
}

async function tryBuildWikiAuto(bundle: NonNullable<typeof pipeline.bundle>): Promise<boolean> {
  const sourceChunks = chunksForSource(bundle.source_id);
  if (sourceChunks.length === 0) {
    pipeline.notice = '자동 LLM에 보낼 원문 청크가 없습니다.';
    return false;
  }

  pipeline.notice = '자동 LLM 연결 준비 중… (첫 실행은 필요한 연결 도구 다운로드로 시간이 걸릴 수 있습니다)';
  const proxy = await ensureProxy();
  pipeline.llmCfg = await llmConfig();
  if (proxy.state !== 'ready') {
    pipeline.notice =
      proxy.reason ??
      'Codex 로그인은 감지됐지만 자동 LLM 연결이 아직 준비되지 않았습니다.';
    return false;
  }

  const batches = chunkBatches(sourceChunks, AUTO_CHUNKS_PER_BATCH);
  const progressSignature = outlineSignature();
  const progress = loadAutoProgress(bundle.source_id, batches.length, progressSignature);
  const startBatch = progress?.nextBatch ?? 0;
  if (startBatch >= batches.length) {
    pipeline.notice =
      `이 원문의 자동 LLM 배치가 이미 끝났습니다(${batches.length}/${batches.length}). ` +
      '다시 전체 재생성하려면 원문을 새로 올린 뒤 진행하세요.';
    return true;
  }
  const endBatch = Math.min(startBatch + AUTO_BATCHES_PER_RUN, batches.length);
  const schema = outlineKeywords(pipeline.outline, []);
  const importableByKey = new Map<string, ValidatedCandidate>();
  let totalCandidates = 0;
  let skippedBatches = 0;
  let structuralRejected = 0;
  let advancedBatches = 0;
  let incompleteBatches = 0;
  let stopReason: string | null = null;

  for (let i = startBatch; i < endBatch; i++) {
    const batch = batches[i];
    pipeline.notice =
      `자동 LLM 배치 ${i + 1}/${batches.length} 처리 중… ` +
      `(이번 실행 ${i - startBatch + 1}/${endBatch - startBatch}, 청크 ${(batch[0]?.order ?? -1) + 1}-${(batch[batch.length - 1]?.order ?? -1) + 1}, 응답당 후보 최대 8개)`;

    const prompt = buildGlobalPrompt({ chunks: batch, schema });
    const traceBase: AutoLlmBatchTrace = {
      source_id: bundle.source_id,
      batch_index: i + 1,
      total_batches: batches.length,
      chunk_orders: batch.map((ch) => ch.order),
      chunk_ids: batch.map((ch) => ch.chunk_id),
      prompt_version: PROMPT_VERSION,
      prompt_char_count: prompt.length,
      raw_response: null,
      provider_ok: false,
      provider_error: null,
      parse_ok: false,
      parse_error: null,
      parse_recovered: false,
      parse_recovered_count: null,
      validation_shape_ok: null,
      validation_top_level_error: null,
      candidates: [],
    };
    const extraction = await codexProvider.runExtraction(prompt);
    if (!extraction.ok) {
      stopReason = extraction.message;
      appendAutoLlmTrace({
        ...traceBase,
        provider_error: extraction.message,
      });
      break;
    }
    traceBase.provider_ok = true;
    traceBase.raw_response = extraction.rawText;

    const parsed = parseResponse(extraction.rawText);
    if (!parsed.ok) {
      skippedBatches += 1;
      stopReason = parsed.message;
      appendAutoLlmTrace({
        ...traceBase,
        parse_error: parsed.message,
      });
      break;
    }
    traceBase.parse_ok = true;
    traceBase.parse_recovered = parsed.recovered === true;
    traceBase.parse_recovered_count = parsed.recoveredCount ?? null;
    if (parsed.recovered) {
      incompleteBatches += 1;
      skippedBatches += 1;
      stopReason =
        'LLM 응답 JSON이 중간에 잘려 일부 후보만 복구되었습니다. 이 배치는 진행 저장하지 않고 다음 실행에서 다시 시도합니다.';
      appendAutoLlmTrace(traceBase);
      break;
    }

    const validation = validateResponse(parsed.value, batch);
    traceBase.validation_shape_ok = validation.shapeOk;
    traceBase.validation_top_level_error = validation.topLevelError;
    traceBase.candidates = validation.candidates.map(validatedCandidateToTrace);
    if (!validation.shapeOk) {
      skippedBatches += 1;
      stopReason = validation.topLevelError ?? 'LLM 응답 형식이 올바르지 않습니다.';
      appendAutoLlmTrace(traceBase);
      break;
    }
    appendAutoLlmTrace(traceBase);
    advancedBatches += 1;
    totalCandidates += validation.candidates.length;
    structuralRejected += validation.candidates.filter((cand) =>
      cand.violations.some((v) => v.includes('구조 정보 후보 제외')),
    ).length;

    for (const cand of validation.importable) {
      const key = candidateDedupeKey(cand);
      const indexed = { ...cand, index: i * 1_000_000 + cand.index };
      const previous = importableByKey.get(key);
      importableByKey.set(key, previous ? mergeValidatedCandidates(previous, indexed) : indexed);
    }
  }

  const nextBatch = startBatch + advancedBatches;
  const importable = [...importableByKey.values()].sort((a, b) => a.index - b.index);

  if (importable.length === 0) {
    if (advancedBatches > 0) {
      const cumulativeImported = progress?.imported ?? 0;
      const cumulativeMapped = progress?.mapped ?? 0;
      saveAutoProgress({
        source_id: bundle.source_id,
        outline_signature: progressSignature,
        nextBatch,
        totalBatches: batches.length,
        imported: cumulativeImported,
        mapped: cumulativeMapped,
        updated_at: new Date().toISOString(),
      });
      const recoveryNotice =
        incompleteBatches > 0
          ? ` 잘린 JSON 배치 ${incompleteBatches}개는 진행 저장하지 않았습니다.`
          : '';
      const skippedNotice =
        skippedBatches > 0 ? ` 파싱/형식 문제로 건너뛴 배치 ${skippedBatches}개.` : '';
      const structuralNotice =
        structuralRejected > 0
          ? ` 목차/표제/저자명/참고문헌성 후보 ${structuralRejected}개는 구조 정보로 보고 제외했습니다.`
          : '';
      const stoppedNotice = stopReason ? ` 중간 중단: ${stopReason}` : '';
      const nextNotice =
        nextBatch < batches.length
          ? ` 다음에 “위키 생성”을 다시 누르면 ${nextBatch + 1}/${batches.length} 배치부터 이어서 진행합니다.`
          : ' 자동 LLM 배치를 모두 처리했습니다.';
      pipeline.notice =
        `자동 LLM 배치 ${startBatch + 1}-${nextBatch}/${batches.length}를 처리했습니다(한 번에 최대 ${AUTO_BATCHES_PER_RUN}배치). ` +
        `이번 실행 후보 ${totalCandidates}개 중 위키로 가져올 후보는 없었습니다. 진행은 ${nextBatch}/${batches.length}까지 저장했습니다. ` +
        `누적 ${cumulativeImported}개 가져옴, 목차 매핑 ${cumulativeMapped}개. ` +
        '원문은 실제 chunk_id/quote에서 검증했고, 위조 chunk_id는 검증기에서 차단했습니다.' +
        recoveryNotice +
        skippedNotice +
        structuralNotice +
        stoppedNotice +
        nextNotice;
      if (stopReason) {
        pipeline.notice += ' 자동 경로가 중간에 멈췄습니다.';
        return false;
      }
      return true;
    }
    const reason = stopReason ? `${stopReason} ` : '';
    pipeline.notice =
      `${reason}자동 LLM 후보 ${totalCandidates}개를 받았지만 근거 검증을 통과한 후보가 없습니다. ` +
      '이번 자동 배치는 진행 저장하지 않았습니다.';
    return false;
  }

  const entries = importable.map((cand) =>
    buildEntryFromValidated(cand, {
      source_id: bundle.source_id,
      chunks: sourceChunks,
      outlineNodeId: outlineNodeIdForSchema(
        cand.schema_field,
        `${cand.title}\n${cand.summary_ko}\n${cand.reason}`,
      ),
    }),
  );
  if (entries.length > 0) await saveEntries(entries);
  const mapped = entries.filter((e) => e.outline_node_id).length;
  const cumulativeImported = (progress?.imported ?? 0) + entries.length;
  const cumulativeMapped = (progress?.mapped ?? 0) + mapped;
  saveAutoProgress({
    source_id: bundle.source_id,
    outline_signature: progressSignature,
    nextBatch,
    totalBatches: batches.length,
    imported: cumulativeImported,
    mapped: cumulativeMapped,
    updated_at: new Date().toISOString(),
  });
  const recoveryNotice =
    incompleteBatches > 0
      ? ` 잘린 JSON 배치 ${incompleteBatches}개는 진행 저장하지 않았습니다.`
      : '';
  const skippedNotice =
    skippedBatches > 0 ? ` 파싱/형식 문제로 건너뛴 배치 ${skippedBatches}개.` : '';
  const structuralNotice =
    structuralRejected > 0
      ? ` 목차/표제/저자명/참고문헌성 후보 ${structuralRejected}개는 구조 정보로 보고 제외했습니다.`
      : '';
  const stoppedNotice = stopReason ? ` 중간 중단: ${stopReason}` : '';
  const nextNotice =
    nextBatch < batches.length
      ? ` 다음에 “위키 생성”을 다시 누르면 ${nextBatch + 1}/${batches.length} 배치부터 이어서 진행합니다.`
      : ' 자동 LLM 배치를 모두 처리했습니다.';
  pipeline.notice =
    `자동 LLM 배치 ${startBatch + 1}-${nextBatch}/${batches.length}를 처리했습니다(한 번에 최대 ${AUTO_BATCHES_PER_RUN}배치). ` +
    `이번 실행 후보 ${totalCandidates}개 중 ${entries.length}개를 위키 초안으로 가져왔고, 목차 매핑 ${mapped}/${entries.length}개입니다. ` +
    `누적 ${cumulativeImported}개 가져옴, 목차 매핑 ${cumulativeMapped}개. ` +
    '원문은 실제 chunk_id/quote에서 복원했고, 위조 chunk_id는 검증기에서 차단했습니다.' +
    recoveryNotice +
    skippedNotice +
    structuralNotice +
    stoppedNotice +
    nextNotice;
  return true;
}

/**
 * Build wiki drafts from the current source.
 *
 * Offline/default path: deterministic candidates only.
 * Auto path: a whole-source LLM prompt may propose `wiki_candidates`, but every
 * item must pass the same bridge validator before import. This keeps the local
 * wiki invariants intact: original text is restored from real chunks, and
 * forged chunk_id evidence is rejected before any write.
 */
export async function buildWiki() {
  const bundle = pipeline.bundle;
  if (!bundle) {
    pipeline.notice = '먼저 원문을 업로드하세요.';
    return;
  }
  const qualityNotice = badTextQualityNotice();
  if (qualityNotice) {
    pipeline.notice = qualityNotice;
    return;
  }
  pipeline.busy = true;
  pipeline.notice = null;
  try {
    let autoNotice: string | null = null;
    if (autoModeActive() && pipeline.bundles.length > 1) {
      autoNotice =
        '여러 원서를 한 세션에 올린 경우 자동 전체 LLM 위키 생성은 아직 지원하지 않아 오프라인 생성으로 진행합니다.';
    } else if (autoModeActive()) {
      const ok = await tryBuildWikiAuto(bundle);
      if (ok) return;
      autoNotice = pipeline.notice;
    }

    await buildWikiOffline(bundle);
    if (autoNotice) {
      pipeline.notice =
        `${autoNotice} 대신 결정적 추출(오프라인)로 원문 기반 위키를 생성했습니다. ` +
        '번역이나 LLM 검토는 위키 탭에서 자동 LLM 연결이 준비되면 다시 실행할 수 있습니다. ' +
        pipeline.notice;
    }
  } catch (err) {
    pipeline.notice = `위키 생성 중 오류: ${(err as Error).message}`;
  } finally {
    pipeline.busy = false;
  }
}

export async function onSaveEntry(entry: WikiEntry) {
  await saveEntryAndIndex(entry);
  pipeline.entries = await loadAllEntries();
}

/* ---------------- Slice 5b — ChatGPT copy-paste bridge ---------------- */

/**
 * All loaded chunks that belong to one source, in document order. This is the
 * binding/preservation pool for a candidate: evidence may bind ONLY within the
 * source the candidate came from, so in a multi-source session a candidate can
 * never match a real chunk_id from a different source (provenance integrity).
 * Deterministic. NO LLM, NO network.
 */
function chunksForSource(source_id: string): Chunk[] {
  return [...pipeline.chunks]
    .filter((ch) => ch.source_id === source_id)
    .sort((a, b) => a.order - b.order);
}

function cardKey(card: { scored: { candidate: { source_id: string; local_candidate_id: string } } }): string {
  const cand = card.scored.candidate;
  return candidateReviewKey(cand.source_id, cand.local_candidate_id);
}

/**
 * Chunks that back a candidate: the chunk that contains the candidate span,
 * plus its immediate document neighbours for context. Scoped to the candidate's
 * OWN source so the prompt never carries another source's text. Deterministic
 * (sorted by order). NO LLM, NO network.
 */
function chunksForCandidate(candidateKey: string): Chunk[] {
  const card = pipeline.candidateCards.find((c) => cardKey(c) === candidateKey);
  if (!card) return [];
  const span = card.scored.candidate.span;
  const sourceChunks = chunksForSource(card.scored.candidate.source_id);
  const hitIdx = sourceChunks.findIndex(
    (ch) => span.start >= ch.location.char_start && span.start < ch.location.char_end,
  );
  if (hitIdx < 0) {
    // No char-span hit (e.g. LLM-origin candidate): fall back to all chunks for
    // the same source so the user still has real chunk_ids to bind against.
    return sourceChunks;
  }
  const lo = Math.max(0, hitIdx - 1);
  const hi = Math.min(sourceChunks.length - 1, hitIdx + 1);
  return sourceChunks.slice(lo, hi + 1);
}

/** Build the PromptInput for the bridge's currently-open candidate, or null. */
export function bridgePromptInput(): PromptInput | null {
  const id = pipeline.bridgeCandidateId;
  if (!id) return null;
  const card = pipeline.candidateCards.find((c) => cardKey(c) === id);
  if (!card) return null;
  return {
    candidate: card.scored,
    chunks: chunksForCandidate(id),
    schema: outlineKeywords(pipeline.outline, []),
  };
}

/** AC-COPY: open the copy-paste bridge for one candidate (prompt copy origin). */
export function openBridge(sourceId: string, candidateId: string) {
  pipeline.bridgeCandidateId = candidateReviewKey(sourceId, candidateId);
}

export function closeBridge() {
  pipeline.bridgeCandidateId = null;
}

function sortCardsForBatch(left: typeof pipeline.candidateCards[number], right: typeof pipeline.candidateCards[number]): number {
  const decisionRank = { approved: 0, pending: 1, held: 2, discarded: 3 } as const;
  const actionRank = { create_new: 0, update_existing: 1, link_only: 2, ignore: 3 } as const;
  return (
    decisionRank[left.decision] - decisionRank[right.decision] ||
    right.scored.total - left.scored.total ||
    actionRank[left.scored.recommended_action] - actionRank[right.scored.recommended_action] ||
    left.scored.candidate.source_id.localeCompare(right.scored.candidate.source_id) ||
    left.scored.candidate.local_candidate_id.localeCompare(right.scored.candidate.local_candidate_id)
  );
}

function chunksForBatchCard(card: typeof pipeline.candidateCards[number]): Chunk[] {
  const chunks = chunksForCandidate(cardKey(card));
  return chunks.length > 4 ? chunks.slice(0, 4) : chunks;
}

/** Build a top-N prompt package so normal users can paste one ChatGPT prompt, not one per card. */
export function batchBridgePromptInput(limit = 8): BatchPromptInput | null {
  const cards = [...pipeline.candidateCards]
    .filter((card) =>
      card.scored.recommended_action !== 'ignore' &&
      card.decision !== 'held' &&
      card.decision !== 'discarded',
    )
    .sort(sortCardsForBatch)
    .slice(0, limit);
  if (cards.length === 0) return null;

  const chunks: Chunk[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    for (const chunk of chunksForBatchCard(card)) {
      if (seen.has(chunk.chunk_id)) continue;
      seen.add(chunk.chunk_id);
      chunks.push(chunk);
    }
  }
  return {
    candidates: cards.map((card) => card.scored),
    chunks,
    schema: outlineKeywords(pipeline.outline, []),
  };
}

export function openBatchBridge() {
  pipeline.batchBridgeOpen = true;
}

export function closeBatchBridge() {
  pipeline.batchBridgeOpen = false;
}

function sourceIdForValidatedCandidate(cand: ValidatedCandidate): string | null {
  const chunksById = new Map(pipeline.chunks.map((chunk) => [chunk.chunk_id, chunk]));
  const sourceIds = new Set<string>();
  for (const ev of cand.evidence) {
    const source_id = chunksById.get(ev.chunk_id)?.source_id;
    if (source_id) sourceIds.add(source_id);
  }
  return sourceIds.size === 1 ? [...sourceIds][0] : null;
}

export async function importBatchBridgeCandidates(validated: ValidatedCandidate[]): Promise<number> {
  const importable = validated.filter((cand) => cand.importable);
  if (importable.length === 0) {
    pipeline.notice = '가져올 수 있는 ChatGPT 후보가 없습니다.';
    return 0;
  }

  pipeline.busy = true;
  try {
    const entries: WikiEntry[] = [];
    let skipped = 0;
    for (const cand of importable) {
      const source_id = sourceIdForValidatedCandidate(cand);
      if (!source_id) {
        skipped += 1;
        continue;
      }
      entries.push(buildEntryFromValidated(cand, {
        source_id,
        chunks: chunksForSource(source_id),
        outlineNodeId: outlineNodeIdForSchema(
          cand.schema_field,
          `${cand.title}\n${cand.summary_ko}\n${cand.reason}`,
        ),
      }));
    }
    if (entries.length > 0) await saveEntries(entries);
    const skippedNotice = skipped > 0
      ? ` 서로 다른 원서의 근거가 섞인 후보 ${skipped}개는 가져오지 않았습니다.`
      : '';
    pipeline.notice =
      `일괄 ChatGPT 후보 ${entries.length}개를 위키 초안으로 가져왔습니다. 좌측 “위키” 탭에서 확인하세요.` +
      skippedNotice;
    return entries.length;
  } catch (err) {
    pipeline.notice = `일괄 가져오기 중 오류: ${(err as Error).message}`;
    return 0;
  } finally {
    pipeline.busy = false;
  }
}

/**
 * AC-IMPORT + AC-APPROVE + AC-EVIDENCE-BIND: import a VALIDATED ChatGPT
 * candidate into the persistent wiki as a draft entry. The validated candidate
 * already binds to real chunk_ids (forged ones were rejected upstream); we
 * resolve original_text from the real chunk text (preservation) and save via
 * the slice-3 wiki store.
 */
export async function importBridgeCandidate(validated: ValidatedCandidate) {
  const id = pipeline.bridgeCandidateId;
  if (!id) return;
  const card = pipeline.candidateCards.find((c) => cardKey(c) === id);
  if (!card) return;
  pipeline.busy = true;
  try {
    const source_id = card.scored.candidate.source_id;
    // Original-text restoration pool is scoped to the candidate's OWN source, so
    // a chunk_id can only resolve to verbatim text from the same source the
    // candidate (and its entry.source_ids) claims.
    const entry = buildEntryFromValidated(validated, {
      source_id,
      chunks: chunksForSource(source_id),
      outlineNodeId: outlineNodeIdForSchema(
        validated.schema_field,
        `${validated.title}\n${validated.summary_ko}\n${card.scored.candidate.summary}`,
      ),
    });
    await saveEntryAndIndex(entry);
    pipeline.entries = await loadAllEntries();
    pipeline.notice = `ChatGPT 후보 「${validated.title}」을(를) 위키 초안으로 가져왔습니다(가톨릭 번역·원문 보존·근거 주석). 좌측 “위키” 탭에서 확인하세요.`;
  } catch (err) {
    pipeline.notice = `가져오기 중 오류: ${(err as Error).message}`;
  } finally {
    pipeline.busy = false;
  }
}

async function ensureLlmReady(actionLabel: string): Promise<boolean> {
  pipeline.notice = `${actionLabel} 연결 확인 중…`;
  const current = await llmConfig();
  pipeline.llmCfg = current;
  if (current.reachable) return true;

  const proxy = await ensureProxy();
  pipeline.llmCfg = await llmConfig();
  if (proxy.state === 'ready') return true;

  pipeline.notice =
    `${proxy.reason ?? '자동 LLM 연결이 준비되지 않았습니다.'} ` +
    `${actionLabel}은(는) 실행하지 못했습니다. 로그인 탭에서 [다시 검출]을 누르고, 필요하면 [ChatGPT로 로그인]을 다시 진행하세요. ` +
    'Node.js/npx가 없거나 openai-oauth 준비가 시간 초과되어도 이 상태가 됩니다.';
  return false;
}

function appendReviewNote(entry: WikiEntry, note: string) {
  const clean = note.trim();
  if (!clean) return;
  const stamped = `[${new Date().toLocaleString('ko-KR')}] ${clean}`;
  entry.review_notes = entry.review_notes?.trim()
    ? `${entry.review_notes.trim()}\n\n${stamped}`
    : stamped;
}

export async function onReviewClaim(entry: WikiEntry, claimId: string, original: string) {
  const claim = entry.claims.find((c) => c.claim_id === claimId);
  if (!claim) {
    pipeline.notice = '검토할 주장을 찾지 못했습니다.';
    return;
  }
  pipeline.busy = true;
  try {
    const ready = await ensureLlmReady('LLM 검토');
    if (!ready) return;

    pipeline.notice = 'LLM이 오프라인 생성 주장을 검토하는 중…';
    const r = await llmReviewClaim(claim.statement, original);
    if (!r.ok) {
      pipeline.notice = r.message;
      return;
    }

    const reviewed = r.value;
    if (reviewed.statement_ko.trim()) claim.statement = reviewed.statement_ko.trim();
    if (reviewed.translation_ko.trim()) claim.translated_text = reviewed.translation_ko.trim();
    const reviewNote = [
      reviewed.review_note_ko,
      reviewed.boundary_note ? `경계: ${reviewed.boundary_note}` : '',
      reviewed.recommended_action ? `권고: ${reviewed.recommended_action}` : '',
    ].filter(Boolean).join(' / ');
    appendReviewNote(entry, reviewNote);
    await onSaveEntry(entry);
    pipeline.notice = 'LLM 검토를 적용했습니다. 원문은 그대로 보존했고, 주장 문장·번역·검토 메모만 갱신했습니다.';
  } catch (err) {
    pipeline.notice = `LLM 검토 중 오류: ${(err as Error).message}`;
  } finally {
    pipeline.busy = false;
  }
}

export async function onTranslate(entry: WikiEntry, claimId: string, original: string) {
  pipeline.busy = true;
  try {
    const ready = await ensureLlmReady('가톨릭 용어 번역');
    if (!ready) return;

    const r = await llmTranslate(original);
    const claim = entry.claims.find((c) => c.claim_id === claimId);
    if (claim) {
      if (r.ok) {
        claim.translated_text = r.value; // original_text untouched — preservation invariant
        await onSaveEntry(entry);
        pipeline.notice = '가톨릭 용어 번역을 적용했습니다(원문 보존).';
      } else {
        pipeline.notice = r.message;
      }
    } else {
      pipeline.notice = '번역할 주장을 찾지 못했습니다.';
    }
  } catch (err) {
    pipeline.notice = `번역 중 오류: ${(err as Error).message}`;
  } finally {
    pipeline.busy = false;
  }
}
