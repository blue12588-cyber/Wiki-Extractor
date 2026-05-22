<!--
  MainTab.svelte
  --------------
  AC-MAIN-TAB: upload + outline + extraction surface (wiki excluded — the wiki
  lives in WikiTab). Reads/writes the layout-level `pipeline` store so its
  state survives a tab switch (AC-NAV / AC-MAIN-TAB).

  All copy is Korean (AC-KOREAN-UI). This view does no I/O directly; it delegates
  to $lib/pipeline/actions, which is byte-identical to the slice-3 logic that
  used to live in +page.svelte (AC-REGRESS).
-->
<script lang="ts">
  import UploadZone from '$lib/components/UploadZone.svelte';
  import OutlineInput from '$lib/components/OutlineInput.svelte';
  import CandidateList from '$lib/components/CandidateList.svelte';
  import CandidateCardList from '$lib/components/CandidateCardList.svelte';
  import BridgePanel from '$lib/components/BridgePanel.svelte';
  import { pipeline } from '$lib/pipeline/store.svelte';
  import {
    onFileSelected,
    onOutlineParsed,
    buildWiki,
    runRuleEngine,
    onCandidateDecision,
    openBridge,
    closeBridge,
    importBridgeCandidate,
    bridgePromptInput,
    bridgeKnownChunkIds,
  } from '$lib/pipeline/actions';

  // Slice 5b — derive the open bridge panel's inputs from the store.
  let bridgeInput = $derived(pipeline.bridgeCandidateId ? bridgePromptInput() : null);
  let knownChunkIds = $derived(bridgeKnownChunkIds());

  let upload_zone: ReturnType<typeof UploadZone> | null = null;

  function handle_select(file: File) {
    return onFileSelected(file, upload_zone);
  }
</script>

<section class="block">
  <h2 class="section-title">원문 추가</h2>
  <p class="section-lede">
    일반 텍스트, 마크다운, PDF 파일을 올려놓으세요. 해시 기반 원문 식별자가
    <code>data/sources/</code> 아래 하위 폴더가 되며, 업로드 시 청크가 자동 저장됩니다.
  </p>
  <UploadZone bind:this={upload_zone} onselect={handle_select} />
  {#if pipeline.chunkStatus}
    <p class="chunk-status" role="status">{pipeline.chunkStatus}</p>
  {/if}
</section>

<section class="block">
  <h2 class="section-title">논문 목차</h2>
  <OutlineInput onparsed={onOutlineParsed} />
</section>

<section class="block">
  <h2 class="section-title">추출 후보</h2>
  <p class="section-lede">
    결정적 추출 결과입니다(원문 그대로, 패러프레이즈 없음). 아래 “위키 생성”을 누르면
    LLM 추출·목차 분류를 시도하고, 인증이 없으면 이 결정적 후보로 위키를 만듭니다.
    생성된 위키는 좌측 “위키” 탭에서 확인·편집할 수 있습니다.
  </p>
  <CandidateList bundle={pipeline.bundle} busy={pipeline.extracting} />

  <div class="build-row">
    <button
      type="button"
      class="btn primary"
      onclick={buildWiki}
      disabled={!pipeline.bundle || pipeline.busy}
    >
      위키 생성 (추출 · 분류 · 매핑)
    </button>
    <span class="llm-state" title="모델 id는 설정 단일소스(llm.config.json)에서 관리됩니다">
      모델: {pipeline.llmCfg.model} · 인증: {pipeline.llmCfg.auth} ·
      {pipeline.llmCfg.reachable ? 'LLM 연결됨' : 'LLM 미연결(오프라인 가능)'}
    </span>
  </div>
  {#if pipeline.notice}
    <p class="notice" role="status">{pipeline.notice}</p>
  {/if}
</section>

<section class="block">
  <h2 class="section-title">규칙 기반 후보 카드</h2>
  <p class="section-lede">
    LLM 없이 오프라인 규칙으로 위키 후보를 평가합니다. 목차에 입력한 항목과 주제어를
    근거로 “생성 · 보강 · 링크 · 무시”를 추천하고, 기존 위키와 중복되는 후보는 보강·링크로
    안내합니다. 내부 점수는 보여 드리지 않으며, 추천 작업과 근거·경계만 카드로 표시합니다.
  </p>
  <div class="build-row">
    <button
      type="button"
      class="btn primary"
      onclick={runRuleEngine}
      disabled={!pipeline.bundle || pipeline.scoring}
    >
      규칙 기반 후보 추출 (오프라인)
    </button>
  </div>
  <CandidateCardList
    cards={pipeline.candidateCards}
    busy={pipeline.scoring}
    ondecision={onCandidateDecision}
    oncopyprompt={openBridge}
  />

  {#if bridgeInput}
    <BridgePanel
      input={bridgeInput}
      {knownChunkIds}
      onimport={importBridgeCandidate}
      onclose={closeBridge}
    />
  {/if}
</section>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    margin-bottom: var(--space-2xl);
  }

  .section-title {
    font-family: var(--heading-family);
    font-size: 1.0625rem;
    font-weight: 600;
    margin: 0;
  }

  .section-lede {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .chunk-status {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--success-moss);
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    overflow-wrap: anywhere;
  }

  .build-row {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    flex-wrap: wrap;
  }

  .btn {
    font-family: var(--heading-family);
    font-size: 0.875rem;
    font-weight: 600;
    padding: var(--space-sm) var(--space-lg);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-pill);
    background: var(--surface-elevated);
    color: var(--text-primary);
    cursor: pointer;
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

  .llm-state {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .notice {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-primary);
    padding: var(--space-sm) var(--space-md);
    border-left: 3px solid var(--accent-oxblood);
    background: var(--surface-sunken);
    border-radius: var(--radius-tight);
    line-height: 1.5;
  }

  code {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.875em;
    background: var(--surface-elevated);
    padding: 0 var(--space-xs);
    border-radius: var(--radius-tight);
  }
</style>
