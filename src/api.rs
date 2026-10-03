use crate::{
    auth::{Auth, verify_password},
    database::Database,
    thoughts::{self, Thought},
};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, OriginalUri, Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
};
use rusqlite::{OptionalExtension, params};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::Semaphore;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub auth: Auth,
    attempts: Arc<Mutex<HashMap<String, (u32, Instant)>>>,
    password_workers: Arc<Semaphore>,
}

impl AppState {
    pub fn new(db: Database, auth: Auth) -> Self {
        Self {
            db,
            auth,
            attempts: Arc::default(),
            password_workers: Arc::new(Semaphore::new(2)),
        }
    }
}

#[derive(Debug)]
pub struct ApiError(StatusCode, &'static str);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error": self.1}))).into_response()
    }
}
type ApiResult = Result<Response, ApiError>;
fn bad(error: &'static str) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, error)
}
fn internal(error: String) -> ApiError {
    eprintln!("Database error: {error}");
    ApiError(StatusCode::INTERNAL_SERVER_ERROR, "internal_error")
}
fn authorize(state: &AppState, headers: &HeaderMap) -> Result<(), ApiError> {
    if state.auth.authenticated(headers) {
        Ok(())
    } else {
        Err(ApiError(StatusCode::UNAUTHORIZED, "unauthorized"))
    }
}
fn body(bytes: &Bytes) -> Result<Value, ApiError> {
    serde_json::from_slice(bytes).map_err(|_| bad("invalid_request"))
}

pub fn routes(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/auth/session", get(session))
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout))
        .route("/api/thoughts", get(list).post(create))
        .route("/api/thoughts/import", post(import))
        .route("/api/thoughts/{id}", patch(update).delete(delete))
        .layer(DefaultBodyLimit::max(8 * 1024 * 1024))
        .layer(tower_http::set_header::SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            header::HeaderValue::from_static("no-store"),
        ))
        .with_state(state)
}

async fn health(State(state): State<AppState>) -> Response {
    match state
        .db
        .call(|db| db.query_row("SELECT 1", [], |_| Ok(())))
        .await
    {
        Ok(()) => Json(json!({"status": "ok"})).into_response(),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"status": "unavailable"})),
        )
            .into_response(),
    }
}
async fn session(State(state): State<AppState>, headers: HeaderMap) -> Json<Value> {
    Json(
        json!({"authenticated": state.auth.authenticated(&headers), "configured": state.auth.configured()}),
    )
}
async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    (
        [(header::SET_COOKIE, state.auth.cookie(&headers, true))],
        Json(json!({"authenticated": false})),
    )
        .into_response()
}
async fn login(State(state): State<AppState>, headers: HeaderMap, bytes: Bytes) -> ApiResult {
    if !state.auth.configured() {
        return Err(ApiError(StatusCode::SERVICE_UNAVAILABLE, "not_configured"));
    }
    let value = body(&bytes)?;
    let password = value
        .get("password")
        .and_then(Value::as_str)
        .filter(|p| p.encode_utf16().count() <= 512)
        .unwrap_or("")
        .to_owned();
    let key = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .unwrap_or("unknown")
        .trim()
        .to_owned();
    {
        let mut attempts = state.attempts.lock().unwrap();
        let now = Instant::now();
        attempts.retain(|_, (_, until)| *until > now);
        if attempts.get(&key).is_some_and(|(count, _)| *count >= 8) {
            return Ok((
                StatusCode::TOO_MANY_REQUESTS,
                [(header::RETRY_AFTER, "900")],
                Json(json!({"error": "too_many_attempts"})),
            )
                .into_response());
        }
        // Reserve before hashing so simultaneous failures cannot evade the limit.
        let count = attempts.get(&key).map_or(0, |(count, _)| *count);
        attempts.insert(key.clone(), (count + 1, now + Duration::from_secs(900)));
    }
    let permit = state
        .password_workers
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE, "unavailable"))?;
    let hash = state.auth.password_hash.clone();
    let valid = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        verify_password(&password, &hash)
    })
    .await
    .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "internal_error"))?;
    if !valid {
        return Err(ApiError(StatusCode::UNAUTHORIZED, "invalid_credentials"));
    }
    state.attempts.lock().unwrap().remove(&key);
    Ok((
        [(header::SET_COOKIE, state.auth.cookie(&headers, false))],
        Json(json!({"authenticated": true})),
    )
        .into_response())
}

async fn list(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    authorize(&state, &headers)?;
    let rows = state
        .db
        .call(|db| {
            db.prepare_cached(&format!(
                "SELECT {} FROM thoughts ORDER BY created_at DESC",
                thoughts::COLUMNS
            ))?
            .query_map([], thoughts::from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()
        })
        .await
        .map_err(internal)?;
    // Serialize directly: avoid allocating a second JSON tree for every poll.
    #[derive(serde::Serialize)]
    struct ThoughtList {
        thoughts: Vec<Thought>,
    }
    Ok(Json(ThoughtList { thoughts: rows }).into_response())
}

struct MutationResult {
    status: u16,
    body: Option<Value>,
}
impl MutationResult {
    fn json(status: u16, body: Value) -> Self {
        Self {
            status,
            body: Some(body),
        }
    }
    fn response(self) -> Response {
        let status = StatusCode::from_u16(self.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        if self.status == 204 {
            status.into_response()
        } else {
            (status, Json(self.body.unwrap_or(Value::Null))).into_response()
        }
    }
}

async fn mutate(
    state: AppState,
    headers: HeaderMap,
    method: &'static str,
    path: String,
    payload: Value,
    operation: impl FnOnce(&rusqlite::Connection) -> rusqlite::Result<MutationResult> + Send + 'static,
) -> ApiResult {
    let key = headers
        .get("idempotency-key")
        .map(|v| v.to_str().map(str::to_owned))
        .transpose()
        .map_err(|_| bad("invalid_idempotency_key"))?
        .filter(|v| !v.is_empty());
    if key.as_ref().is_some_and(|k| {
        k.len() > 120
            || !k
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    }) {
        return Err(bad("invalid_idempotency_key"));
    }
    let fingerprint = thoughts::fingerprint(method, &path, payload);
    let result = state.db.call(move |db| {
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if let Some(key) = &key {
            let existing = tx.prepare_cached("SELECT fingerprint, status, body FROM mutation_receipts WHERE id=?1")?
                .query_row([key], |row| Ok((row.get::<_, String>(0)?, row.get::<_, u16>(1)?, row.get::<_, Option<String>>(2)?))).optional()?;
            if let Some((saved, status, body)) = existing {
                if saved != fingerprint { return Ok(MutationResult::json(409, json!({"error": "idempotency_conflict"}))); }
                let body = body.map(|s| serde_json::from_str(&s)).transpose()
                    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
                return Ok(MutationResult { status, body });
            }
        }
        let result = operation(&tx)?;
        if let Some(key) = key.filter(|_| result.status < 300 || (method == "DELETE" && result.status == 404)) {
            tx.prepare_cached("INSERT INTO mutation_receipts (id, fingerprint, status, body) VALUES (?1, ?2, ?3, ?4)")?
                .execute(params![key, fingerprint, result.status, result.body.as_ref().map(thoughts::js_json)])?;
        }
        tx.commit()?;
        Ok(result)
    }).await.map_err(internal)?;
    Ok(result.response())
}

async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    OriginalUri(uri): OriginalUri,
    bytes: Bytes,
) -> ApiResult {
    authorize(&state, &headers)?;
    let value = body(&bytes)?;
    let thought = value
        .get("thought")
        .and_then(thoughts::parse)
        .ok_or_else(|| bad("invalid_thought"))?;
    let payload = serde_json::to_value(&thought).unwrap();
    mutate(
        state,
        headers,
        "POST",
        uri.path().into(),
        payload,
        move |db| {
            if thoughts::insert(db, &thought)? == 0 {
                return Ok(MutationResult::json(
                    409,
                    json!({"error": "already_exists"}),
                ));
            }
            Ok(MutationResult::json(201, json!({"thought": thought})))
        },
    )
    .await
}

async fn import(State(state): State<AppState>, headers: HeaderMap, bytes: Bytes) -> ApiResult {
    authorize(&state, &headers)?;
    let value = body(&bytes)?;
    let values = value
        .get("thoughts")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    if values.len() > 2000 {
        return Err(ApiError(StatusCode::PAYLOAD_TOO_LARGE, "too_many_thoughts"));
    }
    let thoughts: Vec<Thought> = values
        .iter()
        .map(thoughts::parse)
        .collect::<Option<_>>()
        .ok_or_else(|| bad("invalid_thought"))?;
    let imported = state
        .db
        .call(move |db| {
            let tx = db.transaction()?;
            let mut count = 0;
            for thought in thoughts {
                count += thoughts::insert(&tx, &thought)?;
            }
            tx.commit()?;
            Ok(count)
        })
        .await
        .map_err(internal)?;
    Ok(Json(json!({"imported": imported})).into_response())
}

async fn update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    OriginalUri(uri): OriginalUri,
    bytes: Bytes,
) -> ApiResult {
    authorize(&state, &headers)?;
    let value = body(&bytes)?;
    let object = value.as_object().ok_or_else(|| bad("invalid_request"))?;
    let mut fields = Vec::new();
    let mut values: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(text) = object.get("text") {
        let text = thoughts::js_trim(text.as_str().unwrap_or(""));
        if text.is_empty() || text.encode_utf16().count() > 280 {
            return Err(bad("invalid_text"));
        }
        fields.push("text=?");
        values.push(text.to_owned().into());
    }
    if let Some(status) = object.get("status") {
        let status = status.as_str().unwrap_or("");
        if !matches!(status, "active" | "done") {
            return Err(bad("invalid_status"));
        }
        fields.push("status=?");
        values.push(status.to_owned().into());
    }
    for (key, column) in [
        ("lastPresentedAt", "last_presented_at=?"),
        ("completedAt", "completed_at=?"),
    ] {
        if let Some(date) = object.get(key) {
            values.push(if date.is_null() {
                rusqlite::types::Value::Null
            } else {
                thoughts::date(date)
                    .ok_or_else(|| bad("invalid_date"))?
                    .into()
            });
            fields.push(column);
        }
    }
    if fields.is_empty() {
        return Err(bad("empty_update"));
    }
    fields.push("updated_at=?");
    values.push(chrono::Utc::now().timestamp_millis().into());
    values.push(id.into());
    let sql = format!(
        "UPDATE thoughts SET {} WHERE id=? RETURNING {}",
        fields.join(","),
        thoughts::COLUMNS
    );
    mutate(
        state,
        headers,
        "PATCH",
        uri.path().into(),
        value,
        move |db| {
            let updated = db
                .prepare_cached(&sql)?
                .query_row(rusqlite::params_from_iter(values), thoughts::from_row)
                .optional()?;
            Ok(match updated {
                Some(thought) => MutationResult::json(200, json!({"thought": thought})),
                None => MutationResult::json(404, json!({"error": "not_found"})),
            })
        },
    )
    .await
}

async fn delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    OriginalUri(uri): OriginalUri,
) -> ApiResult {
    authorize(&state, &headers)?;
    mutate(
        state,
        headers,
        "DELETE",
        uri.path().into(),
        Value::Null,
        move |db| {
            if db
                .prepare_cached("DELETE FROM thoughts WHERE id=?1")?
                .execute([id])?
                == 0
            {
                Ok(MutationResult::json(404, json!({"error": "not_found"})))
            } else {
                Ok(MutationResult {
                    status: 204,
                    body: None,
                })
            }
        },
    )
    .await
}
