/**
 * Extraction provider abstraction — Slice 5c (AC-AUTH-ABSTRACT + AC-ENCAPSULATE).
 *
 * Authority: agreed_contract.json#AC-AUTH-ABSTRACT + AC-CODEX-DETECT +
 *            AC-GRACEFUL + AC-ENCAPSULATE.
 *
 * ONE interface, THREE providers, each behind it:
 *
 *   1. offline            — copy-paste (Slice 5b). The DEFAULT and the
 *                           common-person path. ALWAYS available, ZERO network.
 *                           The user pastes ChatGPT's reply manually; this
 *                           provider's `runExtraction` is intentionally a no-op
 *                           (the manual paste IS the extraction).
 *   2. codex_oauth_proxy  — auto-LLM (advanced). Available only when codex auth
 *                           is detected. Spawns the openai-oauth proxy and calls
 *                           the LLM automatically, returning the SAME raw JSON
 *                           text the user would have pasted. EVERYTHING
 *                           downstream (parse → validate → import) is the SAME
 *                           5b pipeline (AC-EVIDENCE-REUSE).
 *   3. future             — API-key etc. PLACEHOLDER only (never available;
 *                           selecting it degrades). Reserved so adding a real
 *                           key mode later is a provider drop-in, not a rewrite
 *                           (contract: contract_refresh_required_when API key
 *                           mode is actually implemented).
 *
 * Encapsulation: the openai-oauth / codex / ima2 details live ENTIRELY behind
 * this interface (in codexProvider.ts + the Rust commands). The rest of the app
 * (BridgePanel, pipeline actions) talks only to `ExtractionProvider` +
 * `ProviderId`, so swapping/removing the codex path is a localized change.
 *
 * Graceful degradation is the contract of the interface itself: `runExtraction`
 * NEVER throws and NEVER returns importable data on failure — it returns a
 * `degraded` result with a Korean message, and the caller falls back to the
 * offline copy-paste UI (AC-GRACEFUL). The app never dies on a failed call.
 */

/** The three provider identities. `offline` is the default. */
export type ProviderId = 'offline' | 'codex_oauth_proxy' | 'future';

/** Runtime availability snapshot for one provider. */
export interface ProviderAvailability {
  id: ProviderId;
  /** Human Korean label for the login tab. */
  label: string;
  /** True iff this provider can run an extraction right now. */
  available: boolean;
  /** Korean reason shown when not available (install guidance / degradation). */
  reason: string | null;
}

/**
 * The result of an AUTO extraction attempt. On success `rawText` is the model's
 * reply text — fed UNCHANGED into the 5b responseParser + responseValidator, so
 * the chunk_id anti-forgery gate binds the auto response exactly like a manual
 * paste. On any failure `degraded` is true and `message` is a Korean string; the
 * caller then falls back to the copy-paste bridge.
 */
export type ExtractionResult =
  | { ok: true; rawText: string }
  | { ok: false; degraded: boolean; message: string };

/**
 * The provider contract. `mode === 'manual'` means the user drives the round
 * trip themselves (offline copy-paste); `mode === 'auto'` means `runExtraction`
 * produces the raw reply text automatically.
 */
export interface ExtractionProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly mode: 'manual' | 'auto';
  /**
   * For auto providers: send the (5b-built) prompt and return the raw model
   * reply text. For manual providers this returns a `degraded` result that
   * tells the caller to use the copy-paste UI — it NEVER performs a network
   * call. Implementations must NOT throw.
   */
  runExtraction(prompt: string): Promise<ExtractionResult>;
}

/** Tauri invoke resolver (null outside the Tauri shell → providers degrade). */
type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
export function resolveInvoke(): Invoke | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { __TAURI__?: { core?: { invoke?: Invoke } } };
  const fn = w.__TAURI__?.core?.invoke;
  return typeof fn === 'function' ? fn : null;
}

/** Shape of the Rust `codex_detect` command. */
export interface CodexDetectSnapshot {
  available: boolean;
  auth_file_present: boolean;
  login_probe: 'authed' | 'unauthed' | 'missing';
  codex_cli_missing: boolean;
}

/**
 * Read the codex detection snapshot (READ-ONLY). Outside Tauri (Vite preview)
 * returns an unavailable snapshot so the offline provider is the only one — the
 * safe default. Never throws.
 */
export async function detectCodex(): Promise<CodexDetectSnapshot> {
  const invoke = resolveInvoke();
  if (!invoke) {
    return { available: false, auth_file_present: false, login_probe: 'missing', codex_cli_missing: true };
  }
  try {
    return await invoke<CodexDetectSnapshot>('codex_detect');
  } catch {
    return { available: false, auth_file_present: false, login_probe: 'missing', codex_cli_missing: true };
  }
}

/**
 * Compute the availability list for all three providers from a codex snapshot.
 * Pure (given the snapshot) → deterministic. `offline` is ALWAYS available;
 * `codex_oauth_proxy` follows the snapshot; `future` is a never-available
 * placeholder. The default selection is ALWAYS `offline` (common-person), even
 * when codex is available — auto mode is an explicit opt-in toggle.
 */
export function providerAvailabilities(detect: CodexDetectSnapshot): ProviderAvailability[] {
  const codexReason = detect.available
    ? null
    : detect.codex_cli_missing
      ? 'codex CLI가 설치되어 있지 않습니다. 자동 LLM 모드는 고급 사용자용입니다. 설치하지 않아도 복붙 모드로 모든 기능을 쓸 수 있습니다.'
      : 'codex 로그인이 확인되지 않았습니다(codex login). 로그인하면 자동 모드를 쓸 수 있고, 안 해도 복붙 모드로 동작합니다.';

  return [
    {
      id: 'offline',
      label: '복붙 모드 (기본 · 누구나)',
      available: true,
      reason: null,
    },
    {
      id: 'codex_oauth_proxy',
      label: '자동 LLM 모드 (고급 · codex 인증)',
      available: detect.available,
      reason: codexReason,
    },
    {
      id: 'future',
      label: 'API 키 모드 (준비 중)',
      available: false,
      reason: '향후 지원 예정입니다. 현재는 복붙 모드와 자동 LLM 모드만 사용할 수 있습니다.',
    },
  ];
}
