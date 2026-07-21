const LEASING_SCHEMA_VERSION = 3;

const collections = [
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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function todayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function monthKey(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return todayKey().slice(0, 7);
  return date.toISOString().slice(0, 7);
}

function dueDateForPeriod(period, dueDay) {
  const day = String(Math.min(28, Math.max(1, Number(dueDay || 1)))).padStart(2, "0");
  return `${period}-${day}`;
}

function amount(value) {
  return Number(value || 0) || 0;
}

function cleanIdPart(value) {
  return String(value || "unknown").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 80);
}

function collectionById(records) {
  return new Map(asArray(records).map((record) => [String(record.id || ""), record]));
}

function inferMonthlyRent(state, driver, vehicle) {
  const explicit = [
    driver.monthlyRent,
    driver.leaseRent,
    driver.rentAmount,
    vehicle.monthlyRent,
    vehicle.leaseRent,
    vehicle.rentAmount
  ].map(amount).find((value) => value > 0);
  if (explicit) return explicit;

  const rentTrips = asArray(state.trips)
    .filter((trip) => trip.revenueSource === "rent" && trip.driverId === driver.id && trip.vehicleId === vehicle.id)
    .sort((left, right) => String(right.startDate || "").localeCompare(String(left.startDate || "")));
  return amount(rentTrips[0]?.tripMoney);
}

function hasActiveLease(state, driverId, vehicleId) {
  return asArray(state.leases).some((lease) => {
    if (lease.status !== "active") return false;
    return lease.driverId === driverId || lease.vehicleId === vehicleId;
  });
}

function addDriverDocument(state, summary, driver, config) {
  const fileName = driver[config.nameField];
  const fileData = driver[config.dataField];
  if (!fileName && !fileData) return;

  const id = `doc_migrated_${cleanIdPart(driver.id)}_${config.type}`;
  if (state.documents.some((document) => document.id === id)) return;

  state.documents.push({
    id,
    vendorId: driver.vendorId || "",
    ownerType: "driver",
    ownerId: driver.id,
    type: config.type,
    name: config.name,
    fileName: fileName || config.name,
    fileData: fileData || "",
    expiryDate: driver[config.expiryField] || "",
    uploadedAt: new Date().toISOString()
  });
  summary.documentsCreated += 1;
}

function ensureDriverDocuments(state, summary) {
  asArray(state.drivers).forEach((driver) => {
    addDriverDocument(state, summary, driver, {
      type: "driver_license",
      name: "Driving license",
      nameField: "licensePhotoName",
      dataField: "licensePhotoData",
      expiryField: "licenseExpiry"
    });
    addDriverDocument(state, summary, driver, {
      type: "insurance",
      name: "Insurance document",
      nameField: "insuranceDocName",
      dataField: "insuranceDocData",
      expiryField: "insuranceExpiry"
    });
    addDriverDocument(state, summary, driver, {
      type: "driver_agreement",
      name: "Driver agreement",
      nameField: "agreementName",
      dataField: "agreementData",
      expiryField: ""
    });
  });
}

function ensureLeaseMileage(state, summary, lease, vehicle) {
  const exists = state.mileageReadings.some((reading) => reading.leaseId === lease.id && reading.type === "start");
  if (exists) return;

  state.mileageReadings.push({
    id: `mile_migrated_${cleanIdPart(lease.id)}_start`,
    vendorId: lease.vendorId || "",
    leaseId: lease.id,
    driverId: lease.driverId,
    vehicleId: lease.vehicleId,
    date: lease.startDate || todayKey(),
    odometer: amount(lease.startOdometer || vehicle?.mileage),
    type: "start",
    notes: "Migrated from existing driver and vehicle assignment."
  });
  summary.mileageReadingsCreated += 1;
}

function ensureAssignmentLeases(state, summary) {
  const vehicles = collectionById(state.vehicles);
  const drivers = collectionById(state.drivers);

  asArray(state.vehicles).forEach((vehicle) => {
    if (vehicle.driverId && drivers.has(String(vehicle.driverId))) {
      const driver = drivers.get(String(vehicle.driverId));
      if (!driver.vehicleId) driver.vehicleId = vehicle.id;
    }
  });

  asArray(state.drivers).forEach((driver) => {
    if (!driver.vehicleId) return;
    const vehicle = vehicles.get(String(driver.vehicleId));
    if (!vehicle) return;

    if (!vehicle.driverId) vehicle.driverId = driver.id;
    if (hasActiveLease(state, driver.id, vehicle.id)) return;

    const leaseId = `lease_migrated_${cleanIdPart(driver.id)}_${cleanIdPart(vehicle.id)}`;
    const startDate = driver.leaseStartDate || driver.hireDate || vehicle.assignedDate || vehicle.boughtDate || todayKey();
    const monthlyRent = inferMonthlyRent(state, driver, vehicle);

    state.leases.push({
      id: leaseId,
      vendorId: driver.vendorId || vehicle.vendorId || "",
      driverId: driver.id,
      vehicleId: vehicle.id,
      startDate,
      expectedReturnDate: "",
      returnDate: "",
      monthlyRent,
      deposit: amount(driver.deposit || driver.leaseDeposit),
      rentDueDay: amount(driver.rentDueDay) || 1,
      startOdometer: amount(vehicle.mileage),
      returnOdometer: 0,
      status: "active",
      notes: monthlyRent
        ? "Migrated from existing driver/vehicle assignment. Review monthly rent and attach lease documents."
        : "Migrated from existing driver/vehicle assignment. Enter monthly rent and attach lease documents.",
      leaseDocName: "",
      leaseDoc: "",
      createdAt: new Date().toISOString()
    });

    if (vehicle.status === "active" || !vehicle.status) vehicle.status = "leased";
    ensureLeaseMileage(state, summary, state.leases[state.leases.length - 1], vehicle);
    summary.leasesCreated += 1;
  });
}

function ensureRentChargesFromLegacyRentTrips(state, summary) {
  const leases = asArray(state.leases);
  asArray(state.trips).forEach((trip) => {
    if (trip.revenueSource !== "rent") return;
    const lease = leases.find((item) => item.driverId === trip.driverId && item.vehicleId === trip.vehicleId && item.status === "active");
    if (!lease) return;

    const id = `rent_migrated_${cleanIdPart(trip.id)}`;
    if (state.rentCharges.some((charge) => charge.id === id || charge.reference === trip.id)) return;
    const period = monthKey(trip.startDate);
    const paid = amount(trip.tripMoney);

    state.rentCharges.push({
      id,
      vendorId: trip.vendorId || lease.vendorId || "",
      leaseId: lease.id,
      driverId: trip.driverId,
      vehicleId: trip.vehicleId,
      period,
      dueDate: trip.startDate || dueDateForPeriod(period, lease.rentDueDay),
      amountDue: paid,
      amountPaid: paid,
      paidAt: trip.endDate || trip.startDate || todayKey(),
      paymentMethod: "Migrated revenue",
      reference: trip.id,
      notes: `Migrated from legacy vehicle-rent revenue${trip.renterName ? ` for ${trip.renterName}` : ""}.`,
      receiptName: trip.proofName || "",
      receipt: trip.proof || "",
      status: "paid"
    });
    summary.rentChargesCreated += 1;
  });
}

function normalizeVehicleStatuses(state) {
  asArray(state.vehicles).forEach((vehicle) => {
    const activeLease = asArray(state.leases).some((lease) => lease.vehicleId === vehicle.id && lease.status === "active");
    if (activeLease && (vehicle.status === "active" || vehicle.status === "available" || !vehicle.status)) vehicle.status = "leased";
    if (!activeLease && vehicle.status === "active") vehicle.status = "available";
  });
}

function migrateLeasingState(input, options = {}) {
  const state = input && typeof input === "object" ? { ...input } : {};
  const summary = {
    changed: false,
    leasesCreated: 0,
    rentChargesCreated: 0,
    mileageReadingsCreated: 0,
    documentsCreated: 0,
    bookingCollectionsCreated: 0
  };

  collections.forEach((collection) => {
    if (!Array.isArray(state[collection])) {
      state[collection] = [];
      summary.changed = true;
      if (collection === "bookings" || collection === "bookingPayments") summary.bookingCollectionsCreated += 1;
    }
  });

  if (!state.settings || typeof state.settings !== "object") state.settings = {};

  ensureDriverDocuments(state, summary);
  ensureAssignmentLeases(state, summary);
  ensureRentChargesFromLegacyRentTrips(state, summary);
  asArray(state.leases).forEach((lease) => ensureLeaseMileage(state, summary, lease, collectionById(state.vehicles).get(String(lease.vehicleId))));
  normalizeVehicleStatuses(state);

  const previousVersion = Number(state.schemaVersion || state.version || 1);
  state.schemaVersion = Math.max(previousVersion, LEASING_SCHEMA_VERSION);
  state.version = Math.max(Number(state.version || 1), 1);

  summary.changed = summary.changed ||
    summary.leasesCreated > 0 ||
    summary.rentChargesCreated > 0 ||
    summary.mileageReadingsCreated > 0 ||
    summary.documentsCreated > 0 ||
    previousVersion < LEASING_SCHEMA_VERSION;

  return { state, summary };
}

module.exports = { LEASING_SCHEMA_VERSION, migrateLeasingState };
