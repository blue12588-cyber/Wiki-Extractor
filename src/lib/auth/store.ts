/**
 * Auth store — derives the 5-state UI value from the three Tauri-fed inputs.
 *
 * Authority: agreed_contract.json#design_criteria (AuthStateIndicator five
 * states) + AC-OAUTH-CODEX + AC-OAUTH-DEVFALLBACK.
 *
 * The store polls (rather than subscribes to Tauri events) for Slice 2 — a
 * 2-second interval is sufficient for the desktop UI, and avoids the extra
 * complexity of registering Rust→JS event channels for what is fundamentally
 * a read-only snapshot.
 *
 * In SvelteKit prerender / Vite preview (no Tauri), the polls fall back to
 * `false` / `idle` and `deriveAuthState` produces `unconfigured`, which is
 * the safe default for the non-Tauri context.
 */

import { derived, readable, type Readable } from 'svelte/store';
import { deriveAuthState, type AuthState, type OAuthChildStatus } from './state';
import { fetchAuthFilePresent, fetchDevFallbackStatus } from './devFallback';

interface OAuthChildSnapshot {
  state: 'idle' | 'spawning' | 'ready' | 'degraded';
  port?: number;
  url?: string;
  reason?: string;
}

export interface AuthUiSnapshot {
  state: AuthState;
  codexAuthPresent: boolean;
  devFallbackFlag: boolean;
  oauthChild: OAuthChildSnapshot;
}

function resolveInvoke(): (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> } };
  };
  const fn = w.__TAURI__?.core?.invoke;
  return typeof fn === 'function' ? fn : null;
}

async function fetchOAuthChildSnapshot(): Promise<OAuthChildSnapshot> {
  const invoke = resolveInvoke();
  if (!invoke) return { state: 'idle' };
  try {
    return await invoke<OAuthChildSnapshot>('oauth_child_status');
  } catch {
    return { state: 'idle' };
  }
}

function toOauthChildStatus(snap: OAuthChildSnapshot): OAuthChildStatus {
  return snap.state;
}

const POLL_MS = 2000;

export const authSnapshot: Readable<AuthUiSnapshot> = readable<AuthUiSnapshot>({
  state: 'unconfigured',
  codexAuthPresent: false,
  devFallbackFlag: false,
  oauthChild: { state: 'idle' },
}, (set) => {
  let cancelled = false;
  async function tick() {
    if (cancelled) return;
    const [codexAuthPresent, devFallbackFlag, oauthChild] = await Promise.all([
      fetchAuthFilePresent(),
      fetchDevFallbackStatus(),
      fetchOAuthChildSnapshot(),
    ]);
    if (cancelled) return;
    const oauthChildStatus = toOauthChildStatus(oauthChild);
    set({
      state: deriveAuthState({ codexAuthPresent, devFallbackFlag, oauthChildStatus }),
      codexAuthPresent,
      devFallbackFlag,
      oauthChild,
    });
  }
  tick();
  const id = setInterval(tick, POLL_MS);
  return () => {
    cancelled = true;
    clearInterval(id);
  };
});

export const authState: Readable<AuthState> = derived(authSnapshot, ($snapshot) => $snapshot.state);

export async function snapshotAuthState(): Promise<AuthState> {
  const [codexAuthPresent, devFallbackFlag, oauthChild] = await Promise.all([
    fetchAuthFilePresent(),
    fetchDevFallbackStatus(),
    fetchOAuthChildSnapshot(),
  ]);
  const oauthChildStatus = toOauthChildStatus(oauthChild);
  return deriveAuthState({ codexAuthPresent, devFallbackFlag, oauthChildStatus });
}
