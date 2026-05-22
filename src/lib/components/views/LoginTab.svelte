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
  import { authState } from '$lib/auth/store';

  // Banner stays mounted while auth features are reachable on this machine.
  let auth_reachable = $state(true);
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

  <div class="state-row">
    <span class="state-label">현재 인증 상태</span>
    <AuthStateIndicator state={$authState} />
  </div>

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
</style>
