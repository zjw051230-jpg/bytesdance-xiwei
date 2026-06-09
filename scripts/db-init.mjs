import { openWorkbenchDatabase, resolveWorkbenchDbPath } from "../server/db/connection.js";
import { migrateDatabase } from "../server/db/migrate.js";
import { seedWorkbenchDatabase } from "../server/db/seed.js";

const dbPath = resolveWorkbenchDbPath();
const database = openWorkbenchDatabase({ dbPath });
try {
  const migration = migrateDatabase(database);
  const seed = seedWorkbenchDatabase(database);
  console.log(JSON.stringify({
    status: "passed",
    dbPath,
    migrated: migration.migrated,
    seeded: seed.seeded,
    apiKeyPrinted: false
  }, null, 2));
} finally {
  database.close();
}
