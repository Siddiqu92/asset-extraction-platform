# Asset Extraction & Reconciliation Platform

Full-stack platform that ingests financial documents, extracts structured asset records using AI and rule-based engines, reconciles duplicates, scores confidence, and exposes a canonical in-memory registry via NestJS API and React UI.

## Architecture Overview

**Backend** — NestJS modular pipeline:
`Ingestion → DocumentUnderstanding → Extraction → Confidence → Reconciliation → Assets`

**Frontend** — React + TypeScript:
Upload page, asset table with delta view, review queue, asset detail modal with field-level confidence badges.

**AI Layer** — Dual pipeline:
- **OpenAI GPT-4o** for primary PDF extraction — structured JSON output with per-field confidence and factType
- **Claude (`claude-opus-4-5`)** for validation, correction, and cross-document deduplication of extracted assets

**Rule Engine** — Python (`src/scripts/extract_tables.py`):
- CSV / Excel: direct row mapping with header detection
- PDF: pdfplumber table detection + numeric line heuristics

## Quick Start

```bash
cd backend && npm install && npm run start:dev
cd frontend && npm install && npm start
```

Backend: port 3000. Frontend: port 3001.

## Python Dependencies

```bash
python -m pip install pdfplumber openpyxl
```

Set `PYTHON_RULE_ENGINE` in `backend/.env` to your Python path if needed.

## Environment Variables

Create `backend/.env` (do **not** commit — `.gitignore` includes `.env`):

```
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
```

CSV and Excel extraction works without API keys. AI is used only for PDF narrative extraction.
A missing or placeholder key skips AI on PDFs; rule-based extraction still runs.

## AI Extraction Pipeline

PDF documents go through a three-step AI pipeline:

1. **OpenAI GPT-4o** extracts raw asset records from document text. Returns structured JSON with `value`, `confidence`, `factType`, and `explanation` per field.
2. **Claude (`claude-opus-4-5`)** validates each asset against the source text — lowers confidence for unsupported values, adds alternate names, flags validation issues (impossible coordinates, unit mismatches, HQ misattribution).
3. **Claude** performs cross-document deduplication — identifies near-duplicate assets across files and recommends merges with rationale.

Extraction is rate-limited to 3 chunks per PDF with 3-second delays. CSV and Excel files bypass AI entirely (rule engine only).

## Ingestion Strategy

Files classified by extension: `pdf`, `xlsx`, `xls`, `csv`, `zip`. ZIP archives are recursively unpacked and each file processed independently. File type detection uses both extension and MIME type. Supported datasets include EIA Form 860, EIA Form 861, European energy plants (V20240104), US Federal Real Property (FRPP), GSA government buildings, municipal assessment rolls, and financial annual reports.

## OCR Approach

Born-digital PDFs parsed via `pdf-parse` for text layer. Text density measured per page — low density flags document as likely scanned (`needsOcr: true`). Full OCR via Tesseract is an extension point in `DocumentUnderstandingService`. pdfplumber handles table extraction from digital PDFs including assessment rolls and investor presentations.

## Table Extraction Strategy

- **CSV / Excel**: Python rule engine uses openpyxl with header row auto-detection (rows 0–5). Columns mapped by keyword matching across 40+ field aliases (name, value, currency, lat, lon, jurisdiction, asset type, capacity).
- **PDF**: pdfplumber extracts tables and applies numeric line heuristics for value detection. Supports EIA 860, FRPP, V20240104 European energy, municipal assessment roll formats, and REIT/annual report tables.

## Entity Resolution & Duplicate Detection

`ReconciliationService` normalises names (lowercase, strip punctuation, compact whitespace) and clusters candidates using fuzzy key matching on `name|jurisdiction`. Coordinate proximity (≤0.01°) and exact value+jurisdiction match also trigger clustering. Within each cluster, fields merged by highest confidence. Conflicts preserved with `factType: conflicting`. Each asset carries `duplicateClusterId` where applicable.

Claude performs a secondary AI-level deduplication pass on top of the rule-based clustering — catching near-duplicates with variant names that exact matching misses.

## Value Estimation Strategy

When value absent, system infers using:
1. Direct extraction from adjacent numeric fields (sqft × rate, capacity × unit price)
2. Assessed value from municipal assessment rolls (Kingston, Saugerties, Western, Ava)
3. Portfolio-level allocation when only totals present — flagged `factType: estimated`

All inferred values carry reduced confidence scores.

## Geocoding Approach

Coordinates resolved in priority order:
1. Direct lat/lon columns in source (EIA 860 Plant file has exact coordinates per plant)
2. European plants from V20240104 carry x/y coordinates natively
3. Address geocoding via Nominatim (OpenStreetMap) with 1s rate limiting and retry
4. County-level centroid fallback using bundled `vcerare-county-lat-long-fips.csv`
5. Null if no location evidence found — flagged for review

## Confidence Scoring

Field-level confidence by extractor type:
- `extracted` (direct from source): 0.85–1.0
- `inferred` (derived from context): 0.5–0.75
- `estimated` (approximated): 0.3–0.5
- `conflicting` (contradiction detected): 0.1–0.3

Overall confidence = weighted average of field scores (assetName ×3, value ×2.5, jurisdiction ×1.2, lat/lon ×1 each).

Review recommendation:
- `auto-accept`: overall > 0.85
- `review`: overall 0.5–0.85
- `reject`: overall < 0.5

## Provenance Model

Every field is fully traceable. Each asset carries:
- `sourceEvidence[]` — exact quotes or row references from source
- `explanation` — human-readable extraction rationale (e.g. "Extracted from column 'Plant Name' in row 42")
- `factType` — per-field classification (`extracted` | `inferred` | `estimated` | `conflicting` | `unsupported`)
- `sourceFile` + `sourceJobId` — full traceability to ingestion job
- `fieldConfidence` — per-field confidence scores (0–1)
- `validationFlags` — detected issues with severity (`error` | `warning`)

## Review Queue & Abstention Logic

Assets with `overallConfidence < 0.85` or any validation flags are routed to the review queue. Analysts accept or reject individually. The **Changes tab** shows a field-level delta between extraction runs for the same job ID — added, removed, and modified assets with old→new values per changed field. System abstains (routes to review) when evidence is insufficient or contradictory rather than guessing.

## Validation Rules

System detects and flags:
- **Impossible coordinates** — lat outside −90/90, lon outside −180/180 (`INVALID_LATITUDE`, `INVALID_LONGITUDE`)
- **Null Island** — coordinates exactly (0, 0), likely a placeholder (`NULL_ISLAND_COORDINATES`)
- **Unit scale mismatch** — value too small relative to "billions"/"millions"/"thousands" in source text (`UNIT_SCALE_MISMATCH`)
- **Energy unit mismatch** — capacity field labelled MWh where MW is expected, or vice versa (`ENERGY_UNIT_MISMATCH`)
- **Value-basis conflicts** — book vs market value on same asset (detected via Claude validation pass)
- **Duplicate collisions** — same name+jurisdiction with >20% value difference across files (`DUPLICATE_VALUE_COLLISION`)
- **Unsupported precision** — value has >2 decimal places not present in source evidence (`UNSUPPORTED_PRECISION`)
- **HQ misattribution** — physical asset coordinates point to a known financial district (`HQ_MISATTRIBUTION`)

## Asset Relationships

Each asset can carry `parentAssetId`, `childAssetIds`, and a `relationships[]` array with `relationType` (e.g. `duplicate`, `component`, `portfolio-member`) and `confidence`. Claude's validation pass identifies parent/child relationships visible in source documents. The asset detail modal renders a relationship tree.

## Alternate Names

Assets carry both `assetName` (canonical) and `alternateNames[]` (aliases found in source or identified by Claude). These are used during reconciliation to catch duplicates that differ only by abbreviation or alternate spelling.

## Supported File Types

| Format | Example | Extraction |
|--------|---------|------------|
| CSV | GSA buildings, REMPD | Rule-based column mapping |
| Excel | EIA 860, EIA 861, FRPP | openpyxl + header detection |
| PDF (digital) | Annual reports, investor decks | pdfplumber + OpenAI GPT-4o + Claude |
| PDF (assessment roll) | Kingston, Saugerties, Western, Ava | Text-line value patterns |
| ZIP | EIA 860, V20240104, REMPD | Recursive extraction |

## Dataset Coverage

The rule engine is designed for real-world assessment and energy datasets:

- **EIA Form 860 (2024)** — US power generation facilities (plants, lat/lon, state, utility)
- **European energy plants (V20240104)** — Solar, wind, hydro, biogas, cogeneration (coordinates where present)
- **EIA Form 861 (2024)** — US electric utility statistics (state / table-oriented Excel)
- **REMPD** — Renewable energy material and capacity projections (CSV in ZIP)
- **US government buildings (GSA)** — Federal building inventory CSVs
- **Federal Real Property Profile FY2024** — Installation-level federal assets (Excel)
- **Municipal assessment rolls** — Property tax / assessed value PDFs (NY and similar)
- **Annual reports & investor decks** — CRE / REIT PDFs (tables + narrative; OpenAI + Claude for PDF-only augmentation)

## Scaling & Batch Processing

- Jobs processed sequentially per file within a ZIP
- In-memory store suitable for assessment volumes; swap `AssetsService` store for PostgreSQL/Redis for production
- AI extraction rate-limited to 3 chunks per file with 3s delays to respect API limits
- Python rule engine timeout: 120s standard, 600s for ZIP files
- maxBuffer: 50MB to handle large Excel files (EIA 860 Generator file: 13,000+ rows)

## Verification Checklist

- CSV upload → assets extracted without API keys
- Excel upload → assets extracted without API keys (requires `openpyxl`)
- PDF upload → rule-based rows and/or AI rows depending on content and key availability
- Frontend: asset table, formatted values, source file column, dataset type badge, review tab
- Changes tab: enter a job ID to see field-level delta between runs
- Asset detail modal: field confidence bars, factType badges, alternate names, relationship tree, validation flags, source evidence, explanation
