# Dr. Elias Dahdal Medical Center — Web UI/UX Design Brief

**Companion document:** `requirements-specification-dr-elias-backend.md`  
**Audience:** Product designers, UX/UI designers, design systems owners  
**Goal:** Define how the **web application** should look, behave, and be structured so clinical staff can work safely, quickly, and with clear authority boundaries.

---

## 1. What you are designing

A **multi-department clinic operations web app** (not a public marketing site). Primary use is **desktop/laptop** at reception, in treatment rooms, and in admin offices. Mobile may be secondary (view-only or alerts); optimize first for **large screens** and **dense clinical data**.

**Core qualities:**

- **Trustworthy and calm** — medical and financial context; avoid playful or noisy visuals.
- **Scannable** — staff need to find patients, sessions, and numbers under time pressure.
- **Permission-aware** — the same patient can look different depending on role; design for **progressive disclosure**, not one giant chart.
- **Audit-friendly** — actions that change money, stock, or plans should feel **deliberate** (confirmations, clear labels).

---

## 2. Language, script, and layout

- **Primary UI language:** Arabic for end users at the clinic is likely; **support RTL** as a first-class layout (mirrored navigation, form alignment, table column order where appropriate).
- **Numbers and currency:** Clarify with stakeholders whether amounts show **both USD and SYP** or SYP primary with USD reference; the system depends on a **daily exchange rate** entered by Super Admin — expose this rate in a **small, persistent “today’s rate”** area for staff who invoice (design pattern: chip or subheader on financial screens).
- **Names:** Patient search is **by name**; search fields should tolerate **Arabic and Latin** input if patients are registered either way.

**Designer deliverable:** At least one **RTL Figma frame set** (mirrored layout) plus notes for components that must not mirror (e.g. some icons, phone numbers).

---

## 3. Roles and what each role “sees” in the product

Design **role-based navigation** and **home dashboards** so users are not overwhelmed by irrelevant modules.

| Role | Mental model | Primary jobs-to-be-done |
|------|----------------|-------------------------|
| **Super Admin (Dr. Elias)** | “I own the day, money, and truth.” | Start/end day, set FX rate, financial & share reports, users, audit log, stock alerts, room assignments (laser). |
| **Reception / Secretary** | “I move patients and time.” | Search/register patients, assign doctors/specialists, laser area selection for time/billing, checkout/invoice handoff as per workflow. |
| **Laser staff** | “I record precise sessions.” | Session form, areas, technical params, room context. |
| **Dermatology** | “I document procedures and materials.” | Service selection, packages, inventory-linked items, clinical notes. |
| **Dental (sub-clinic doctors)** | “I execute the approved plan.” | See **master plan** immediately after approval; chart; payments/receivables view. |
| **Dental (Dr. Elias as strategist)** | “I set the only approved roadmap.” | First-visit flow, **master treatment plan** authoring and **approve** action (high prominence). |

**Privacy rule for UI:** **General patient card** (demographics + general medical history) is **shared**; **department detail** (laser shots, filler quantities, dental plan, dermatology procedures) lives in **department tabs or sections** that show a **locked or hidden state** for unauthorized roles — design **empty states** (“You don’t have access to Laser details”) instead of errors.

---

## 4. Global shell (every authenticated screen)

### 4.1 Top bar or sidebar

- **Clinic identity:** logo + product name (invoices also use logo — keep **master logo** specs aligned with marketing).
- **User menu:** name, role badge, **logout**.
- **Optional:** shift indicator for reception (“Session resets in X hours”) to support the **6-hour auto-logout** rule — a **gentle warning** before forced logout improves UX.

### 4.2 “Ignition” / day state (critical)

The business requires **manual daily activation** by Super Admin before operations and **personal closure** at end of day.

**Design two clear global states:**

1. **Day locked / not started** — full-width **banner** or **modal gate**: “The working day has not been started.” Primary CTA only for Super Admin: **Start day**; others see short explanation.
2. **Day active** — subtle **status pill**: “Day in progress · Rate USD/SYP = …” (Super Admin sees **Edit rate** where allowed).

**End of day:** Super Admin flow **Close & archive day** — use a **high-friction pattern** (confirm + type “CLOSE” or second step) to match the seriousness of archiving.

---

## 5. Information architecture (suggested sitemap)

Use as a starting map; adjust labels with Arabic copywriters.

```text
├── Dashboard (role-specific home)
├── Patients
│   ├── Search (default landing for many roles)
│   └── Patient record
│       ├── Overview (general card)
│       ├── Laser (if permitted)
│       ├── Dermatology (if permitted)
│       └── Dental (if permitted)
├── Schedule / assignments (Reception-heavy)
├── Laser
│   ├── Today’s sessions / queue
│   └── Session detail & new session
├── Dermatology
│   ├── Today’s visits
│   └── Procedure / chart
├── Dental
│   ├── Master plan (strategist)
│   └── My patients / plan execution (branch dentists)
├── Inventory (Dermatology-centric + daily consumption context)
├── Reports
│   ├── Daily inventory (end-of-day table)
│   ├── Department reports (Laser / Derm / Dental)
│   └── Business insights (profitability, top services) — Super Admin
└── Administration (Super Admin)
    ├── Users
    ├── Activity log
    ├── Doctor share % configuration
    └── Rooms & laser staff assignment
```

**Navigation pattern:** **Department switcher** only shows modules the user can access; do not gray out ten items — **hide** inaccessible areas to reduce mistakes.

---

## 6. Screen-by-screen design notes

### 6.1 Patient search

- **Large search field** (name-first), **recent patients** list, **filters** minimal (e.g. today’s visits).
- Results: **avatar/initials**, name, age or DOB, last visit, **department tags** (Laser/Derm/Dental) as chips.
- **Empty state:** “No patient found — Add new patient” with clear **primary button**.

### 6.2 Patient overview (general card)

**Sections:**

- Identity row: name, DOB, marital status, occupation.
- **General medical history** blocks: medical / surgical / allergy — use **compact lists** or **expandable accordions** if long.

**No** laser parameters, filler units, or dental chart here — those belong in department tabs.

### 6.3 Reception: assign staff to patient

- **Scheduling UI:** calendar or slot list per doctor/specialist; show **availability** clearly (free/busy).
- **Assignment confirmation:** who is responsible for **this visit** — avoid ambiguous multi-select without labels.

### 6.4 Laser: session record form

**Form fields (vertical rhythm, numeric emphasis):**

- Read-only: **Treatment #** (auto).
- **Operator** (select user).
- **Date** (auto, editable only if business allows corrections with audit).
- **Laser type** — **segmented control** or **radio cards**: Mix / Yag / Alex.
- **Technical block:** P.W, Pulse, shot count — **group in a fieldset** “Technical parameters”.
- **Notes** — textarea with hint: “Alerts for this case”.

**Room context:** If rooms matter for workflow, show **Room 1 / Room 2** as **tabs** or **toggle** with **assigned specialists** visible; Super Admin needs **reassign** affordance (inline edit or admin drawer).

### 6.5 Laser: area selection (“smart list”)

This is a **high-complexity** UI: hierarchical **female/male**, body regions, sub-areas, **duration badges** (e.g. “10 د”, “30 د”).

**Recommended patterns:**

- **Left:** category tree or accordion (Upper face, Neck, Torso, …).
- **Right:** selectable **chips** or **checkbox list** for sub-areas; each chip shows **duration**.
- **Footer summary:** total estimated time + count of areas (helps reception and billing).
- **Mobile:** consider **step wizard** (category → sub-areas → review).

**Visual hierarchy:** Category titles stronger than sub-items; **gender-specific** sections clearly labeled to avoid selection errors.

### 6.6 Dermatology: services & packages

- **Solarium:** distinguish **package** (5+1) vs **duration package** (6 / 12 min) with **cards** or **tabs**; **VIP** as **badge** on service row.
- **Massage:** scope “upper body only” — show **illustration or labeled body map** optional; at minimum **checklist** of included zones.
- **Cosmetic row:** Organic / Botox / Filler (face vs lips) / Brightening — use **clear typographic grouping**.

**Inventory-linked materials:** When user picks a consumable, show **stock level** inline (“12 left”) and **warning** if near safety threshold — aligns with Super Admin alerts.

### 6.7 Dental: master treatment plan (strategist)

- **Only Dr. Elias** sees **author** controls; others see **read-only approved plan**.
- **Approve** action: **primary, high visibility**; after approve, show **timestamp** and **“Synced to all dentists”** success state.
- **Branch dentist view:** when they open the same patient, **plan appears at top** of dental tab — **sticky summary** recommended.

**Dental chart:** tooth grid is standard expectation — design **states**: treated, planned, healthy; **legend** always visible.

**Financial sub-block:** total, paid, **outstanding** — use **progress** or **summary cards**; emphasize **debt** clearly but calmly.

### 6.8 Financial surfaces (role-gated)

- **Invoices:** professional layout preview — **logo**, line items, discounts, **final amount after FX**, footnotes.
- **Super Admin dashboards:** **net profit**, **doctor shares**, filters **whole clinic vs department** — use **cards + charts**; tables for drill-down.

**Do not** show net profit / share breakdowns to non–Super Admin roles in any sidebar widget.

### 6.9 Daily inventory report (end of day)

**Table-first** screen; columns match spec:

Op # | Patient | Area/treatment | Session/procedure type | Total cost | Discount | Provider | Final price (after FX) | Notes

- **Toolbar:** date picker (business day), **export** (PDF/Excel), **print**.
- **Dense table** styling: zebra rows, sticky header, **wrap notes** column.

### 6.10 Super Admin: activity log

- **Filterable table:** user, action, entity, timestamp; optional **diff** expansion row.
- **Readable verbs** in Arabic copy (e.g. “عدل سعر الصرف”, “ألغى مستخدم”).

### 6.11 Super Admin: user management

- List with status **Active / Frozen**; **edit** and **freeze** as explicit actions; **confirm** on freeze.

### 6.12 Export patient PDF

- **Button** on patient record: “Export dossier”.
- **Preview modal** optional; PDF layout: **cover** with logo, **general section**, then **only departments included in export** per permissions (design should assume **redacted** sections never appear).

---

## 7. Key interaction flows (for prototypes)

**Flow A — Start of day (Super Admin)**  
Login → **Start day** → **Enter USD/SYP** → confirmation → staff dashboards unlock.

**Flow B — Reception: new visit + laser billing prep**  
Search patient → open record → assign doctor/time → **Laser tab** → pick areas (see time sum) → hand off to laser staff or save.

**Flow C — Dermatology procedure with stock**  
Open patient → select service → attach **material** → UI shows **deduction** → complete visit.

**Flow D — Dental: plan approval**  
Strategist completes plan → **Approve** → branch dentist refreshes / realtime update → dentist sees **sticky plan** + tooth chart.

**Flow E — End of day**  
Super Admin → **Daily inventory report** review → **Close day** (confirm) → optional **WhatsApp feedback** sent (mostly backend; UI may show **“Feedback queue sent”** toast).

Use these for **Figma** flows or **prototype** hotspots.

---

## 8. Visual design direction (guidance, not prescription)

- **Color:** Prefer **cool neutrals** for chrome; **one primary** for primary actions; **semantic** colors: success (stock OK), warning (low stock), danger (archive/close day). Avoid red for normal medical labels.
- **Typography:** Highly legible Arabic typeface at **14–16px body** minimum; **tabular figures** for money tables if available.
- **Density:** **Comfortable** for forms; **compact** for logs and inventory — offer **density toggle** only if product wants power-user mode.
- **Iconography:** Medical metaphors subtle; prioritize **recognizable** actions (search, add, lock, export).

Deliver **light theme** first; **dark mode** optional unless requested.

---

## 9. Components to spec in a design system

- **App shell:** sidebar/topbar, breadcrumbs optional.
- **Role badge** + **module tag** chips.
- **Day state banner** + **FX rate chip**.
- **Patient header** (reusable across tabs).
- **Session fieldset** (laser technical group).
- **Hierarchical area picker** (laser).
- **Service catalog cards** (dermatology).
- **Stock inline indicator** + **low stock banner**.
- **Dental tooth chart** component.
- **Master plan** panel (approved vs draft states).
- **Invoice preview** frame.
- **Data table** with sticky header, optional column chooser.
- **Confirm dialogs** (close day, freeze user, destructive actions).
- **Empty, loading, no-access** states.

---

## 10. Accessibility and usability

- **Keyboard:** tables and forms navigable; **focus order** correct in RTL.
- **Contrast:** WCAG AA for text; don’t rely on color alone for status (pair with icon/text).
- **Forms:** labels always visible; errors **inline** near fields.
- **Time-based:** show **countdown or warning** before **6-hour** secretary logout.

---

## 11. Responsive behavior

- **≥ 1280px:** full layout as designed.
- **Tablet:** collapse sidebar to icon rail; laser area picker may become **wizard**.
- **Phone:** prioritize **search** and **today’s list**; defer heavy tables to horizontal scroll or simplified cards — confirm with product if mobile is in scope v1.

---

## 12. Designer checklist before handoff to development

- [ ] RTL frames and component states (default, hover, disabled, error).
- [ ] All **role variants** for **patient record** (what each role sees).
- [ ] **Ignition** on/off and **close day** flows with copy.
- [ ] Laser **area catalog** wireframe or prototype (large content — coordinate **copy deck** with clinic).
- [ ] **Invoice** and **daily report** print/PDF layouts.
- [ ] **Empty** and **no permission** states for every major screen.
- [ ] **Super Admin-only** screens clearly labeled in spec annotations.

---

## 13. Traceability

This brief is aligned with the Arabic PDF requirements (*requirements specification for dr elias.pdf*) and the English backend specification in this folder. Visual branding (exact colors, font files) should be confirmed with **Dr. Elias / VegaCore** stakeholders.

---

*End of document*
