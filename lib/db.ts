// Creates and manages the SQLite connection for the app.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

let dbInstance: DatabaseSync | null = null;
let migrationsApplied = false;

const DEFAULT_DB_PATH = "./data/app.db";
const DEFAULT_PROD_DB_PATH = "/data/quifin.db";
const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

function resolveDatabasePath() {
  const configuredPath =
    process.env.QUIFIN_DB_PATH ??
    process.env.DB_PATH ??
    (process.env.NODE_ENV === "production" ? DEFAULT_PROD_DB_PATH : DEFAULT_DB_PATH);
  return path.resolve(process.cwd(), configuredPath);
}

function ensureDatabaseDirExists(dbPath: string) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();
}

function ensureDatabase() {
  if (!dbInstance) {
    const dbPath = resolveDatabasePath();
    ensureDatabaseDirExists(dbPath);
    dbInstance = new DatabaseSync(dbPath);
    dbInstance.exec("PRAGMA foreign_keys = ON;");
  }

  return dbInstance;
}

function ensureMigrationTable(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

function applySqlMigrations(db: DatabaseSync) {
  ensureMigrationTable(db);

  const migrationFiles = listMigrationFiles();
  const hasMigration = db.prepare(
    "SELECT 1 FROM schema_migrations WHERE id = ? LIMIT 1",
  );
  const markMigrationApplied = db.prepare(
    "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
  );

  // Run all pending SQL files in one transaction.
  // If one migration fails, none of them are marked as applied.
  db.exec("BEGIN");
  try {
    for (const fileName of migrationFiles) {
      const alreadyApplied = hasMigration.get(fileName);
      if (alreadyApplied) continue;

      const sqlPath = path.join(MIGRATIONS_DIR, fileName);
      const sql = fs.readFileSync(sqlPath, "utf8");
      db.exec(sql);
      markMigrationApplied.run(fileName, new Date().toISOString());
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * Returns the shared SQLite database instance.
 * It also applies pending migrations once per process.
 */
export function getDatabase() {
  const db = ensureDatabase();

  if (!migrationsApplied) {
    applySqlMigrations(db);
    migrationsApplied = true;
  }

  return db;
}

/**
 * Forces migration execution now.
 * This is useful for scripts and startup checks.
 */
export function runMigrations() {
  const db = ensureDatabase();
  applySqlMigrations(db);
  migrationsApplied = true;
}
