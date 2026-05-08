#!/usr/bin/env python3
# FILE: backend/src/scripts/ocr_pdf.py
# FIX: Scanned PDF OCR using Tesseract + pdf2image
# Install: pip install pytesseract pdf2image pillow pdfplumber
# Also install: tesseract-ocr (system package)
#   Windows: https://github.com/UB-Mannheim/tesseract/wiki
#   Linux: sudo apt install tesseract-ocr
#   Mac: brew install tesseract

import sys
import json
import os

def extract_with_pdfplumber(file_path):
    """Try native text extraction first (fast, accurate for digital PDFs)."""
    try:
        import pdfplumber
        text_parts = []
        with pdfplumber.open(file_path) as pdf:
            page_count = len(pdf.pages)
            for page in pdf.pages[:50]:
                t = page.extract_text() or ""
                text_parts.append(t)
            full_text = "\n".join(text_parts)
            chars_per_page = len(full_text) / max(page_count, 1)
            return full_text, page_count, chars_per_page
    except Exception as e:
        print(f"pdfplumber error: {e}", file=sys.stderr)
        return "", 0, 0


def extract_with_tesseract(file_path):
    """Fallback: convert PDF pages to images, run Tesseract OCR."""
    try:
        from pdf2image import convert_from_path
        import pytesseract
        from PIL import Image

        # Convert up to 30 pages to avoid memory issues
        images = convert_from_path(file_path, dpi=200, last_page=30)
        text_parts = []
        for img in images:
            t = pytesseract.image_to_string(img, lang='eng')
            text_parts.append(t)

        full_text = "\n".join(text_parts)
        return full_text, len(images)
    except ImportError as e:
        print(f"OCR deps missing: {e}", file=sys.stderr)
        print("Install: pip install pdf2image pytesseract pillow", file=sys.stderr)
        return "", 0
    except Exception as e:
        print(f"Tesseract error: {e}", file=sys.stderr)
        return "", 0


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"text": "", "pageCount": 0, "confidence": 0, "method": "none"}))
        sys.exit(0)

    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        print(json.dumps({"text": "", "pageCount": 0, "confidence": 0, "method": "none"}))
        sys.exit(0)

    # Step 1: Try native extraction
    native_text, page_count, chars_per_page = extract_with_pdfplumber(file_path)

    # If enough text found natively, return it (digital PDF)
    if chars_per_page >= 100:
        result = {
            "text": native_text[:500_000],  # cap at 500KB
            "pageCount": page_count,
            "confidence": 0.9,
            "method": "pdfplumber"
        }
        print(json.dumps(result))
        return

    # Step 2: Scanned PDF — use Tesseract
    print(f"Low text density ({chars_per_page:.0f} chars/page) — using Tesseract OCR", file=sys.stderr)
    ocr_text, ocr_pages = extract_with_tesseract(file_path)

    if not ocr_text.strip():
        result = {
            "text": native_text,
            "pageCount": page_count or ocr_pages,
            "confidence": 0.3,
            "method": "none"
        }
    else:
        result = {
            "text": ocr_text[:500_000],
            "pageCount": ocr_pages or page_count,
            "confidence": 0.7,
            "method": "tesseract"
        }

    print(json.dumps(result))


if __name__ == "__main__":
    main()
