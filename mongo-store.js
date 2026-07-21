const { randomUUID } = require("crypto");
const { MongoClient, GridFSBucket, ServerApiVersion } = require("mongodb");

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

function recordName(record) {
  return String(record.customerName || record.bookingCode || record.name || record.companyName || record.unitNumber || record.period || record.fileName || record.category || record.type || "");
}

function recordDate(record) {
  return String(record.date || record.pickupDate || record.startDate || record.dueDate || record.paidAt || record.createdAt || record.updatedAt || "");
}

function recordAmount(record) {
  return Number(record.amount ?? record.bookingFee ?? record.tripMoney ?? record.estimate ?? record.totalCost ?? record.monthlyRent ?? record.amountDue ?? record.amountPaid ?? 0) || 0;
}

function uploadJson(bucket, state, generation) {
  const payload = Buffer.from(JSON.stringify(state), "utf8");
  return new Promise((resolve, reject) => {
    const upload = bucket.openUploadStream(`driver-fleet-state-${generation}.json`, {
      contentType: "application/json",
      metadata: { generation, purpose: "driver-fleet-state" }
    });
    upload.once("error", reject);
    upload.once("finish", () => resolve(upload.id));
    upload.end(payload);
  });
}

function downloadJson(bucket, fileId) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const download = bucket.openDownloadStream(fileId);
    download.on("data", (chunk) => chunks.push(chunk));
    download.once("error", reject);
    download.once("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(new Error(`MongoDB state contains invalid JSON: ${error.message}`));
      }
    });
  });
}

class MongoStore {
  constructor({ uri, dbName }) {
    if (!uri) throw new Error("MONGODB_URI is required.");
    this.dbName = dbName || "fleetwebco";
    this.client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 15000,
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true
      }
    });
  }

  async connect() {
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    await this.db.command({ ping: 1 });
    this.stateMeta = this.db.collection("app_state");
    this.records = this.db.collection("app_records");
    this.audit = this.db.collection("audit_log");
    this.bucket = new GridFSBucket(this.db, { bucketName: "app_state_files" });
    await Promise.all([
      this.records.createIndex({ generation: 1, collection: 1 }),
      this.records.createIndex({ generation: 1, vendorId: 1 }),
      this.records.createIndex({ generation: 1, date: 1 }),
      this.audit.createIndex({ at: -1 })
    ]);
  }

  async getState() {
    const meta = await this.stateMeta.findOne({ _id: "main" });
    if (!meta?.fileId) return { state: null, updatedAt: null };
    return {
      state: await downloadJson(this.bucket, meta.fileId),
      updatedAt: meta.updatedAt || null
    };
  }

  async saveState(state, action = "api_state_put") {
    const now = new Date();
    const generation = randomUUID();
    const previous = await this.stateMeta.findOne({ _id: "main" });
    let fileId;

    try {
      fileId = await uploadJson(this.bucket, state, generation);
      const metadata = [];
      for (const collection of recordCollections) {
        const records = Array.isArray(state[collection]) ? state[collection] : [];
        records.forEach((record, index) => {
          const recordId = String(record.id || `${collection}_${index + 1}`);
          metadata.push({
            _id: `${generation}:${collection}:${recordId}`,
            generation,
            collection,
            recordId,
            vendorId: String(record.vendorId || ""),
            name: recordName(record),
            date: recordDate(record),
            amount: recordAmount(record),
            status: String(record.status || ""),
            sortOrder: index,
            updatedAt: now
          });
        });
      }
      metadata.push({
        _id: `${generation}:settings:main`,
        generation,
        collection: "settings",
        recordId: "main",
        vendorId: "",
        name: String(state.settings?.appName || "Driver Fleet"),
        date: "",
        amount: 0,
        status: "",
        sortOrder: 0,
        updatedAt: now
      });

      if (metadata.length) await this.records.insertMany(metadata, { ordered: false });
      await this.stateMeta.replaceOne(
        { _id: "main" },
        { _id: "main", fileId, generation, updatedAt: now },
        { upsert: true }
      );
      await this.audit.insertOne({
        _id: `audit_${Date.now()}_${randomUUID().slice(0, 8)}`,
        at: now,
        action,
        detail: "Application state saved."
      });
    } catch (error) {
      await Promise.allSettled([
        fileId ? this.bucket.delete(fileId) : Promise.resolve(),
        this.records.deleteMany({ generation })
      ]);
      throw error;
    }

    await Promise.allSettled([
      previous?.fileId ? this.bucket.delete(previous.fileId) : Promise.resolve(),
      this.records.deleteMany({ generation: { $ne: generation } })
    ]);
    return { updatedAt: now.toISOString() };
  }

  async status() {
    const meta = await this.stateMeta.findOne({ _id: "main" });
    const counts = meta?.generation
      ? await this.records.aggregate([
          { $match: { generation: meta.generation } },
          { $group: { _id: "$collection", count: { $sum: 1 } } },
          { $sort: { _id: 1 } }
        ]).toArray()
      : [];
    const latest = await this.audit.find().sort({ at: -1 }).limit(1).next();
    return {
      dbName: this.dbName,
      counts: counts.map((item) => ({ collection: item._id, count: item.count })),
      latest: latest ? { at: latest.at, action: latest.action, detail: latest.detail } : null,
      updatedAt: meta?.updatedAt || null
    };
  }

  async ping() {
    await this.db.command({ ping: 1 });
  }

  async close() {
    await this.client.close();
  }
}

module.exports = { MongoStore };
