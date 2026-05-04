import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as xlsx from 'xlsx';

@Injectable()
export class DocumentUnderstandingService {
  private readonly logger = new Logger(DocumentUnderstandingService.name);

  async analyzeFile(filePath: string, fileType: string): Promise<{
    text: string; needsOcr: boolean; pageCount: number; hasTable: boolean; rawText: string;
  }> {
    try {
      const normalized = fileType.toLowerCase();
      if (normalized === 'pdf') return await this.analyzePdf(filePath);
      if (['xlsx', 'xls', 'csv'].includes(normalized)) return await this.analyzeSpreadsheet(filePath);
      if (normalized === 'zip') {
        return { text: '', rawText: '', needsOcr: false, pageCount: 0, hasTable: true };
      }
      const raw = await fs.promises.readFile(filePath, 'utf8').catch(() => '');
      return { text: raw, rawText: raw, needsOcr: false, pageCount: 1, hasTable: false };
    } catch (err: any) {
      this.logger.error(`analyzeFile failed: ${err?.message ?? err}`);
      return { text: '', rawText: '', needsOcr: false, pageCount: 0, hasTable: false };
    }
  }

  private async analyzePdf(filePath: string): Promise<{
    text: string; needsOcr: boolean; pageCount: number; hasTable: boolean; rawText: string;
  }> {
    try {
      const buffer = await fs.promises.readFile(filePath);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('pdf-parse');
      const pdfParse =
        typeof mod === 'function' ? mod
        : typeof mod.default === 'function' ? mod.default
        : null;
      if (!pdfParse) throw new Error('pdf-parse did not export a function');
      const parsed = await pdfParse(buffer);
      const rawText = (parsed?.text ?? '').toString();
      return {
        text: rawText, rawText,
        needsOcr: rawText.trim().length < 100,
        pageCount: parsed?.numpages ?? 0,
        hasTable: rawText.includes('\t'),
      };
    } catch (err: any) {
      this.logger.error(`analyzePdf failed: ${err?.message ?? err}`);
      return { text: '', rawText: '', needsOcr: true, pageCount: 0, hasTable: false };
    }
  }

  private async analyzeSpreadsheet(filePath: string): Promise<{
    text: string; needsOcr: boolean; pageCount: number; hasTable: boolean; rawText: string;
  }> {
    try {
      const workbook = xlsx.readFile(filePath);
      let text = '';
      for (const sheetName of workbook.SheetNames) {
        text += `SHEET: ${sheetName}\n`;
        text += xlsx.utils.sheet_to_csv(workbook.Sheets[sheetName]);
        text += '\n\n';
      }
      return { text, rawText: text, needsOcr: false, pageCount: workbook.SheetNames.length, hasTable: true };
    } catch (err: any) {
      this.logger.error(`analyzeSpreadsheet failed: ${err?.message ?? err}`);
      return { text: '', rawText: '', needsOcr: false, pageCount: 0, hasTable: false };
    }
  }
}