# Driver Fleet Requirements

## Roles

- Platform owner: vendor creation/configuration, platform health, plans, global revenue reports, and platform settings. The Platform Owner does not create or edit drivers, vehicles, trips, expenses, or maintenance claims and does not approve vendor operations.
- Vendor admin: only their own drivers, vehicles, trips, expenses, maintenance, approvals, and reports.
- Driver: only their own trips, expense claims, proofs, maintenance requests, and read-only personal record. Driver accounts cannot open vendor, fleet, driver-management, report, or settings screens.

## Navigation

- The side menu is hidden throughout the project.
- Each role receives a box-style workspace menu containing only its authorized modules.
- Mobile screens use a two-column box grid and a fixed role-aware bottom navigation bar.
- Driver screens display English and Hindi together, for example `Related trip / संबंधित यात्रा`; Platform Owner and Vendor Admin screens remain English-only.

## Modules

- Dashboard
- Vendors
- Vehicles
- Drivers
- Trips
- Expenses and approvals
- Maintenance and approvals
- Reports
- Settings

## Core Rules

- Every operational record carries a vendor ID.
- Every driver mobile number must contain 7 to 15 digits and be unique across all vendors.
- Phone formatting is normalized before comparison, so differently formatted copies of the same number are rejected.
- Vendor admins and drivers cannot view another vendor's data.
- Completing a trip records revenue and mileage.
- Revenue records are classified as Trip or Vehicle rent; rental revenue does not require route or odometer details.
- Expense claims are classified as Trip, Vehicle rent, or General fleet.
- Expense and maintenance claims above the vendor limit require approval.
- Receipt, challan, estimate, and supporting-photo attachments are optional for every vendor.
- Vendor creation and editing includes configurable expense categories and maintenance/service types used in vendor and driver forms.
- Expense entry does not require merchant or receipt-number fields; an optional small receipt can be attached.
- Vehicle mileage updates from completed trips and maintenance odometer readings.
- Deactivated vendors cannot create new operational records.
- Driver records include a profile photo, driving licence photo, and signed driver agreement.
- Only the driver's vendor admin and the driver can open that driver's complete record and documents.
- Drivers can open their own complete record and documents, but never another driver's record.
- A driver's own licence and document record is read-only; corrections must be made by the vendor admin.
- Vehicle onboarding includes a vehicle photo, odometer photo, and overview/walk-around video.
- Platform owners can edit vendors and their configuration; vendor admins can view and edit drivers, vehicles, expenses, and maintenance records in their company scope.
- Editing preserves existing assignments and uploaded media unless the company is changed or a replacement file is uploaded.

## Storage

- The browser keeps an offline local copy.
- The included Node server saves the complete state and searchable record collections to MongoDB Atlas.
- Attachments are stored in the saved app state for this first self-contained build.
- Optional expense and maintenance attachments are limited to 1 MB to keep routine database records lightweight.
- Photos support files up to 5 MB, agreements up to 8 MB, and overview videos up to 18 MB.
- Large driver and vehicle media is persisted through MongoDB GridFS even when it exceeds the browser's offline-cache limit.

## Refinement Target

- One portable folder, matching the ChemistCart Box delivery pattern.
- Responsive desktop, tablet, and phone interface.
- Short role-specific workflows with clear status, filters, and actions.
- Useful business signals without requiring a separate AI service.
