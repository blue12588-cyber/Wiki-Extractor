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
import { llmExtract, llmClassify, llmTranslate } from '$lib/llm/llmClient';

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

  const path = (file as unknown as { path?: string }).path;
  if (!path) {
    zone?.set_reject('OS에서 파일을 드래그하세요(선택 대화상자는 경로에 접근할 수 없습니다).');
    return;
  }
  try {
    const result = await invoke<UploadResponse>('upload_file', { path });
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
