/**
 * Provider-mode store — Slice 5c (AC-AUTH-ABSTRACT + AC-LOGIN-TAB-5c +
 * AC-GRACEFUL).
 *
 * Authority: agreed_contract.json#AC-AUTH-ABSTRACT + AC-LOGIN-TAB-5c +
 *            AC-GRACEFUL.
 *
 * The single, app-wide source of truth for:
 *   - the codex detection snapshot (read-only),
 *   - the per-provider availability list,
 *   - the user's SELECTED provider (the auto/copy-paste toggle).
 *
 * Default selection is ALWAYS `offline` (copy-paste) — the common-person path —
 * even when codex is available. Auto mode is an explicit opt-in (constraints:
 * "codex 강요 0", "기본 모드 = offline 복붙"). If the user has auto selected but
 * codex later becomes unavailable, `effectiveProviderId()` collapses back to
 * `offline` so the UI degrades gracefully without the user having to re-toggle.
 *
 * Uses a Svelte 5 rune `$state` object so views react to changes.
 */

import {
  detectCodex,
  providerAvailabilities,
  startCodexLogin,
  type CodexDetectSnapshot,
  type CodexLoginOutcome,
  type ProviderAvailability,
  type ProviderId,
} from './provider';

const INITIAL_DETECT: CodexDetectSnapshot = {
  available: false,
  auth_file_present: false,
  login_probe: 'missing',
  codex_cli_missing: true,
};

interface ModeState {
  detect: CodexDetectSnapshot;
  availabilities: ProviderAvailability[];
  /** What the user picked. Default offline (common-person). */
  selected: ProviderId;
  /** True while a detect refresh is in flight. */
  refreshing: boolean;
  /** True while a `codex login` spawn is in flight (Slice 6 — button busy). */
  loggingIn: boolean;
  /**
   * Korean status line from the last login button press (Slice 6). null when no
   * login has been attempted this session. Shown beneath the login button so the
   * user always gets a friendly, color-independent message (AC-CODEX-LOGIN-BTN /
   * AC-KOREAN-UI). Never holds any token/secret — only guidance text.
   */
  loginMessage: string | null;
  /**
   * A device-code verification URL/line, when codex emits one (`--device-auth`
   * or a build that prints a code). Shown so the user can complete the flow in
   * the browser. null otherwise. Non-secret (the auth token is written by codex
   * into auth.json, never surfaced here).
   */
  loginVerification: string | null;
  /**
   * Polarity of the last login outcome, for the status rail's visual accent
   * (Slice 6 repair #3). 'success' iff codex is now authed; 'attention' for any
   * non-success outcome (not_authed/pending/cli_missing/failed) that still needs
   * a user action; null before any attempt. The Korean text already disambiguates
   * — this only keeps the accent COLOR from contradicting the message (color +
   * text dual-coded; never color-only).
   */
  loginOutcomeKind: 'success' | 'attention' | null;
  /**
   * True once a default (browser-callback) login attempt has finished WITHOUT
   * reaching `authed` this session (Slice 6 repair #2). The device-code fallback
   * affordance is emphasized when this is set — it is the exact case device-auth
   * exists for (browser cannot open / locked-down environment). The fallback is
   * still reachable before any attempt too, just less prominent.
   */
  defaultLoginUnfinished: boolean;
}

export const modeStore = $state<ModeState>({
  detect: INITIAL_DETECT,
  availabilities: providerAvailabilities(INITIAL_DETECT),
  selected: 'offline',
  refreshing: false,
  loggingIn: false,
  loginMessage: null,
  loginVerification: null,
  loginOutcomeKind: null,
  defaultLoginUnfinished: false,
});

/** Re-run codex detection (read-only) and refresh the availability list. */
export async function refreshDetect(): Promise<void> {
  modeStore.refreshing = true;
  try {
    const detect = await detectCodex();
    applyDetect(detect);
    // If the user had auto selected but it is no longer available, do NOT force
    // them off it in the store (so the toggle still shows their intent), but
    // `effectiveProviderId()` will collapse to offline at use time.
  } finally {
    modeStore.refreshing = false;
  }
}

/** Apply a detect snapshot to the store (shared by refresh + login). */
function applyDetect(detect: CodexDetectSnapshot): void {
  modeStore.detect = detect;
  modeStore.availabilities = providerAvailabilities(detect);
}

/**
 * Press the ChatGPT-login button (Slice 6 — AC-CODEX-LOGIN-BTN +
 * AC-LOGIN-STATE-REFRESH). Spawns `codex login` (browser OAuth via the Rust
 * command), then refreshes the auth state from the outcome:
 *
 *   - `authed`     → apply the carried detect snapshot (now available) so the
 *                    login tab flips unauthed→authed and the auto-mode radio
 *                    becomes selectable. We do NOT auto-select auto mode (the
 *                    user opts in) — only the AVAILABILITY changes.
 *   - `not_authed` → apply the carried snapshot (still unavailable) + message.
 *   - `pending`    → keep current state; show the device-code/URL + a "다시 검출"
 *                    hint. A read-only refresh is run so a meanwhile-completed
 *                    flow is still picked up.
 *   - `cli_missing`/`failed` → message only; copy-paste stays the default.
 *
 * The app NEVER writes the auth file — codex does. This action only spawns +
 * re-reads. Never throws; always leaves a Korean `loginMessage`.
 */
export async function loginWithChatGPT(deviceAuth = false): Promise<CodexLoginOutcome> {
  modeStore.loggingIn = true;
  modeStore.loginVerification = null;
  try {
    const outcome = await startCodexLogin(deviceAuth);
    switch (outcome.state) {
      case 'authed':
        applyDetect(outcome.detect);
        modeStore.loginMessage =
          'ChatGPT 로그인이 확인되었습니다. 이제 [추출 모드]에서 자동 LLM 모드를 켤 수 있습니다. (원하지 않으면 복붙 모드를 그대로 쓰셔도 됩니다.)';
        modeStore.loginOutcomeKind = 'success';
        // Login finished successfully — the device-code fallback no longer needs
        // emphasis (and applyDetect already flipped availability).
        modeStore.defaultLoginUnfinished = false;
        break;
      case 'not_authed':
        applyDetect(outcome.detect);
        modeStore.loginMessage = outcome.message;
        modeStore.loginOutcomeKind = 'attention';
        break;
      case 'pending':
        modeStore.loginMessage = outcome.message;
        modeStore.loginVerification = outcome.verification;
        modeStore.loginOutcomeKind = 'attention';
        // A meanwhile-completed flow may already have written auth.json; pick it
        // up with a read-only re-detect (does not block on the codex child).
        await refreshDetect();
        break;
      case 'cli_missing':
      case 'failed':
        modeStore.loginMessage = outcome.message;
        modeStore.loginOutcomeKind = 'attention';
        break;
    }
    // Repair #2: a DEFAULT (browser-callback) attempt that did not reach `authed`
    // marks the device-code fallback as the recommended next step — this is the
    // browser-cannot-open / firewalled case device-auth exists for. A device-auth
    // attempt itself does not (re)arm this flag.
    if (!deviceAuth) {
      modeStore.defaultLoginUnfinished = outcome.state !== 'authed';
    }
    return outcome;
  } finally {
    modeStore.loggingIn = false;
  }
}

/** Select a provider (the toggle). Selecting an unavailable provider is allowed
 *  in the store; the effective resolver guards actual use. */
export function selectProvider(id: ProviderId): void {
  modeStore.selected = id;
}

/**
 * The provider that will ACTUALLY run, given availability. Collapses an
 * unavailable selection back to `offline` so the app always has a working path
 * (AC-GRACEFUL): if the user chose auto but codex is gone, the effective mode is
 * copy-paste.
 */
export function effectiveProviderId(): ProviderId {
  if (modeStore.selected === 'offline') return 'offline';
  const avail = modeStore.availabilities.find((a) => a.id === modeStore.selected);
  return avail?.available ? modeStore.selected : 'offline';
}

/** True iff the effective mode is the auto-LLM provider. */
export function autoModeActive(): boolean {
  return effectiveProviderId() === 'codex_oauth_proxy';
}
