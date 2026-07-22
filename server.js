const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { createHmac, randomUUID, timingSafeEqual } = require("crypto");
const { URL } = require("url");

require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
const { MongoStore } = require("./mongo-store");
const { FileStore } = require("./file-store");
const { migrateLeasingState } = require("./state-migration");

const root = __dirname;
const port = Number(process.env.PORT || 4330);
const maxBodyBytes = 80 * 1024 * 1024;
const useMongo = Boolean(process.env.MONGODB_URI);
const enableBasicAuth = ["1", "true", "yes"].includes(String(process.env.ENABLE_BASIC_AUTH || "").trim().toLowerCase());
const store = useMongo
  ? new MongoStore({ uri: process.env.MONGODB_URI, dbName: process.env.MONGODB_DB })
  : new FileStore({ filePath: path.join(root, "data", "local-state.json") });

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isPublicRequest(pathname) {
  return pathname === "/booking" ||
    pathname.startsWith("/booking/") ||
    pathname.startsWith("/api/public/") ||
    ["/index.html", "/app.js", "/styles.css", "/manifest.json"].includes(pathname);
}

function authorizeRequest(req, res, pathname) {
  if (pathname === "/api/health") return true;
  if (!enableBasicAuth) return true;
  const expectedUser = process.env.APP_ACCESS_USER;
  const expectedPassword = process.env.APP_ACCESS_PASSWORD;
  if (!expectedUser && !expectedPassword) return true;

  const header = String(req.headers.authorization || "");
  if (header.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      const user = separator >= 0 ? decoded.slice(0, separator) : "";
      const password = separator >= 0 ? decoded.slice(separator + 1) : "";
      if (secureEqual(user, expectedUser) && secureEqual(password, expectedPassword)) return true;
    } catch (_) {}
  }

  res.writeHead(401, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": 23,
    "Cache-Control": "no-store",
    "WWW-Authenticate": 'Basic realm="Driver Fleet"'
  });
  res.end("Authentication required");
  return false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function bookingAmountRupees() {
  return Math.max(1, Number(process.env.BOOKING_DEPOSIT_AMOUNT || 100) || 100);
}

function bookingAmountPaise() {
  return Math.round(bookingAmountRupees() * 100);
}

function razorpayConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

function bookingPaymentMode() {
  const configuredMode = String(process.env.PAYMENT_MODE || process.env.BOOKING_PAYMENT_MODE || "").trim().toLowerCase();
  if (["razorpay", "live"].includes(configuredMode)) return "razorpay";
  if (["test", "demo", "mock"].includes(configuredMode)) return "test";
  return razorpayConfigured() ? "razorpay" : "test";
}

function bookingPaymentEnabled() {
  return bookingPaymentMode() === "test" || razorpayConfigured();
}

function testOrderId() {
  return `test_order_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

function testPaymentId() {
  return `test_pay_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

function bookingCode() {
  return `BK${Date.now().toString(36).toUpperCase()}${randomUUID().slice(0, 4).toUpperCase()}`;
}

function bookingHoldMinutes() {
  return Math.max(1, Number(process.env.BOOKING_HOLD_MINUTES || 30) || 30);
}

function parseDateOnly(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return null;
  return date.getTime();
}

function bookingDateRange(pickupDate, returnDate) {
  const start = parseDateOnly(pickupDate);
  const end = parseDateOnly(returnDate);
  if (start == null || end == null || end < start) return null;
  return { start, end };
}

function validatePublicBookingDates(pickupDate, returnDate) {
  const start = parseDateOnly(pickupDate);
  const end = parseDateOnly(returnDate);
  if (start == null || end == null) return "Pickup date and return date must be valid dates.";
  if (end < start) return "Return date must be the same day or after pickup date.";
  return "";
}

function dateRangesOverlap(left, right) {
  return Boolean(left && right && left.start <= right.end && right.start <= left.end);
}

function bookingStillHoldsInventory(booking) {
  const status = String(booking.status || "").toLowerCase();
  const paymentStatus = String(booking.paymentStatus || "").toLowerCase();
  if (["cancelled", "canceled", "rejected", "expired"].includes(status)) return false;
  if (["failed", "cancelled", "canceled", "refunded"].includes(paymentStatus)) return false;
  if (paymentStatus === "paid" || ["confirmed", "accepted", "assigned"].includes(status)) return true;
  if (["pending_payment", "new"].includes(status)) {
    const createdAt = Date.parse(booking.createdAt || booking.updatedAt || "");
    return Number.isFinite(createdAt) && Date.now() - createdAt <= bookingHoldMinutes() * 60 * 1000;
  }
  return false;
}

function vehicleDisplayName(vehicle) {
  return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || vehicle.unitNumber || vehicle.plate || "Selected car";
}

function unavailableVehicleIds(state, pickupDate, returnDate) {
  const blockedIds = new Set((Array.isArray(state.leases) ? state.leases : [])
    .filter((lease) => lease.status === "active")
    .map((lease) => lease.vehicleId)
    .filter(Boolean));
  const requestedRange = bookingDateRange(pickupDate, returnDate);
  if (!requestedRange) return blockedIds;

  (Array.isArray(state.bookings) ? state.bookings : []).forEach((booking) => {
    if (!booking.vehicleId || !bookingStillHoldsInventory(booking)) return;
    const bookedRange = bookingDateRange(booking.pickupDate, booking.returnDate);
    if (dateRangesOverlap(requestedRange, bookedRange)) blockedIds.add(booking.vehicleId);
  });
  return blockedIds;
}

function publicVehicleOptions(state, pickupDate = "", returnDate = "") {
  const unavailableIds = unavailableVehicleIds(state, pickupDate, returnDate);
  const vendors = new Map((Array.isArray(state.vendors) ? state.vendors : []).map((vendor) => [vendor.id, vendor]));
  return (Array.isArray(state.vehicles) ? state.vehicles : [])
    .filter((vehicle) => ["available", "active"].includes(vehicle.status) && !unavailableIds.has(vehicle.id))
    .map((vehicle) => ({
      id: vehicle.id,
      vendorId: vehicle.vendorId || "",
      vendorName: vendors.get(vehicle.vendorId)?.companyName || "Fleet",
      label: vehicleDisplayName(vehicle),
      unitNumber: vehicle.unitNumber || "",
      plate: vehicle.plate || "",
      mileage: vehicle.mileage || 0
    }));
}

function publicVendorOptions(state) {
  return (Array.isArray(state.vendors) ? state.vendors : [])
    .filter((vendor) => vendor.status !== "suspended")
    .map((vendor) => ({ id: vendor.id, companyName: vendor.companyName || "Fleet" }));
}

async function loadMigratedState() {
  const result = await store.getState();
  const migrated = migrateLeasingState(result.state || {});
  return { state: migrated.state, updatedAt: result.updatedAt };
}

function razorpayPost(apiPath, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request({
      hostname: "api.razorpay.com",
      path: apiPath,
      method: "POST",
      auth: `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed = {};
        try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(parsed);
          return;
        }
        reject(new Error(parsed.error?.description || parsed.error?.reason || `Razorpay returned ${response.statusCode}.`));
      });
    });
    request.on("error", reject);
    request.end(body);
  });
}

function verifyRazorpayPayment(orderId, paymentId, signature) {
  if (!razorpayConfigured() || !orderId || !paymentId || !signature) return false;
  const expected = createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return secureEqual(expected, signature);
}

function verifyRazorpayWebhook(rawBody, signature) {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET || !signature) return false;
  const expected = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  return secureEqual(expected, signature);
}

let bookingSaveQueue = Promise.resolve();
async function saveBookingUpdate(update, action) {
  const run = async () => {
    const { state } = await loadMigratedState();
    const payload = await update(state);
    const saved = await store.saveState(state, action);
    return { ...payload, updatedAt: saved.updatedAt };
  };
  const next = bookingSaveQueue.then(run, run);
  bookingSaveQueue = next.catch(() => {});
  return next;
}

function publicBookingResponse(booking) {
  return {
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    customerName: booking.customerName,
    phone: booking.phone,
    pickupDate: booking.pickupDate,
    returnDate: booking.returnDate
  };
}

function publicBookingDatesFromRequest(req) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pickupDate = String(requestUrl.searchParams.get("pickupDate") || "").trim();
  let returnDate = String(requestUrl.searchParams.get("returnDate") || "").trim();
  if (pickupDate && (!returnDate || returnDate < pickupDate)) returnDate = pickupDate;
  return { pickupDate, returnDate };
}

async function routePublicApi(req, res, pathname) {
  if (pathname === "/api/public/booking/config" && req.method === "GET") {
    const { state } = await loadMigratedState();
    const mode = bookingPaymentMode();
    const dates = publicBookingDatesFromRequest(req);
    jsonResponse(res, 200, {
      ok: true,
      payment: {
        provider: mode,
        mode,
        enabled: bookingPaymentEnabled(),
        testMode: mode === "test",
        keyId: mode === "razorpay" ? process.env.RAZORPAY_KEY_ID || "" : "",
        amount: bookingAmountRupees(),
        amountPaise: bookingAmountPaise(),
        currency: "INR",
        methods: mode === "test" ? ["Test UPI", "Test Card", "Test Wallet"] : ["UPI", "Card", "Netbanking", "Wallet"]
      },
      vendors: publicVendorOptions(state),
      vehicles: publicVehicleOptions(state, dates.pickupDate, dates.returnDate)
    });
    return true;
  }

  if (pathname === "/api/public/bookings" && req.method === "POST") {
    const mode = bookingPaymentMode();
    if (mode === "razorpay" && !razorpayConfigured()) {
      jsonResponse(res, 503, { ok: false, error: "Razorpay keys are not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env." });
      return true;
    }
    const body = await readBody(req);
    const customerName = String(body.customerName || "").trim();
    const phone = String(body.phone || "").trim();
    const pickupDate = String(body.pickupDate || "").trim();
    const returnDate = String(body.returnDate || "").trim();
    const requestedVehicleId = String(body.vehicleId || "").trim();
    if (!customerName || !phone || !pickupDate || !returnDate) {
      jsonResponse(res, 400, { ok: false, error: "Name, phone, pickup date, and return date are required." });
      return true;
    }
    const dateError = validatePublicBookingDates(pickupDate, returnDate);
    if (dateError) {
      jsonResponse(res, 400, { ok: false, error: dateError });
      return true;
    }

    let result;
    try {
      result = await saveBookingUpdate(async (state) => {
      const availableVehicles = publicVehicleOptions(state, pickupDate, returnDate);
      if (!availableVehicles.length) {
        const error = new Error("No cars are available for the selected dates. Please choose different dates.");
        error.status = 409;
        error.availableVehicles = [];
        throw error;
      }

      const availableVehicle = requestedVehicleId
        ? availableVehicles.find((item) => item.id === requestedVehicleId)
        : availableVehicles[0];
      if (requestedVehicleId && !availableVehicle) {
        const selectedVehicle = (Array.isArray(state.vehicles) ? state.vehicles : []).find((item) => item.id === requestedVehicleId);
        const error = new Error(`${selectedVehicle ? vehicleDisplayName(selectedVehicle) : "That car"} is already booked for those dates. Please choose another available car.`);
        error.status = 409;
        error.availableVehicles = availableVehicles;
        error.vehicleConflict = true;
        throw error;
      }

      const vehicle = (Array.isArray(state.vehicles) ? state.vehicles : []).find((item) => item.id === availableVehicle.id) || null;
      const vendor = (Array.isArray(state.vendors) ? state.vendors : []).find((item) => item.id === (body.vendorId || vehicle?.vendorId)) || (Array.isArray(state.vendors) ? state.vendors[0] : null);
      if (!vendor) throw new Error("No active fleet company is available for public bookings.");

      const booking = {
        id: `booking_${Date.now()}_${randomUUID().slice(0, 8)}`,
        bookingCode: bookingCode(),
        vendorId: vendor.id,
        customerName,
        phone,
        email: String(body.email || "").trim(),
        vehicleId: vehicle?.id || "",
        vehicleLabel: vehicle ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") : String(body.carType || "Rent a car"),
        carType: String(body.carType || "").trim(),
        pickupDate,
        returnDate,
        pickupLocation: String(body.pickupLocation || "").trim(),
        notes: String(body.notes || "").trim(),
        bookingFee: bookingAmountRupees(),
        currency: "INR",
        status: "pending_payment",
        paymentStatus: "pending",
        paymentProvider: mode,
        paymentOrderId: "",
        paymentId: "",
        razorpayOrderId: "",
        razorpayPaymentId: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const order = mode === "razorpay"
        ? await razorpayPost("/v1/orders", {
          amount: bookingAmountPaise(),
          currency: "INR",
          receipt: booking.bookingCode,
          notes: {
            bookingId: booking.id,
            bookingCode: booking.bookingCode,
            customerName: booking.customerName,
            phone: booking.phone
          }
        })
        : { id: testOrderId(), status: "created" };

      booking.paymentOrderId = order.id;
      booking.razorpayOrderId = order.id;
      state.bookings.unshift(booking);
      state.bookingPayments.unshift({
        id: `payment_${Date.now()}_${randomUUID().slice(0, 8)}`,
        vendorId: booking.vendorId,
        bookingId: booking.id,
        bookingCode: booking.bookingCode,
        provider: mode,
        amount: booking.bookingFee,
        amountPaise: bookingAmountPaise(),
        currency: "INR",
        paymentOrderId: order.id,
        paymentId: "",
        razorpayOrderId: order.id,
        razorpayPaymentId: "",
        status: "created",
        method: "",
        createdAt: new Date().toISOString(),
        paidAt: ""
      });

      return { booking, order };
      }, "public_booking_order_created");
    } catch (error) {
      jsonResponse(res, error.status || 500, {
        ok: false,
        error: error.message || "Booking payment could not start.",
        vehicleConflict: Boolean(error.vehicleConflict),
        availableVehicles: Array.isArray(error.availableVehicles) ? error.availableVehicles : []
      });
      return true;
    }

    jsonResponse(res, 200, {
      ok: true,
      mode,
      provider: mode,
      testMode: mode === "test",
      keyId: mode === "razorpay" ? process.env.RAZORPAY_KEY_ID : "",
      amountPaise: bookingAmountPaise(),
      amount: bookingAmountRupees(),
      currency: "INR",
      orderId: result.order.id,
      booking: publicBookingResponse(result.booking)
    });
    return true;
  }

  if (pathname === "/api/public/bookings/verify" && req.method === "POST") {
    const body = await readBody(req);
    const orderId = String(body.razorpay_order_id || body.orderId || "");
    const isTestPayment = String(body.mode || body.provider || "").toLowerCase() === "test" || orderId.startsWith("test_order_");
    const paymentId = String(body.razorpay_payment_id || body.paymentId || body.test_payment_id || (isTestPayment ? testPaymentId() : ""));
    const signature = String(body.razorpay_signature || body.signature || "");
    if (isTestPayment && bookingPaymentMode() !== "test") {
      jsonResponse(res, 400, { ok: false, error: "Test payments are disabled. Set PAYMENT_MODE=test to use the test checkout." });
      return true;
    }
    if (!isTestPayment && !verifyRazorpayPayment(orderId, paymentId, signature)) {
      jsonResponse(res, 400, { ok: false, error: "Payment verification failed." });
      return true;
    }

    const result = await saveBookingUpdate((state) => {
      const booking = state.bookings.find((item) => item.id === body.bookingId || item.razorpayOrderId === orderId);
      if (!booking) throw new Error("Booking record was not found.");
      const provider = isTestPayment ? "test" : "razorpay";
      booking.status = "confirmed";
      booking.paymentStatus = "paid";
      booking.paymentProvider = provider;
      booking.paymentOrderId = orderId;
      booking.paymentId = paymentId;
      booking.razorpayOrderId = orderId;
      booking.razorpayPaymentId = paymentId;
      booking.paidAt = new Date().toISOString();
      booking.updatedAt = new Date().toISOString();

      const payment = state.bookingPayments.find((item) => item.bookingId === booking.id && item.razorpayOrderId === orderId);
      if (payment) {
        payment.provider = provider;
        payment.paymentId = paymentId;
        payment.razorpayPaymentId = paymentId;
        payment.status = "paid";
        payment.method = isTestPayment ? String(body.method || "test_upi") : payment.method;
        payment.paidAt = booking.paidAt;
      } else {
        state.bookingPayments.unshift({
          id: `payment_${Date.now()}_${randomUUID().slice(0, 8)}`,
          vendorId: booking.vendorId,
          bookingId: booking.id,
          bookingCode: booking.bookingCode,
          provider,
          amount: booking.bookingFee,
          amountPaise: bookingAmountPaise(),
          currency: "INR",
          paymentOrderId: orderId,
          paymentId,
          razorpayOrderId: orderId,
          razorpayPaymentId: paymentId,
          status: "paid",
          method: isTestPayment ? String(body.method || "test_upi") : "",
          createdAt: booking.createdAt,
          paidAt: booking.paidAt
        });
      }
      return { booking };
    }, "public_booking_payment_verified");

    jsonResponse(res, 200, { ok: true, booking: publicBookingResponse(result.booking) });
    return true;
  }

  if (pathname === "/api/public/payments/razorpay-webhook" && req.method === "POST") {
    const raw = await readRawBody(req);
    const signature = String(req.headers["x-razorpay-signature"] || "");
    if (!verifyRazorpayWebhook(raw, signature)) {
      jsonResponse(res, 400, { ok: false, error: "Invalid webhook signature." });
      return true;
    }

    const event = JSON.parse(raw.toString("utf8") || "{}");
    const payment = event.payload?.payment?.entity || {};
    const order = event.payload?.order?.entity || {};
    const orderId = payment.order_id || order.id || "";
    const paymentId = payment.id || "";
    if (orderId && ["payment.captured", "order.paid"].includes(event.event)) {
      await saveBookingUpdate((state) => {
        const booking = state.bookings.find((item) => item.razorpayOrderId === orderId);
        if (!booking) return { booking: null };
        booking.status = "confirmed";
        booking.paymentStatus = "paid";
        booking.razorpayPaymentId = paymentId || booking.razorpayPaymentId;
        booking.paidAt = new Date().toISOString();
        booking.updatedAt = new Date().toISOString();
        const record = state.bookingPayments.find((item) => item.bookingId === booking.id && item.razorpayOrderId === orderId);
        if (record) {
          record.razorpayPaymentId = paymentId || record.razorpayPaymentId;
          record.status = "paid";
          record.method = payment.method || record.method || "";
          record.paidAt = booking.paidAt;
        }
        return { booking };
      }, "razorpay_webhook_payment_confirmed");
    }

    jsonResponse(res, 200, { ok: true });
    return true;
  }

  return false;
}

function normalizedPhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function driverPhoneGroups(state) {
  const groups = new Map();
  for (const driver of Array.isArray(state?.drivers) ? state.drivers : []) {
    const key = normalizedPhone(driver.phone);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(driver);
  }
  return groups;
}

function validateDriverPhones(state, existingState) {
  const seen = new Map();
  for (const driver of Array.isArray(state?.drivers) ? state.drivers : []) {
    const key = normalizedPhone(driver.phone);
    if (key.length < 7 || key.length > 15) {
      return `Driver ${driver.name || driver.id || "record"} has an invalid mobile number.`;
    }
    if (seen.has(key)) continue;
    seen.set(key, driver.name || driver.id || "Driver");
  }

  const existingGroups = driverPhoneGroups(existingState);
  for (const [phone, drivers] of driverPhoneGroups(state)) {
    if (drivers.length < 2) continue;
    const previousIds = new Set((existingGroups.get(phone) || []).map((driver) => String(driver.id || "")));
    const keepsOnlyLegacyDuplicates = previousIds.size >= drivers.length
      && drivers.every((driver) => previousIds.has(String(driver.id || "")));
    if (!keepsOnlyLegacyDuplicates) {
      return `Mobile number is duplicated for ${drivers[0].name || drivers[0].id || "a driver"} and ${drivers[1].name || drivers[1].id || "another driver"}.`;
    }
  }
  return "";
}

async function routeApi(req, res, pathname) {
  if (pathname === "/api/state" && req.method === "GET") {
    const result = await store.getState();
    const migrated = result.state ? migrateLeasingState(result.state) : { state: null, summary: null };
    jsonResponse(res, 200, { ok: true, state: migrated.state, migration: migrated.summary, updatedAt: result.updatedAt });
    return true;
  }
  if (pathname === "/api/state" && req.method === "PUT") {
    const incomingState = await readBody(req);
    const migrated = migrateLeasingState(incomingState);
    const existing = await store.getState();
    const validationError = validateDriverPhones(migrated.state, existing.state);
    if (validationError) {
      jsonResponse(res, 409, { ok: false, error: validationError });
      return true;
    }
    const result = await store.saveState(migrated.state, "api_state_put");
    jsonResponse(res, 200, { ok: true, updatedAt: result.updatedAt });
    return true;
  }
  if (pathname === "/api/db/status" && req.method === "GET") {
    jsonResponse(res, 200, { ok: true, database: useMongo ? "MongoDB" : "Local file", ...(await store.status()) });
    return true;
  }
  if (pathname === "/api/health" && req.method === "GET") {
    await store.ping();
    jsonResponse(res, 200, { ok: true, app: "Driver Fleet", database: useMongo ? "MongoDB connected" : "Local file storage" });
    return true;
  }
  return false;
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function staticFile(req, res, pathname) {
  const requested = pathname === "/" || pathname === "/booking" || pathname.startsWith("/booking/") ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(root, requested);
  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    jsonResponse(res, 404, { ok: false, error: "Not found" });
    return;
  }
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "Content-Length": stat.size,
    "Cache-Control": "no-cache"
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/public/")) {
      if (!(await routePublicApi(req, res, url.pathname))) jsonResponse(res, 404, { ok: false, error: "Unknown public API route" });
      return;
    }
    if (!isPublicRequest(url.pathname) && !authorizeRequest(req, res, url.pathname)) return;
    if (url.pathname.startsWith("/api/")) {
      if (!(await routeApi(req, res, url.pathname))) jsonResponse(res, 404, { ok: false, error: "Unknown API route" });
      return;
    }
    staticFile(req, res, url.pathname);
  } catch (error) {
    jsonResponse(res, 500, { ok: false, error: error.message || "Server error" });
  }
});

async function start() {
  if (enableBasicAuth) {
    const hasAccessUser = Boolean(process.env.APP_ACCESS_USER);
    const hasAccessPassword = Boolean(process.env.APP_ACCESS_PASSWORD);
    if (hasAccessUser !== hasAccessPassword) {
      throw new Error("APP_ACCESS_USER and APP_ACCESS_PASSWORD must be configured together.");
    }
  }
  await store.connect();
  server.listen(port, "0.0.0.0", () => {
    console.log(`Driver Fleet running at http://localhost:${port}`);
    console.log(`${useMongo ? "MongoDB database" : "Local data store"}: ${useMongo ? store.dbName : path.join(root, "data", "local-state.json")}`);
  });
}

let shuttingDown = false;
function shutDown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(async () => {
    await store.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);

start().catch((error) => {
  console.error(`Driver Fleet failed to start: ${error.message}`);
  process.exit(1);
});
