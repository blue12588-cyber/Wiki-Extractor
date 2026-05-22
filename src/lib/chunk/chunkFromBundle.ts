/**
 * chunkFromBundle — derive deterministic chunks from a CandidateBundle.
 *
 * Authority: agreed_contract.json#AC-CHUNK.
 *
 * Bridges the existing (regression-tested) candidate extractor output to the
 * chunker without modifying the extractor. For PDFs we recover page-start char
 * offsets from the `\f`-joined normalized text so each chunk gets a 1-based
 * page number; plaintext/markdown have no page axis.
 *
 * Pure; no I/O, no LLM.
 */

import { chunkSource, type Chunk } from './chunker';
import type { CandidateBundle } from '../extract/candidateExtractor';

/** Recover page-start char offsets from a `\f`-joined PDF normalized text. */
function pageStartsFromFormFeed(text: string): number[] {
  const starts = [0];
  let idx = text.indexOf('\f');
  while (idx >= 0) {
    starts.push(idx + 1);
    idx = text.indexOf('\f', idx + 1);
  }
  return starts;
}

export async function chunksFromBundle(bundle: CandidateBundle): Promise<Chunk[]> {
  const page_starts =
    bundle.source_kind === 'pdf' ? pageStartsFromFormFeed(bundle.normalized_text) : undefined;
  return await chunkSource({
    source_id: bundle.source_id,
    kind: bundle.source_kind,
    normalized_text: bundle.normalized_text,
    page_starts,
  });
}
