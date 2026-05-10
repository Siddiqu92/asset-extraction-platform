# Asset Extraction & Reconciliation Platform

Technical assessment stack: ingest financial documents (PDF, Excel, CSV, ZIP), extract structured assets, score confidence, reconcile duplicates, and expose a canonical in-memory registry via a NestJS API and React UI.

## Architecture overview

- **Backend**: NestJS modular pipeline — **Ingestion** → **DocumentUnderstanding** (text from PDF via `pdf-parse` + OCR for scanned PDFs / tabular files) → **Extraction** (Python rule engine first; OpenAI GPT-4o for PDF narrative) → **Confidence** → **Reconciliation** → **Assets** (in-memory store).
- **Frontend**: React with TypeScript — upload, asset list with tabs (All Assets / Review Queue / Changes), review queue with Accept/Reject, detail modal with per-field confidence bars.
- **AI layer**: **OpenAI GPT-4o** for initial asset extraction from PDF narrative text; **Claude (claude-opus-4-5)** for validation, enrichment, and cross-document reconciliation. CSV and Excel do **not** require AI API keys.
- **Rule engine**: Python script `backend/src/scripts/extract_tables.py` (copied to `dist/scripts` on `nest build`) using **csv** (stdlib), **openpyxl** (xlsx/xls), and **pdfplumber** (PDF tables / light text heuristics).
- **OCR**: Scanned/image-based PDFs are detected automatically and processed via `ocr_pdf.py` (Tesseract). Falls back to raw `pdf-parse` text if OCR returns insufficient content.

## Quick start

```bash
# Backend (from repo root)
cd backend && npm install && npm run start:dev

# Frontend
cd frontend && npm install && npm start
```

Backend default port: `3000`. Frontend API base URL: `frontend/src/api/client.ts`.

## Python dependencies

The rule engine is invoked with `python` on Windows and `python3` elsewhere. Install:

```bash
python -m pip install pdfplumber openpyxl pytesseract pillow pdf2image
```

Use the **same interpreter** the Nest process will spawn. If imports still fail, set **`PYTHON_RULE_ENGINE`** in `backend/.env` to the full path (e.g. `C:\Python314\python.exe`).

## Environment variables

Create `backend/.env` (do **not** commit — `.gitignore` includes `.env`):

```env
OPENAI_API_KEY=your_openai_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here
```

The app runs **without** API keys for **CSV** and **Excel** uploads (rule-based extraction only). Missing keys skip AI on PDFs; PDFs can still yield rows from the Python/pdfplumber path.

## Running tests

```bash
# Unit tests
cd backend && npm test

# Unit tests with coverage report
cd backend && npm run test:cov

# E2E tests
cd backend && npm run test:e2e
```

## Ingestion strategy

Files are classified by extension: **pdf**, **xlsx**, **xls**, **csv**, **zip**, **xz**. MIME types from the browser are accepted in the upload dropzone.

## OCR approach

Born-digital PDFs are parsed with **pdf-parse**. If extracted text density is below 100 chars/page, the document is classified as scanned. **OcrService** then calls `ocr_pdf.py` which uses **Tesseract** (via `pytesseract` + `pdf2image`) to extract text. Falls back gracefully if Tesseract is not installed.

## Table extraction strategy

- **CSV / Excel**: Rule-based rows via Python script (no LLM required).
- **PDF (born-digital)**: `pdfplumber` table detection + line-based heuristics; optional **OpenAI GPT-4o** for narrative content.
- **PDF (scanned)**: OCR via **Tesseract** → text → same extraction pipeline.

## Entity resolution & duplicates

**ReconciliationService** clusters and merges candidates using:
1. Exact name match (case-insensitive)
2. Coordinate proximity (±0.01° lat/lon)
3. Same jurisdiction + same value

Assets carry **sourceEvidence**, **duplicateClusterId**, and **alternateNames** for cross-document matching.

## Confidence scoring

Field-level confidence is supplied by extractors and refined in **ConfidenceService**. Base confidence is dataset-type aware:

| Dataset | Base Confidence |
|---------|----------------|
| EIA-860 Plant | 0.95 |
| European Renewable | 0.90 |
| NY Assessment Roll | 0.85 |
| Investor Presentation | 0.65 |
| Corporate Annual Report | 0.60 |
| Unknown | 0.30 |

**Review recommendation** derived from overall confidence:
- `> 0.85` → `auto-accept`
- `0.5 – 0.85` → `review`
- `< 0.5` → `reject`

## Validation flags

**ValidationService** runs 6 checks on every canonical asset:

| Flag Code | Severity | Description |
|-----------|----------|-------------|
| `INVALID_LATITUDE / INVALID_LONGITUDE` | error | Coordinate out of valid range |
| `NULL_ISLAND_COORDINATES` | warning | Both coords are exactly (0,0) |
| `UNIT_SCALE_MISMATCH` | warning | Value too small vs "millions/billions" in source |
| `ENERGY_UNIT_MISMATCH` | warning | MW vs MWh confusion for energy assets |
| `DUPLICATE_VALUE_COLLISION` | warning | Same name+jurisdiction with >20% value difference |
| `HQ_MISATTRIBUTION` | warning | Physical asset coords pointing to financial district |
| `UNSUPPORTED_PRECISION` | warning | Value has >2 decimals not found in source |

## Delta tracking

Re-uploading a file triggers delta comparison. View changes via:
- **UI**: Assets page → "Changes" tab → enter Job ID
- **API**: `GET /assets/delta/:jobId`

Returns `added`, `removed`, and `modified` records with field-level old vs new values.

## Verification checklist

- [ ] CSV upload → assets without API keys
- [ ] Excel upload → assets without API keys (requires **openpyxl**)
- [ ] PDF (born-digital) → rule-based extraction
- [ ] PDF (scanned) → OCR path activated
- [ ] ZIP upload → background processing + poll status
- [ ] Frontend: asset table, confidence colors, review tab, detail modal
- [ ] Unit tests pass: `npm test`
- [ ] E2E tests pass: `npm run test:e2e`

## Supported file types

| Format | Extraction method |
|--------|-------------------|
| CSV | Rule-based column mapping (`extract_tables.py`) |
| Excel (.xlsx / .xls) | openpyxl + header row detection |
| PDF (born-digital) | pdfplumber + optional OpenAI GPT-4o |
| PDF (scanned) | Tesseract OCR → pdfplumber + optional GPT-4o |
| ZIP / XZ | Recursive extraction of nested CSV / Excel / PDF |

## License

Private / assessment use unless otherwise stated.
