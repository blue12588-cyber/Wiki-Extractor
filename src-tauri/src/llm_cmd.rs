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
        endpoint_template: "{base}/chat/completions".to_string(),
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

/* ---------------- Chat request plumbing ---------------- */

#[derive(Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: String,
}

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    temperature: f32,
    #[serde(rename = "max_tokens")]
    max_tokens: u32,
}

#[derive(Deserialize)]
struct ChatChoiceMsg {
    content: Option<String>,
}
#[derive(Deserialize)]
struct ChatChoice {
    message: ChatChoiceMsg,
}
#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
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

    let body = ChatRequest {
        model: &cfg.model,
        messages: vec![
            ChatMessage { role: "system", content: system.to_string() },
            ChatMessage { role: "user", content: user },
        ],
        temperature: cfg.request.temperature,
        max_tokens: cfg.request.max_output_tokens,
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
        let text = resp.text().await.unwrap_or_default();
        return Err(LlmError::degraded(
            "http_status",
            format!("LLM 엔드포인트가 {code} 응답을 반환했습니다: {}", text.chars().take(300).collect::<String>()),
        ));
    }

    let parsed: ChatResponse = resp
        .json()
        .await
        .map_err(|e| LlmError::degraded("bad_response", format!("LLM 응답 파싱 실패: {e}")))?;

    parsed
        .choices
        .into_iter()
        .next()
        .and_then(|c| c.message.content)
        .ok_or_else(|| LlmError::degraded("empty_response", "LLM 응답에 본문이 없습니다."))
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

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(filled, "http://127.0.0.1:9999/v1/chat/completions");
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
