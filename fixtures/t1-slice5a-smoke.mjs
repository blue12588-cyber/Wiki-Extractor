#!/usr/bin/env node
/**
 * Tier-1 smoke for Slice 5a ACs (deterministic, OFFLINE, no LLM, no network).
 *
 * Authority: agreed_contract.json#AC-RULE-ENGINE + AC-CLASSIFY + AC-DEDUP +
 *            AC-DEMOTE + AC-CARD-UI(shape) + AC-SCHEMA-INPUT + AC-OFFLINE.
 *
 * Scenarios (run individually; exit 0 = pass):
 *   rule-determinism     same bundle+chunks → byte-identical scored candidates
 *   claim-verbs          EN + KO assertion verbs detected; non-verbs ignored
 *   demote-patterns      footnote/biblio/toc/index/copyright → demoted+ignore
 *   structural-filter    TOC headings / standalone names / quote-only cards are
 *                       structure/evidence-only, but scholar claims survive.
 *   classify-novelty     no existing wiki → create_new
 *   dedup-update-link    duplicate → update_existing; related → link_only
 *   schema-input         outline keyword raises schema-fit + appears in rationale
 *   promotion-signals    original/core terms + boundary cues survive scoring and
 *                        steer an existing hub update recommendation
 *   card-shape           every card carries action/why/locator/boundary (no score)
 *   decision-propagation user 승인/보류/폐기 survives refresh and gates offline save
 *   offline-no-network   engine modules import zero net/LLM symbols (static)
 *
 * Usage: node --import tsx fixtures/t1-slice5a-smoke.mjs <scenario>
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function pass(report) {
  console.log(JSON.stringify(report, null, 2));
  console.log('[ok]');
  process.exit(0);
}
function fail(report, msg) {
  console.log(JSON.stringify(report, null, 2));
  console.error(`[fail] ${msg}`);
  process.exit(1);
}

/* ---------------- shared fixture builders (in-memory, no I/O) ---------------- */

function mkCandidate(over = {}) {
  return {
    local_candidate_id: 'c-default',
    title: 'Figural interpretation',
    type: 'concept',
    category: 'extracted',
    summary: 'A reusable hermeneutic concept.',
    evidence_refs: ['src#chunk-0'],
    suggested_action: 'create_new',
    source_id: 'src',
    page: undefined,
    span: { start: 0, end: 40 },
    evidence_text: 'Hays argues that figural interpretation is retrospective recognition.',
    ...over,
  };
}

function mkChunk(over = {}) {
  return {
    source_id: 'src',
    order: 0,
    chunk_id: 'chunk-abc123',
    heading_path: ['Hermeneutics'],
    location: { char_start: 0, char_end: 400, page: 1 },
    text: 'A'.repeat(260) + ' Hays argues that figural interpretation is retrospective recognition.',
    content_hash: 'hash00',
    ...over,
  };
}

function mkEntry(over = {}) {
  return {
    id: 'e-fig',
    title: 'Figural interpretation',
    category: 'hermeneutics',
    status: 'draft',
    outline_node_id: null,
    summary: 'Concept hub for figural interpretation and retrospective recognition.',
    claims: [],
    source_ids: ['hays_2016'],
    original_terms: ['figural interpretation', 'retrospective recognition'],
    tags: ['figural-interpretation', 'typology', 'retrospective-recognition'],
    related: [],
    created_from_candidates: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    review_notes: null,
    ...over,
  };
}

/* ---------------------------------- scenarios ---------------------------------- */

async function ruleDeterminism() {
  const { scoreCandidates } = await import('../src/lib/candidate/scoringEngine.ts');
  const input = {
    candidates: [mkCandidate({ local_candidate_id: 'a' }), mkCandidate({ local_candidate_id: 'b', type: 'quotation', title: 'A short quote', evidence_text: '"a memorable line"' })],
    chunks: [mkChunk()],
    outlineKeywords: ['해석학', 'typology'],
    existingEntries: [],
  };
  const r1 = scoreCandidates(input);
  const r2 = scoreCandidates(input);
  const report = {
    scenario: 'rule-determinism',
    count: r1.length,
    identical: JSON.stringify(r1) === JSON.stringify(r2),
    first_action: r1[0]?.recommended_action,
    order_preserved: r1.map((s) => s.candidate.local_candidate_id).join(',') === 'a,b',
  };
  if (!report.identical) return fail(report, 'scoring not deterministic (re-run differs)');
  if (!report.order_preserved) return fail(report, 'candidate order not preserved');
  pass(report);
}

async function claimVerbs() {
  const { detectClaimVerbs, countClaimVerbs } = await import('../src/lib/candidate/claimVerbs.ts');
  const en = detectClaimVerbs('Hays argues and suggests; he also concludes. Arguably not a verb.');
  const ko = detectClaimVerbs('저자는 ~을 주장한다. 또한 새 개념을 정의한다. 결론짓는다.');
  const none = detectClaimVerbs('The cat sat on the mat. 고양이가 매트에 앉았다.');
  const noisy = detectClaimVerbs('The example shows up later. The proposed model is well-defined but not a claim.');
  const proposedVerb = detectClaimVerbs('Smith proposed that the model should be revised.');
  const report = {
    scenario: 'claim-verbs',
    en_matches: en.map((h) => h.match),
    ko_matches: ko.map((h) => h.match),
    noisy_matches: noisy.map((h) => h.match),
    none_count: countClaimVerbs('The cat sat on the mat. 고양이가 매트에 앉았다.'),
    noisy_count: noisy.length,
    proposed_verb_count: proposedVerb.length,
    arguably_excluded: !en.some((h) => h.match.toLowerCase() === 'arguably'),
  };
  if (en.length < 3) return fail(report, `expected ≥3 EN verb hits, got ${en.length}`);
  if (ko.length < 3) return fail(report, `expected ≥3 KO verb hits, got ${ko.length}`);
  if (report.none_count !== 0) return fail(report, 'false-positive verb match on non-claim text');
  if (report.noisy_count !== 0) return fail(report, 'false-positive verb match on phrasal/adjectival non-claims');
  if (report.proposed_verb_count !== 1) return fail(report, 'verbal "proposed that" should still count as a claim verb');
  if (!report.arguably_excluded) return fail(report, '"arguably" wrongly matched "argue"');
  pass(report);
}

async function demotePatterns() {
  const { detectDemotion } = await import('../src/lib/candidate/demotePatterns.ts');
  const { scoreCandidate } = await import('../src/lib/candidate/scoringEngine.ts');
  const samples = {
    footnote: '12. Smith, Title, p. 45, cf. ibid.',
    bibliography: '참고문헌\nSmith, J. (1999). A Book Title.',
    citation_fragment: 'Greenfield, “Hebrew Bible and Canaanite Literature,” 545-60; Hallo,',
    toc: '서론 ............ 12',
    index: 'grace, 12, 45, 78, 90',
    copyright: 'Copyright © 2020. All rights reserved. ISBN 978-0-13-468599-1',
  };
  const fired = {};
  for (const [k, t] of Object.entries(samples)) {
    fired[k] = detectDemotion(t).demoted;
  }
  // A demoted candidate should classify as ignore.
  const cand = mkCandidate({
    local_candidate_id: 'footnote-cand',
    title: 'footnote ref',
    summary: '',
    evidence_text: '12. Smith, Title, p. 45, cf. ibid.',
    type: 'quotation',
  });
  const scored = scoreCandidate(cand, [], new Set(), []);
  const report = {
    scenario: 'demote-patterns',
    fired,
    demoted_candidate_action: scored.recommended_action,
    penalty: scored.sub.demotion_penalty,
    demote_reasons: scored.rationale.demotion,
  };
  for (const [k, v] of Object.entries(fired)) {
    if (!v) return fail(report, `pattern not detected: ${k}`);
  }
  if (scored.recommended_action !== 'ignore') return fail(report, 'demoted candidate not classified ignore');
  if (scored.sub.demotion_penalty >= 0) return fail(report, 'no demotion penalty applied');
  pass(report);
}

async function structuralFilter() {
  const { structuralReasonForCandidate } = await import('../src/lib/candidate/structuralFilter.ts');
  const { scoreCandidate } = await import('../src/lib/candidate/scoringEngine.ts');
  const chapter = structuralReasonForCandidate({
    title: 'CHAPTER 7 - Postscript: Portraits of Yahweh',
    summary: '제7장 - 후기: Yahweh의 초상들',
    evidence_text: 'CHAPTER 7 - Postscript: Portraits of Yahweh',
  });
  const author = structuralReasonForCandidate({
    title: 'David Noel Freedman',
    summary: 'DAVID NOEL FREEDMAN',
    evidence_text: 'ASTRID B. BECK\nDAVID NOEL FREEDMAN',
  });
  const citation = structuralReasonForCandidate({
    title: 'Hebrew Bible and Canaanite Literature,',
    summary: 'Greenfield, “Hebrew Bible and Canaanite Literature,” 545-60; Hallo,',
    evidence_text: 'Greenfield, “Hebrew Bible and Canaanite Literature,” 545-60; Hallo,',
  });
  const shortQuote = structuralReasonForCandidate({
    title: 'other deities',
    type: 'quotation',
    summary: 'the other deities',
    evidence_text: '"other deities"',
  });
  const longQuoteOnly = {
    ...mkCandidate({
      local_candidate_id: 'quote-only',
      title: 'Israelite cultural identity',
      type: 'quotation',
      summary: 'The material culture of the region exhibits numerous common points between the Israelites and Canaanites.',
      evidence_text:
        'The material culture of the region exhibits numerous common points between the Israelites and Canaanites in the Iron I period.',
    }),
  };
  const longQuote = structuralReasonForCandidate(longQuoteOnly);
  const longQuoteScored = scoreCandidate(longQuoteOnly, [mkChunk()], new Set(), []);
  const scholarClaim = structuralReasonForCandidate({
    title: 'David Noel Freedman',
    summary: 'Freedman argues that Israelite religion must be read against its ancient Near Eastern context.',
    evidence_text: 'Freedman argues that Israelite religion must be read against its ancient Near Eastern context.',
  });
  const typedScholarName = structuralReasonForCandidate({
    title: 'David Noel Freedman',
    type: 'scholar',
    summary: 'DAVID NOEL FREEDMAN',
    evidence_text: 'ASTRID B. BECK\nDAVID NOEL FREEDMAN',
  });
  const mistypedScholarName = structuralReasonForCandidate({
    title: 'David Noel Freedman',
    type: 'concept',
    summary: 'DAVID NOEL FREEDMAN',
    evidence_text: 'ASTRID B. BECK\nDAVID NOEL FREEDMAN',
  });
  const commaScholarName = structuralReasonForCandidate({
    title: 'Levenson, J.',
    type: 'concept',
    summary: 'Levenson, J.',
    evidence_text: 'Levenson, J.',
  });
  const particleScholarName = structuralReasonForCandidate({
    title: 'von Rad',
    type: 'concept',
    summary: 'von Rad',
    evidence_text: 'von Rad',
  });
  const shortAcademicConcepts = [
    'Divine Kingship',
    'Covenant Theology',
    'Wisdom Literature',
    'Source Criticism',
    'Holy Spirit',
    'Mount Sinai',
  ].map((title) =>
    structuralReasonForCandidate({
      title,
      type: 'concept',
      summary: `${title} is a reusable academic concept in the source argument.`,
      evidence_text: `${title} is a reusable academic concept in the source argument.`,
    }),
  );
  const report = {
    scenario: 'structural-filter',
    chapter_rejected: !!chapter,
    author_rejected: !!author,
    citation_rejected: !!citation,
    short_quote_rejected: !!shortQuote,
    long_quote_rejected: !!longQuote,
    long_quote_action: longQuoteScored.recommended_action,
    scholar_claim_kept: scholarClaim === null,
    typed_scholar_name_rejected: !!typedScholarName,
    mistyped_scholar_name_rejected: !!mistypedScholarName,
    comma_scholar_name_rejected: !!commaScholarName,
    particle_scholar_name_rejected: !!particleScholarName,
    short_academic_concepts_kept: shortAcademicConcepts.every((r) => r === null),
    reasons_korean: [chapter, author, citation, shortQuote, longQuote].every((r) => typeof r === 'string' && /[가-힣]/.test(r)),
  };
  if (!report.chapter_rejected) return fail(report, 'chapter heading was not rejected as structure-only');
  if (!report.author_rejected) return fail(report, 'standalone author name was not rejected as structure-only');
  if (!report.citation_rejected) return fail(report, 'bibliographic citation fragment was not rejected as structure-only');
  if (!report.short_quote_rejected) return fail(report, 'short quotation shard was not rejected as structure-only');
  if (!report.long_quote_rejected) return fail(report, 'long quote-only card was not rejected as evidence-only');
  if (report.long_quote_action !== 'ignore') return fail(report, 'long quote-only card was not classified ignore');
  if (!report.scholar_claim_kept) return fail(report, 'scholar claim with assertion verb was wrongly rejected');
  if (!report.typed_scholar_name_rejected) return fail(report, 'typed standalone scholar name was not rejected');
  if (!report.mistyped_scholar_name_rejected) return fail(report, 'standalone scholar name mislabeled as concept was not rejected');
  if (!report.comma_scholar_name_rejected) return fail(report, 'comma-style standalone scholar name was not rejected');
  if (!report.particle_scholar_name_rejected) return fail(report, 'particle-style standalone scholar name was not rejected');
  if (!report.short_academic_concepts_kept) return fail(report, 'short academic concepts were wrongly rejected as person names');
  if (!report.reasons_korean) return fail(report, 'structural rejection reasons are not Korean');
  pass(report);
}

async function classifyNovelty() {
  const { scoreCandidate } = await import('../src/lib/candidate/scoringEngine.ts');
  const cand = mkCandidate({ local_candidate_id: 'novel', title: 'A wholly new method of socio-rhetorical analysis', evidence_text: 'The author proposes a new socio-rhetorical analysis method.' });
  const scored = scoreCandidate(cand, [mkChunk()], new Set(['socio-rhetorical']), []);
  const report = {
    scenario: 'classify-novelty',
    action: scored.recommended_action,
    target: scored.target_entry_id,
  };
  if (scored.recommended_action !== 'create_new') return fail(report, `expected create_new with empty wiki, got ${scored.recommended_action}`);
  if (scored.target_entry_id !== null) return fail(report, 'create_new must have null target');
  pass(report);
}

async function dedupUpdateLink() {
  const { scoreCandidate } = await import('../src/lib/candidate/scoringEngine.ts');
  const existing = [mkEntry()];
  // Strong duplicate (same title/terms) → update_existing.
  const dup = mkCandidate({ local_candidate_id: 'dup', title: 'Figural interpretation', summary: 'figural interpretation typology retrospective recognition', evidence_text: 'Hays defines figural interpretation as retrospective recognition.' });
  const dupScored = scoreCandidate(dup, [mkChunk()], new Set(), existing);
  // Loosely related → link_only.
  const related = mkCandidate({ local_candidate_id: 'rel', title: 'Typology criteria in narrative', summary: 'typology and narrative type-scene', evidence_text: 'Goppelt distinguishes typology by correspondence.' });
  const relScored = scoreCandidate(related, [mkChunk()], new Set(), existing);
  const report = {
    scenario: 'dedup-update-link',
    dup_action: dupScored.recommended_action,
    dup_target: dupScored.target_entry_title,
    related_action: relScored.recommended_action,
    related_target: relScored.target_entry_title,
  };
  if (dupScored.recommended_action !== 'update_existing') return fail(report, `duplicate should be update_existing, got ${dupScored.recommended_action}`);
  if (dupScored.target_entry_id !== 'e-fig') return fail(report, 'duplicate did not target the existing entry');
  if (relScored.recommended_action !== 'link_only') return fail(report, `related should be link_only, got ${relScored.recommended_action}`);
  pass(report);
}

async function schemaInput() {
  const { scoreCandidate } = await import('../src/lib/candidate/scoringEngine.ts');
  const cand = mkCandidate({ local_candidate_id: 'sf', title: 'Intertextuality and allusion', summary: 'intertextuality allusion in Mark', evidence_text: 'Combs argues for inverted allusion and intertextuality.' });
  const withKw = scoreCandidate(cand, [mkChunk()], new Set(['intertextuality', 'allusion']), []);
  const noKw = scoreCandidate(cand, [mkChunk()], new Set(), []);
  const report = {
    scenario: 'schema-input',
    schema_fit_with_keywords: withKw.sub.schema_fit,
    schema_fit_without: noKw.sub.schema_fit,
    matched_keywords: withKw.rationale.matched_keywords,
    keyword_in_rationale: withKw.rationale.why.some((w) => w.includes('목차/주제어')),
  };
  if (!(withKw.sub.schema_fit > noKw.sub.schema_fit)) return fail(report, 'outline keywords did not raise schema-fit');
  if (withKw.rationale.matched_keywords.length === 0) return fail(report, 'no matched keywords surfaced');
  if (!report.keyword_in_rationale) return fail(report, 'schema-fit not reflected in human rationale');
  pass(report);
}

async function promotionSignals() {
  const { scoreCandidate } = await import('../src/lib/candidate/scoringEngine.ts');
  const cand = mkCandidate({
    local_candidate_id: 'promo',
    title: 'Leitwort guardrail for thorn motif',
    type: 'method',
    summary: 'Lexical contact with ἀκάνθας is useful but does not prove typology by itself.',
    evidence_text:
      'Greek lexical contact with ἀκάνθας and ῥάμνος can identify comparison points, but it cannot establish evangelist intention by itself; stronger claims require textual criticism.',
    original_terms: ['ἀκάνθας', 'ῥάμνος', 'leitwort', 'textual criticism'],
  });
  const existing = [
    mkEntry({
      id: 'e-gospel',
      title: 'Leitwort thorn motif textual criticism hub',
      summary: 'Hub for motif method and textual guardrails.',
      tags: ['leitwort', 'thorn-motif', 'textual-criticism'],
      original_terms: ['Leitwort', 'textual criticism', 'thorn motif'],
    }),
  ];
  const scored = scoreCandidate(cand, [mkChunk()], new Set(['thorn', 'motif']), existing);
  const report = {
    scenario: 'promotion-signals',
    action: scored.recommended_action,
    target: scored.target_entry_id,
    novelty_score: scored.sub.novelty,
    why_has_terms: scored.rationale.why.some((w) => w.includes('핵심 원어/용어')),
    boundary_has_guardrail: scored.rationale.boundary.some((w) => w.includes('경계 신호')),
    schema_fit_positive: scored.sub.schema_fit > 0,
  };
  if (scored.recommended_action !== 'update_existing') {
    return fail(report, `promotion-like method card should update existing hub, got ${scored.recommended_action}`);
  }
  if (scored.target_entry_id !== 'e-gospel') return fail(report, 'existing hub was not targeted');
  if (!report.why_has_terms) return fail(report, 'original/core terms not surfaced in rationale');
  if (!report.boundary_has_guardrail) return fail(report, 'boundary cue not surfaced in rationale');
  if (!report.schema_fit_positive) return fail(report, 'original terms/topic terms did not contribute to schema fit');
  pass(report);
}

async function cardShape() {
  const { runCandidateEngine, ACTION_LABEL } = await import('../src/lib/candidate/candidateEngine.ts');
  const bundle = {
    source_id: 'src',
    source_kind: 'markdown',
    candidate_items: [mkCandidate({ local_candidate_id: 'x', page: 3 })],
    normalized_text: '...',
  };
  const cards = runCandidateEngine({
    bundle,
    chunks: [mkChunk()],
    outline: { nodes: [{ id: 'n1', title: 'Hermeneutics', label: null, level: 1, children: [], parent: null }], roots: ['n1'] },
    existingEntries: [],
  });
  const card = cards[0];
  const s = JSON.stringify(card.scored);
  const report = {
    scenario: 'card-shape',
    card_count: cards.length,
    has_action: !!card.scored.recommended_action,
    action_label_korean: ACTION_LABEL[card.scored.recommended_action],
    has_why: card.scored.rationale.why.length > 0,
    has_boundary: card.scored.rationale.boundary.length > 0,
    has_locator: card.scored.candidate.evidence_refs.length > 0 || typeof card.scored.candidate.page === 'number',
    decision_default: card.decision,
    // The card *model* still carries the internal score object, but the UI
    // never renders it. We assert the UI-facing fields exist; the score-hidden
    // guarantee is enforced by the component (no {total}/{sub} bindings).
    internal_score_present_for_engine: typeof card.scored.total === 'number',
  };
  if (cards.length !== 1) return fail(report, 'expected exactly one card');
  if (!report.has_action) return fail(report, 'card missing recommended_action');
  if (!report.has_why) return fail(report, 'card missing why rationale');
  if (!report.has_boundary) return fail(report, 'card missing boundary note');
  if (!report.has_locator) return fail(report, 'card missing evidence locator');
  if (report.decision_default !== 'pending') return fail(report, 'card decision did not default to pending');
  pass(report);
}

async function decisionPropagation() {
  const {
    carryCandidateDecisions,
    selectOfflineWikiCardsForSave,
  } = await import('../src/lib/candidate/candidateEngine.ts');

  const mkCard = (id, action = 'create_new', decision = 'pending') => ({
    scored: {
      candidate: mkCandidate({ local_candidate_id: id, title: `Candidate ${id}` }),
      recommended_action: action,
    },
    decision,
  });

  const fresh = [mkCard('approved'), mkCard('held'), mkCard('discarded'), mkCard('pending')];
  const previous = [
    mkCard('approved', 'create_new', 'approved'),
    mkCard('held', 'create_new', 'held'),
    mkCard('discarded', 'create_new', 'discarded'),
  ];
  const carried = carryCandidateDecisions(fresh, previous);
  const selected = selectOfflineWikiCardsForSave([...carried, mkCard('ignored-approved', 'ignore', 'approved')]);
  const selectedIds = selected.map((card) => card.scored.candidate.local_candidate_id);
  const decisionById = Object.fromEntries(
    carried.map((card) => [card.scored.candidate.local_candidate_id, card.decision]),
  );
  const report = {
    scenario: 'decision-propagation',
    decisionById,
    selectedIds,
    held_excluded: !selectedIds.includes('held'),
    discarded_excluded: !selectedIds.includes('discarded'),
    approved_included: selectedIds.includes('approved'),
    pending_legacy_included: selectedIds.includes('pending'),
    ignore_excluded_even_if_approved: !selectedIds.includes('ignored-approved'),
  };
  if (report.decisionById.approved !== 'approved') return fail(report, 'approved decision was not carried');
  if (report.decisionById.held !== 'held') return fail(report, 'held decision was not carried');
  if (report.decisionById.discarded !== 'discarded') return fail(report, 'discarded decision was not carried');
  if (!report.held_excluded) return fail(report, 'held candidate selected for offline wiki save');
  if (!report.discarded_excluded) return fail(report, 'discarded candidate selected for offline wiki save');
  if (!report.approved_included) return fail(report, 'approved candidate was not selected');
  if (!report.pending_legacy_included) return fail(report, 'pending non-ignore candidate no longer preserves one-click flow');
  if (!report.ignore_excluded_even_if_approved) return fail(report, 'ignore candidate selected for offline wiki save');
  pass(report);
}

async function offlineNoNetwork() {
  // Static guard: the rule-engine modules must not import network/LLM symbols.
  const files = [
    'src/lib/candidate/scoringEngine.ts',
    'src/lib/candidate/candidateEngine.ts',
    'src/lib/candidate/claimVerbs.ts',
    'src/lib/candidate/demotePatterns.ts',
    'src/lib/candidate/structuralFilter.ts',
    'src/lib/candidate/keywordMatch.ts',
  ];
  const forbidden = ['fetch(', 'XMLHttpRequest', 'llmClient', 'llm_cmd', 'WebSocket', 'http://', 'https://', 'invoke('];
  const violations = [];
  for (const rel of files) {
    const text = readFileSync(resolve(ROOT, rel), 'utf8');
    for (const f of forbidden) {
      if (text.includes(f)) violations.push({ file: rel, token: f });
    }
  }
  const report = { scenario: 'offline-no-network', files_scanned: files.length, violations };
  if (violations.length > 0) return fail(report, `network/LLM token found in offline engine: ${JSON.stringify(violations)}`);
  pass(report);
}

const scenario = process.argv[2];
const table = {
  'rule-determinism': ruleDeterminism,
  'claim-verbs': claimVerbs,
  'demote-patterns': demotePatterns,
  'structural-filter': structuralFilter,
  'classify-novelty': classifyNovelty,
  'dedup-update-link': dedupUpdateLink,
  'schema-input': schemaInput,
  'promotion-signals': promotionSignals,
  'card-shape': cardShape,
  'decision-propagation': decisionPropagation,
  'offline-no-network': offlineNoNetwork,
};
const fn = table[scenario];
if (!fn) {
  console.error(`[fail] unknown scenario "${scenario}"`);
  console.error(`usage: node --import tsx fixtures/t1-slice5a-smoke.mjs <${Object.keys(table).join('|')}>`);
  process.exit(1);
}
await fn();
