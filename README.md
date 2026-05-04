# Asset Extraction & Reconciliation Platform

Technical assessment stack: ingest financial documents (PDF, Excel, CSV), extract structured assets, score confidence, reconcile duplicates, and expose a canonical in-memory registry via a NestJS API and React UI.

## Architecture overview

- **Backend**: NestJS modular pipeline — **Ingestion** → **DocumentUnderstanding** (text from PDF / tabular files) → **Extraction** (Python rule engine first; optional Gemini for PDF narrative) → **Confidence** → **Reconciliation** → **Assets** (in-memory store).
- **Frontend**: React with TypeScript — upload, asset list, review queue, detail modal.
- **AI layer**: Google **Gemini 1.5 Flash** for best-effort PDF extraction (limited to three chunks with delays). CSV and Excel do **not** require a valid API key.
- **Rule engine**: Python script `backend/src/scripts/extract_tables.py` (copied to `dist/scripts` on `nest build`) using **csv** (stdlib), **openpyxl** (xlsx/xls), and **pdfplumber** (PDF tables / light text heuristics).

## Quick start

```bash
# Backend (from repo root)
cd backend && npm install && npm run start:dev

# Frontend
cd frontend && npm install && npm start
```

Backend default port is defined in `backend/src/main.ts` (commonly `3000`). Point the frontend API base URL at that host if needed (`frontend/src/api/client.ts`).

## Python dependencies

The rule engine is invoked with `python` on Windows and `python3` elsewhere. Install:

```bash
pip install pdfplumber openpyxl
```

On Linux/macOS you may use `pip3`. Without **openpyxl**, Excel paths return no rows; without **pdfplumber**, PDF table extraction returns an empty list (PDFs still get text via `pdf-parse` and optional Gemini if configured).

## Environment variables

Create `backend/.env` (do **not** commit it; `.gitignore` includes `.env`):

```env
GEMINI_API_KEY=your_key_here
```

The app runs **without** a real key for **CSV** and **Excel** uploads because extraction is rule-based. A placeholder or missing key skips Gemini on PDFs; PDFs can still yield rows from the Python/pdfplumber path when dependencies are installed.

## Ingestion strategy

Files are classified by extension: **pdf**, **xlsx**, **xls**, **csv**, **zip** (as supported by the ingestion module). MIME types from the browser are accepted in the upload dropzone. Text or tabular content is produced in **DocumentUnderstandingService** before extraction.

## OCR approach

Born-digital PDFs are parsed for text (e.g. **pdf-parse**). Low text density can surface a **needsOcr** style signal in document understanding; full OCR integration is left as an extension point in **DocumentUnderstandingService**.

## Table extraction strategy

- **CSV / Excel**: Rule-based rows via the Python script (no LLM).
- **PDF**: **pdfplumber** table detection and light line-based heuristics in Python; optional **Gemini** on filtered, chunked text for narrative content (rate-limit aware).

## Entity resolution & duplicates

**ReconciliationService** clusters and merges candidates; assets carry **sourceEvidence** and **duplicateClusterId** where applicable. Name normalization supports cross-document matching.

## Confidence scoring

Field-level confidence is supplied by extractors and refined in **ConfidenceService**. **Review recommendation** is derived from overall confidence and extractor hints (`auto-accept`, `review`, `reject`). The UI highlights confidence (green above 0.8, yellow from 0.5 to 0.8, red below 0.5) and surfaces a **Review Queue** for `reviewRecommendation === 'review'`.

## Verification checklist

- CSV upload → assets without Gemini.
- Excel upload → assets without Gemini (requires **openpyxl**).
- PDF upload → rule-based and/or AI rows depending on PDF content and keys.
- Frontend: asset table, formatted values, source file column, review tab.

## License

Private / assessment use unless otherwise stated.
