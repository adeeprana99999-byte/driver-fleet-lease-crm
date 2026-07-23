const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const { MongoStore } = require("../mongo-store");

async function main() {
  const sqlitePath = path.resolve(
    process.argv.find((value) => value.endsWith(".sqlite")) || path.join(__dirname, "..", "data", "driver-fleet.sqlite")
  );
  const force = process.argv.includes("--force");
  if (!fs.existsSync(sqlitePath)) throw new Error(`SQLite database not found: ${sqlitePath}`);

  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  const row = sqlite.prepare("SELECT json, updated_at FROM app_state WHERE key = 'main'").get();
  sqlite.close();
  if (!row) throw new Error("The SQLite database does not contain an application state.");

  const store = new MongoStore({ uri: process.env.MONGODB_URI, dbName: process.env.MONGODB_DB });
  await store.connect();
  try {
    const existing = await store.getState();
    if (existing.state && !force) {
      throw new Error("MongoDB already contains app data. Re-run with --force only if you intend to replace it.");
    }
    const state = JSON.parse(row.json);
    await store.saveState(state, "sqlite_migration");
    console.log(`Migrated ${Buffer.byteLength(row.json)} bytes from SQLite to MongoDB database ${store.dbName}.`);
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  console.error(`Migration failed: ${error.message}`);
  process.exitCode = 1;
});
