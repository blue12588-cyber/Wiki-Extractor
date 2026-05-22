/**
 * Markdown extractor — reduces Markdown to plain text while preserving
 * paragraph boundaries and quotation context.
 *
 * Authority: agreed_contract.json#AC-4 (concept + quotation coverage).
 *
 * Deterministic; same input → same output. No external Markdown parser is
 * used (no commonmark / no marked / no remark). The reduction set is
 * intentionally narrow because the candidate extractor only needs:
 *
 *   - `> ...` blockquote detection (for `quotation` candidates)
 *   - `## Heading` / `**term**` detection (for `concept` candidates)
 *   - paragraph boundaries (blank-line separated)
 *
 * GFM tables, footnotes, link refs, and code-fence syntax-highlight hints are
 * passed through as literal text — they do not corrupt the heuristics below.
 */

import { extractPlainText, type PlainTextExtractionResult } from './plainTextExtractor';

export interface MarkdownBlock {
  kind: 'heading' | 'paragraph' | 'blockquote' | 'list' | 'code' | 'hr';
  /** Raw block text including markers. */
  raw: string;
  /** Heading level for `kind === 'heading'`. */
  level?: number;
  /** Plain-text reduction (markers stripped). */
  text: string;
}

export interface MarkdownExtractionResult extends PlainTextExtractionResult {
  blocks: MarkdownBlock[];
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BLOCKQUOTE_LINE_RE = /^>\s?(.*)$/;
const LIST_LINE_RE = /^(\s*)([-*+]|\d+\.)\s+/;
const HR_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

export function extractMarkdown(buffer: Uint8Array): MarkdownExtractionResult {
  const pt = extractPlainText(buffer);
  const blocks: MarkdownBlock[] = [];
  const lines = pt.lines;
  let i = 0;
  let inCode = false;
  let codeBuf: string[] = [];
  while (i < lines.length) {
    const ln = lines[i];
    // Code fence toggling
    if (ln.startsWith('```')) {
      if (!inCode) {
        inCode = true;
        codeBuf = [];
        i++;
        continue;
      } else {
        blocks.push({ kind: 'code', raw: codeBuf.join('\n'), text: codeBuf.join('\n') });
        inCode = false;
        codeBuf = [];
        i++;
        continue;
      }
    }
    if (inCode) {
      codeBuf.push(ln);
      i++;
      continue;
    }
    // Blank line → block separator
    if (ln.trim().length === 0) {
      i++;
      continue;
    }
    // Horizontal rule
    if (HR_RE.test(ln)) {
      blocks.push({ kind: 'hr', raw: ln, text: '' });
      i++;
      continue;
    }
    // Heading
    const headingMatch = ln.match(HEADING_RE);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const txt = headingMatch[2].trim();
      blocks.push({ kind: 'heading', raw: ln, level, text: txt });
      i++;
      continue;
    }
    // Blockquote (consume consecutive `> ` lines into a single blockquote block)
    if (BLOCKQUOTE_LINE_RE.test(ln)) {
      const bqLines: string[] = [];
      const bqRaw: string[] = [];
      while (i < lines.length && BLOCKQUOTE_LINE_RE.test(lines[i])) {
        const m = lines[i].match(BLOCKQUOTE_LINE_RE)!;
        bqLines.push(m[1]);
        bqRaw.push(lines[i]);
        i++;
      }
      blocks.push({
        kind: 'blockquote',
        raw: bqRaw.join('\n'),
        text: bqLines.join('\n').trim(),
      });
      continue;
    }
    // List
    if (LIST_LINE_RE.test(ln)) {
      const listLines: string[] = [];
      while (i < lines.length && (LIST_LINE_RE.test(lines[i]) || (lines[i].startsWith(' ') && lines[i].trim().length > 0))) {
        listLines.push(lines[i]);
        i++;
      }
      const stripped = listLines.map((l) => l.replace(LIST_LINE_RE, '').trim()).join('\n');
      blocks.push({ kind: 'list', raw: listLines.join('\n'), text: stripped });
      continue;
    }
    // Paragraph: collect consecutive non-blank, non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim().length > 0 &&
      !HEADING_RE.test(lines[i]) &&
      !BLOCKQUOTE_LINE_RE.test(lines[i]) &&
      !HR_RE.test(lines[i]) &&
      !lines[i].startsWith('```')
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      const raw = paraLines.join('\n');
      // Inline marker reduction: drop `**`, `__`, `*` emphasis; keep text.
      const text = raw
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/_(.+?)_/g, '$1');
      blocks.push({ kind: 'paragraph', raw, text });
    }
  }
  return { ...pt, blocks };
}
