/**
 * Feedback submission — validation, payload shaping, POST, and graceful
 * degradation classification.
 *
 * Authority: agreed_contract.json (Slice 4)#AC-FEEDBACK-FORM +
 *            AC-FEEDBACK-SUBMIT + AC-FEEDBACK-DEGRADE + AC-FEEDBACK-RATE.
 *
 * Design split (so Tier-1 can test the logic without a network):
 *   - validateFeedback / buildPayload  — pure, no I/O.
 *   - classifyFailure                  — pure mapping (offline / 4xx / 5xx /
 *                                        throw) → a Korean user message + a
 *                                        machine `kind`.
 *   - submitFeedback                   — the only impure function; it calls the
 *                                        injected `fetch` so tests can drive it
 *                                        with a stub. On any failure the input
 *                                        is preserved by the caller (this fn
 *                                        never clears the form) and the app
 *                                        stays alive (no throw escapes).
 *
 * All user-facing strings are Korean (AC-KOREAN-UI). Login is NOT required to
 * submit feedback (AC-FEEDBACK-FORM).
 */

export interface FeedbackInput {
  /** Optional subject line. */
  title: string;
  /** Required body. Empty / whitespace-only is rejected before any POST. */
  message: string;
  /** Optional reply-to address. When present it is sent as `email`. */
  email: string;
}

export interface FeedbackPayload {
  message: string;
  title?: string;
  /** Formspree treats `email` / `_replyto` as the reply-to address. */
  email?: string;
  /** Quiet Formspree's own e-mail notification subject when a title is set. */
  _subject?: string;
}

export type FeedbackValidation =
  | { ok: true; value: FeedbackInput }
  | { ok: false; field: 'message'; message: string };

/** AC-FEEDBACK-FORM: content (message) is required; title/email are optional. */
export function validateFeedback(raw: FeedbackInput): FeedbackValidation {
  const message = raw.message.trim();
  if (message.length === 0) {
    return {
      ok: false,
      field: 'message',
      message: '내용을 입력해 주세요. 내용은 필수 항목입니다.',
    };
  }
  return {
    ok: true,
    value: {
      title: raw.title.trim(),
      message,
      email: raw.email.trim(),
    },
  };
}

/** Shape the JSON body. Optional fields are omitted (not sent as empty). */
export function buildPayload(input: FeedbackInput): FeedbackPayload {
  const payload: FeedbackPayload = { message: input.message.trim() };
  const title = input.title.trim();
  const email = input.email.trim();
  if (title.length > 0) {
    payload.title = title;
    payload._subject = `[llmwiki 피드백] ${title}`;
  }
  if (email.length > 0) payload.email = email;
  return payload;
}

export type FailureKind = 'offline' | 'client_4xx' | 'server_5xx' | 'unknown';

export interface SubmitFailure {
  ok: false;
  kind: FailureKind;
  /** Korean, user-facing. The app stays usable; input is preserved by caller. */
  message: string;
  /** Optional HTTP status for diagnostics (absent for offline / throw). */
  status?: number;
}

export interface SubmitSuccess {
  ok: true;
  /** Korean success notice; the caller resets the form after showing this. */
  message: string;
}

export type SubmitResult = SubmitSuccess | SubmitFailure;

/**
 * AC-FEEDBACK-DEGRADE: map a failure cause to a Korean message + kind.
 * `status` undefined ⇒ a thrown error / network unreachable (offline).
 */
export function classifyFailure(status: number | undefined): SubmitFailure {
  if (status === undefined) {
    return {
      ok: false,
      kind: 'offline',
      message:
        '네트워크에 연결할 수 없어 피드백을 전송하지 못했습니다. 입력하신 내용은 그대로 남겨 두었으니, 연결을 확인한 뒤 다시 시도해 주세요.',
    };
  }
  if (status >= 500) {
    return {
      ok: false,
      kind: 'server_5xx',
      message:
        '피드백 서버에 일시적인 오류가 발생했습니다(서버 응답 ' +
        status +
        '). 입력 내용은 보존했습니다. 잠시 후 다시 시도해 주세요.',
      status,
    };
  }
  if (status >= 400) {
    return {
      ok: false,
      kind: 'client_4xx',
      message:
        '피드백을 전송하지 못했습니다(응답 ' +
        status +
        '). 입력 내용은 보존했습니다. 이메일 형식 등을 확인한 뒤 다시 시도해 주세요.',
      status,
    };
  }
  // Any other non-2xx we did not special-case.
  return {
    ok: false,
    kind: 'unknown',
    message:
      '피드백 전송 중 알 수 없는 응답을 받았습니다(응답 ' +
      status +
      '). 입력 내용은 보존했습니다. 다시 시도해 주세요.',
    status,
  };
}

const SUCCESS_MESSAGE = '피드백 전송 완료. 소중한 의견 감사합니다.';

type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{ ok: boolean; status: number }>;

/**
 * AC-FEEDBACK-SUBMIT: POST the JSON payload with `Accept: application/json`.
 * `fetchImpl` is injectable for tests; defaults to the global `fetch`.
 *
 * This function NEVER throws — a thrown network error is caught and mapped to
 * the offline classification, so the app never crashes (AC-FEEDBACK-DEGRADE).
 */
export async function submitFeedback(
  input: FeedbackInput,
  endpoint: string,
  fetchImpl?: FetchLike,
): Promise<SubmitResult> {
  const validation = validateFeedback(input);
  if (!validation.ok) {
    return { ok: false, kind: 'client_4xx', message: validation.message };
  }

  const doFetch: FetchLike =
    fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>);

  const body = JSON.stringify(buildPayload(validation.value));

  let res: { ok: boolean; status: number };
  try {
    res = await doFetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
    });
  } catch {
    // Network unreachable / thrown error → offline degrade. App survives.
    return classifyFailure(undefined);
  }

  if (res.ok) {
    return { ok: true, message: SUCCESS_MESSAGE };
  }
  return classifyFailure(res.status);
}

export { SUCCESS_MESSAGE };
