// ============================================================
// FILE: backend/src/ocr/ocr.service.ts
// FIX: Scanned PDF support — Tesseract via Python
// ============================================================
import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface OcrResult {
  text: string;
  pageCount: number;
  confidence: number;
  method: 'pdfplumber' | 'tesseract' | 'none';
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private readonly scriptPath = path.resolve(
    process.cwd(),
    'dist/scripts/ocr_pdf.py',
  );

  async extractTextFromPdf(filePath: string): Promise<OcrResult> {
    return new Promise((resolve) => {
      const python = process.platform === 'win32' ? 'python' : 'python3';
      const args = [this.scriptPath, filePath];

      const proc = spawn(python, args, { timeout: 120_000 });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => (stdout += d.toString()));
      proc.stderr.on('data', (d) => (stderr += d.toString()));

      proc.on('close', (code) => {
        if (code !== 0) {
          this.logger.warn(`OCR script exited ${code}: ${stderr.slice(0, 300)}`);
          resolve({ text: '', pageCount: 0, confidence: 0, method: 'none' });
          return;
        }
        try {
          const result = JSON.parse(stdout);
          resolve(result as OcrResult);
        } catch {
          this.logger.warn('OCR script returned invalid JSON');
          resolve({ text: stdout, pageCount: 1, confidence: 0.4, method: 'none' });
        }
      });

      proc.on('error', (err) => {
        this.logger.error(`OCR process error: ${err.message}`);
        resolve({ text: '', pageCount: 0, confidence: 0, method: 'none' });
      });
    });
  }

  isScannedPdf(pdfText: string, pageCount: number): boolean {
    if (!pdfText || pdfText.trim().length === 0) return true;
    const charsPerPage = pdfText.length / Math.max(pageCount, 1);
    return charsPerPage < 100; // less than 100 chars/page = likely scanned
  }
}
