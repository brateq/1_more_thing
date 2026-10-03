use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use rusqlite::{Connection, Row, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Thought {
    // Field order is part of the old POST idempotency fingerprint.
    pub id: String,
    pub text: String,
    pub status: String,
    pub created_at: String,
    pub last_presented_at: Option<String>,
    pub completed_at: Option<String>,
}

pub fn js_trim(value: &str) -> &str {
    value.trim_matches(|c: char| {
        matches!(c,
        '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' |
        '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' |
        '\u{205f}' | '\u{3000}' | '\u{feff}')
    })
}

pub fn date(value: &Value) -> Option<i64> {
    let value = value.as_str()?;
    DateTime::parse_from_rfc3339(value)
        .map(|d| d.timestamp_millis())
        .ok()
        .or_else(|| {
            NaiveDate::parse_from_str(value, "%Y-%m-%d")
                .ok()
                .and_then(|d| d.and_hms_opt(0, 0, 0))
                .map(|d| d.and_utc().timestamp_millis())
        })
}

fn iso(ms: i64) -> rusqlite::Result<String> {
    DateTime::<Utc>::from_timestamp_millis(ms)
        .map(|d| d.to_rfc3339_opts(SecondsFormat::Millis, true))
        .ok_or_else(|| rusqlite::Error::IntegralValueOutOfRange(0, ms))
}

pub fn parse(value: &Value) -> Option<Thought> {
    let id = value.get("id")?.as_str()?;
    let text = js_trim(value.get("text")?.as_str()?);
    let status = value.get("status")?.as_str()?;
    if id.is_empty()
        || id.encode_utf16().count() > 120
        || text.is_empty()
        || text.encode_utf16().count() > 280
        || !matches!(status, "active" | "done")
    {
        return None;
    }
    let nullable = |key| -> Option<Option<String>> {
        let v = value.get(key)?;
        if v.is_null() {
            Some(None)
        } else {
            Some(Some(iso(date(v)?).ok()?))
        }
    };
    Some(Thought {
        id: id.into(),
        text: text.into(),
        status: status.into(),
        created_at: iso(date(value.get("createdAt")?)?).ok()?,
        last_presented_at: nullable("lastPresentedAt")?,
        completed_at: nullable("completedAt")?,
    })
}

pub const COLUMNS: &str = "id, text, status, created_at, last_presented_at, completed_at";

pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Thought> {
    Ok(Thought {
        id: row.get(0)?,
        text: row.get(1)?,
        status: row.get(2)?,
        created_at: iso(row.get(3)?)?,
        last_presented_at: row.get::<_, Option<i64>>(4)?.map(iso).transpose()?,
        completed_at: row.get::<_, Option<i64>>(5)?.map(iso).transpose()?,
    })
}

pub fn insert(db: &Connection, thought: &Thought) -> rusqlite::Result<usize> {
    let millis = |s: &str| DateTime::parse_from_rfc3339(s).unwrap().timestamp_millis();
    db.prepare_cached("INSERT INTO thoughts (id, text, status, created_at, last_presented_at, completed_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT DO NOTHING")?
        .execute(params![thought.id, thought.text, thought.status, millis(&thought.created_at),
            thought.last_presented_at.as_deref().map(millis), thought.completed_at.as_deref().map(millis), Utc::now().timestamp_millis()])
}

/// Match JSON.stringify, including insertion order, integer property ordering,
/// UTF-8, negative zero and ECMAScript number formatting. Old receipts use this.
pub fn js_json(value: &Value) -> String {
    match value {
        Value::Number(number) => ryu_js::Buffer::new()
            .format(number.as_f64().unwrap())
            .into(),
        Value::Array(values) => format!(
            "[{}]",
            values.iter().map(js_json).collect::<Vec<_>>().join(",")
        ),
        Value::Object(object) => {
            let array_index = |key: &str| {
                key.parse::<u32>()
                    .ok()
                    .filter(|n| *n != u32::MAX && n.to_string() == key)
            };
            let mut keys: Vec<_> = object.keys().collect();
            keys.sort_by_key(|key| array_index(key).map_or((1, 0), |n| (0, n)));
            format!(
                "{{{}}}",
                keys.into_iter()
                    .map(|key| format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap(),
                        js_json(&object[key])
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        _ => serde_json::to_string(value).unwrap(),
    }
}

pub fn fingerprint(method: &str, path: &str, payload: Value) -> String {
    hex::encode(Sha256::digest(
        js_json(&serde_json::json!([method, path, payload])).as_bytes(),
    ))
}
