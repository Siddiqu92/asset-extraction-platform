#!/usr/bin/env python3
"""
Hybrid rule-based asset extractor.
Supports: CSV, Excel (XLSX/XLS), PDF (tables + text), ZIP archives.
"""
import json
import os
import re
import sys
import traceback


# ─── HELPERS ────────────────────────────────────────────────────────────────


def parse_number(s):
    if s is None:
        return None
    try:
        cleaned = re.sub(r"[$,\s]", "", str(s))
        v = float(cleaned)
        return v if v == v else None  # reject NaN
    except (TypeError, ValueError, AttributeError):
        return None


def safe_str(v, limit=200):
    if v is None:
        return None
    s = str(v).strip()
    return s[:limit] if s else None


def _base_confidence_for_profile(profile: str, has_val: bool, has_loc: bool, has_jur: bool) -> float:
    """Deterministic base overall confidence by extraction source (Nest ConfidenceService may refine)."""
    p = (profile or "default").lower()
    base = {
        "csv_with_coords": 0.86,
        "csv_no_coords": 0.70,
        "xlsx_with_coords": 0.80,
        "xlsx_no_coords": 0.72,
        "pdf_table": 0.75,
        "pdf_text_assessment": 0.83,
        "pdf_text_investor": 0.48,
        "pdf_text_generic": 0.47,
        "conflicting": 0.20,
        "default": 0.62,
    }.get(p, 0.62)
    if not has_val:
        base -= 0.15
    base = max(0.05, min(0.95, round(base, 2)))
    nm = 0
    if not has_val and not has_loc and not has_jur:
        nm = 1
    if nm and base > 0.12:
        base = min(base, 0.12)
    return base


def _review_from_confidence(confidence: float) -> str:
    if confidence >= 0.85:
        return "auto-accept"
    if confidence >= 0.50:
        return "review"
    return "reject"


def make_asset(
    name,
    value=None,
    currency="USD",
    jurisdiction=None,
    lat=None,
    lon=None,
    asset_type="Asset",
    value_basis=None,
    alt_names=None,
    evidence=None,
    explanation="",
    validation_flags=None,
    fact_type=None,
    extraction_profile="default",
):
    """Build a standard asset dict (compatible with Nest Asset / mapParsedToAssets)."""
    has_val = value is not None
    has_loc = lat is not None and lon is not None
    has_jur = jurisdiction is not None

    confidence = _base_confidence_for_profile(
        extraction_profile, has_val, has_loc, has_jur
    )
    rec = _review_from_confidence(confidence)

    flags = list(validation_flags or [])
    if has_loc:
        if lat is not None and not (-90 <= lat <= 90):
            flags.append("invalid-latitude")
        if lon is not None and not (-180 <= lon <= 180):
            flags.append("invalid-longitude")

    default_fact = {
        "assetName": "extracted",
        "value": "extracted" if has_val else "unsupported",
        "jurisdiction": "extracted" if has_jur else "inferred",
        "coordinates": "extracted" if has_loc else "unsupported",
    }

    fa = round(min(0.92, 0.72 + 0.06 * (1 if has_val else 0) + 0.08 * (1 if has_loc else 0)), 2)
    fv = 0.85 if has_val else 0.0
    fj = 0.82 if has_jur else 0.0
    fc = 0.92 if has_loc else 0.0

    return {
        "assetName": str(name)[:200],
        "alternateName": alt_names or [],
        "value": value,
        "currency": currency,
        "jurisdiction": safe_str(jurisdiction),
        "latitude": lat,
        "longitude": lon,
        "assetType": safe_str(asset_type) or "Asset",
        "valueBasis": safe_str(value_basis),
        "parentAssetId": None,
        "childAssetIds": [],
        "duplicateClusterId": None,
        "fieldConfidence": {
            "assetName": fa,
            "value": fv,
            "jurisdiction": fj,
            "coordinates": fc,
        },
        "overallConfidence": confidence,
        "sourceEvidence": evidence or [],
        "explanation": explanation,
        "validationFlags": flags,
        "reviewRecommendation": rec,
        "factType": fact_type or default_fact,
    }


def dedup(assets):
    seen = set()
    out = []
    for a in assets:
        key = a["assetName"].lower().strip()[:100]
        if key and len(key) >= 2 and key not in seen:
            seen.add(key)
            out.append(a)
    return out


def _is_year_number(v: float) -> bool:
    if v is None or not isinstance(v, (int, float)):
        return False
    try:
        iv = int(round(float(v)))
    except (TypeError, ValueError):
        return False
    return 1900 <= iv <= 2100 and abs(float(v) - iv) < 0.01


PDF_GARBAGE_LINE = re.compile(
    r"(?i)^(form\s*10\b|for\s+the\s+y(ea)?r\b|annual\s+re(port)?\b|nnual\s+re\b|"
    r"exact\s+name\b|table\s+of\s+contents\b|part\s+[ivx]+\b|item\s+\d+\b|"
    r"common\s+stock\b|registered\s+holder\b)\b"
)


def _is_pdf_garbage_name(name: str) -> bool:
    s = (name or "").strip()
    if len(s) < 15:
        return True
    low = s.lower()
    if PDF_GARBAGE_LINE.search(s):
        return True
    noise = ("incorporated", "securities and exchange", "forward-looking", "page ")
    if any(p in low for p in noise):
        return True
    letters = len(re.findall(r"[a-zA-Z]", s))
    if letters < 6:
        return True
    return False


def _detect_pdf_kind(first_page_text: str) -> str:
    t = (first_page_text or "").upper()
    if "FINAL ASSESSMENT ROLL" in t or "ASSESSMENT ROLL" in t:
        return "ny_assessment"
    if "10-K" in t or "10K" in t or "FORM 10" in t or "ANNUAL REPORT" in t:
        return "regulatory"
    if "INVESTOR PRESENTATION" in t or ("INVESTOR" in t and "PRESENTATION" in t):
        return "investor"
    if "PORTFOLIO" in t and any(k in t for k in ("LOAN", "CRE", "DEBT", "FINANCING")):
        return "investor"
    return "generic"


def _pdf_row_high_quality(kind: str, name: str, value, lat, lon) -> bool:
    if not name or _is_pdf_garbage_name(name):
        return False
    has_loc = lat is not None and lon is not None
    if kind == "ny_assessment":
        if value is None or _is_year_number(value):
            return False
        return 5000 <= float(value) <= 1e11
    if value is not None:
        if _is_year_number(value) or float(value) < 100_000:
            return False
    else:
        if not has_loc:
            return False
    return True


def _header_match(col_name: str, header_key: str) -> bool:
    """Avoid false positives (e.g. 'state' in 'estate')."""
    n = col_name.lower().strip()
    k = header_key.lower().strip()
    if not n or not k:
        return False
    if k == n:
        return True
    if k.startswith(n + " ") or k.startswith(n + "(") or k.startswith(n + ","):
        return True
    if len(n) >= 8 and n in k:
        return True
    if len(n) <= 4 and (k == n or k.startswith(n + "_")):
        return True
    return False


# ─── CSV ────────────────────────────────────────────────────────────────────


def extract_from_csv(file_path: str) -> list:
    import csv

    assets = []
    delimiter = ","
    for d in [",", ";", "\t", "|"]:
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                sample = f.read(2048)
            if sample.count(d) >= 3:
                delimiter = d
                break
        except OSError:
            delimiter = ","
            break

    base = os.path.basename(file_path)

    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            reader = csv.DictReader(f, delimiter=delimiter)
            headers = reader.fieldnames or []

            def get(row, *names):
                for name in names:
                    for h in headers:
                        if not h:
                            continue
                        if _header_match(name, h):
                            v = row.get(h, "")
                            if v and str(v).strip():
                                return str(v).strip()
                return None

            for i, row in enumerate(reader):
                if i >= 2000:
                    break

                name = (
                    get(
                        row,
                        "assetname",
                        "plant name",
                        "facility name",
                        "asset name",
                        "installation name",
                        "property name",
                        "unit name",
                        "station name",
                        "name",
                    )
                    or get(row, "address", "street address", "bldg address")
                    or get(row, "location", "site")
                )

                if not name or len(name.strip()) < 2:
                    continue

                value = None
                value_basis = None
                for col in [
                    "value",
                    "assessed value",
                    "total value",
                    "cost",
                    "capacity",
                    "installed_capacity",
                    "mw",
                    "amount",
                    "total acres",
                    "bldg ansi usable",
                ]:
                    v = get(row, col)
                    if v:
                        num = parse_number(v)
                        if num is not None and num > 0:
                            value = num
                            value_basis = col
                            break

                lat = parse_number(
                    get(row, "latitude", "lat", "y_coord", "y coord")
                )
                lon = parse_number(
                    get(
                        row,
                        "longitude",
                        "lon",
                        "long",
                        "x_coord",
                        "x coord",
                        "x_coordinates",
                    )
                )

                jurisdiction = get(
                    row, "state", "country", "nation", "jurisdiction", "region"
                ) or get(row, "county", "city")

                asset_type = (
                    get(
                        row,
                        "energy source",
                        "fuel type",
                        "sector name",
                        "property type",
                        "asset type",
                        "type",
                        "primary purpose",
                    )
                    or "Asset"
                )

                alt = []
                owner = get(row, "utility name", "owner", "operator", "company")
                if owner and owner != name:
                    alt.append(owner)

                currency = "USD"
                country = get(row, "country", "nation")
                if country and country.upper() not in ("US", "USA", "UNITED STATES"):
                    currency = (
                        "EUR" if "euro" in country.lower() else "USD"
                    )

                prof = (
                    "csv_with_coords"
                    if lat is not None and lon is not None
                    else "csv_no_coords"
                )
                assets.append(
                    make_asset(
                        name=name,
                        value=value,
                        currency=currency,
                        jurisdiction=jurisdiction,
                        lat=lat,
                        lon=lon,
                        asset_type=asset_type,
                        value_basis=value_basis,
                        alt_names=alt,
                        evidence=[f"CSV row {i + 2}: {base}"],
                        explanation=f"Extracted from CSV row {i + 2}",
                        extraction_profile=prof,
                    )
                )
    except Exception as e:
        print(f"CSV error: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)

    print(
        f"CSV: {len(assets)} assets from {base}",
        file=sys.stderr,
    )
    return assets[:1000]


# ─── EXCEL ──────────────────────────────────────────────────────────────────


def extract_from_xlsx(file_path: str) -> list:
    import openpyxl

    assets = []
    base = os.path.basename(file_path)

    try:
        wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
    except Exception as e:
        print(f"XLSX open error: {e}", file=sys.stderr)
        return []

    for sname in wb.sheetnames:
        try:
            ws = wb[sname]
            rows = list(ws.iter_rows(values_only=True))
            if len(rows) < 2:
                continue

            header_idx = 0
            headers = []
            for i, row in enumerate(rows[:6]):
                strs = [str(c).strip() if c is not None else "" for c in row]
                non_empty = [
                    s for s in strs if s and not s.replace(".", "").isdigit()
                ]
                if len(non_empty) >= 3:
                    headers = strs
                    header_idx = i
                    break

            if not headers:
                continue

            h = {}
            for idx, v in enumerate(headers):
                key = str(v).strip().lower() if v is not None else ""
                if not key:
                    key = f"__col_{idx}"
                if key not in h:
                    h[key] = idx

            def get_col(row, *names):
                for name in names:
                    for k, idx in h.items():
                        if not _header_match(name, k):
                            continue
                        if idx < len(row) and row[idx] is not None:
                            s = str(row[idx]).strip()
                            if s:
                                return s
                return None

            sheet_assets = []
            for i, row in enumerate(rows[header_idx + 1 :], start=header_idx + 1):
                if i > 10000:
                    break
                if not row or not any(c is not None for c in row):
                    continue

                name = (
                    get_col(
                        row,
                        "assetname",
                        "plant name",
                        "facility name",
                        "asset name",
                        "installation name",
                        "property name",
                        "name",
                        "utility name",
                        "street address",
                        "address",
                    )
                    or get_col(row, "state", "region", "location")
                )

                if not name or len(name.strip()) < 2:
                    continue

                value = None
                value_basis = None
                for col in [
                    "value",
                    "total",
                    "amount",
                    "cost",
                    "capacity",
                    "mw",
                    "acres",
                    "residential",
                    "commercial",
                    "nameplate capacity",
                ]:
                    v = get_col(row, col)
                    if v:
                        num = parse_number(v)
                        if num is not None and num > 0:
                            value = num
                            value_basis = col
                            break

                lat = parse_number(get_col(row, "latitude", "lat"))
                lon = parse_number(get_col(row, "longitude", "lon", "long"))
                jurisdiction = get_col(
                    row, "state", "country", "region", "county", "city"
                )
                asset_type = (
                    get_col(
                        row,
                        "sector name",
                        "type",
                        "property type",
                        "fuel type",
                        "asset type",
                    )
                    or "Asset"
                )

                alt = []
                owner = get_col(row, "utility name", "owner", "operator")
                if owner and owner != name:
                    alt.append(owner)

                atype = asset_type
                sl = sname.lower()
                if lat is not None and lon is not None and (
                    "plant" in sl
                    or "860" in base.lower()
                    or "generator" in sl
                ):
                    tech = (atype or "").lower()
                    if any(
                        k in tech
                        for k in (
                            "wind",
                            "solar",
                            "hydro",
                            "nuclear",
                            "gas",
                            "coal",
                            "oil",
                            "dam",
                            "storage",
                            "water",
                        )
                    ) or (not atype or atype == "Asset"):
                        atype = "Power Generation Asset"
                if (not atype or atype == "Asset") and owner and "utility" in sl:
                    atype = "Electric Utility"

                prof = (
                    "xlsx_with_coords"
                    if lat is not None and lon is not None
                    else "xlsx_no_coords"
                )
                sheet_assets.append(
                    make_asset(
                        name=name,
                        value=value,
                        jurisdiction=jurisdiction,
                        lat=lat,
                        lon=lon,
                        asset_type=atype,
                        value_basis=value_basis,
                        alt_names=alt,
                        evidence=[f"Sheet: {sname}, Row: {i + 1}", base],
                        explanation=f'Extracted from Excel sheet "{sname}" row {i + 1}',
                        extraction_profile=prof,
                    )
                )

            print(f'Sheet "{sname}": {len(sheet_assets)} assets', file=sys.stderr)
            assets.extend(sheet_assets)

        except Exception as e:
            print(f'Sheet "{sname}" error: {e}', file=sys.stderr)

    try:
        wb.close()
    except Exception:
        pass

    print(f"XLSX total: {len(assets)} assets ({base})", file=sys.stderr)
    return assets[:2000]


# ─── PDF ────────────────────────────────────────────────────────────────────


def _pdf_default_asset_type(kind: str) -> str:
    if kind == "ny_assessment":
        return "Real Property"
    if kind == "investor":
        return "Investment Asset"
    if kind == "regulatory":
        return "Regulatory Filing"
    return "Reported Entity"


def extract_from_pdf_tables(file_path: str) -> list:
    try:
        import pdfplumber
    except ImportError:
        print(
            "pdfplumber not installed — pip install pdfplumber",
            file=sys.stderr,
        )
        return []

    assets = []
    kind = "generic"
    base = os.path.basename(file_path)

    try:
        with pdfplumber.open(file_path) as pdf:
            total = len(pdf.pages)
            if not pdf.pages:
                return []
            sample = (pdf.pages[0].extract_text() or "")[:8000]
            kind = _detect_pdf_kind(sample)
            skip_text = kind == "regulatory"
            print(f"PDF: {total} pages kind={kind} skip_text={skip_text} ({base})", file=sys.stderr)

            for page_num, page in enumerate(pdf.pages[:80]):
                for strategy in [
                    {"vertical_strategy": "lines", "horizontal_strategy": "lines"},
                    {"vertical_strategy": "text", "horizontal_strategy": "text"},
                ]:
                    try:
                        tables = page.extract_tables(strategy) or []
                        for table in tables:
                            if not table or len(table) < 2:
                                continue

                            for row_idx, row in enumerate(table[1:], 1):
                                if not row or not any(row):
                                    continue

                                cells = [str(c).strip() if c else "" for c in row]

                                name = None
                                value = None

                                for cell in cells:
                                    if not cell:
                                        continue
                                    if name is None and len(cell) >= 8:
                                        if not re.match(
                                            r"^[\d\s$.,%()\-/]+$", cell
                                        ):
                                            name = cell[:200]
                                    if value is None:
                                        m = re.search(
                                            r"\$?\s*([\d,]+\.?\d*)\s*(B|M|K|billion|million|thousand)?",
                                            cell,
                                            re.I,
                                        )
                                        if m:
                                            try:
                                                num = float(
                                                    m.group(1).replace(",", "")
                                                )
                                                mult = {
                                                    "b": 1e9,
                                                    "billion": 1e9,
                                                    "m": 1e6,
                                                    "million": 1e6,
                                                    "k": 1e3,
                                                    "thousand": 1e3,
                                                }.get((m.group(2) or "").lower(), 1)
                                                candidate = num * mult
                                                if 1000 <= candidate <= 1e13:
                                                    value = candidate
                                            except (
                                                TypeError,
                                                ValueError,
                                                AttributeError,
                                            ):
                                                pass

                                nm = (name or "").strip()
                                if len(nm) < 12 or _is_pdf_garbage_name(nm):
                                    continue
                                if value is not None and _is_year_number(float(value)):
                                    continue
                                if kind not in ("ny_assessment",) and value is not None:
                                    if float(value) < 100_000:
                                        continue

                                assets.append(
                                    make_asset(
                                        name=nm,
                                        value=value,
                                        asset_type=_pdf_default_asset_type(kind),
                                        value_basis="Reported Value"
                                        if value
                                        else None,
                                        evidence=[
                                            f"PDF page {page_num + 1}, table row {row_idx}"
                                        ],
                                        explanation=f"Table extraction page {page_num + 1}",
                                        extraction_profile="pdf_table",
                                    )
                                )
                        if tables:
                            break
                    except Exception:
                        pass

                if skip_text:
                    continue

                try:
                    text = page.extract_text() or ""
                    lines = text.split("\n")

                    for line_idx, line in enumerate(lines):
                        line = line.strip()
                        if len(line) < 12:
                            continue

                        m = re.search(
                            r"\b(\d{1,3}(?:,\d{3})+|\d{6,})\b", line
                        )
                        if not m:
                            continue
                        try:
                            val = float(m.group(1).replace(",", ""))
                        except (TypeError, ValueError, AttributeError):
                            continue

                        if _is_year_number(val):
                            continue

                        if kind == "ny_assessment":
                            if not (5000 <= val <= 1e11):
                                continue
                        else:
                            if not (100_000 <= val <= 1e13):
                                continue

                        before = line[: m.start()].strip()
                        name_part = re.sub(r"^[\d\-/. ]+", "", before).strip()
                        if len(name_part) < 15 or _is_pdf_garbage_name(name_part):
                            continue
                        if name_part.replace(" ", "").isdigit():
                            continue

                        tprof = (
                            "pdf_text_assessment"
                            if kind == "ny_assessment"
                            else (
                                "pdf_text_investor"
                                if kind == "investor"
                                else "pdf_text_generic"
                            )
                        )
                        assets.append(
                            make_asset(
                                name=name_part[:200],
                                value=val,
                                asset_type="Real Property"
                                if kind == "ny_assessment"
                                else _pdf_default_asset_type(kind),
                                value_basis="Assessed Value"
                                if kind == "ny_assessment"
                                else "Reported Value",
                                evidence=[
                                    f"PDF page {page_num + 1}, line {line_idx + 1}"
                                ],
                                explanation=f"Text extraction page {page_num + 1}",
                                validation_flags=["text-extracted"],
                                extraction_profile=tprof,
                            )
                        )
                except Exception:
                    pass

    except Exception as e:
        print(f"PDF error: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)

    result = dedup(assets)
    hq = sum(
        1
        for a in result
        if _pdf_row_high_quality(
            kind,
            a.get("assetName") or "",
            a.get("value"),
            a.get("latitude"),
            a.get("longitude"),
        )
    )
    if kind not in ("ny_assessment", "investor") and hq < 5:
        print(
            f"PDF {base}: dropped {len(result)} rows (kind={kind}, high_quality={hq})",
            file=sys.stderr,
        )
        return []

    print(f"PDF: {len(result)} unique assets from {base} (hq={hq})", file=sys.stderr)
    return result[:500]


# ─── ZIP ────────────────────────────────────────────────────────────────────


def extract_from_zip(file_path: str) -> list:
    import tempfile
    import zipfile

    MAX_ASSETS_PER_ENTRY = 500
    MAX_TOTAL_ASSETS = 2000

    assets = []
    SUPPORTED = {".csv", ".xlsx", ".xls", ".pdf"}
    base = os.path.basename(file_path)

    try:
        with zipfile.ZipFile(file_path, "r") as zf:
            all_names = [
                n
                for n in zf.namelist()
                if not n.startswith("__MACOSX")
                and not os.path.basename(n).startswith(".")
                and os.path.splitext(n)[1].lower() in SUPPORTED
            ]

            print(f"ZIP: {len(all_names)} processable files ({base})", file=sys.stderr)

            for entry_name in all_names:
                if len(assets) >= MAX_TOTAL_ASSETS:
                    print(
                        f"ZIP cap reached: {MAX_TOTAL_ASSETS} raw rows before dedupe",
                        file=sys.stderr,
                    )
                    break

                room = max(0, MAX_TOTAL_ASSETS - len(assets))
                if room == 0:
                    break

                ext = os.path.splitext(entry_name)[1].lower()
                print(f"  Processing: {entry_name}", file=sys.stderr)

                try:
                    raw = zf.read(entry_name)
                    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                        tmp.write(raw)
                        tmp_path = tmp.name

                    try:
                        if ext == ".csv":
                            extracted = extract_from_csv(tmp_path)
                        elif ext in (".xlsx", ".xls"):
                            extracted = extract_from_xlsx(tmp_path)
                        elif ext == ".pdf":
                            extracted = extract_from_pdf_tables(tmp_path)
                        else:
                            extracted = []

                        for a in extracted:
                            a["sourceEvidence"] = [f"ZIP:{entry_name}"] + a.get(
                                "sourceEvidence", []
                            )

                        slice_take = extracted[: min(MAX_ASSETS_PER_ENTRY, room)]
                        assets.extend(slice_take)
                        print(
                            f"  -> {len(slice_take)} assets (of {len(extracted)} from entry)",
                            file=sys.stderr,
                        )
                        if len(assets) >= MAX_TOTAL_ASSETS:
                            print(
                                f"ZIP cap reached: {MAX_TOTAL_ASSETS} raw rows before dedupe",
                                file=sys.stderr,
                            )
                            break

                    finally:
                        try:
                            os.unlink(tmp_path)
                        except OSError:
                            pass

                except Exception as e:
                    print(f"  Entry {entry_name} failed: {e}", file=sys.stderr)

    except Exception as e:
        print(f"ZIP open error: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)

    result = dedup(assets)
    print(f"ZIP total: {len(result)} unique assets ({base})", file=sys.stderr)
    return result[:2000]


# ─── MAIN ───────────────────────────────────────────────────────────────────


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps([]))
        sys.exit(0)

    file_path = sys.argv[1]
    ext = os.path.splitext(file_path)[1].lower()

    if not os.path.exists(file_path):
        print(f"File not found: {file_path}", file=sys.stderr)
        print(json.dumps([]))
        sys.exit(0)

    print(f"Python: {sys.version}", file=sys.stderr)
    print(f"Path: {sys.executable}", file=sys.stderr)

    try:
        if ext == ".csv":
            assets = extract_from_csv(file_path)
        elif ext in (".xlsx", ".xls"):
            assets = extract_from_xlsx(file_path)
        elif ext == ".pdf":
            assets = extract_from_pdf_tables(file_path)
        elif ext == ".zip":
            assets = extract_from_zip(file_path)
        else:
            assets = []

        print(json.dumps(assets))

    except Exception:
        print(f"FATAL: {traceback.format_exc()}", file=sys.stderr)
        print(json.dumps([]))
