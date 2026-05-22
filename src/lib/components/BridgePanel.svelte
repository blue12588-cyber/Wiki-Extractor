<!--
  BridgePanel.svelte — ChatGPT 브릿지 (복붙 5b + 자동 LLM 5c)
  -----------------------------------------------------------
  AC-COPY + AC-PASTE-PARSE + AC-VALIDATE + AC-EVIDENCE-BIND + AC-IMPORT +
  AC-KOREAN-UI + AC-OFFLINE-CORE  (5b 복붙, 무손상)
  AC-AUTO-EXTRACT + AC-EVIDENCE-REUSE + AC-GRACEFUL  (5c 자동)

  하나의 후보에 대해 두 가지 경로를 안내한다:

  [복붙 모드 — 기본·누구나 (5b, 그대로)]
    1) 생성된 프롬프트를 보여주고 [프롬프트 복사] → 클립보드.
    2) [ChatGPT 열기] → OS 기본 브라우저로 chatgpt.com (앱은 네트워크 호출 0).
    3) ChatGPT JSON 응답을 textarea에 붙여넣고 [검증].
    4) 통과 후보는 [가져오기]로 위키 후보(=draft 위키 항목)로.

  [자동 LLM 모드 — 고급·codex 인증 (5c, opt-in)]
    autoMode=true 이면 [자동 추출] 버튼이 보인다. 누르면 같은 5b 프롬프트를
    openai-oauth 프록시 경유로 보내 응답을 받아, 동일한 5b 파서·검증기
    (chunk_id 위조 차단 게이트)로 검증한다. 즉 복붙의 수작업만 자동화하고
    신뢰 경계(검증기)는 그대로 재사용한다(AC-EVIDENCE-REUSE).
    실패 시 한글 안내 + 위 복붙 경로로 그대로 진행 가능(AC-GRACEFUL). 앱 안 죽음.

  앱이 ChatGPT를 부르는 유일한 경로는 자동 모드의 openai-oauth 프록시
  (127.0.0.1 루프백)이며, 그것도 provider 추상화 뒤 캡슐화되어 있다. 복붙 모드는
  네트워크 호출 0. 'ChatGPT 열기'는 OS 브라우저 위임일 뿐이다.

  Design: 토큰만 사용, 비대칭 radius 하우스 스타일. 색상에만 의존하지 않도록
  상태마다 라벨 텍스트로 구분(접근성).
-->
<script lang="ts">
  import { buildPrompt, type PromptInput } from '$lib/bridge/promptBuilder';
  import { parseResponse } from '$lib/bridge/responseParser';
  import { validateResponse, type ValidationResult, type ValidatedCandidate } from '$lib/bridge/responseValidator';
  import { autoExtractCandidate } from '$lib/llm/autoExtract';
  import { codexProvider } from '$lib/llm/codexProvider';

  type Props = {
    /** The candidate + chunks + schema this panel drives. */
    input: PromptInput;
    /** Real uploaded chunk_ids — the anti-forgery binding anchor. */
    knownChunkIds: string[];
    /** True when the advanced auto-LLM provider is the effective mode. When
     *  false the panel is the pure 5b copy-paste bridge (无损). */
    autoMode?: boolean;
    /** Bubble up an importable validated candidate. */
    onimport?: (cand: ValidatedCandidate) => void;
    /** Close this panel. */
    onclose?: () => void;
  };

  let { input, knownChunkIds, autoMode = false, onimport, onclose }: Props = $props();

  let prompt = $derived(buildPrompt(input));
  let pasted = $state('');
  let result = $state<ValidationResult | null>(null);
  let copyState = $state<'idle' | 'copied' | 'failed'>('idle');
  let imported = $state<Set<number>>(new Set());

  // 5c 자동 모드 상태
  let autoRunning = $state(false);
  let autoNotice = $state<string | null>(null);

  async function copyPrompt() {
    copyState = 'idle';
    try {
      // Clipboard API (renderer). No network — OS clipboard only.
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(prompt);
        copyState = 'copied';
        return;
      }
      throw new Error('clipboard unavailable');
    } catch {
      copyState = 'failed';
    }
  }

  function openChatGpt() {
    // OS 위임: 기본 브라우저에서 chatgpt.com 을 연다. 앱은 네트워크 호출을 하지 않는다.
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer');
    }
  }

  function runValidate() {
    const parsed = parseResponse(pasted);
    if (!parsed.ok) {
      result = {
        shapeOk: false,
        topLevelError: parsed.message,
        candidates: [],
        importable: [],
      };
      return;
    }
    result = validateResponse(parsed.value, knownChunkIds);
  }

  // 5c 자동 추출: 같은 5b 프롬프트를 codex_oauth_proxy provider 로 보내고,
  // 동일한 5b 파서·검증기로 검증한다(chunk_id 위조 차단 재사용). 실패 시
  // 한글 안내 + 복붙 경로로 그대로 진행(graceful degradation).
  async function runAuto() {
    autoRunning = true;
    autoNotice = null;
    try {
      const outcome = await autoExtractCandidate(codexProvider, input, knownChunkIds);
      if (outcome.ok) {
        // 검증 결과는 복붙 경로와 동일한 ValidationResult — 같은 UI/가져오기 사용.
        result = outcome.result;
        // 받은 원문 텍스트를 붙여넣기 칸에도 채워 사용자가 검토/재검증할 수 있게 한다.
        pasted = outcome.rawText;
        autoNotice =
          result.importable.length > 0
            ? `자동 LLM이 후보 ${result.candidates.length}개를 받았습니다(가져오기 가능 ${result.importable.length}개). 근거 chunk_id는 복붙 모드와 동일한 위조 차단 검증을 거쳤습니다.`
            : `자동 LLM 응답을 받았으나 가져올 수 있는 후보가 없습니다(근거 검증 실패 가능). 위 복붙 경로로 직접 검토할 수 있습니다.`;
      } else {
        autoNotice = `${outcome.message}`;
      }
    } finally {
      autoRunning = false;
    }
  }

  function importOne(cand: ValidatedCandidate) {
    if (!cand.importable) return;
    onimport?.(cand);
    const next = new Set(imported);
    next.add(cand.index);
    imported = next;
  }
</script>

<section class="bridge" aria-label="ChatGPT 복붙 브릿지">
  <header class="bridge-head">
    <h4 class="bridge-title">ChatGPT 복붙 브릿지</h4>
    <button type="button" class="link-btn" onclick={() => onclose?.()}>닫기</button>
  </header>

  {#if autoMode}
    <p class="bridge-lede">
      자동 LLM 모드(고급)입니다. [자동 추출]을 누르면 아래와 동일한 프롬프트를
      codex 인증 기반 openai-oauth 프록시(127.0.0.1)로 보내 응답을 자동으로 받아,
      복붙 모드와 <strong>동일한 근거(chunk_id) 위조 차단 검증</strong>을 적용합니다.
      실패하면 아래 복붙 경로로 그대로 진행할 수 있습니다(앱은 계속 동작합니다).
    </p>
    <div class="step auto-step">
      <span class="step-key">0. 자동 추출 (고급)</span>
      <div class="actions">
        <button type="button" class="btn primary" onclick={runAuto} disabled={autoRunning}>
          {autoRunning ? '자동 추출 중…' : '자동 추출 (codex)'}
        </button>
        {#if autoNotice}
          <span class="hint" role="status">{autoNotice}</span>
        {/if}
      </div>
      <p class="auto-fallback-note">
        자동 모드가 막히면 아래 복붙 단계로 똑같이 정리할 수 있습니다(근거 검증은 동일).
      </p>
    </div>
  {:else}
    <p class="bridge-lede">
      이 앱은 ChatGPT를 직접 호출하지 않습니다. 아래 프롬프트를 복사해 chatgpt.com에
      붙여넣고, ChatGPT가 돌려준 JSON 응답을 다시 이 칸에 붙여넣으면 앱이 형식과
      근거(chunk_id)를 검증합니다. 인증·API 키는 필요 없습니다.
    </p>
  {/if}

  <!-- 1. 프롬프트 -->
  <div class="step">
    <span class="step-key">1. 프롬프트</span>
    <pre class="prompt" aria-label="생성된 프롬프트">{prompt}</pre>
    <div class="actions">
      <button type="button" class="btn" onclick={copyPrompt}>프롬프트 복사</button>
      <button type="button" class="btn" onclick={openChatGpt}>ChatGPT 열기</button>
      {#if copyState === 'copied'}
        <span class="hint ok" role="status">복사되었습니다. ChatGPT에 붙여넣으세요.</span>
      {:else if copyState === 'failed'}
        <span class="hint warn" role="status">자동 복사가 막혔습니다. 위 칸을 직접 선택해 복사하세요.</span>
      {/if}
    </div>
  </div>

  <!-- 2. 응답 붙여넣기 -->
  <div class="step">
    <label class="step-key" for="bridge-paste">2. ChatGPT 응답 붙여넣기 (JSON)</label>
    <textarea
      id="bridge-paste"
      class="paste"
      bind:value={pasted}
      rows="6"
      placeholder={'ChatGPT가 출력한 JSON을 붙여넣으세요. ```json … ``` 코드펜스로 감싸져 있어도 됩니다.'}
    ></textarea>
    <div class="actions">
      <button type="button" class="btn primary" onclick={runValidate} disabled={pasted.trim().length === 0}>
        검증
      </button>
    </div>
  </div>

  <!-- 3. 검증 결과 -->
  {#if result}
    <div class="step results" aria-live="polite">
      <span class="step-key">3. 검증 결과</span>

      {#if !result.shapeOk}
        <p class="hint warn">{result.topLevelError}</p>
      {:else if result.candidates.length === 0}
        <p class="hint warn">wiki_candidates 배열이 비어 있습니다.</p>
      {:else}
        <p class="summary-line">
          후보 {result.candidates.length}개 · 가져오기 가능 {result.importable.length}개 ·
          거부 {result.candidates.length - result.importable.length}개
        </p>
        <ul class="result-list">
          {#each result.candidates as c (c.index)}
            <li class="result" class:rejected={!c.importable} class:done={imported.has(c.index)}>
              <div class="result-head">
                <span class="status-tag" data-state={c.importable ? 'ok' : 'rejected'}>
                  {c.importable ? '검증 통과' : '거부됨'}
                </span>
                <span class="result-title">{c.title || '(제목 없음)'}</span>
                {#if c.confidence}
                  <span class="conf">신뢰도 {c.confidence}</span>
                {/if}
              </div>

              {#if c.schema_field}
                <p class="result-row"><span class="rk">분류</span> {c.schema_field}</p>
              {/if}
              {#if c.summary_ko}
                <p class="result-row"><span class="rk">요약(가톨릭 용어)</span> {c.summary_ko}</p>
              {/if}

              <p class="result-row">
                <span class="rk">근거</span>
                {#each c.evidence as ev (ev.chunk_id + ev.quote.slice(0, 8))}
                  <span class="ev">{ev.chunk_id}</span>
                {/each}
                {#each c.rejectedEvidence as rev, ri (rev.claimed_chunk_id + ri)}
                  <span class="ev bad">{rev.claimed_chunk_id || '(빈 chunk_id)'}</span>
                {/each}
                {#if c.evidence.length === 0 && c.rejectedEvidence.length === 0}
                  <span class="ev empty">(근거 없음)</span>
                {/if}
              </p>

              {#if c.violations.length}
                <ul class="violations">
                  {#each c.violations as v (v)}
                    <li>{v}</li>
                  {/each}
                </ul>
              {/if}

              <div class="actions">
                {#if c.importable}
                  <button
                    type="button"
                    class="btn primary"
                    disabled={imported.has(c.index)}
                    onclick={() => importOne(c)}
                  >
                    {imported.has(c.index) ? '가져옴' : '위키 후보로 가져오기'}
                  </button>
                {:else}
                  <span class="hint warn">검증을 통과하지 못해 가져올 수 없습니다.</span>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>

<style>
  .bridge {
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--accent-oxblood);
    border-radius: var(--radius-asymmetric);
    background: var(--surface-elevated);
    padding: var(--space-lg);
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    margin-top: var(--space-md);
  }

  .bridge-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-sm);
  }
  .bridge-title {
    margin: 0;
    font-family: var(--heading-family);
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .bridge-lede {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.55;
  }

  .step {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .auto-step {
    border: 1px dashed var(--accent-oxblood);
    border-radius: var(--radius-tight);
    background: var(--surface-sunken);
    padding: var(--space-md);
  }
  .auto-fallback-note {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }
  .step-key {
    font-family: var(--heading-family);
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text-secondary);
    letter-spacing: 0.02em;
  }

  .prompt {
    margin: 0;
    max-height: 16rem;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.75rem;
    line-height: 1.5;
    color: var(--text-primary);
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-tight);
    padding: var(--space-md);
  }

  .paste {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--text-primary);
    background: var(--surface-sunken);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-tight);
    padding: var(--space-md);
  }
  .paste:focus-visible {
    outline: 2px solid var(--accent-oxblood);
    outline-offset: 1px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-sm);
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
  .btn.primary {
    background: var(--accent-oxblood);
    color: var(--surface-elevated);
    border-color: var(--accent-oxblood);
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .link-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-family: var(--heading-family);
    font-size: 0.8125rem;
    cursor: pointer;
    text-decoration: underline;
  }

  .hint { font-size: 0.8125rem; line-height: 1.4; }
  .hint.ok { color: var(--success-moss); }
  .hint.warn { color: var(--danger-rust); }

  .summary-line { margin: 0; font-size: 0.875rem; color: var(--text-primary); font-weight: 600; }

  .result-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
  .result {
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--success-moss);
    border-radius: var(--radius-tight);
    background: var(--surface-sunken);
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }
  .result.rejected { border-left-color: var(--danger-rust); }
  .result.done { opacity: 0.7; }

  .result-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }
  .status-tag {
    font-family: var(--heading-family);
    font-size: 0.6875rem;
    font-weight: 700;
    padding: 1px var(--space-sm);
    border-radius: var(--radius-pill);
    border: 1px solid var(--border-subtle);
  }
  .status-tag[data-state='ok'] { color: var(--success-moss); border-color: var(--success-moss); }
  .status-tag[data-state='rejected'] { color: var(--danger-rust); border-color: var(--danger-rust); }
  .result-title { font-weight: 600; color: var(--text-primary); }
  .conf { font-size: 0.6875rem; color: var(--text-secondary); }

  .result-row { margin: 0; font-size: 0.8125rem; color: var(--text-secondary); line-height: 1.5; }
  .rk {
    font-family: var(--heading-family);
    font-size: 0.6875rem;
    font-weight: 700;
    color: var(--text-secondary);
    margin-right: var(--space-xs);
  }
  .ev {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.6875rem;
    padding: 0 var(--space-xs);
    border-radius: var(--radius-tight);
    background: var(--surface-elevated);
    color: var(--text-secondary);
    margin-right: var(--space-xs);
  }
  .ev.bad { color: var(--danger-rust); border: 1px solid var(--danger-rust); }
  .ev.empty { font-style: italic; color: var(--text-secondary); }

  .violations {
    margin: var(--space-xs) 0 0 0;
    padding-left: 1.1em;
    font-size: 0.8125rem;
    color: var(--danger-rust);
    line-height: 1.5;
  }
</style>
