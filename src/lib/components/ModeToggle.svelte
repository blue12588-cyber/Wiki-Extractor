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
  import { openVerificationUrl, type ProviderId } from '$lib/llm/provider';

  onMount(() => {
    // 읽기 전용 codex 검출 1회 + 가벼운 폴링은 하지 않는다(명시적 새로고침 버튼 제공).
    void refreshDetect();
  });

  function pick(id: ProviderId) {
    selectProvider(id);
  }

  // [ChatGPT로 로그인] (Slice 8) — 먼저 read-only 검출 후, 이미 로그인돼 있으면
  // codex login을 spawn하지 않고 자동 모드만 켠다(브라우저 안 열림 = 정상,
  // AC-LOGIN-DETECT-FIRST). 미인증이면 codex login --device-auth를 spawn해 화면에
  // 뜬 주소를 앱이 직접 브라우저로 열고(AC-LOGIN-DEVICE-BROWSER) 코드를 크게
  // 보여 준다(AC-LOGIN-CODE-UI). 앱은 auth.json을 직접 쓰지 않는다(codex가 기록).
  function login() {
    void loginWithChatGPT(true);
  }

  // [브라우저 자동 열기 방식으로 다시 시도] — 코드 입력 방식이 막힌 드문 환경을 위한
  // 보조 경로(legacy 브라우저 콜백 흐름, codex login). 기본(코드 입력) 흐름이 끝나지
  // 않으면 강조해서 보여 준다. 동일하게 앱은 auth.json을 직접 쓰지 않는다.
  function loginDevice() {
    void loginWithChatGPT(false);
  }

  // [주소 열기] — 표시된 verification URL을 시스템 브라우저로 연다(OS 위임, window.open).
  // Rust가 이미 한 번 열지만, 사용자가 직접 다시 열 수 있는 보조 affordance.
  function openUrl() {
    openVerificationUrl(modeStore.loginVerification?.url ?? null);
  }

  // [코드 복사] — verification 코드(비밀 아님)를 클립보드로 복사한다.
  let codeCopied = $state(false);
  async function copyCode() {
    const code = modeStore.loginVerification?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      codeCopied = true;
      setTimeout(() => (codeCopied = false), 2000);
    } catch {
      codeCopied = false;
    }
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

  function displayDetectDetail(detail: string): string {
    return detail
      .split(' · ')
      .map((part) => {
        if (part.startsWith('home=')) return 'home=(숨김)';
        if (part.startsWith('auth_file:')) return 'auth_file:(확인됨)';
        return part
          .replace(/[A-Za-z]:\\[^·]+/g, '(경로 숨김)')
          .replace(/\/(?:Users|home)\/[^·]+/g, '/(경로 숨김)');
      })
      .join(' · ');
  }
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

  <!-- 검출 자가진단(Slice 10 · AC-DETECT-SELFDIAG): 잡은 home 경로 + 어느 신호로
       판정됐는지(또는 못 잡은 이유)를 작은 muted 줄로 보여 준다. 경로·신호 라벨만
       표시하며 auth.json 내용이나 토큰은 절대 담기지 않는다. 검출이 다시 깜깜이로
       실패하는 일을 막기 위한 진단 보조 줄. -->
  {#if modeStore.detect.detail}
    <p class="detect-detail" role="note">검출 상세: <code>{displayDetectDetail(modeStore.detect.detail)}</code></p>
  {/if}

  <!-- 검출 에러 표면화(Slice 10 · AC-REFRESH-SURFACE): invoke 호출 자체가 실패하면
       조용히 degrade만 하지 않고 한글 사유를 보여 준다 → [다시 검출]이 무반응처럼
       보이지 않는다. -->
  {#if modeStore.detectError}
    <p class="detect-error" role="status">{modeStore.detectError}</p>
  {/if}

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
      <span>{modeStore.loggingIn ? '로그인 확인 중…' : 'ChatGPT로 로그인'}</span>
    </button>
    <div class="login-hint" role="note">
      <strong class="hint-title">이 버튼이 하는 일</strong>
      <ul>
        <li>먼저 <code>codex login status</code>에 해당하는 상태를 확인합니다.</li>
        <li>이미 로그인되어 있으면 브라우저를 열지 않고 자동 모드만 켭니다.</li>
        <li>로그인이 필요하면 공식 로그인 페이지와 확인 코드를 보여 줍니다.</li>
      </ul>
      <p>Codex 앱 설치는 필수가 아닙니다. CLI 로그인이 안 되거나 자동 연결이 막혀도 복붙 모드는 그대로 사용할 수 있습니다.</p>
    </div>

    <!-- 보조 경로: 코드 입력 방식이 막힌 드문 환경을 위한 브라우저 콜백(legacy) 흐름.
         기본(코드 입력) 흐름이 완료되지 못하면 강조해서 보여 준다. -->
    <div class="device-row" class:emphasized={modeStore.defaultLoginUnfinished}>
      <button
        type="button"
        class="device-btn"
        onclick={loginDevice}
        disabled={modeStore.loggingIn}
        aria-busy={modeStore.loggingIn}
      >
        {modeStore.loggingIn ? '진행 중…' : '코드가 안 보이면 · 브라우저 자동 열기 방식으로 다시 시도'}
      </button>
      <span class="device-hint">
        {#if modeStore.defaultLoginUnfinished}
          <strong>코드가 표시되지 않았거나 로그인이 끝나지 않았나요?</strong>
        {/if}
        대부분은 위 [ChatGPT로 로그인]만으로 충분합니다. 코드 입력이 막힌 환경에서만
        이 방식을 쓰세요.
      </span>
    </div>
  </div>

  {#if modeStore.loginMessage}
    <p class="login-status" role="status" data-kind={statusKind}>{modeStore.loginMessage}</p>
  {/if}

  <!-- device-code 코드/URL UI (Slice 8 · AC-LOGIN-CODE-UI): 코드를 크게 표시 +
       복사 버튼 + 주소 열기 버튼 + 로그인 완료 후 [다시 검출] 안내. 표시되는 것은
       비밀이 아닌 verification 코드/URL뿐이며 access token은 표시하지 않는다. -->
  {#if modeStore.loginVerification}
    {@const v = modeStore.loginVerification}
    <div class="login-verify" role="note" aria-label="ChatGPT 로그인 확인 코드">
      <p class="verify-lede">
        브라우저에서 아래 <strong>코드</strong>를 입력해 로그인을 마쳐 주세요.
        {#if v.browser_opened}
          (로그인 페이지를 자동으로 열었습니다. 열리지 않았다면 아래 [주소 열기]를 눌러 주세요.)
        {:else}
          (아래 [주소 열기]를 눌러 로그인 페이지를 여세요.)
        {/if}
      </p>

      {#if v.code}
        <div class="verify-code-row">
          <span class="verify-code-label">확인 코드</span>
          <code class="verify-code-big">{v.code}</code>
          <button type="button" class="verify-action" onclick={copyCode}>
            {codeCopied ? '복사됨 ✓' : '코드 복사'}
          </button>
        </div>
      {/if}

      {#if v.url}
        <div class="verify-url-row">
          <span class="verify-url-label">로그인 주소</span>
          <code class="verify-url">{v.url}</code>
          <button type="button" class="verify-action" onclick={openUrl}>주소 열기</button>
        </div>
      {/if}

      {#if !v.code && !v.url}
        <!-- 드물게 주소·코드를 분리하지 못한 경우: 원문 줄을 그대로 보여 준다. -->
        <p class="verify-raw">화면 안내: <code class="verify-code">{v.raw}</code></p>
      {/if}

      <p class="verify-after">
        로그인을 마친 뒤
        <button type="button" class="link-btn" onclick={() => refreshDetect()} disabled={modeStore.refreshing}>
          {modeStore.refreshing ? '검출 중…' : '다시 검출'}
        </button>
        을 눌러 상태를 새로고침해 주세요.
      </p>
    </div>
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
    <div class="guide" role="note">
      <strong>Codex CLI가 아직 없습니다.</strong>
      <p>
        자동 LLM 모드를 쓰려면 PowerShell에서 아래 순서로 한 번만 설정한 뒤 [다시 검출]을 누르세요.
      </p>
      <ol>
        <li>
          <a href="https://nodejs.org/ko" target="_blank" rel="noreferrer noopener">Node.js LTS</a>
          설치 후 <code>node -v</code>, <code>npm -v</code> 확인
        </li>
        <li><code>npm i -g @openai/codex</code></li>
        <li><code>codex login status</code> 확인 후, 로그인 전이면 <code>codex login</code></li>
      </ol>
      <p>설치하지 않아도 기본 <strong>후보별 복붙 모드</strong>로 정리·검증은 계속할 수 있습니다.</p>
    </div>
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

  /* 검출 자가진단 줄(Slice 10). 작고 차분한 muted 톤. 경로·신호 라벨만. 토큰만 사용. */
  .detect-detail {
    margin: 0;
    font-size: 0.6875rem;
    color: var(--text-secondary);
    line-height: 1.5;
    opacity: 0.85;
    word-break: break-all;
  }
  .detect-detail code {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }
  /* 검출 에러 줄(Slice 10). 텍스트 + 좌측 강세선으로 색에만 의존하지 않는다. */
  .detect-error {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-primary);
    line-height: 1.5;
    padding: var(--space-xs) var(--space-md);
    border-left: 3px solid var(--danger-rust);
    background: var(--surface-sunken);
    border-radius: var(--radius-tight);
  }

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
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    padding: var(--space-sm) var(--space-md);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-tight);
    background: var(--surface-sunken);
    font-size: 0.75rem;
    color: var(--text-secondary);
    line-height: 1.55;
  }
  .hint-title {
    font-family: var(--heading-family);
    font-size: 0.75rem;
    color: var(--text-primary);
  }
  .login-hint ul {
    margin: 0;
    padding-left: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .login-hint p {
    margin: 0;
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
  /* device-code 코드/URL UI (Slice 8). 토큰만 사용. 코드는 크고 또렷하게. */
  .login-verify {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: var(--space-md);
    border: 1px solid var(--accent-oxblood);
    border-radius: var(--radius-soft);
    background: var(--surface-sunken);
  }
  .verify-lede {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-primary);
    line-height: 1.55;
  }
  .verify-code-row,
  .verify-url-row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }
  .verify-code-label,
  .verify-url-label {
    font-family: var(--heading-family);
    font-size: 0.6875rem;
    font-weight: 700;
    color: var(--text-secondary);
  }
  .verify-code-big {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--accent-oxblood);
    background: var(--surface-base);
    padding: var(--space-xs) var(--space-md);
    border-radius: var(--radius-tight);
    border: 1px solid var(--border-subtle);
    user-select: all;
  }
  .verify-url {
    font-size: 0.8125rem;
    word-break: break-all;
    color: var(--text-secondary);
    background: var(--surface-base);
    padding: 1px var(--space-sm);
    border-radius: var(--radius-tight);
  }
  .verify-action {
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--accent-oxblood);
    border-radius: var(--radius-soft);
    background: var(--surface-base);
    color: var(--accent-oxblood);
    font-family: var(--heading-family);
    font-size: 0.75rem;
    font-weight: 700;
    cursor: pointer;
    transition: opacity var(--motion-fast) var(--ease-deliberate);
  }
  .verify-action:hover { opacity: 0.85; }
  .verify-raw {
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
  .verify-after {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.5;
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
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.55;
    padding: var(--space-md);
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--accent-oxblood);
    background: var(--surface-sunken);
    border-radius: var(--radius-tight);
  }
  .guide strong {
    font-family: var(--heading-family);
    color: var(--text-primary);
  }
  .guide p {
    margin: 0;
  }
  .guide ol {
    margin: var(--space-xs) 0;
    padding-left: 1.4rem;
  }
  .guide li + li {
    margin-top: var(--space-xs);
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
