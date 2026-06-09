import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const defaultWorkbenchDbPath = path.resolve("data", "workbench.sqlite");

export function resolveWorkbenchDbPath(options = {}) {
  return path.resolve(options.dbPath || options.workbenchDbPath || process.env.WORKBENCH_DB_PATH || defaultWorkbenchDbPath);
}

export function openWorkbenchDatabase(options = {}) {
  const dbPath = resolveWorkbenchDbPath(options);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const database = new DatabaseSync(dbPath);
  database.exec("PRAGMA foreign_keys = ON;");
  return database;
}
