/**
 * Candidate extractor — rule-based, deterministic, NO LLM.
 *
 * Authority: agreed_contract.json#AC-4 + AC-5 + AC-6.
 *
 * Heuristics:
 *
 *   concept candidate (any of):
 *     - Markdown heading whose text matches `Concept` / `개념` / `정의` / `Definition`,
 *       followed by the next paragraph (taken as the summary).
 *     - Markdown line containing `**<term>**\s*[—-]\s*<definition>` (bold-term
 *       + em-dash / hyphen + definition).
 *     - Plaintext line starting with `Concept:` (case-insensitive).
 *     - Korean defined-term pattern `<term>는|은\s+...\s+(이다|입니다)\.`
 *
 *   quotation candidate (any of):
 *     - Markdown blockquote `> ...` (any number of lines).
 *     - Plaintext line wrapped in `"…"` or `“…”` of length ≥ 12 chars (single-quote
 *       wrapping is too noisy and intentionally NOT triggered).
 *     - Plaintext line wrapped in `「…」` (CJK quotation).
 *     - PDF text block containing an em-dash attribution `— <Author>` after a
 *       quoted run.
 *
 * Determinism:
 *   - The function is pure; same `ExtractInput` → same `CandidateBundle`.
 *   - Order is preserved: candidate_items follow document order. Where a
 *     single block emits multiple types, the order is [concept, quotation].
 *   - local_candidate_id is computed as a stable SHA-256 prefix of
 *     `<source_id>:<type>:<span_start>:<span_end>`. The hash is computed via
 *     the platform `crypto.subtle` (Web Crypto, present in both Node 20+ and
 *     browsers); the prefix length is 16 hex chars.
 */

import { extractMarkdown, type MarkdownBlock } from './markdownExtractor';
import { extractPlainText } from './plainTextExtractor';
import { extractPdfText } from './pdfExtractor';
import { analyzePdfTextQuality, type TextQualityReport } from './textQuality';

export type CandidateType =
  | 'concept'
  | 'argument'
  | 'method'
  | 'scholar'
  | 'religious_text'
  | 'objection'
  | 'quotation'
  | 'other';

export type CandidateAction =
  | 'augment_existing'
  | 'create_new'
  | 'merge'
  | 'defer'
  | 'reject';

export interface Span {
  /** UTF-16 char offset into the normalized text. */
  start: number;
  end: number;
}

export interface CandidateItem {
  local_candidate_id: string;
  title: string;
  type: CandidateType;
  category: string;
  summary: string;
  evidence_refs: string[];
  suggested_action: CandidateAction;
  /** Path or filename of the source document. */
  source_id: string;
  /** Page number (1-based) for PDF inputs; undefined for plaintext/markdown. */
  page?: number;
  span: Span;
  evidence_text: string;
}

export interface CandidateBundle {
  source_id: string;
  source_kind: 'plaintext' | 'markdown' | 'pdf';
  /** All candidate items in document order. */
  candidate_items: CandidateItem[];
  /** The normalized full-document text (after extractor reduction). */
  normalized_text: string;
  /** Optional extraction-quality report. Present for PDFs. */
  text_quality?: TextQualityReport;
}

export interface ExtractInput {
  source_id: string;
  /** File name (used only for extension dispatch). */
  filename: string;
  buffer: Uint8Array;
}

async function sha256HexPrefix(s: string, prefixLen = 16): Promise<string> {
  const data = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex.slice(0, prefixLen);
}

async function buildCandidateId(
  source_id: string,
  type: CandidateType,
  span: Span,
): Promise<string> {
  return await sha256HexPrefix(`${source_id}:${type}:${span.start}:${span.end}`);
}

function dispatchKind(filename: string): 'plaintext' | 'markdown' | 'pdf' {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  return 'plaintext';
}

/* ---------------- Markdown candidate heuristics ---------------- */

const MD_BOLD_DEFINE_RE = /\*\*([^*\n]+)\*\*\s*[—–-]\s*(.{8,})/;
const CONCEPT_HEADING_RE = /^(Concept|Definition|개념|정의)\b/i;

async function extractMarkdownCandidates(
  source_id: string,
  text: string,
  blocks: MarkdownBlock[],
): Promise<CandidateItem[]> {
  const out: CandidateItem[] = [];
  // Walk blocks; track running char offset into raw text for span computation.
  // We use the raw block text and find its first occurrence in `text` for
  // span accuracy; this is deterministic because text is normalized.
  let searchFrom = 0;
  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    const idx = text.indexOf(block.raw, searchFrom);
    const start = idx >= 0 ? idx : searchFrom;
    const end = idx >= 0 ? idx + block.raw.length : start + block.raw.length;
    searchFrom = end;

    if (block.kind === 'heading' && CONCEPT_HEADING_RE.test(block.text)) {
      // Next paragraph block becomes the summary.
      const next = blocks.slice(bi + 1).find((b) => b.kind === 'paragraph');
      const summary = next ? next.text.split('\n').join(' ').slice(0, 240) : block.text;
      const span: Span = { start, end };
      out.push({
        local_candidate_id: await buildCandidateId(source_id, 'concept', span),
        title: block.text.replace(CONCEPT_HEADING_RE, '').replace(/^[\s:—–-]+/, '').trim() || block.text,
        type: 'concept',
        category: 'extracted',
        summary,
        evidence_refs: [`${source_id}#md-block-${bi}`],
        suggested_action: 'create_new',
        source_id,
        span,
        evidence_text: block.raw,
      });
    }

    if (block.kind === 'paragraph') {
      const m = block.text.match(MD_BOLD_DEFINE_RE);
      if (m) {
        const span: Span = { start, end };
        out.push({
          local_candidate_id: await buildCandidateId(source_id, 'concept', span),
          title: m[1].trim(),
          type: 'concept',
          category: 'extracted',
          summary: m[2].trim(),
          evidence_refs: [`${source_id}#md-block-${bi}`],
          suggested_action: 'create_new',
          source_id,
          span,
          evidence_text: block.raw,
        });
      }
    }

    if (block.kind === 'blockquote') {
      const trimmed = block.text.trim();
      if (trimmed.length >= 8) {
        const span: Span = { start, end };
        out.push({
          local_candidate_id: await buildCandidateId(source_id, 'quotation', span),
          title: trimmed.split('\n')[0].slice(0, 80),
          type: 'quotation',
          category: 'extracted',
          summary: trimmed.length > 240 ? trimmed.slice(0, 237) + '…' : trimmed,
          evidence_refs: [`${source_id}#md-block-${bi}`],
          suggested_action: 'create_new',
          source_id,
          span,
          evidence_text: block.raw,
        });
      }
    }
  }
  return out;
}

/* ---------------- Plaintext candidate heuristics ---------------- */

const PT_CONCEPT_LINE_RE = /^\s*Concept\s*:\s*(.{3,})$/i;
const PT_KO_DEFINE_RE = /^(.{1,40}?)(?:은|는)\s+(.{6,}?)(?:이다|입니다)\.?\s*$/;
const PT_QUOTE_EN_RE = /"([^"\n]{12,})"/;
const PT_QUOTE_CURLY_RE = /“([^”\n]{12,})”/;
const PT_QUOTE_CJK_RE = /「([^」\n]{4,})」/;

async function extractPlaintextCandidates(
  source_id: string,
  text: string,
): Promise<CandidateItem[]> {
  const out: CandidateItem[] = [];
  const lines = text.split('\n');
  let offset = 0;
  for (let li = 0; li < lines.length; li++) {
    const ln = lines[li];
    const lineStart = offset;
    const lineEnd = offset + ln.length;
    offset = lineEnd + 1; // +1 for the \n

    // concept patterns
    const mCol = ln.match(PT_CONCEPT_LINE_RE);
    if (mCol) {
      const span: Span = { start: lineStart, end: lineEnd };
      out.push({
        local_candidate_id: await buildCandidateId(source_id, 'concept', span),
        title: mCol[1].split(/[—–-]|:/)[0].trim().slice(0, 80) || mCol[1].trim().slice(0, 80),
        type: 'concept',
        category: 'extracted',
        summary: mCol[1].trim().slice(0, 240),
        evidence_refs: [`${source_id}#line-${li + 1}`],
        suggested_action: 'create_new',
        source_id,
        span,
        evidence_text: ln,
      });
      continue;
    }
    const mKo = ln.match(PT_KO_DEFINE_RE);
    if (mKo) {
      const span: Span = { start: lineStart, end: lineEnd };
      out.push({
        local_candidate_id: await buildCandidateId(source_id, 'concept', span),
        title: mKo[1].trim().slice(0, 80),
        type: 'concept',
        category: 'extracted',
        summary: mKo[2].trim().slice(0, 240),
        evidence_refs: [`${source_id}#line-${li + 1}`],
        suggested_action: 'create_new',
        source_id,
        span,
        evidence_text: ln,
      });
      continue;
    }

    // quotation patterns
    const mEn = ln.match(PT_QUOTE_EN_RE);
    const mCurly = ln.match(PT_QUOTE_CURLY_RE);
    const mCjk = ln.match(PT_QUOTE_CJK_RE);
    const mq = mEn ?? mCurly ?? mCjk;
    if (mq) {
      const span: Span = { start: lineStart, end: lineEnd };
      out.push({
        local_candidate_id: await buildCandidateId(source_id, 'quotation', span),
        title: mq[1].trim().slice(0, 80),
        type: 'quotation',
        category: 'extracted',
        summary: mq[1].trim().slice(0, 240),
        evidence_refs: [`${source_id}#line-${li + 1}`],
        suggested_action: 'create_new',
        source_id,
        span,
        evidence_text: ln,
      });
      continue;
    }
  }
  return out;
}

/* ---------------- PDF candidate heuristics ---------------- */

async function extractPdfCandidates(
  source_id: string,
  pages: string[],
): Promise<CandidateItem[]> {
  const out: CandidateItem[] = [];
  let cumulative = 0;
  for (let p = 0; p < pages.length; p++) {
    const pageText = pages[p];
    const pageStart = cumulative;
    // Run the plaintext heuristic on each page's text. The line-pattern
    // heuristics carry over: PDF text content extracted by pdfjs is
    // line-broken on visual rows.
    const pageLines = pageText.split('\n');
    let lineOffset = pageStart;
    for (let li = 0; li < pageLines.length; li++) {
      const ln = pageLines[li];
      const lineStart = lineOffset;
      const lineEnd = lineOffset + ln.length;
      lineOffset = lineEnd + 1;

      // concept
      const mCol = ln.match(PT_CONCEPT_LINE_RE);
      if (mCol) {
        const span: Span = { start: lineStart, end: lineEnd };
        out.push({
          local_candidate_id: await buildCandidateId(source_id, 'concept', span),
          title: mCol[1].split(/[—–-]|:/)[0].trim().slice(0, 80) || mCol[1].trim().slice(0, 80),
          type: 'concept',
          category: 'extracted',
          summary: mCol[1].trim().slice(0, 240),
          evidence_refs: [`${source_id}#page-${p + 1}-line-${li + 1}`],
          suggested_action: 'create_new',
          source_id,
          page: p + 1,
          span,
          evidence_text: ln,
        });
        continue;
      }
      const mKo = ln.match(PT_KO_DEFINE_RE);
      if (mKo) {
        const span: Span = { start: lineStart, end: lineEnd };
        out.push({
          local_candidate_id: await buildCandidateId(source_id, 'concept', span),
          title: mKo[1].trim().slice(0, 80),
          type: 'concept',
          category: 'extracted',
          summary: mKo[2].trim().slice(0, 240),
          evidence_refs: [`${source_id}#page-${p + 1}-line-${li + 1}`],
          suggested_action: 'create_new',
          source_id,
          page: p + 1,
          span,
          evidence_text: ln,
        });
        continue;
      }

      // quotation
      const mEn = ln.match(PT_QUOTE_EN_RE);
      const mCurly = ln.match(PT_QUOTE_CURLY_RE);
      const mCjk = ln.match(PT_QUOTE_CJK_RE);
      const mq = mEn ?? mCurly ?? mCjk;
      if (mq) {
        const span: Span = { start: lineStart, end: lineEnd };
        out.push({
          local_candidate_id: await buildCandidateId(source_id, 'quotation', span),
          title: mq[1].trim().slice(0, 80),
          type: 'quotation',
          category: 'extracted',
          summary: mq[1].trim().slice(0, 240),
          evidence_refs: [`${source_id}#page-${p + 1}-line-${li + 1}`],
          suggested_action: 'create_new',
          source_id,
          page: p + 1,
          span,
          evidence_text: ln,
        });
      }
    }
    cumulative += pageText.length + 1; // +1 for the page separator (\f)
  }
  return out;
}

/* ---------------- Public dispatch ---------------- */

export async function extractCandidates(input: ExtractInput): Promise<CandidateBundle> {
  const kind = dispatchKind(input.filename);
  if (kind === 'markdown') {
    const md = extractMarkdown(input.buffer);
    const items = await extractMarkdownCandidates(input.source_id, md.text, md.blocks);
    return {
      source_id: input.source_id,
      source_kind: 'markdown',
      candidate_items: items,
      normalized_text: md.text,
    };
  }
  if (kind === 'pdf') {
    const pdf = await extractPdfText(input.buffer);
    const items = await extractPdfCandidates(input.source_id, pdf.pages);
    return {
      source_id: input.source_id,
      source_kind: 'pdf',
      candidate_items: items,
      normalized_text: pdf.text,
      text_quality: analyzePdfTextQuality(pdf.pages),
    };
  }
  // plaintext fallback
  const pt = extractPlainText(input.buffer);
  const items = await extractPlaintextCandidates(input.source_id, pt.text);
  return {
    source_id: input.source_id,
    source_kind: 'plaintext',
    candidate_items: items,
    normalized_text: pt.text,
  };
}
