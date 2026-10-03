use axum::http::HeaderMap;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use rand::RngCore;
use scrypt::{Params, scrypt};
use sha2::Sha256;
use subtle::ConstantTimeEq;

const MAX_AGE: i64 = 60 * 60 * 24 * 30;

#[derive(Clone)]
pub struct Auth {
    pub password_hash: String,
    pub secret: String,
}

impl Auth {
    pub fn configured(&self) -> bool {
        !self.password_hash.is_empty() && self.secret.encode_utf16().count() >= 32
    }

    pub fn authenticated(&self, headers: &HeaderMap) -> bool {
        if !self.configured() {
            return false;
        }
        let Some(token) = headers
            .get("cookie")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| {
                v.split(';')
                    .find_map(|part| part.trim().strip_prefix("and1_session="))
            })
        else {
            return false;
        };
        let parts: Vec<_> = token.split('.').collect();
        if parts.len() != 3 || parts[0] != "v1" {
            return false;
        }
        let Ok(expires) = parts[1].parse::<i64>() else {
            return false;
        };
        if expires <= chrono::Utc::now().timestamp_millis() {
            return false;
        }
        let payload = format!("v1.{}", parts[1]);
        self.signature(&payload)
            .as_bytes()
            .ct_eq(parts[2].as_bytes())
            .into()
    }

    fn signature(&self, payload: &str) -> String {
        let mut mac =
            Hmac::<Sha256>::new_from_slice(self.secret.as_bytes()).expect("HMAC accepts any key");
        mac.update(payload.as_bytes());
        URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
    }

    pub fn cookie(&self, headers: &HeaderMap, clear: bool) -> String {
        let value = if clear {
            String::new()
        } else {
            let payload = format!(
                "v1.{}",
                chrono::Utc::now().timestamp_millis() + MAX_AGE * 1000
            );
            format!("{payload}.{}", self.signature(&payload))
        };
        let secure = headers
            .get("x-forwarded-proto")
            .is_some_and(|v| v == "https");
        format!(
            "and1_session={value}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{}",
            if clear { 0 } else { MAX_AGE },
            if secure { "; Secure" } else { "" }
        )
    }
}

pub fn verify_password(password: &str, stored: &str) -> bool {
    let parts: Vec<_> = stored.split('.').collect();
    if parts.len() != 3 || parts[0] != "scrypt" {
        return false;
    }
    let (Ok(salt), Ok(expected)) = (
        URL_SAFE_NO_PAD.decode(parts[1]),
        URL_SAFE_NO_PAD.decode(parts[2]),
    ) else {
        return false;
    };
    if expected.is_empty() || expected.len() > 1024 {
        return false;
    }
    let mut actual = vec![0; expected.len()];
    // Node's scrypt defaults: N=16384, r=8, p=1 (not the crate's defaults).
    let params = Params::new(14, 8, 1, 64).expect("fixed scrypt parameters");
    scrypt(password.as_bytes(), &salt, &params, &mut actual).is_ok()
        && bool::from(actual.ct_eq(&expected))
}

pub fn hash_password(password: &str) -> String {
    let mut salt = [0; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    let mut hash = [0; 64];
    scrypt(
        password.as_bytes(),
        &salt,
        &Params::new(14, 8, 1, 64).unwrap(),
        &mut hash,
    )
    .unwrap();
    format!(
        "scrypt.{}.{}",
        URL_SAFE_NO_PAD.encode(salt),
        URL_SAFE_NO_PAD.encode(hash)
    )
}
