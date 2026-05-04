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


def extract_from_pdf_tables(file_path: str) -> list:
    try:
        import pdfplumber
    except ImportError:
        return []

    assets = []
    financial_keywords = [
        "asset",
        "property",
        "portfolio",
        "investment",
        "value",
        "noi",
        "million",
        "billion",
        "usd",
        "cad",
        "gbp",
        "eur",
        "building",
        "land",
        "real estate",
        "fund",
        "equity",
        "loan",
        "mortgage",
        "acquisition",
        "market value",
        "fair value",
        "assessed",
        "carrying value",
    ]

    try:
        with pdfplumber.open(file_path) as pdf:
            for page_num, page in enumerate(pdf.pages[:50]):
                tables = page.extract_tables()
                for table in tables or []:
                    if not table or len(table) < 2:
                        continue

                    flat = " ".join(
                        str(c).lower() for row in table for c in (row or []) if c
                    )
                    if not any(kw in flat for kw in financial_keywords):
                        continue

                    header_row = table[0] or []
                    headers = [str(c).strip().lower() if c else "" for c in header_row]

                    for row in table[1:]:
                        if not row or not any(row):
                            continue

                        name = None
                        value = None
                        jurisdiction = None

                        for j, cell in enumerate(row):
                            if not cell or not str(cell).strip():
                                continue
                            cell_str = str(cell).strip()

                            if name is None and len(cell_str) > 2:
                                if not re.match(r"^[\d\s$.,%()]+$", cell_str):
                                    name = cell_str[:200]

                            if value is None:
                                money = re.search(
                                    r"\$?([\d,]+\.?\d*)\s*(B|M|K|billion|million|thousand)?",
                                    cell_str,
                                )
                                if money:
                                    try:
                                        num = float(money.group(1).replace(",", ""))
                                        multiplier = {
                                            "B": 1e9,
                                            "billion": 1e9,
                                            "M": 1e6,
                                            "million": 1e6,
                                            "K": 1e3,
                                            "thousand": 1e3,
                                        }.get(money.group(2), 1)
                                        value = num * multiplier
                                    except (TypeError, ValueError, AttributeError):
                                        pass

                        if name and len(name) > 2:
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
                                    "valueBasis": "Market Value",
                                    "parentAssetId": None,
                                    "childAssetIds": [],
                                    "fieldConfidence": {
                                        "assetName": 0.85,
                                        "value": 0.75 if value else 0.0,
                                    },
                                    "overallConfidence": 0.75 if value else 0.55,
                                    "sourceEvidence": [f"Page {page_num+1} table in PDF"],
                                    "explanation": f"Extracted from table on page {page_num+1}",
                                    "validationFlags": [],
                                    "duplicateClusterId": None,
                                    "reviewRecommendation": "review",
                                    "factType": {
                                        "assetName": "extracted",
                                        "value": "extracted" if value else "unsupported",
                                    },
                                }
                            )

                if not tables:
                    text = page.extract_text() or ""
                    lines = text.split("\n")
                    for line in lines:
                        if any(kw in line.lower() for kw in financial_keywords):
                            money_match = re.search(
                                r"([A-Za-z][A-Za-z\s,\.]{5,50})\s*[\$]?\s*([\d,]+\.?\d*)\s*(B|M|K|billion|million|thousand)?",
                                line,
                            )
                            if money_match:
                                nm = money_match.group(1).strip()
                                if len(nm) > 3 and not nm.replace(" ", "").isdigit():
                                    try:
                                        num = float(money_match.group(2).replace(",", ""))
                                        mult = {
                                            "B": 1e9,
                                            "billion": 1e9,
                                            "M": 1e6,
                                            "million": 1e6,
                                            "K": 1e3,
                                            "thousand": 1e3,
                                        }.get(money_match.group(3), 1)
                                        val = num * mult
                                        assets.append(
                                            {
                                                "assetName": nm[:200],
                                                "alternateName": [],
                                                "value": val,
                                                "currency": "USD",
                                                "jurisdiction": None,
                                                "latitude": None,
                                                "longitude": None,
                                                "assetType": "Financial Asset",
                                                "valueBasis": "Reported Value",
                                                "parentAssetId": None,
                                                "childAssetIds": [],
                                                "fieldConfidence": {
                                                    "assetName": 0.7,
                                                    "value": 0.65,
                                                },
                                                "overallConfidence": 0.65,
                                                "sourceEvidence": [f"Page {page_num+1} text"],
                                                "explanation": f"Extracted from narrative on page {page_num+1}",
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
        print(f"PDF extraction error: {e}", file=sys.stderr)

    seen = set()
    unique = []
    for a in assets:
        key = a["assetName"].lower().strip()
        if key not in seen and len(key) > 2:
            seen.add(key)
            unique.append(a)

    return unique


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
        else:
            assets = []

        print(json.dumps(assets[:200]))
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        print(json.dumps([]))
