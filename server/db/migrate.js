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
