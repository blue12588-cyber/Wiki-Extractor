<!--
  OutlineInput.svelte
  -------------------
  AC-OUTLINE: 사용자가 논문 목차를 텍스트로 붙여넣으면 항목 트리로 파싱하여 표시한다.

  Authority: agreed_contract.json#AC-OUTLINE.

  - 전체 한글 UI (AC-KOREAN-UI).
  - 순수 파싱(오프라인). LLM 비의존.
  - 파싱 결과는 부모로 전달되어 분류·매핑(AC-CLASSIFY-MAP)의 대상 노드가 된다.
-->
<script lang="ts">
  import { parseOutline, type ParsedOutline } from '$lib/outline/outlineParser';

  type Props = {
    value?: string;
    parsed?: ParsedOutline | null;
    onrawchange?: (raw: string) => void;
    onparsed?: (outline: ParsedOutline) => void;
  };
  let { value = '', parsed = null, onrawchange, onparsed }: Props = $props();

  let raw = $state('');
  let outline = $state<ParsedOutline | null>(null);

  $effect(() => {
    raw = value;
  });

  $effect(() => {
    outline = parsed;
  });

  function handle_input(e: Event) {
    raw = (e.currentTarget as HTMLTextAreaElement).value;
    onrawchange?.(raw);
  }

  function handle_parse() {
    const parsed = parseOutline(raw);
    outline = parsed;
    onrawchange?.(raw);
    onparsed?.(parsed);
  }

  function clear() {
    raw = '';
    outline = null;
    onrawchange?.('');
    onparsed?.({ nodes: [], roots: [] });
  }

  let node_count = $derived(outline?.nodes.length ?? 0);
</script>

<section class="outline" aria-label="목차 입력">
  <label class="field-label" for="outline-text">목차 붙여넣기</label>
  <p class="hint">
    논문 목차를 그대로 붙여넣으세요. 번호(1.2), 마크다운 제목(##), 「제1장」, 글머리표(-)를
    인식해 항목 트리로 변환합니다.
  </p>
  <textarea
    id="outline-text"
    class="paste"
    value={raw}
    oninput={handle_input}
    rows="8"
    placeholder={'예)\n1. 서론\n  1.1 연구 배경\n  1.2 연구 목적\n2. 본론\n  2.1 시편의 탄식\n3. 결론'}
  ></textarea>

  <div class="actions">
    <button type="button" class="btn primary" onclick={handle_parse} disabled={raw.trim().length === 0}>
      목차 파싱
    </button>
    <button type="button" class="btn" onclick={clear} disabled={raw.length === 0}>
      비우기
    </button>
    {#if outline}
      <span class="result-count" role="status">{node_count}개 항목 인식됨</span>
    {/if}
  </div>

  {#if outline && node_count > 0}
    <ol class="tree" aria-label="파싱된 목차 트리">
      {#each outline.nodes as node (node.id)}
        <li class="tree-node" style={`margin-left: ${(node.level - 1) * 16}px`}>
          {#if node.label}<span class="node-label">{node.label}</span>{/if}
          <span class="node-title">{node.title}</span>
          <span class="node-id" title="분류 매핑에 사용되는 항목 id">{node.id}</span>
        </li>
      {/each}
    </ol>
  {:else if outline}
    <p class="empty">인식된 항목이 없습니다. 줄마다 한 항목씩 입력했는지 확인하세요.</p>
  {/if}
</section>

<style>
  .outline {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .field-label {
    font-family: var(--heading-family);
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .hint {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .paste {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--body-family);
    font-size: 0.9375rem;
    line-height: 1.6;
    padding: var(--space-md);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-asymmetric);
    background: var(--surface-elevated);
    color: var(--text-primary);
    resize: vertical;
  }

  .paste:focus-visible {
    outline: 2px solid var(--accent-oxblood);
    outline-offset: 1px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-wrap: wrap;
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

  .btn:hover:not(:disabled) {
    border-color: var(--accent-oxblood);
  }

  .btn.primary {
    background: var(--accent-oxblood);
    color: var(--surface-elevated);
    border-color: var(--accent-oxblood);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .result-count {
    font-size: 0.8125rem;
    color: var(--success-moss);
    font-weight: 600;
  }

  .tree {
    list-style: none;
    margin: var(--space-sm) 0 0 0;
    padding: var(--space-md);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-asymmetric);
    background: var(--surface-sunken);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tree-node {
    display: flex;
    align-items: baseline;
    gap: var(--space-xs);
    font-size: 0.875rem;
  }

  .node-label {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    color: var(--accent-oxblood);
    font-size: 0.8125rem;
  }

  .node-title {
    color: var(--text-primary);
  }

  .node-id {
    margin-left: auto;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.6875rem;
    color: var(--text-secondary);
    opacity: 0.7;
  }

  .empty {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }
</style>
