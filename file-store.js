const fs = require("fs/promises");
const path = require("path");

const recordCollections = [
  "users",
  "vendors",
  "vehicles",
  "drivers",
  "leases",
  "rentCharges",
  "mileageReadings",
  "documents",
  "bookings",
  "bookingPayments",
  "trips",
  "expenses",
  "maintenance",
  "notifications"
];

class FileStore {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.dbName = "local-json";
    this.name = "Local file";
  }

  async connect() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
  }

  async getState() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const payload = JSON.parse(raw);
      return {
        state: payload.state || null,
        updatedAt: payload.updatedAt || null
      };
    } catch (error) {
      if (error.code === "ENOENT") return { state: null, updatedAt: null };
      throw new Error(`Local data file is invalid: ${error.message}`);
    }
  }

  async saveState(state, action = "api_state_put") {
    const updatedAt = new Date().toISOString();
    const payload = {
      updatedAt,
      action,
      state
    };
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
    await fs.rename(tempPath, this.filePath);
    return { updatedAt };
  }

  async status() {
    const result = await this.getState();
    const state = result.state || {};
    return {
      dbName: this.dbName,
      dataFile: this.filePath,
      counts: recordCollections.map((collection) => ({
        collection,
        count: Array.isArray(state[collection]) ? state[collection].length : 0
      })),
      latest: result.updatedAt ? { at: result.updatedAt, action: "local_save", detail: "Application state saved locally." } : null,
      updatedAt: result.updatedAt
    };
  }

  async ping() {
    await this.connect();
  }

  async close() {}
}

module.exports = { FileStore };
