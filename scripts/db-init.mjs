import { openWorkbenchDatabase, resolveWorkbenchDbPath } from "../server/db/connection.js";
import { migrateDatabase } from "../server/db/migrate.js";

const dbPath = resolveWorkbenchDbPath();
const database = openWorkbenchDatabase({ dbPath });
try {
  const migration = migrateDatabase(database);
  console.log(JSON.stringify({
    status: "passed",
    dbPath,
    migrated: migration.migrated,
    initializedWithoutOverwritingData: true
  }, null, 2));
} finally {
  database.close();
}
