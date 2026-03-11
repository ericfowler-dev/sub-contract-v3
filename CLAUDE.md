# PSI Field Service Sub-Contract Dashboard

## Project Overview

Build a full-stack interactive dashboard for analyzing PSI's field service sub-contract expenditures. The raw data comes from accounting's "Inventory WIP Reconciliation Report" Excel exports and requires significant cleaning, normalization, and enrichment before visualization. The dashboard should allow periodic file uploads to refresh or append data, and provide drill-down analytics by jobsite, vendor, transaction type, and time period.

**Repository:** `https://github.com/ericfowler-dev/sub-contract-v3`
**Deployment:** Render (Node.js web service)

---

## Architecture

```
sub-contract-v3/
├── server/
│   ├── index.js                 # Express server entry point
│   ├── routes/
│   │   ├── upload.js            # File upload + ingest endpoint
│   │   ├── api.js               # REST API for dashboard queries
│   │   └── health.js            # Health check for Render
│   ├── services/
│   │   ├── ingestion.js         # Excel parsing + cleaning pipeline
│   │   ├── normalization.js     # Job/vendor/type normalization rules
│   │   └── analytics.js         # Aggregation + query logic
│   ├── models/
│   │   └── schema.js            # Data model definitions
│   └── data/
│       └── db.json              # Persistent JSON store (lowdb or similar)
├── client/
│   ├── index.html               # SPA entry point
│   ├── src/
│   │   ├── app.js               # Main app orchestrator
│   │   ├── components/
│   │   │   ├── Dashboard.js     # Main dashboard layout
│   │   │   ├── SpendOverTime.js # Monthly/yearly trend charts
│   │   │   ├── JobsiteBreakdown.js  # Per-site drill-down
│   │   │   ├── VendorAnalysis.js    # Vendor spend comparison
│   │   │   ├── TypeBreakdown.js     # Transaction type analysis
│   │   │   ├── DataTable.js         # Sortable/filterable raw data view
│   │   │   ├── UploadPanel.js       # File upload interface
│   │   │   └── Filters.js          # Global filter controls
│   │   ├── charts/
│   │   │   └── chartConfig.js   # Chart.js or Recharts configuration
│   │   └── utils/
│   │       └── formatters.js    # Currency, date, label formatters
│   └── styles/
│       └── main.css             # Dashboard styling
├── package.json
├── render.yaml                  # Render deployment config
├── .gitignore
└── CLAUDE.md                    # This file
```

**Tech Stack:**
- **Backend:** Node.js + Express
- **Frontend:** Vanilla JS with Chart.js (or React if preferred — keep it lightweight)
- **Data Store:** File-based JSON (lowdb or flat JSON) — no database server needed
- **File Parsing:** `xlsx` npm package (SheetJS)
- **Deployment:** Render free-tier web service

---

## Raw Data Specification

### Source File

The accounting team provides a `.xlsx` file periodically (typically monthly). The file contains multiple sheets; the **only sheet of interest** is `"SubContract Detail"`.

### Sheet Structure

- **Row 1:** Report title (`"Inventory WIP Reconciliation Report"`) — skip
- **Row 2:** Empty — skip
- **Row 3:** Summary totals — skip
- **Row 4:** Column headers (this is the header row, 0-indexed row 3)
- **Row 5+:** Data rows

### Columns (A through R)

| Col | Header        | Description                                                                 |
|-----|---------------|-----------------------------------------------------------------------------|
| A   | `Account`     | Always `70-10-10530 WIP  Subcontracts` for relevant rows                   |
| B   | `Date`        | Transaction date (datetime)                                                 |
| C   | `Type`        | Transaction type code (see Type Taxonomy below)                             |
| D   | `Posted`      | Always `Y` — can ignore                                                    |
| E   | `Job`         | Job number in format `NNNNNN-SN` (e.g. `200834-S3`) — **case inconsistent** |
| F   | `Debit`       | Debit amount (positive spend)                                               |
| G   | `Credit`      | Credit amount (offsets, customer pay, adjustments)                           |
| H   | `Net`         | `Debit - Credit` (pre-calculated, can be negative)                          |
| I   | `Ref`         | Reference string — contains supplier ID and PO/invoice numbers              |
| J   | `Date_2`      | Secondary date (often same as Date — can ignore or use for reconciliation)  |
| K   | `Part`        | Part number or description — mixed content, sometimes contains job numbers  |
| L   | `Description` | Line item description — sometimes blank for non-PUR-SUB types              |
| M   | `Month`       | Numeric month (1-12)                                                        |
| N   | `YEAR`        | Four-digit year                                                             |
| O   | `Vendor`      | Vendor ID number                                                            |
| P   | `Vendor Name` | Vendor display name — sometimes `0` or `NaN` for non-supplier transactions  |
| Q   | `Pivot`       | Pivot category — `Supplier` or blank                                        |
| R   | `Service`     | **CRITICAL FILTER** — only rows where this column equals `"Service"` matter |

### Row Filter

**Only ingest rows where Column R (`Service`) equals the string `"Service"`.**  All other rows belong to production/non-service operations and must be excluded.

---

## Data Cleaning & Normalization Pipeline

This is the most critical part of the project. The raw data is messy and Claude should use sub-agents to analyze the data patterns and determine optimal cleaning strategies.

### Step 1: Filter

- Read sheet `"SubContract Detail"` with header row at index 3 (0-based)
- Keep only rows where `Service == "Service"`
- Expected volume: ~300-400 rows per full file (grows over time)

### Step 2: Normalize Job Numbers → Jobsite Identifiers

Job numbers follow the pattern `NNNNNN-SN` where:
- `NNNNNN` = **Base Job Number** (the project/site identifier)
- `S` = Literal letter S (for "Service")
- `N` = Service order sequence number (1, 2, 3, etc.)

**Critical:** Job numbers have **inconsistent casing** (`200834-S3` vs `200834-s3` vs `200748-s6`). All must be uppercased before processing.

Derived fields to create:
- `base_job`: The 6-digit base number (e.g. `200834`)
- `service_order`: The full normalized job (e.g. `200834-S3`)
- `jobsite_name`: Human-readable site name — **this requires a mapping table** (see below)

### Step 3: Jobsite Mapping Table

The system needs a configurable mapping from base job numbers to human-readable site names. This should be stored server-side and editable via the dashboard. Initial mapping to seed (Claude should extract these from the data or prompt for them):

```json
{
  "200748": "Unknown — Legacy",
  "200834": "Unknown — 200834",
  "200841": "Unknown — 200841",
  "200847": "Unknown — 200847",
  "200874": "Unknown — 200874",
  "200875": "Unknown — 200875",
  "200895": "Unknown — 200895",
  "200899": "Unknown — 200899",
  "200920": "Unknown — 200920",
  "200954": "Unknown — 200954",
  "200984": "Unknown — 200984",
  "201002": "Unknown — 201002",
  "201033": "Unknown — 201033",
  "201036": "Unknown — 201036",
  "201049": "Unknown — 201049",
  "201064": "Unknown — 201064",
  "201080": "Unknown — 201080",
  "201090": "Unknown — 201090",
  "201106": "Unknown — 201106",
  "201115": "Unknown — 201115",
  "201119": "Unknown — 201119",
  "201122": "Unknown — 201122",
  "201131": "Unknown — 201131",
  "201132": "Unknown — 201132",
  "201137": "Unknown — 201137",
  "201141": "Unknown — 201141",
  "201146": "Unknown — 201146",
  "201199": "Unknown — 201199",
  "201300": "Unknown — 201300",
  "201312": "Unknown — 201312",
  "201328": "Unknown — 201328",
  "201352": "Unknown — 201352"
}
```

> **Note to Claude:** The user will fill in real site names later. Build an editable mapping UI in the dashboard settings panel so names can be updated without code changes.

### Step 4: Transaction Type Taxonomy

Raw `Type` values and what they represent:

| Type Code  | Category Label         | What It Is                                                                 | Net Direction |
|------------|------------------------|----------------------------------------------------------------------------|---------------|
| `PUR-SUB`  | **Sub-Contract Spend** | Actual vendor invoices — labor, parts, rentals from field subcontractors   | Positive (debit) |
| `MFG-CUS`  | **Customer Pay Credit** | Customer-billable amounts credited back — offsets against spend            | Negative (credit) |
| `MFG-VAR`  | **Accounting Variance** | Year-end and periodic accounting adjustments, WIP purges to COGS          | Negative (credit) |
| `STK-MTL`  | **Stock Material**      | Internal stock/material transfers charged to the service job              | Positive (debit) |
| `ADJ-PUR`  | **Purchase Adjustment** | Invoice corrections or vendor credit memos                                | Negative (credit) |

Create a derived `category` field using this mapping.

### Step 5: Vendor Normalization

Known vendor patterns in the Service data:

| Vendor Name                          | Vendor ID | Service Type          |
|--------------------------------------|-----------|-----------------------|
| `HW FARREN LLC`                      | 2064      | General labor/install |
| `CUSTOM SITE SOLUTIONS LLC`          | (varies)  | General labor/install |
| `ARMOUR COATINGS INC`                | 83        | Coatings/finishing    |
| `ROCK ENTERPRISES INC`               | (varies)  | Specialty             |
| `ELITE COATINGS INC`                 | (varies)  | Coatings              |
| `CLEVELAND BROTHERS EQUIPMENT CO INC`| (varies)  | Equipment rental      |
| `SUNBELT RENTALS INC`                | (varies)  | Equipment rental      |
| `SOUTHLAND INDUSTRIES`               | (varies)  | Specialty             |
| `0` or blank/NaN                     | —         | Internal/system entry |

**Rules:**
- Vendor Name of `0`, `NaN`, or blank → set to `"Internal / Non-Vendor"` 
- Standardize casing to title case for display
- Preserve original vendor name and ID for reference

### Step 6: Reference Field Parsing

The `Ref` column contains structured data:
- `"Supplier: 83 PS: 132663"` → Supplier ID 83, PO/Invoice 132663
- `"Cust:8 PS:95743"` → Customer billing reference
- `"Purge WIP to Cost of Sales"` → Accounting adjustment indicator

Parse into:
- `ref_type`: `supplier` | `customer` | `adjustment` | `other`
- `ref_id`: The supplier or customer number
- `ref_document`: The PO/invoice/PS number

### Step 7: Deduplication Strategy

When uploading a new file that overlaps with existing data:
- Use composite key: `Date` + `Job` + `Type` + `Net` + `Ref` to identify duplicates
- **Upsert logic:** If a row with the same composite key exists, skip it; otherwise insert
- Track `file_source` and `ingested_at` metadata per row for audit trail
- Provide a dashboard indicator showing last upload date and row counts

---

## Dashboard Views

### 1. Summary KPI Cards (Top of Dashboard)

- **Total Gross Spend** (sum of all Debit where Type = PUR-SUB)
- **Total Customer Credits** (sum of MFG-CUS Net, shown as positive offset)
- **Total Accounting Adjustments** (sum of MFG-VAR Net)
- **Net Cost to PSI** (Gross Spend - Credits - Adjustments)
- **Active Jobsites** (count of distinct base_job with spend in last 90 days)
- **Active Vendors** (count of distinct vendors with spend in last 90 days)
- **Date Range** (earliest to latest transaction in dataset)

### 2. Spend Over Time (Line/Bar Chart)

- **X-axis:** Month-Year (Jan 2025 → current)
- **Y-axis:** Dollar amount
- **Series:**
  - Gross sub-contract spend (PUR-SUB debits) — bar
  - Customer credits (MFG-CUS) — overlaid line or stacked bar (shown as positive for visual clarity)
  - Net cost — line overlay
- **Interactions:** Click a month to filter all other views to that month

### 3. Jobsite Breakdown (Horizontal Bar Chart + Table)

- Ranked list of base jobs by total net spend
- Bar chart showing each jobsite's gross spend vs customer credits vs net
- Click a jobsite to drill into its detail:
  - Timeline of spend for that job
  - Vendor breakdown for that job
  - Individual transaction list

### 4. Vendor Analysis (Pie/Donut + Table)

- Vendor share of total gross spend (PUR-SUB only)
- Table with: Vendor Name, Total Spend, # Invoices, Avg Invoice Size, Active Jobs
- Click vendor to see which jobsites they've worked on

### 5. Transaction Type Breakdown (Stacked Bar or Sankey)

- Show how gross spend flows through: PUR-SUB → offset by MFG-CUS → offset by MFG-VAR → Net
- Monthly stacked bar showing composition by type

### 6. Raw Data Table (Sortable/Filterable)

- Display all cleaned/normalized rows
- Columns: Date, Jobsite Name, Service Order, Category, Vendor, Description, Debit, Credit, Net, Ref
- Filters: Date range, Jobsite, Vendor, Type
- Export to CSV button

### 7. Upload & Settings Panel

- **File Upload:** Drag-and-drop or file picker for `.xlsx`
  - Show upload progress and ingestion results (rows added, duplicates skipped, errors)
  - Option to "Replace All" or "Append New" data
- **Jobsite Mapping Editor:** Editable table of base_job → site name mappings
  - Auto-adds new job numbers found during ingestion
- **Data Summary:** Total rows, date range, last upload timestamp

---

## Global Filters

Every chart and table should respond to these global filters:
- **Date Range** (start month/year — end month/year)
- **Jobsite** (multi-select dropdown of base jobs / site names)
- **Vendor** (multi-select dropdown)
- **Transaction Type** (checkboxes: PUR-SUB, MFG-CUS, MFG-VAR, STK-MTL, ADJ-PUR)

---

## Data Volumes & Performance Notes

- Current dataset: ~362 rows (Jan 2025 – Feb 2026)
- Expected growth: ~30-60 rows/month
- At 2+ years: ~1,000-1,500 rows — no need for a real database; JSON store is fine
- All aggregation can happen client-side or via simple API endpoints

---

## Deployment Configuration (Render)

### `render.yaml`
```yaml
services:
  - type: web
    name: psi-subcontract-dashboard
    runtime: node
    plan: free
    buildCommand: npm install
    startCommand: node server/index.js
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 10000
    disk:
      name: data
      mountPath: /data
      sizeGB: 1
```

> **Note:** The Render free tier with a persistent disk allows the JSON data store to survive deploys. If disk is not available on free tier, fall back to writing to the repo's `server/data/` directory and accepting that data resets on deploy (with re-upload capability).

---

## Implementation Approach for Claude Code

### Recommended Sub-Agent Strategy

This project benefits from Claude launching multiple sub-agents for parallel analysis:

1. **Data Analysis Agent**: Read the raw Excel file, confirm all column patterns, identify edge cases, validate the cleaning rules above against the actual data, and flag anything unexpected.

2. **Backend Agent**: Build the Express server with ingestion pipeline, normalization service, and REST API. Focus on the cleaning/normalization pipeline as the most critical component.

3. **Frontend Agent**: Build the dashboard SPA with charts, filters, and upload functionality.

4. **Integration Agent**: Wire everything together, test the upload flow end-to-end, verify chart data matches raw data.

### Build Order

1. Server scaffold + ingestion pipeline (most complex/risky)
2. Normalize a test file and dump to JSON — verify data quality
3. API endpoints for aggregated data
4. Frontend dashboard shell with chart placeholders
5. Wire API → Charts
6. Upload panel
7. Settings/mapping editor
8. Polish, error handling, deploy config

### Key Decisions for Claude to Make

- **Chart library:** Chart.js is lightweight and sufficient. Recharts if going React. D3 if needing heavy customization. Recommend Chart.js for simplicity.
- **Frontend framework:** Vanilla JS keeps it simple and avoids build tooling. React is fine if Claude prefers it but add a build step.
- **State management:** For vanilla JS, use a simple global state object with event-based re-rendering. For React, Context or Zustand.
- **File storage:** Use `lowdb` for a simple JSON file database with atomic writes, or roll a simple `fs.readFileSync/writeFileSync` wrapper.

---

## Sample Data Characteristics (for validation)

Use these known facts to validate the ingestion pipeline:

- Total Service rows in sample file: **362**
- Unique base job numbers: **32**
- Unique vendors (excluding internal): **8**
- Date range: **January 2, 2025 — February 28, 2026**
- Largest single vendor by gross spend: **HW Farren LLC** (~$3.9M net)
- Transaction type distribution: PUR-SUB (317), MFG-CUS (22), MFG-VAR (18), STK-MTL (3), ADJ-PUR (2)
- Months with negative net (credits exceed spend): October 2025, December 2025
- Job numbers have mixed case — must normalize to uppercase

---

## Important Context

This dashboard supports the **Ship Complete Strategy** initiative — an effort to reduce reliance on field sub-contractors by improving factory-complete shipments. The historical data here establishes the baseline cost and trend that the strategy aims to reduce. The dashboard should make it easy to demonstrate:

1. What the historical run-rate of sub-contract field service costs has been
2. Which sites and vendors drive the most cost
3. How customer credits and accounting adjustments affect the true net cost
4. Month-over-month trend direction (is it improving?)

The audience is VP-level and above, including board presentations, so the dashboard should look clean and professional.
