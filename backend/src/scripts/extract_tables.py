#!/usr/bin/env python3
"""
Rule-based asset extractor for PDFs, Excel, and CSV files.
Called by NestJS ExtractionService. Outputs JSON array of asset-like dicts.
"""
import csv
import json
import os
import re
import sys


def extract_from_csv(file_path: str) -> list:
    assets = []
    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            if i > 500:
                break
            name = (
                row.get("Asset Name")
                or row.get("Installation Name")
                or row.get("Bldg Address1")
                or row.get("Property Name")
                or row.get("PARID")
                or row.get("Name")
                or f"Row {i+1}"
            )

            value_str = (
                row.get("Value")
                or row.get("Assessment")
                or row.get("TOTAL_VALUE")
                or row.get("Assessed Value")
                or row.get("Total Acres")
                or row.get("Bldg ANSI Usable")
                or ""
            )

            value = None
            if value_str:
                cleaned = re.sub(r"[$,\s]", "", str(value_str))
                try:
                    value = float(cleaned)
                except ValueError:
                    value = None

            lat = None
            lon = None
            for lat_key in ["Latitude", "LAT", "lat", "latitude"]:
                if lat_key in row and row[lat_key]:
                    try:
                        lat = float(row[lat_key])
                    except (TypeError, ValueError):
                        pass
            for lon_key in ["Longitude", "LON", "lon", "longitude", "LONG"]:
                if lon_key in row and row[lon_key]:
                    try:
                        lon = float(row[lon_key])
                    except (TypeError, ValueError):
                        pass

            state = (
                row.get("Bldg State")
                or row.get("State")
                or row.get("STATECODE")
                or row.get("County")
                or ""
            )

            asset_type = (
                row.get("Property Type")
                or row.get("Asset Type")
                or row.get("PROPTYPE")
                or "Real Estate"
            )

            if name and str(name).strip():
                assets.append(
                    {
                        "assetName": str(name).strip()[:200],
                        "alternateName": [],
                        "value": value,
                        "currency": "USD",
                        "jurisdiction": str(state).strip() if state else None,
                        "latitude": lat,
                        "longitude": lon,
                        "assetType": str(asset_type).strip() if asset_type else "Real Estate",
                        "valueBasis": "Assessed Value",
                        "parentAssetId": None,
                        "childAssetIds": [],
                        "fieldConfidence": {
                            "assetName": 0.95,
                            "value": 0.85 if value else 0.0,
                            "jurisdiction": 0.8 if state else 0.0,
                            "coordinates": 0.9 if (lat and lon) else 0.0,
                        },
                        "overallConfidence": 0.85 if value else 0.65,
                        "sourceEvidence": [f"Row {i+1} from CSV file"],
                        "explanation": f"Extracted from CSV row {i+1}",
                        "validationFlags": [],
                        "duplicateClusterId": None,
                        "reviewRecommendation": "auto-accept" if value else "review",
                        "factType": {
                            "assetName": "extracted",
                            "value": "extracted" if value else "unsupported",
                            "jurisdiction": "extracted" if state else "inferred",
                        },
                    }
                )
    return assets


def extract_from_xlsx(file_path: str) -> list:
    import openpyxl

    assets = []
    wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue

        header_row_idx = 0
        headers = []
        for i, row in enumerate(rows[:10]):
            row_strs = [str(c).lower().strip() if c else "" for c in row]
            if any(
                kw in " ".join(row_strs)
                for kw in [
                    "name",
                    "value",
                    "asset",
                    "address",
                    "property",
                    "installation",
                ]
            ):
                headers = [str(c).strip() if c else f"col_{j}" for j, c in enumerate(row)]
                header_row_idx = i
                break

        if not headers:
            headers = [f"col_{j}" for j in range(len(rows[0]) if rows else 0)]

        for i, row in enumerate(rows[header_row_idx + 1 :], start=header_row_idx + 1):
            if i > 1000:
                break
            if not row or not any(row):
                continue

            row_dict = {}
            for j, val in enumerate(row):
                if j < len(headers):
                    row_dict[headers[j]] = val

            name = None
            for key in [
                "Installation Name",
                "Asset Name",
                "Property Name",
                "Name",
                "Address",
            ]:
                for k, v in row_dict.items():
                    if key.lower() in k.lower() and v:
                        name = str(v).strip()
                        break
                if name:
                    break

            if not name:
                first_val = next(
                    (str(v).strip() for v in row if v and str(v).strip()), None
                )
                if first_val and len(first_val) > 2:
                    name = first_val[:200]

            if not name:
                continue

            value = None
            for k, v in row_dict.items():
                if any(
                    kw in k.lower() for kw in ["value", "cost", "amount", "acres", "sqft", "area"]
                ):
                    if v is not None:
                        try:
                            cleaned = re.sub(r"[$,\s]", "", str(v))
                            value = float(cleaned)
                            break
                        except ValueError:
                            pass

            jurisdiction = None
            for k, v in row_dict.items():
                if any(
                    kw in k.lower()
                    for kw in ["state", "country", "jurisdiction", "region", "agency"]
                ):
                    if v:
                        jurisdiction = str(v).strip()
                        break

            assets.append(
                {
                    "assetName": name,
                    "alternateName": [],
                    "value": value,
                    "currency": "USD",
                    "jurisdiction": jurisdiction,
                    "latitude": None,
                    "longitude": None,
                    "assetType": "Real Estate",
                    "valueBasis": "Book Value",
                    "parentAssetId": None,
                    "childAssetIds": [],
                    "fieldConfidence": {
                        "assetName": 0.9,
                        "value": 0.8 if value else 0.0,
                        "jurisdiction": 0.75 if jurisdiction else 0.0,
                    },
                    "overallConfidence": 0.80 if value else 0.60,
                    "sourceEvidence": [f"Sheet: {sheet_name}, Row: {i+1}"],
                    "explanation": f'Extracted from Excel sheet "{sheet_name}" row {i+1}',
                    "validationFlags": [],
                    "duplicateClusterId": None,
                    "reviewRecommendation": "auto-accept" if value else "review",
                    "factType": {
                        "assetName": "extracted",
                        "value": "extracted" if value else "unsupported",
                        "jurisdiction": "extracted" if jurisdiction else "inferred",
                    },
                }
            )
    return assets


def extract_from_zip(file_path: str) -> list:
    """Extract assets from all supported files inside a ZIP archive."""
    import tempfile
    import zipfile

    assets = []
    try:
        with zipfile.ZipFile(file_path, "r") as zf:
            for name in zf.namelist():
                if name.endswith("/") or "__MACOSX" in name or name.startswith("."):
                    continue
                ext = os.path.splitext(name)[1].lower()
                if ext not in [".pdf", ".csv", ".xlsx", ".xls"]:
                    continue

                with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                    tmp.write(zf.read(name))
                    tmp_path = tmp.name

                try:
                    print(f"Processing ZIP entry: {name}", file=sys.stderr)
                    if ext == ".csv":
                        extracted = extract_from_csv(tmp_path)
                    elif ext in [".xlsx", ".xls"]:
                        extracted = extract_from_xlsx(tmp_path)
                    elif ext == ".pdf":
                        extracted = extract_from_pdf_tables(tmp_path)
                    else:
                        extracted = []

                    for a in extracted:
                        ev = a.get("sourceEvidence") or []
                        a["sourceEvidence"] = [f"ZIP entry: {name}"] + list(ev)

                    assets.extend(extracted)
                    print(f"ZIP entry {name}: {len(extracted)} assets", file=sys.stderr)
                except Exception as e:
                    print(f"ZIP entry {name} failed: {e}", file=sys.stderr)
                finally:
                    try:
                        os.unlink(tmp_path)
                    except OSError:
                        pass
    except Exception as e:
        print(f"ZIP open failed: {e}", file=sys.stderr)

    return assets[:4000]


def extract_from_pdf_tables(file_path: str) -> list:
    try:
        import pdfplumber
    except ImportError:
        print("pdfplumber not installed", file=sys.stderr)
        return []

    assets = []

    try:
        with pdfplumber.open(file_path) as pdf:
            total_pages = len(pdf.pages)
            print(f"PDF has {total_pages} pages", file=sys.stderr)

            for page_num, page in enumerate(pdf.pages[:60]):
                try:
                    tables = page.extract_tables(
                        {
                            "vertical_strategy": "lines",
                            "horizontal_strategy": "lines",
                        }
                    ) or []

                    if not tables:
                        tables = page.extract_tables(
                            {
                                "vertical_strategy": "text",
                                "horizontal_strategy": "text",
                            }
                        ) or []

                    for table in tables:
                        if not table or len(table) < 2:
                            continue

                        for row_idx, row in enumerate(table[1:], 1):
                            if not row or not any(c for c in row if c):
                                continue

                            cells = [str(c).strip() if c else "" for c in row]

                            name = None
                            value = None
                            jurisdiction = None

                            for j, cell in enumerate(cells):
                                if not cell:
                                    continue

                                if name is None and len(cell) > 2:
                                    if not re.match(r"^[\d\s$.,%()\-/]+$", cell):
                                        name = cell[:200]

                                if value is None:
                                    m = re.search(
                                        r"\$?\s*([\d,]+\.?\d*)\s*(B|M|K|billion|million|thousand)?",
                                        cell,
                                    )
                                    if m:
                                        try:
                                            num = float(m.group(1).replace(",", ""))
                                            mult = {
                                                "B": 1e9,
                                                "billion": 1e9,
                                                "M": 1e6,
                                                "million": 1e6,
                                                "K": 1e3,
                                                "thousand": 1e3,
                                            }.get(m.group(2) or "", 1)
                                            candidate = num * mult
                                            # Typical assessed values; skip tiny integers (parcel fragments)
                                            if 1000 <= candidate <= 1e13:
                                                value = candidate
                                        except (TypeError, ValueError, AttributeError):
                                            pass

                            if name and len(name.strip()) > 2:
                                confidence = 0.80 if value else 0.60
                                assets.append(
                                    {
                                        "assetName": name,
                                        "alternateName": [],
                                        "value": value,
                                        "currency": "USD",
                                        "jurisdiction": jurisdiction,
                                        "latitude": None,
                                        "longitude": None,
                                        "assetType": "Investment Asset",
                                        "valueBasis": "Reported Value" if value else None,
                                        "parentAssetId": None,
                                        "childAssetIds": [],
                                        "fieldConfidence": {
                                            "assetName": 0.85,
                                            "value": 0.80 if value else 0.0,
                                        },
                                        "overallConfidence": confidence,
                                        "sourceEvidence": [
                                            f"Page {page_num + 1}, table row {row_idx}"
                                        ],
                                        "explanation": f"Extracted from table on PDF page {page_num + 1}",
                                        "validationFlags": [],
                                        "duplicateClusterId": None,
                                        "reviewRecommendation": "review",
                                        "factType": {
                                            "assetName": "extracted",
                                            "value": "extracted" if value else "unsupported",
                                        },
                                    }
                                )
                except Exception as e:
                    print(f"Table extraction page {page_num + 1}: {e}", file=sys.stderr)

                try:
                    text = page.extract_text() or ""
                    if not text.strip():
                        continue

                    lines = text.split("\n")

                    for line_idx, line in enumerate(lines):
                        line = line.strip()
                        if len(line) < 5:
                            continue

                        value_match = re.search(
                            r"\b(\d{1,3}(?:,\d{3})+|\d{4,})\b", line
                        )

                        if value_match:
                            try:
                                val = float(value_match.group(1).replace(",", ""))
                                if 1000 <= val <= 1e10:
                                    before = line[: value_match.start()].strip()
                                    name_parts = re.sub(
                                        r"^[\d\-/.]+\s*", "", before
                                    ).strip()

                                    if len(name_parts) > 3 and not name_parts.replace(
                                        " ", ""
                                    ).isdigit():
                                        assets.append(
                                            {
                                                "assetName": name_parts[:200],
                                                "alternateName": [],
                                                "value": val,
                                                "currency": "USD",
                                                "jurisdiction": None,
                                                "latitude": None,
                                                "longitude": None,
                                                "assetType": "Real Property",
                                                "valueBasis": "Assessed Value",
                                                "parentAssetId": None,
                                                "childAssetIds": [],
                                                "fieldConfidence": {
                                                    "assetName": 0.70,
                                                    "value": 0.75,
                                                },
                                                "overallConfidence": 0.70,
                                                "sourceEvidence": [
                                                    f"Page {page_num + 1}, line {line_idx + 1}"
                                                ],
                                                "explanation": f"Extracted from text line on page {page_num + 1}",
                                                "validationFlags": ["text-extracted"],
                                                "duplicateClusterId": None,
                                                "reviewRecommendation": "review",
                                                "factType": {
                                                    "assetName": "extracted",
                                                    "value": "extracted",
                                                },
                                            }
                                        )
                            except (TypeError, ValueError, AttributeError):
                                pass
                except Exception as e:
                    print(f"Text extraction page {page_num + 1}: {e}", file=sys.stderr)

    except Exception as e:
        print(f"PDF open failed: {e}", file=sys.stderr)
        import traceback

        traceback.print_exc(file=sys.stderr)

    seen = set()
    unique = []
    for a in assets:
        key = a["assetName"].lower().strip()[:100]
        if key not in seen and len(key) > 2:
            seen.add(key)
            unique.append(a)

    print(f"PDF extraction complete: {len(unique)} unique assets", file=sys.stderr)
    return unique[:3000]


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps([]))
        sys.exit(0)

    file_path = sys.argv[1]
    ext = os.path.splitext(file_path)[1].lower()

    try:
        if ext == ".csv":
            assets = extract_from_csv(file_path)
        elif ext in [".xlsx", ".xls"]:
            assets = extract_from_xlsx(file_path)
        elif ext == ".pdf":
            assets = extract_from_pdf_tables(file_path)
        elif ext == ".zip":
            assets = extract_from_zip(file_path)
        else:
            assets = []

        print(json.dumps(assets[:2500]))
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        print(json.dumps([]))
