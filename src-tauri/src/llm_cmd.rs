//! llm_cmd — LLM extraction / classification / translation wiring.
//!
//! Authority: agreed_contract.json#AC-LLM-EXTRACT + AC-CLASSIFY-MAP + AC-TRANSLATE.
//! Ported role logic from (recorded in docs/adaptation-from-harness-core.md):
//!   - harness-core/domains/academic/source-extractor.md   -> EXTRACT_SYSTEM_PROMPT
//!   - harness-core/domains/academic/candidate-evaluator.md -> CLASSIFY_SYSTEM_PROMPT
//!   - harness-core/domains/academic/writing-guidance.md    -> TRANSLATE_SYSTEM_PROMPT
//!     (Catholic terminology default; original-text preservation).
//!
//! # Design boundaries (contract-mandated)
//!
//! 1. **Logic wiring only.** The OAuth subscription flow (OpenClaude/Hermes
//!    pattern via the openai-oauth child's loopback `http://127.0.0.1:<port>/v1`
//!    endpoint) is wired but its real operability is NOT guaranteed. If auth or
//!    the call fails, we return a structured error and the caller degrades.
//!
//! 2. **Graceful degradation (AC-OFFLINE).** Every command returns
//!    `Result<.., LlmError>`. On any failure the renderer keeps view/edit/save
//!    fully working; only extraction/classification/translation are blocked,
//!    with a clear Korean message. The app never crashes on auth/call failure.
//!
//! 3. **Model id is config (single source).** `src-tauri/llm.config.json`
//!    holds the model id (gpt-5.4, a user-specified value) + endpoint template.
//!    Swapping models is a config edit — the abstraction layer is the
//!    `LlmConfig` struct + `resolve_base_url()` indirection.
//!
//! 4. **Network scope.** The ONLY outbound target is the loopback OAuth/LLM
//!    endpoint resolved from the openai-oauth child status. No other host is
//!    contacted. No telemetry.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::oauth_child::{oauth_child_status, ChildStatus};

#[derive(Debug, Serialize)]
pub struct LlmError {
    pub kind: String,
    pub reason: String,
    /// True when the failure is an auth/connectivity degradation (NOT a bug):
    /// the renderer shows the degradation banner and keeps view/edit/save live.
    pub degraded: bool,
}

impl LlmError {
    fn degraded(kind: &str, reason: impl Into<String>) -> Self {
        Self { kind: kind.into(), reason: reason.into(), degraded: true }
    }
    fn hard(kind: &str, reason: impl Into<String>) -> Self {
        Self { kind: kind.into(), reason: reason.into(), degraded: false }
    }
}

/* ---------------- Config (single source of truth) ---------------- */

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LlmRequestCfg {
    #[serde(default)]
    pub temperature: f32,
    #[serde(default = "default_max_tokens")]
    pub max_output_tokens: u32,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
}

fn default_max_tokens() -> u32 {
    4096
}
fn default_timeout() -> u64 {
    60000
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LlmConfig {
    pub model: String,
    pub endpoint_template: String,
    #[serde(default)]
    pub auth: String,
    #[serde(default = "default_request_cfg")]
    pub request: LlmRequestCfg,
}

fn default_request_cfg() -> LlmRequestCfg {
    LlmRequestCfg { temperature: 0.0, max_output_tokens: default_max_tokens(), timeout_ms: default_timeout() }
}

fn config_path() -> PathBuf {
    // The config sits next to Cargo.toml in src-tauri/. In dev the host cwd is
    // the project root; in a packaged build it is bundled as a resource. We try
    // a couple of relative locations rather than any OS-user dir.
    let cwd = std::env::current_dir().unwrap_or_default();
    let candidates = [
        cwd.join("src-tauri").join("llm.config.json"),
        cwd.join("llm.config.json"),
    ];
    for c in candidates.iter() {
        if c.is_file() {
            return c.clone();
        }
    }
    // Fall back to the first candidate path (read will then fail -> default cfg).
    cwd.join("src-tauri").join("llm.config.json")
}

fn load_config() -> LlmConfig {
    let path = config_path();
    if let Ok(txt) = std::fs::read_to_string(&path) {
        if let Ok(cfg) = serde_json::from_str::<LlmConfig>(&txt) {
            return cfg;
        }
    }
    // Hard-coded fallback mirrors llm.config.json so a missing file still yields
    // a coherent (degraded) config rather than a crash.
    LlmConfig {
        model: "gpt-5.4".to_string(),
        endpoint_template: "{base}/responses".to_string(),
        auth: "oauth_subscription".to_string(),
        request: default_request_cfg(),
    }
}

/// Renderer-facing config snapshot (so the UI can show the active model + auth
/// mode and whether the LLM path is currently reachable).
#[derive(Debug, Serialize)]
pub struct LlmConfigSnapshot {
    pub model: String,
    pub auth: String,
    pub endpoint_base: Option<String>,
    pub reachable: bool,
}

/// Resolve the loopback base URL from the openai-oauth child status. Returns
/// None when the child is not Ready (degradation path).
fn resolve_base_url() -> Option<String> {
    match oauth_child_status() {
        ChildStatus::Ready { url, .. } => Some(url),
        _ => None,
    }
}

#[tauri::command]
pub fn llm_config() -> LlmConfigSnapshot {
    let cfg = load_config();
    let base = resolve_base_url();
    LlmConfigSnapshot {
        model: cfg.model,
        auth: cfg.auth,
        reachable: base.is_some(),
        endpoint_base: base,
    }
}

/* ---------------- Role prompts (ported from harness-core) ---------------- */

/// Ported from domains/academic/source-extractor.md — the 7 extraction units
/// and the "reusable knowledge candidate" framing. Output is constrained to
/// JSON so the renderer can validate against shared/schemas/candidate_item.
const EXTRACT_SYSTEM_PROMPT: &str = r#"You extract reusable knowledge candidates from one normalized source chunk.
Do NOT summarize the whole source as one document. Prefer reusable knowledge units over summary.
Use one of these candidate types: concept, argument, method, scholar, religious_text, objection, quotation, other.
Use one of these suggested actions: augment_existing, create_new, merge, defer, reject.
Every candidate MUST include at least one evidence reference (chunk id / page / location) drawn from the provided chunk metadata; do NOT invent page numbers or bibliographic facts.
Preserve original-language terms (Hebrew, Greek, Latin) and the source's exact wording in evidence_text.
Candidate quality test: can this item be reused later without rereading the source chunk? If not, omit it.
Return ONLY a JSON object: {"candidate_items":[{"local_candidate_id","title","type","category","summary","evidence_refs":[...],"suggested_action","evidence_text"}]}.
Keep summaries concise; do not include long source quotations."#;

/// Ported from domains/academic/candidate-evaluator.md — classify each
/// candidate to a user outline node + recommend action.
const CLASSIFY_SYSTEM_PROMPT: &str = r#"You map extracted knowledge candidates onto the user's table-of-contents (outline) nodes.
For each candidate, choose the single best-fitting outline node id, or null if none fits.
Recommend an action: augment_existing, create_new, merge, defer, or reject, with a one-line rationale.
Assess standalone reuse value, evidence quality, duplication risk, and relevance to the outline node.
Do NOT invent outline nodes; only use the provided node ids.
Return ONLY JSON: {"mappings":[{"local_candidate_id","outline_node_id":string|null,"recommended_action","rationale"}]}."#;

/// Ported from domains/academic/writing-guidance.md — Catholic terminology
/// default, Protestant terms forbidden, ORIGINAL TEXT PRESERVED (translation is
/// a separate field, never overwrites the source).
const TRANSLATE_SYSTEM_PROMPT: &str = r#"You translate source passages into Korean for a Catholic academic wiki.
MANDATORY terminology policy (Catholic standard; Protestant terms are FORBIDDEN):
- Use Catholic Korean biblical book names: 판관기 (Judges), 마르코 복음 (Mark), 마태오 복음 (Matthew), 탈출기 (Exodus), 창세기 (Genesis), 시편 (Psalms), 이사야서 (Isaiah).
- 의화 (justification, NOT 칭의), 은총 (grace, NOT 은혜), 성령 (Holy Spirit), 성체 (Eucharist), 미사 (Mass).
- Follow the Catholic Church's official Korean theological vocabulary.
NEVER alter, paraphrase, or replace the ORIGINAL text — it is preserved verbatim by the caller. You ONLY produce the Korean translation as a separate string.
Preserve original-language terms (Hebrew/Greek/Latin) inline with transliteration + meaning where helpful.
Return ONLY JSON: {"translation": "<Korean translation>"}."#;

/* ---------------- Responses API plumbing (openai-oauth proxy) ----------------

The openai-oauth proxy (EvanZhouDev) exposes ONLY the OpenAI **Responses API** at
`<base>/responses` — NOT Chat Completions. Verified against ima2-gen's working
client (`lib/oauthProxy.js::generateViaOAuth` → POST `${url}/v1/responses` with an
`input:[{role,content}]` body). Posting Chat Completions (`/chat/completions` with
`messages`) to it failed at the transport layer ("error sending request"). We
therefore speak Responses. Recorded in docs/adaptation-from-harness-core.md. */

#[derive(Serialize)]
struct InputMsg<'a> {
    role: &'a str,
    content: String,
}

#[derive(Serialize)]
struct ReasoningCfg<'a> {
    effort: &'a str,
}

#[derive(Serialize)]
struct ResponsesRequest<'a> {
    model: &'a str,
    /// The system prompt MUST go in `instructions`, not a developer/system message.
    /// The openai-oauth proxy forwards to the Codex coding-agent backend and, when
    /// `instructions` is absent, INJECTS codex's default coding-agent instructions
    /// (`normalizeCodexResponsesBody` → `getDefaultCodexInstructions()`), which made
    /// the model ignore our extraction request and return an EMPTY `output[]`.
    /// Supplying our own `instructions` overrides that default.
    instructions: String,
    input: Vec<InputMsg<'a>>,
    stream: bool,
    reasoning: ReasoningCfg<'a>,
    // NOTE: no `max_output_tokens` — the proxy deletes it (`delete normalized.max_output_tokens`).
}

// Responses output: an array of items; assistant text lives in `message` items as
// `content[].text` where the content part type is `output_text`. Reasoning items
// carry no plaintext. Some proxy/SDK shapes also expose a flattened `output_text`.
#[derive(Deserialize)]
struct RespContentPart {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: Option<String>,
}
#[derive(Deserialize)]
struct RespOutputItem {
    #[serde(default)]
    content: Option<Vec<RespContentPart>>,
}
#[derive(Deserialize)]
struct ResponsesResponse {
    #[serde(default)]
    output: Vec<RespOutputItem>,
    #[serde(default)]
    output_text: Option<String>,
}

impl ResponsesResponse {
    /// Concatenate every `output_text` part, in order. Prefers the flattened
    /// convenience field when the proxy provides it.
    fn collect_text(self) -> String {
        if let Some(t) = self.output_text.filter(|s| !s.trim().is_empty()) {
            return t;
        }
        let mut acc = String::new();
        for item in self.output {
            if let Some(parts) = item.content {
                for p in parts {
                    if p.kind == "output_text" {
                        if let Some(t) = p.text {
                            acc.push_str(&t);
                        }
                    }
                }
            }
        }
        acc
    }
}

fn collect_text_from_value(value: &Value) -> String {
    if let Some(t) = value
        .get("output_text")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
    {
        return t.to_string();
    }

    let mut acc = String::new();

    if value.get("type").and_then(Value::as_str) == Some("output_text") {
        if let Some(t) = value.get("text").and_then(Value::as_str) {
            acc.push_str(t);
        }
    }

    if let Some(parts) = value.get("content").and_then(Value::as_array) {
        for part in parts {
            if part.get("type").and_then(Value::as_str) == Some("output_text") {
                if let Some(t) = part.get("text").and_then(Value::as_str) {
                    acc.push_str(t);
                }
            }
        }
    }

    if let Some(output) = value.get("output").and_then(Value::as_array) {
        for item in output {
            acc.push_str(&collect_text_from_value(item));
        }
    }

    for key in ["item", "part", "response"] {
        if let Some(nested) = value.get(key) {
            acc.push_str(&collect_text_from_value(nested));
        }
    }

    acc
}

fn parse_sse_output_text(raw: &str) -> String {
    fn dispatch(
        event_type: &str,
        data_lines: &[String],
        deltas: &mut String,
        fallback: &mut String,
    ) {
        if data_lines.is_empty() {
            return;
        }
        let data = data_lines.join("\n");
        let trimmed = data.trim();
        if trimmed.is_empty() || trimmed == "[DONE]" {
            return;
        }

        let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
            return;
        };
        let event = if event_type.is_empty() {
            value
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
        } else {
            event_type
        };

        match event {
            "response.output_text.delta" => {
                if let Some(delta) = value.get("delta").and_then(Value::as_str) {
                    deltas.push_str(delta);
                }
            }
            "response.output_text.done" => {
                if let Some(text) = value.get("text").and_then(Value::as_str) {
                    *fallback = text.to_string();
                }
            }
            "response.completed" => {
                let text = collect_text_from_value(&value);
                if !text.trim().is_empty() {
                    *fallback = text;
                }
            }
            "response.output_item.done" | "response.content_part.done" => {
                let text = collect_text_from_value(&value);
                if !text.trim().is_empty() && fallback.trim().is_empty() {
                    fallback.push_str(&text);
                }
            }
            _ => {
                let text = collect_text_from_value(&value);
                if !text.trim().is_empty() && fallback.trim().is_empty() {
                    fallback.push_str(&text);
                }
            }
        }
    }

    let mut event_type = String::new();
    let mut data_lines: Vec<String> = Vec::new();
    let mut deltas = String::new();
    let mut fallback = String::new();

    for raw_line in raw.lines() {
        let line = raw_line.trim_end_matches('\r');
        if line.is_empty() {
            dispatch(&event_type, &data_lines, &mut deltas, &mut fallback);
            event_type.clear();
            data_lines.clear();
            continue;
        }

        if let Some(rest) = line.strip_prefix("event:") {
            event_type = rest.trim_start().to_string();
        } else if let Some(rest) = line.strip_prefix("data:") {
            data_lines.push(rest.strip_prefix(' ').unwrap_or(rest).to_string());
        }
    }
    dispatch(&event_type, &data_lines, &mut deltas, &mut fallback);

    if deltas.trim().is_empty() {
        fallback
    } else {
        deltas
    }
}

fn collect_response_text(raw: &str) -> Result<String, String> {
    let sse_text = parse_sse_output_text(raw);
    if !sse_text.trim().is_empty() {
        return Ok(sse_text);
    }

    let parsed: ResponsesResponse = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    Ok(parsed.collect_text())
}

fn response_headers_debug(headers: &reqwest::header::HeaderMap) -> String {
    ["content-type", "content-encoding", "transfer-encoding"]
        .iter()
        .filter_map(|name| {
            headers
                .get(*name)
                .and_then(|v| v.to_str().ok())
                .map(|v| format!("{name}={v}"))
        })
        .collect::<Vec<_>>()
        .join(", ")
}

async fn read_response_body_lossy(mut resp: reqwest::Response) -> Result<String, reqwest::Error> {
    let mut bytes = Vec::new();
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => bytes.extend_from_slice(&chunk),
            Ok(None) => return Ok(String::from_utf8_lossy(&bytes).into_owned()),
            Err(_err) if !bytes.is_empty() => return Ok(String::from_utf8_lossy(&bytes).into_owned()),
            Err(err) => return Err(err),
        }
    }
}

/// Single-source LLM call. This is the ONLY function that issues an outbound
/// request, and it only ever targets the loopback OAuth/LLM endpoint. On any
/// failure it returns a `degraded` LlmError so callers keep working offline.
async fn chat_completion(system: &str, user: String) -> Result<String, LlmError> {
    let cfg = load_config();
    let base = resolve_base_url().ok_or_else(|| {
        LlmError::degraded(
            "no_auth",
            "OAuth 구독 세션이 준비되지 않았습니다. 보기/편집/저장은 그대로 사용할 수 있습니다.",
        )
    })?;
    let endpoint = cfg.endpoint_template.replace("{base}", &base);

    // Responses API body (ima2-proven shape). `instructions` carries the system
    // prompt; `user` carries the extraction prompt. Codex's backend can complete
    // non-stream calls with an empty final `output[]`, while the text is emitted
    // as SSE events. We therefore request a stream and collect the final text
    // locally before returning it to the renderer.
    // System prompt → `instructions` (overrides codex's default coding-agent
    // instructions the proxy would otherwise inject, which produced empty output).
    // User prompt → a single `user` input message.
    let body = ResponsesRequest {
        model: &cfg.model,
        instructions: system.to_string(),
        input: vec![InputMsg {
            role: "user",
            content: user,
        }],
        stream: true,
        reasoning: ReasoningCfg { effort: "medium" },
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(cfg.request.timeout_ms))
        .build()
        .map_err(|e| LlmError::hard("client", format!("HTTP client build failed: {e}")))?;

    // The openai-oauth child injects the OAuth subscription bearer token for
    // requests routed through its loopback endpoint (OpenClaude/Hermes pattern),
    // so we do NOT read or attach the token ourselves — that keeps the auth
    // file off this code path entirely (AC-7-relaxed boundary).
    let resp = client
        .post(&endpoint)
        .header("content-type", "application/json")
        .header("accept", "text/event-stream")
        .header("accept-encoding", "identity")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            LlmError::degraded(
                "call_failed",
                format!("LLM 호출 실패(네트워크/인증). 보기/편집은 계속 가능합니다: {e}"),
            )
        })?;

    if !resp.status().is_success() {
        let code = resp.status().as_u16();
        let headers = response_headers_debug(resp.headers());
        let text = read_response_body_lossy(resp).await.unwrap_or_default();
        return Err(LlmError::degraded(
            "http_status",
            format!(
                "LLM 엔드포인트가 {code} 응답을 반환했습니다({headers}): {}",
                text.chars().take(300).collect::<String>()
            ),
        ));
    }

    // Capture the raw body so an empty/unexpected shape can be diagnosed (the
    // body is the model's own reply, not an auth secret). Truncated when surfaced.
    let headers = response_headers_debug(resp.headers());
    let raw = read_response_body_lossy(resp).await.map_err(|e| {
        LlmError::degraded(
            "bad_response",
            format!("LLM 응답 본문을 읽지 못했습니다({headers}): {e}"),
        )
    })?;
    let snippet: String = raw.chars().take(600).collect();

    let text = collect_response_text(&raw).map_err(|e| {
        LlmError::degraded(
            "bad_response",
            format!("LLM 응답 파싱 실패: {e}. 응답 일부: {snippet}"),
        )
    })?;
    if text.trim().is_empty() {
        // No output_text found — surface the raw structure so the cause (proxy
        // shape drift, reasoning-only output, different event names) is visible.
        return Err(LlmError::degraded(
            "empty_response",
            format!("LLM 응답에 본문이 없습니다. 응답 구조(일부): {snippet}"),
        ));
    }
    Ok(text)
}

/* ---------------- Public commands ---------------- */

#[derive(Deserialize)]
pub struct ExtractArgs {
    /// JSON array string of chunks (the renderer's deterministic chunks).
    pub chunks_json: String,
}

/// AC-LLM-EXTRACT: run the source-extractor role over the chunks. Returns the
/// raw LLM JSON content string; the renderer parses + schema-validates it.
#[tauri::command]
pub async fn llm_extract(args: ExtractArgs) -> Result<String, LlmError> {
    let user = format!(
        "Extract reusable knowledge candidates from these source chunks (JSON). Each chunk has chunk_id, heading_path, location (page/char range), and text:\n\n{}",
        args.chunks_json
    );
    chat_completion(EXTRACT_SYSTEM_PROMPT, user).await
}

#[derive(Deserialize)]
pub struct ClassifyArgs {
    pub candidates_json: String,
    pub outline_json: String,
}

/// AC-CLASSIFY-MAP: map candidates onto outline nodes.
#[tauri::command]
pub async fn llm_classify(args: ClassifyArgs) -> Result<String, LlmError> {
    let user = format!(
        "Outline nodes (JSON tree, each has id + title + level):\n{}\n\nCandidates to classify (JSON):\n{}",
        args.outline_json, args.candidates_json
    );
    chat_completion(CLASSIFY_SYSTEM_PROMPT, user).await
}

#[derive(Deserialize)]
pub struct TranslateArgs {
    /// The ORIGINAL source text to translate. It is NOT mutated; the caller
    /// stores the returned translation in a separate field.
    pub original_text: String,
}

/// AC-TRANSLATE: produce a Catholic-terminology Korean translation. The
/// original is preserved by the caller — this only returns the translation.
#[tauri::command]
pub async fn llm_translate(args: TranslateArgs) -> Result<String, LlmError> {
    let user = format!("Translate this source passage into Korean (Catholic terminology):\n\n{}", args.original_text);
    chat_completion(TRANSLATE_SYSTEM_PROMPT, user).await
}

/* ---------------- Slice 5c — auto-LLM wiki extraction ---------------- */

/// Thin system framing for the auto path. The FULL role/no-guess/Catholic/
/// chunk_id-binding instructions and the output JSON shape live inside the
/// renderer-built prompt (`src/lib/bridge/promptBuilder.buildPrompt`), which is
/// BYTE-IDENTICAL to the copy-paste prompt. This system message only reinforces
/// "obey the embedded instructions, output JSON only" so the same prompt that a
/// user pastes into chatgpt.com is what the auto path sends. Reusing the 5b
/// prompt verbatim is what makes the downstream validator (anti-forgery gate)
/// applicable unchanged (AC-AUTO-EXTRACT + AC-EVIDENCE-REUSE).
const AUTO_WIKI_SYSTEM_PROMPT: &str = r#"You follow the embedded instructions in the user message exactly. The user message contains [SCHEMA], [CANDIDATE_CHUNKS], and [OUTPUT_FORMAT] blocks, and may also contain a [CANDIDATE] block for single-card extraction. Do not guess. Every evidence chunk_id you cite MUST be one of the chunk_ids present in [CANDIDATE_CHUNKS] (never invent a chunk_id). Use Catholic Korean terminology. Output ONLY the JSON object described in [OUTPUT_FORMAT] (the {"wiki_candidates":[...]} shape); no prose."#;

#[derive(Deserialize)]
pub struct ExtractWikiArgs {
    /// The renderer-built copy-paste prompt (promptBuilder.buildPrompt output)
    /// for ONE candidate. Sent verbatim so the auto path is identical to the
    /// manual paste path — the SAME validator binds the response.
    pub prompt: String,
}

/// AC-AUTO-EXTRACT: send the 5b copy-paste prompt to the OAuth/LLM loopback and
/// return the RAW model text. The renderer parses it with the 5b responseParser
/// and validates it with the 5b responseValidator (chunk_id anti-forgery gate),
/// then imports via the 5b wikiImport — i.e. the auto path automates the manual
/// paste while reusing the exact same trust boundary.
///
/// On any auth/call failure this returns a `degraded` LlmError; the renderer
/// then falls back to the copy-paste bridge (AC-GRACEFUL). The app never dies.
#[tauri::command]
pub async fn llm_extract_wiki(args: ExtractWikiArgs) -> Result<String, LlmError> {
    chat_completion(AUTO_WIKI_SYSTEM_PROMPT, args.prompt).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collect_response_text_accepts_non_stream_responses_shape() {
        let raw = r#"{
            "output": [
                {
                    "type": "message",
                    "content": [
                        { "type": "output_text", "text": "{\"wiki_candidates\":[]}" }
                    ]
                }
            ]
        }"#;
        assert_eq!(
            collect_response_text(raw).unwrap(),
            r#"{"wiki_candidates":[]}"#
        );
    }

    #[test]
    fn parse_sse_output_text_collects_delta_events() {
        let raw = r#"event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"{\"wiki_candidates\":"}

event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"[]}"}

data: [DONE]
"#;
        assert_eq!(parse_sse_output_text(raw), r#"{"wiki_candidates":[]}"#);
    }

    #[test]
    fn parse_sse_output_text_falls_back_to_completed_response() {
        let raw = r#"event: response.completed
data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"{\"wiki_candidates\":[]}"}]}]}}
"#;
        assert_eq!(parse_sse_output_text(raw), r#"{"wiki_candidates":[]}"#);
    }

    #[test]
    fn parse_sse_output_text_accepts_content_part_done() {
        let raw = r#"event: response.content_part.done
data: {"type":"response.content_part.done","part":{"type":"output_text","text":"{\"wiki_candidates\":[]}"}}
"#;
        assert_eq!(parse_sse_output_text(raw), r#"{"wiki_candidates":[]}"#);
    }

    #[test]
    fn config_has_user_specified_model_and_oauth() {
        // load_config falls back to the hard-coded mirror when the file is not
        // resolvable from the test cwd; either way the model id + auth mode hold.
        let cfg = load_config();
        assert_eq!(cfg.model, "gpt-5.4");
        assert_eq!(cfg.auth, "oauth_subscription");
        assert!(cfg.endpoint_template.contains("{base}"));
    }

    #[test]
    fn endpoint_template_fills_base() {
        let cfg = load_config();
        let filled = cfg.endpoint_template.replace("{base}", "http://127.0.0.1:9999/v1");
        // Responses API (openai-oauth proxy), NOT Chat Completions.
        assert_eq!(filled, "http://127.0.0.1:9999/v1/responses");
    }

    #[test]
    fn prompts_are_role_ported_and_nonempty() {
        assert!(EXTRACT_SYSTEM_PROMPT.contains("religious_text"));
        assert!(CLASSIFY_SYSTEM_PROMPT.contains("outline"));
        // Catholic terminology default + Protestant-forbidden invariant.
        assert!(TRANSLATE_SYSTEM_PROMPT.contains("의화"));
        assert!(TRANSLATE_SYSTEM_PROMPT.contains("판관기"));
        assert!(TRANSLATE_SYSTEM_PROMPT.contains("FORBIDDEN"));
    }
}
