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
  import type { ParsedOutline, OutlineNode } from '$lib/outline/outlineParser';
  import type { SourceSummary } from '$lib/pipeline/store.svelte';
  import { overlapTerms, tokenSimilarity, tokenize } from '$lib/candidate/keywordMatch';
  import type { Snippet } from 'svelte';

  type ViewMode = 'outline' | 'source';

  type Props = {
    cards: CandidateCardModel[];
    outline?: ParsedOutline | null;
    sources?: SourceSummary[];
    busy?: boolean;
    activeCandidateKey?: string | null;
    showBatchBridge?: boolean;
    batchBridge?: Snippet;
    inlineBridge?: Snippet;
    ondecision?: (sourceId: string, candidateId: string, next: CandidateDecision) => void;
    /** Slice 5b — open the ChatGPT copy-paste bridge for one candidate. */
    oncopyprompt?: (sourceId: string, candidateId: string) => void;
    oncopybatch?: () => void;
  };

  let {
    cards,
    outline = null,
    sources = [],
    busy = false,
    activeCandidateKey = null,
    showBatchBridge = false,
    batchBridge,
    inlineBridge,
    ondecision,
    oncopyprompt,
    oncopybatch,
  }: Props = $props();

  const ACTION_ORDER: RecommendedAction[] = ['create_new', 'update_existing', 'link_only', 'ignore'];
  let viewMode = $state<ViewMode>('outline');
  let inlineBridgeEl = $state<HTMLElement | null>(null);
  let lastActiveCandidateKey = $state<string | null>(null);

  function modelKey(model: CandidateCardModel): string {
    const cand = model.scored.candidate;
    return `${cand.source_id}\u0000${cand.local_candidate_id}`;
  }

  $effect(() => {
    const key = activeCandidateKey;
    if (!key) {
      lastActiveCandidateKey = null;
      return;
    }
    if (lastActiveCandidateKey === key) return;
    lastActiveCandidateKey = key;
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => inlineBridgeEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }
  });

  function outlineLabel(node: OutlineNode): string {
    return node.label ? `${node.label} ${node.title}` : node.title;
  }

  function outlineScore(model: CandidateCardModel, node: OutlineNode): number {
    const cand = model.scored.candidate;
    const query = [
      cand.title,
      cand.summary,
      cand.evidence_text,
      ...(cand.original_terms ?? []),
      ...model.scored.rationale.matched_keywords,
    ].join('\n');
    const label = outlineLabel(node);
    const keywordScore = overlapTerms(tokenize(label), query).length > 0 ? 0.24 : 0;
    return Math.max(tokenSimilarity(query, label), keywordScore);
  }

  function bestOutlineId(model: CandidateCardModel): string | null {
    const nodes = outline?.nodes ?? [];
    let best: { id: string; score: number } | null = null;
    for (const node of nodes) {
      const score = outlineScore(model, node);
      if (!best || score > best.score) best = { id: node.id, score };
    }
    return best && best.score >= 0.18 ? best.id : null;
  }

  function sourceLabel(sourceId: string): string {
    const source = sources.find((item) => item.source_id === sourceId);
    return source?.bibliography?.display_title || source?.filename || `원문 ${sourceId}`;
  }

  function sourcePageRange(groupCards: CandidateCardModel[]): string {
    const pages = groupCards
      .map((model) => model.scored.candidate.page)
      .filter((page): page is number => typeof page === 'number' && Number.isFinite(page));
    if (pages.length === 0) return '';
    const min = Math.min(...pages);
    const max = Math.max(...pages);
    return min === max ? `p.${min}` : `p.${min}-${max}`;
  }

  let groupedCards = $derived.by(() => {
    if (viewMode === 'source') {
      const sourceOrder = new Map(sources.map((source, index) => [source.source_id, index]));
      const map = new Map<string, CandidateCardModel[]>();
      for (const model of cards) {
        const sourceId = model.scored.candidate.source_id;
        const group = map.get(sourceId) ?? [];
        group.push(model);
        map.set(sourceId, group);
      }
      return [...map.entries()]
        .sort((a, b) => (sourceOrder.get(a[0]) ?? 9999) - (sourceOrder.get(b[0]) ?? 9999))
        .map(([sourceId, groupCards], index) => ({
          id: `source:${sourceId}`,
          title: sourceLabel(sourceId),
          meta: `${groupCards.length}개 후보 · ${sourcePageRange(groupCards) || '쪽수 미확인'} · 문헌 안 원문 순서`,
          cards: groupCards.slice().sort((a, b) => {
            const ap = a.scored.candidate.page ?? Number.MAX_SAFE_INTEGER;
            const bp = b.scored.candidate.page ?? Number.MAX_SAFE_INTEGER;
            return ap - bp || a.scored.candidate.span.start - b.scored.candidate.span.start;
          }),
          open: index === 0 || groupCards.some((model) => modelKey(model) === activeCandidateKey),
        }));
    }

    const nodes = outline?.nodes ?? [];
    if (nodes.length === 0) {
      return [{
        id: 'outline:none',
        title: '목차 미분류',
        meta: `${cards.length}개 후보 · 논문 목차를 넣으면 작성 순서대로 묶입니다`,
        cards,
        open: true,
      }];
    }

    const byOutline = new Map<string, CandidateCardModel[]>();
    const unmapped: CandidateCardModel[] = [];
    for (const model of cards) {
      const id = bestOutlineId(model);
      if (!id) {
        unmapped.push(model);
        continue;
      }
      const group = byOutline.get(id) ?? [];
      group.push(model);
      byOutline.set(id, group);
    }

    const groups = nodes
      .map((node, index) => ({
        id: `outline:${node.id}`,
        title: outlineLabel(node),
        meta: `${byOutline.get(node.id)?.length ?? 0}개 후보 · 논문 작성 순서`,
        cards: byOutline.get(node.id) ?? [],
        open: index === 0 || (byOutline.get(node.id) ?? []).some((model) => modelKey(model) === activeCandidateKey),
      }))
      .filter((group) => group.cards.length > 0);

    if (unmapped.length > 0) {
      groups.push({
        id: 'outline:unmapped',
        title: '목차 미분류',
        meta: `${unmapped.length}개 후보 · 수동 검토 필요`,
        cards: unmapped,
        open: groups.length === 0 || unmapped.some((model) => modelKey(model) === activeCandidateKey),
      });
    }
    return groups;
  });

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

  let batchable_count = $derived(cards.filter((c) =>
    c.scored.recommended_action !== 'ignore' &&
    c.decision !== 'held' &&
    c.decision !== 'discarded',
  ).length);
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
      <div class="view-switch" aria-label="후보 보기 방식">
        <button
          type="button"
          class:active={viewMode === 'outline'}
          onclick={() => (viewMode = 'outline')}
        >
          목차별
        </button>
        <button
          type="button"
          class:active={viewMode === 'source'}
          onclick={() => (viewMode = 'source')}
        >
          문헌별
        </button>
      </div>
      <button
        type="button"
        class="btn batch"
        onclick={() => oncopybatch?.()}
        disabled={batchable_count === 0}
        title="상위 후보를 하나의 ChatGPT 프롬프트로 묶습니다"
      >
        상위 후보 일괄 ChatGPT 브릿지
      </button>
    </header>

    {#if showBatchBridge && batchBridge}
      <div class="batch-bridge">
        {@render batchBridge()}
      </div>
    {/if}

    <div class="group-stack">
      {#each groupedCards as group (group.id)}
        <details class="card-group" open={group.open}>
          <summary>
            <span class="group-title">{group.title}</span>
            <span class="group-meta">{group.meta}</span>
          </summary>
          <ol class="cards">
            {#each group.cards as model (`${model.scored.candidate.source_id}:${model.scored.candidate.local_candidate_id}`)}
              {@const key = modelKey(model)}
              <CandidateCard
                scored={model.scored}
                decision={model.decision}
                activeBridge={activeCandidateKey === key}
                ondecision={(next) => ondecision?.(
                  model.scored.candidate.source_id,
                  model.scored.candidate.local_candidate_id,
                  next,
                )}
                oncopyprompt={() => oncopyprompt?.(
                  model.scored.candidate.source_id,
                  model.scored.candidate.local_candidate_id,
                )}
              />
              {#if activeCandidateKey === key && inlineBridge}
                <li class="inline-bridge" bind:this={inlineBridgeEl} aria-label="선택 후보 ChatGPT 상호작용 패널">
                  {@render inlineBridge()}
                </li>
              {/if}
            {/each}
          </ol>
        </details>
      {/each}
    </div>
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
  .view-switch {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-pill);
    background: var(--surface-sunken);
  }
  .view-switch button {
    border: 0;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font-family: var(--heading-family);
    font-size: 0.75rem;
    font-weight: 700;
    padding: 3px var(--space-sm);
  }
  .view-switch button.active {
    background: var(--surface-elevated);
    color: var(--text-primary);
    box-shadow: var(--shadow-hairline);
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
  }
  .btn:hover:not(:disabled) { border-color: var(--text-secondary); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .batch {
    margin-left: auto;
    white-space: normal;
  }
  .batch-bridge {
    margin-bottom: var(--space-md);
  }

  .group-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
  }
  .card-group {
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-tight);
    background: var(--surface-sunken);
  }
  .card-group summary {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-md);
    cursor: pointer;
    padding: var(--space-sm) var(--space-md);
  }
  .group-title {
    min-width: 0;
    color: var(--text-primary);
    font-family: var(--heading-family);
    font-size: 0.9375rem;
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .group-meta {
    flex: 0 0 auto;
    color: var(--text-secondary);
    font-size: 0.75rem;
  }
  .cards {
    list-style: none;
    margin: 0;
    padding: 0 var(--space-md) var(--space-md);
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
    gap: var(--space-md);
  }
  @media (min-width: 82rem) {
    .cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }
  .inline-bridge {
    grid-column: 1 / -1;
    min-width: 0;
    scroll-margin-top: var(--space-xl);
  }
</style>
