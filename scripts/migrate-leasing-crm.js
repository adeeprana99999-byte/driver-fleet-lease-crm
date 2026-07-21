const fs = require("fs/promises");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const { MongoStore } = require("../mongo-store");
const { migrateLeasingState } = require("../state-migration");

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function backupState(state) {
  const backupDir = path.join(__dirname, "..", "data", "backups");
  await fs.mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `mongo-live-state-before-leasing-${timestamp()}.json`);
  await fs.writeFile(backupPath, JSON.stringify({ backedUpAt: new Date().toISOString(), state }, null, 2), "utf8");
  return backupPath;
}

function printSummary(summary) {
  console.log("Migration summary:");
  console.log(`  Leases created: ${summary.leasesCreated}`);
  console.log(`  Rent payments migrated: ${summary.rentChargesCreated}`);
  console.log(`  Mileage readings created: ${summary.mileageReadingsCreated}`);
  console.log(`  Driver documents indexed: ${summary.documentsCreated}`);
  console.log(`  Booking collections created: ${summary.bookingCollectionsCreated || 0}`);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required. Add it to .env or set it in PowerShell before running this script.");
  }

  const store = new MongoStore({ uri: process.env.MONGODB_URI, dbName: process.env.MONGODB_DB });
  await store.connect();

  try {
    const existing = await store.getState();
    if (!existing.state) {
      console.log("MongoDB connected, but no application state was found. Start the app once to seed data, then run this migration.");
      return;
    }

    const backupPath = await backupState(existing.state);
    const { state, summary } = migrateLeasingState(existing.state);

    console.log(`Connected database: ${store.dbName}`);
    console.log(`Backup saved: ${backupPath}`);
    printSummary(summary);

    if (dryRun) {
      console.log("Dry run only. No database changes were saved.");
      return;
    }

    if (!summary.changed) {
      console.log("No migration changes were needed. Live data is already on the leasing CRM schema.");
      return;
    }

    const result = await store.saveState(state, "migrate_leasing_crm");
    console.log(`Live MongoDB state upgraded at ${result.updatedAt}.`);
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  console.error(`Leasing CRM migration failed: ${error.message}`);
  process.exit(1);
});
