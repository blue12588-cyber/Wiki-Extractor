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
 *     - Plaintext line wrapped in `"…"` or `“…”` of length ≥ 32 chars (single-quote
 *       wrapping is too noisy and intentionally NOT triggered).
 *     - Plaintext line wrapped in `「…」` (CJK quotation).
 *     - PDF text block containing an em-dash attribution `— <Author>` after a
 *       quoted run.
 *
 *   prose candidate (conservative fallback, any of):
 *     - Paragraph/line of 80-900 chars with a claim cue → argument.
 *     - Paragraph/line with method/approach cue → method.
 *     - Paragraph/line with objection/contrast cue → objection.
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
import { countClaimVerbs } from '../candidate/claimVerbs';
import { detectDemotion } from '../candidate/demotePatterns';
import { extractOriginalTerms } from '../candidate/originalTerms';

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
  /** Exact source slice used for persisted WikiClaim.original_text. */
  source_text?: string;
  /** UI/diagnostic evidence excerpt. May include context or truncation. */
  evidence_text: string;
  /** Source-visible Greek/Hebrew/Latin/technical terms useful for promotion. */
  original_terms?: string[];
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

/* ---------------- Shared prose heuristics ---------------- */

const SHORT_PROSE_MIN_CHARS = 35;
const PROSE_MIN_CHARS = 80;
const PROSE_MAX_CHARS = 900;
const QUOTE_MIN_EN_CHARS = 32;
const QUOTE_MIN_CJK_CHARS = 12;
const EVIDENCE_CONTEXT_MAX_CHARS = 900;

const METHOD_CUE_RE =
  /\b(method|methodology|approach|framework|analysis|criteria|principle|procedure|model|compare|comparison)\b|(?:방법론?|접근|분석|기준|원리|절차|모형|비교)/i;

const OBJECTION_CUE_RE =
  /\b(however|nevertheless|despite|although|against|rejects?|challenges?|criticizes?|disputes?|doubt|problem|limitation)\b|(?:그러나|하지만|반면|그럼에도|비판|반론|반박|거부|의문|한계|문제)/i;

const ARGUMENT_CUE_RE =
  /\b(because|therefore|thus|as a result|observes?|indicates?|emphasizes?)\b|(?:따라서|그러므로|때문|결과|보인다|시사|강조)/i;
const EXPLICIT_ARGUMENT_AGENT_RE =
  /\b(?:the\s+)?(?:author|authors|chapter|article|paper|study|text|analysis|scholar)\s+(?:argues?|claims?|maintains?|contends?|asserts?|concludes?|suggests?|demonstrates?|shows?)\b|(?:저자|필자|이\s*장|이\s*논문|본문)\s*(?:은|는|이|가)?\s*(?:주장|제안|지적|논증|강조|결론)/i;
const BOUNDARY_CUE_RE =
  /\b(not by itself|does not prove|cannot establish|requires?|must not|should not|do not|without|rather than|not as)\b|(?:만으로는|증명하지|입증하지|아니다|요구|필요|한계|경계|검증)/i;
const SHORT_METHOD_RE =
  /\b(?:this|the)\s+(?:method|approach|framework|analysis)\s+(?:compares?|uses?|analyzes?|examines?|distinguishes?|tests?)\b|(?:이\s*)?(?:방법|접근|분석)\s*(?:은|는|이|가)?\s*(?:비교|분석|검토|구분)/i;

function cleanOneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, max: number): string {
  const clean = cleanOneLine(text);
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function cleanEvidenceText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function truncateEvidence(text: string, max: number): string {
  const clean = cleanEvidenceText(text);
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function truncateAtWord(text: string, max: number): string {
  const clean = cleanOneLine(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace >= Math.floor(max * 0.65) ? cut.slice(0, lastSpace) : clean.slice(0, max)).trim();
}

function classifyProseCandidate(text: string): CandidateType | null {
  const clean = cleanOneLine(text);
  if (clean.length < SHORT_PROSE_MIN_CHARS || clean.length > PROSE_MAX_CHARS) return null;

  const claimCount = countClaimVerbs(clean);
  if (clean.length < PROSE_MIN_CHARS) {
    if (detectDemotion(clean).demoted && claimCount === 0) return null;
    if (EXPLICIT_ARGUMENT_AGENT_RE.test(clean)) return 'argument';
    if (SHORT_METHOD_RE.test(clean)) return 'method';
    return null;
  }

  if (detectDemotion(clean).demoted && claimCount === 0) return null;
  if (OBJECTION_CUE_RE.test(clean)) return 'objection';
  if (EXPLICIT_ARGUMENT_AGENT_RE.test(clean)) return 'argument';
  if (METHOD_CUE_RE.test(clean)) return 'method';
  if (BOUNDARY_CUE_RE.test(clean)) return 'method';
  if (claimCount > 0 || ARGUMENT_CUE_RE.test(clean)) return 'argument';
  return null;
}

function titleForProse(text: string): string {
  const clean = cleanOneLine(text);
  const firstSentence = clean.match(/^.{40,140}?[.!?](?:\s|$)/)?.[0] ?? clean;
  const title = firstSentence
    .replace(/[.!?]\s*$/, '')
    .replace(/^(?:however|nevertheless|therefore|thus),?\s+/i, '')
    .replace(
      /^(?:the author|the chapter|this chapter|this study|the text)\s+(?:argues?|suggests?|observes?|indicates?|maintains?|claims?|contends?|demonstrates?|shows?|challenges?|criticizes?)\s+(?:that\s+)?/i,
      '',
    )
    .replace(/^(?:저자는?|이\s*장(?:은|에서는)?)\s*(?:주장|제안|지적|강조|논증|비판|반박)(?:한다|하며|했다|하였다|하는)?\s*/i, '');
  return truncateAtWord(title || clean, 120);
}

async function buildProseCandidate(opts: {
  source_id: string;
  text: string;
  span: Span;
  evidence_refs: string[];
  page?: number;
  evidence_text?: string;
  source_text?: string;
}): Promise<CandidateItem | null> {
  const type = classifyProseCandidate(opts.text);
  if (!type) return null;
  const evidence_text = opts.evidence_text ?? opts.text;
  const source_text = opts.source_text ?? evidence_text;
  return withOriginalTerms({
    local_candidate_id: await buildCandidateId(opts.source_id, type, opts.span),
    title: titleForProse(opts.text),
    type,
    category: 'extracted',
    summary: truncate(opts.text, 300),
    evidence_refs: opts.evidence_refs,
    suggested_action: 'create_new',
    source_id: opts.source_id,
    page: opts.page,
    span: opts.span,
    source_text,
    evidence_text: truncateEvidence(evidence_text, EVIDENCE_CONTEXT_MAX_CHARS),
  });
}

function conceptTitleOriginalTerm(item: CandidateItem): string | null {
  if (item.type !== 'concept') return null;
  const clean = cleanOneLine(item.title)
    .replace(/^[\s"'“”‘’.,;:()[\]{}]+|[\s"'“”‘’.,;:()[\]{}]+$/g, '')
    .trim();
  if (clean.length < 2 || clean.length > 80) return null;
  if (clean.split(/\s+/).length > 6) return null;
  if (detectDemotion(clean).demoted) return null;
  return clean;
}

function withOriginalTerms(item: CandidateItem): CandidateItem {
  const titleTerm = conceptTitleOriginalTerm(item);
  const original_terms = mergeUnique(
    titleTerm ? [titleTerm] : [],
    extractOriginalTerms(`${item.title}\n${item.summary}\n${item.source_text ?? item.evidence_text}`),
  );
  return original_terms.length > 0 ? { ...item, original_terms } : item;
}

function compactDedupeText(text: string): string {
  return cleanOneLine(text).toLocaleLowerCase();
}

function candidateDedupeKey(item: CandidateItem): string {
  return [
    item.type,
    compactDedupeText(item.title),
    compactDedupeText(item.summary),
  ].join('\u0000');
}

function mergeUnique(left: string[] = [], right: string[] = [], max = 12): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of [...left, ...right]) {
    const clean = value.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

function dedupeCandidates(items: CandidateItem[]): CandidateItem[] {
  const byKey = new Map<string, CandidateItem>();
  for (const item of items) {
    const key = candidateDedupeKey(item);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, item);
      continue;
    }
    byKey.set(key, {
      ...prev,
      evidence_refs: mergeUnique(prev.evidence_refs, item.evidence_refs),
      original_terms: mergeUnique(prev.original_terms ?? [], item.original_terms ?? []),
      source_text: prev.source_text ?? item.source_text,
    });
  }
  return [...byKey.values()].sort((a, b) => a.span.start - b.span.start);
}

function lineContext(lines: string[], index: number): string {
  const parts: string[] = [];
  const prev = lines[index - 1]?.trim();
  const current = lines[index]?.trim();
  const next = lines[index + 1]?.trim();
  if (prev && prev.length <= 260) parts.push(prev);
  if (current) parts.push(current);
  if (next && next.length <= 260) parts.push(next);
  return truncateEvidence(parts.join('\n'), EVIDENCE_CONTEXT_MAX_CHARS);
}

interface LineSpan {
  start: number;
  end: number;
}

interface ProseBlock {
  text: string;
  raw: string;
  start: number;
  end: number;
  firstLine: number;
  lastLine: number;
}

function lineSpans(lines: string[], baseOffset = 0): LineSpan[] {
  const spans: LineSpan[] = [];
  let offset = baseOffset;
  for (const line of lines) {
    const start = offset;
    const end = start + line.length;
    spans.push({ start, end });
    offset = end + 1;
  }
  return spans;
}

function isStructuralLineSeparator(line: string): boolean {
  const clean = line.trim();
  if (!clean) return true;
  return clean.length < PROSE_MIN_CHARS && detectDemotion(clean).demoted;
}

function endsSentence(line: string): boolean {
  return /[.!?。！？]["”’')\]]?\s*$/.test(line.trim());
}

function proseBlocksFromLines(lines: string[], spans: LineSpan[], consumed: Set<number>): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  let current: number[] = [];

  function flush() {
    if (current.length === 0) return;
    const firstLine = current[0];
    const lastLine = current[current.length - 1];
    const raw = current.map((idx) => lines[idx]).join('\n');
    blocks.push({
      text: cleanOneLine(raw),
      raw,
      start: spans[firstLine].start,
      end: spans[lastLine].end,
      firstLine,
      lastLine,
    });
    current = [];
  }

  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i) || isStructuralLineSeparator(lines[i])) {
      flush();
      continue;
    }
    if (current.length > 0 && endsSentence(lines[current[current.length - 1]])) {
      flush();
    }
    current.push(i);
  }
  flush();
  return blocks;
}

/* ---------------- Markdown candidate heuristics ---------------- */

const MD_BOLD_DEFINE_RE = /\*\*([^*\n]+)\*\*\s*[—–-]\s*(.{8,})/;
const CONCEPT_HEADING_RE = /^(Concept|Definition|개념|정의)\b/i;

function splitMarkdownDefinitionBody(body: string): { definition: string; proseRemainder: string } {
  const clean = cleanOneLine(body);
  const sentence = clean.match(/^(.{8,260}?[.!?])\s+(.{40,})$/);
  if (!sentence) return { definition: clean, proseRemainder: '' };
  const proseRemainder = sentence[2].trim();
  return classifyProseCandidate(proseRemainder)
    ? { definition: sentence[1].trim(), proseRemainder }
    : { definition: clean, proseRemainder: '' };
}

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
      const nextOffset = blocks.slice(bi + 1).findIndex((b) => b.kind === 'paragraph');
      const nextIndex = nextOffset >= 0 ? bi + 1 + nextOffset : -1;
      const next = nextIndex >= 0 ? blocks[nextIndex] : null;
      const nextStart = next ? text.indexOf(next.raw, end) : -1;
      const nextEnd = next && nextStart >= 0 ? nextStart + next.raw.length : end;
      const summary = next ? next.text.split('\n').join(' ').slice(0, 240) : block.text;
      const span: Span = { start, end: nextEnd };
      const source_text = text.slice(start, nextEnd);
      out.push({
        local_candidate_id: await buildCandidateId(source_id, 'concept', span),
        title: block.text.replace(CONCEPT_HEADING_RE, '').replace(/^[\s:—–-]+/, '').trim() || block.text,
        type: 'concept',
        category: 'extracted',
        summary,
        evidence_refs:
          nextIndex >= 0
            ? [`${source_id}#md-block-${bi}`, `${source_id}#md-block-${nextIndex}`]
            : [`${source_id}#md-block-${bi}`],
        suggested_action: 'create_new',
        source_id,
        span,
        source_text,
        evidence_text: source_text,
      });
    }

    if (block.kind === 'paragraph') {
      const m = block.raw.match(MD_BOLD_DEFINE_RE);
      if (m) {
        const span: Span = { start, end };
        const definition = splitMarkdownDefinitionBody(m[2]);
        out.push({
          local_candidate_id: await buildCandidateId(source_id, 'concept', span),
          title: m[1].trim(),
          type: 'concept',
          category: 'extracted',
          summary: truncate(definition.definition, 240),
          evidence_refs: [`${source_id}#md-block-${bi}`],
          suggested_action: 'create_new',
          source_id,
          span,
          source_text: block.raw,
          evidence_text: block.raw,
        });
        if (definition.proseRemainder) {
          const prose = await buildProseCandidate({
            source_id,
            text: definition.proseRemainder,
            span,
            evidence_refs: [`${source_id}#md-block-${bi}`],
            evidence_text: block.raw,
            source_text: block.raw,
          });
          if (prose) out.push(prose);
        }
      }

      if (!m) {
        const span: Span = { start, end };
        const prose = await buildProseCandidate({
          source_id,
          text: block.text,
          span,
          evidence_refs: [`${source_id}#md-block-${bi}`],
          evidence_text: block.raw,
          source_text: block.raw,
        });
        if (prose) out.push(prose);
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
          source_text: block.raw,
          evidence_text: block.raw,
        });
      }
    }
  }
  return dedupeCandidates(out.map(withOriginalTerms));
}

/* ---------------- Plaintext candidate heuristics ---------------- */

const PT_CONCEPT_LINE_RE = /^\s*Concept\s*:\s*(.{3,})$/i;
const PT_KO_DEFINE_RE = /^(.{1,40}?)(?:은|는)\s+(.{6,}?)(?:이다|입니다)\.?\s*$/;
const PT_EN_DEFINE_EXPLICIT_RE =
  /^\s*(.{2,80}?)\s+(?:is|are)\s+(?:defined|understood|known)\s+as\s+(.{8,240})[.!?]?\s*$/i;
const PT_EN_DEFINE_REFERS_RE =
  /^\s*(.{2,80}?)\s+(?:refers to|denotes|means|signifies|describes)\s+(.{8,240})[.!?]?\s*$/i;
const PT_EN_DEFINE_IS_RE = /^\s*(.{2,80}?)\s+(?:is|are)\s+(a|an|the)\s+(.{8,240})[.!?]?\s*$/i;
const DEFINITION_SUBJECT_STOP_RE =
  /^(?:the|this|that|these|those)\s+(?:author|authors|chapter|book|article|paper|study|section|paragraph|line|text|example|table|figure|appendix)\b/i;
const DEFINITION_SUBJECT_VERB_RE =
  /\b(?:is|are|was|were|be|been|being|has|have|had|do|does|did|can|could|should|would|may|might|must|argues?|claims?|shows?|suggests?|states?)\b/i;
const DEFINITION_PREDICATE_NOUN_RE =
  /\b(?:account|approach|category|condition|construct|criterion|doctrine|effect|exchange|factor|framework|function|genre|indicator|instrument|method|model|norm|pattern|phenomenon|principle|procedure|process|protocol|relationship|rule|sense|standard|strategy|system|technique|term|theory|variable)\b/i;
const PT_QUOTE_EN_RE = new RegExp(`"([^"\\n]{${QUOTE_MIN_EN_CHARS},})"`);
const PT_QUOTE_CURLY_RE = new RegExp(`“([^”\\n]{${QUOTE_MIN_EN_CHARS},})”`);
const PT_QUOTE_CJK_RE = new RegExp(`「([^」\\n]{${QUOTE_MIN_CJK_CHARS},})」`);

function cleanDefinitionTitle(text: string): string {
  return text
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanDefinitionSummary(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/[.!?]\s*$/, '').trim();
}

function isLikelyDefinitionSubject(subject: string): boolean {
  const clean = cleanDefinitionTitle(subject);
  if (clean.length < 2 || clean.length > 80) return false;
  if (DEFINITION_SUBJECT_STOP_RE.test(clean)) return false;
  if (DEFINITION_SUBJECT_VERB_RE.test(clean)) return false;
  if (/[,;:()[\]{}]/.test(clean)) return false;
  const words = clean.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 6;
}

function isLikelyDefinitionPredicate(predicate: string): boolean {
  const clean = cleanDefinitionSummary(predicate);
  if (clean.length < 8 || clean.length > 260) return false;
  return DEFINITION_PREDICATE_NOUN_RE.test(clean) || /\b\w+-\w+\b/.test(clean);
}

function matchEnglishDefinitionLine(line: string): { title: string; summary: string } | null {
  const explicit = line.match(PT_EN_DEFINE_EXPLICIT_RE) ?? line.match(PT_EN_DEFINE_REFERS_RE);
  if (explicit) {
    const title = cleanDefinitionTitle(explicit[1]);
    const summary = cleanDefinitionSummary(explicit[2]);
    return isLikelyDefinitionSubject(title) && summary.length >= 8 ? { title, summary } : null;
  }
  const isDefinition = line.match(PT_EN_DEFINE_IS_RE);
  if (!isDefinition) return null;
  const title = cleanDefinitionTitle(isDefinition[1]);
  const summary = cleanDefinitionSummary(`${isDefinition[2]} ${isDefinition[3]}`);
  return isLikelyDefinitionSubject(title) && isLikelyDefinitionPredicate(summary)
    ? { title, summary }
    : null;
}

async function extractPlaintextCandidates(
  source_id: string,
  text: string,
): Promise<CandidateItem[]> {
  const out: CandidateItem[] = [];
  const lines = text.split('\n');
  const spans = lineSpans(lines);
  const consumed = new Set<number>();
  for (let li = 0; li < lines.length; li++) {
    const ln = lines[li];
    const lineStart = spans[li].start;
    const lineEnd = spans[li].end;

    // concept patterns
    const mCol = ln.match(PT_CONCEPT_LINE_RE);
    if (mCol) {
      consumed.add(li);
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
        source_text: ln,
        evidence_text: ln,
      });
      continue;
    }
    const mKo = ln.match(PT_KO_DEFINE_RE);
    if (mKo) {
      consumed.add(li);
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
        source_text: ln,
        evidence_text: ln,
      });
      continue;
    }
    const mEnDef = matchEnglishDefinitionLine(ln);
    if (mEnDef) {
      consumed.add(li);
      const span: Span = { start: lineStart, end: lineEnd };
      out.push({
        local_candidate_id: await buildCandidateId(source_id, 'concept', span),
        title: mEnDef.title.slice(0, 80),
        type: 'concept',
        category: 'extracted',
        summary: mEnDef.summary.slice(0, 240),
        evidence_refs: [`${source_id}#line-${li + 1}`],
        suggested_action: 'create_new',
        source_id,
        span,
        source_text: ln,
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
      consumed.add(li);
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
        source_text: ln,
        evidence_text: lineContext(lines, li),
      });
      continue;
    }
  }

  for (const block of proseBlocksFromLines(lines, spans, consumed)) {
    const prose = await buildProseCandidate({
      source_id,
      text: block.text,
      span: { start: block.start, end: block.end },
      evidence_refs: [
        block.firstLine === block.lastLine
          ? `${source_id}#line-${block.firstLine + 1}`
          : `${source_id}#lines-${block.firstLine + 1}-${block.lastLine + 1}`,
      ],
      evidence_text: block.raw,
      source_text: block.raw,
    });
    if (prose) out.push(prose);
  }
  return dedupeCandidates(out.map(withOriginalTerms));
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
    const spans = lineSpans(pageLines, pageStart);
    const consumed = new Set<number>();
    for (let li = 0; li < pageLines.length; li++) {
      const ln = pageLines[li];
      const lineStart = spans[li].start;
      const lineEnd = spans[li].end;

      // concept
      const mCol = ln.match(PT_CONCEPT_LINE_RE);
      if (mCol) {
        consumed.add(li);
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
          source_text: ln,
          evidence_text: ln,
        });
        continue;
      }
      const mKo = ln.match(PT_KO_DEFINE_RE);
      if (mKo) {
        consumed.add(li);
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
          source_text: ln,
          evidence_text: ln,
        });
        continue;
      }
      const mEnDef = matchEnglishDefinitionLine(ln);
      if (mEnDef) {
        consumed.add(li);
        const span: Span = { start: lineStart, end: lineEnd };
        out.push({
          local_candidate_id: await buildCandidateId(source_id, 'concept', span),
          title: mEnDef.title.slice(0, 80),
          type: 'concept',
          category: 'extracted',
          summary: mEnDef.summary.slice(0, 240),
          evidence_refs: [`${source_id}#page-${p + 1}-line-${li + 1}`],
          suggested_action: 'create_new',
          source_id,
          page: p + 1,
          span,
          source_text: ln,
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
        consumed.add(li);
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
          source_text: ln,
          evidence_text: lineContext(pageLines, li),
        });
        continue;
      }
    }

    for (const block of proseBlocksFromLines(pageLines, spans, consumed)) {
      const prose = await buildProseCandidate({
        source_id,
        text: block.text,
        span: { start: block.start, end: block.end },
        evidence_refs: [
          block.firstLine === block.lastLine
            ? `${source_id}#page-${p + 1}-line-${block.firstLine + 1}`
            : `${source_id}#page-${p + 1}-lines-${block.firstLine + 1}-${block.lastLine + 1}`,
        ],
        page: p + 1,
        evidence_text: block.raw,
        source_text: block.raw,
      });
      if (prose) out.push(prose);
    }
    cumulative += pageText.length + 1; // +1 for the page separator (\f)
  }
  return dedupeCandidates(out.map(withOriginalTerms));
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
    const text_quality = analyzePdfTextQuality(pdf.pages);
    const items =
      text_quality.level === 'bad' ? [] : await extractPdfCandidates(input.source_id, pdf.pages);
    return {
      source_id: input.source_id,
      source_kind: 'pdf',
      candidate_items: items,
      normalized_text: pdf.text,
      text_quality,
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
