(function () {
  'use strict';

  var STORAGE_KEY = 'driver_fleet_box_v1';
  var app = document.getElementById('app');
  var state = loadState();
  var ui = {
    module: 'dashboard',
    query: '',
    status: 'all',
    form: '',
    notice: '',
    menuOpen: false,
    detail: null,
    media: null,
    editing: null
  };
  var publicBooking = {
    loaded: false,
    loading: false,
    submitting: false,
    config: null,
    values: {},
    confirmation: null,
    testCheckout: null,
    error: ''
  };
  var pendingProof = '';
  var pendingProofName = '';
  var pendingMedia = {};
  var saveTimer = null;
  var searchTimer = null;

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function uid(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }

  function money(value) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value) || 0);
  }

  function inr(value) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value) || 0);
  }

  function number(value) {
    return new Intl.NumberFormat('en-US').format(Number(value) || 0);
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function isPublicBookingRoute() {
    return window.location.pathname.replace(/\/+$/, '') === '/booking';
  }

  function phoneKey(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function slug(value, fallback) {
    var output = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);
    return output || fallback || uid('login').replace(/_/g, '');
  }

  function userLoginValue(email, name, fallback, existingUserId) {
    var emailValue = String(email || '').trim();
    if (emailValue) return emailValue;

    var base = slug(name, fallback);
    var candidate = base;
    var suffix = 2;
    while (state.users.some(function (user) {
      if (existingUserId && user.id === existingUserId) return false;
      return String(user.email || '').toLowerCase() === candidate || String(user.username || '').toLowerCase() === candidate;
    })) {
      candidate = base + suffix;
      suffix += 1;
    }
    return candidate;
  }

  function driverPhoneValidationMessage(value, excludeDriverId) {
    var key = phoneKey(value);
    if (key.length < 7 || key.length > 15) return 'Enter a valid mobile number containing 7 to 15 digits.';
    var duplicate = state.drivers.find(function (driver) {
      return driver.id !== excludeDriverId && phoneKey(driver.phone) === key;
    });
    return duplicate ? 'This mobile number is already used by ' + duplicate.name + '.' : '';
  }

  function initialState() {
    return {
      version: 1,
      settings: {
        appName: 'Driver Fleet',
        supportPhone: '+1 (555) 010-2200',
        supportEmail: 'support@driverfleet.com',
        distanceUnit: 'mi',
        currency: 'USD',
        bookingCurrency: 'INR',
        bookingDepositAmount: 100
      },
      users: [
        { id: 'user_owner', role: 'platform_owner', name: 'Platform Owner', email: 'owner@driverfleet.com', password: 'owner123', vendorId: '', active: true },
        { id: 'user_north_admin', role: 'vendor_admin', name: 'Ava Morgan', email: 'admin@northstar.com', password: 'admin123', vendorId: 'vendor_northstar', active: true },
        { id: 'user_north_driver', role: 'driver', name: 'Marcus Reed', email: 'driver@northstar.com', password: 'driver123', vendorId: 'vendor_northstar', driverId: 'driver_marcus', active: true },
        { id: 'user_blue_admin', role: 'vendor_admin', name: 'Daniel Kim', email: 'admin@blueroute.com', password: 'admin123', vendorId: 'vendor_blueroute', active: true }
      ],
      vendors: [
        {
          id: 'vendor_northstar', companyName: 'NorthStar Logistics', owner: 'Ava Morgan', phone: '+1 312 555 0188',
          email: 'dispatch@northstar.com', plan: 'Enterprise', status: 'active', color: '#0b6bcb', accent: '#14b8a6',
          approvalLimit: 500, requireProof: false,
          expenseCategories: ['Fuel', 'Toll', 'Parking', 'Scale ticket', 'Challan', 'Repair'],
          maintenanceTypes: ['Oil change', 'Tire', 'Brake', 'DOT inspection', 'Trailer repair']
        },
        {
          id: 'vendor_blueroute', companyName: 'BlueRoute Transport', owner: 'Daniel Kim', phone: '+1 404 555 0174',
          email: 'ops@blueroute.com', plan: 'Growth', status: 'active', color: '#7c3aed', accent: '#f59e0b',
          approvalLimit: 300, requireProof: false,
          expenseCategories: ['Fuel', 'Toll', 'Lumpar', 'Parking', 'Repair'],
          maintenanceTypes: ['Oil change', 'Tire', 'Reefer service', 'Engine repair']
        }
      ],
      vehicles: [
        { id: 'vehicle_101', vendorId: 'vendor_northstar', unitNumber: 'NS-101', make: 'Freightliner', model: 'Cascadia', year: 2022, vin: '1FUJGLDR7NLAA0101', plate: 'IL 92F 101', mileage: 286420, boughtDate: '2022-03-15', totalCost: 162000, loanBalance: 78400, monthlyPayment: 2950, status: 'leased', driverId: 'driver_marcus' },
        { id: 'vehicle_205', vendorId: 'vendor_northstar', unitNumber: 'NS-205', make: 'Volvo', model: 'VNL 860', year: 2021, vin: '4V4NC9EH5MNAA0205', plate: 'IL 71V 205', mileage: 412850, boughtDate: '2021-08-02', totalCost: 148000, loanBalance: 42600, monthlyPayment: 2780, status: 'maintenance', driverId: 'driver_elena' },
        { id: 'vehicle_310', vendorId: 'vendor_blueroute', unitNumber: 'BR-310', make: 'Kenworth', model: 'T680', year: 2023, vin: '1XKYDP9X7PJAA0310', plate: 'GA P310BR', mileage: 178230, boughtDate: '2023-01-12', totalCost: 184000, loanBalance: 132000, monthlyPayment: 3240, status: 'leased', driverId: 'driver_james' },
        { id: 'vehicle_420', vendorId: 'vendor_northstar', unitNumber: 'NS-420', make: 'Toyota', model: 'Camry', year: 2023, vin: '4T1C11AK7PU103822', plate: 'IL LSE 420', mileage: 28420, boughtDate: '2025-11-04', totalCost: 28500, loanBalance: 16200, monthlyPayment: 620, status: 'available', driverId: '' }
      ],
      drivers: [
        { id: 'driver_marcus', vendorId: 'vendor_northstar', name: 'Marcus Reed', phone: '+1 312 555 0107', email: 'driver@northstar.com', license: 'IL-D291-0441', licenseExpiry: '2027-08-18', address: 'Chicago, IL', emergencyContact: 'Nina Reed · +1 312 555 0118', vehicleId: 'vehicle_101', status: 'active', hireDate: '2023-02-11' },
        { id: 'driver_elena', vendorId: 'vendor_northstar', name: 'Elena Ortiz', phone: '+1 773 555 0192', email: 'elena@northstar.com', license: 'IL-O882-1091', licenseExpiry: '2026-10-04', address: 'Aurora, IL', emergencyContact: 'Luis Ortiz · +1 773 555 0131', vehicleId: 'vehicle_205', status: 'active', hireDate: '2022-09-05' },
        { id: 'driver_james', vendorId: 'vendor_blueroute', name: 'James Carter', phone: '+1 404 555 0140', email: 'james@blueroute.com', license: 'GA-C119-4302', licenseExpiry: '2027-04-22', address: 'Atlanta, GA', emergencyContact: 'Mia Carter · +1 404 555 0161', vehicleId: 'vehicle_310', status: 'active', hireDate: '2024-01-08' }
      ],
      leases: [
        { id: 'lease_1001', vendorId: 'vendor_northstar', driverId: 'driver_marcus', vehicleId: 'vehicle_101', startDate: '2026-07-01', expectedReturnDate: '2026-12-31', returnDate: '', monthlyRent: 3200, deposit: 1500, rentDueDay: 5, startOdometer: 285900, returnOdometer: 0, status: 'active', notes: 'Monthly lease. Driver responsible for fuel and tolls.', leaseDocName: 'NS-101 lease agreement.pdf', leaseDoc: '', createdAt: '2026-07-01T10:00:00.000Z' },
        { id: 'lease_2001', vendorId: 'vendor_blueroute', driverId: 'driver_james', vehicleId: 'vehicle_310', startDate: '2026-07-10', expectedReturnDate: '2026-10-10', returnDate: '', monthlyRent: 2850, deposit: 1200, rentDueDay: 10, startOdometer: 177900, returnOdometer: 0, status: 'active', notes: 'Three month starter lease.', leaseDocName: 'BR-310 lease agreement.pdf', leaseDoc: '', createdAt: '2026-07-10T10:00:00.000Z' }
      ],
      rentCharges: [
        { id: 'rent_1001_2026_07', vendorId: 'vendor_northstar', leaseId: 'lease_1001', driverId: 'driver_marcus', vehicleId: 'vehicle_101', period: '2026-07', dueDate: '2026-07-05', amountDue: 3200, amountPaid: 3200, paidAt: '2026-07-05', paymentMethod: 'Zelle', reference: 'ZELLE-NS101-JUL', notes: 'July rent received.', receiptName: '', receipt: '', status: 'paid' },
        { id: 'rent_2001_2026_07', vendorId: 'vendor_blueroute', leaseId: 'lease_2001', driverId: 'driver_james', vehicleId: 'vehicle_310', period: '2026-07', dueDate: '2026-07-10', amountDue: 2850, amountPaid: 0, paidAt: '', paymentMethod: '', reference: '', notes: 'Awaiting first month rent.', receiptName: '', receipt: '', status: 'overdue' }
      ],
      mileageReadings: [
        { id: 'mile_1001_start', vendorId: 'vendor_northstar', leaseId: 'lease_1001', driverId: 'driver_marcus', vehicleId: 'vehicle_101', date: '2026-07-01', odometer: 285900, type: 'start', notes: 'Start lease mileage.' },
        { id: 'mile_2001_start', vendorId: 'vendor_blueroute', leaseId: 'lease_2001', driverId: 'driver_james', vehicleId: 'vehicle_310', date: '2026-07-10', odometer: 177900, type: 'start', notes: 'Start lease mileage.' }
      ],
      documents: [
        { id: 'doc_driver_marcus_dl', vendorId: 'vendor_northstar', ownerType: 'driver', ownerId: 'driver_marcus', type: 'driver_license', name: 'Marcus Reed DL', fileName: 'marcus-license.jpg', fileData: '', expiryDate: '2027-08-18', uploadedAt: '2026-07-01T09:00:00.000Z' },
        { id: 'doc_lease_1001', vendorId: 'vendor_northstar', ownerType: 'lease', ownerId: 'lease_1001', type: 'lease_agreement', name: 'NS-101 lease agreement', fileName: 'NS-101 lease agreement.pdf', fileData: '', expiryDate: '', uploadedAt: '2026-07-01T10:00:00.000Z' }
      ],
      bookings: [],
      bookingPayments: [],
      trips: [
        { id: 'trip_1001', vendorId: 'vendor_northstar', driverId: 'driver_marcus', vehicleId: 'vehicle_101', startPoint: 'Chicago, IL', endPoint: 'Dallas, TX', startDate: '2026-06-20', endDate: '2026-06-22', startOdometer: 284960, endOdometer: 286420, tripMoney: 3850, notes: 'Dry van delivery · on time', status: 'completed', createdAt: '2026-06-19T14:20:00.000Z' },
        { id: 'trip_1002', vendorId: 'vendor_northstar', driverId: 'driver_elena', vehicleId: 'vehicle_205', startPoint: 'Aurora, IL', endPoint: 'Columbus, OH', startDate: '2026-06-28', endDate: '', startOdometer: 412410, endOdometer: 0, tripMoney: 2150, notes: 'Retail load', status: 'in_progress', createdAt: '2026-06-27T18:10:00.000Z' },
        { id: 'trip_2001', vendorId: 'vendor_blueroute', driverId: 'driver_james', vehicleId: 'vehicle_310', startPoint: 'Atlanta, GA', endPoint: 'Charlotte, NC', startDate: '2026-06-25', endDate: '2026-06-26', startOdometer: 177740, endOdometer: 178230, tripMoney: 1680, notes: 'Reefer delivery', status: 'completed', createdAt: '2026-06-24T10:00:00.000Z' }
      ],
      expenses: [
        { id: 'expense_1', vendorId: 'vendor_northstar', driverId: 'driver_marcus', vehicleId: 'vehicle_101', tripId: 'trip_1001', category: 'Fuel', amount: 642.18, date: '2026-06-21', place: 'Love’s Travel Stop', location: 'Oklahoma City, OK', paymentMethod: 'Fleet card', reference: 'FC-88421', description: 'Diesel 129 gallons', proofName: 'fuel-receipt.jpg', proof: '', status: 'approved', reviewedBy: 'Ava Morgan', createdAt: '2026-06-21T17:32:00.000Z' },
        { id: 'expense_2', vendorId: 'vendor_northstar', driverId: 'driver_elena', vehicleId: 'vehicle_205', tripId: 'trip_1002', category: 'Toll', amount: 86.50, date: '2026-06-29', place: 'Ohio Turnpike', location: 'Toledo, OH', paymentMethod: 'Cash', reference: '', description: 'Turnpike tolls', proofName: '', proof: '', status: 'pending', reviewedBy: '', createdAt: '2026-06-29T20:12:00.000Z' },
        { id: 'expense_3', vendorId: 'vendor_blueroute', driverId: 'driver_james', vehicleId: 'vehicle_310', tripId: 'trip_2001', category: 'Fuel', amount: 498.22, date: '2026-06-25', place: 'Pilot', location: 'Spartanburg, SC', paymentMethod: 'Fleet card', reference: 'FC-10990', description: 'Diesel', proofName: 'pilot-receipt.pdf', proof: '', status: 'approved', reviewedBy: 'Daniel Kim', createdAt: '2026-06-25T13:08:00.000Z' }
      ],
      maintenance: [
        { id: 'maint_1', vendorId: 'vendor_northstar', driverId: 'driver_elena', vehicleId: 'vehicle_205', type: 'Brake', estimate: 1450, shop: 'Midwest Fleet Service', odometer: 412850, date: '2026-06-29', description: 'Front brake vibration and pulling right.', proofName: 'shop-estimate.pdf', proof: '', status: 'approved', reviewedBy: 'Ava Morgan', createdAt: '2026-06-29T18:00:00.000Z' },
        { id: 'maint_2', vendorId: 'vendor_blueroute', driverId: 'driver_james', vehicleId: 'vehicle_310', type: 'Oil change', estimate: 420, shop: 'Peach State Truck Care', odometer: 178230, date: '2026-06-30', description: 'Scheduled PM service.', proofName: '', proof: '', status: 'pending', reviewedBy: '', createdAt: '2026-06-30T12:15:00.000Z' }
      ],
      notifications: []
    };
  }

  function normaliseState(input) {
    var base = initialState();
    if (!input || typeof input !== 'object') return base;
    Object.keys(base).forEach(function (key) {
      if (Array.isArray(base[key])) base[key] = Array.isArray(input[key]) ? input[key] : base[key];
      else if (key === 'settings') base.settings = Object.assign({}, base.settings, input.settings || {});
    });
    base.vendors.forEach(function (vendor) { vendor.requireProof = false; });
    base.version = 1;
    return base;
  }

  function loadState() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      return normaliseState(stored ? JSON.parse(stored) : null);
    } catch (error) {
      return initialState();
    }
  }

  function saveState(message) {
    var offlineCached = true;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      offlineCached = false;
    }
    if (message) ui.notice = message;
    if (!offlineCached) ui.notice = (message ? message + ' ' : '') + 'Large media was saved to MongoDB but skipped in the browser offline cache.';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
      }).then(function (response) {
        return response.json().then(function (payload) {
          if (!response.ok) throw new Error(payload.error || 'The database rejected this update.');
        });
      }).catch(function (error) {
        ui.notice = error.message || 'The database could not save this update.';
        render();
      });
    }, 120);
  }

  function hydrateFromServer() {
    fetch('/api/state')
      .then(function (response) { return response.json(); })
      .then(function (payload) {
        if (payload && payload.state) {
          state = normaliseState(payload.state);
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) {}
          render();
        } else {
          saveState();
        }
      })
      .catch(function () {});
  }

  function currentUser() {
    return state.users.find(function (user) { return user.id === sessionStorage.getItem('driver_fleet_user'); }) || null;
  }

  function currentVendor() {
    var user = currentUser();
    if (!user || !user.vendorId) return null;
    return state.vendors.find(function (vendor) { return vendor.id === user.vendorId; }) || null;
  }

  function vendorById(id) {
    return state.vendors.find(function (vendor) { return vendor.id === id; }) || null;
  }

  function driverById(id) {
    return state.drivers.find(function (driver) { return driver.id === id; }) || null;
  }

  function vehicleById(id) {
    return state.vehicles.find(function (vehicle) { return vehicle.id === id; }) || null;
  }

  function tripById(id) {
    return state.trips.find(function (trip) { return trip.id === id; }) || null;
  }

  function expenseById(id) {
    return state.expenses.find(function (expense) { return expense.id === id; }) || null;
  }

  function maintenanceById(id) {
    return state.maintenance.find(function (item) { return item.id === id; }) || null;
  }

  function leaseById(id) {
    return state.leases.find(function (lease) { return lease.id === id; }) || null;
  }

  function rentChargeById(id) {
    return state.rentCharges.find(function (charge) { return charge.id === id; }) || null;
  }

  function bookingById(id) {
    return state.bookings.find(function (booking) { return booking.id === id; }) || null;
  }

  function activeLeaseForDriver(driverId) {
    return state.leases.find(function (lease) { return lease.driverId === driverId && lease.status === 'active'; }) || null;
  }

  function activeLeaseForVehicle(vehicleId) {
    return state.leases.find(function (lease) { return lease.vehicleId === vehicleId && lease.status === 'active'; }) || null;
  }

  function leaseCharges(leaseId) {
    return state.rentCharges.filter(function (charge) { return charge.leaseId === leaseId; });
  }

  function chargeBalance(charge) {
    return Math.max(0, Number(charge.amountDue || 0) - Number(charge.amountPaid || 0));
  }

  function rentStatus(charge) {
    if (chargeBalance(charge) <= 0) return 'paid';
    if (charge.dueDate && charge.dueDate < today()) return Number(charge.amountPaid || 0) > 0 ? 'partial' : 'overdue';
    return Number(charge.amountPaid || 0) > 0 ? 'partial' : 'due';
  }

  function leaseBalance(leaseId) {
    return leaseCharges(leaseId).reduce(function (sum, charge) { return sum + chargeBalance(charge); }, 0);
  }

  function monthKey(date) {
    return String(date || today()).slice(0, 7);
  }

  function dueDateForPeriod(period, dueDay) {
    var safeDay = Math.max(1, Math.min(28, Number(dueDay || 1)));
    return period + '-' + String(safeDay).padStart(2, '0');
  }

  function monthKeysBetween(startDate, endDate) {
    var start = new Date(monthKey(startDate) + '-01T00:00:00');
    var end = new Date(monthKey(endDate || today()) + '-01T00:00:00');
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return [];
    var months = [];
    while (start <= end) {
      months.push(start.getFullYear() + '-' + String(start.getMonth() + 1).padStart(2, '0'));
      start.setMonth(start.getMonth() + 1);
    }
    return months;
  }

  function ensureRentCharges() {
    state.leases.filter(function (lease) { return lease.status === 'active'; }).forEach(function (lease) {
      monthKeysBetween(lease.startDate, today()).forEach(function (period) {
        var exists = state.rentCharges.some(function (charge) { return charge.leaseId === lease.id && charge.period === period; });
        if (!exists) {
          state.rentCharges.push({
            id: uid('rent'), vendorId: lease.vendorId, leaseId: lease.id, driverId: lease.driverId, vehicleId: lease.vehicleId,
            period: period, dueDate: dueDateForPeriod(period, lease.rentDueDay), amountDue: Number(lease.monthlyRent || 0),
            amountPaid: 0, paidAt: '', paymentMethod: '', reference: '', notes: '', receiptName: '', receipt: '', status: 'due'
          });
        }
      });
    });
    state.rentCharges.forEach(function (charge) { charge.status = rentStatus(charge); });
  }

  function currentLeaseForUser() {
    var user = currentUser();
    if (!user || user.role !== 'driver') return null;
    return activeLeaseForDriver(user.driverId);
  }

  function availableVehiclesForLease(vendorId) {
    return state.vehicles.filter(function (vehicle) {
      return vehicle.vendorId === vendorId && ['available', 'active'].indexOf(vehicle.status) >= 0 && !activeLeaseForVehicle(vehicle.id);
    });
  }

  function canViewOperationalRecord(record) {
    var user = currentUser();
    if (!user || !record) return false;
    if (user.role === 'platform_owner') return true;
    if (record.vendorId !== user.vendorId) return false;
    return user.role === 'vendor_admin' || (user.role === 'driver' && record.driverId === user.driverId);
  }

  function isOwner() {
    return currentUser() && currentUser().role === 'platform_owner';
  }

  function canManage() {
    return currentUser() && (currentUser().role === 'platform_owner' || currentUser().role === 'vendor_admin');
  }

  function canManageOperations() {
    return currentUser() && currentUser().role === 'vendor_admin';
  }

  function canCreateOperationalRecord(kind) {
    var user = currentUser();
    if (!user || user.role === 'platform_owner') return false;
    if (kind === 'vehicle' || kind === 'driver' || kind === 'lease' || kind === 'rent' || kind === 'return') return user.role === 'vendor_admin';
    return ['trip', 'expense', 'maintenance', 'mileage'].indexOf(kind) >= 0 && (user.role === 'vendor_admin' || user.role === 'driver');
  }

  function canOperateTrip(trip) {
    var user = currentUser();
    if (!user || !trip || user.role === 'platform_owner' || trip.vendorId !== user.vendorId) return false;
    return user.role === 'vendor_admin' || (user.role === 'driver' && trip.driverId === user.driverId);
  }

  function scope(records) {
    var user = currentUser();
    if (!user || user.role === 'platform_owner') return records.slice();
    var filtered = records.filter(function (record) { return record.vendorId === user.vendorId; });
    if (user.role === 'driver') {
      if (records === state.drivers) {
        return filtered.filter(function (record) { return record.id === user.driverId; });
      }
      if (records === state.documents) {
        var driverLeaseIds = state.leases.filter(function (lease) { return lease.driverId === user.driverId; }).map(function (lease) { return lease.id; });
        var driverRentIds = state.rentCharges.filter(function (charge) { return charge.driverId === user.driverId; }).map(function (charge) { return charge.id; });
        return filtered.filter(function (record) {
          return (record.ownerType === 'driver' && record.ownerId === user.driverId) ||
            (record.ownerType === 'lease' && driverLeaseIds.indexOf(record.ownerId) >= 0) ||
            (record.ownerType === 'rent' && driverRentIds.indexOf(record.ownerId) >= 0);
        });
      }
      filtered = filtered.filter(function (record) {
        return !record.driverId || record.driverId === user.driverId || record.id === user.driverId;
      });
    }
    return filtered;
  }

  function searchable(records, fields) {
    var query = ui.query.trim().toLowerCase();
    var result = records;
    if (query) {
      result = result.filter(function (record) {
        return fields.some(function (field) { return String(record[field] || '').toLowerCase().indexOf(query) >= 0; });
      });
    }
    if (ui.status !== 'all') result = result.filter(function (record) { return String(record.status) === ui.status; });
    return result;
  }

  function roleLabel(role) {
    return { platform_owner: 'Platform owner', vendor_admin: 'Vendor admin', driver: 'Driver' }[role] || role;
  }

  function driverBilingual(english, hindi) {
    return currentUser()?.role === 'driver' ? english + ' / ' + hindi : english;
  }

  function statusBadge(status) {
    var label = String(status || 'unknown').replace(/_/g, ' ');
    return '<span class="status status-' + esc(status || 'unknown') + '"><span></span>' + esc(label) + '</span>';
  }

  function revenueSource(record) {
    return record.revenueSource === 'rent' ? 'rent' : 'trip';
  }

  function sourceBadge(source) {
    var value = source || 'general';
    var label = { trip: 'Trip', rent: 'Vehicle rent', general: 'General fleet' }[value] || value;
    return '<span class="source-badge source-' + esc(value) + '">' + esc(label) + '</span>';
  }

  function revenueRoute(record) {
    if (revenueSource(record) === 'rent') return '<span class="route rental-route">Vehicle rent<i>·</i>' + esc(record.renterName || record.endPoint || 'Renter') + '</span>';
    return '<span class="route">' + esc(record.startPoint) + '<i>→</i>' + esc(record.endPoint) + '</span>';
  }

  function icon(name) {
    var icons = {
      dashboard: '⌂', vendors: '◆', bookings: '▤', leases: '§', vehicles: '▣', drivers: '♙', trips: '↗',
      expenses: '$', maintenance: '⚙', reports: '▥', settings: '◉'
    };
    return '<span class="nav-icon">' + (icons[name] || '•') + '</span>';
  }

  function modules() {
    var user = currentUser();
    if (!user) return [];
    if (user.role === 'driver') return ['dashboard', 'leases', 'maintenance'];
    if (user.role === 'vendor_admin') return ['dashboard', 'bookings', 'leases', 'vehicles', 'drivers', 'maintenance', 'reports', 'settings'];
    return ['dashboard', 'vendors', 'bookings', 'leases', 'reports', 'settings'];
  }

  function moduleTitle(id) {
    if (id === 'dashboard' && isOwner()) return 'Platform dashboard';
    if (currentUser()?.role === 'driver') {
      return {
        dashboard: 'Operations dashboard / संचालन डैशबोर्ड',
        leases: 'My lease / मेरी लीज',
        trips: 'Legacy trips / पुरानी यात्राएँ',
        expenses: 'Expense claims / खर्च दावे',
        maintenance: 'Maintenance / रखरखाव'
      }[id] || 'Driver Fleet';
    }
    return {
      dashboard: 'Operations dashboard', vendors: 'Vendor companies', bookings: 'Bookings', vehicles: 'Fleet vehicles',
      drivers: 'Drivers', leases: 'Leases & rent', trips: 'Legacy trips', expenses: 'Expense claims',
      maintenance: 'Maintenance', reports: 'Reports', settings: 'Settings'
    }[id] || 'Driver Fleet';
  }

  function moduleDescription(id) {
    if (isOwner() && id === 'reports') return 'All-vendor revenue and net results';
    if (isOwner() && id === 'settings') return 'Platform name, support, and storage';
    if (currentUser()?.role === 'driver') {
      return {
        leases: 'Car, rent, mileage, and documents / कार, किराया, माइल और दस्तावेज',
        trips: 'Old trip records / पुराने यात्रा रिकॉर्ड',
        expenses: 'Claims and receipt proof / दावे और रसीद प्रमाण',
        maintenance: 'Requests and service cost / अनुरोध और सेवा खर्च'
      }[id] || '';
    }
    return {
      vendors: 'Companies, access, and field rules', bookings: 'Public booking requests and deposits', vehicles: 'Units, finance, and media', drivers: 'People and assignments',
      leases: 'Start leases, receive rent, returns, and mileage', trips: 'Legacy trip history', expenses: 'Claims and receipt proof', maintenance: 'Requests and service cost',
      reports: 'Revenue and operating results', settings: 'Account and company rules'
    }[id] || '';
  }

  function render() {
    if (isPublicBookingRoute()) {
      if (!publicBooking.values.pickupDate) publicBooking.values.pickupDate = today();
      if (!publicBooking.values.returnDate) publicBooking.values.returnDate = today();
      if (!publicBooking.loaded && !publicBooking.loading) loadPublicBookingConfig();
      app.innerHTML = renderPublicBooking();
      bindPublicBooking();
      return;
    }
    if (!currentUser()) {
      app.innerHTML = renderLogin();
      bindLogin();
      return;
    }
    ensureRentCharges();
    var vendor = currentVendor();
    var brand = vendor || { color: '#0b3558', accent: '#14b8a6', companyName: state.settings.appName };
    document.documentElement.style.setProperty('--brand', brand.color || '#0b3558');
    document.documentElement.style.setProperty('--accent', brand.accent || '#14b8a6');
    app.innerHTML =
      '<div class="app-shell">' +
        '<main class="main-shell">' +
          renderTopbar() +
          '<section class="page">' +
            (ui.notice ? '<div class="notice"><span>✓</span>' + esc(ui.notice) + '<button data-action="dismiss-notice">×</button></div>' : '') +
            renderModule() +
          '</section>' +
          renderMobileNav() +
        '</main>' +
      '</div>' + renderDetailModal() + renderMediaModal();
    bindShell();
  }

  function bookingValue(name) {
    return publicBooking.values[name] || '';
  }

  function legacyPublicVehicleOptions() {
    var vehicles = publicBooking.config?.vehicles || [];
    var selected = bookingValue('vehicleId');
    if (!vehicles.length) return '<option value="">No cars available for selected dates</option>';
    return '<option value=""' + (selected ? '' : ' selected') + '>Auto assign best available car</option>' + vehicles.map(function (vehicle) {
      return '<option value="' + esc(vehicle.id) + '">' + esc(vehicle.label || vehicle.unitNumber || 'Vehicle') + ' · ' + esc(vehicle.vendorName || 'Fleet') + '</option>';
    }).join('');
  }

  function publicVehicleOptions() {
    var vehicles = publicBooking.config?.vehicles || [];
    var selected = bookingValue('vehicleId');
    if (!vehicles.length) return '<option value="">No cars available for selected dates</option>';
    return '<option value=""' + (selected ? '' : ' selected') + '>Auto assign best available car</option>' + vehicles.map(function (vehicle) {
      return '<option value="' + esc(vehicle.id) + '"' + (selected === vehicle.id ? ' selected' : '') + '>' + esc(vehicle.label || vehicle.unitNumber || 'Vehicle') + ' &middot; ' + esc(vehicle.vendorName || 'Fleet') + '</option>';
    }).join('');
  }

  function normalizePublicBookingDates(form) {
    var pickupDate = bookingValue('pickupDate') || today();
    var returnDate = bookingValue('returnDate') || pickupDate;
    if (returnDate < pickupDate) returnDate = pickupDate;
    publicBooking.values.pickupDate = pickupDate;
    publicBooking.values.returnDate = returnDate;
    if (form) {
      var pickupField = form.querySelector('[name="pickupDate"]');
      var returnField = form.querySelector('[name="returnDate"]');
      if (pickupField) pickupField.value = pickupDate;
      if (returnField) {
        returnField.min = pickupDate;
        returnField.value = returnDate;
      }
    }
  }

  function renderPublicBooking() {
    normalizePublicBookingDates();
    var payment = publicBooking.config?.payment || { enabled: false, amount: 100, currency: 'INR', methods: ['UPI', 'Card'] };
    var mode = payment.mode || payment.provider || 'test';
    var vehicles = publicBooking.config?.vehicles || [];
    var noCars = publicBooking.loaded && !publicBooking.loading && !vehicles.length;
    var disabled = publicBooking.loading || publicBooking.submitting || noCars ? ' disabled' : '';
    var submitLabel = noCars ? 'No cars available' : (publicBooking.submitting ? 'Opening payment...' : 'Continue to payment');
    var status = payment.enabled && mode === 'test'
      ? '<div class="booking-pay-ready"><b>Test payment ready</b><span>No real money is charged. Use this to test the full booking flow.</span></div>'
      : payment.enabled
      ? '<div class="booking-pay-ready"><b>Secure payment ready</b><span>Pay ' + inr(payment.amount) + ' using UPI, card, netbanking, or wallet.</span></div>'
      : '<div class="booking-pay-warning"><b>Payment setup required</b><span>Add Razorpay keys in .env before public customers can pay online.</span></div>';
    var confirmation = publicBooking.confirmation ? '<section class="booking-confirmation"><span>✓</span><h2>Booking confirmed</h2><p>Your booking code is <b>' + esc(publicBooking.confirmation.bookingCode) + '</b>. Our team will call you to finalize the car and pickup.</p><button class="btn btn-primary" data-public-action="new-booking">Create another booking</button></section>' : '';
    return '<div class="booking-public-page">' +
      '<header class="booking-public-header"><div><span class="booking-logo">DF</span><b>Driver Fleet Rentals</b></div><a href="/">Admin login</a></header>' +
      '<main class="booking-public-main">' +
        '<section class="booking-hero"><span class="eyebrow">PUBLIC RENT A CAR BOOKING</span><h1>Book a car with a ' + inr(payment.amount) + ' advance.</h1><p>Select your dates, enter your details, and confirm the request with UPI, card, netbanking, or wallet payment.</p><div class="booking-methods">' + (payment.methods || []).map(function (method) { return '<span>' + esc(method) + '</span>'; }).join('') + '</div></section>' +
        (confirmation || '<section class="booking-panel">' +
          '<div class="booking-panel-head"><div><span class="eyebrow">BOOKING REQUEST</span><h2>Customer details</h2></div>' + status + '</div>' +
          (publicBooking.error ? '<div class="booking-error">' + esc(publicBooking.error) + '</div>' : '') +
          (publicBooking.loading ? '<div class="booking-loading">Loading booking options...</div>' : '') +
          '<form id="public-booking-form" class="booking-form">' +
            '<div class="form-grid">' +
              '<label>Full name<input name="customerName" value="' + esc(bookingValue('customerName')) + '" required></label>' +
              '<label>Mobile number<input name="phone" value="' + esc(bookingValue('phone')) + '" required inputmode="tel"></label>' +
              '<label>Email optional<input name="email" type="email" value="' + esc(bookingValue('email')) + '"></label>' +
              '<label>Preferred car<select name="vehicleId">' + publicVehicleOptions() + '</select></label>' +
              '<label>Car type optional<input name="carType" value="' + esc(bookingValue('carType')) + '" placeholder="Sedan, SUV, 7 seater"></label>' +
              '<label>Pickup date<input name="pickupDate" type="date" value="' + esc(bookingValue('pickupDate') || today()) + '" required></label>' +
              '<label>Return date<input name="returnDate" type="date" min="' + esc(bookingValue('pickupDate') || today()) + '" value="' + esc(bookingValue('returnDate') || bookingValue('pickupDate') || today()) + '" required></label>' +
              '<label>Pickup city / location<input name="pickupLocation" value="' + esc(bookingValue('pickupLocation')) + '" placeholder="City, airport, address"></label>' +
            '</div>' +
            '<label>Notes optional<textarea name="notes" placeholder="Pickup time, special request, or car preference">' + esc(bookingValue('notes')) + '</textarea></label>' +
            '<div class="booking-submit-row"><button type="submit" class="btn btn-primary btn-wide"' + disabled + '>' + submitLabel + '</button><small>Admin portal access is not available from this public booking page.</small></div>' +
          '</form>' +
        '</section>') +
      '</main>' +
      renderTestPaymentModal() +
    '</div>';
  }

  function renderTestPaymentModal() {
    if (!publicBooking.testCheckout) return '';
    var payload = publicBooking.testCheckout;
    var booking = payload.booking || {};
    return '<div class="booking-test-backdrop" role="dialog" aria-modal="true" aria-label="Test payment">' +
      '<section class="booking-test-modal">' +
        '<header><div><span class="eyebrow">TEST PAYMENT</span><h2>Confirm booking advance</h2><p>No real money will be charged in test mode.</p></div><button type="button" data-public-action="cancel-test-payment" aria-label="Close test payment">&times;</button></header>' +
        '<div class="booking-test-summary">' +
          '<div><span>Booking code</span><b>' + esc(booking.bookingCode || 'Pending') + '</b></div>' +
          '<div><span>Amount</span><b>' + inr(payload.amount || 100) + '</b></div>' +
          '<div><span>Payment method</span><b>Test UPI</b></div>' +
        '</div>' +
        '<div class="booking-test-actions"><button type="button" class="btn btn-soft" data-public-action="cancel-test-payment">Cancel</button><button type="button" class="btn btn-primary" data-public-action="confirm-test-payment"' + (publicBooking.submitting ? ' disabled' : '') + '>' + (publicBooking.submitting ? 'Confirming...' : 'Confirm test payment') + '</button></div>' +
      '</section>' +
    '</div>';
  }

  function publicBookingConfigUrl() {
    var params = new URLSearchParams();
    var pickupDate = bookingValue('pickupDate');
    var returnDate = bookingValue('returnDate');
    if (pickupDate) params.set('pickupDate', pickupDate);
    if (returnDate) params.set('returnDate', returnDate);
    var query = params.toString();
    return '/api/public/booking/config' + (query ? '?' + query : '');
  }

  function capturePublicBookingForm(form) {
    if (!form) return;
    publicBooking.values = Object.assign({}, publicBooking.values, Object.fromEntries(new FormData(form).entries()));
    normalizePublicBookingDates(form);
  }

  function refreshPublicBookingAvailability(form, changedField) {
    capturePublicBookingForm(form);
    if (changedField === 'pickupDate') {
      publicBooking.values.returnDate = publicBooking.values.pickupDate || today();
      normalizePublicBookingDates(form);
    }
    publicBooking.error = '';
    publicBooking.loading = true;
    render();
    loadPublicBookingConfig();
  }

  function bindPublicBooking() {
    var form = document.getElementById('public-booking-form');
    if (form) {
      form.addEventListener('submit', submitPublicBooking);
      form.addEventListener('input', function (event) {
        if (event.target && event.target.name) publicBooking.values[event.target.name] = event.target.value;
      });
      form.querySelectorAll('[name="pickupDate"], [name="returnDate"]').forEach(function (field) {
        field.addEventListener('change', function () { refreshPublicBookingAvailability(form, field.name); });
      });
    }
    document.querySelectorAll('[data-public-action="new-booking"]').forEach(function (button) {
      button.addEventListener('click', function () {
        publicBooking.confirmation = null;
        publicBooking.values = {};
        publicBooking.error = '';
        publicBooking.testCheckout = null;
        render();
      });
    });
    document.querySelectorAll('[data-public-action="cancel-test-payment"]').forEach(function (button) {
      button.addEventListener('click', function () {
        publicBooking.testCheckout = null;
        publicBooking.submitting = false;
        publicBooking.error = 'Test payment was cancelled. Your booking is not confirmed yet.';
        render();
      });
    });
    document.querySelectorAll('[data-public-action="confirm-test-payment"]').forEach(function (button) {
      button.addEventListener('click', confirmTestPayment);
    });
  }

  function loadPublicBookingConfig() {
    publicBooking.loading = true;
    fetch(publicBookingConfigUrl())
      .then(function (response) { return response.json().then(function (payload) { if (!response.ok) throw new Error(payload.error || 'Booking setup failed.'); return payload; }); })
      .then(function (payload) {
        var selectedVehicleId = bookingValue('vehicleId');
        publicBooking.config = payload;
        publicBooking.loaded = true;
        publicBooking.loading = false;
        if (selectedVehicleId && Array.isArray(payload.vehicles) && !payload.vehicles.some(function (vehicle) { return vehicle.id === selectedVehicleId; })) {
          publicBooking.values.vehicleId = '';
          publicBooking.error = payload.vehicles.length
            ? 'That car is already booked for those dates. Please choose one of the available cars now shown.'
            : 'No cars are available for those dates. Please choose different dates.';
        }
        render();
      })
      .catch(function (error) {
        publicBooking.error = error.message || 'Booking setup failed.';
        publicBooking.loaded = true;
        publicBooking.loading = false;
        render();
      });
  }

  function loadRazorpayCheckout() {
    return new Promise(function (resolve, reject) {
      if (window.Razorpay) { resolve(); return; }
      var script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = resolve;
      script.onerror = function () { reject(new Error('Could not load Razorpay Checkout. Check internet connection.')); };
      document.head.appendChild(script);
    });
  }

  function submitPublicBooking(event) {
    event.preventDefault();
    var data = Object.fromEntries(new FormData(event.currentTarget).entries());
    publicBooking.values = data;
    publicBooking.error = '';
    var payment = publicBooking.config?.payment || {};
    if (!payment.enabled) {
      publicBooking.error = 'Online payment is not connected yet. Use PAYMENT_MODE=test for testing, or add Razorpay keys for live UPI/card checkout.';
      render();
      return;
    }
    publicBooking.submitting = true;
    render();
    fetch('/api/public/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) {
          var error = new Error(payload.error || 'Booking payment could not start.');
          error.payload = payload;
          throw error;
        }
        return payload;
      });
    }).then(function (payload) {
      if (payload.mode === 'test' || payload.testMode) {
        startTestPayment(payload);
        return;
      }
      return loadRazorpayCheckout().then(function () {
        startRazorpayPayment(payload);
      });
    }).catch(function (error) {
      var payload = error.payload || {};
      if (Array.isArray(payload.availableVehicles)) {
        publicBooking.config = Object.assign({}, publicBooking.config || {}, { vehicles: payload.availableVehicles });
        publicBooking.values.vehicleId = '';
      }
      publicBooking.submitting = false;
      publicBooking.error = error.message || 'Booking payment could not start.';
      render();
    });
  }

  function startTestPayment(payload) {
    publicBooking.submitting = false;
    publicBooking.testCheckout = payload;
    render();
  }

  function confirmTestPayment() {
    var payload = publicBooking.testCheckout;
    if (!payload || !payload.booking) return;
    publicBooking.submitting = true;
    publicBooking.error = '';
    render();
    verifyPublicBookingPayment(payload.booking.bookingId, {
      mode: 'test',
      provider: 'test',
      orderId: payload.orderId,
      paymentId: 'test_pay_' + Date.now(),
      method: 'test_upi'
    });
  }

  function startRazorpayPayment(payload) {
    var values = publicBooking.values;
    var checkout = new Razorpay({
      key: payload.keyId,
      amount: payload.amountPaise,
      currency: payload.currency,
      name: 'Driver Fleet Rentals',
      description: 'Booking advance ' + inr(payload.amount),
      order_id: payload.orderId,
      prefill: {
        name: values.customerName || '',
        contact: values.phone || '',
        email: values.email || ''
      },
      method: {
        upi: true,
        card: true,
        netbanking: true,
        wallet: true
      },
      theme: { color: '#0b6bcb' },
      handler: function (response) {
        verifyPublicBookingPayment(payload.booking.bookingId, response);
      },
      modal: {
        ondismiss: function () {
          publicBooking.submitting = false;
          publicBooking.error = 'Payment was not completed. Your booking is not confirmed yet.';
          render();
        }
      }
    });
    checkout.open();
  }

  function verifyPublicBookingPayment(bookingId, response) {
    fetch('/api/public/bookings/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ bookingId: bookingId }, response))
    }).then(function (verifyResponse) {
      return verifyResponse.json().then(function (payload) {
        if (!verifyResponse.ok) throw new Error(payload.error || 'Payment verification failed.');
        return payload;
      });
    }).then(function (payload) {
      publicBooking.submitting = false;
      publicBooking.confirmation = payload.booking;
      publicBooking.testCheckout = null;
      publicBooking.error = '';
      render();
    }).catch(function (error) {
      publicBooking.submitting = false;
      publicBooking.testCheckout = null;
      publicBooking.error = error.message || 'Payment verification failed.';
      render();
    });
  }

  function renderLogin() {
    return '<div class="login-page">' +
      '<section class="login-story">' +
        '<div class="login-brand"><span>DF</span><div><strong>Driver Fleet</strong><small>Fleet operations, finally in one place.</small></div></div>' +
        '<div class="story-copy"><span class="eyebrow">ONE APP · EVERY MILE</span><h1>Run a safer, smarter fleet.</h1>' +
        '<p>Vehicles, drivers, trips, expenses, maintenance, approvals, and reports—organized for every company and every role.</p>' +
        '<div class="story-grid"><div><b>3</b><span>role-based portals</span></div><div><b>100%</b><span>vendor-isolated data</span></div><div><b>1</b><span>clear source of truth</span></div></div></div>' +
        '<div class="road-art"><i></i><span>●</span><span>●</span><span>●</span></div>' +
      '</section>' +
      '<section class="login-card-wrap"><form class="login-card" id="login-form">' +
        '<div class="mobile-login-logo">DF</div><span class="eyebrow">WELCOME BACK</span><h2>Sign in to your fleet</h2><p>Use your assigned company account.</p>' +
        '<label>Email or username<input name="email" type="text" placeholder="fleetadmin or name@company.com" required autocomplete="username"></label>' +
        '<label>Password<input name="password" type="password" placeholder="Enter password" required autocomplete="current-password"></label>' +
        '<button class="btn btn-primary btn-wide" type="submit">Sign in <span>→</span></button>' +
        '<div class="demo-logins"><b>Demo access</b>' +
          '<button type="button" data-demo="fleetadmin|FleetAdmin123">Platform owner</button>' +
          '<button type="button" data-demo="northstaradmin|Admin123">Vendor admin</button>' +
          '<button type="button" data-demo="driver@northstar.com|Driver123">Driver</button>' +
        '</div><div id="login-error" class="form-error"></div>' +
      '</form></section></div>';
  }

  function renderSidebar() {
    var user = currentUser();
    var vendor = currentVendor();
    var title = vendor ? vendor.companyName : state.settings.appName;
    return '<aside class="sidebar ' + (ui.menuOpen ? 'sidebar-open' : '') + '">' +
      '<div class="brand"><div class="brand-mark">DF</div><div><strong>' + esc(title) + '</strong><small>' + esc(roleLabel(user.role)) + '</small></div></div>' +
      '<nav>' + modules().map(function (moduleId) {
        return '<button class="' + (ui.module === moduleId ? 'active' : '') + '" data-module="' + moduleId + '">' + icon(moduleId) + '<span>' + esc(moduleTitle(moduleId).split(' ')[0]) + '</span></button>';
      }).join('') + '</nav>' +
      '<div class="sidebar-support"><span>Need support?</span><b>' + esc(state.settings.supportPhone) + '</b><small>' + esc(state.settings.supportEmail) + '</small></div>' +
      '<div class="sidebar-user"><div class="avatar">' + esc(user.name.split(' ').map(function (part) { return part[0]; }).join('').slice(0, 2)) + '</div><div><strong>' + esc(user.name) + '</strong><small>' + esc(user.email) + '</small></div><button data-action="logout" title="Sign out">↪</button></div>' +
    '</aside>';
  }

  function renderTopbar() {
    var user = currentUser();
    var vendor = currentVendor();
    return '<header class="topbar">' +
      '<button class="home-mark" data-module="dashboard" aria-label="Open home">DF</button>' +
      '<div><span class="crumb">' + esc(vendor ? vendor.companyName : 'All companies') + ' /</span><h1>' + esc(moduleTitle(ui.module)) + '</h1></div>' +
      '<div class="top-actions"><div class="live-pill"><span></span>Saved locally</div><button class="icon-btn" title="Notifications">♢<i>' + countAlerts() + '</i></button><div class="top-account"><div class="avatar small">' + esc(user.name.slice(0, 1)) + '</div><span><b>' + esc(user.name) + '</b><small>' + esc(roleLabel(user.role)) + '</small></span><button data-action="logout" aria-label="Sign out" title="Sign out">↪</button></div></div>' +
    '</header>';
  }

  function renderMobileNav() {
    var user = currentUser();
    var mobileModules = user.role === 'platform_owner' ? ['dashboard', 'vendors', 'leases', 'reports', 'settings'] : ['dashboard', 'leases', 'vehicles', 'maintenance', 'settings'];
    var visible = modules().filter(function (id) { return mobileModules.indexOf(id) >= 0; });
    return '<nav class="mobile-nav">' + visible.map(function (moduleId) {
      var mobileLabel = user.role === 'driver' ? ({ dashboard: 'Home / होम', leases: 'Lease / लीज', maintenance: 'Service / सेवा' }[moduleId] || moduleTitle(moduleId)) : moduleTitle(moduleId).split(' ')[0];
      return '<button class="' + (ui.module === moduleId ? 'active' : '') + '" data-module="' + moduleId + '">' + icon(moduleId) + '<small>' + esc(mobileLabel) + '</small></button>';
    }).join('') + '</nav>';
  }

  function renderModule() {
    if (modules().indexOf(ui.module) < 0) ui.module = 'dashboard';
    if (ui.module === 'dashboard') return renderDashboard();
    if (ui.module === 'vendors') return renderVendors();
    if (ui.module === 'bookings') return renderBookings();
    if (ui.module === 'leases') return renderLeases();
    if (ui.module === 'vehicles') return renderVehicles();
    if (ui.module === 'drivers') return renderDrivers();
    if (ui.module === 'trips') return renderTrips();
    if (ui.module === 'expenses') return renderExpenses();
    if (ui.module === 'maintenance') return renderMaintenance();
    if (ui.module === 'reports') return renderReports();
    if (ui.module === 'settings') return renderSettings();
    return renderDashboard();
  }

  function renderModuleMenu() {
    var user = currentUser();
    var items = modules().filter(function (id) { return id !== 'dashboard'; });
    var eyebrow = user.role === 'driver' ? 'YOUR WORK / आपका काम' : (user.role === 'platform_owner' ? 'PLATFORM' : 'WORKSPACE');
    var heading = user.role === 'driver' ? 'What do you need to do? / आपको क्या करना है?' : (user.role === 'platform_owner' ? 'Platform controls' : 'Open a workspace');
    var description = user.role === 'driver' ? 'Your lease, vehicle, rent, mileage, and service records are connected here. / आपकी लीज, कार, किराया, माइल और सेवा रिकॉर्ड यहाँ जुड़े हैं।' : (user.role === 'platform_owner' ? 'Manage vendors, leases, global results, and platform controls.' : 'Choose a box to manage that part of the leasing operation.');
    return '<section class="module-menu"><div class="section-title"><span class="eyebrow">' + eyebrow + '</span><h2>' + heading + '</h2><p>' + description + '</p></div>' +
      '<div class="module-box-grid">' + items.map(function (moduleId) {
        var title = user.role === 'driver' ? ({ leases: 'My lease / मेरी लीज', trips: 'Trips / यात्राएँ', expenses: 'Expense claims / खर्च दावे', maintenance: 'Maintenance / रखरखाव' }[moduleId] || moduleTitle(moduleId)) : moduleTitle(moduleId);
        return '<button class="module-box module-' + moduleId + '" data-module="' + moduleId + '"><span class="module-box-icon">' + icon(moduleId) + '</span><b>' + esc(title) + '</b><small>' + esc(moduleDescription(moduleId)) + '</small><em>' + (user.role === 'driver' ? 'Open / खोलें' : 'Open') + ' →</em></button>';
      }).join('') + '</div></section>';
  }

  function countAlerts() {
    return scope(state.expenses).filter(function (x) { return x.status === 'pending'; }).length +
      scope(state.maintenance).filter(function (x) { return x.status === 'pending'; }).length +
      scope(state.bookings).filter(function (x) { return x.paymentStatus === 'paid' && ['confirmed', 'accepted'].indexOf(x.status) >= 0; }).length +
      scope(state.rentCharges).filter(function (x) { return rentStatus(x) === 'overdue'; }).length;
  }

  function dashboardMetrics() {
    var vehicles = scope(state.vehicles);
    var expenses = scope(state.expenses);
    var maintenance = scope(state.maintenance);
    var leases = scope(state.leases);
    var rentCharges = scope(state.rentCharges);
    var revenue = rentCharges.reduce(function (sum, x) { return sum + Number(x.amountPaid || 0); }, 0);
    var approvedExpenses = expenses.filter(function (x) { return x.status === 'approved'; }).reduce(function (sum, x) { return sum + Number(x.amount || 0); }, 0);
    var maintenanceCost = maintenance.filter(function (x) { return ['approved', 'in_progress', 'completed'].indexOf(x.status) >= 0; }).reduce(function (sum, x) { return sum + Number(x.estimate || 0); }, 0);
    return {
      vehicles: vehicles.length,
      activeVehicles: vehicles.filter(function (x) { return ['available', 'active'].indexOf(x.status) >= 0; }).length,
      activeLeases: leases.filter(function (x) { return x.status === 'active'; }).length,
      openRent: rentCharges.reduce(function (sum, x) { return sum + chargeBalance(x); }, 0),
      pending: expenses.filter(function (x) { return x.status === 'pending'; }).length + maintenance.filter(function (x) { return x.status === 'pending'; }).length,
      revenue: revenue,
      expenses: approvedExpenses,
      maintenanceCost: maintenanceCost,
      profit: revenue - approvedExpenses - maintenanceCost
    };
  }

  function kpi(label, value, hint, tone, symbol) {
    return '<article class="kpi ' + (tone || '') + '"><div class="kpi-icon">' + symbol + '</div><div><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong><small>' + esc(hint) + '</small></div></article>';
  }

  function renderDashboard() {
    var user = currentUser();
    if (user.role === 'driver') return renderDriverDashboard();
    if (user.role === 'platform_owner') return renderOwnerDashboard();
    var m = dashboardMetrics();
    var leases = scope(state.leases).slice().sort(function (a, b) { return String(b.startDate).localeCompare(String(a.startDate)); }).slice(0, 5);
    var greeting = new Date().getHours() < 12 ? 'Good morning' : (new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening');
    var heroActions = '<button class="btn btn-light" data-module="reports">View reports →</button>';
    return '<div class="hero-strip"><div><span class="eyebrow">' + esc(greeting.toUpperCase()) + '</span><h2>' + esc(user.name.split(' ')[0]) + ', here is your fleet today.</h2><p>' + (countAlerts() ? countAlerts() + ' items need attention.' : 'Everything important is under control.') + '</p></div>' +
      heroActions + '</div>' +
      renderModuleMenu() +
      '<div class="kpi-grid">' +
        kpi('Active leases', number(m.activeLeases), 'cars currently assigned', 'blue', '§') +
        kpi('Available cars', m.activeVehicles + ' / ' + m.vehicles, 'ready for lease', 'teal', '▣') +
        kpi('Open rent', money(m.openRent), 'due or partial balance', m.openRent ? 'amber' : 'green', '$') +
        kpi('Net result', money(m.profit), 'rent minus claims and service', m.profit >= 0 ? 'green' : 'red', '◉') +
      '</div>' +
      '<div class="dashboard-grid"><section class="panel span-2"><div class="panel-head"><div><span class="eyebrow">LEASE DESK</span><h3>Active leases</h3></div><button class="link-btn" data-module="leases">Open leases →</button></div>' +
        renderTable(['Lease', 'Driver', 'Vehicle', 'Rent', 'Status'], leases.map(function (lease) {
          var driver = driverById(lease.driverId);
          var vehicle = vehicleById(lease.vehicleId);
          return [
            '<b>#' + esc(lease.id.replace('lease_', '')) + '</b><small>Started ' + esc(lease.startDate) + '</small>',
            esc(driver?.name || 'Unassigned'),
            esc(vehicle ? vehicle.unitNumber + ' · ' + vehicle.make : 'No vehicle'),
            '<b>' + money(lease.monthlyRent) + '</b><small>' + money(leaseBalance(lease.id)) + ' open</small>',
            statusBadge(lease.status)
          ];
        }), 'No active leases yet.') + '</section>' +
        '<section class="panel"><div class="panel-head"><div><span class="eyebrow">ACTION CENTER</span><h3>Needs attention</h3></div></div>' + renderAlerts() + '</section></div>' +
      '<div class="dashboard-grid lower"><section class="panel"><div class="panel-head"><div><span class="eyebrow">FINANCIAL SNAPSHOT</span><h3>Revenue & cost</h3></div></div>' +
        '<div class="finance-ring" style="--profit:' + Math.max(0, Math.min(100, m.revenue ? Math.round((m.profit / m.revenue) * 100) : 0)) + '"><div><b>' + (m.revenue ? Math.round((m.profit / m.revenue) * 100) : 0) + '%</b><span>margin</span></div></div>' +
        '<div class="mini-stats"><div><span>Total revenue</span><b>' + money(m.revenue) + '</b></div><div><span>Approved expenses</span><b>' + money(m.expenses) + '</b></div></div></section>' +
        '<section class="panel span-2"><div class="panel-head"><div><span class="eyebrow">FLEET HEALTH</span><h3>Vehicle utilization</h3></div><button class="link-btn" data-module="vehicles">Open fleet →</button></div>' + renderFleetHealth() + '</section></div>';
  }

  function renderDriverDashboard() {
    var user = currentUser();
    var driver = driverById(user.driverId);
    var lease = currentLeaseForUser();
    var vehicle = lease ? vehicleById(lease.vehicleId) : null;
    var openRent = lease ? leaseBalance(lease.id) : 0;
    var maintenance = scope(state.maintenance);
    var openMaintenance = maintenance.filter(function (item) { return ['completed', 'rejected'].indexOf(item.status) < 0; }).length;
    return '<section class="driver-welcome"><div class="driver-welcome-main">' + driverAvatar(driver || { name: user.name }, 'profile') + '<div><span class="eyebrow">DRIVER PORTAL / ड्राइवर पोर्टल</span><h1>' + esc(user.name) + '</h1><p>Your account shows your current car lease, rent, mileage, documents, and maintenance. / आपका खाता आपकी कार लीज, किराया, माइल, दस्तावेज और सेवा दिखाता है।</p></div><button class="btn btn-soft" data-action="driver-details" data-id="' + esc(user.driverId) + '">View my record / मेरा रिकॉर्ड देखें</button></div></section>' +
      renderModuleMenu() +
      '<section class="driver-status-grid">' +
        '<button class="driver-status-card blue" data-module="leases"><span>§</span><div><b>' + esc(vehicle?.unitNumber || 'None') + '</b><small>Current car / वर्तमान कार</small></div></button>' +
        '<button class="driver-status-card amber" data-module="leases"><span>$</span><div><b>' + money(openRent) + '</b><small>Open rent / बकाया किराया</small></div></button>' +
        '<button class="driver-status-card teal" data-module="maintenance"><span>⚙</span><div><b>' + number(openMaintenance) + '</b><small>Open maintenance requests / खुले रखरखाव अनुरोध</small></div></button>' +
      '</section>';
  }

  function renderOwnerDashboard() {
    var vendors = state.vendors.slice();
    var activeVendors = vendors.filter(function (vendor) { return vendor.status === 'active'; }).length;
    var vendorAdmins = state.users.filter(function (user) { return user.role === 'vendor_admin' && user.active; }).length;
    var activeLeases = state.leases.filter(function (lease) { return lease.status === 'active'; }).length;
    var completedRevenue = state.rentCharges.reduce(function (sum, charge) { return sum + Number(charge.amountPaid || 0); }, 0);
    var approvedExpenses = state.expenses.filter(function (item) { return item.status === 'approved'; }).reduce(function (sum, item) { return sum + Number(item.amount || 0); }, 0);
    var maintenanceCost = state.maintenance.filter(function (item) { return ['approved', 'in_progress', 'completed'].indexOf(item.status) >= 0; }).reduce(function (sum, item) { return sum + Number(item.estimate || 0); }, 0);
    var pendingReviews = state.expenses.filter(function (item) { return item.status === 'pending'; }).length + state.maintenance.filter(function (item) { return item.status === 'pending'; }).length;
    var recentVendors = vendors.slice().reverse().slice(0, 5);
    return '<div class="hero-strip owner-hero"><div><span class="eyebrow">PLATFORM CONTROL CENTER</span><h2>Manage companies, rules, and performance.</h2><p>Fleet operations stay with each vendor administrator.</p></div><div class="hero-actions"><button class="btn btn-light" data-action="toggle-vendor-form" data-module="vendors">+ New vendor</button><button class="btn btn-outline-light" data-module="reports">View revenue reports →</button></div></div>' +
      renderModuleMenu() +
      '<div class="kpi-grid">' +
        kpi('Active vendors', activeVendors + ' / ' + vendors.length, 'companies enabled', 'blue', '◆') +
        kpi('Vendor admins', number(vendorAdmins), 'active company administrators', 'teal', '♙') +
        kpi('Active leases', number(activeLeases), 'cars on monthly rent', 'green', '§') +
        kpi('Pending vendor reviews', number(pendingReviews), 'handled by vendor admins', pendingReviews ? 'amber' : 'green', '!') +
      '</div>' +
      '<div class="dashboard-grid"><section class="panel span-2"><div class="panel-head"><div><span class="eyebrow">VENDOR DIRECTORY</span><h3>Company overview</h3></div><button class="link-btn" data-module="vendors">Manage vendors →</button></div>' +
        renderTable(['Company', 'Plan', 'Administrator', 'Fleet records', 'Status'], recentVendors.map(function (vendor) {
          var vehicleCount = state.vehicles.filter(function (item) { return item.vendorId === vendor.id; }).length;
          var driverCount = state.drivers.filter(function (item) { return item.vendorId === vendor.id; }).length;
          return ['<b>' + esc(vendor.companyName) + '</b><small>' + esc(vendor.phone || 'No phone') + '</small>', esc(vendor.plan), '<b>' + esc(vendor.owner) + '</b><small>' + esc(vendor.email) + '</small>', vehicleCount + ' vehicles · ' + driverCount + ' drivers', statusBadge(vendor.status)];
        }), 'No vendors yet.') + '</section>' +
        '<section class="panel"><div class="panel-head"><div><span class="eyebrow">PLATFORM FINANCIALS</span><h3>Combined result</h3></div></div><div class="owner-financial-list"><div><span>Revenue</span><b>' + money(completedRevenue) + '</b></div><div><span>Approved expenses</span><b>' + money(approvedExpenses) + '</b></div><div><span>Maintenance cost</span><b>' + money(maintenanceCost) + '</b></div><div class="total"><span>Net operating result</span><b class="' + (completedRevenue - approvedExpenses - maintenanceCost >= 0 ? 'text-success' : 'text-danger') + '">' + money(completedRevenue - approvedExpenses - maintenanceCost) + '</b></div></div><button class="btn btn-soft btn-wide" data-module="reports">Open detailed reports</button></section></div>';
  }

  function renderAlerts() {
    var alerts = [];
    scope(state.expenses).filter(function (x) { return x.status === 'pending'; }).slice(0, 3).forEach(function (item) {
      alerts.push({ icon: '$', title: item.category + ' expense', meta: money(item.amount) + ' · ' + (driverById(item.driverId)?.name || 'Driver'), module: 'expenses' });
    });
    scope(state.maintenance).filter(function (x) { return x.status === 'pending'; }).slice(0, 3).forEach(function (item) {
      alerts.push({ icon: '⚙', title: item.type + ' request', meta: money(item.estimate) + ' · ' + (vehicleById(item.vehicleId)?.unitNumber || 'Vehicle'), module: 'maintenance' });
    });
    scope(state.rentCharges).filter(function (x) { return rentStatus(x) === 'overdue'; }).slice(0, 3).forEach(function (item) {
      alerts.push({ icon: '$', title: 'Rent overdue', meta: (driverById(item.driverId)?.name || 'Driver') + ' · ' + money(chargeBalance(item)), module: 'leases' });
    });
    scope(state.bookings).filter(function (x) { return x.paymentStatus === 'paid' && ['confirmed', 'accepted'].indexOf(x.status) >= 0; }).slice(0, 3).forEach(function (item) {
      alerts.push({ icon: '▤', title: 'Paid public booking', meta: item.customerName + ' · ' + inr(item.bookingFee || 100), module: 'bookings' });
    });
    scope(state.drivers).filter(function (driver) {
      return driver.licenseExpiry && new Date(driver.licenseExpiry) < new Date(Date.now() + 1000 * 60 * 60 * 24 * 120);
    }).forEach(function (driver) {
      alerts.push({ icon: '!', title: 'License expiring', meta: driver.name + ' · ' + driver.licenseExpiry, module: 'drivers' });
    });
    scope(state.drivers).filter(function (driver) {
      return driver.insuranceExpiry && new Date(driver.insuranceExpiry) < new Date(Date.now() + 1000 * 60 * 60 * 24 * 120);
    }).forEach(function (driver) {
      alerts.push({ icon: '!', title: 'Insurance expiring', meta: driver.name + ' · ' + driver.insuranceExpiry, module: 'drivers' });
    });
    if (!alerts.length) return '<div class="empty-state compact"><span>✓</span><b>All caught up</b><p>No approvals or urgent reminders.</p></div>';
    return '<div class="alert-list">' + alerts.slice(0, 5).map(function (alert) {
      return '<button data-module="' + alert.module + '"><i>' + alert.icon + '</i><span><b>' + esc(alert.title) + '</b><small>' + esc(alert.meta) + '</small></span><em>›</em></button>';
    }).join('') + '</div>';
  }

  function renderFleetHealth() {
    var vehicles = scope(state.vehicles);
    if (!vehicles.length) return emptyState('No vehicles', 'Add your first vehicle to see fleet health.', 'vehicles');
    return '<div class="health-list">' + vehicles.slice(0, 5).map(function (vehicle) {
      var width = Math.min(100, Math.round((Number(vehicle.mileage || 0) % 500000) / 5000));
      return '<div><div class="vehicle-mark">' + esc(vehicle.make.slice(0, 1)) + '</div><span><b>' + esc(vehicle.unitNumber) + ' · ' + esc(vehicle.make) + '</b><small>' + number(vehicle.mileage) + ' mi · ' + esc(driverById(vehicle.driverId)?.name || 'Unassigned') + '</small></span><div class="health-bar"><i style="width:' + width + '%"></i></div>' + statusBadge(vehicle.status) + '</div>';
    }).join('') + '</div>';
  }

  function pageHeader(title, description, actionLabel, action) {
    var returnButton = ui.module && ui.module !== 'dashboard' ? dashboardReturnAction() : '';
    var actionButton = actionLabel ? '<button class="btn btn-primary" data-action="' + action + '">+ ' + esc(actionLabel) + '</button>' : '';
    return '<div class="page-header"><div><h2>' + esc(title) + '</h2><p>' + esc(description) + '</p></div>' +
      '<div class="page-header-actions">' + returnButton + actionButton + '</div></div>';
  }

  function returnAction(label) {
    return '<button type="button" class="btn btn-soft" data-action="close-form">' + esc(label || 'Return') + '</button>';
  }

  function dashboardReturnAction() {
    return '<button type="button" class="btn btn-soft" data-module="dashboard">Return to dashboard</button>';
  }

  function filters(placeholder, statuses) {
    return '<div class="filters"><label class="search-box"><span>⌕</span><input id="module-search" placeholder="' + esc(placeholder) + '" value="' + esc(ui.query) + '"></label>' +
      (statuses ? '<select id="status-filter"><option value="all">All statuses</option>' + statuses.map(function (status) {
        return '<option value="' + status + '"' + (ui.status === status ? ' selected' : '') + '>' + esc(status.replace(/_/g, ' ')) + '</option>';
      }).join('') + '</select>' : '') + '</div>';
  }

  function renderVendors() {
    if (!isOwner()) return forbidden();
    var vendors = searchable(state.vendors, ['companyName', 'owner', 'email', 'plan']);
    return pageHeader('Vendor companies', 'Manage every company, plan, approval rule, and brand.', 'New vendor', 'toggle-vendor-form') +
      (ui.form === 'vendor' ? vendorForm() : '') +
      filters('Search vendor, owner, or plan…', ['active', 'suspended']) +
      '<div class="vendor-grid">' + vendors.map(function (vendor) {
        var vehicles = state.vehicles.filter(function (x) { return x.vendorId === vendor.id; }).length;
        var drivers = state.drivers.filter(function (x) { return x.vendorId === vendor.id; }).length;
        var pending = state.expenses.filter(function (x) { return x.vendorId === vendor.id && x.status === 'pending'; }).length +
          state.maintenance.filter(function (x) { return x.vendorId === vendor.id && x.status === 'pending'; }).length;
        return '<article class="vendor-card" style="--vendor:' + esc(vendor.color) + ';--vendor-accent:' + esc(vendor.accent) + '">' +
          '<div class="vendor-card-top"><div class="company-logo">' + esc(vendor.companyName.split(' ').map(function (x) { return x[0]; }).join('').slice(0, 2)) + '</div><div>' + statusBadge(vendor.status) + '<span class="plan">' + esc(vendor.plan) + '</span></div></div>' +
          '<h3>' + esc(vendor.companyName) + '</h3><p>' + esc(vendor.owner) + ' · ' + esc(vendor.email) + '</p>' +
          '<div class="vendor-stats"><div><b>' + vehicles + '</b><span>Vehicles</span></div><div><b>' + drivers + '</b><span>Drivers</span></div><div><b>' + pending + '</b><span>Pending</span></div></div>' +
          '<div class="vendor-rule"><span>Approval limit</span><b>' + money(vendor.approvalLimit) + '</b></div>' +
          '<div class="card-actions"><button class="btn btn-soft" data-module="reports">View report</button><button class="btn btn-soft" data-action="edit-vendor" data-id="' + vendor.id + '">Edit</button><button class="icon-btn" data-action="toggle-vendor-status" data-id="' + vendor.id + '" title="Change status">⋯</button></div>' +
        '</article>';
      }).join('') + '</div>' + (!vendors.length ? emptyState('No matching vendors', 'Try another search.', 'vendors') : '');
  }

  function vendorForm() {
    var vendor = ui.editing?.kind === 'vendor' ? vendorById(ui.editing.id) : null;
    var isEdit = Boolean(vendor);
    return '<form class="form-panel" id="vendor-form"><div class="form-head"><div><span class="eyebrow">' + (isEdit ? 'EDIT COMPANY' : 'NEW COMPANY') + '</span><h3>' + (isEdit ? 'Edit vendor' : 'Add vendor') + '</h3></div><button type="button" class="form-return" data-action="close-form">Return</button></div>' +
      '<div class="form-grid">' +
        field('Company name', 'companyName', vendor?.companyName || '', 'text', true) + field('Owner name', 'owner', vendor?.owner || '', 'text', true) +
        field('Phone', 'phone', vendor?.phone || '', 'tel', true) + field('Email optional', 'email', vendor?.email || '', 'email') +
        selectField('Plan', 'plan', ['Starter', 'Growth', 'Enterprise'], vendor?.plan) + field('Approval limit', 'approvalLimit', vendor?.approvalLimit ?? '500', 'number', true) +
        field('Brand color', 'color', vendor?.color || '#0b6bcb', 'color') + field('Accent color', 'accent', vendor?.accent || '#14b8a6', 'color') +
      '</div><div class="config-fields"><div><span class="eyebrow">CONFIGURABLE VENDOR FIELDS</span><h4>Operational choices</h4><p>These options appear in the vendor admin and driver forms.</p></div><div class="form-grid">' +
        '<label>Expense categories<textarea name="expenseCategories" required placeholder="Fuel, Toll, Parking, Repair">' + esc((vendor?.expenseCategories || ['Fuel', 'Toll', 'Parking', 'Scale ticket', 'Challan', 'Repair']).join(', ')) + '</textarea></label>' +
        '<label>Maintenance types<textarea name="maintenanceTypes" required placeholder="Oil change, Tire, Brake, Inspection">' + esc((vendor?.maintenanceTypes || ['Oil change', 'Tire', 'Brake', 'DOT inspection', 'Trailer repair']).join(', ')) + '</textarea></label>' +
      '</div></div><div class="readonly-note"><b>Attachments are optional</b><span>Receipt and estimate files are never required, which keeps records quicker and the database lighter.</span></div>' +
      '<div class="form-actions">' + returnAction('Return to vendors') + '<button class="btn btn-primary">' + (isEdit ? 'Save changes' : 'Create vendor') + '</button></div></form>';
  }

  function renderBookings() {
    if (!canManage()) return forbidden();
    var records = searchable(scope(state.bookings), ['bookingCode', 'customerName', 'phone', 'email', 'vehicleLabel', 'carType', 'status', 'paymentStatus'])
      .sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
    var paid = records.filter(function (booking) { return booking.paymentStatus === 'paid'; });
    var open = records.filter(function (booking) { return ['pending_payment', 'new', 'confirmed'].indexOf(booking.status) >= 0; });
    var depositTotal = paid.reduce(function (sum, booking) { return sum + Number(booking.bookingFee || 0); }, 0);
    return pageHeader('Public bookings', 'Customer rent-a-car requests with UPI/card booking deposit.', '', '') +
      '<div class="kpi-grid">' +
        kpi('Total bookings', number(records.length), 'public portal requests', 'blue', '▤') +
        kpi('Open requests', number(open.length), 'need follow-up', open.length ? 'amber' : 'green', '!') +
        kpi('Paid deposits', number(paid.length), inr(depositTotal) + ' collected', 'green', '₹') +
        kpi('Public page', '/booking', 'customer booking portal', 'teal', '↗') +
      '</div>' +
      '<section class="panel table-panel"><div class="panel-head"><div><span class="eyebrow">BOOKING LEDGER</span><h3>Public booking requests</h3></div><a class="btn btn-soft" href="/booking" target="_blank" rel="noopener">Open public page</a></div>' +
      renderTable(['Booking', 'Customer', 'Car request', 'Dates', 'Payment', 'Status', ''], records.map(function (booking) {
        var vendor = vendorById(booking.vendorId);
        var vehicle = vehicleById(booking.vehicleId);
        var actions = '<div class="row-actions"><button class="mini-btn primary" data-action="booking-details" data-id="' + booking.id + '">View</button>';
        if (canManageOperations() && booking.status !== 'cancelled') actions += '<button class="mini-btn approve" data-action="booking-accept" data-id="' + booking.id + '">Accept</button><button class="mini-btn" data-action="booking-assigned" data-id="' + booking.id + '">Assign</button><button class="mini-btn reject" data-action="booking-cancel" data-id="' + booking.id + '">Cancel</button>';
        actions += '</div>';
        return [
          '<b>' + esc(booking.bookingCode || booking.id) + '</b><small>' + esc(vendor?.companyName || 'Fleet') + '</small>',
          '<b>' + esc(booking.customerName) + '</b><small>' + esc(booking.phone) + (booking.email ? ' · ' + esc(booking.email) : '') + '</small>',
          '<b>' + esc(vehicle ? vehicle.unitNumber + ' · ' + vehicle.make + ' ' + vehicle.model : booking.vehicleLabel || booking.carType || 'Admin to suggest') + '</b><small>' + esc(booking.pickupLocation || 'Pickup location pending') + '</small>',
          '<b>' + esc(booking.pickupDate) + '</b><small>Return ' + esc(booking.returnDate) + '</small>',
          '<b>' + inr(booking.bookingFee || 100) + '</b><small>' + esc(booking.paymentProvider || 'razorpay') + ' · ' + esc(booking.paymentStatus || 'pending') + '</small>',
          statusBadge(booking.status || 'new'),
          actions
        ];
      }), 'No public bookings yet.') + '</section>';
  }

  function renderLeases() {
    var user = currentUser();
    var leases = searchable(scope(state.leases), ['notes', 'status']);
    var rentCharges = scope(state.rentCharges).slice().sort(function (a, b) { return String(a.dueDate).localeCompare(String(b.dueDate)); });
    var activeLeases = scope(state.leases).filter(function (lease) { return lease.status === 'active'; });
    var openRent = rentCharges.reduce(function (sum, charge) { return sum + chargeBalance(charge); }, 0);
    var availableCars = user.role === 'platform_owner' ? state.vehicles.filter(function (vehicle) { return ['available', 'active'].indexOf(vehicle.status) >= 0 && !activeLeaseForVehicle(vehicle.id); }) : availableVehiclesForLease(user.vendorId);
    var canAdminLease = user.role === 'vendor_admin';
    var headerAction = canAdminLease ? 'Start lease' : '';

    return pageHeader('Leases & rent', 'One flow connects driver, car, rent, mileage, maintenance, and documents.', headerAction, 'toggle-lease-form') +
      '<div class="kpi-grid">' +
        kpi('Active leases', number(activeLeases.length), 'currently assigned cars', 'blue', '§') +
        kpi('Available cars', number(availableCars.length), 'ready to lease', 'teal', '▣') +
        kpi('Open rent', money(openRent), 'due or partial balance', openRent ? 'amber' : 'green', '$') +
        kpi('Documents', number(scope(state.documents).length), 'DL, insurance, lease docs', 'green', '▧') +
      '</div>' +
      (ui.form === 'lease' ? leaseForm() : '') +
      (ui.form === 'rent' ? rentForm() : '') +
      (ui.form === 'return' ? returnForm() : '') +
      (ui.form === 'mileage' ? mileageForm() : '') +
      (canAdminLease ? '<section class="lease-action-row"><button class="btn btn-primary" data-action="toggle-lease-form">+ Start lease</button><button class="btn btn-soft" data-action="toggle-rent-form">Receive rent</button><button class="btn btn-soft" data-action="toggle-return-form">Return vehicle</button><button class="btn btn-soft" data-action="toggle-mileage-form">Mileage check</button></section>' : '<section class="lease-action-row"><button class="btn btn-primary" data-action="toggle-mileage-form">Send mileage</button><button class="btn btn-soft" data-module="maintenance">Request maintenance</button></section>') +
      filters('Search lease notes or status...', ['active', 'closed', 'cancelled']) +
      '<section class="panel table-panel"><div class="panel-head"><div><span class="eyebrow">LEASE LEDGER</span><h3>Driver and vehicle assignments</h3></div></div>' +
      renderTable(['Lease', 'Driver', 'Vehicle', 'Mileage', 'Rent', 'Actions'], leases.map(function (lease) {
        var driver = driverById(lease.driverId);
        var vehicle = vehicleById(lease.vehicleId);
        var docs = state.documents.filter(function (doc) { return doc.ownerType === 'lease' && doc.ownerId === lease.id; }).length + (lease.leaseDocName ? 1 : 0);
        return [
          '<b>' + esc(lease.startDate) + '</b><small>' + esc(lease.expectedReturnDate || 'month to month') + ' · ' + esc(lease.status) + '</small>',
          '<b>' + esc(driver?.name || 'Driver') + '</b><small>DL ' + esc(driver?.license || 'missing') + '</small>',
          '<b>' + esc(vehicle?.unitNumber || 'Vehicle') + '</b><small>' + esc(vehicle ? vehicle.make + ' ' + vehicle.model : '') + '</small>',
          '<b>' + number(lease.startOdometer) + '</b><small>' + (lease.returnOdometer ? number(lease.returnOdometer) + ' return' : number(vehicle?.mileage || 0) + ' current') + '</small>',
          '<b>' + money(lease.monthlyRent) + '</b><small>' + money(leaseBalance(lease.id)) + ' open · ' + docs + ' docs</small>',
          '<div class="row-actions"><button class="mini-btn primary" data-action="lease-details" data-id="' + lease.id + '">View</button>' + (canAdminLease && lease.status === 'active' ? '<button class="mini-btn" data-action="rent-for-lease" data-id="' + lease.id + '">Rent</button><button class="mini-btn" data-action="return-for-lease" data-id="' + lease.id + '">Return</button>' : '') + '</div>'
        ];
      }), 'No lease records yet.') + '</section>' +
      '<section class="panel table-panel"><div class="panel-head"><div><span class="eyebrow">MONTHLY RENT</span><h3>Payment status</h3></div></div>' +
      renderTable(['Month', 'Driver / vehicle', 'Due', 'Paid', 'Status', ''], rentCharges.map(function (charge) {
        var driver = driverById(charge.driverId);
        var vehicle = vehicleById(charge.vehicleId);
        charge.status = rentStatus(charge);
        return [
          '<b>' + esc(charge.period) + '</b><small>Due ' + esc(charge.dueDate) + '</small>',
          '<b>' + esc(driver?.name || 'Driver') + '</b><small>' + esc(vehicle?.unitNumber || 'Vehicle') + '</small>',
          money(charge.amountDue),
          '<b>' + money(charge.amountPaid) + '</b><small>' + money(chargeBalance(charge)) + ' open</small>',
          statusBadge(charge.status),
          canAdminLease && chargeBalance(charge) > 0 ? '<button class="mini-btn primary" data-action="rent-charge" data-id="' + charge.id + '">Receive</button>' : ''
        ];
      }), 'No rent charges yet.') + '</section>';
  }

  function leaseForm() {
    var user = currentUser();
    var vendorId = user.vendorId;
    var openDrivers = state.drivers.filter(function (driver) { return driver.vendorId === vendorId && driver.status !== 'inactive' && !activeLeaseForDriver(driver.id); });
    var openVehicles = availableVehiclesForLease(vendorId);
    return '<form class="form-panel" id="lease-form"><div class="form-head"><div><span class="eyebrow">START LEASE</span><h3>Assign one car to one driver</h3></div><button type="button" class="form-return" data-action="close-form">Return</button></div>' +
      '<div class="readonly-note"><b>Single-entry workflow</b><span>Select the existing driver and available car once. Rent, vehicle status, driver assignment, and mileage update from this lease.</span></div>' +
      '<div class="form-grid">' +
      selectField('Driver', 'driverId', [{ value: '', label: 'Select driver' }].concat(openDrivers.map(function (driver) { return { value: driver.id, label: driver.name + ' · ' + driver.license }; })), '') +
      selectField('Available car', 'vehicleId', [{ value: '', label: 'Select available car' }].concat(openVehicles.map(function (vehicle) { return { value: vehicle.id, label: vehicle.unitNumber + ' · ' + vehicle.make + ' · ' + number(vehicle.mileage) + ' mi' }; })), '') +
      field('Start date', 'startDate', today(), 'date', true) + field('Expected return date', 'expectedReturnDate', '', 'date') +
      field('Monthly rent', 'monthlyRent', '', 'number', true, '0.01') + field('Deposit', 'deposit', '', 'number', false, '0.01') +
      field('Rent due day', 'rentDueDay', '1', 'number', true) + field('Start mileage', 'startOdometer', '', 'number', true) +
      '</div><label>Lease notes<textarea name="notes" placeholder="Terms, deposit, insurance notes, payment rules"></textarea></label>' +
      proofField('') +
      '<div class="form-actions">' + returnAction('Return to leases') + '<button class="btn btn-primary">Start lease</button></div></form>';
  }

  function rentForm() {
    var user = currentUser();
    var selectedCharge = ui.editing?.kind === 'rent' ? rentChargeById(ui.editing.id) : null;
    var openCharges = scope(state.rentCharges).filter(function (charge) { return chargeBalance(charge) > 0; });
    return '<form class="form-panel" id="rent-form"><div class="form-head"><div><span class="eyebrow">RECEIVE RENT</span><h3>Post monthly rent once</h3></div><button type="button" class="form-return" data-action="close-form">Return</button></div>' +
      '<div class="form-grid">' +
      selectField('Open rent charge', 'chargeId', [{ value: '', label: 'Select rent due' }].concat(openCharges.map(function (charge) {
        var driver = driverById(charge.driverId);
        var vehicle = vehicleById(charge.vehicleId);
        return { value: charge.id, label: charge.period + ' · ' + (driver?.name || 'Driver') + ' · ' + (vehicle?.unitNumber || 'Vehicle') + ' · ' + money(chargeBalance(charge)) + ' open' };
      })), selectedCharge?.id || '') +
      field('Amount received', 'amountPaid', selectedCharge ? chargeBalance(selectedCharge) : '', 'number', true, '0.01') +
      selectField('Payment method', 'paymentMethod', ['Zelle', 'Cash', 'Check', 'Bank transfer', 'Card', 'Other'], selectedCharge?.paymentMethod || 'Zelle') +
      field('Reference number', 'reference', '', 'text') +
      field('Payment date', 'paidAt', today(), 'date', true) +
      '</div><label>Payment notes<textarea name="notes" placeholder="Receipt, partial payment, balance notes"></textarea></label>' +
      proofField('') +
      '<div class="form-actions">' + returnAction('Return to leases') + '<button class="btn btn-primary">Post rent payment</button></div></form>';
  }

  function returnForm() {
    var selectedLease = ui.editing?.kind === 'return' ? leaseById(ui.editing.id) : null;
    var activeLeases = scope(state.leases).filter(function (lease) { return lease.status === 'active'; });
    return '<form class="form-panel" id="return-form"><div class="form-head"><div><span class="eyebrow">RETURN VEHICLE</span><h3>Close lease and free the car</h3></div><button type="button" class="form-return" data-action="close-form">Return</button></div>' +
      '<div class="form-grid">' +
      selectField('Active lease', 'leaseId', [{ value: '', label: 'Select lease' }].concat(activeLeases.map(function (lease) {
        var driver = driverById(lease.driverId);
        var vehicle = vehicleById(lease.vehicleId);
        return { value: lease.id, label: (vehicle?.unitNumber || 'Vehicle') + ' · ' + (driver?.name || 'Driver') + ' · ' + money(leaseBalance(lease.id)) + ' open' };
      })), selectedLease?.id || '') +
      field('Return date', 'returnDate', today(), 'date', true) +
      field('Return mileage', 'returnOdometer', selectedLease ? vehicleById(selectedLease.vehicleId)?.mileage || '' : '', 'number', true) +
      '</div><label>Return notes<textarea name="notes" placeholder="Condition, damages, final balance, keys, photos"></textarea></label>' +
      proofField('') +
      '<div class="form-actions">' + returnAction('Return to leases') + '<button class="btn btn-primary">Close lease</button></div></form>';
  }

  function mileageForm() {
    var user = currentUser();
    var driverLease = currentLeaseForUser();
    var activeLeases = user.role === 'driver' && driverLease ? [driverLease] : scope(state.leases).filter(function (lease) { return lease.status === 'active'; });
    var selectedLease = activeLeases[0] || null;
    return '<form class="form-panel" id="mileage-form"><div class="form-head"><div><span class="eyebrow">MILEAGE CHECK</span><h3>Update odometer</h3></div><button type="button" class="form-return" data-action="close-form">Return</button></div>' +
      '<div class="form-grid">' +
      (user.role === 'driver' && driverLease ? '<input type="hidden" name="leaseId" value="' + esc(driverLease.id) + '">' : selectField('Active lease', 'leaseId', [{ value: '', label: 'Select lease' }].concat(activeLeases.map(function (lease) {
        var driver = driverById(lease.driverId);
        var vehicle = vehicleById(lease.vehicleId);
        return { value: lease.id, label: (vehicle?.unitNumber || 'Vehicle') + ' · ' + (driver?.name || 'Driver') };
      })), selectedLease?.id || '')) +
      field('Date', 'date', today(), 'date', true) +
      field('Current mileage', 'odometer', selectedLease ? vehicleById(selectedLease.vehicleId)?.mileage || '' : '', 'number', true) +
      '</div><label>Notes<textarea name="notes" placeholder="Monthly check, service mileage, return prep"></textarea></label>' +
      '<div class="form-actions">' + returnAction('Return to leases') + '<button class="btn btn-primary">Save mileage</button></div></form>';
  }

  function renderVehicles() {
    if (!canManageOperations()) return forbidden();
    var vehicles = searchable(scope(state.vehicles), ['unitNumber', 'make', 'model', 'plate', 'vin']);
    var canAdd = canManageOperations();
    return pageHeader('Fleet vehicles', 'Track assignments, mileage, finance, and operating status.', canAdd ? 'Add vehicle' : '', 'toggle-vehicle-form') +
      (ui.form === 'vehicle' ? vehicleForm() : '') +
      filters('Search unit, make, model, VIN, or plate…', ['available', 'leased', 'maintenance', 'inactive']) +
      '<section class="panel table-panel">' + renderTable(['Vehicle', 'Assigned driver', 'Mileage', 'Finance', 'Status', ''], vehicles.map(function (vehicle) {
        return [
          '<div class="entity">' + vehicleThumb(vehicle) + '<span><b>' + esc(vehicle.unitNumber) + '</b><small>' + esc(vehicle.year + ' ' + vehicle.make + ' ' + vehicle.model) + '</small></span></div>',
          esc(driverById(vehicle.driverId)?.name || 'Unassigned'),
          '<b>' + number(vehicle.mileage) + '</b><small>miles</small>',
          '<b>' + money(vehicle.loanBalance) + '</b><small>' + money(vehicle.monthlyPayment) + ' / month</small>',
          statusBadge(vehicle.status),
          canManage() ? '<div class="row-actions"><button class="mini-btn primary" data-action="vehicle-details" data-id="' + vehicle.id + '">View details</button><button class="mini-btn" data-action="edit-vehicle" data-id="' + vehicle.id + '">Edit</button><button class="mini-btn" data-action="vehicle-status" data-id="' + vehicle.id + '">Status</button></div>' : ''
        ];
      }), 'No vehicles found.') + '</section>';
  }

  function vehicleForm() {
    var vehicle = ui.editing?.kind === 'vehicle' ? vehicleById(ui.editing.id) : null;
    var isEdit = Boolean(vehicle);
    var vendorField = isOwner() ? vendorSelect(vehicle?.vendorId) : '<input type="hidden" name="vendorId" value="' + esc(currentUser().vendorId) + '">';
    return '<form class="form-panel" id="vehicle-form"><div class="form-head"><div><span class="eyebrow">' + (isEdit ? 'EDIT FLEET ASSET' : 'FLEET ASSET') + '</span><h3>' + (isEdit ? 'Edit vehicle' : 'Add vehicle') + '</h3></div><button type="button" class="form-return" data-action="close-form">Return</button></div>' +
      vendorField + '<div class="form-grid">' +
      field('Make', 'make', vehicle?.make || '', 'text', true) +
      field('Model', 'model', vehicle?.model || '', 'text', true) + field('Year', 'year', vehicle?.year || new Date().getFullYear(), 'number', true) +
      field('VIN', 'vin', vehicle?.vin || '', 'text') + field('Plate', 'plate', vehicle?.plate || '', 'text', true) +
      field('Current mileage', 'mileage', vehicle?.mileage ?? '0', 'number', true) + field('Bought date', 'boughtDate', vehicle?.boughtDate || today(), 'date') +
      field('Total cost', 'totalCost', vehicle?.totalCost ?? '0', 'number') + field('Loan balance', 'loanBalance', vehicle?.loanBalance ?? '0', 'number') +
      field('Monthly payment', 'monthlyPayment', vehicle?.monthlyPayment ?? '0', 'number') + selectField('Status', 'status', ['available', 'leased', 'maintenance', 'inactive'], vehicle?.status || 'available') +
      '</div><div class="upload-section"><div><span class="eyebrow">VEHICLE MEDIA</span><h4>Condition and overview files</h4><p>Add clear evidence of the vehicle at onboarding.</p></div><div class="upload-grid">' +
        mediaUploadField('Vehicle photo', 'vehiclePhoto', 'image/*', 'Exterior or front view · up to 5 MB', 5, vehicle?.vehiclePhotoName) +
        mediaUploadField('Odometer photo', 'odometerPhoto', 'image/*', 'Readable mileage photo · up to 5 MB', 5, vehicle?.odometerPhotoName) +
        mediaUploadField('Vehicle overview video', 'overviewVideo', 'video/*', 'Walk-around video · up to 18 MB', 18, vehicle?.overviewVideoName) +
      '</div></div><div class="form-actions">' + returnAction('Return to vehicles') + '<button class="btn btn-primary">' + (isEdit ? 'Save changes' : 'Save vehicle') + '</button></div></form>';
  }

  function renderDrivers() {
    if (!canManageOperations()) return forbidden();
    var drivers = searchable(scope(state.drivers), ['name', 'phone', 'email', 'license', 'address']);
    return pageHeader('Drivers', 'Manage assignments, contacts, license dates, and availability.', 'Add driver', 'toggle-driver-form') +
      (ui.form === 'driver' ? driverForm() : '') +
      filters('Search driver, phone, license, or city…', ['active', 'inactive', 'on_leave']) +
      '<div class="driver-grid">' + drivers.map(function (driver) {
        var vehicle = vehicleById(driver.vehicleId);
        var lease = activeLeaseForDriver(driver.id);
        var expiring = driver.licenseExpiry && new Date(driver.licenseExpiry) < new Date(Date.now() + 1000 * 60 * 60 * 24 * 120);
        return '<article class="driver-card"><div class="driver-card-head">' + driverAvatar(driver, 'large') + '<div><h3>' + esc(driver.name) + '</h3><p>' + esc(driver.email) + '</p></div>' + statusBadge(driver.status) + '</div>' +
          '<div class="driver-detail"><span>Assigned vehicle</span><b>' + esc(vehicle ? vehicle.unitNumber + ' · ' + vehicle.make : 'Unassigned') + '</b></div>' +
          '<div class="driver-detail"><span>License</span><b>' + esc(driver.license) + '</b><small class="' + (expiring ? 'text-danger' : '') + '">Expires ' + esc(driver.licenseExpiry) + '</small></div>' +
          '<div class="driver-summary"><div><b>' + (lease ? money(lease.monthlyRent) : 'No lease') + '</b><span>Monthly rent</span></div><div><b>' + (lease ? money(leaseBalance(lease.id)) : '$0') + '</b><span>Open rent</span></div></div>' +
          '<div class="card-actions"><button class="btn btn-primary" data-action="driver-details" data-id="' + driver.id + '">View details</button><button class="btn btn-soft" data-action="edit-driver" data-id="' + driver.id + '">Edit</button><button class="btn btn-soft" data-module="leases">Start lease</button><a class="icon-btn" href="tel:' + esc(driver.phone) + '">☎</a></div></article>';
      }).join('') + '</div>' + (!drivers.length ? emptyState('No matching drivers', 'Add a driver or change the search.', 'drivers') : '');
  }

  function driverForm() {
    var driver = ui.editing?.kind === 'driver' ? driverById(ui.editing.id) : null;
    var isEdit = Boolean(driver);
    var vendorId = driver?.vendorId || (isOwner() ? '' : currentUser().vendorId);
    var vendorField = isOwner() ? vendorSelect(vendorId) : '<input type="hidden" name="vendorId" value="' + esc(vendorId) + '">';
    return '<form class="form-panel" id="driver-form"><div class="form-head"><div><span class="eyebrow">' + (isEdit ? 'EDIT TEAM MEMBER' : 'TEAM MEMBER') + '</span><h3>' + (isEdit ? 'Edit driver' : 'Add driver') + '</h3></div><button type="button" class="form-return" data-action="close-form">Return</button></div>' +
      vendorField + '<div class="form-grid">' +
      field('Full name', 'name', driver?.name || '', 'text', true) + field('Phone', 'phone', driver?.phone || '', 'tel', true) +
      field('Email optional', 'email', driver?.email || '', 'email') + field('CDL / license', 'license', driver?.license || '', 'text', true) +
      field('License expiry', 'licenseExpiry', driver?.licenseExpiry || '', 'date', true) + field('Insurance provider', 'insuranceProvider', driver?.insuranceProvider || '', 'text') +
      field('Insurance policy #', 'insurancePolicy', driver?.insurancePolicy || '', 'text') + field('Insurance expiry', 'insuranceExpiry', driver?.insuranceExpiry || '', 'date') +
      field('Address', 'address', driver?.address || '', 'text') + field('Emergency contact', 'emergencyContact', driver?.emergencyContact || '', 'text') +
      '</div><div id="driver-phone-error" class="inline-error" aria-live="polite"></div><div class="upload-section"><div><span class="eyebrow">DRIVER DOCUMENTS</span><h4>Identity and agreement files</h4><p>These records are visible only to the driver and their company administrator.</p></div><div class="upload-grid">' +
        mediaUploadField('Driver photo', 'driverPhoto', 'image/*', 'Clear profile photo · up to 5 MB', 5, driver?.driverPhotoName) +
        mediaUploadField('Driving licence photo', 'licensePhoto', 'image/*', 'Front of licence · up to 5 MB', 5, driver?.licensePhotoName) +
        mediaUploadField('Insurance document', 'insuranceDoc', 'image/*,.pdf,.doc,.docx', 'Insurance card or policy file · up to 8 MB', 8, driver?.insuranceDocName) +
        mediaUploadField('Driver agreement', 'agreement', 'image/*,.pdf,.doc,.docx', 'Signed image, PDF, or Word file · up to 8 MB', 8, driver?.agreementName) +
      '</div></div><div class="form-actions">' + returnAction('Return to drivers') + '<button class="btn btn-primary">' + (isEdit ? 'Save changes' : 'Save driver') + '</button></div></form>';
  }

  function driverAvatar(driver, size) {
    if (driver.driverPhotoData) return '<div class="avatar ' + esc(size || '') + ' media-avatar"><img src="' + driver.driverPhotoData + '" alt="' + esc(driver.name) + '"></div>';
    return '<div class="avatar ' + esc(size || '') + '">' + esc(driver.name.split(' ').map(function (x) { return x[0]; }).join('').slice(0, 2)) + '</div>';
  }

  function vehicleThumb(vehicle) {
    if (vehicle.vehiclePhotoData) return '<div class="vehicle-mark media-thumb"><img src="' + vehicle.vehiclePhotoData + '" alt="' + esc(vehicle.unitNumber) + '"></div>';
    return '<div class="vehicle-mark">' + esc(vehicle.make.slice(0, 1)) + '</div>';
  }

  function mediaUploadField(label, key, accept, hint, maxMb, existingName) {
    return '<label class="upload-box media-upload"><input type="file" data-upload-key="' + key + '" data-max-mb="' + maxMb + '" accept="' + accept + '"><span>▧</span><b id="upload-label-' + key + '">' + esc(existingName ? '✓ ' + existingName : label) + '</b><small>' + esc(existingName ? 'Existing file stays unless replaced. ' + hint : hint) + '</small></label>';
  }

  function attachmentTile(label, record, prefix, collection) {
    var name = record[prefix + 'Name'];
    var data = record[prefix + 'Data'];
    var type = record[prefix + 'Type'] || '';
    var preview = data && type.indexOf('image/') === 0 ? '<img src="' + data + '" alt="' + esc(label) + '">' : '<span>' + (type.indexOf('video/') === 0 ? '▶' : '▧') + '</span>';
    if (!name) return '<div class="attachment-card missing"><span>＋</span><div><b>' + esc(label) + '</b><small>' + driverBilingual('Not uploaded', 'अपलोड नहीं किया') + '</small></div></div>';
    return '<button class="attachment-card" data-action="record-media" data-kind="' + collection + '" data-id="' + record.id + '" data-field="' + prefix + '"' + (data ? '' : ' disabled') + '>' + preview + '<div><b>' + esc(label) + '</b><small>' + esc(name) + '</small></div><em>' + (data ? driverBilingual('Open', 'खोलें') : driverBilingual('Unavailable', 'उपलब्ध नहीं')) + '</em></button>';
  }

  function detailLine(label, value) {
    return '<div><span>' + esc(label) + '</span><b>' + esc(value || driverBilingual('Not provided', 'उपलब्ध नहीं')) + '</b></div>';
  }

  function proofAttachmentTile(label, record, kind) {
    if (!record.proofName) return '<div class="attachment-card missing"><span>＋</span><div><b>' + esc(label) + '</b><small>Optional · not attached</small></div></div>';
    return '<button class="attachment-card" data-action="proof" data-id="' + record.id + '" data-kind="' + kind + '"' + (record.proof ? '' : ' disabled') + '><span>▧</span><div><b>' + esc(label) + '</b><small>' + esc(record.proofName) + '</small></div><em>' + (record.proof ? 'Open' : 'Unavailable') + '</em></button>';
  }

  function mediaTypeFromData(data, fallback) {
    var match = String(data || '').match(/^data:([^;]+)/);
    return fallback || (match ? match[1] : 'application/octet-stream');
  }

  function mediaPreviewKind(type, data) {
    var value = mediaTypeFromData(data, type);
    if (value.indexOf('image/') === 0) return 'image';
    if (value.indexOf('video/') === 0) return 'video';
    if (value === 'application/pdf') return 'pdf';
    return 'file';
  }

  function openMediaPreview(name, type, data) {
    if (!data) { alert('The original file is not available.'); return; }
    ui.media = {
      name: name || 'Attachment',
      type: mediaTypeFromData(data, type),
      data: data
    };
    render();
  }

  function renderMediaModal() {
    if (!ui.media) return '';
    var kind = mediaPreviewKind(ui.media.type, ui.media.data);
    var safeName = esc(ui.media.name || 'Attachment');
    var safeData = esc(ui.media.data || '');
    var body = '';
    if (kind === 'image') {
      body = '<div class="media-stage"><img src="' + safeData + '" alt="' + safeName + '"></div>';
    } else if (kind === 'video') {
      body = '<div class="media-stage"><video src="' + safeData + '" controls autoplay playsinline></video></div>';
    } else if (kind === 'pdf') {
      body = '<div class="media-stage document"><iframe src="' + safeData + '" title="' + safeName + '"></iframe></div>';
    } else {
      body = '<div class="media-stage file-preview"><span>▧</span><b>' + safeName + '</b><p>This file type cannot be previewed directly here.</p></div>';
    }
    return '<div class="media-backdrop" role="dialog" aria-modal="true" aria-label="Attachment preview">' +
      '<section class="media-modal"><header><div><span class="eyebrow">ATTACHMENT PREVIEW</span><h2>' + safeName + '</h2><p>' + esc(ui.media.type || 'File') + '</p></div><button data-action="close-media" aria-label="Close preview">×</button></header>' +
      body +
      '<div class="media-actions"><button type="button" class="btn btn-soft" data-action="close-media">Return</button><a class="btn btn-primary" href="' + safeData + '" download="' + safeName + '">Download</a></div>' +
      '</section></div>';
  }

  function renderDetailModal() {
    if (!ui.detail) return '';
    if (ui.detail.kind === 'booking') {
      var booking = bookingById(ui.detail.id);
      var user = currentUser();
      if (!booking || !user || (user.role !== 'platform_owner' && booking.vendorId !== user.vendorId)) return '';
      var bookingVendor = vendorById(booking.vendorId);
      var bookingVehicle = vehicleById(booking.vehicleId);
      var payments = state.bookingPayments.filter(function (payment) { return payment.bookingId === booking.id; });
      return '<div class="detail-backdrop"><section class="detail-modal" role="dialog" aria-modal="true" aria-label="Booking details"><header><div><span class="eyebrow">PUBLIC BOOKING</span><h2>' + esc(booking.bookingCode || booking.id) + '</h2><p>' + esc(bookingVendor?.companyName || 'Fleet') + ' · ' + esc(booking.paymentStatus || 'pending') + '</p></div><button data-action="close-details" aria-label="Close details">×</button></header>' +
        (canManageOperations() && booking.status !== 'cancelled' ? '<div class="detail-actions"><button class="btn btn-primary" data-action="booking-accept" data-id="' + booking.id + '">Accept booking</button><button class="btn btn-soft" data-action="booking-assigned" data-id="' + booking.id + '">Mark assigned</button><button class="btn btn-danger-soft" data-action="booking-cancel" data-id="' + booking.id + '">Cancel</button></div>' : '') +
        '<div class="detail-lines">' +
          detailLine('Customer', booking.customerName) + detailLine('Phone', booking.phone) + detailLine('Email', booking.email) +
          detailLine('Requested car', bookingVehicle ? bookingVehicle.unitNumber + ' · ' + bookingVehicle.make + ' ' + bookingVehicle.model : booking.vehicleLabel || booking.carType || 'Admin to suggest') +
          detailLine('Pickup date', booking.pickupDate) + detailLine('Return date', booking.returnDate) +
          detailLine('Pickup location', booking.pickupLocation) + detailLine('Booking fee', inr(booking.bookingFee || 100)) + detailLine('Status', (booking.status || 'new') + ' · ' + (booking.paymentStatus || 'pending')) +
        '</div>' +
        '<div class="detail-section"><div><span class="eyebrow">PAYMENT</span><h3>Payment ledger</h3></div>' +
          renderTable(['Order', 'Payment', 'Amount', 'Status'], payments.map(function (payment) {
            return [
              '<b>' + esc(payment.paymentOrderId || payment.razorpayOrderId || 'Order pending') + '</b><small>' + esc(payment.createdAt || '') + '</small>',
              '<b>' + esc(payment.paymentId || payment.razorpayPaymentId || 'Not captured') + '</b><small>' + esc(payment.method || payment.provider || '') + '</small>',
              inr(payment.amount || 0),
              statusBadge(payment.status || 'created')
            ];
          }), 'No payment records yet.') +
        '</div><div class="detail-section"><div><span class="eyebrow">NOTES</span><h3>Customer request</h3></div><p class="detail-note">' + esc(booking.notes || 'No notes added.') + '</p></div>' +
      '</section></div>';
    }
    if (ui.detail.kind === 'driver') {
      var driver = driverById(ui.detail.id);
      var detailUser = currentUser();
      var ownDriverRecord = detailUser?.role === 'driver' && detailUser.driverId === driver?.id;
      if (!driver || (!ownDriverRecord && (!canManageOperations() || driver.vendorId !== detailUser.vendorId))) return '';
      var vehicle = vehicleById(driver.vehicleId);
      var vendor = vendorById(driver.vendorId);
      return '<div class="detail-backdrop"><section class="detail-modal" role="dialog" aria-modal="true" aria-label="Driver details"><header><div><span class="eyebrow">' + driverBilingual('DRIVER RECORD', 'ड्राइवर रिकॉर्ड') + '</span><h2>' + esc(driver.name) + '</h2><p>' + esc(vendor?.companyName || 'Company') + '</p></div><button data-action="close-details" aria-label="Close details">×</button></header>' +
        '<div class="detail-profile">' + driverAvatar(driver, 'profile') + '<div><h3>' + esc(driver.name) + '</h3><p>' + esc(driver.email) + ' · ' + esc(driver.phone) + '</p>' + statusBadge(driver.status) + '</div></div>' +
        (ownDriverRecord ? '<div class="readonly-note"><b>Read-only driver record / केवल पढ़ने योग्य रिकॉर्ड</b><span>Your documents can only be changed by your company administrator. / आपके दस्तावेज़ केवल कंपनी एडमिन बदल सकते हैं।</span></div>' : '') +
        '<div class="detail-lines">' + detailLine(driverBilingual('Driving licence', 'ड्राइविंग लाइसेंस'), driver.license) + detailLine(driverBilingual('Licence expiry', 'लाइसेंस समाप्ति'), driver.licenseExpiry) + detailLine('Insurance provider', driver.insuranceProvider) + detailLine('Insurance policy', driver.insurancePolicy) + detailLine('Insurance expiry', driver.insuranceExpiry) + detailLine(driverBilingual('Assigned vehicle', 'निर्धारित वाहन'), vehicle ? vehicle.unitNumber + ' · ' + vehicle.make + ' ' + vehicle.model : driverBilingual('Unassigned', 'निर्धारित नहीं')) + detailLine(driverBilingual('Address', 'पता'), driver.address) + detailLine(driverBilingual('Emergency contact', 'आपातकालीन संपर्क'), driver.emergencyContact) + '</div>' +
        '<div class="detail-section"><div><span class="eyebrow">' + driverBilingual('DOCUMENTS', 'दस्तावेज़') + '</span><h3>' + driverBilingual('DL, insurance, and agreement', 'डीएल, बीमा और समझौता') + '</h3></div><div class="attachment-grid">' + attachmentTile(driverBilingual('Driver photo', 'ड्राइवर फोटो'), driver, 'driverPhoto', 'drivers') + attachmentTile(driverBilingual('Driving licence photo', 'ड्राइविंग लाइसेंस फोटो'), driver, 'licensePhoto', 'drivers') + attachmentTile('Insurance document', driver, 'insuranceDoc', 'drivers') + attachmentTile(driverBilingual('Driver agreement', 'ड्राइवर समझौता'), driver, 'agreement', 'drivers') + '</div></div>' +
      '</section></div>';
    }
    if (ui.detail.kind === 'vehicle') {
      var vehicleRecord = vehicleById(ui.detail.id);
      if (!vehicleRecord || !canManageOperations() || vehicleRecord.vendorId !== currentUser().vendorId) return '';
      var assigned = driverById(vehicleRecord.driverId);
      return '<div class="detail-backdrop"><section class="detail-modal" role="dialog" aria-modal="true" aria-label="Vehicle details"><header><div><span class="eyebrow">VEHICLE RECORD</span><h2>' + esc(vehicleRecord.unitNumber) + '</h2><p>' + esc(vehicleRecord.year + ' ' + vehicleRecord.make + ' ' + vehicleRecord.model) + '</p></div><button data-action="close-details" aria-label="Close details">×</button></header>' +
        '<div class="detail-actions"><button class="btn btn-primary" data-action="edit-vehicle" data-id="' + vehicleRecord.id + '">Edit vehicle</button></div>' +
        '<div class="detail-lines">' + detailLine('VIN', vehicleRecord.vin) + detailLine('Plate', vehicleRecord.plate) + detailLine('Current mileage', number(vehicleRecord.mileage) + ' miles') + detailLine('Assigned driver', assigned?.name || 'Unassigned') + detailLine('Bought date', vehicleRecord.boughtDate) + detailLine('Status', vehicleRecord.status) + detailLine('Total cost', money(vehicleRecord.totalCost)) + detailLine('Loan balance', money(vehicleRecord.loanBalance)) + detailLine('Monthly payment', money(vehicleRecord.monthlyPayment)) + '</div>' +
        '<div class="detail-section"><div><span class="eyebrow">VEHICLE MEDIA</span><h3>Condition evidence</h3></div><div class="attachment-grid">' + attachmentTile('Vehicle photo', vehicleRecord, 'vehiclePhoto', 'vehicles') + attachmentTile('Odometer photo', vehicleRecord, 'odometerPhoto', 'vehicles') + attachmentTile('Overview video', vehicleRecord, 'overviewVideo', 'vehicles') + '</div></div>' +
      '</section></div>';
    }
    if (ui.detail.kind === 'lease') {
      var lease = leaseById(ui.detail.id);
      if (!lease || !canViewOperationalRecord(lease)) return '';
      var leaseDriver = driverById(lease.driverId);
      var leaseVehicle = vehicleById(lease.vehicleId);
      var charges = leaseCharges(lease.id);
      var readings = state.mileageReadings.filter(function (reading) { return reading.leaseId === lease.id; });
      return '<div class="detail-backdrop"><section class="detail-modal" role="dialog" aria-modal="true" aria-label="Lease details"><header><div><span class="eyebrow">LEASE RECORD</span><h2>' + esc(leaseVehicle?.unitNumber || 'Vehicle') + ' · ' + esc(leaseDriver?.name || 'Driver') + '</h2><p>' + esc(lease.startDate) + ' · ' + money(lease.monthlyRent) + ' monthly</p></div><button data-action="close-details" aria-label="Close details">×</button></header>' +
        '<div class="detail-lines">' + detailLine('Driver', leaseDriver?.name || 'Unassigned') + detailLine('Vehicle', leaseVehicle ? leaseVehicle.unitNumber + ' · ' + leaseVehicle.make + ' ' + leaseVehicle.model : 'Unassigned') + detailLine('Start date', lease.startDate) + detailLine('Expected return', lease.expectedReturnDate || 'Month to month') + detailLine('Monthly rent', money(lease.monthlyRent)) + detailLine('Deposit', money(lease.deposit)) + detailLine('Rent due day', lease.rentDueDay) + detailLine('Start mileage', number(lease.startOdometer)) + detailLine('Return mileage', lease.returnOdometer ? number(lease.returnOdometer) : 'Not returned') + detailLine('Open balance', money(leaseBalance(lease.id))) + '</div>' +
        '<div class="detail-section"><div><span class="eyebrow">RENT LEDGER</span><h3>Monthly payments</h3></div>' + renderTable(['Month', 'Due', 'Paid', 'Balance', 'Status'], charges.map(function (charge) { charge.status = rentStatus(charge); return [esc(charge.period), money(charge.amountDue), money(charge.amountPaid), money(chargeBalance(charge)), statusBadge(charge.status)]; }), 'No rent charges yet.') + '</div>' +
        '<div class="detail-section"><div><span class="eyebrow">MILEAGE</span><h3>Readings</h3></div>' + renderTable(['Date', 'Type', 'Odometer', 'Notes'], readings.map(function (reading) { return [esc(reading.date), esc(reading.type), number(reading.odometer), esc(reading.notes || '')]; }), 'No mileage readings yet.') + '</div>' +
        '<div class="detail-section"><div><span class="eyebrow">DOCUMENTS</span><h3>Lease file</h3></div><div class="attachment-grid single">' + proofAttachmentTile('Lease agreement / return docs', { id: lease.id, proofName: lease.leaseDocName, proof: lease.leaseDoc }, 'lease') + '</div></div>' +
      '</section></div>';
    }
    if (ui.detail.kind === 'expense') {
      var expense = expenseById(ui.detail.id);
      if (!canViewOperationalRecord(expense)) return '';
      var expenseDriver = driverById(expense.driverId);
      var expenseVehicle = vehicleById(expense.vehicleId);
      var expenseTrip = tripById(expense.tripId);
      return '<div class="detail-backdrop"><section class="detail-modal" role="dialog" aria-modal="true" aria-label="Expense details"><header><div><span class="eyebrow">EXPENSE RECORD</span><h2>' + esc(expense.category) + '</h2><p>' + esc(expense.date) + ' · ' + money(expense.amount) + '</p></div><button data-action="close-details" aria-label="Close details">×</button></header>' +
        (canManageOperations() ? '<div class="detail-actions"><button class="btn btn-primary" data-action="edit-expense" data-id="' + expense.id + '">Edit expense</button></div>' : '') +
        '<div class="detail-lines">' + detailLine('Amount', money(expense.amount)) + detailLine('Status', expense.status) + detailLine('Driver', expenseDriver?.name || 'Unassigned') + detailLine('Vehicle', expenseVehicle ? expenseVehicle.unitNumber + ' · ' + expenseVehicle.make : 'Unassigned') + detailLine('Related trip', expenseTrip ? expenseTrip.startPoint + ' → ' + expenseTrip.endPoint : 'No related trip') + detailLine('Expense applies to', expense.costSource || (expense.tripId ? 'trip' : 'general')) + detailLine('Payment method', expense.paymentMethod) + detailLine('Description', expense.description) + detailLine('Reviewed by', expense.reviewedBy || 'Not reviewed') + '</div>' +
        '<div class="detail-section"><div><span class="eyebrow">OPTIONAL ATTACHMENT</span><h3>Receipt or supporting proof</h3></div><div class="attachment-grid single">' + proofAttachmentTile('Receipt / proof', expense, 'expense') + '</div></div>' +
      '</section></div>';
    }
    if (ui.detail.kind === 'maintenance') {
      var maintenance = maintenanceById(ui.detail.id);
      if (!canViewOperationalRecord(maintenance)) return '';
      var maintenanceDriver = driverById(maintenance.driverId);
      var maintenanceVehicle = vehicleById(maintenance.vehicleId);
      return '<div class="detail-backdrop"><section class="detail-modal" role="dialog" aria-modal="true" aria-label="Maintenance details"><header><div><span class="eyebrow">MAINTENANCE RECORD</span><h2>' + esc(maintenance.type) + '</h2><p>' + esc(maintenance.date) + ' · ' + money(maintenance.estimate) + '</p></div><button data-action="close-details" aria-label="Close details">×</button></header>' +
        (canManageOperations() ? '<div class="detail-actions"><button class="btn btn-primary" data-action="edit-maintenance" data-id="' + maintenance.id + '">Edit maintenance</button></div>' : '') +
        '<div class="detail-lines">' + detailLine('Estimated cost', money(maintenance.estimate)) + detailLine('Status', maintenance.status) + detailLine('Driver', maintenanceDriver?.name || 'Unassigned') + detailLine('Vehicle', maintenanceVehicle ? maintenanceVehicle.unitNumber + ' · ' + maintenanceVehicle.make : 'Unassigned') + detailLine('Odometer', number(maintenance.odometer)) + detailLine('Shop', maintenance.shop) + detailLine('Description', maintenance.description) + detailLine('Reviewed by', maintenance.reviewedBy || 'Not reviewed') + detailLine('Created', maintenance.createdAt ? new Date(maintenance.createdAt).toLocaleString() : maintenance.date) + '</div>' +
        '<div class="detail-section"><div><span class="eyebrow">OPTIONAL ATTACHMENT</span><h3>Estimate or supporting proof</h3></div><div class="attachment-grid single">' + proofAttachmentTile('Estimate / proof', maintenance, 'maintenance') + '</div></div>' +
      '</section></div>';
    }
    return '';
  }

  function renderTrips() {
    if (isOwner()) return forbidden();
    var trips = searchable(scope(state.trips), ['startPoint', 'endPoint', 'renterName', 'notes', 'revenueSource', 'id']);
    var canAdd = canCreateOperationalRecord('trip');
    return pageHeader(driverBilingual('Trips & revenue', 'यात्राएँ और आय'), driverBilingual('Record income from completed trips or vehicle rentals.', 'पूरी हुई यात्राओं या वाहन किराये की आय दर्ज करें।'), canAdd ? driverBilingual('New revenue', 'नई आय') : '', 'toggle-trip-form') +
      (ui.form === 'trip' ? tripForm() : '') +
      filters(driverBilingual('Search ID, route, renter, or note…', 'आईडी, मार्ग, किरायेदार या नोट खोजें…'), ['planned', 'in_progress', 'completed', 'cancelled']) +
      '<section class="panel table-panel">' + renderTable([driverBilingual('Revenue', 'आय'), driverBilingual('Driver / unit', 'ड्राइवर / वाहन'), driverBilingual('Route / renter', 'मार्ग / किरायेदार'), driverBilingual('Dates & miles', 'तारीख और मील'), driverBilingual('Amount', 'राशि'), driverBilingual('Status', 'स्थिति'), ''], trips.map(function (trip) {
        var driver = driverById(trip.driverId);
        var vehicle = vehicleById(trip.vehicleId);
        var distance = Math.max(0, Number(trip.endOdometer || 0) - Number(trip.startOdometer || 0));
        var source = revenueSource(trip);
        var actions = '';
        if (source === 'trip' && trip.status === 'planned') actions = '<button class="mini-btn" data-action="trip-start" data-id="' + trip.id + '">' + driverBilingual('Start', 'शुरू करें') + '</button>';
        if (source === 'trip' && trip.status === 'in_progress') actions = '<button class="mini-btn primary" data-action="trip-complete" data-id="' + trip.id + '">' + driverBilingual('Complete', 'पूरा करें') + '</button>';
        return [
          '<b>#' + esc(trip.id.replace('trip_', '')) + '</b><small>' + sourceBadge(source) + ' ' + esc(trip.notes || 'No note') + '</small>',
          '<b>' + esc(driver?.name || 'Unassigned') + '</b><small>' + esc(vehicle?.unitNumber || 'No unit') + '</small>',
          revenueRoute(trip),
          '<b>' + esc(trip.startDate) + (trip.endDate ? ' – ' + esc(trip.endDate) : '') + '</b><small>' + (source === 'rent' ? 'Rental period' : number(distance) + ' miles') + '</small>',
          '<b>' + money(trip.tripMoney) + '</b>',
          statusBadge(trip.status),
          actions
        ];
      }), driverBilingual('No trips found.', 'कोई यात्रा नहीं मिली।')) + '</section>';
  }

  function tripForm() {
    var user = currentUser();
    var vendorField = isOwner() ? vendorSelect() : '<input type="hidden" name="vendorId" value="' + esc(user.vendorId) + '">';
    var driverId = user.role === 'driver' ? user.driverId : '';
    var sourceField = user.role === 'driver' ? '<input type="hidden" name="revenueSource" value="trip">' : selectField('Revenue source', 'revenueSource', [{ value: 'trip', label: 'Trip' }, { value: 'rent', label: 'Vehicle rent' }], 'trip').replace('<select ', '<select id="revenue-source" ');
    return '<form class="form-panel" id="trip-form"><div class="form-head"><div><span class="eyebrow">' + driverBilingual('NEW REVENUE', 'नई आय') + '</span><h3>' + driverBilingual('Record trip or rental income', 'यात्रा या किराये की आय दर्ज करें') + '</h3></div><button type="button" data-action="close-form">×</button></div>' +
      vendorField + '<div class="form-grid">' + sourceField +
      (user.role === 'driver' ? '<input type="hidden" name="driverId" value="' + esc(driverId) + '">' : driverSelect('driverId', driverId)) +
      vehicleSelect('vehicleId', driverById(driverId)?.vehicleId || '') +
      '</div><div class="revenue-fields" data-revenue-fields="trip"><div class="form-grid">' +
        field(driverBilingual('Start point', 'प्रारंभ स्थान'), 'startPoint', '', 'text', true) + field(driverBilingual('End point', 'गंतव्य'), 'endPoint', '', 'text', true) +
        field(driverBilingual('Start date', 'प्रारंभ तारीख'), 'startDate', today(), 'date', true) + field(driverBilingual('Start odometer', 'प्रारंभ ओडोमीटर'), 'startOdometer', '', 'number', true) +
        field(driverBilingual('Trip revenue', 'यात्रा आय'), 'tripMoney', '', 'number', true) + selectField(driverBilingual('Initial status', 'प्रारंभिक स्थिति'), 'status', ['planned', 'in_progress']) +
      '</div></div><div class="revenue-fields" data-revenue-fields="rent" hidden><div class="form-grid">' +
        field('Customer / renter', 'renterName', '', 'text', true) + field('Rental start date', 'startDate', today(), 'date', true) +
        field('Rental end date', 'endDate', today(), 'date', true) + field('Rental revenue', 'tripMoney', '', 'number', true) +
      '</div></div><label>' + driverBilingual('Notes', 'नोट्स') + '<textarea name="notes" placeholder="' + driverBilingual('Load, delivery, renter, or payment details', 'लोड, डिलीवरी या भुगतान की जानकारी') + '"></textarea></label>' +
      '<div class="form-actions"><button type="button" class="btn btn-soft" data-action="close-form">' + driverBilingual('Cancel', 'रद्द करें') + '</button><button class="btn btn-primary">' + driverBilingual('Save revenue', 'आय सहेजें') + '</button></div></form>';
  }

  function renderExpenses() {
    if (isOwner()) return forbidden();
    var records = searchable(scope(state.expenses), ['category', 'description', 'paymentMethod']);
    return pageHeader(driverBilingual('Expense claims', 'खर्च दावे'), driverBilingual('Capture every cost with an optional receipt and a clear approval trail.', 'हर खर्च को वैकल्पिक रसीद के साथ दर्ज करें।'), driverBilingual('New expense', 'नया खर्च'), 'toggle-expense-form') +
      (ui.form === 'expense' ? expenseForm() : '') +
      filters(driverBilingual('Search category, description, or payment method…', 'श्रेणी, विवरण या भुगतान तरीका खोजें…'), ['pending', 'approved', 'rejected']) +
      '<section class="panel table-panel">' + renderTable([driverBilingual('Claim', 'दावा'), driverBilingual('Driver / unit', 'ड्राइवर / वाहन'), driverBilingual('Amount', 'राशि'), driverBilingual('Optional receipt', 'वैकल्पिक रसीद'), driverBilingual('Status', 'स्थिति'), ''], records.map(function (item) {
        var actions = '<div class="row-actions"><button class="mini-btn primary" data-action="expense-details" data-id="' + item.id + '">View</button>';
        if (canManageOperations()) actions += '<button class="mini-btn" data-action="edit-expense" data-id="' + item.id + '">Edit</button>';
        if (canManageOperations() && item.status === 'pending') actions += '<button class="mini-btn approve" data-action="expense-approve" data-id="' + item.id + '">Approve</button><button class="mini-btn reject" data-action="expense-reject" data-id="' + item.id + '">Reject</button>';
        actions += '</div>';
        return [
          '<b>' + esc(item.category) + '</b><small>' + sourceBadge(item.costSource || (item.tripId ? 'trip' : 'general')) + ' ' + esc(item.date) + ' · ' + esc(item.paymentMethod) + '</small>',
          '<b>' + esc(driverById(item.driverId)?.name || 'Unknown') + '</b><small>' + esc(vehicleById(item.vehicleId)?.unitNumber || 'No unit') + '</small>',
          '<b class="amount">' + money(item.amount) + '</b><small>' + esc(item.description || 'Expense claim') + '</small>',
          item.proofName ? '<button class="proof-pill" data-action="proof" data-id="' + item.id + '" data-kind="expense">▧ ' + esc(item.proofName) + '</button>' : '<span class="missing-proof">' + driverBilingual('No proof', 'कोई प्रमाण नहीं') + '</span>',
          statusBadge(item.status),
          actions
        ];
      }), driverBilingual('No expense claims found.', 'कोई खर्च दावा नहीं मिला।')) + '</section>';
  }

  function expenseForm() {
    var user = currentUser();
    var vendor = currentVendor() || state.vendors[0];
    var expense = ui.editing?.kind === 'expense' ? expenseById(ui.editing.id) : null;
    var isEdit = Boolean(expense);
    var categories = vendor?.expenseCategories || ['Fuel', 'Toll', 'Parking', 'Repair'];
    var vendorField = isOwner() ? vendorSelect() : '<input type="hidden" name="vendorId" value="' + esc(user.vendorId) + '">';
    return '<form class="form-panel" id="expense-form"><div class="form-head"><div><span class="eyebrow">' + driverBilingual(isEdit ? 'EDIT CLAIM' : 'NEW CLAIM', isEdit ? 'दावा संपादित करें' : 'नया दावा') + '</span><h3>' + driverBilingual(isEdit ? 'Edit expense' : 'Add expense', isEdit ? 'खर्च संपादित करें' : 'खर्च जोड़ें') + '</h3></div><button type="button" data-action="close-form">×</button></div>' +
      vendorField + '<div class="form-grid">' +
      (user.role === 'driver' ? '<input type="hidden" name="driverId" value="' + esc(user.driverId) + '">' : driverSelect('driverId', expense?.driverId || '')) +
      vehicleSelect('vehicleId', expense?.vehicleId || (user.role === 'driver' ? driverById(user.driverId)?.vehicleId : '')) +
      tripSelect(expense?.tripId || '') + selectField(driverBilingual('Category', 'श्रेणी'), 'category', categories, expense?.category) +
      field(driverBilingual('Amount', 'राशि'), 'amount', expense?.amount ?? '', 'number', true, '0.01') + field(driverBilingual('Date', 'तारीख'), 'date', expense?.date || today(), 'date', true) +
      selectField(driverBilingual('Expense applies to', 'खर्च किससे संबंधित है'), 'costSource', [{ value: 'trip', label: driverBilingual('Trip', 'यात्रा') }, { value: 'rent', label: driverBilingual('Vehicle rent', 'वाहन किराया') }, { value: 'general', label: driverBilingual('General fleet', 'सामान्य बेड़ा') }], expense?.costSource || (expense?.tripId ? 'trip' : 'general')) +
      selectField(driverBilingual('Payment method', 'भुगतान का तरीका'), 'paymentMethod', [{ value: 'Fleet card', label: driverBilingual('Fleet card', 'फ्लीट कार्ड') }, { value: 'Cash', label: driverBilingual('Cash', 'नकद') }, { value: 'Credit card', label: driverBilingual('Credit card', 'क्रेडिट कार्ड') }, { value: 'Bank', label: driverBilingual('Bank', 'बैंक') }, { value: 'Other', label: driverBilingual('Other', 'अन्य') }], expense?.paymentMethod) +
      '</div><label>' + driverBilingual('Description', 'विवरण') + '<textarea name="description" placeholder="' + driverBilingual('What was purchased and why?', 'क्या खरीदा गया और क्यों?') + '">' + esc(expense?.description || '') + '</textarea></label>' + proofField(expense?.proofName) +
      '<div class="form-actions"><button type="button" class="btn btn-soft" data-action="close-form">' + driverBilingual('Cancel', 'रद्द करें') + '</button><button class="btn btn-primary">' + driverBilingual(isEdit ? 'Save changes' : 'Submit claim', isEdit ? 'बदलाव सहेजें' : 'दावा जमा करें') + '</button></div></form>';
  }

  function renderMaintenance() {
    if (isOwner()) return forbidden();
    var records = searchable(scope(state.maintenance), ['type', 'shop', 'description']);
    return pageHeader(driverBilingual('Maintenance', 'रखरखाव'), driverBilingual('Report issues early and protect vehicle uptime.', 'समस्या जल्दी दर्ज करें और वाहन को चालू रखें।'), driverBilingual('New request', 'नया अनुरोध'), 'toggle-maintenance-form') +
      (ui.form === 'maintenance' ? maintenanceForm() : '') +
      filters(driverBilingual('Search service type, shop, or description…', 'सेवा प्रकार, वर्कशॉप या विवरण खोजें…'), ['pending', 'approved', 'in_progress', 'completed', 'rejected']) +
      '<div class="maintenance-list">' + records.map(function (item) {
        var vehicle = vehicleById(item.vehicleId);
        var actions = '<button class="mini-btn primary" data-action="maintenance-details" data-id="' + item.id + '">View details</button>';
        if (canManageOperations()) actions += '<button class="mini-btn" data-action="edit-maintenance" data-id="' + item.id + '">Edit</button>';
        if (canManageOperations() && item.status === 'pending') actions += '<button class="mini-btn approve" data-action="maintenance-approve" data-id="' + item.id + '">Approve</button><button class="mini-btn reject" data-action="maintenance-reject" data-id="' + item.id + '">Reject</button>';
        if (canManageOperations() && item.status === 'approved') actions += '<button class="mini-btn primary" data-action="maintenance-complete" data-id="' + item.id + '">Mark complete</button>';
        return '<article class="maintenance-card"><div class="maintenance-icon">⚙</div><div class="maintenance-main"><div><h3>' + esc(item.type) + '</h3>' + statusBadge(item.status) + '</div><p>' + esc(item.description || 'No description') + '</p>' +
          '<div class="maintenance-meta"><span><b>' + esc(vehicle?.unitNumber || driverBilingual('No unit', 'कोई वाहन नहीं')) + '</b> ' + driverBilingual('Vehicle', 'वाहन') + '</span><span><b>' + number(item.odometer) + '</b> ' + driverBilingual('Odometer', 'ओडोमीटर') + '</span><span><b>' + esc(item.shop || driverBilingual('Not selected', 'चयन नहीं किया')) + '</b> ' + driverBilingual('Shop', 'वर्कशॉप') + '</span><span><b>' + esc(item.date) + '</b> ' + driverBilingual('Date', 'तारीख') + '</span></div></div>' +
          '<div class="maintenance-cost"><span>' + driverBilingual('Estimate', 'अनुमानित लागत') + '</span><strong>' + money(item.estimate) + '</strong>' + (item.proofName ? '<button class="proof-pill" data-action="proof" data-id="' + item.id + '" data-kind="maintenance">▧ ' + driverBilingual('Proof', 'प्रमाण') + '</button>' : '') + '<div class="row-actions">' + actions + '</div></div></article>';
      }).join('') + '</div>' + (!records.length ? emptyState(driverBilingual('No maintenance records', 'कोई रखरखाव रिकॉर्ड नहीं'), driverBilingual('Create a request when a vehicle needs attention.', 'वाहन को सेवा चाहिए तो अनुरोध बनाएँ।'), 'maintenance') : '');
  }

  function maintenanceForm() {
    var user = currentUser();
    var vendor = currentVendor() || state.vendors[0];
    var maintenance = ui.editing?.kind === 'maintenance' ? maintenanceById(ui.editing.id) : null;
    var isEdit = Boolean(maintenance);
    var types = vendor?.maintenanceTypes || ['Oil change', 'Tire', 'Brake', 'Repair'];
    var vendorField = isOwner() ? vendorSelect() : '<input type="hidden" name="vendorId" value="' + esc(user.vendorId) + '">';
    return '<form class="form-panel" id="maintenance-form"><div class="form-head"><div><span class="eyebrow">' + driverBilingual(isEdit ? 'EDIT SERVICE' : 'SERVICE REQUEST', isEdit ? 'सेवा संपादित करें' : 'सेवा अनुरोध') + '</span><h3>' + driverBilingual(isEdit ? 'Edit maintenance' : 'Report maintenance', isEdit ? 'रखरखाव संपादित करें' : 'रखरखाव दर्ज करें') + '</h3></div><button type="button" data-action="close-form">×</button></div>' +
      vendorField + '<div class="form-grid">' +
      (user.role === 'driver' ? '<input type="hidden" name="driverId" value="' + esc(user.driverId) + '">' : driverSelect('driverId', maintenance?.driverId || '')) +
      vehicleSelect('vehicleId', maintenance?.vehicleId || (user.role === 'driver' ? driverById(user.driverId)?.vehicleId : '')) +
      selectField(driverBilingual('Service type', 'सेवा प्रकार'), 'type', types, maintenance?.type) + field(driverBilingual('Estimate', 'अनुमानित लागत'), 'estimate', maintenance?.estimate ?? '', 'number', true, '0.01') +
      field(driverBilingual('Shop', 'वर्कशॉप'), 'shop', maintenance?.shop || '', 'text') + field(driverBilingual('Odometer', 'ओडोमीटर'), 'odometer', maintenance?.odometer ?? '', 'number', true) +
      field(driverBilingual('Date', 'तारीख'), 'date', maintenance?.date || today(), 'date', true) +
      '</div><label>' + driverBilingual('Description', 'विवरण') + '<textarea name="description" required placeholder="' + driverBilingual('Describe the issue, warning light, or requested service', 'समस्या, चेतावनी लाइट या आवश्यक सेवा का विवरण दें') + '">' + esc(maintenance?.description || '') + '</textarea></label>' + proofField(maintenance?.proofName) +
      '<div class="form-actions"><button type="button" class="btn btn-soft" data-action="close-form">' + driverBilingual('Cancel', 'रद्द करें') + '</button><button class="btn btn-primary">' + driverBilingual(isEdit ? 'Save changes' : 'Submit request', isEdit ? 'बदलाव सहेजें' : 'अनुरोध जमा करें') + '</button></div></form>';
  }

  function renderReports() {
    if (!canManage()) return forbidden();
    var vendors = isOwner() ? state.vendors : [currentVendor()];
    var rows = vendors.filter(Boolean).map(function (vendor) {
      var leases = state.leases.filter(function (x) { return x.vendorId === vendor.id; });
      var revenue = state.rentCharges.filter(function (x) { return x.vendorId === vendor.id; }).reduce(function (sum, x) { return sum + Number(x.amountPaid || 0); }, 0);
      var openRent = state.rentCharges.filter(function (x) { return x.vendorId === vendor.id; }).reduce(function (sum, x) { return sum + chargeBalance(x); }, 0);
      var costs = state.expenses.filter(function (x) { return x.vendorId === vendor.id && x.status === 'approved'; }).reduce(function (sum, x) { return sum + Number(x.amount || 0); }, 0);
      var maintenance = state.maintenance.filter(function (x) { return x.vendorId === vendor.id && ['approved', 'in_progress', 'completed'].indexOf(x.status) >= 0; }).reduce(function (sum, x) { return sum + Number(x.estimate || 0); }, 0);
      return { vendor: vendor, leases: leases.length, activeLeases: leases.filter(function (lease) { return lease.status === 'active'; }).length, revenue: revenue, openRent: openRent, costs: costs, maintenance: maintenance, net: revenue - costs - maintenance };
    });
    var total = rows.reduce(function (acc, row) {
      acc.revenue += row.revenue; acc.openRent += row.openRent; acc.costs += row.costs; acc.maintenance += row.maintenance; acc.net += row.net; return acc;
    }, { revenue: 0, openRent: 0, costs: 0, maintenance: 0, net: 0 });
    return pageHeader('Business reports', 'A clean operating view of revenue, claims, service cost, and net result.', '', '') +
      '<div class="kpi-grid reports">' +
        kpi('Rent received', money(total.revenue), 'monthly lease payments', 'blue', '§') +
        kpi('Open rent', money(total.openRent), 'due or partial balance', total.openRent ? 'amber' : 'green', '$') +
        kpi('Approved expenses', money(total.costs), 'driver claims', 'amber', '$') +
        kpi('Maintenance cost', money(total.maintenance), 'approved and completed', 'red', '⚙') +
        kpi('Net result', money(total.net), 'after operating costs', total.net >= 0 ? 'green' : 'red', '◉') +
      '</div><section class="panel"><div class="panel-head"><div><span class="eyebrow">VENDOR PERFORMANCE</span><h3>Lease operating summary</h3></div><button class="btn btn-soft" data-action="export-report">Export CSV</button></div>' +
      renderTable(['Company', 'Leases', 'Rent received', 'Open rent', 'Costs', 'Net'], rows.map(function (row) {
        return [
          '<b>' + esc(row.vendor.companyName) + '</b><small>' + esc(row.vendor.plan) + '</small>',
          number(row.activeLeases) + ' active / ' + number(row.leases), money(row.revenue), money(row.openRent), money(row.costs + row.maintenance),
          '<b class="' + (row.net >= 0 ? 'text-success' : 'text-danger') + '">' + money(row.net) + '</b>'
        ];
      }), 'No report data yet.') + '</section><section class="panel report-insights"><div class="panel-head"><div><span class="eyebrow">SMART CHECKS</span><h3>Operational insights</h3></div></div>' + renderInsights() + '</section>';
  }

  function renderInsights() {
    var insights = [];
    scope(state.expenses).filter(function (x) { return !x.proofName && x.status === 'pending'; }).forEach(function (x) {
      insights.push({ tone: 'amber', title: 'Missing expense proof', text: (driverById(x.driverId)?.name || 'Driver') + ' submitted ' + money(x.amount) + ' for ' + x.category + '.' });
    });
    scope(state.vehicles).filter(function (x) { return Number(x.mileage) > 400000; }).forEach(function (x) {
      insights.push({ tone: 'red', title: 'High-mileage vehicle', text: x.unitNumber + ' has ' + number(x.mileage) + ' miles. Review replacement planning.' });
    });
    scope(state.maintenance).filter(function (x) { return x.status === 'pending'; }).forEach(function (x) {
      insights.push({ tone: 'blue', title: 'Maintenance waiting', text: x.type + ' for ' + (vehicleById(x.vehicleId)?.unitNumber || 'vehicle') + ' needs a decision.' });
    });
    if (!insights.length) insights.push({ tone: 'green', title: 'Healthy operation', text: 'No immediate risks were detected in the current fleet records.' });
    return '<div class="insight-grid">' + insights.slice(0, 6).map(function (item) {
      return '<div class="insight ' + item.tone + '"><i></i><span><b>' + esc(item.title) + '</b><p>' + esc(item.text) + '</p></span></div>';
    }).join('') + '</div>';
  }

  function renderSettings() {
    var user = currentUser();
    var vendor = currentVendor();
    return pageHeader('Settings', 'Manage your profile and the controls available to your role.', '', '') +
      '<div class="settings-grid"><section class="panel"><div class="panel-head"><div><span class="eyebrow">YOUR ACCOUNT</span><h3>Profile</h3></div></div>' +
      '<form id="profile-form" class="settings-form">' + field('Name', 'name', user.name, 'text', true) + field('Email', 'email', user.email, 'email', true) + field('New password', 'password', '', 'password') +
      '<button class="btn btn-primary">Save profile</button></form></section>' +
      (canManage() && vendor ? '<section class="panel"><div class="panel-head"><div><span class="eyebrow">COMPANY RULES</span><h3>' + esc(vendor.companyName) + '</h3></div></div>' +
      '<form id="vendor-settings-form" class="settings-form">' + field('Company phone', 'phone', vendor.phone, 'tel') + field('Approval limit', 'approvalLimit', vendor.approvalLimit, 'number', true) +
      '<div class="readonly-note"><b>Optional attachments</b><span>Expense receipts and maintenance estimates may be added when useful, but are never required.</span></div>' +
      '<label>Expense categories<textarea name="expenseCategories">' + esc(vendor.expenseCategories.join(', ')) + '</textarea></label>' +
      '<label>Maintenance types<textarea name="maintenanceTypes">' + esc(vendor.maintenanceTypes.join(', ')) + '</textarea></label><button class="btn btn-primary">Save company rules</button></form></section>' : '') +
      (isOwner() ? '<section class="panel"><div class="panel-head"><div><span class="eyebrow">PLATFORM</span><h3>Application</h3></div></div><form id="app-settings-form" class="settings-form">' +
      field('App name', 'appName', state.settings.appName, 'text', true) + field('Support phone', 'supportPhone', state.settings.supportPhone, 'text') + field('Support email', 'supportEmail', state.settings.supportEmail, 'email') +
      '<button class="btn btn-primary">Save platform settings</button></form></section>' : '') +
      '<section class="panel"><div class="panel-head"><div><span class="eyebrow">DATA</span><h3>Storage & reset</h3></div></div><div class="data-tools"><div><b>Local + MongoDB saving</b><p>Every change is kept in the browser and synchronized to the live database. Optional attachments use a smaller size limit.</p></div><button class="btn btn-soft" data-action="db-status">Check database</button>' +
      '<button class="btn btn-danger-soft" data-action="reset-demo">Reset demo data</button><div id="db-result" class="db-result"></div></div></section></div>';
  }

  function field(label, name, value, type, required, step) {
    return '<label>' + esc(label) + '<input name="' + name + '" type="' + (type || 'text') + '" value="' + esc(value) + '"' + (required ? ' required' : '') + (step ? ' step="' + step + '"' : '') + '></label>';
  }

  function selectField(label, name, options, selected) {
    return '<label>' + esc(label) + '<select name="' + name + '">' + options.map(function (option) {
      var value = typeof option === 'string' ? option : option.value;
      var text = typeof option === 'string' ? option.replace(/_/g, ' ') : option.label;
      return '<option value="' + esc(value) + '"' + (String(selected || '') === String(value) ? ' selected' : '') + '>' + esc(text) + '</option>';
    }).join('') + '</select></label>';
  }

  function vendorSelect(selected) {
    return selectField('Vendor company', 'vendorId', state.vendors.map(function (vendor) { return { value: vendor.id, label: vendor.companyName }; }), selected);
  }

  function driverSelect(name, selected) {
    var records = scope(state.drivers);
    return selectField('Driver', name || 'driverId', [{ value: '', label: 'Select driver' }].concat(records.map(function (driver) { return { value: driver.id, label: driver.name }; })), selected);
  }

  function vehicleSelect(name, selected) {
    var records = scope(state.vehicles);
    return selectField(driverBilingual('Vehicle', 'वाहन'), name || 'vehicleId', [{ value: '', label: driverBilingual('Select vehicle', 'वाहन चुनें') }].concat(records.map(function (vehicle) { return { value: vehicle.id, label: vehicle.unitNumber + ' · ' + vehicle.make }; })), selected);
  }

  function tripSelect(selected) {
    var records = scope(state.trips).filter(function (trip) { return ['planned', 'in_progress', 'completed'].indexOf(trip.status) >= 0; });
    return selectField(driverBilingual('Related trip', 'संबंधित यात्रा'), 'tripId', [{ value: '', label: driverBilingual('No related trip', 'कोई संबंधित यात्रा नहीं') }].concat(records.map(function (trip) { return { value: trip.id, label: trip.startPoint + ' → ' + trip.endPoint }; })), selected);
  }

  function proofField(existingName) {
    var label = existingName ? 'Current: ' + existingName : driverBilingual('Optional receipt, estimate, or photo', 'वैकल्पिक रसीद, अनुमान या फोटो');
    return '<label class="upload-box"><input type="file" id="proof-input" accept="image/*,.pdf"><span>▧</span><b id="proof-label">' + esc(label) + '</b><small>' + driverBilingual('Optional · image or PDF up to 1 MB to keep storage light', 'वैकल्पिक · स्टोरेज हल्का रखने के लिए 1 MB तक') + '</small></label>';
  }

  function renderTable(headers, rows, empty) {
    if (!rows.length) return '<div class="empty-state compact"><span>⌕</span><b>' + esc(empty) + '</b><p>Try changing the filter or add a new record.</p></div>';
    return '<div class="table-wrap"><table><thead><tr>' + headers.map(function (header) { return '<th>' + esc(header) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (row) { return '<tr>' + row.map(function (cell) { return '<td>' + cell + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>';
  }

  function emptyState(title, description, moduleId) {
    return '<div class="empty-state"><span>◇</span><b>' + esc(title) + '</b><p>' + esc(description) + '</p>' + (moduleId ? '<button class="btn btn-soft" data-module="' + moduleId + '">Open ' + esc(moduleId) + '</button>' : '') + '</div>';
  }

  function forbidden() {
    return '<div class="empty-state"><span>◉</span><b>This area is not part of your role</b><p>Your account only shows the fleet records you need.</p><button class="btn btn-primary" data-module="dashboard">Return to dashboard</button></div>';
  }

  function bindLogin() {
    document.querySelectorAll('[data-demo]').forEach(function (button) {
      button.addEventListener('click', function () {
        var parts = button.dataset.demo.split('|');
        document.querySelector('[name=email]').value = parts[0];
        document.querySelector('[name=password]').value = parts[1];
      });
    });
    document.getElementById('login-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var data = Object.fromEntries(new FormData(event.currentTarget).entries());
      var login = String(data.email || '').trim().toLowerCase();
      var password = String(data.password || '').trim().toLowerCase();
      var loginAliases = {
        fleetadmin: 'owner@driverfleet.com',
        platformadmin: 'owner@driverfleet.com',
        northstaradmin: 'admin@northstar.com',
        bluerouteadmin: 'admin@blueroute.com',
        riverbendadmin: 'admin@blueroute.com',
        amandeep: 'driver@northstar.com',
        maria: 'driver@northstar.com',
        derek: 'driver@northstar.com'
      };
      var passwordAliases = {
        'owner@driverfleet.com': ['owner123', 'fleetadmin123'],
        'admin@northstar.com': ['admin123'],
        'admin@blueroute.com': ['admin123'],
        'driver@northstar.com': ['driver123']
      };
      var resolvedLogin = loginAliases[login] || login;
      var user = state.users.find(function (item) {
        var itemEmail = String(item.email || '').toLowerCase();
        var itemUsername = String(item.username || '').toLowerCase();
        var allowedPasswords = passwordAliases[itemEmail] || passwordAliases[itemUsername] || [String(item.password || '').toLowerCase()];
        return item.active && (itemEmail === resolvedLogin || itemUsername === resolvedLogin) && allowedPasswords.indexOf(password) >= 0;
      });
      if (!user) {
        document.getElementById('login-error').textContent = 'Email, username, or password is not correct.';
        return;
      }
      var vendor = user.vendorId ? vendorById(user.vendorId) : null;
      if (vendor && vendor.status !== 'active') {
        document.getElementById('login-error').textContent = 'This company account is currently suspended.';
        return;
      }
      sessionStorage.setItem('driver_fleet_user', user.id);
      ui.module = 'dashboard';
      ui.notice = '';
      render();
    });
  }

  function bindShell() {
    document.querySelectorAll('[data-module]').forEach(function (button) {
      button.addEventListener('click', function () {
        ui.module = button.dataset.module;
        ui.query = '';
        ui.status = 'all';
        ui.form = '';
        ui.detail = null;
        ui.editing = null;
        ui.menuOpen = false;
        window.scrollTo(0, 0);
        render();
      });
    });
    document.querySelectorAll('[data-action]').forEach(function (button) {
      button.addEventListener('click', function () { handleAction(button.dataset.action, button.dataset.id, button); });
    });
    var search = document.getElementById('module-search');
    if (search) search.addEventListener('input', function () {
      var value = search.value;
      ui.query = value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        render();
        var nextSearch = document.getElementById('module-search');
        if (nextSearch) {
          nextSearch.focus();
          nextSearch.setSelectionRange(value.length, value.length);
        }
      }, 120);
    });
    var status = document.getElementById('status-filter');
    if (status) status.addEventListener('change', function () { ui.status = status.value; render(); });
    bindForms();
    var proof = document.getElementById('proof-input');
    if (proof) proof.addEventListener('change', readProof);
    document.querySelectorAll('[data-upload-key]').forEach(function (input) {
      input.addEventListener('change', readMediaFile);
    });
    bindRevenueSource();
    bindDriverPhoneValidation();
  }

  function bindDriverPhoneValidation() {
    var form = document.getElementById('driver-form');
    if (!form) return;
    var input = form.querySelector('[name="phone"]');
    var output = document.getElementById('driver-phone-error');
    var excludeId = ui.editing?.kind === 'driver' ? ui.editing.id : '';
    function validate(showMessage) {
      if (!input.value.trim()) {
        input.setCustomValidity('');
        if (output) output.textContent = '';
        return false;
      }
      var message = driverPhoneValidationMessage(input.value, excludeId);
      input.setCustomValidity(message);
      if (output) output.textContent = showMessage ? message : '';
      return !message;
    }
    input.addEventListener('input', function () { validate(true); });
    input.addEventListener('blur', function () { validate(true); });
    validate(Boolean(input.value.trim()));
  }

  function bindRevenueSource() {
    var source = document.querySelector('[name="revenueSource"]');
    if (!source) return;
    function sync() {
      document.querySelectorAll('[data-revenue-fields]').forEach(function (section) {
        var active = section.dataset.revenueFields === source.value;
        section.hidden = !active;
        section.querySelectorAll('input, select, textarea').forEach(function (field) { field.disabled = !active; });
      });
    }
    source.addEventListener('change', sync);
    sync();
  }

  function bindForms() {
    var forms = {
      'vendor-form': saveVendor,
      'vehicle-form': saveVehicle,
      'driver-form': saveDriver,
      'lease-form': saveLease,
      'rent-form': saveRentPayment,
      'return-form': saveReturnVehicle,
      'mileage-form': saveMileageReading,
      'trip-form': saveTrip,
      'expense-form': saveExpense,
      'maintenance-form': saveMaintenance,
      'profile-form': saveProfile,
      'vendor-settings-form': saveVendorSettings,
      'app-settings-form': saveAppSettings
    };
    Object.keys(forms).forEach(function (id) {
      var form = document.getElementById(id);
      if (form) form.addEventListener('submit', forms[id]);
    });
  }

  function handleAction(action, recordId, button) {
    var formMap = {
      'toggle-vendor-form': 'vendor', 'toggle-vehicle-form': 'vehicle', 'toggle-driver-form': 'driver',
      'toggle-lease-form': 'lease', 'toggle-rent-form': 'rent', 'toggle-return-form': 'return', 'toggle-mileage-form': 'mileage',
      'toggle-trip-form': 'trip', 'toggle-expense-form': 'expense', 'toggle-maintenance-form': 'maintenance'
    };
    if (formMap[action]) {
      var requestedForm = formMap[action];
      if ((requestedForm === 'vendor' && !isOwner()) || (requestedForm !== 'vendor' && !canCreateOperationalRecord(requestedForm))) return;
      ui.form = ui.form === requestedForm ? '' : requestedForm;
      ui.editing = null;
      pendingProof = ''; pendingProofName = '';
      pendingMedia = {};
      render(); return;
    }
    if (action === 'close-form') { ui.form = ''; ui.editing = null; pendingMedia = {}; render(); return; }
    if (action === 'close-details') { ui.detail = null; render(); return; }
    if (action === 'close-media') { ui.media = null; render(); return; }
    if (action === 'dismiss-notice') { ui.notice = ''; render(); return; }
    if (action === 'menu') { ui.menuOpen = !ui.menuOpen; render(); return; }
    if (action === 'logout') { sessionStorage.removeItem('driver_fleet_user'); ui.form = ''; ui.detail = null; ui.media = null; ui.editing = null; ui.notice = ''; render(); return; }
    if (action.indexOf('edit-') === 0) {
      var editKind = action.replace('edit-', '');
      var editRecord = { vendor: vendorById(recordId), vehicle: vehicleById(recordId), driver: driverById(recordId), expense: expenseById(recordId), maintenance: maintenanceById(recordId) }[editKind];
      var allowed = editRecord && ((editKind === 'vendor' && isOwner()) || (editKind !== 'vendor' && canManageOperations() && editRecord.vendorId === currentUser().vendorId));
      if (allowed) {
        ui.form = editKind;
        ui.editing = { kind: editKind, id: recordId };
        ui.detail = null;
        pendingProof = ''; pendingProofName = '';
        pendingMedia = {};
        render();
        window.scrollTo(0, 0);
      }
      return;
    }
    if (action === 'toggle-vendor-status') {
      var vendor = vendorById(recordId);
      if (vendor && isOwner()) { vendor.status = vendor.status === 'active' ? 'suspended' : 'active'; saveState('Vendor status updated.'); render(); }
      return;
    }
    if (action === 'vehicle-status') {
      var vehicle = vehicleById(recordId);
      if (vehicle && canManageOperations() && vehicle.vendorId === currentUser().vendorId) {
        var statuses = ['available', 'leased', 'maintenance', 'inactive'];
        vehicle.status = statuses[(statuses.indexOf(vehicle.status) + 1) % statuses.length];
        saveState('Vehicle status updated.'); render();
      }
      return;
    }
    if (action === 'driver-details') { ui.detail = { kind: 'driver', id: recordId }; render(); return; }
    if (action === 'vehicle-details') { ui.detail = { kind: 'vehicle', id: recordId }; render(); return; }
    if (action === 'booking-details') { ui.detail = { kind: 'booking', id: recordId }; render(); return; }
    if (action === 'lease-details') { ui.detail = { kind: 'lease', id: recordId }; render(); return; }
    if (action === 'expense-details') { ui.detail = { kind: 'expense', id: recordId }; render(); return; }
    if (action === 'maintenance-details') { ui.detail = { kind: 'maintenance', id: recordId }; render(); return; }
    if (action === 'rent-for-lease') {
      var leaseForRent = leaseById(recordId);
      var leaseCharge = leaseForRent ? state.rentCharges.find(function (charge) { return charge.leaseId === leaseForRent.id && chargeBalance(charge) > 0; }) : null;
      ui.form = 'rent'; ui.editing = leaseCharge ? { kind: 'rent', id: leaseCharge.id } : null; pendingProof = ''; pendingProofName = ''; render(); return;
    }
    if (action === 'rent-charge') { ui.form = 'rent'; ui.editing = { kind: 'rent', id: recordId }; pendingProof = ''; pendingProofName = ''; render(); return; }
    if (action === 'return-for-lease') { ui.form = 'return'; ui.editing = { kind: 'return', id: recordId }; pendingProof = ''; pendingProofName = ''; render(); return; }
    if (action === 'record-media') { openRecordMedia(recordId, button.dataset.kind, button.dataset.field); return; }
    if (action === 'assign-driver') { if (canManageOperations()) assignDriver(recordId); return; }
    if (action === 'trip-start') {
      var trip = tripById(recordId); if (trip && canOperateTrip(trip)) { trip.status = 'in_progress'; saveState('Trip started.'); render(); } return;
    }
    if (action === 'trip-complete') { var completingTrip = tripById(recordId); if (completingTrip && canOperateTrip(completingTrip)) completeTrip(recordId); return; }
    if (action.indexOf('expense-') === 0) { if (canManageOperations()) updateApproval('expenses', recordId, action.replace('expense-', '')); return; }
    if (action.indexOf('maintenance-') === 0) {
      var next = action.replace('maintenance-', '');
      if (next === 'complete') next = 'completed';
      if (canManageOperations()) updateApproval('maintenance', recordId, next); return;
    }
    if (action === 'booking-accept') { updateBookingStatus(recordId, 'accepted'); return; }
    if (action === 'booking-assigned') { updateBookingStatus(recordId, 'assigned'); return; }
    if (action === 'booking-cancel') { updateBookingStatus(recordId, 'cancelled'); return; }
    if (action === 'proof') { openProof(recordId, button.dataset.kind); return; }
    if (action === 'export-report') { exportReport(); return; }
    if (action === 'db-status') { checkDatabase(); return; }
    if (action === 'reset-demo') {
      if (isOwner() && confirm('Reset all Driver Fleet data to the original demo records?')) {
        state = initialState(); saveState('Demo data restored.'); render();
      }
    }
  }

  function formData(event) {
    event.preventDefault();
    return Object.fromEntries(new FormData(event.currentTarget).entries());
  }

  function saveVendor(event) {
    var data = formData(event);
    if (!isOwner()) return;
    var vendor = ui.editing?.kind === 'vendor' ? vendorById(ui.editing.id) : null;
    if (vendor) {
      Object.assign(vendor, {
        companyName: data.companyName.trim(), owner: data.owner.trim(), phone: data.phone.trim(), email: data.email.trim(),
        plan: data.plan, color: data.color, accent: data.accent, approvalLimit: Number(data.approvalLimit || 0), requireProof: false,
        expenseCategories: data.expenseCategories.split(',').map(function (item) { return item.trim(); }).filter(Boolean),
        maintenanceTypes: data.maintenanceTypes.split(',').map(function (item) { return item.trim(); }).filter(Boolean)
      });
      var vendorAdmin = state.users.find(function (user) { return user.vendorId === vendor.id && user.role === 'vendor_admin'; });
      var vendorLogin = userLoginValue(data.email, data.companyName, uid('vendoradmin'), vendorAdmin?.id);
      if (vendorAdmin) { vendorAdmin.name = data.owner.trim(); vendorAdmin.email = data.email.trim(); vendorAdmin.username = vendorLogin; }
      ui.form = ''; ui.editing = null; saveState('Vendor details updated.'); render();
      return;
    }
    vendor = {
      id: uid('vendor'), companyName: data.companyName.trim(), owner: data.owner.trim(), phone: data.phone.trim(), email: data.email.trim(),
      plan: data.plan, status: 'active', color: data.color, accent: data.accent, approvalLimit: Number(data.approvalLimit || 0),
      requireProof: false, expenseCategories: data.expenseCategories.split(',').map(function (item) { return item.trim(); }).filter(Boolean),
      maintenanceTypes: data.maintenanceTypes.split(',').map(function (item) { return item.trim(); }).filter(Boolean)
    };
    var vendorLogin = userLoginValue(data.email, data.companyName, uid('vendoradmin'));
    state.vendors.unshift(vendor);
    state.users.push({ id: uid('user'), role: 'vendor_admin', name: data.owner, email: data.email.trim(), username: vendorLogin, password: 'admin123', vendorId: vendor.id, active: true });
    ui.form = ''; ui.editing = null; saveState('Vendor created. Admin login: ' + vendorLogin + ' / admin123'); render();
  }

  function saveVehicle(event) {
    var data = formData(event);
    if (!canManageOperations()) return;
    data.vendorId = currentUser().vendorId;
    var vehicle = ui.editing?.kind === 'vehicle' ? vehicleById(ui.editing.id) : null;
    var generatedUnit = vehicle?.unitNumber || data.plate?.trim() || (data.vin ? data.vin.trim().slice(-6).toUpperCase() : '') || (data.make.trim() + '-' + data.model.trim()).replace(/\s+/g, '-');
    var vehicleData = {
      vendorId: data.vendorId, unitNumber: generatedUnit, make: data.make.trim(), model: data.model.trim(),
      year: Number(data.year), vin: data.vin.trim(), plate: data.plate.trim(), mileage: Number(data.mileage || 0),
      boughtDate: data.boughtDate, totalCost: Number(data.totalCost || 0), loanBalance: Number(data.loanBalance || 0),
      monthlyPayment: Number(data.monthlyPayment || 0), status: data.status,
      vehiclePhotoName: pendingMedia.vehiclePhoto?.name || vehicle?.vehiclePhotoName || '', vehiclePhotoData: pendingMedia.vehiclePhoto?.data || vehicle?.vehiclePhotoData || '', vehiclePhotoType: pendingMedia.vehiclePhoto?.type || vehicle?.vehiclePhotoType || '',
      odometerPhotoName: pendingMedia.odometerPhoto?.name || vehicle?.odometerPhotoName || '', odometerPhotoData: pendingMedia.odometerPhoto?.data || vehicle?.odometerPhotoData || '', odometerPhotoType: pendingMedia.odometerPhoto?.type || vehicle?.odometerPhotoType || '',
      overviewVideoName: pendingMedia.overviewVideo?.name || vehicle?.overviewVideoName || '', overviewVideoData: pendingMedia.overviewVideo?.data || vehicle?.overviewVideoData || '', overviewVideoType: pendingMedia.overviewVideo?.type || vehicle?.overviewVideoType || ''
    };
    if (vehicle) {
      if (vehicle.vendorId !== data.vendorId && vehicle.driverId) {
        var assignedDriver = driverById(vehicle.driverId);
        if (assignedDriver) assignedDriver.vehicleId = '';
        vehicle.driverId = '';
      }
      Object.assign(vehicle, vehicleData);
      pendingMedia = {}; ui.form = ''; ui.editing = null; saveState('Vehicle details updated. Existing media was preserved.'); render();
      return;
    }
    state.vehicles.unshift(Object.assign({ id: uid('vehicle'), driverId: '' }, vehicleData));
    pendingMedia = {}; ui.form = ''; ui.editing = null; saveState('Vehicle and media added to the fleet.'); render();
  }

  function saveDriver(event) {
    var data = formData(event);
    if (!canManageOperations()) return;
    data.vendorId = currentUser().vendorId;
    var driver = ui.editing?.kind === 'driver' ? driverById(ui.editing.id) : null;
    var existingDriverUser = driver ? state.users.find(function (user) { return user.driverId === driver.id && user.role === 'driver'; }) : null;
    var driverLogin = userLoginValue(data.email, data.name, uid('driver'), existingDriverUser?.id);
    var phoneError = driverPhoneValidationMessage(data.phone, driver?.id || '');
    if (phoneError) {
      var phoneInput = event.currentTarget.querySelector('[name="phone"]');
      var phoneOutput = document.getElementById('driver-phone-error');
      if (phoneInput) { phoneInput.setCustomValidity(phoneError); phoneInput.focus(); }
      if (phoneOutput) phoneOutput.textContent = phoneError;
      return;
    }
    var driverId = driver?.id || uid('driver');
    var driverData = {
      vendorId: data.vendorId, name: data.name.trim(), phone: data.phone.trim(), email: data.email.trim(),
      license: data.license.trim(), licenseExpiry: data.licenseExpiry, address: data.address.trim(), emergencyContact: data.emergencyContact.trim(),
      insuranceProvider: data.insuranceProvider.trim(), insurancePolicy: data.insurancePolicy.trim(), insuranceExpiry: data.insuranceExpiry,
      driverPhotoName: pendingMedia.driverPhoto?.name || driver?.driverPhotoName || '', driverPhotoData: pendingMedia.driverPhoto?.data || driver?.driverPhotoData || '', driverPhotoType: pendingMedia.driverPhoto?.type || driver?.driverPhotoType || '',
      licensePhotoName: pendingMedia.licensePhoto?.name || driver?.licensePhotoName || '', licensePhotoData: pendingMedia.licensePhoto?.data || driver?.licensePhotoData || '', licensePhotoType: pendingMedia.licensePhoto?.type || driver?.licensePhotoType || '',
      insuranceDocName: pendingMedia.insuranceDoc?.name || driver?.insuranceDocName || '', insuranceDocData: pendingMedia.insuranceDoc?.data || driver?.insuranceDocData || '', insuranceDocType: pendingMedia.insuranceDoc?.type || driver?.insuranceDocType || '',
      agreementName: pendingMedia.agreement?.name || driver?.agreementName || '', agreementData: pendingMedia.agreement?.data || driver?.agreementData || '', agreementType: pendingMedia.agreement?.type || driver?.agreementType || ''
    };
    if (driver) {
      if (driver.vendorId !== data.vendorId && driver.vehicleId) {
        var assignedVehicle = vehicleById(driver.vehicleId);
        if (assignedVehicle) assignedVehicle.driverId = '';
        driver.vehicleId = '';
      }
      Object.assign(driver, driverData);
      var driverUser = existingDriverUser;
      if (driverUser) { driverUser.name = data.name.trim(); driverUser.email = data.email.trim(); driverUser.username = driverLogin; driverUser.vendorId = data.vendorId; }
      pendingMedia = {}; ui.form = ''; ui.editing = null; saveState('Driver details updated. Existing documents were preserved.'); render();
      return;
    }
    state.drivers.unshift(Object.assign({ id: driverId, vehicleId: '', status: 'active' }, driverData));
    state.users.push({ id: uid('user'), role: 'driver', name: data.name, email: data.email.trim(), username: driverLogin, password: 'driver123', vendorId: data.vendorId, driverId: driverId, active: true });
    pendingMedia = {}; ui.form = ''; ui.editing = null; saveState('Driver added. Login: ' + driverLogin + ' / driver123'); render();
  }

  function saveLease(event) {
    var data = formData(event);
    if (!canCreateOperationalRecord('lease')) return;
    data.vendorId = currentUser().vendorId;
    var driver = driverById(data.driverId);
    var vehicle = vehicleById(data.vehicleId);
    if (!driver || !vehicle) { alert('Select a driver and an available car.'); return; }
    if (activeLeaseForDriver(driver.id)) { alert(driver.name + ' already has an active lease. Return that car before starting another.'); return; }
    if (activeLeaseForVehicle(vehicle.id)) { alert(vehicle.unitNumber + ' is already leased.'); return; }
    var monthlyRent = Number(data.monthlyRent || 0);
    var startOdometer = Number(data.startOdometer || vehicle.mileage || 0);
    if (!monthlyRent || !startOdometer) { alert('Monthly rent and start mileage are required.'); return; }
    var leaseId = uid('lease');
    var lease = {
      id: leaseId, vendorId: data.vendorId, driverId: driver.id, vehicleId: vehicle.id,
      startDate: data.startDate, expectedReturnDate: data.expectedReturnDate || '', returnDate: '',
      monthlyRent: monthlyRent, deposit: Number(data.deposit || 0), rentDueDay: Number(data.rentDueDay || 1),
      startOdometer: startOdometer, returnOdometer: 0, status: 'active', notes: data.notes.trim(),
      leaseDocName: pendingProofName || '', leaseDoc: pendingProof || '', createdAt: new Date().toISOString()
    };
    state.leases.unshift(lease);
    monthKeysBetween(lease.startDate, today()).forEach(function (period) {
      state.rentCharges.push({
        id: uid('rent'), vendorId: lease.vendorId, leaseId: lease.id, driverId: lease.driverId, vehicleId: lease.vehicleId,
        period: period, dueDate: dueDateForPeriod(period, lease.rentDueDay), amountDue: lease.monthlyRent,
        amountPaid: 0, paidAt: '', paymentMethod: '', reference: '', notes: '', receiptName: '', receipt: '', status: 'due'
      });
    });
    state.mileageReadings.unshift({
      id: uid('mile'), vendorId: lease.vendorId, leaseId: lease.id, driverId: lease.driverId, vehicleId: lease.vehicleId,
      date: lease.startDate, odometer: startOdometer, type: 'start', notes: 'Lease start mileage.'
    });
    if (pendingProofName) {
      state.documents.unshift({ id: uid('doc'), vendorId: lease.vendorId, ownerType: 'lease', ownerId: lease.id, type: 'lease_agreement', name: 'Lease agreement', fileName: pendingProofName, fileData: pendingProof, expiryDate: '', uploadedAt: new Date().toISOString() });
    }
    driver.vehicleId = vehicle.id;
    vehicle.driverId = driver.id;
    vehicle.status = 'leased';
    vehicle.mileage = startOdometer;
    pendingProof = ''; pendingProofName = ''; ui.form = ''; ui.editing = null; ensureRentCharges(); saveState('Lease started. Driver, car, rent, and mileage updated together.'); render();
  }

  function saveRentPayment(event) {
    var data = formData(event);
    if (!canCreateOperationalRecord('rent')) return;
    var charge = rentChargeById(data.chargeId);
    if (!charge || charge.vendorId !== currentUser().vendorId) { alert('Select an open rent charge.'); return; }
    var amount = Number(data.amountPaid || 0);
    if (!amount) { alert('Enter the rent amount received.'); return; }
    charge.amountPaid = Math.min(Number(charge.amountDue || 0), Number(charge.amountPaid || 0) + amount);
    charge.paidAt = data.paidAt || today();
    charge.paymentMethod = data.paymentMethod || '';
    charge.reference = data.reference.trim();
    charge.notes = data.notes.trim();
    charge.receiptName = pendingProofName || charge.receiptName || '';
    charge.receipt = pendingProof || charge.receipt || '';
    charge.status = rentStatus(charge);
    if (pendingProofName) {
      state.documents.unshift({ id: uid('doc'), vendorId: charge.vendorId, ownerType: 'rent', ownerId: charge.id, type: 'rent_receipt', name: 'Rent receipt ' + charge.period, fileName: pendingProofName, fileData: pendingProof, expiryDate: '', uploadedAt: new Date().toISOString() });
    }
    pendingProof = ''; pendingProofName = ''; ui.form = ''; ui.editing = null; saveState('Rent payment posted to the driver, vehicle, and lease ledger.'); render();
  }

  function saveReturnVehicle(event) {
    var data = formData(event);
    if (!canCreateOperationalRecord('return')) return;
    var lease = leaseById(data.leaseId);
    if (!lease || lease.vendorId !== currentUser().vendorId || lease.status !== 'active') { alert('Select an active lease.'); return; }
    var returnOdometer = Number(data.returnOdometer || 0);
    if (!returnOdometer || returnOdometer < Number(lease.startOdometer || 0)) { alert('Return mileage must be greater than start mileage.'); return; }
    var driver = driverById(lease.driverId);
    var vehicle = vehicleById(lease.vehicleId);
    lease.returnDate = data.returnDate || today();
    lease.returnOdometer = returnOdometer;
    lease.status = 'closed';
    lease.notes = data.notes.trim() || lease.notes;
    if (pendingProofName) {
      state.documents.unshift({ id: uid('doc'), vendorId: lease.vendorId, ownerType: 'lease', ownerId: lease.id, type: 'return_condition', name: 'Return condition', fileName: pendingProofName, fileData: pendingProof, expiryDate: '', uploadedAt: new Date().toISOString() });
    }
    state.mileageReadings.unshift({
      id: uid('mile'), vendorId: lease.vendorId, leaseId: lease.id, driverId: lease.driverId, vehicleId: lease.vehicleId,
      date: lease.returnDate, odometer: returnOdometer, type: 'return', notes: 'Vehicle return mileage.'
    });
    if (vehicle) { vehicle.mileage = returnOdometer; vehicle.status = 'available'; vehicle.driverId = ''; }
    if (driver) driver.vehicleId = '';
    pendingProof = ''; pendingProofName = ''; ui.form = ''; ui.editing = null; saveState('Vehicle returned. Lease closed and car is available again.'); render();
  }

  function saveMileageReading(event) {
    var data = formData(event);
    if (!canCreateOperationalRecord('mileage')) return;
    var lease = leaseById(data.leaseId);
    var user = currentUser();
    if (!lease || lease.status !== 'active' || lease.vendorId !== user.vendorId || (user.role === 'driver' && lease.driverId !== user.driverId)) { alert('Select your active lease.'); return; }
    var odometer = Number(data.odometer || 0);
    if (!odometer || odometer < Number(lease.startOdometer || 0)) { alert('Enter a valid odometer reading.'); return; }
    var vehicle = vehicleById(lease.vehicleId);
    state.mileageReadings.unshift({
      id: uid('mile'), vendorId: lease.vendorId, leaseId: lease.id, driverId: lease.driverId, vehicleId: lease.vehicleId,
      date: data.date || today(), odometer: odometer, type: 'monthly', notes: data.notes.trim()
    });
    if (vehicle) vehicle.mileage = odometer;
    ui.form = ''; ui.editing = null; saveState('Mileage saved to the active lease and vehicle.'); render();
  }

  function saveTrip(event) {
    var data = formData(event);
    if (!canCreateOperationalRecord('trip')) return;
    data.vendorId = currentUser().vendorId;
    if (currentUser().role === 'driver') data.driverId = currentUser().driverId;
    var source = data.revenueSource === 'rent' ? 'rent' : 'trip';
    var driver = driverById(data.driverId);
    var vehicleId = data.vehicleId || driver?.vehicleId || '';
    if (source === 'trip' && (!data.startPoint?.trim() || !data.endPoint?.trim() || !Number(data.startOdometer))) {
      alert('Trip revenue requires start point, end point, and start odometer.');
      return;
    }
    if (source === 'rent' && !data.renterName?.trim()) {
      alert('Vehicle rent revenue requires the customer or renter name.');
      return;
    }
    state.trips.unshift({
      id: uid('trip'), vendorId: data.vendorId, driverId: data.driverId, vehicleId: vehicleId,
      revenueSource: source, renterName: source === 'rent' ? data.renterName.trim() : '',
      startPoint: source === 'rent' ? 'Vehicle rent' : data.startPoint.trim(), endPoint: source === 'rent' ? data.renterName.trim() : data.endPoint.trim(),
      startDate: data.startDate, endDate: source === 'rent' ? data.endDate : '',
      startOdometer: source === 'trip' ? Number(data.startOdometer || 0) : 0, endOdometer: 0, tripMoney: Number(data.tripMoney || 0),
      notes: data.notes.trim(), status: source === 'rent' ? 'completed' : data.status, createdAt: new Date().toISOString()
    });
    ui.form = ''; saveState(source === 'rent' ? 'Vehicle rent revenue recorded.' : 'Trip created.'); render();
  }

  function saveExpense(event) {
    var data = formData(event);
    if (!canCreateOperationalRecord('expense')) return;
    data.vendorId = currentUser().vendorId;
    if (currentUser().role === 'driver') data.driverId = currentUser().driverId;
    var expense = ui.editing?.kind === 'expense' ? expenseById(ui.editing.id) : null;
    if (expense && (!canManageOperations() || expense.vendorId !== currentUser().vendorId)) return;
    var expenseData = {
      vendorId: data.vendorId, driverId: data.driverId, vehicleId: data.vehicleId, tripId: data.tripId,
      category: data.category, costSource: data.costSource || 'general', amount: Number(data.amount || 0), date: data.date, place: '', location: '',
      paymentMethod: data.paymentMethod, reference: '', description: data.description.trim(),
      proofName: pendingProofName || expense?.proofName || '', proof: pendingProof || expense?.proof || ''
    };
    if (expense) {
      Object.assign(expense, expenseData);
      pendingProof = ''; pendingProofName = ''; ui.form = ''; ui.editing = null; saveState('Expense details updated.'); render();
      return;
    }
    state.expenses.unshift(Object.assign({ id: uid('expense'), status: 'pending', reviewedBy: '', createdAt: new Date().toISOString() }, expenseData));
    pendingProof = ''; pendingProofName = ''; ui.form = ''; ui.editing = null; saveState('Expense claim saved. Receipt attachment was optional.'); render();
  }

  function saveMaintenance(event) {
    var data = formData(event);
    if (!canCreateOperationalRecord('maintenance')) return;
    data.vendorId = currentUser().vendorId;
    if (currentUser().role === 'driver') data.driverId = currentUser().driverId;
    var maintenance = ui.editing?.kind === 'maintenance' ? maintenanceById(ui.editing.id) : null;
    if (maintenance && (!canManageOperations() || maintenance.vendorId !== currentUser().vendorId)) return;
    var maintenanceData = {
      vendorId: data.vendorId, driverId: data.driverId, vehicleId: data.vehicleId, type: data.type,
      estimate: Number(data.estimate || 0), shop: data.shop.trim(), odometer: Number(data.odometer || 0), date: data.date,
      description: data.description.trim(), proofName: pendingProofName || maintenance?.proofName || '', proof: pendingProof || maintenance?.proof || ''
    };
    if (maintenance) Object.assign(maintenance, maintenanceData);
    else state.maintenance.unshift(Object.assign({ id: uid('maint'), status: 'pending', reviewedBy: '', createdAt: new Date().toISOString() }, maintenanceData));
    var vehicle = vehicleById(data.vehicleId);
    if (vehicle && Number(data.odometer) > Number(vehicle.mileage)) vehicle.mileage = Number(data.odometer);
    pendingProof = ''; pendingProofName = ''; ui.form = ''; ui.editing = null; saveState(maintenance ? 'Maintenance details updated.' : 'Maintenance request saved. Attachment was optional.'); render();
  }

  function saveProfile(event) {
    var data = formData(event);
    var user = currentUser();
    user.name = data.name.trim(); user.email = data.email.trim();
    if (data.password) user.password = data.password;
    saveState('Profile saved.'); render();
  }

  function saveVendorSettings(event) {
    var data = formData(event);
    if (!canManageOperations()) return;
    var vendor = currentVendor();
    vendor.phone = data.phone.trim(); vendor.approvalLimit = Number(data.approvalLimit || 0); vendor.requireProof = false;
    vendor.expenseCategories = data.expenseCategories.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    vendor.maintenanceTypes = data.maintenanceTypes.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    saveState('Company rules saved.'); render();
  }

  function saveAppSettings(event) {
    var data = formData(event);
    if (!isOwner()) return;
    state.settings.appName = data.appName.trim(); state.settings.supportPhone = data.supportPhone.trim(); state.settings.supportEmail = data.supportEmail.trim();
    saveState('Platform settings saved.'); render();
  }

  function readProof(event) {
    var file = event.target.files[0];
    if (!file) return;
    if (file.size > 1 * 1024 * 1024) {
      alert('Please choose an optional receipt or proof file smaller than 1 MB to keep the database light.');
      event.target.value = ''; return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      pendingProof = reader.result;
      pendingProofName = file.name;
      var label = document.getElementById('proof-label');
      if (label) label.textContent = file.name;
    };
    reader.readAsDataURL(file);
  }

  function readMediaFile(event) {
    var input = event.target;
    var file = input.files[0];
    if (!file) return;
    var maxMb = Number(input.dataset.maxMb || 6);
    if (file.size > maxMb * 1024 * 1024) {
      alert('Please choose a file smaller than ' + maxMb + ' MB.');
      input.value = '';
      return;
    }
    var key = input.dataset.uploadKey;
    var reader = new FileReader();
    reader.onload = function () {
      pendingMedia[key] = { name: file.name, type: file.type || 'application/octet-stream', data: reader.result };
      var label = document.getElementById('upload-label-' + key);
      if (label) label.textContent = '✓ ' + file.name;
    };
    reader.readAsDataURL(file);
  }

  function openRecordMedia(recordId, collection, prefix) {
    var records = collection === 'drivers' ? state.drivers : state.vehicles;
    var record = records.find(function (item) { return item.id === recordId; });
    var user = currentUser();
    var ownDriverRecord = collection === 'drivers' && user?.role === 'driver' && user.driverId === recordId;
    if (!record || (!ownDriverRecord && (!canManageOperations() || record.vendorId !== user.vendorId))) return;
    var data = record[prefix + 'Data'];
    var name = record[prefix + 'Name'] || 'Attachment';
    var type = record[prefix + 'Type'] || '';
    if (!data) { alert('The original file is not available.'); return; }
    openMediaPreview(name, type, data);
  }

  function assignDriver(driverId) {
    var driver = driverById(driverId);
    if (!driver || !canManageOperations() || driver.vendorId !== currentUser().vendorId) return;
    var choices = state.vehicles.filter(function (vehicle) { return vehicle.vendorId === driver.vendorId; });
    var list = choices.map(function (vehicle, index) { return (index + 1) + '. ' + vehicle.unitNumber + ' · ' + vehicle.make; }).join('\n');
    var answer = prompt('Choose vehicle number, or 0 to unassign:\n' + list, '1');
    if (answer == null) return;
    var previous = vehicleById(driver.vehicleId);
    if (previous) previous.driverId = '';
    if (Number(answer) === 0) driver.vehicleId = '';
    else {
      var selected = choices[Number(answer) - 1];
      if (!selected) return;
      var otherDriver = driverById(selected.driverId);
      if (otherDriver) otherDriver.vehicleId = '';
      selected.driverId = driver.id;
      driver.vehicleId = selected.id;
    }
    saveState('Driver assignment updated.'); render();
  }

  function completeTrip(tripId) {
    var trip = tripById(tripId);
    if (!trip || !canOperateTrip(trip)) return;
    var vehicle = vehicleById(trip.vehicleId);
    var defaultEnd = vehicle ? vehicle.mileage : trip.startOdometer;
    var end = prompt('Enter final odometer reading:', String(defaultEnd || ''));
    if (end == null || !Number(end) || Number(end) < Number(trip.startOdometer)) return;
    trip.endOdometer = Number(end); trip.endDate = today(); trip.status = 'completed';
    if (vehicle && Number(end) > Number(vehicle.mileage)) vehicle.mileage = Number(end);
    saveState('Trip completed and mileage updated.'); render();
  }

  function updateApproval(collection, recordId, status) {
    var item = state[collection].find(function (record) { return record.id === recordId; });
    if (!item || !canManageOperations() || item.vendorId !== currentUser().vendorId) return;
    item.status = status;
    item.reviewedBy = currentUser().name;
    item.reviewedAt = new Date().toISOString();
    if (collection === 'maintenance') {
      var vehicle = vehicleById(item.vehicleId);
      if (vehicle && status === 'approved') vehicle.status = 'maintenance';
      if (vehicle && status === 'completed') vehicle.status = activeLeaseForVehicle(vehicle.id) ? 'leased' : 'available';
    }
    saveState((collection === 'expenses' ? 'Expense' : 'Maintenance') + ' marked ' + status.replace(/_/g, ' ') + '.');
    render();
  }

  function updateBookingStatus(recordId, status) {
    var booking = bookingById(recordId);
    if (!booking || !canManageOperations() || booking.vendorId !== currentUser().vendorId) return;
    booking.status = status;
    booking.updatedAt = new Date().toISOString();
    booking.reviewedBy = currentUser().name;
    if (status === 'accepted' && booking.paymentStatus !== 'paid') booking.status = 'pending_payment';
    saveState('Booking marked ' + booking.status.replace(/_/g, ' ') + '.');
    render();
  }

  function openProof(recordId, kind) {
    var item = kind === 'lease'
      ? leaseById(recordId)
      : kind === 'rent'
        ? rentChargeById(recordId)
        : state[kind === 'expense' ? 'expenses' : 'maintenance'].find(function (record) { return record.id === recordId; });
    var proofUser = currentUser();
    var canReadProof = item && proofUser && item.vendorId === proofUser.vendorId && (proofUser.role === 'vendor_admin' || (proofUser.role === 'driver' && item.driverId === proofUser.driverId));
    if (!item || !canReadProof) return;
    var fileData = kind === 'lease' ? item.leaseDoc : (kind === 'rent' ? item.receipt : item.proof);
    var fileName = kind === 'lease' ? item.leaseDocName : (kind === 'rent' ? item.receiptName : item.proofName);
    if (!item || !fileData) {
      alert(fileName ? 'This demo record contains the file name but not the original file.' : 'No file is attached.');
      return;
    }
    openMediaPreview(fileName, '', fileData);
  }

  function exportReport() {
    var lines = [['Vendor', 'Active leases', 'Rent received', 'Open rent', 'Approved expenses', 'Maintenance', 'Net']];
    (isOwner() ? state.vendors : [currentVendor()]).filter(Boolean).forEach(function (vendor) {
      var leases = state.leases.filter(function (x) { return x.vendorId === vendor.id && x.status === 'active'; });
      var revenue = state.rentCharges.filter(function (x) { return x.vendorId === vendor.id; }).reduce(function (s, x) { return s + Number(x.amountPaid || 0); }, 0);
      var openRent = state.rentCharges.filter(function (x) { return x.vendorId === vendor.id; }).reduce(function (s, x) { return s + chargeBalance(x); }, 0);
      var expenses = state.expenses.filter(function (x) { return x.vendorId === vendor.id && x.status === 'approved'; }).reduce(function (s, x) { return s + Number(x.amount || 0); }, 0);
      var maintenance = state.maintenance.filter(function (x) { return x.vendorId === vendor.id && ['approved', 'completed'].indexOf(x.status) >= 0; }).reduce(function (s, x) { return s + Number(x.estimate || 0); }, 0);
      lines.push([vendor.companyName, leases.length, revenue, openRent, expenses, maintenance, revenue - expenses - maintenance]);
    });
    var csv = lines.map(function (row) { return row.map(function (cell) { return '"' + String(cell).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    var link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = 'driver-fleet-report-' + today() + '.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function checkDatabase() {
    fetch('/api/db/status').then(function (response) { return response.json(); }).then(function (payload) {
      var node = document.getElementById('db-result');
      if (node) node.textContent = payload.ok ? 'Database connected · ' + payload.counts.map(function (x) { return x.collection + ': ' + x.count; }).join(' · ') : 'Database check failed.';
    }).catch(function () {
      var node = document.getElementById('db-result');
      if (node) node.textContent = 'Run the included server to connect SQLite.';
    });
  }

  if (!isPublicBookingRoute()) hydrateFromServer();
  render();
})();
