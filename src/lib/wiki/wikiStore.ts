/**
 * Wiki persistence adapter — Tauri host commands OR offline preview fallback.
 *
 * Authority: agreed_contract.json#AC-WIKI-PERSIST + AC-EDIT-PERSIST + AC-OFFLINE.
 *
 * In the Tauri shell, every read/write routes to the Rust wiki_cmd commands,
 * which persist under data/wiki/ on disk (survives restart).
 *
 * In the Vite preview (no Tauri), reads/writes fall back to localStorage so the
 * view/edit/save UI is demoable offline; this fallback is browser-only and is
 * never the authority in the packaged app.
 *
 * NONE of these calls touch the network or the LLM. This is the offline path:
 * it must keep working with no auth and no connectivity.
 */

import { entryToMarkdown, markdownToEntry } from './wikiMarkdown';
import type { CandidateReviewState } from '$lib/candidate/reviewState';
import type { WikiEntry, WikiIndexRecord, WikiLink } from './wikiTypes';

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function resolveInvoke(): Invoke | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: Invoke } };
  };
  const fn = w.__TAURI__?.core?.invoke;
  return typeof fn === 'function' ? fn : null;
}

/* ---------------- localStorage fallback (preview only) ---------------- */

const LS_PREFIX = 'llmwiki:';
const LS_INDEX = `${LS_PREFIX}index.json`;
const LS_LINKS = `${LS_PREFIX}links.json`;
const LS_CANDIDATE_REVIEW = `${LS_PREFIX}candidate_review_state.json`;
const lsEntry = (id: string) => `${LS_PREFIX}entry:${id}`;

function lsGet(key: string, fallback: string): string {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    /* preview-only; ignore quota errors */
  }
}

/* ---------------- Public API ---------------- */

export interface WikiEntryFile {
  id: string;
  path: string;
  markdown: string;
}

export async function saveEntry(entry: WikiEntry): Promise<WikiEntryFile> {
  const markdown = entryToMarkdown(entry);
  const invoke = resolveInvoke();
  if (invoke) {
    return await invoke<WikiEntryFile>('wiki_write_entry', { id: entry.id, markdown });
  }
  lsSet(lsEntry(entry.id), markdown);
  // maintain a simple id list in localStorage
  const ids = JSON.parse(lsGet(`${LS_PREFIX}ids`, '[]')) as string[];
  if (!ids.includes(entry.id)) {
    ids.push(entry.id);
    lsSet(`${LS_PREFIX}ids`, JSON.stringify(ids));
  }
  return { id: entry.id, path: `(preview) localStorage:${entry.id}`, markdown };
}

export async function readEntry(id: string): Promise<WikiEntry | null> {
  const invoke = resolveInvoke();
  if (invoke) {
    try {
      const file = await invoke<WikiEntryFile>('wiki_read_entry', { id });
      return markdownToEntry(file.markdown);
    } catch {
      return null;
    }
  }
  const md = lsGet(lsEntry(id), '');
  return md ? markdownToEntry(md) : null;
}

export async function listEntryIds(): Promise<string[]> {
  const invoke = resolveInvoke();
  if (invoke) {
    const items = await invoke<Array<{ id: string; path: string }>>('wiki_list_entries');
    return items.map((i) => i.id);
  }
  return JSON.parse(lsGet(`${LS_PREFIX}ids`, '[]')) as string[];
}

export async function loadAllEntries(): Promise<WikiEntry[]> {
  const ids = await listEntryIds();
  const out: WikiEntry[] = [];
  for (const id of ids) {
    const e = await readEntry(id);
    if (e) out.push(e);
  }
  return out;
}

export async function deleteEntry(id: string): Promise<void> {
  const invoke = resolveInvoke();
  if (invoke) {
    await invoke<boolean>('wiki_delete_entry', { id });
    return;
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(lsEntry(id));
  } catch {
    /* ignore */
  }
  const ids = (JSON.parse(lsGet(`${LS_PREFIX}ids`, '[]')) as string[]).filter((x) => x !== id);
  lsSet(`${LS_PREFIX}ids`, JSON.stringify(ids));
}

export async function readIndex(): Promise<WikiIndexRecord[]> {
  const invoke = resolveInvoke();
  const raw = invoke ? await invoke<string>('wiki_read_index') : lsGet(LS_INDEX, '[]');
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WikiIndexRecord[]) : [];
  } catch {
    return [];
  }
}

export async function writeIndex(records: WikiIndexRecord[]): Promise<void> {
  const json = JSON.stringify(records, null, 2);
  const invoke = resolveInvoke();
  if (invoke) {
    await invoke<string>('wiki_write_index', { json });
    return;
  }
  lsSet(LS_INDEX, json);
}

export async function readLinks(): Promise<WikiLink[]> {
  const invoke = resolveInvoke();
  const raw = invoke ? await invoke<string>('wiki_read_links') : lsGet(LS_LINKS, '[]');
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WikiLink[]) : [];
  } catch {
    return [];
  }
}

export async function writeLinks(links: WikiLink[]): Promise<void> {
  const json = JSON.stringify(links, null, 2);
  const invoke = resolveInvoke();
  if (invoke) {
    await invoke<string>('wiki_write_links', { json });
    return;
  }
  lsSet(LS_LINKS, json);
}

/** Rebuild index.json from a set of entries (derived projection). */
export function deriveIndex(entries: WikiEntry[]): WikiIndexRecord[] {
  return entries
    .map((e) => ({
      id: e.id,
      title: e.title,
      category: e.category,
      status: e.status,
      outline_node_id: e.outline_node_id,
      source_ids: e.source_ids,
      updated_at: e.updated_at,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Persist an entry AND refresh the derived index in one offline-safe step. */
export async function saveEntryAndIndex(entry: WikiEntry): Promise<WikiEntryFile> {
  const file = await saveEntry(entry);
  const all = await loadAllEntries();
  await writeIndex(deriveIndex(all));
  return file;
}

/* ---------------- Chunk persistence bridge (AC-CHUNK) ---------------- */

export async function persistChunksJsonl(source_id: string, jsonl: string): Promise<{ chunk_count: number; path: string } | null> {
  const invoke = resolveInvoke();
  if (invoke) {
    const r = await invoke<{ source_id: string; path: string; chunk_count: number }>('chunks_write', {
      args: { source_id, jsonl },
    });
    return { chunk_count: r.chunk_count, path: r.path };
  }
  // preview: stash under localStorage so the count is visible in demos.
  lsSet(`${LS_PREFIX}chunks:${source_id}`, jsonl);
  const count = jsonl.split('\n').filter((l) => l.trim().length > 0).length;
  return { chunk_count: count, path: `(preview) localStorage:chunks:${source_id}` };
}

export async function readChunksJsonl(source_id: string): Promise<string> {
  const invoke = resolveInvoke();
  if (invoke) {
    return await invoke<string>('chunks_read', { sourceId: source_id });
  }
  return lsGet(`${LS_PREFIX}chunks:${source_id}`, '');
}

/* ---------------- Candidate review persistence ---------------- */

export async function readCandidateReviewState(): Promise<CandidateReviewState> {
  const invoke = resolveInvoke();
  const raw = invoke ? await invoke<string>('candidate_review_read') : lsGet(LS_CANDIDATE_REVIEW, '{}');
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as CandidateReviewState)
      : {};
  } catch {
    return {};
  }
}

export async function writeCandidateReviewState(state: CandidateReviewState): Promise<void> {
  const json = JSON.stringify(state, null, 2);
  const invoke = resolveInvoke();
  if (invoke) {
    await invoke<string>('candidate_review_write', { json });
    return;
  }
  lsSet(LS_CANDIDATE_REVIEW, json);
}
