/**
 * Semantic chunker — deterministic, NO LLM.
 *
 * Authority: agreed_contract.json#AC-CHUNK.
 * Ported from: harness-core/workflows/academic-source-ingest.md §"Step 2. Chunk".
 *   (adaptation recorded in docs/adaptation-from-harness-core.md)
 *
 * Upstream Step 2 chunking rules ported here:
 *   1. chapter/section headings (semantic boundary)
 *   2. paragraph clusters
 *   3. internal split only when a unit is too large (MAX_CHUNK_CHARS)
 * Each chunk retains source id, order, heading path, page/location range, and a
 * content hash — the upstream "Each chunk must retain source id, order, heading
 * path, page/location range, and hash" requirement, carried forward.
 *
 * Determinism contract:
 *   - Pure function: same (source_id, normalized_text, kind, pageBreaks) ->
 *     byte-identical Chunk[].
 *   - No I/O, no Date.now(), no randomness.
 *   - chunk_id is a stable SHA-256 prefix of `<source_id>:<order>:<char_start>:<char_end>`.
 *
 * View/edit/save NEVER call the LLM; chunking is the on-upload deterministic
 * step that feeds both the wiki view (offline) and the optional LLM extractor.
 */

const MAX_CHUNK_CHARS = 1800;
const MIN_CHUNK_CHARS = 1; // empty chunks are dropped

export type SourceKind = 'plaintext' | 'markdown' | 'pdf';

export interface ChunkLocation {
  /** UTF-16 char offset (inclusive) into the normalized text. */
  char_start: number;
  /** UTF-16 char offset (exclusive). */
  char_end: number;
  /** 1-based page number for PDF inputs; null otherwise. */
  page: number | null;
}

export interface Chunk {
  source_id: string;
  /** 0-based document order. */
  order: number;
  chunk_id: string;
  /** Heading trail leading to this chunk, outermost-first. Empty when none. */
  heading_path: string[];
  location: ChunkLocation;
  /** Normalized chunk text (verbatim slice of normalized_text — NOT mutated). */
  text: string;
  /** SHA-256 hex prefix (16 chars) of `text` for integrity / dedup. */
  content_hash: string;
}

export interface ChunkInput {
  source_id: string;
  kind: SourceKind;
  /** Normalized full-document text (preserved verbatim; never mutated). */
  normalized_text: string;
  /**
   * For PDFs: char offsets in normalized_text where each page begins (page 1 at
   * index 0). Used to attach a 1-based page number to each chunk. Omit/empty for
   * plaintext/markdown.
   */
  page_starts?: number[];
}

async function sha256HexPrefix(s: string, prefixLen = 16): Promise<string> {
  const data = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex.slice(0, prefixLen);
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/** 1-based page for a char offset given ascending page-start offsets. */
function pageForOffset(offset: number, pageStarts: number[]): number | null {
  if (!pageStarts.length) return null;
  let page = 1;
  for (let i = 0; i < pageStarts.length; i++) {
    if (offset >= pageStarts[i]) page = i + 1;
    else break;
  }
  return page;
}

/**
 * Split normalized text into semantic blocks at heading + blank-line
 * boundaries, tracking the running heading path. Returns block records with
 * exact char offsets into `text`.
 */
interface RawBlock {
  text: string;
  char_start: number;
  char_end: number;
  heading_path: string[];
}

function segmentBlocks(text: string, kind: SourceKind): RawBlock[] {
  const lines = text.split('\n');
  const blocks: RawBlock[] = [];
  const headingStack: { level: number; title: string }[] = [];

  let offset = 0;
  let acc: string[] = [];
  let accStart = 0;
  let accEnd = 0;

  const flush = (endOffset: number) => {
    if (acc.length === 0) return;
    const joined = acc.join('\n');
    const exactEnd = accEnd > accStart && accEnd <= endOffset ? accEnd : endOffset;
    if (joined.trim().length >= MIN_CHUNK_CHARS) {
      blocks.push({
        text: joined,
        char_start: accStart,
        char_end: exactEnd,
        heading_path: headingStack.map((h) => h.title),
      });
    }
    acc = [];
    accEnd = 0;
  };

  const consumeLineFragment = (
    ln: string,
    lineStart: number,
    lineEnd: number,
    nextOffset: number,
  ) => {
    // Heading boundary (markdown only; plaintext/pdf headings are rare and we
    // do not guess them to stay deterministic and faithful to the source).
    const hm = kind === 'markdown' ? ln.match(HEADING_RE) : null;
    if (hm) {
      flush(accEnd || (lineStart > accStart ? lineStart : accStart));
      const level = hm[1].length;
      const title = hm[2].trim();
      while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, title });
      // The heading line itself starts a new block context; next non-blank line
      // begins the body accumulation.
      accStart = nextOffset;
      return;
    }

    if (ln.trim().length === 0) {
      // blank line: paragraph cluster boundary
      flush(accEnd || lineStart);
      accStart = nextOffset;
      return;
    }

    if (acc.length === 0) accStart = lineStart;
    acc.push(ln);
    accEnd = lineEnd;
  };

  for (let li = 0; li < lines.length; li++) {
    const ln = lines[li];
    const lineStart = offset;
    const lineEnd = offset + ln.length;
    // advance offset past this line incl. the \n separator (except possibly last)
    offset = lineEnd + (li < lines.length - 1 ? 1 : 0);

    let fragmentStart = lineStart;
    const fragments = ln.split('\f');
    for (let fi = 0; fi < fragments.length; fi++) {
      const fragment = fragments[fi];
      const fragmentEnd = fragmentStart + fragment.length;
      const hasPageBreakAfter = fi < fragments.length - 1;
      const nextOffset = hasPageBreakAfter ? fragmentEnd + 1 : offset;
      consumeLineFragment(fragment, fragmentStart, fragmentEnd, nextOffset);
      if (hasPageBreakAfter) {
        flush(accEnd || fragmentEnd);
        accStart = fragmentEnd + 1;
        fragmentStart = fragmentEnd + 1;
      }
    }
  }
  flush(accEnd || text.length);

  // PDFs join pages with '\f'. Treat it as a hard boundary so one chunk cannot
  // silently span pages while still preserving exact char offsets into text.
  return blocks;
}

/**
 * Hard-split an over-long block at paragraph (\n\n) then, if still too long, at
 * a char window — preserving exact offsets. Deterministic.
 */
function splitOversize(block: RawBlock): RawBlock[] {
  if (block.text.length <= MAX_CHUNK_CHARS) return [block];
  const out: RawBlock[] = [];
  let cursor = 0;
  const t = block.text;
  while (cursor < t.length) {
    let end = Math.min(cursor + MAX_CHUNK_CHARS, t.length);
    if (end < t.length) {
      // try to break at the last newline within the window for a clean cut
      const nl = t.lastIndexOf('\n', end);
      if (nl > cursor) end = nl;
    }
    const slice = t.slice(cursor, end);
    out.push({
      text: slice,
      char_start: block.char_start + cursor,
      char_end: block.char_start + end,
      heading_path: block.heading_path,
    });
    cursor = end;
    // skip a single separator newline so we don't emit a leading-\n chunk
    if (t[cursor] === '\n') cursor += 1;
  }
  return out;
}

/**
 * Produce deterministic chunks from normalized text.
 */
export async function chunkSource(input: ChunkInput): Promise<Chunk[]> {
  const pageStarts = input.page_starts ?? [];
  const normalizedText = input.normalized_text.replace(/\r\n?/g, '\n');
  const raw = segmentBlocks(normalizedText, input.kind);
  const expanded: RawBlock[] = [];
  for (const b of raw) expanded.push(...splitOversize(b));

  const chunks: Chunk[] = [];
  for (let order = 0; order < expanded.length; order++) {
    const b = expanded[order];
    const trimmed = b.text.trim();
    if (trimmed.length < MIN_CHUNK_CHARS) continue;
    const chunk_id = await sha256HexPrefix(
      `${input.source_id}:${order}:${b.char_start}:${b.char_end}`,
    );
    const content_hash = await sha256HexPrefix(b.text);
    chunks.push({
      source_id: input.source_id,
      order,
      chunk_id,
      heading_path: b.heading_path,
      location: {
        char_start: b.char_start,
        char_end: b.char_end,
        page: pageForOffset(b.char_start, pageStarts),
      },
      text: b.text,
      content_hash,
    });
  }
  return chunks;
}

/** Serialize chunks to JSONL (one chunk object per line, trailing newline). */
export function chunksToJsonl(chunks: Chunk[]): string {
  return chunks.map((c) => JSON.stringify(c)).join('\n') + (chunks.length ? '\n' : '');
}
