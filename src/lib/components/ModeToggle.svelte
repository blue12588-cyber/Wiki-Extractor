<!--
  ModeToggle.svelte — 추출 모드 토글 (Slice 5c)
  ----------------------------------------------
  AC-LOGIN-TAB-5c + AC-AUTH-ABSTRACT + AC-CODEX-DETECT + AC-GRACEFUL +
  AC-KOREAN-UI + AC-ENCAPSULATE.

  로그인 탭에 표시되는 provider 선택 UI:
    - codex 인증 상태(읽기 전용 검출)를 보여준다.
    - 복붙(기본·누구나) / 자동 LLM(고급·codex) / API 키(준비 중) 라디오 토글.
    - codex 미설치 시 강요 없이 '안내'만 표시(설치는 사용자 선택).

  설계: 색상에만 의존하지 않도록 상태마다 라벨 텍스트 + 사용 가능/불가 배지로
  구분(접근성). 라디오 입력으로 키보드 접근성 확보. 토큰만 사용.

  캡슐화: 이 컴포넌트는 openai-oauth/codex 세부를 모른다. provider/modeStore
  추상화(availabilities + selected)만 읽고 쓴다.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import {
    modeStore,
    refreshDetect,
    selectProvider,
  } from '$lib/llm/modeStore.svelte';
  import type { ProviderId } from '$lib/llm/provider';

  onMount(() => {
    // 읽기 전용 codex 검출 1회 + 가벼운 폴링은 하지 않는다(명시적 새로고침 버튼 제공).
    void refreshDetect();
  });

  function pick(id: ProviderId) {
    selectProvider(id);
  }

  // 검출 요약 라벨(한글). 색상에만 의존하지 않도록 텍스트로 상태를 말한다.
  let probeLabel = $derived(
    modeStore.detect.login_probe === 'authed'
      ? 'codex 로그인 확인됨'
      : modeStore.detect.login_probe === 'unauthed'
        ? 'codex 설치됨 · 로그인 필요'
        : 'codex CLI 미설치',
  );
</script>

<section class="mode-block" aria-label="추출 모드 선택">
  <div class="detect-row">
    <span class="detect-key">codex 인증 검출(읽기 전용)</span>
    <span class="detect-badge" data-state={modeStore.detect.available ? 'ok' : 'na'}>
      {modeStore.detect.available ? '자동 모드 사용 가능' : '자동 모드 불가'}
    </span>
    <span class="detect-sub">{probeLabel}{modeStore.detect.auth_file_present ? ' · auth.json 있음' : ''}</span>
    <button type="button" class="link-btn" onclick={() => refreshDetect()} disabled={modeStore.refreshing}>
      {modeStore.refreshing ? '검출 중…' : '다시 검출'}
    </button>
  </div>

  <fieldset class="modes">
    <legend class="modes-legend">추출 모드</legend>
    {#each modeStore.availabilities as a (a.id)}
      <label class="mode-opt" class:disabled={!a.available}>
        <input
          type="radio"
          name="extraction-mode"
          value={a.id}
          checked={modeStore.selected === a.id}
          disabled={!a.available}
          onchange={() => pick(a.id)}
        />
        <span class="mode-label">{a.label}</span>
        <span class="mode-state" data-state={a.available ? 'ok' : 'na'}>
          {a.available ? '사용 가능' : '사용 불가'}
        </span>
        {#if a.reason}
          <span class="mode-reason">{a.reason}</span>
        {/if}
      </label>
    {/each}
  </fieldset>

  {#if modeStore.detect.codex_cli_missing}
    <p class="guide" role="note">
      자동 LLM 모드는 codex CLI를 직접 설치·로그인한 고급 사용자용입니다. 설치를
      강요하지 않으며, 설치하지 않아도 기본 <strong>복붙 모드</strong>로 모든 기능을
      그대로 사용할 수 있습니다. 원한다면 직접
      <code>npm i -g @openai/codex</code> 후 <code>codex login</code>으로 로그인한 뒤
      [다시 검출]을 누르세요.
    </p>
  {/if}
</section>

<style>
  .mode-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--accent-oxblood);
    border-radius: var(--radius-asymmetric);
    background: var(--surface-elevated);
    padding: var(--space-lg);
  }

  .detect-row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }
  .detect-key {
    font-family: var(--heading-family);
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--text-secondary);
  }
  .detect-badge {
    font-family: var(--heading-family);
    font-size: 0.6875rem;
    font-weight: 700;
    padding: 1px var(--space-sm);
    border-radius: var(--radius-pill);
    border: 1px solid var(--border-subtle);
  }
  .detect-badge[data-state='ok'] { color: var(--success-moss); border-color: var(--success-moss); }
  .detect-badge[data-state='na'] { color: var(--text-secondary); border-style: dashed; }
  .detect-sub { font-size: 0.75rem; color: var(--text-secondary); }

  .modes {
    border: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
  .modes-legend {
    font-family: var(--heading-family);
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--text-secondary);
    padding: 0;
    margin-bottom: var(--space-xs);
  }
  .mode-opt {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: baseline;
    gap: var(--space-sm) var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-tight);
    background: var(--surface-sunken);
    cursor: pointer;
  }
  .mode-opt.disabled { opacity: 0.65; cursor: not-allowed; }
  .mode-opt input { grid-row: 1; }
  .mode-label {
    grid-row: 1;
    font-family: var(--heading-family);
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .mode-state {
    grid-row: 1;
    justify-self: end;
    font-size: 0.6875rem;
    font-weight: 700;
    font-family: var(--heading-family);
  }
  .mode-state[data-state='ok'] { color: var(--success-moss); }
  .mode-state[data-state='na'] { color: var(--text-secondary); }
  .mode-reason {
    grid-column: 2 / 4;
    grid-row: 2;
    font-size: 0.75rem;
    color: var(--text-secondary);
    line-height: 1.45;
  }

  .guide {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.55;
    padding: var(--space-sm) var(--space-md);
    border-left: 3px solid var(--border-subtle);
    background: var(--surface-sunken);
    border-radius: var(--radius-tight);
  }

  .link-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-family: var(--heading-family);
    font-size: 0.75rem;
    cursor: pointer;
    text-decoration: underline;
  }
  .link-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  code {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.875em;
    background: var(--surface-base);
    padding: 0 var(--space-xs);
    border-radius: var(--radius-tight);
  }
</style>
