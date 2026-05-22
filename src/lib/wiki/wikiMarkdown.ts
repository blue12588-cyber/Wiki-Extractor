/**
 * Wiki entry <-> Markdown (de)serialization.
 *
 * Authority: agreed_contract.json#AC-WIKI-PERSIST (human-readable + AI-readable)
 *            + AC-EDIT-PERSIST (round-trip) + AC-ANNOTATION (claim structure).
 *
 * Format: a frontmatter block delimited by `---`, followed by a Markdown body.
 * The body encodes claims as fenced blocks so the round-trip is lossless and a
 * human can read the file directly:
 *
 *   ---
 *   id: ...
 *   title: ...
 *   ...
 *   ---
 *   # <title>
 *
 *   <summary>
 *
 *   ## 주장 (claims)
 *
 *   ### <statement>
 *   - claim_id: ...
 *   - evidence: ref1, ref2
 *
 *   <!-- annotation:translated -->
 *   <translated_text>
 *   <!-- annotation:original -->
 *   <original_text>
 *   <!-- /annotation -->
 *
 * The annotation comments preserve the translated-above / original-below
 * ordering for AC-ANNOTATION and let the renderer reconstruct hover/click
 * toggles. Pure functions; no I/O.
 */

import type { WikiClaim, WikiEntry, WikiStatus } from './wikiTypes';

const FM_DELIM = '---';
const TR_OPEN = '<!-- annotation:translated -->';
const OR_OPEN = '<!-- annotation:original -->';
const ANN_CLOSE = '<!-- /annotation -->';

function escFm(v: string): string {
  // Frontmatter values are single-line; newlines collapse to spaces. The
  // multi-line original/translated text lives in the body, never frontmatter.
  return v.replace(/\r?\n/g, ' ').trim();
}

function fmList(arr: string[]): string {
  return arr.map((s) => escFm(s)).join(', ');
}

export function entryToMarkdown(entry: WikiEntry): string {
  const fm: string[] = [
    FM_DELIM,
    `id: ${escFm(entry.id)}`,
    `title: ${escFm(entry.title)}`,
    `category: ${escFm(entry.category)}`,
    `status: ${entry.status}`,
    `outline_node_id: ${entry.outline_node_id ?? ''}`,
    `source_ids: ${fmList(entry.source_ids)}`,
    `tags: ${fmList(entry.tags)}`,
    `related: ${fmList(entry.related)}`,
    `created_from_candidates: ${fmList(entry.created_from_candidates)}`,
    `created_at: ${entry.created_at ?? ''}`,
    `updated_at: ${entry.updated_at}`,
    `review_notes: ${escFm(entry.review_notes ?? '')}`,
    FM_DELIM,
    '',
    `# ${entry.title}`,
    '',
  ];
  if (entry.summary && entry.summary.trim()) {
    fm.push(entry.summary.trim(), '');
  }
  fm.push('## 주장 (claims)', '');
  for (const c of entry.claims) {
    fm.push(`### ${c.statement}`);
    fm.push(`- claim_id: ${escFm(c.claim_id)}`);
    fm.push(`- candidate_id: ${escFm(c.candidate_id ?? '')}`);
    fm.push(`- evidence: ${fmList(c.evidence_refs)}`);
    fm.push('');
    fm.push(TR_OPEN);
    fm.push(c.translated_text ?? '');
    fm.push(OR_OPEN);
    fm.push(c.original_text ?? '');
    fm.push(ANN_CLOSE);
    fm.push('');
  }
  return fm.join('\n');
}

function parseFmLine(line: string): [string, string] | null {
  const idx = line.indexOf(':');
  if (idx < 0) return null;
  return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
}

function splitList(v: string): string[] {
  if (!v.trim()) return [];
  return v.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

const STATUSES: WikiStatus[] = ['draft', 'reviewed', 'verified', 'deprecated', 'superseded'];

export function markdownToEntry(md: string): WikiEntry {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  // Frontmatter block.
  const fm: Record<string, string> = {};
  let i = 0;
  if (lines[0]?.trim() === FM_DELIM) {
    i = 1;
    while (i < lines.length && lines[i].trim() !== FM_DELIM) {
      const kv = parseFmLine(lines[i]);
      if (kv) fm[kv[0]] = kv[1];
      i++;
    }
    i++; // skip closing delim
  }

  // Claims: scan for "### " statements followed by meta + annotation block.
  const claims: WikiClaim[] = [];
  for (; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.startsWith('### ')) {
      const statement = ln.slice(4).trim();
      let claim_id = '';
      let candidate_id: string | null = null;
      let evidence_refs: string[] = [];
      let translated_text = '';
      let original_text = '';
      let j = i + 1;
      // meta lines
      for (; j < lines.length && lines[j].startsWith('- '); j++) {
        const kv = parseFmLine(lines[j].slice(2));
        if (!kv) continue;
        if (kv[0] === 'claim_id') claim_id = kv[1];
        else if (kv[0] === 'candidate_id') candidate_id = kv[1] || null;
        else if (kv[0] === 'evidence') evidence_refs = splitList(kv[1]);
      }
      // annotation block
      while (j < lines.length && lines[j].trim() !== TR_OPEN && !lines[j].startsWith('### ')) j++;
      if (lines[j]?.trim() === TR_OPEN) {
        j++;
        const trBuf: string[] = [];
        while (j < lines.length && lines[j].trim() !== OR_OPEN) {
          trBuf.push(lines[j]);
          j++;
        }
        translated_text = trBuf.join('\n').trim();
        if (lines[j]?.trim() === OR_OPEN) {
          j++;
          const orBuf: string[] = [];
          while (j < lines.length && lines[j].trim() !== ANN_CLOSE) {
            orBuf.push(lines[j]);
            j++;
          }
          original_text = orBuf.join('\n').trim();
        }
      }
      claims.push({
        claim_id: claim_id || `c${claims.length + 1}`,
        statement,
        translated_text,
        original_text,
        evidence_refs,
        candidate_id,
      });
      i = j;
    }
  }

  const status = STATUSES.includes(fm.status as WikiStatus) ? (fm.status as WikiStatus) : 'draft';

  return {
    id: fm.id ?? '',
    title: fm.title ?? '',
    category: fm.category ?? 'extracted',
    status,
    outline_node_id: fm.outline_node_id ? fm.outline_node_id : null,
    summary: null,
    claims,
    source_ids: splitList(fm.source_ids ?? ''),
    tags: splitList(fm.tags ?? ''),
    related: splitList(fm.related ?? ''),
    created_from_candidates: splitList(fm.created_from_candidates ?? ''),
    created_at: fm.created_at ? fm.created_at : null,
    updated_at: fm.updated_at ?? '',
    review_notes: fm.review_notes ? fm.review_notes : null,
  };
}
