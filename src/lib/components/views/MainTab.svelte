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
  import type { TextQualityReport } from '$lib/extract/textQuality';
  import { pipeline } from '$lib/pipeline/store.svelte';
  import {
    onFileSelected,
    onOutlineParsed,
    onOutlineRawChanged,
    resetAutoWikiProgress,
    buildWiki,
    runRuleEngine,
    onCandidateDecision,
    openBridge,
    closeBridge,
    importBridgeCandidate,
    bridgePromptInput,
  } from '$lib/pipeline/actions';

  import { autoModeActive } from '$lib/llm/modeStore.svelte';

  // Slice 5b — derive the open bridge panel's inputs from the store.
  let bridgeInput = $derived(pipeline.bridgeCandidateId ? bridgePromptInput() : null);
  // Slice 5c — the bridge runs in auto mode only when the user has opted in AND
  // codex is available (effective mode). Otherwise it is the pure 5b copy-paste
  // bridge (无损). `autoModeActive` collapses an unavailable selection to offline.
  let autoMode = $derived(autoModeActive());

  let upload_zone: ReturnType<typeof UploadZone> | null = null;

  function handle_select(file: File) {
    return onFileSelected(file, upload_zone);
  }

  function qualityLabel(level: TextQualityReport['level']): string {
    if (level === 'bad') return 'OCR 전처리 권장';
    if (level === 'warn') return '텍스트 추출 주의';
    return '텍스트 추출 양호';
  }

  function qualityLowPages(report: TextQualityReport): string {
    const pages = report.page_char_counts
      .map((count, index) => ({ count, page: index + 1 }))
      .filter((p) => p.count < 80)
      .slice(0, 30)
      .map((p) => `p.${p.page}(${p.count}자)`);
    if (pages.length === 0) return '텍스트가 특히 적은 페이지는 감지되지 않았습니다.';
    const more = report.low_text_pages > pages.length ? ` 외 ${report.low_text_pages - pages.length}쪽` : '';
    return `${pages.join(', ')}${more}`;
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
  {#if pipeline.textQuality}
    <div class="ocr-quality" data-level={pipeline.textQuality.level} role="status">
      <div class="ocr-head">
        <strong>{qualityLabel(pipeline.textQuality.level)}</strong>
        <span>
          {pipeline.textQuality.extractable_pages}/{pipeline.textQuality.page_count}쪽 ·
          평균 {pipeline.textQuality.avg_chars_per_page}자/쪽
        </span>
      </div>
      <p>{pipeline.textQuality.summary_ko}</p>
      {#if pipeline.textQuality.level !== 'ok'}
        <p>{pipeline.textQuality.suggestion_ko}</p>
        <details>
          <summary>페이지별 텍스트 추출량 보기</summary>
          <dl class="ocr-stats">
            <div>
              <dt>텍스트 적은 페이지</dt>
              <dd>{qualityLowPages(pipeline.textQuality)}</dd>
            </div>
            <div>
              <dt>총 추출 글자 수</dt>
              <dd>{pipeline.textQuality.total_chars.toLocaleString()}자</dd>
            </div>
            <div>
              <dt>빈 페이지로 보이는 쪽</dt>
              <dd>{pipeline.textQuality.blank_pages}쪽</dd>
            </div>
          </dl>
        </details>
      {/if}
    </div>
  {/if}
</section>

<section class="block">
  <h2 class="section-title">논문 목차</h2>
  <OutlineInput
    value={pipeline.outlineRaw}
    parsed={pipeline.outline}
    onrawchange={onOutlineRawChanged}
    onparsed={onOutlineParsed}
  />
</section>

<section class="block">
  <h2 class="section-title">추출 후보</h2>
  <p class="section-lede">
    결정적 추출 결과입니다(원문 그대로, 패러프레이즈 없음). 아래 “위키 생성”은
    자동 모드에서는 근거 검증을 통과한 LLM 후보만 위키 초안으로 가져오고,
    실패하거나 인증이 없으면 결정적 후보로 위키를 만듭니다.
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
      {#if autoMode && pipeline.autoWikiProgress && pipeline.autoWikiProgress.nextBatch > 0 && pipeline.autoWikiProgress.nextBatch < pipeline.autoWikiProgress.totalBatches}
        자동 위키 계속 생성
      {:else}
        위키 생성 (추출 · 분류 · 매핑)
      {/if}
    </button>
    <span class="llm-state" title="모델 id는 설정 단일소스(llm.config.json)에서 관리됩니다">
      모델: {pipeline.llmCfg.model} · 인증: {pipeline.llmCfg.auth} ·
      {pipeline.llmCfg.reachable ? 'LLM 연결됨' : 'LLM 미연결(오프라인 가능)'}
    </span>
    {#if autoMode && pipeline.autoWikiProgress}
      <button type="button" class="btn" onclick={resetAutoWikiProgress} disabled={pipeline.busy}>
        자동 진행 초기화
      </button>
    {/if}
  </div>
  {#if pipeline.notice}
    <p class="notice" role="status">{pipeline.notice}</p>
  {/if}
  {#if autoMode && pipeline.autoWikiProgress}
    <p class="notice muted" role="status">
      자동 LLM 진행: 배치 {pipeline.autoWikiProgress.nextBatch}/{pipeline.autoWikiProgress.totalBatches}
      · 누적 가져오기 {pipeline.autoWikiProgress.imported}개
      · 목차 매핑 {pipeline.autoWikiProgress.mapped}개
    </p>
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
      {autoMode}
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

  .ocr-quality {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding: var(--space-md);
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--success-moss);
    border-radius: var(--radius-tight);
    background: var(--surface-sunken);
    color: var(--text-secondary);
    font-size: 0.8125rem;
    line-height: 1.5;
  }

  .ocr-quality[data-level='warn'] {
    border-left-color: var(--warn-amber);
  }

  .ocr-quality[data-level='bad'] {
    border-left-color: var(--danger-rust);
  }

  .ocr-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }

  .ocr-head strong {
    font-family: var(--heading-family);
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  .ocr-quality p {
    margin: 0;
  }

  .ocr-quality summary {
    cursor: pointer;
    font-family: var(--heading-family);
    font-weight: 700;
    color: var(--text-primary);
  }

  .ocr-stats {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    margin: var(--space-sm) 0 0 0;
  }

  .ocr-stats div {
    display: grid;
    grid-template-columns: minmax(8rem, max-content) 1fr;
    gap: var(--space-sm);
  }

  .ocr-stats dt {
    font-family: var(--heading-family);
    font-weight: 700;
    color: var(--text-secondary);
  }

  .ocr-stats dd {
    margin: 0;
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

  .notice.muted {
    border-left-color: var(--success-moss);
    color: var(--text-secondary);
  }

  code {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.875em;
    background: var(--surface-elevated);
    padding: 0 var(--space-xs);
    border-radius: var(--radius-tight);
  }
</style>
