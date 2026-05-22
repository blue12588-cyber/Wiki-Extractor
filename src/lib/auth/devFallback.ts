/**
 * dev-fallback flag reader — Tauri command wrapper (Round-1 scaffold).
 *
 * Calls into the Rust-side `dev_fallback_status` command. In Round-1 the
 * Tauri-invoke wiring is stubbed: when the renderer is run inside Tauri the
 * command is invoked; when run as a plain Vite preview (npm run dev or
 * preview, without the Tauri shell) we fall back to `false` so the UI still
 * mounts cleanly.
 *
 * Round-2 will:
 *   - Expose a Svelte store that polls the flag at app start + on focus.
 *   - Wire the value into `deriveAuthState` from ./state.ts together with
 *     `auth_file_present` and `oauth_child_status`.
 */

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

interface MaybeTauriWindow extends Window {
  __TAURI__?: {
    core?: {
      invoke?: InvokeFn;
    };
  };
}

/**
 * Resolve the Tauri `invoke` function at call time so the module can be
 * imported in non-Tauri previews without crashing the SvelteKit prerender.
 */
function resolveInvoke(): InvokeFn | null {
  if (typeof window === 'undefined') return null;
  const w = window as MaybeTauriWindow;
  const fn = w.__TAURI__?.core?.invoke;
  return typeof fn === 'function' ? fn : null;
}

export async function fetchDevFallbackStatus(): Promise<boolean> {
  const invoke = resolveInvoke();
  if (!invoke) return false;
  try {
    return await invoke<boolean>('dev_fallback_status');
  } catch {
    // Treat any IPC error as "fallback disabled" — Round-2 will surface this
    // as a degraded state instead of silently swallowing.
    return false;
  }
}

export async function fetchAuthFilePresent(): Promise<boolean> {
  const invoke = resolveInvoke();
  if (!invoke) return false;
  try {
    return await invoke<boolean>('auth_file_present');
  } catch {
    return false;
  }
}
