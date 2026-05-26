<!--
  LoginTab.svelte
  ---------------
  AC-LOGIN-TAB: the auth surface — the live auth-state store + AuthStateIndicator
  + the persistent DisclosureBanner (both Korean-ized for Slice 4).

  This tab does NOT itself perform a login; sign-in is the openai-oauth child
  flow wired in slice 2. The tab surfaces the current auth state and the legal/
  security disclosure the user must read before LLM features run. Feedback
  (the next tab) is intentionally usable WITHOUT any of this (AC-FEEDBACK-FORM).

  All copy is Korean (AC-KOREAN-UI).
-->
<script lang="ts">
  import AuthStateIndicator from '$lib/components/AuthStateIndicator.svelte';
  import DisclosureBanner from '$lib/components/DisclosureBanner.svelte';
  import ModeToggle from '$lib/components/ModeToggle.svelte';
  import { authSnapshot } from '$lib/auth/store';

  // Banner stays mounted while auth features are reachable on this machine.
  let auth_reachable = $state(true);

  let authDetail = $derived($authSnapshot.oauthChild.reason ?? null);
  let proxyRetrying = $state(false);
  let proxyRetryMessage = $state<string | null>(null);

  type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  type OAuthChildSnapshot = {
    state: 'idle' | 'spawning' | 'ready' | 'degraded';
    port?: number;
    url?: string;
    reason?: string;
  };

  function resolveInvoke(): Invoke | null {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as { __TAURI__?: { core?: { invoke?: Invoke } } };
    return typeof w.__TAURI__?.core?.invoke === 'function' ? w.__TAURI__.core.invoke : null;
  }

  async function retryProxy() {
    const invoke = resolveInvoke();
    if (!invoke) {
      proxyRetryMessage = '설치된 앱 밖에서는 자동 연결을 재시도할 수 없습니다.';
      return;
    }
    proxyRetrying = true;
    proxyRetryMessage = '자동 LLM 연결을 다시 준비하는 중입니다. 첫 실행은 다운로드 때문에 시간이 걸릴 수 있습니다.';
    try {
      const snap = await invoke<OAuthChildSnapshot>('oauth_proxy_start');
      proxyRetryMessage =
        snap.state === 'ready'
          ? `자동 LLM 연결이 준비되었습니다(${snap.url ?? '로컬 연결'}).`
          : snap.reason ?? '자동 LLM 연결이 아직 준비되지 않았습니다.';
    } catch (err) {
      proxyRetryMessage = `자동 연결 재시도 실패: ${(err as Error).message}`;
    } finally {
      proxyRetrying = false;
    }
  }
</script>

<section class="block">
  <h2 class="section-title">로그인 · 인증 상태</h2>
  <p class="section-lede">
    이 앱은 기본적으로 <strong>복붙 모드</strong>(ChatGPT 직접 호출 없음)로 동작하며,
    누구나 인증 없이 위키 후보를 정리할 수 있습니다. codex CLI를 직접 설치·로그인한
    고급 사용자는 아래에서 <strong>자동 LLM 모드</strong>를 켜서 추출을 자동화할 수
    있습니다. 법적·보안 고지를 반드시 읽어 주세요. (피드백 보내기는 로그인 없이도
    사용할 수 있습니다.)
  </p>

  <div class="login-summary" role="note" aria-label="자동 모드 인증 요약">
    <section>
      <span class="summary-kicker">기본</span>
      <strong>설치 없이 복붙 모드</strong>
      <p>Codex가 없어도 원서 넣기, 후보 추출, 위키 검토·저장은 계속 됩니다.</p>
    </section>
    <section>
      <span class="summary-kicker">선택</span>
      <strong>자동 모드는 Codex 필요</strong>
      <p>Codex CLI 설치는 사용자가 직접 합니다. 앱은 자동 설치하지 않습니다.</p>
    </section>
    <section>
      <span class="summary-kicker">보안</span>
      <strong>각자 자기 계정으로 로그인</strong>
      <p>앱은 아이디·비밀번호를 받지 않고, 인증 파일을 만들거나 배포하지 않습니다.</p>
    </section>
  </div>

  <div class="state-row">
    <span class="state-label">현재 인증 상태</span>
    <AuthStateIndicator state={$authSnapshot.state} detail={authDetail} />
  </div>
  {#if $authSnapshot.state === 'degraded'}
    <p class="proxy-help" role="status">
      자동 모드 계정은 감지됐지만 로컬 자동 LLM 연결이 준비되지 않았습니다.
      {#if authDetail}<span>현재 원인: {authDetail}</span>{/if}
      <span>해결: [자동 연결 재시도] → [다시 검출] → [ChatGPT로 로그인] 재시도 → Node.js/npx 설치 확인 → 앱 재시작 순서로 확인하세요.</span>
      <button type="button" class="proxy-retry" onclick={retryProxy} disabled={proxyRetrying}>
        {proxyRetrying ? '자동 연결 재시도 중…' : '자동 연결 재시도'}
      </button>
      {#if proxyRetryMessage}
        <span>{proxyRetryMessage}</span>
      {/if}
    </p>
  {/if}

  <ModeToggle />

  <DisclosureBanner {auth_reachable} />
</section>

<style>
  .block {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
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

  .login-summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: var(--space-sm);
    padding: var(--space-md);
    border: 1px solid var(--border-subtle);
    border-left: 3px solid var(--accent-oxblood);
    border-radius: var(--radius-asymmetric);
    background: var(--surface-elevated);
  }

  .login-summary section {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    min-width: 0;
  }

  .summary-kicker {
    font-family: var(--heading-family);
    font-size: 0.6875rem;
    font-weight: 700;
    color: var(--text-secondary);
  }

  .login-summary strong {
    font-family: var(--heading-family);
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .login-summary p {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .state-row {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    flex-wrap: wrap;
    margin: var(--space-sm) 0 var(--space-lg) 0;
  }

  .state-label {
    font-family: var(--heading-family);
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .proxy-help {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
    margin: calc(-1 * var(--space-md)) 0 var(--space-md) 0;
    padding: var(--space-sm) var(--space-md);
    border-left: 3px solid var(--warn-amber);
    border-radius: var(--radius-tight);
    background: var(--surface-sunken);
    color: var(--text-primary);
    font-size: 0.8125rem;
    line-height: 1.5;
  }

  .proxy-retry {
    align-self: flex-start;
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--warn-amber);
    border-radius: var(--radius-soft);
    background: var(--surface-elevated);
    color: var(--text-primary);
    font-family: var(--heading-family);
    font-size: 0.75rem;
    font-weight: 700;
    cursor: pointer;
  }

  .proxy-retry:disabled {
    opacity: 0.6;
    cursor: progress;
  }
</style>
