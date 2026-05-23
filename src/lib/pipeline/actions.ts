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

import { pipeline } from './store.svelte';
import { verifyMagicBytes } from '$lib/upload/magicBytes';
import { computeSourceId } from '$lib/upload/sourceId';
import {
  extractCandidates,
  type CandidateItem,
} from '$lib/extract/candidateExtractor';
import { chunksFromBundle } from '$lib/chunk/chunkFromBundle';
import { chunksToJsonl } from '$lib/chunk/chunker';
import { type ParsedOutline, outlineForLlm } from '$lib/outline/outlineParser';
import {
  persistChunksJsonl,
  saveEntryAndIndex,
  loadAllEntries,
} from '$lib/wiki/wikiStore';
import {
  buildEntriesFromCandidates,
  fallbackMappings,
  type CandidateMapping,
} from '$lib/wiki/wikiBuilder';
import type { WikiEntry } from '$lib/wiki/wikiTypes';
import { llmExtract, llmClassify, llmTranslate, llmConfig } from '$lib/llm/llmClient';
import { autoModeActive } from '$lib/llm/modeStore.svelte';
import { ensureProxy } from '$lib/llm/codexProvider';
import { runCandidateEngine, type CandidateDecision } from '$lib/candidate/candidateEngine';
import { outlineKeywords } from '$lib/candidate/candidateEngine';
import type { Chunk } from '$lib/chunk/chunker';
import type { PromptInput } from '$lib/bridge/promptBuilder';
import type { ValidatedCandidate } from '$lib/bridge/responseValidator';
import { buildEntryFromValidated } from '$lib/bridge/wikiImport';

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

/** Deterministic, no-LLM extraction + AC-CHUNK auto-persist. */
async function runExtraction(file: File, full: Uint8Array, source_id: string, zone: UploadZoneHandle | null) {
  pipeline.extracting = true;
  pipeline.bundle = null;
  pipeline.chunks = [];
  pipeline.chunkStatus = null;
  pipeline.candidateCards = [];
  try {
    const bundle = await extractCandidates({ source_id, filename: file.name, buffer: full });
    pipeline.bundle = bundle;
    const chunks = await chunksFromBundle(bundle);
    pipeline.chunks = chunks;
    const jsonl = chunksToJsonl(chunks);
    const persisted = await persistChunksJsonl(source_id, jsonl);
    pipeline.chunkStatus = persisted
      ? `${persisted.chunk_count}개 청크 저장됨 → ${persisted.path}`
      : `${chunks.length}개 청크 생성됨`;
  } catch (err) {
    const e = err as { message?: string };
    zone?.set_reject(`추출 실패: ${e?.message ?? String(err)}`);
  } finally {
    pipeline.extracting = false;
  }
}

export async function onFileSelected(file: File, zone: UploadZoneHandle | null) {
  const headLen = Math.min(256, file.size);
  const head = new Uint8Array(await file.slice(0, headLen).arrayBuffer());
  const mb = verifyMagicBytes(file.name, head);
  if (!mb.ok) {
    zone?.set_reject(mb.reason ?? '매직 바이트 서명이 일치하지 않습니다.');
    return;
  }
  const full = new Uint8Array(await file.arrayBuffer());

  const invoke = resolveInvoke();
  if (!invoke) {
    const sid = await computeSourceId(full);
    zone?.set_success(`(미리보기) ${file.name} → data/sources/${sid}/`);
    await runExtraction(file, full, sid, zone);
    return;
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
    zone?.set_success(
      `${file.name} → data/sources/${result.source_id}/ (${result.byte_count} 바이트, ${result.detected_type})`,
    );
    await runExtraction(file, full, result.source_id, zone);
  } catch (err) {
    const e = err as UploadErr;
    zone?.set_reject(e?.reason ?? '업로드 실패');
  }
}

export function onOutlineParsed(parsed: ParsedOutline) {
  pipeline.outline = parsed;
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
  pipeline.scoring = true;
  try {
    const cards = runCandidateEngine({
      bundle: pipeline.bundle,
      chunks: pipeline.chunks,
      outline: pipeline.outline,
      existingEntries: pipeline.entries,
    });
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

/** Record a per-card user decision (승인/보류/폐기). In-memory only for 5a. */
export function onCandidateDecision(candidateId: string, next: CandidateDecision) {
  pipeline.candidateCards = pipeline.candidateCards.map((c) =>
    c.scored.candidate.local_candidate_id === candidateId ? { ...c, decision: next } : c,
  );
}

function outlineTitleMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const n of pipeline.outline?.nodes ?? []) map[n.id] = n.title;
  return map;
}

/** AC-LLM-EXTRACT + AC-CLASSIFY-MAP with offline-safe fallback. */
export async function buildWiki() {
  const bundle = pipeline.bundle;
  if (!bundle) {
    pipeline.notice = '먼저 원문을 업로드하세요.';
    return;
  }
  pipeline.busy = true;
  pipeline.notice = null;
  try {
    // 자동 LLM 모드면 LLM 호출 전에 openai-oauth 프록시를 띄운다(없으면 시작; npx -y로
    // 첫 실행 시 자동 설치). 프록시가 준비돼야 llm_extract/llm_classify가 실제 LLM
    // (codex 토큰)에 도달한다. 준비 실패 시 아래 호출들이 그대로 오프라인 결정적
    // 추출로 graceful degrade 하므로 앱은 계속 동작한다(강제 정지 없음).
    if (autoModeActive()) {
      // 첫 실행은 npx가 openai-oauth를 내려받느라 수십 초 걸릴 수 있다(이후 캐시됨).
      // 사용자가 멈춘 줄 알지 않도록 준비 중임을 먼저 알린다.
      pipeline.notice = '자동 LLM 프록시 준비 중… (첫 실행은 openai-oauth 다운로드로 시간이 걸릴 수 있습니다)';
      const proxy = await ensureProxy();
      pipeline.llmCfg = await llmConfig(); // "LLM 연결됨/미연결" 표시 갱신
      if (proxy.state !== 'ready') {
        pipeline.notice =
          proxy.reason ??
          '자동 LLM 프록시가 준비되지 않아 오프라인 추출로 진행합니다(앱은 계속 동작합니다).';
      }
    }

    let candidates: CandidateItem[] = bundle.candidate_items;
    let usedLlmExtract = false;

    const ex = await llmExtract(pipeline.chunks);
    if (ex.ok && ex.value.length > 0) {
      candidates = ex.value.map((c, i) => ({
        ...c,
        source_id: c.source_id ?? bundle.source_id,
        span: c.span ?? { start: 0, end: 0 },
        category: c.category ?? 'extracted',
        local_candidate_id: c.local_candidate_id ?? `llm-${i}`,
        evidence_refs: c.evidence_refs?.length ? c.evidence_refs : [bundle.source_id],
        evidence_text: c.evidence_text ?? '',
      }));
      usedLlmExtract = true;
    } else if (ex.ok === false) {
      pipeline.notice = ex.message;
    }

    let mappings: CandidateMapping[];
    const outlineNodes = outlineForLlm(pipeline.outline ?? { nodes: [], roots: [] });
    if (outlineNodes.length > 0) {
      const cl = await llmClassify(candidates, outlineNodes);
      if (cl.ok) {
        mappings = cl.value;
      } else {
        mappings = fallbackMappings(candidates);
        pipeline.notice = pipeline.notice ?? cl.message;
      }
    } else {
      mappings = fallbackMappings(candidates);
    }

    const built = buildEntriesFromCandidates({
      source_id: bundle.source_id,
      candidates,
      mappings,
      outlineTitleById: outlineTitleMap(),
    });

    for (const e of built) await saveEntryAndIndex(e);
    pipeline.entries = await loadAllEntries();

    if (!pipeline.notice) {
      pipeline.notice = usedLlmExtract
        ? 'LLM 추출·분류로 위키 항목을 생성했습니다.'
        : '결정적 추출(오프라인)로 위키 항목을 생성했습니다. 인증 시 LLM 추출을 사용할 수 있습니다.';
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

/**
 * Chunks that back a candidate: the chunk that contains the candidate span,
 * plus its immediate document neighbours for context. Scoped to the candidate's
 * OWN source so the prompt never carries another source's text. Deterministic
 * (sorted by order). NO LLM, NO network.
 */
function chunksForCandidate(candidateLocalId: string): Chunk[] {
  const card = pipeline.candidateCards.find(
    (c) => c.scored.candidate.local_candidate_id === candidateLocalId,
  );
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
  const card = pipeline.candidateCards.find(
    (c) => c.scored.candidate.local_candidate_id === id,
  );
  if (!card) return null;
  return {
    candidate: card.scored,
    chunks: chunksForCandidate(id),
    schema: outlineKeywords(pipeline.outline, []),
  };
}

/**
 * The real uploaded chunk_ids the bridge validates evidence against — scoped to
 * the OPEN bridge candidate's own source. Evidence can therefore only bind
 * within the source the candidate came from; a real chunk_id from a different
 * loaded source is treated as unknown (rejected), preserving provenance.
 */
export function bridgeKnownChunkIds(): string[] {
  const id = pipeline.bridgeCandidateId;
  if (!id) return [];
  const card = pipeline.candidateCards.find(
    (c) => c.scored.candidate.local_candidate_id === id,
  );
  if (!card) return [];
  return chunksForSource(card.scored.candidate.source_id).map((c) => c.chunk_id);
}

/** AC-COPY: open the copy-paste bridge for one candidate (prompt copy origin). */
export function openBridge(candidateId: string) {
  pipeline.bridgeCandidateId = candidateId;
}

export function closeBridge() {
  pipeline.bridgeCandidateId = null;
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
  const card = pipeline.candidateCards.find(
    (c) => c.scored.candidate.local_candidate_id === id,
  );
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
      outlineNodeId: card.scored.target_entry_id ? null : null,
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

export async function onTranslate(entry: WikiEntry, claimId: string, original: string) {
  pipeline.busy = true;
  try {
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
    }
  } finally {
    pipeline.busy = false;
  }
}
