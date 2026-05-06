import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import AdmZip from 'adm-zip';

const execFileAsync = promisify(execFile);

@Injectable()
export class ZipIngestionService {
  private readonly logger = new Logger(ZipIngestionService.name);
  private readonly allowedExt = new Set(['.csv', '.xlsx', '.xls', '.pdf', '.geojson']);

  async extractAndProcess(filePath: string, jobId: string): Promise<string[]> {
    const ext = path.extname(filePath).toLowerCase();
    
    if (ext === '.xz' || ext === '.txz') {
      return this.extractXz(filePath, jobId);
    }
    
    return this.extractZip(filePath, jobId);
  }

  private async extractZip(zipPath: string, jobId: string): Promise<string[]> {
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

  private async extractXz(xzPath: string, jobId: string): Promise<string[]> {
    const tempDir = path.join(process.cwd(), 'uploads', 'unzipped');
    const outRoot = path.join(tempDir, jobId);
    await fs.promises.mkdir(outRoot, { recursive: true });

    try {
      // Use tar command to extract .xz files
      await execFileAsync('tar', ['-xJf', xzPath, '-C', outRoot], { 
        timeout: 300_000,
      });

      const extractedPaths: string[] = [];
      
      // Walk through extracted files
      const walkDir = (dir: string) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            walkDir(fullPath);
          } else {
            const ext = path.extname(fullPath).toLowerCase();
            if (this.allowedExt.has(ext)) {
              extractedPaths.push(fullPath);
            }
          }
        }
      };
      
      walkDir(outRoot);
      this.logger.log(`XZ extracted ${extractedPaths.length} supported files for ${jobId}`);
      return extractedPaths;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`XZ extraction failed: ${msg}`);
      throw err;
    }
  }
}

