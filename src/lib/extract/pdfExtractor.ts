/**
 * PDF extractor — deterministic text extraction via pdfjs-dist (legacy build).
 *
 * Authority: agreed_contract.json#AC-5 (same-host re-parse byte-identical).
 *
 * Determinism plan:
 *   - We use the legacy CommonJS-compatible build of pdfjs-dist, which is
 *     Node-runnable without DOM.
 *   - Worker is disabled (`useWorkerFetch: false`, GlobalWorkerOptions left
 *     unset; we call without spinning a worker thread).
 *   - Font loading is disabled (`disableFontFace: true`,
 *     `useSystemFonts: false`). For text extraction we do not need glyph
 *     rendering — only the text content stream.
 *   - We extract via `page.getTextContent()` and concatenate `item.str`
 *     values in document order, inserting a single `\n` at each `hasEOL`
 *     marker and a single space between items on the same line.
 *
 * Because the input PDF buffer is identical across calls and the
 * concatenation procedure is pure, the output text is byte-identical
 * across calls on the same host.
 */

export interface PdfExtractionResult {
  /** Per-page raw text in document order. */
  pages: string[];
  /** All pages joined with `\f` (form-feed) separator. */
  text: string;
}

/** Lazy import so consumers that never call this extractor do not pay the cost. */
async function loadPdfjs(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  // Use the legacy ESM build — Node-compatible and worker-optional.
  // The dynamic import expression below is intentionally a string template so
  // bundlers do not eagerly inline the whole pdfjs payload.
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  return await import('pdfjs-dist/legacy/build/pdf.mjs');
}

export async function extractPdfText(buffer: Uint8Array): Promise<PdfExtractionResult> {
  const pdfjs = await loadPdfjs();
  // Defensive copy: pdfjs may mutate the underlying ArrayBuffer otherwise.
  const data = new Uint8Array(buffer.byteLength);
  data.set(buffer);
  const loadingTask = pdfjs.getDocument({
    data,
    // Determinism + Node-friendliness:
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    // Skip worker (run in main thread).
    useWorker: false,
    // No verbosity. Workaround: pdfjs-dist exposes verbosity via property.
    verbosity: 0,
  } as Parameters<typeof pdfjs.getDocument>[0]);
  const doc = await loadingTask.promise;
  const pages: string[] = [];
  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const parts: string[] = [];
      let lastY: number | null = null;
      for (const it of content.items as Array<{ str: string; hasEOL?: boolean; transform?: number[] }>) {
        const y = it.transform?.[5];
        if (lastY !== null && y !== undefined && Math.abs(lastY - y) > 0.5) {
          // Y-coordinate changed → assume new line. Idempotent with hasEOL.
          if (parts.length > 0 && !parts[parts.length - 1].endsWith('\n')) {
            parts.push('\n');
          }
        }
        parts.push(it.str ?? '');
        if (it.hasEOL) {
          parts.push('\n');
        } else {
          parts.push(' ');
        }
        if (y !== undefined) lastY = y;
      }
      // Collapse trailing whitespace runs introduced by item separators.
      const pageText = parts
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd();
      pages.push(pageText);
      // Free per-page resources for determinism.
      page.cleanup();
    }
  } finally {
    await doc.cleanup();
    await doc.destroy();
  }
  const text = pages.join('\f');
  return { pages, text };
}
