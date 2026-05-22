/**
 * 5-state auth machine — pure function only (Round-1).
 *
 * Authority: agreed_contract.json#design_criteria (AuthStateIndicator five
 * states) + AC-OAUTH-CODEX, AC-OAUTH-DEVFALLBACK.
 *
 * Round-1 stops at the pure function. Round-2 wires the function to Tauri
 * commands (`auth_file_present`, `oauth_child_status`, `dev_fallback_status`)
 * and a Svelte store.
 */

export type AuthState =
  | 'unconfigured'
  | 'codex-detected'
  | 'oauth-child-up'
  | 'degraded'
  | 'dev-fallback-active';

export type OAuthChildStatus = 'idle' | 'spawning' | 'ready' | 'degraded';

export interface DeriveAuthStateInput {
  /** True iff src-tauri/src/external_dep_paths.rs::auth_file_present() returned true. */
  codexAuthPresent: boolean;
  /** Current oauth child status (collapsed to four states). */
  oauthChildStatus: OAuthChildStatus;
  /** True iff fixtures/dev-fallback.flag.enabled is true. */
  devFallbackFlag: boolean;
}

/**
 * Pure precedence resolver:
 *   1. dev-fallback-active     when devFallbackFlag is true
 *   2. unconfigured            when codexAuthPresent is false
 *   3. oauth-child-up          when oauthChildStatus === 'ready'
 *   4. degraded                when oauthChildStatus === 'degraded'
 *   5. codex-detected          otherwise (codex present, child idle/spawning)
 */
export function deriveAuthState(input: DeriveAuthStateInput): AuthState {
  if (input.devFallbackFlag) return 'dev-fallback-active';
  if (!input.codexAuthPresent) return 'unconfigured';
  if (input.oauthChildStatus === 'ready') return 'oauth-child-up';
  if (input.oauthChildStatus === 'degraded') return 'degraded';
  return 'codex-detected';
}
