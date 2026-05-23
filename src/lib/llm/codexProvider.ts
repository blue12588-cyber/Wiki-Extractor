/**
 * Codex OAuth-proxy provider — Slice 5c (AC-OAUTH-PROXY + AC-AUTO-EXTRACT +
 * AC-GRACEFUL + AC-ENCAPSULATE).
 *
 * Authority: agreed_contract.json#AC-OAUTH-PROXY + AC-AUTO-EXTRACT +
 *            AC-GRACEFUL + AC-ENCAPSULATE.
 *
 * The ADVANCED (auto-LLM) provider. It encapsulates the entire openai-oauth /
 * codex / ima2 machinery behind the `ExtractionProvider` interface:
 *
 *   ensureProxy()   → Rust `oauth_proxy_start`: spawns `npx openai-oauth`
 *                     (ima2 oauthLauncher pattern) and waits for the loopback
 *                     ready URL. Idempotent. On failure → Degraded status.
 *   runExtraction() → Rust `llm_extract_wiki`: posts the 5b-built prompt to the
 *                     proxy's loopback /v1 endpoint and returns the RAW model
 *                     reply text. The caller (autoExtract) feeds that text into
 *                     the SAME 5b responseParser + responseValidator + wikiImport
 *                     (chunk_id anti-forgery gate reused unchanged).
 *
 * Network scope: the ONLY outbound path is the loopback proxy (127.0.0.1),
 * routed through the Rust `llm_extract_wiki` command (which itself only targets
 * the loopback endpoint). This module issues no `fetch` of its own.
 *
 * Graceful degradation: every failure (no Tauri shell, proxy not ready, auth
 * unavailable, call failed) returns a `degraded:true` Korean result; the caller
 * falls back to the offline copy-paste bridge. NEVER throws.
 */

import type { ExtractionProvider, ExtractionResult } from './provider';
import { resolveInvoke } from './provider';

interface LlmErr {
  kind?: string;
  reason?: string;
  degraded?: boolean;
}

interface OAuthChildSnapshot {
  state: 'idle' | 'spawning' | 'ready' | 'degraded';
  port?: number;
  url?: string;
  reason?: string;
}

/**
 * Ensure the openai-oauth proxy is up. Returns the resulting status. Idempotent
 * on the Rust side (a Ready proxy is reused). Never throws; on any error it
 * resolves to a `degraded` snapshot so the caller degrades gracefully.
 */
export async function ensureProxy(): Promise<OAuthChildSnapshot> {
  const invoke = resolveInvoke();
  if (!invoke) {
    return { state: 'degraded', reason: 'Tauri 셸 외부(미리보기)에서는 자동 모드를 쓸 수 없습니다.' };
  }
  try {
    return await invoke<OAuthChildSnapshot>('oauth_proxy_start');
  } catch {
    return { state: 'degraded', reason: 'openai-oauth 프록시를 시작하지 못했습니다. 복붙 모드로 전환하세요.' };
  }
}

export const codexProvider: ExtractionProvider = {
  id: 'codex_oauth_proxy',
  label: '자동 LLM 모드 (고급 · codex 인증)',
  mode: 'auto',
  async runExtraction(prompt: string): Promise<ExtractionResult> {
    const invoke = resolveInvoke();
    if (!invoke) {
      return {
        ok: false,
        degraded: true,
        message: 'Tauri 셸 외부(미리보기)에서는 자동 LLM 모드를 쓸 수 없습니다. 복붙 모드를 사용하세요.',
      };
    }

    // 1. Bring up (or reuse) the loopback proxy. If it is not Ready, degrade.
    const proxy = await ensureProxy();
    if (proxy.state !== 'ready') {
      return {
        ok: false,
        degraded: true,
        message:
          proxy.reason ??
          'openai-oauth 프록시가 준비되지 않았습니다(codex 인증/Node 확인). 복붙 모드로 후보를 정리할 수 있습니다.',
      };
    }

    // 2. Send the 5b prompt to the proxy; get back the raw model reply text.
    //    The renderer parses+validates it with the SAME 5b pipeline.
    try {
      const rawText = await invoke<string>('llm_extract_wiki', { args: { prompt } });
      if (typeof rawText !== 'string' || rawText.trim().length === 0) {
        return {
          ok: false,
          degraded: true,
          message: '자동 LLM 응답이 비어 있습니다. 복붙 모드로 다시 시도할 수 있습니다.',
        };
      }
      return { ok: true, rawText };
    } catch (err) {
      const e = err as LlmErr;
      return {
        ok: false,
        degraded: e?.degraded ?? true,
        message:
          e?.reason ??
          '자동 LLM 호출에 실패했습니다(인증/네트워크). 복붙 모드로 후보를 정리하세요(앱은 계속 동작합니다).',
      };
    }
  },
};
