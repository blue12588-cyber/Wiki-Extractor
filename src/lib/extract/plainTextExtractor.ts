/**
 * Plaintext extractor — UTF-8 decode + line normalization.
 *
 * Authority: agreed_contract.json#AC-4 + AC-5 (deterministic).
 *
 * The function is pure: same buffer in → same string out, no I/O, no state.
 * Line endings are normalized to `\n`. No BOM stripping artifacts are
 * preserved; a leading BOM is dropped. Trailing whitespace per-line is kept
 * (this is content, not formatting).
 */

export interface PlainTextExtractionResult {
  text: string;
  /** One entry per logical paragraph (separated by blank line). */
  paragraphs: string[];
  /** One entry per line (post-normalization). */
  lines: string[];
}

export function extractPlainText(buffer: Uint8Array): PlainTextExtractionResult {
  const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: false });
  let raw = decoder.decode(buffer);
  // Strip UTF-8 BOM if the decoder kept it.
  if (raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1);
  }
  // Normalize line endings: CRLF / CR → LF.
  const normalized = raw.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  // Paragraphs = runs of non-blank lines, joined with single `\n`.
  const paragraphs: string[] = [];
  let acc: string[] = [];
  for (const ln of lines) {
    if (ln.trim().length === 0) {
      if (acc.length > 0) {
        paragraphs.push(acc.join('\n'));
        acc = [];
      }
    } else {
      acc.push(ln);
    }
  }
  if (acc.length > 0) paragraphs.push(acc.join('\n'));
  return { text: normalized, paragraphs, lines };
}
