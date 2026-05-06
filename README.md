# Asset Extraction & Reconciliation Platform

Technical assessment: ingest financial documents (PDF, Excel, CSV), extract structured assets using **OpenAI + Claude AI**, score confidence, reconcile duplicates, validate fields, and expose a canonical in-memory registry via a NestJS API and React UI.

## Architecture overview

- **Backend**: NestJS modular pipeline — **Ingestion** → **DocumentUnderstanding** → **Extraction** (Python rule engine + OpenAI + Claude) → **Inference** → **Confidence** → **Validation** → **Reconciliation** → **Assets** (in-memory store).
- **Frontend**: React + TypeScript — upload, asset list with FactType badges, review queue with validation flags, delta/changes tab, asset detail modal.
- **AI layer**: **OpenAI GPT-4o-mini** for primary PDF extraction + **Claude Haiku** (Anthropic) for secondary cross-validation. CSV/Excel use rule-based extraction only (no API key needed).
- **Rule engine**: Python `backend/src/scripts/extract_tables.py` using **csv** (stdlib), **openpyxl** (xlsx/xls), **pdfplumber** (PDF tables).

## Quick start

```bash
# Backend
cd backend && npm install && npm run start:dev

# Frontend
cd frontend && npm install && npm start
```

## Environment variables

Create `backend/.env` (see `backend/.env.example`):

```env
OPENAI_API_KEY=your_openai_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here
PYTHON_RULE_ENGINE=        # optional: full path to python executable
```

The app runs **without** API keys for CSV and Excel uploads (rule-based). Missing keys gracefully skip AI extraction — PDFs still yield rows via pdfplumber.

## Python dependencies

```bash
python -m pip install pdfplumber openpyxl
```

## AI Pipeline

| Step | Model | Purpose |
|------|-------|---------|
| Primary extraction | OpenAI GPT-4o-mini | Extract assets from PDF text chunks |
| Cross-validation | Claude Haiku (Anthropic) | Validate, correct, and supplement OpenAI results |
| Fallback | Rule engine (Python) | CSV, Excel, PDF tables — no API key needed |

## Inference Engine

When fields are missing, `InferenceService` fills them automatically:
- **Currency** — inferred from jurisdiction (50+ mappings, e.g. "New York" → USD)
- **Asset type** — keyword matching (e.g. "solar farm" → renewable_energy)
- **Coordinates** — OpenStreetMap Nominatim geocoding (free, no key)
- **Value** — numeric pattern extraction from source text

Inferred fields are marked `factType: "inferred"` vs `"extracted"` for directly stated values.

## Validation

`ValidationService` runs 5 checks on every asset:
- `INVALID_LATITUDE / INVALID_LONGITUDE` — out of range coordinates
- `NULL_ISLAND_COORDINATES` — (0, 0) placeholder detection
- `UNIT_SCALE_MISMATCH` — value too small vs "millions/billions" in source text
- `DUPLICATE_VALUE_COLLISION` — same name+jurisdiction with >20% value difference
- `HQ_MISATTRIBUTION` — physical asset coordinates pointing to financial district
- `UNSUPPORTED_PRECISION` — value with >2 decimal places not found in source

## Delta Tracking

When the same document is re-uploaded, `AssetsService.computeDelta()` tracks:
- Added assets
- Removed assets
- Modified fields (with old/new values)

Access via `GET /assets/delta/:jobId` or the **Changes tab** in the UI.

## Confidence scoring

Field-level confidence refined in `ConfidenceService`. Review recommendation: `auto-accept` (>85%), `review` (50–85%), `reject` (<50%). UI shows green/yellow/red pills.

## Supported file types

| Format | Extraction method |
|--------|------------------|
| CSV | Rule-based column mapping |
| Excel (.xlsx / .xls) | openpyxl + header detection |
| PDF (digital) | pdfplumber + OpenAI + Claude |
| ZIP | Recursive extraction |

## Dataset coverage

- EIA Form 860 (2024) — US power plants
- European renewable energy plants
- EIA Form 861 — US utility statistics
- REMPD — Renewable energy projections
- GSA buildings — Federal inventory
- Federal Real Property Profile (FY2024)
- Municipal assessment rolls (NY)
- Annual reports & investor decks (REIT/CRE)

## License

Private / assessment use.