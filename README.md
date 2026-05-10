# Asset Extraction & Reconciliation Platform

Technical assessment stack: ingest financial documents (PDF, Excel, CSV, ZIP), extract structured assets, score confidence, reconcile duplicates, and expose a canonical in-memory registry via a NestJS API and React UI.

---

## Overall Architecture

```
┌─────────────┐     ┌──────────────────────────────────────────────────────┐
│  React UI   │────▶│                  NestJS Backend                      │
│  (port 3001)│     │                                                      │
└─────────────┘     │  Ingestion → DocumentUnderstanding → Extraction      │
                    │      → Inference → Reconciliation                    │
                    │      → Validation → Confidence → Assets              │
                    └──────────────────────────────────────────────────────┘
```

- **Backend**: NestJS modular pipeline — **Ingestion** → **DocumentUnderstanding** (text from PDF via `pdf-parse` + OCR for scanned PDFs) → **Extraction** (Python rule engine first; OpenAI GPT-4o for PDF narrative) → **Inference** (fill missing fields) → **Reconciliation** (merge/dedup) → **Validation** → **Confidence** → **Assets** (in-memory canonical registry).
- **Frontend**: React + TypeScript — upload dropzone, asset list with tabs (All Assets / Review Queue / Changes), review queue with Accept/Reject actions, detail modal with per-field confidence bars and source evidence.
- **AI layer**: **OpenAI GPT-4o** for initial asset extraction from PDF narrative text; **Claude (claude-opus-4-5)** for validation enrichment and cross-document reconciliation. CSV and Excel do **not** require AI API keys.
- **Rule engine**: Python script `backend/src/scripts/extract_tables.py` using `csv` (stdlib), `openpyxl` (xlsx/xls), and `pdfplumber` (PDF tables / text heuristics).
- **OCR**: Scanned/image-based PDFs detected automatically via `ocr_pdf.py` (Tesseract). Falls back to raw `pdf-parse` text if OCR returns insufficient content.

---

## Quick Start

```bash
# Backend (from repo root)
cd backend && npm install && npm run start:dev

# Frontend
cd frontend && npm install && npm start
```

Backend default port: `3000`. Frontend API base URL: `frontend/src/api/client.ts`.

---

## Python Dependencies

```bash
python -m pip install pdfplumber openpyxl pytesseract pillow pdf2image
```

Set **`PYTHON_RULE_ENGINE`** in `backend/.env` to the full Python path if needed (e.g. `C:\Python314\python.exe`).

---

## Environment Variables

Create `backend/.env`:

```env
OPENAI_API_KEY=your_openai_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here
```

CSV and Excel uploads work without API keys. Missing keys skip AI on PDFs; pdfplumber extraction still runs.

---

## Running Tests

```bash
cd backend && npm test           # Unit tests (68 tests)
cd backend && npm run test:cov   # Unit tests + coverage report
cd backend && npm run test:e2e   # E2E tests (9 tests)
```

---

## Ingestion Strategy

Files are classified by extension: `pdf`, `xlsx`, `xls`, `csv`, `zip`, `xz`. Processing is synchronous for small files and background-queued for ZIP/XZ archives. Each upload creates a **Job ID** used for status polling and delta tracking.

| Format | Handler |
|--------|---------|
| CSV | `IngestionService` → Python rule engine |
| Excel (.xlsx / .xls) | `IngestionService` → openpyxl via Python script |
| PDF (born-digital) | `DocumentUnderstandingService` → pdfplumber + optional GPT-4o |
| PDF (scanned) | `OcrService` → Tesseract → same extraction pipeline |
| ZIP / XZ | `ZipIngestionService` → recursive extraction of nested files |

---

## OCR Approach

Born-digital PDFs are parsed with **pdf-parse**. If extracted text density falls below 100 characters per page, the document is classified as scanned. **OcrService** then invokes `ocr_pdf.py` which uses **Tesseract** (via `pytesseract` + `pdf2image`) to rasterize pages and extract text. The OCR result is fed back into the same extraction pipeline as born-digital text. Falls back gracefully if Tesseract is not installed.

---

## Table Extraction Strategy

- **CSV / Excel**: Row-by-row rule-based mapping via Python script — header detection, column name normalization, type coercion.
- **PDF (born-digital)**: `pdfplumber` table detection using line/bbox analysis; supplemented by **OpenAI GPT-4o** for narrative sections where structured tables are absent.
- **PDF (scanned)**: Tesseract OCR → reconstructed text → same pdfplumber + GPT-4o pipeline.
- **Map labels / captions**: GPT-4o prompt instructs the model to extract coordinates and asset names from caption blocks and footnotes in addition to tables.

---

## Entity Resolution Strategy

**ReconciliationService** performs multi-pass entity matching across all extracted assets:

1. **Exact name match** (case-insensitive, whitespace-normalized)
2. **Coordinate proximity** (±0.01° lat/lon — approximately 1 km)
3. **Same jurisdiction + same value** (within 1% tolerance)
4. **Alternate name matching** — aliases, abbreviations stored in `alternateNames[]`

When a match is found, fields are merged using a source-priority hierarchy: structured datasets (EIA-860, NY Assessment Roll) override narrative/inferred fields. Conflicts are preserved in `sourceEvidence` rather than silently dropped.

---

## Duplicate Detection Approach

Duplicate candidates are clustered into a `duplicateClusterId` group. Detection logic:

- **Hard duplicates**: same name + jurisdiction + value within 5% → merged into single canonical record, sources combined.
- **Soft duplicates**: same name + jurisdiction but value differs by >20% → flagged with `DUPLICATE_VALUE_COLLISION` validation flag and sent to review queue for human resolution.
- **Coordinate collision**: two different-named assets within 50m of each other in the same asset class → flagged for review.

Each canonical record carries `duplicateClusterId` and `alternateNames` to trace all contributing source records.

---

## Value Estimation Strategy

When a value field is absent or unreliable, **InferenceService** applies the following estimation hierarchy:

1. **Direct extraction**: value present in source text or table — used as-is, marked `factType: extracted`.
2. **Unit scaling**: value present but unit ambiguous (e.g. "5M") — inferred from surrounding text keywords (`million`, `billion`, `thousand`), marked `factType: inferred`.
3. **Comparable asset inference**: no value present — median value of assets with the same `assetType` and `jurisdiction` in the current registry is used as a placeholder, marked `factType: estimated` with low field confidence (≤ 0.3).
4. **AI estimation**: GPT-4o / Claude prompted with asset context and asked for a reasoned estimate with explicit uncertainty acknowledgement, marked `factType: estimated`.
5. **Abstention**: if none of the above produce a value with confidence > 0.2, `value` is left `null` and the asset is flagged for human review.

All inferred or estimated values carry a lower `fieldConfidence.value` score and an `explanation` field describing the estimation rationale.

---

## Geocoding Approach

Coordinates are resolved in the following priority order:

1. **Direct extraction**: latitude/longitude explicitly present in source — used directly, marked `factType: extracted`.
2. **Address geocoding**: street address present → `CountyGeocodingService` resolves to county centroid using a local reference dataset (no external API required), marked `factType: inferred`, confidence 0.6.
3. **Jurisdiction centroid**: only jurisdiction (state/country) available → centroid coordinates assigned, marked `factType: estimated`, confidence 0.4, flagged with `COORDINATES_GEOCODED_NOT_EXACT`.
4. **AI inference**: Claude prompted with all available location clues (site descriptions, nearby landmarks, grid references) to infer coordinates with reasoning, marked `factType: inferred`.
5. **Null fallback**: if no location signal exists, `latitude` and `longitude` are left `null`, reducing overall confidence by 0.15.

Extracted coordinates are validated by **ValidationService** for impossible ranges, null-island (0,0), and financial-district misattribution (HQ address used instead of asset location).

---

## Confidence Scoring Strategy

Every asset receives a field-level and overall confidence score computed by **ConfidenceService**.

**Base confidence by dataset type:**

| Dataset | Base Confidence |
|---------|----------------|
| EIA-860 Plant | 0.95 |
| European Renewable | 0.90 |
| NY Assessment Roll | 0.85 |
| EIA-861 Sales | 0.70 |
| Investor Presentation | 0.65 |
| Corporate Annual Report | 0.65 |
| GSA Buildings | 0.55 |
| Federal Installations | 0.50 |
| Unknown | 0.30 |

**Deductions applied:**

| Condition | Deduction |
|-----------|-----------|
| Value is null or zero | −0.15 |
| Coordinates are null | −0.15 |
| Jurisdiction missing | −0.05 |
| No source evidence | −0.05 |
| Coordinates geocoded (not exact) | −0.10 |
| Scanned PDF OCR source | −0.20 |
| Asset decommissioned | −0.10 |

**Review recommendation:**

| Overall Confidence | Recommendation |
|--------------------|---------------|
| > 0.85 | `auto-accept` |
| 0.50 – 0.85 | `review` |
| < 0.50 | `reject` |

---

## Provenance Model

Every field in a canonical asset record is traceable to its origin. The provenance model consists of:

- **`sourceFile`**: filename of the originating document.
- **`sourceJobId`**: ingestion job that produced this record — links to ingestion log.
- **`sourceEvidence[]`**: array of raw text snippets extracted from the source document that support the field values.
- **`explanation`**: human-readable string describing how the record was assembled, which fields were inferred, and what conflicts were resolved.
- **`factType`**: per-field map indicating whether each field value is `extracted` (directly from source), `inferred` (derived by logic), or `estimated` (approximated with uncertainty).
- **`fieldConfidence`**: per-field numeric confidence (0–1) reflecting extraction reliability.
- **`validationFlags[]`**: structured flags with `code`, `severity`, and `message` — each flag is itself traceable to the validation rule that raised it.

This model ensures every record can be fully audited: reviewers can trace any field back to the exact source text, inference rule, or AI prompt that produced it.

---

## Review Queue & Abstention Logic

Assets are routed to the **review queue** when human judgment is required:

- `overallConfidence` between 0.50 and 0.85 → `reviewRecommendation: 'review'`
- Any asset with more than 3 validation flags → forced to `review` regardless of confidence
- `overallConfidence` < 0.50 → `reviewRecommendation: 'reject'` (surfaced in review queue for analyst confirmation)
- Asset name missing or blank → immediately `reject` with `overallConfidence: 0`

**Abstention** (system refuses to auto-accept):
- Scanned PDF source with low OCR confidence
- Any `error`-severity validation flag (impossible coordinates, etc.)
- Inferred or estimated coordinates (not exact)
- Value field marked `estimated` with confidence < 0.3

Reviewers can **Accept** (promotes to canonical registry with `auto-accept`) or **Reject** (removes from registry) via the UI Review Queue tab or `PATCH /assets/:id` API endpoint.

---

## Scaling & Batch Processing Approach

The current implementation uses an **in-memory asset store** suitable for assessment/demo purposes. For production scale:

- **Queue-based ingestion**: ZIP/XZ uploads are already processed asynchronously via background jobs. This pattern extends to all file types using a job queue (e.g. BullMQ + Redis).
- **Job status polling**: `GET /ingestion/jobs/:jobId/status` allows clients to poll without blocking — the pattern is already implemented.
- **Horizontal scaling**: NestJS services are stateless by design. Moving the asset store to PostgreSQL or MongoDB allows multiple backend instances behind a load balancer.
- **Batch AI calls**: Extraction calls to GPT-4o/Claude are already isolated in `AiService` — these can be batched using the Anthropic and OpenAI batch APIs to reduce cost and latency at scale.
- **Python rule engine**: The `extract_tables.py` script can be replaced with a dedicated microservice (FastAPI) for CPU-intensive PDF/OCR workloads, allowing independent scaling.
- **Delta tracking**: The `DeltaService` already computes field-level diffs per job — this supports incremental processing where only changed records are re-validated.

---

## Validation Flags Reference

| Flag Code | Severity | Description |
|-----------|----------|-------------|
| `INVALID_LATITUDE` / `INVALID_LONGITUDE` | error | Coordinate out of valid range |
| `NULL_ISLAND_COORDINATES` | warning | Both coords are exactly (0, 0) |
| `UNIT_SCALE_MISMATCH` | warning | Value too small vs "millions/billions" in source |
| `ENERGY_UNIT_MISMATCH` | warning | MW vs MWh confusion for energy assets |
| `ENERGY_UNIT_AMBIGUOUS` | warning | Both MW and MWh in evidence for same asset |
| `DUPLICATE_VALUE_COLLISION` | warning | Same name+jurisdiction with >20% value difference |
| `HQ_MISATTRIBUTION` | warning | Physical asset coords pointing to known financial district |
| `UNSUPPORTED_PRECISION` | warning | Value has >2 decimals not found in source evidence |
| `COORDINATES_GEOCODED_NOT_EXACT` | warning | Coordinates inferred from address/jurisdiction, not exact |
| `IMPOSSIBLE_COORDINATES` | error | Lat/lon outside physically valid range |

---

## Delta Tracking

Re-uploading a file triggers delta comparison against the previous job's assets. View changes via:

- **UI**: Assets page → "Changes" tab → enter Job ID
- **API**: `GET /assets/delta/:jobId`

Returns `added`, `removed`, and `modified` records with field-level old vs new values.

---

## Supported File Types

| Format | Extraction Method |
|--------|------------------|
| CSV | Rule-based column mapping (`extract_tables.py`) |
| Excel (.xlsx / .xls) | openpyxl + header row detection |
| PDF (born-digital) | pdfplumber + optional OpenAI GPT-4o |
| PDF (scanned) | Tesseract OCR → pdfplumber + optional GPT-4o |
| ZIP / XZ | Recursive extraction of nested CSV / Excel / PDF |

---

## Verification Checklist

- [ ] CSV upload → assets extracted without API keys
- [ ] Excel upload → assets extracted without API keys (requires openpyxl)
- [ ] PDF (born-digital) → rule-based extraction via pdfplumber
- [ ] PDF (scanned) → OCR path activated via Tesseract
- [ ] ZIP upload → background job processing + status poll
- [ ] Frontend: asset table, confidence color coding, review tab, detail modal
- [ ] Unit tests pass: `npm test` (68/68)
- [ ] E2E tests pass: `npm run test:e2e` (9/9)

---

## License

Private / assessment use unless otherwise stated.
