<!--
  CandidateCard.svelte
  --------------------
  AC-CARD-UI: render ONE rule-engine candidate as a card. The internal score is
  NEVER shown (Codex UX guidance) — the card surfaces only the *decision*
  surface a non-expert needs:

    추천 작업 : 생성 / 보강 / 링크 / 무시
    대상      : <기존 항목명>  (only for 보강 / 링크)
    왜 후보인가 : <근거 요약>
    근거      : <chunk_id + page>
    주의      : <경계 — 이 자료로 말하면 안 되는 것>
    [승인] [보류] [폐기] [ChatGPT 브릿지 열기]   ← last opens the 5b bridge

  Reflects the harness-core wiki structure (Claim / Evidence / Synthesis /
  Boundaries / Links): 왜=Claim+Synthesis, 근거=Evidence, 주의=Boundaries.

  Authority: agreed_contract.json#AC-CARD-UI + AC-KOREAN-UI.

  Design: action is signalled by SHAPE-bearing glyph + Korean label + a left
  rail accent (color is the third, redundant signal — color-blind safe). Tokens
  only; asymmetric-radius house style. Pure/presentational: emits decision
  events upward, performs no I/O, no network, no LLM.
-->
<script lang="ts">
  import type { ScoredCandidate, RecommendedAction } from '$lib/candidate/scoringEngine';
  import type { CandidateDecision } from '$lib/candidate/candidateEngine';
  import { ACTION_LABEL, DECISION_LABEL } from '$lib/candidate/candidateEngine';

  type Props = {
    scored: ScoredCandidate;
    decision: CandidateDecision;
    ondecision?: (next: CandidateDecision) => void;
    /** Opens the 5b ChatGPT copy-paste bridge. */
    oncopyprompt?: () => void;
  };

  let { scored, decision, ondecision, oncopyprompt }: Props = $props();

  // Shape glyph per action — disambiguates without relying on hue.
  const ACTION_GLYPH: Record<RecommendedAction, string> = {
    create_new: '＋',
    update_existing: '↑',
    link_only: '⛓',
    ignore: '∅',
  };

  let cand = $derived(scored.candidate);
  let action = $derived(scored.recommended_action);
  let why = $derived(scored.rationale.why);
  let boundary = $derived(scored.rationale.boundary);
  let demotion = $derived(scored.rationale.demotion);
  let originalTerms = $derived(cand.original_terms ?? []);

  // Evidence locator string: chunk/page refs (verbatim from the candidate).
  let locator = $derived.by(() => {
    const refs = [...cand.evidence_refs];
    if (typeof cand.page === 'number') refs.unshift(`페이지 ${cand.page}`);
    return refs;
  });

  function formatLocator(ref: string): string {
    if (/^페이지 \d+$/.test(ref)) return ref;
    const pageLine = ref.match(/#page-(\d+)-line-(\d+)/);
    if (pageLine) return `페이지 ${pageLine[1]} · 줄 ${pageLine[2]}`;
    const line = ref.match(/#line-(\d+)/);
    if (line) return `줄 ${line[1]}`;
    const chunkPage = ref.match(/#p(\d+)$/);
    if (chunkPage) return `페이지 ${chunkPage[1]}`;
    return ref;
  }

  function set(next: CandidateDecision) {
    ondecision?.(next);
  }
</script>

<li class="card" data-action={action} aria-label={`후보: ${cand.title}`}>
  <div class="card-head">
    <span class="action-chip chip-{action}">
      <span class="glyph" aria-hidden="true">{ACTION_GLYPH[action]}</span>
      추천 작업: {ACTION_LABEL[action]}
    </span>
    {#if decision !== 'pending'}
      <span class="decision-tag" data-decision={decision}>{DECISION_LABEL[decision]}</span>
    {/if}
  </div>

  <h3 class="title">{cand.title}</h3>

  {#if (action === 'update_existing' || action === 'link_only') && scored.target_entry_title}
    <p class="row target">
      <span class="row-key">대상</span>
      <span class="row-val">{scored.target_entry_title}</span>
    </p>
  {/if}

  {#if why.length}
    <div class="row">
      <span class="row-key">왜 후보인가</span>
      <ul class="why-list">
        {#each why as w (w)}
          <li>{w}</li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if originalTerms.length}
    <div class="row">
      <span class="row-key">핵심 용어</span>
      <p class="terms">
        {#each originalTerms as term (term)}
          <span class="term">{term}</span>
        {/each}
      </p>
    </div>
  {/if}

  <div class="row">
    <span class="row-key">근거</span>
    <p class="locators">
      {#each locator as ref (ref)}
        <span class="loc" class:page={ref.startsWith('페이지 ')} title={ref}>{formatLocator(ref)}</span>
      {/each}
      {#if locator.length === 0}
        <span class="loc muted">근거 위치 없음</span>
      {/if}
    </p>
  </div>

  {#if boundary.length}
    <div class="row caution">
      <span class="row-key">주의</span>
      <ul class="caution-list">
        {#each boundary as b (b)}
          <li>{b}</li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if demotion.length}
    <div class="row caution demote">
      <span class="row-key">감점</span>
      <ul class="caution-list">
        {#each demotion as d (d)}
          <li>{d}</li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="actions">
    <button
      type="button"
      class="btn approve"
      aria-pressed={decision === 'approved'}
      onclick={() => set('approved')}
    >승인</button>
    <button
      type="button"
      class="btn hold"
      aria-pressed={decision === 'held'}
      onclick={() => set('held')}
    >보류</button>
    <button
      type="button"
      class="btn discard"
      aria-pressed={decision === 'discarded'}
      onclick={() => set('discarded')}
    >폐기</button>
    <button
      type="button"
      class="btn copy"
      title="이 후보의 ChatGPT 복붙 브릿지를 엽니다(프롬프트 복사와 응답 검증은 브릿지 안에서 합니다)"
      onclick={() => oncopyprompt?.()}
    >ChatGPT 브릿지 열기</button>
  </div>
</li>

<style>
  .card {
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--border-subtle);
    border-radius: var(--radius-asymmetric);
    background: var(--surface-elevated);
    padding: var(--space-md) var(--space-lg);
    box-shadow: var(--shadow-hairline);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  /* Left-rail accent per action (redundant color signal). */
  .card[data-action='create_new'] { border-left-color: var(--accent-oxblood); }
  .card[data-action='update_existing'] { border-left-color: var(--warn-amber); }
  .card[data-action='link_only'] { border-left-color: var(--success-moss); }
  .card[data-action='ignore'] { border-left-color: var(--border-subtle); opacity: 0.72; }

  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }

  .action-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    font-family: var(--heading-family);
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 2px var(--space-sm);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-pill);
    color: var(--text-secondary);
    background: var(--surface-sunken);
  }
  .glyph { line-height: 1; }
  .chip-create_new { color: var(--accent-oxblood); border-color: var(--accent-oxblood); }
  .chip-update_existing { color: var(--warn-amber); border-color: var(--warn-amber); }
  .chip-link_only { color: var(--success-moss); border-color: var(--success-moss); }

  .decision-tag {
    font-family: var(--heading-family);
    font-size: 0.6875rem;
    font-weight: 600;
    padding: 1px var(--space-sm);
    border-radius: var(--radius-pill);
    border: 1px solid var(--border-subtle);
    color: var(--text-secondary);
  }
  .decision-tag[data-decision='approved'] { color: var(--success-moss); border-color: var(--success-moss); }
  .decision-tag[data-decision='held'] { color: var(--warn-amber); border-color: var(--warn-amber); }
  .decision-tag[data-decision='discarded'] { color: var(--danger-rust); border-color: var(--danger-rust); }

  .title {
    margin: 0;
    font-family: var(--body-family);
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.3;
  }

  .row {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row.target { flex-direction: row; align-items: baseline; gap: var(--space-sm); }

  .row-key {
    font-family: var(--heading-family);
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: none;
    letter-spacing: 0.02em;
    color: var(--text-secondary);
  }
  .row-val { font-size: 0.9375rem; color: var(--text-primary); font-weight: 600; }

  .why-list,
  .caution-list {
    margin: 0;
    padding-left: 1.1em;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.5;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .locators {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
  }
  .loc {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.6875rem;
    padding: 0 var(--space-xs);
    border-radius: var(--radius-tight);
    background: var(--surface-sunken);
    color: var(--text-secondary);
  }
  .loc.page {
    font-family: var(--heading-family);
    font-weight: 600;
    color: var(--accent-oxblood);
    background: var(--surface-elevated);
    border: 1px solid var(--border-subtle);
  }
  .loc.muted { opacity: 0.7; }

  .terms {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
  }

  .term {
    font-size: 0.75rem;
    padding: 1px var(--space-sm);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-pill);
    background: var(--surface-sunken);
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }

  .row.caution .row-key { color: var(--danger-rust); }
  .row.caution {
    border-left: 2px solid var(--danger-rust);
    padding-left: var(--space-sm);
    background: var(--surface-sunken);
    border-radius: var(--radius-tight);
  }
  .row.caution.demote .row-key { color: var(--warn-amber); }
  .row.caution.demote { border-left-color: var(--warn-amber); }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-sm);
    margin-top: var(--space-xs);
  }

  .btn {
    font-family: var(--heading-family);
    font-size: 0.8125rem;
    font-weight: 600;
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-pill);
    background: var(--surface-elevated);
    color: var(--text-primary);
    cursor: pointer;
    transition: border-color var(--motion-fast) var(--ease-deliberate);
  }
  .btn:hover:not(:disabled) { border-color: var(--text-secondary); }
  .btn[aria-pressed='true'].approve { background: var(--success-moss); color: var(--surface-elevated); border-color: var(--success-moss); }
  .btn[aria-pressed='true'].hold { background: var(--warn-amber); color: var(--surface-elevated); border-color: var(--warn-amber); }
  .btn[aria-pressed='true'].discard { background: var(--danger-rust); color: var(--surface-elevated); border-color: var(--danger-rust); }
  .btn.copy { color: var(--text-secondary); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
