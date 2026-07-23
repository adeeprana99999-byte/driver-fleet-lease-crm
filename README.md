# Driver Fleet Box

## Lease CRM Upgrade

This copy has been remodeled into a monthly vehicle leasing CRM flow. The main work now starts from **Leases & rent**, where one lease record connects the driver, vehicle, start mileage, lease document, rent charges, payment receipts, maintenance, and return mileage. This avoids entering the same driver/vehicle/rent details in multiple places.

Use these quick logins:

- Fleet admin: `fleetadmin` / `FleetAdmin123`
- NorthStar admin: `northstaradmin` / `Admin123`
- NorthStar driver: `driver@northstar.com` / `Driver123`

To run this upgraded copy while the old app is still using port 4320:

```powershell
cd C:\Users\Owner\Documents\Codex\Driver_Fleet_App_Lease_CRM
$env:PORT=4330
npm.cmd start
```

Open `http://localhost:4330`.

MongoDB is optional for local testing. If `.env` does not contain `MONGODB_URI`, the app saves changes to `data/local-state.json` automatically.

## Public Booking Portal

Customers can book a car from the public page:

```text
http://localhost:4330/booking
```

The public booking page does not show the admin menu, driver screens, reports, settings, leases, or maintenance. It only creates a rent-a-car booking request and starts a 100 INR booking advance flow.

Admin users can manage paid and pending booking requests from **Bookings** inside the logged-in app.

For local testing, keep the app in test payment mode:

```powershell
cd C:\Users\Owner\Documents\Codex\Driver_Fleet_App_Lease_CRM
npm.cmd run payments:test
```

In test mode, the customer sees an in-app test payment popup. No real money is charged, but the booking is still saved and marked paid/confirmed after the test payment is confirmed.

The booking portal checks inventory by pickup and return date. A selected car cannot be booked again for overlapping dates while it has a paid booking, accepted booking, assigned booking, active lease, or a recent pending payment hold. Pending checkout holds last 30 minutes by default and can be changed with `BOOKING_HOLD_MINUTES`.

To switch later to Razorpay UPI/card payments:

```powershell
cd C:\Users\Owner\Documents\Codex\Driver_Fleet_App_Lease_CRM
npm.cmd run payments:configure
```

Add your Razorpay `KEY_ID`, `KEY_SECRET`, and optional webhook secret when prompted. The script sets `PAYMENT_MODE=razorpay`. The booking page then supports Razorpay Checkout payment methods including UPI, cards, netbanking, and wallets. The server creates the Razorpay order and verifies the payment signature before confirming the booking.

To connect this upgraded app to the live MongoDB database:

```powershell
cd C:\Users\Owner\Documents\Codex\Driver_Fleet_App_Lease_CRM
.\scripts\configure-live-db.ps1
npm.cmd run db:migrate-leasing
npm.cmd start
```

Paste the MongoDB URI only when the script asks for it. The migration keeps existing users, companies, vehicles, drivers, trips, expenses, maintenance, and notifications; it adds lease, rent, mileage, and document structures around the current driver-to-vehicle assignments. A backup is saved under `data\backups` before the live database is updated.

Driver Fleet Box is a refined, self-contained multi-vendor fleet operations app rebuilt from the latest FleetCommand MultiVendor source using the same portable delivery style as ChemistCart Box.

## Included

- Platform owner, vendor admin, and driver logins
- Platform Owner control center for vendors, global revenue reports, and platform settings
- Vendor branding, plans, approval limits, configurable expense categories, and maintenance types
- Vehicle and driver records with assignments
- Project-wide unique mobile-number validation for every driver
- Driver photo, driving licence image, and signed driver agreement uploads
- Full driver detail screen for vendor admins
- Driver self-view for their own record and documents
- Read-only driver licence access in the driver portal
- Restricted driver workspace showing only the driver's own trips, expenses, and maintenance
- English/Hindi bilingual labels throughout the Driver portal, forms, records, and mobile navigation
- Operational creation and approval restricted to Vendor Admin and Driver workflows; Platform Owners cannot add drivers, vehicles, trips, claims, or maintenance
- Vehicle photo, odometer image, and vehicle overview video uploads
- Full view and edit flows for vendors, vehicles, drivers, expenses, and maintenance, with existing files preserved
- Driver trip logs and revenue tracking
- Revenue source selection for trip income or vehicle-rent income
- Expense allocation to trips, vehicle rentals, or general fleet operations
- Expense claims with optional receipt/challan proof and an approval workflow
- Simplified expense form with no merchant or receipt-number fields and optional 1 MB attachments
- Maintenance requests with estimates, odometer, optional proof, and approval workflow
- Vendor-isolated dashboards and reports
- Sidebar-free box navigation across the entire project
- Search, filters, responsive two-column mobile menu, bottom navigation, and offline browser copy
- MongoDB Atlas database with searchable record collections
- GridFS-backed application state for large driver documents and vehicle videos

## Demo Login

- Platform owner: `owner@driverfleet.com` / `owner123`
- NorthStar admin: `admin@northstar.com` / `admin123`
- NorthStar driver: `driver@northstar.com` / `driver123`
- BlueRoute admin: `admin@blueroute.com` / `admin123`

## Run

```powershell
cd C:\Users\Owner\Documents\Codex\Driver_Fleet_App_Lease_CRM
npm.cmd start
```

Open `http://localhost:4330`.

## Database

Create a local `.env` file from `.env.example` and set `MONGODB_URI` and `MONGODB_DB`. The `.env` file is excluded from GitHub.

The app uses MongoDB Atlas database `fleetwebco`. Large application state and attachments are stored through GridFS so uploaded vehicle videos are not limited to a single 16 MB MongoDB document.

Check persistence while the app is running at `http://localhost:4330/api/db/status`.

For a public deployment, set both `APP_ACCESS_USER` and `APP_ACCESS_PASSWORD`. This adds a private browser sign-in gate in front of the application while leaving `/api/health` available to the hosting health check.

To import the previous local SQLite data once:

```powershell
npm.cmd run migrate:sqlite
```

## Production Note

This build is ready for local/company testing with MongoDB Atlas. Before a public multi-company rollout, replace the demo browser-side login with server-side authentication and authorization.
