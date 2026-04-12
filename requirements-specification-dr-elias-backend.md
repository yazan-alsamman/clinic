# Dr. Elias Dahdal Medical Center — Backend Requirements Specification

**Source document:** Requirements specification for Dr. Elias (VegaCore)  
**Audience:** Backend engineers (APIs, data model, business logic, integrations)  
**Version:** 1.0 (translated and expanded from Arabic specification)

---

## 1. Purpose and scope

This document describes functional and non-functional requirements for a **multi-department clinic management system** covering:

- **Super Admin** (Dr. Elias Dahdal) — exclusive financial oversight, daily system control, auditing.
- **Reception / Secretary** — patient intake, doctor/specialist assignment, scheduling.
- **Laser department** — session records, area-based billing and time estimation.
- **Dermatology** — services, packages, inventory-linked consumption, profit formulas.
- **Dental** — master treatment plan, orthodontics vs. general procedures, financial split rules.
- **Inventory & daily closing reports** — stock, deductions, end-of-day reconciliation.
- **Security, automation, and cross-department privacy** — RBAC, auto-logout, daily ignition, WhatsApp feedback.

Backend must enforce **authorization**, **auditability**, **financial consistency** (using a single daily exchange rate), and **department-scoped data visibility**.

---

## 2. Actors and roles

| Role | Description |
|------|-------------|
| **Super Admin** | Dr. Elias; exclusive rights: daily system activation/deactivation, exchange rate entry, net profit and doctor-share reports, full account CRUD, activity log access, low-stock alerts recipient, configurable doctor percentages. |
| **Reception / Secretary** | Patient registration/search, assignment of doctors/specialists to patients by availability and schedule; laser area selection for billing/time; no access to other departments’ clinical detail unless permitted. |
| **Laser staff / specialists** | Operate within laser module; session data visible only to laser-authorized users + Super Admin. |
| **Dermatology doctors** | Named in spec: Dr. Laura, Dr. Samy; dermatology clinical and service data visible only to them + Super Admin. |
| **Dental doctors** | Four sub-clinic doctors; see approved **master treatment plan** synced in real time after Dr. Elias approves it. |
| **Other specialists** | As assigned by reception; permissions scoped by department. |

**Backend implication:** Implement **role-based access control (RBAC)** plus **department/resource-level permissions** (e.g. `laser:read`, `dermatology:write`, `dental:read_plan`).

---

## 3. Global system control (“Ignition” system)

### 3.1 Daily manual activation

- The system **must not allow normal operational workflows** (per department or globally, per product decision) until **Super Admin manually activates** the system for the day.
- Specification states: **manual daily activation** by Super Admin to start operations.

### 3.2 Daily closure and archiving

- **Closing the system** or **archiving the day’s operations** requires an explicit action **by Dr. Elias (Super Admin) personally** at end of shift — not automatable for final archive without that authority.

### 3.3 Central financial input — exchange rate

- At the **start of each day**, Super Admin enters **USD/SYP** (or primary FX pair as configured) **manually**.
- **All billing, profit calculation, and doctor share distribution** for that operational day **must use this single rate** for consistency and to reduce manipulation.

**Backend requirements:**

- Store **daily exchange rate** record: `date`, `rate`, `set_by_user_id`, `set_at`.
- All monetary fields that day should reference the **active rate for that calendar/operational day** (define whether “day” is calendar or business shift).
- **Audit** every change to exchange rate and ignition state.

---

## 4. Super Admin — auditing and account control

### 4.1 Activity log (audit trail)

- Super Admin has access to an **activity log** tracking staff actions: secretaries, specialists, doctors.
- Log should support **who, what, when, entity type/id** (and optionally before/after values for sensitive fields).

### 4.2 Account management

- Super Admin has **full control** over user accounts: **create, edit, freeze/deactivate** (spec: “تجميد” — treat as disable/suspend).

---

## 5. Super Admin — exclusive financial visibility

- **Net profit** reports and **distributed doctor shares** are visible **only to Super Admin**.
- Reports must support **clinic-wide** and **per-department** aggregation.

**Backend:** Strong authorization on report endpoints; no leakage via list APIs or aggregates for other roles.

---

## 6. Reception and patient journey

### 6.1 Work distribution

- Reception is the **technical owner** of assigning **doctors and specialists** to patients based on **availability and schedule**.
- Backend needs: **resources** (doctors/specialists), **availability/slots** or shift model, **assignment** linking patient visit/appointment to provider(s).

### 6.2 Unified patient search

- Search is by **patient name** (spec: unified search by patient name).
- Implement appropriate indexing and normalized search (Arabic/latin names if applicable).

---

## 7. Patient general profile (“General patient card”)

Visible to **all doctors in the center** when searching:

- **Full name**
- **Date of birth**
- **Marital status**
- **Occupation**
- **General medical history:** past medical, surgical, allergy history

**Department-specific** clinical data **must not** be exposed through this general profile API to roles without department access (see Section 18).

---

## 8. Laser department module

### 8.1 Data privacy

- Laser **session details** are visible only to **laser-authorized staff** and **Super Admin**.

### 8.2 Session record (per patient / per session)

Each session record shall include:

| Field | Rule |
|-------|------|
| **Treatment number** | Auto-incrementing sequential identifier |
| **Responsible operator** | User reference (who performed the procedure) |
| **Date** | Auto-stamped |
| **Laser type** | Enum: e.g. **Mix, Yag, Alex** (extend via config if needed) |
| **Technical parameters** | **P.W**, **Pulse**, **shot count** (numeric/text per spec) |
| **Notes** | Free text for case-specific alerts |

### 8.3 Rooms and specialist assignment

- Specialists may be assigned to **Room 1**, **Room 2**, etc.
- **Super Admin** may **reassign** specialists between rooms **at any time**.

**Backend:** Model `Room`, `SpecialistRoomAssignment` (time-effective optional), audit reassignment events.

### 8.4 Area selection (smart list for billing and time)

Reception selects **treated areas** from a structured catalog. Each leaf area has an **estimated duration** (minutes) used for **scheduling and billing logic**.

**Catalog structure (summary):**

- **Female — upper face (10 min):** forehead, chin, nose, mustache area, etc.
- **Neck (5 min):** e.g. full neck, partial neck
- **Upper limbs (30 min):** both armpits, forearms, elbows, both hands/palms
- **Torso (10 min):** lines on chest, chest, abdomen, lower back (5 min), lower abdomen (5 min), around nipple, abdominal line, back line
- **Female — lower / sensitive (10 min):** bikini edges, buttocks, thigh triangle
- **Lower limbs:** legs (15 min up to 1 hour as per area), thighs, knee + foot comb (30 min)
- **Female full body:** estimated **2 hours**
- **Male — upper face:** ear, nose, forehead, eyebrow upper, chin upper/lower, chin contour (upper/lower special), neck (upper/lower special)
- **Male — torso and upper limbs:** elbows, forearms, both palms; chest (chest + front shoulder); armpit; back (front shoulders, back shoulders)
- **Male full body:** per male-specific rules/criteria

**Backend:**

- Store **hierarchical area catalog** (`category`, `gender_segment`, `name`, `duration_minutes`, `parent_id`, `active`).
- Link **session ↔ selected areas** (many-to-many) for reporting and invoicing.

### 8.5 Laser billing / accounting (contrast with dermatology)

- Laser accounting is driven by **number of areas** and **time** (see Section 14).
- Profit share may follow **salaries or fixed percentages** (configurable by Super Admin) — specify exact formula with product owner if not identical to dermatology.

---

## 9. Dermatology module

### 9.1 Data privacy

- Procedure details visible only to **concerned dermatologists** (Dr. Laura, Dr. Samy in spec) and **Super Admin**.

### 9.2 Services and procedures

**Solarium**

- **Package system:** e.g. package of **5 + 1 free session**
- **Duration system:** packages of **6 minutes** / **12 minutes**
- **Category type:** standard type / **VIP**

**Massage**

- **Upper body only:** hands, neck, shoulders

**Cosmetic procedures**

- Organic sessions
- **Botox**
- **Filler** (face / lips)
- Brightening / glow sessions (“نضارة”)

**Backend:** Service catalog with types, packages, durations, VIP flag, and pricing components as required.

### 9.3 Inventory integration (core of dermatology)

- When a **consumable** is selected in the patient chart (e.g. filler ampoule, injection, brightening material), the system **immediately deducts** quantity from **clinic warehouse** (“مستودع العيادة”).

**Low-stock alert**

- When any item quantity reaches a **safety threshold**, automatically notify **Super Admin**.

**Backend:**

- `InventoryItem` (SKU, name, unit, `safety_stock_level`, `current_quantity` or ledger-based).
- `StockMovement` (type: deduction, adjustment, purchase; `reference_type` = patient_procedure; `quantity`; `user_id`; `timestamp`).
- Transactional deduction on procedure save (avoid race conditions).
- Job or trigger to evaluate threshold and create **notification** records.

---

## 10. Financial logic — dermatology

For **each procedure**, for Super Admin only (display), the specification defines:

```text
Net profit = Total amount − (Material cost + Doctor share)
```

- **Doctor share** = percentage of relevant base (clarify with stakeholder: % of gross, net, or after materials) — example given: **40%** set **manually per doctor** by Super Admin.
- **Exchange rate:** all operations for the day use the **rate entered by Dr. Elias at day start**.

**Backend:**

- Store **per-doctor percentage** (dermatology context; may differ by department).
- Store **material cost** per procedure line from inventory cost or manual override (define rule).
- Persist **computed fields** or recalculate on read for audit consistency (prefer stored snapshot on finalized visits for accounting integrity).

---

## 11. Daily inventory and end-of-day report

At **end of shift**, the system produces a comprehensive **“Daily inventory”** report for the **whole clinic**, including materials used across **dermatology + laser + other specialties** as applicable.

**Report columns:**

1. Operation number  
2. Patient name  
3. Area (treatment) — relevant for laser; map appropriately for other departments  
4. Case / procedure (session type)  
5. Total cost  
6. Discount (if any)  
7. Responsible doctor or specialist  
8. **Final price after exchange** (FX applied)  
9. Notes  

**Backend:**

- Batch or query over **completed operations** for the **closed business day**.
- Export-friendly structure (PDF generation may be frontend or server; data API must expose all fields).
- Tie to **daily archive** when Super Admin closes the day (Section 3.2).

---

## 12. Dental department module

### 12.1 Central steering model

- Dr. Elias is the **chief strategist**: **only he** may perform the **initial examination** and set the comprehensive **master treatment plan**.

### 12.2 Real-time sync

- As soon as Dr. Elias **approves** the plan, it **must appear immediately** to the **four sub-clinic dentists** when they search the patient, so each knows **exactly** what they must execute.

**Backend:**

- `DentalMasterPlan` entity: `patient_id`, `created_by`, `approved_by`, `approved_at`, status (draft/approved), structured plan items.
- **Websockets / SSE / push** or polling — spec demands “immediate”; prefer push or realtime channel.
- Versioning if plans can be amended (define business rule).

### 12.3 Dental chart-specific data

- **Dental medical history:** chronic conditions relevant to dentistry  
- **Dental chart:** treated teeth, current procedures, **future plan** (“what we will actually do”)  
- **Financial receivables:** total amount, payments made, **outstanding balances / debts**

---

## 13. Financial logic — dental

Two tracks by procedure type.

### 13.1 General procedures

Examples: fillings, cleaning, crowns, etc.

```text
Net profit ($) = Amount collected − Doctor share ($)
```

- **No material cost deduction** in this path — **material cost is absorbed by the center**.  
- Super Admin sets **doctor percentage** (same pattern as other modules).

### 13.2 Orthodontics

Treated **like dermatology**:

```text
Net profit ($) = Total amount − (Material cost + Doctor share)
```

**Backend:** Procedure-type flag `orthodontics` vs `general` drives which formula and whether inventory deduction applies.

---

## 14. System logic summary — laser vs dermatology

| Aspect | Laser | Dermatology |
|--------|--------|----------------|
| **Accounting basis** | Areas + time | Amount − materials − doctor % |
| **Warehouse** | Limited consumption (e.g. gel, wipes — per operational reality) | Strict consumption (medical materials, injections, creams) |
| **Share distribution** | Often salaries or fixed percentages | Variable percentages set by Super Admin |

Use this to separate **billing engines** or **strategy pattern** per department.

---

## 15. Reports and outputs

- **Export patient file:** Full dossier (general + department-specific sections user is allowed to see) as **PDF** in one action.
- **Professional invoices** with **clinic logo** and full financial line items.
- **Business intelligence:**
  - **Separate report per department** (laser, dermatology, dental)
  - Statistics: **most profitable departments**, **most requested services**

**Backend:** Report APIs with filters (date range, department), aggregation jobs, PDF service optional.

---

## 16. Security and automation

### 16.1 Auto-logout — reception

- **Secretary session** automatically logs out after **6 hours** to force the next shift to log in with **their own account** — prevents shared/forgotten sessions.

**Backend:** JWT expiry + refresh policy, or server-side session TTL; warn user before timeout if UX requires.

### 16.2 Central ignition (reinforcement)

- No department should process **operational transactions** until Super Admin has **activated** the day; system **closes** at end of day per Super Admin (align with Section 3).

### 16.3 WhatsApp — customer feedback

- **End of day:** automatically send **WhatsApp messages** to **all patients who visited** the center to request **feedback** and **session rating**.

**Backend:** Integration with WhatsApp Business API or approved provider; queue outbound messages; store `patient_id`, `phone`, `visit_id`, `sent_at`, `delivery_status`; comply with opt-in and privacy law.

---

## 17. Search and access control (cross-cutting privacy)

- **Basic info** (name, general medical history) — **all authorized clinical staff**.
- **Specialty-sensitive data** (laser shot details, filler quantities, dental master plan details, etc.) — **only staff with explicit access** to that **department/module**.

**Backend:**

- **Never** embed restricted fields in generic patient DTOs.
- Use **separate endpoints** or **field-level scoping** with policy checks.
- Log access to highly sensitive records if required for compliance.

---

## 18. Suggested entity index (non-exhaustive)

Use as a checklist for schema design:

- `User`, `Role`, `Permission`, `UserDepartmentAccess`
- `DailySystemState` (ignition open/closed, `business_date`, `closed_by`)
- `ExchangeRateDaily`
- `Patient`, `PatientGeneralHistory`
- `Assignment` / `Visit` / `Appointment`
- `LaserSession`, `LaserSessionArea`, `LaserType`, `Room`, `RoomAssignment`
- `DermatologyProcedure`, `ServiceCatalog`, `PackageRule`
- `InventoryItem`, `StockMovement`, `LowStockAlert`
- `DentalMasterPlan`, `DentalChart`, `DentalProcedure`, `DentalInvoiceLine`
- `Invoice`, `Payment`, `Discount`
- `AuditLog`
- `Notification`
- `WhatsAppMessageJob`

---

## 19. Open points for product / stakeholder confirmation

1. Exact definition of **operational day** (calendar midnight vs shift end).  
2. Laser **net profit / doctor share** formula vs fixed salary export to payroll.  
3. Whether **ignition** blocks **all roles** or only financial transactions.  
4. **Doctor percentage** base (gross, net of tax, net of materials) for each module.  
5. **Multi-currency** display rules aside from USD/SYP.  
6. **WhatsApp** provider and **patient consent** storage.  
7. Full authoritative **laser area catalog** as structured data (import from spreadsheet).  
8. Complete list of **laser consumables** for stock if required beyond “limited consumption.”

---

## 20. Traceability

This Markdown specification is derived from the Arabic PDF *requirements specification for dr elias.pdf* (VegaCore). Where the PDF uses examples (e.g. 40% doctor share), treat them as **illustrative** unless the contract states otherwise.

---

*End of document*
