import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openWorkbenchDatabase } from "./connection.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(currentDir, "schema.sql");

export function migrateDatabase(database) {
  const schema = fs.readFileSync(schemaPath, "utf8");
  database.exec(schema);
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
