import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openWorkbenchDatabase } from "./connection.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(currentDir, "schema.sql");

export function migrateDatabase(database) {
  const schema = fs.readFileSync(schemaPath, "utf8");
  database.exec(schema);
  ensureColumn(database, "projects", "local_path", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "agent_runs", "source_repo_path", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "agent_runs", "workspace_path", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "agent_runs", "baseline_snapshot_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(database, "agent_runs", "verification_status", "TEXT NOT NULL DEFAULT 'unknown'");
  ensureReviewItemStatuses(database);
  return { migrated: true, schemaPath };
}

export function migrateWorkbenchDatabase(options = {}) {
  const database = openWorkbenchDatabase(options);
  try {
    return migrateDatabase(database);
  } finally {
    database.close();
  }
}

function ensureColumn(database, tableName, columnName, definition) {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) return;
  database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
}

function ensureReviewItemStatuses(database) {
  const table = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'review_items'").get();
  if (!table?.sql || table.sql.includes("'reverted'")) return;
  database.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE review_items_next (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      change_summary TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      requirement_mapping TEXT NOT NULL DEFAULT '',
      risk_level TEXT NOT NULL DEFAULT '',
      test_status TEXT NOT NULL DEFAULT '',
      human_status TEXT NOT NULL DEFAULT 'pending' CHECK (human_status IN ('pending', 'approved', 'needs_change', 'blocked', 'reverted', 'resolved')),
      human_comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO review_items_next (
      id, run_id, file_path, change_summary, reason, requirement_mapping, risk_level,
      test_status, human_status, human_comment, created_at, updated_at
    )
    SELECT
      id, run_id, file_path, change_summary, reason, requirement_mapping, risk_level,
      test_status, human_status, human_comment, created_at, updated_at
    FROM review_items;
    DROP TABLE review_items;
    ALTER TABLE review_items_next RENAME TO review_items;
    CREATE INDEX IF NOT EXISTS idx_review_items_run_id ON review_items(run_id);
    PRAGMA foreign_keys = ON;
  `);
}
