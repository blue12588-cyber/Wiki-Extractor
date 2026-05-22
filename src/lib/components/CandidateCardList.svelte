<!--
  CandidateCardList.svelte
  ------------------------
  AC-CARD-UI: render the rule-engine candidate cards as a list. Shows an action
  TALLY (생성/보강/링크/무시 counts) — never a score. Empty + idle states are
  Korean.

  Authority: agreed_contract.json#AC-CARD-UI + AC-KOREAN-UI + AC-CLASSIFY.

  Presentational: it renders the card models it is handed and bubbles each
  per-card decision up via ondecision. No I/O, no network, no LLM.
-->
<script lang="ts">
  import CandidateCard from './CandidateCard.svelte';
  import type { CandidateCardModel, CandidateDecision } from '$lib/candidate/candidateEngine';
  import { ACTION_LABEL } from '$lib/candidate/candidateEngine';
  import type { RecommendedAction } from '$lib/candidate/scoringEngine';

  type Props = {
    cards: CandidateCardModel[];
    busy?: boolean;
    ondecision?: (candidateId: string, next: CandidateDecision) => void;
    /** Slice 5b — open the ChatGPT copy-paste bridge for one candidate. */
    oncopyprompt?: (candidateId: string) => void;
  };

  let { cards, busy = false, ondecision, oncopyprompt }: Props = $props();

  const ACTION_ORDER: RecommendedAction[] = ['create_new', 'update_existing', 'link_only', 'ignore'];

  let tally = $derived.by(() => {
    const counts = new Map<RecommendedAction, number>();
    for (const c of cards) {
      const a = c.scored.recommended_action;
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    return ACTION_ORDER
      .map((a) => ({ action: a, count: counts.get(a) ?? 0 }))
      .filter((t) => t.count > 0);
  });
</script>

<section class="card-list" aria-label="규칙 기반 추출 후보" aria-busy={busy}>
  {#if busy}
    <div class="busy-hairline" aria-hidden="true"></div>
  {/if}

  {#if cards.length === 0}
    <div class="empty" role="status">
      <p class="empty-title">아직 후보가 없습니다</p>
      <p class="empty-hint">
        위에서 원문을 올리고 “규칙 기반 후보 추출”을 누르면, LLM 없이 오프라인 규칙으로
        위키 후보를 찾아 카드로 보여 드립니다(점수는 표시하지 않습니다).
      </p>
    </div>
  {:else}
    <header class="list-head">
      <p class="count">{cards.length}개 후보</p>
      <p class="tally">
        {#each tally as t (t.action)}
          <span class="tally-item">{ACTION_LABEL[t.action]} {t.count}</span>
        {/each}
      </p>
    </header>

    <ol class="cards">
      {#each cards as model (model.scored.candidate.local_candidate_id)}
        <CandidateCard
          scored={model.scored}
          decision={model.decision}
          ondecision={(next) => ondecision?.(model.scored.candidate.local_candidate_id, next)}
          oncopyprompt={() => oncopyprompt?.(model.scored.candidate.local_candidate_id)}
        />
      {/each}
    </ol>
  {/if}
</section>

<style>
  .card-list { position: relative; margin-top: var(--space-md); }

  .busy-hairline {
    position: absolute;
    left: 0; right: 0; top: 0;
    height: 1px;
    background: var(--accent-oxblood);
    animation: cards-busy var(--motion-slow) var(--ease-deliberate) infinite;
  }
  @keyframes cards-busy {
    0% { opacity: 0.3; transform: scaleX(0.2); transform-origin: left; }
    50% { opacity: 1; transform: scaleX(1); }
    100% { opacity: 0.3; transform: scaleX(0.2); transform-origin: right; }
  }

  .empty {
    border: 1px dashed var(--border-subtle);
    border-radius: var(--radius-asymmetric);
    padding: var(--space-xl);
    background: var(--surface-sunken);
  }
  .empty-title {
    margin: 0 0 var(--space-sm) 0;
    font-family: var(--heading-family);
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .empty-hint { margin: 0; font-size: 0.875rem; color: var(--text-secondary); line-height: 1.5; }

  .list-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-md);
    flex-wrap: wrap;
    margin-bottom: var(--space-md);
    padding-bottom: var(--space-sm);
    border-bottom: 1px solid var(--border-subtle);
  }
  .count { margin: 0; font-weight: 600; color: var(--text-primary); }
  .tally { margin: 0; display: flex; flex-wrap: wrap; gap: var(--space-sm); font-size: 0.8125rem; color: var(--text-secondary); }
  .tally-item {
    padding: 1px var(--space-sm);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-pill);
  }

  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }
</style>
