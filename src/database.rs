use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};
use std::{path::Path, time::Duration};
use tokio::sync::{mpsc, oneshot};

type Job = Box<dyn FnOnce(&mut Connection) + Send>;

/// SQLite runs on its own thread: disk/fsync never blocks an HTTP executor.
/// A bounded queue provides backpressure without spawning unbounded workers.
#[derive(Clone)]
pub struct Database(mpsc::Sender<Job>);

impl Database {
    pub fn open(path: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)?;
        }
        let mut db = Connection::open(path)?;
        db.busy_timeout(Duration::from_secs(5))?;
        db.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;",
        )?;
        db.set_prepared_statement_cache_capacity(32);
        migrate(&mut db)?;
        let (sender, mut receiver) = mpsc::channel::<Job>(128);
        std::thread::Builder::new()
            .name("sqlite".into())
            .spawn(move || {
                while let Some(job) = receiver.blocking_recv() {
                    job(&mut db);
                }
            })?;
        Ok(Self(sender))
    }

    pub async fn call<T: Send + 'static>(
        &self,
        job: impl FnOnce(&mut Connection) -> rusqlite::Result<T> + Send + 'static,
    ) -> Result<T, String> {
        let (sender, receiver) = oneshot::channel();
        self.0
            .send(Box::new(move |db| {
                let _ = sender.send(job(db));
            }))
            .await
            .map_err(|_| "Database worker stopped".to_string())?;
        receiver
            .await
            .map_err(|_| "Database worker stopped".to_string())?
            .map_err(|error| error.to_string())
    }
}

fn migrate(db: &mut Connection) -> rusqlite::Result<()> {
    // Retain Drizzle's journal, timestamps and hashes, including for rollback.
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric);")?;
    let latest: Option<i64> = tx
        .query_row(
            "SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()?;
    for (timestamp, sql) in [
        (
            1786095382021_i64,
            include_str!("../drizzle/0000_yellow_iron_fist.sql"),
        ),
        (
            1788556344092_i64,
            include_str!("../drizzle/0001_left_loners.sql"),
        ),
    ] {
        if latest.is_none_or(|last| last < timestamp) {
            tx.execute_batch(sql)?;
            tx.execute(
                "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?1, ?2)",
                params![hex::encode(Sha256::digest(sql.as_bytes())), timestamp],
            )?;
        }
    }
    // Additive only; existing data and millisecond timestamps are untouched.
    tx.execute_batch(
        "CREATE INDEX IF NOT EXISTS thoughts_created_at_idx ON thoughts(created_at DESC);",
    )?;
    tx.commit()
}
