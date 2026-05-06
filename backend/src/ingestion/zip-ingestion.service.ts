import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import AdmZip from 'adm-zip';

@Injectable()
export class ZipIngestionService {
  private readonly logger = new Logger(ZipIngestionService.name);
  private readonly allowedExt = new Set(['.csv', '.xlsx', '.xls', '.pdf', '.geojson']);

  async extractAndProcess(zipPath: string, jobId: string): Promise<string[]> {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    const extractedPaths: string[] = [];
    const tempDir = path.join(process.cwd(), 'uploads', 'unzipped');
    const outRoot = path.join(tempDir, jobId);
    await fs.promises.mkdir(outRoot, { recursive: true });

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const ext = path.extname(entry.entryName).toLowerCase();
      if (!this.allowedExt.has(ext)) continue;
      const outPath = path.join(outRoot, entry.entryName);
      await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
      zip.extractEntryTo(entry, path.dirname(outPath), false, true);
      extractedPaths.push(outPath);
    }

    this.logger.log(`ZIP extracted ${extractedPaths.length} supported files for ${jobId}`);
    return extractedPaths;
  }
}

