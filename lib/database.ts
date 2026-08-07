import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "@/db/schema";

type DatabaseInstance = ReturnType<typeof createDatabase>;

const globalDatabase = globalThis as typeof globalThis & {
  __and1Database?: DatabaseInstance;
};

function createDatabase() {
  const databasePath =
    process.env.DATABASE_PATH ?? join(process.cwd(), "data", "and1.db");
  const migrationsPath =
    process.env.MIGRATIONS_PATH ?? join(process.cwd(), "drizzle");

  mkdirSync(dirname(databasePath), { recursive: true });

  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  const database = drizzle(sqlite, { schema });
  migrate(database, { migrationsFolder: migrationsPath });

  return { database, sqlite };
}

export function getDatabase() {
  globalDatabase.__and1Database ??= createDatabase();
  return globalDatabase.__and1Database.database;
}

export function checkDatabase() {
  globalDatabase.__and1Database ??= createDatabase();
  globalDatabase.__and1Database.sqlite.prepare("select 1").get();
}
