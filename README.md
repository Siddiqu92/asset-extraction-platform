# Asset Extraction & Reconciliation Platform

Full-stack platform that ingests financial documents, extracts structured asset records using AI and rule-based engines, reconciles duplicates, scores confidence, and exposes a canonical in-memory registry via NestJS API and React UI.

## Architecture Overview

**Backend** — NestJS modular pipeline:
`Ingestion → DocumentUnderstanding → Extraction → Confidence → Reconciliation → Assets`

**Frontend** — React + TypeScript:
Upload page, asset table with delta view, review queue, asset detail modal with field-level confidence badges.

**AI Layer** — Dual pipeline:
- OpenAI GPT-4o-mini for primary PDF extraction
- Claude (Anthropic) for validation and correction of extracted assets

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

Create `backend/.env`:

```
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
```

CSV and Excel extraction works without API keys. AI is used only for PDF narrative extraction.

## Ingestion Strategy

Files classified by extension: `pdf`, `xlsx`, `xls`, `csv`, `zip`. ZIP archives are recursively unpacked and each file processed independently. File type detection uses both extension and MIME type. Supported datasets include EIA Form 860, EIA Form 861, European energy plants (V20240104), US Federal Real Property (FRPP), GSA government buildings, municipal assessment rolls, and financial annual reports.

## OCR Approach

Born-digital PDFs parsed via `pdf-parse` for text layer. Text density measured per page — low density flags document as likely scanned (`needsOcr: true`). Full OCR via Tesseract is an extension point in `DocumentUnderstandingService`. pdfplumber handles table extraction from digital PDFs including assessment rolls and investor presentations.

## Table Extraction Strategy

- **CSV / Excel**: Python rule engine uses openpyxl with header row auto-detection (rows 0–5). Columns mapped by keyword matching across 40+ field aliases (name, value, currency, lat, lon, jurisdiction, asset type, capacity).
- **PDF**: pdfplumber extracts tables and applies numeric line heuristics for value detection. Supports EIA 860, FRPP, V20240104 European energy, municipal assessment roll formats, and REIT/annual report tables.

## Entity Resolution & Duplicate Detection

`ReconciliationService` normalises names (lowercase, strip punctuation, compact whitespace) and clusters candidates using fuzzy key matching on `name|jurisdiction`. Within each cluster, fields merged by highest confidence. Conflicts preserved with `factType: conflicting`. Each asset carries `duplicateClusterId` where applicable.

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

Overall confidence = weighted average of field scores.

Review recommendation:
- `auto-accept`: overall > 0.85
- `review`: overall 0.5–0.85
- `reject`: overall < 0.5

## Provenance Model

Every field is fully traceable. Each asset carries:
- `sourceEvidence[]` — exact quotes or row references from source
- `explanation` — human-readable extraction rationale
- `factType` — per-field classification
- `sourceFile` + `sourceJobId` — full traceability to ingestion job
- `fieldConfidence` — per-field confidence scores
- `validationFlags` — detected issues with severity

## Review Queue & Abstention Logic

Assets with `overallConfidence < 0.85` or validation flags routed to review queue. Analysts accept or reject individually. Delta view shows field-level changes between extraction runs for the same job. System abstains (routes to review) when evidence is insufficient or contradictory rather than guessing.

## Validation Rules

System detects:
- Impossible coordinates (lat outside -90/90, lon outside -180/180)
- Unit mismatches (MW vs MWh, sqft vs acres)
- Value-basis conflicts (book vs market on same asset)
- Duplicate collisions across files
- Portfolio total double-counting
- Unsupported precision (coordinates with 0 decimal places flagged as estimated)
- HQ address misattributed as asset location

## Supported File Types

| Format | Example | Extraction |
|--------|---------|------------|
| CSV | GSA buildings, REMPD | Rule-based column mapping |
| Excel | EIA 860, EIA 861, FRPP | openpyxl + header detection |
| PDF (digital) | Annual reports, investor decks | pdfplumber + AI |
| PDF (assessment roll) | Kingston, Saugerties, Western, Ava | Text-line value patterns |
| ZIP | EIA 860, V20240104, REMPD | Recursive extraction |

## Scaling & Batch Processing

- Jobs processed sequentially per file within a ZIP
- In-memory store suitable for assessment volumes; swap `AssetsService` store for PostgreSQL/Redis for production
- AI extraction rate-limited to 3 chunks per file with 3s delays to respect API limits
- Python rule engine timeout: 120s standard, 600s for ZIP files
- maxBuffer: 50MB to handle large Excel files (EIA 860 Generator file: 13,000+ rows)
```

