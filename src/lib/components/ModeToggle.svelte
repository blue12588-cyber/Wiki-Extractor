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
    loginWithChatGPT,
  } from '$lib/llm/modeStore.svelte';
  import type { ProviderId } from '$lib/llm/provider';

  onMount(() => {
    // 읽기 전용 codex 검출 1회 + 가벼운 폴링은 하지 않는다(명시적 새로고침 버튼 제공).
    void refreshDetect();
  });

  function pick(id: ProviderId) {
    selectProvider(id);
  }

  // [ChatGPT로 로그인] — 앱이 codex login을 spawn(브라우저 OAuth). 앱은 auth.json을
  // 직접 쓰지 않는다(codex가 ~/.codex에 기록). 끝나면 read-only 재검출로 상태 갱신.
  function login() {
    void loginWithChatGPT(false);
  }

  // [코드 입력 방식으로 로그인] — 기본(브라우저 자동 열기) 흐름이 막힌 환경
  // (방화벽·원격·브라우저 자동 실행 불가)을 위한 보조 경로. codex login --device-auth를
  // spawn해, 브라우저가 자동으로 열리지 않아도 화면에 뜬 주소·코드로 로그인을 마칠 수
  // 있게 한다(Slice 6 보수 #2). 동일하게 앱은 auth.json을 직접 쓰지 않는다.
  function loginDevice() {
    void loginWithChatGPT(true);
  }

  // 상태 줄(.login-status)의 색 극성: 성공이면 success, 그 외(미완료·실패·미설치)는
  // attention. 색은 텍스트 메시지를 보조할 뿐, 색에만 의존하지 않는다(Slice 6 보수 #3).
  let statusKind = $derived(modeStore.loginOutcomeKind ?? 'attention');

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

  <div class="login-row">
    <button
      type="button"
      class="login-btn"
      onclick={login}
      disabled={modeStore.loggingIn}
      aria-busy={modeStore.loggingIn}
    >
      <span class="login-mark" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="15" height="15">
          <circle cx="6" cy="6" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6" />
          <path d="M8.2 8.2 L13 13 M11 11 L13 9.5 M12 12 L13.5 11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </span>
      <span>{modeStore.loggingIn ? '로그인 진행 중… (브라우저를 확인하세요)' : 'ChatGPT로 로그인'}</span>
    </button>
    <span class="login-hint">
      버튼을 누르면 앱이 codex 로그인을 실행해 브라우저에서 ChatGPT 계정으로
      로그인합니다(아이디·비밀번호는 앱에 입력하지 않습니다). 로그인은 codex가
      처리하며, 앱은 인증 파일을 직접 만들거나 고치지 않습니다. 로그인하지 않아도
      복붙 모드로 모든 기능을 그대로 쓸 수 있습니다.
    </span>

    <!-- 보조 경로(Slice 6 보수 #2): 기본(브라우저 자동 열기) 흐름이 막힌 환경을 위한
         코드 입력 방식. 기본 로그인이 완료되지 못하면 강조해서 보여 준다. -->
    <div class="device-row" class:emphasized={modeStore.defaultLoginUnfinished}>
      <button
        type="button"
        class="device-btn"
        onclick={loginDevice}
        disabled={modeStore.loggingIn}
        aria-busy={modeStore.loggingIn}
      >
        {modeStore.loggingIn ? '진행 중…' : '브라우저가 안 열리면 · 코드 입력 방식으로 로그인'}
      </button>
      <span class="device-hint">
        {#if modeStore.defaultLoginUnfinished}
          <strong>브라우저가 자동으로 열리지 않았거나 로그인이 끝나지 않았나요?</strong>
        {/if}
        방화벽·원격 접속 등으로 브라우저가 자동으로 열리지 않는 환경에서는 이 방식을
        쓰세요. 화면에 주소와 짧은 코드가 표시되면, 다른 기기·브라우저에서 그 주소로
        들어가 코드를 입력해 로그인을 마칠 수 있습니다. 이 방식도 아이디·비밀번호를
        앱에 입력하지 않으며, 앱은 인증 파일을 직접 만들거나 고치지 않습니다.
      </span>
    </div>
  </div>

  {#if modeStore.loginMessage}
    <p class="login-status" role="status" data-kind={statusKind}>{modeStore.loginMessage}</p>
  {/if}

  {#if modeStore.loginVerification}
    <p class="login-verify" role="note">
      브라우저에서 아래 주소/코드로 로그인을 마쳐 주세요:
      <code class="verify-code">{modeStore.loginVerification}</code>
    </p>
  {/if}

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

  /* [ChatGPT로 로그인] 버튼 블록 (Slice 6). 토큰만 사용. */
  .login-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }
  .login-btn {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-lg);
    border: 1px solid var(--accent-oxblood);
    border-radius: var(--radius-soft);
    background: var(--accent-oxblood);
    color: var(--surface-base);
    font-family: var(--heading-family);
    font-size: 0.9375rem;
    font-weight: 700;
    cursor: pointer;
    transition: opacity var(--motion-fast) var(--ease-deliberate);
  }
  .login-btn:hover { opacity: 0.9; }
  .login-btn:disabled { opacity: 0.6; cursor: progress; }
  .login-mark {
    display: inline-flex;
    align-items: center;
    line-height: 0;
    color: currentColor;
  }
  .login-hint {
    font-size: 0.75rem;
    color: var(--text-secondary);
    line-height: 1.55;
  }
  /* 보조 경로(코드 입력 방식) 버튼 블록 (Slice 6 보수 #2). 기본 로그인보다 한 단계
     낮은 시각 위계의 보조 affordance. 토큰만 사용. */
  .device-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    margin-top: var(--space-xs);
  }
  .device-btn {
    align-self: flex-start;
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-soft);
    background: var(--surface-base);
    color: var(--text-secondary);
    font-family: var(--heading-family);
    font-size: 0.8125rem;
    font-weight: 700;
    cursor: pointer;
    transition: border-color var(--motion-fast) var(--ease-deliberate);
  }
  .device-btn:hover { border-color: var(--accent-oxblood); color: var(--text-primary); }
  .device-btn:disabled { opacity: 0.6; cursor: progress; }
  /* 기본 로그인이 완료되지 못한 경우: 보조 경로를 강조(테두리 강세 + 색 진하게). */
  .device-row.emphasized .device-btn {
    border-color: var(--accent-oxblood);
    color: var(--text-primary);
  }
  .device-hint {
    font-size: 0.75rem;
    color: var(--text-secondary);
    line-height: 1.55;
  }

  .login-status {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-primary);
    line-height: 1.5;
    padding: var(--space-sm) var(--space-md);
    border-left: 3px solid var(--border-subtle);
    background: var(--surface-sunken);
    border-radius: var(--radius-tight);
  }
  /* 색 극성(Slice 6 보수 #3): 성공=success-moss, 그 외(미완료·실패·미설치)=
     danger-rust. 색은 한글 메시지를 보조할 뿐, 색에만 의존하지 않는다. */
  .login-status[data-kind='success'] { border-left-color: var(--success-moss); }
  .login-status[data-kind='attention'] { border-left-color: var(--danger-rust); }
  .login-verify {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .verify-code {
    display: inline-block;
    margin-top: var(--space-xs);
    word-break: break-all;
  }

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
