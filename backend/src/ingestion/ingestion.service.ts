import { Injectable, Logger } from '@nestjs/common';
import { extname } from 'path';
import { DocumentUnderstandingService } from '../document-understanding/document-understanding.service';
import { ExtractionService } from '../extraction/extraction.service';
import { ConfidenceService } from '../confidence/confidence.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { AssetsService } from '../assets/assets.service';
import { Asset } from '../assets/asset.entity';

export interface FileInfo {
  jobId: string;
  originalName: string;
  fileName: string;
  filePath: string;
  fileType: 'pdf' | 'xlsx' | 'xls' | 'csv' | 'zip' | 'unknown';
  fileSize: number;
  status: 'uploaded' | 'processing' | 'done' | 'failed';
  uploadedAt: Date;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly documentUnderstandingService: DocumentUnderstandingService,
    private readonly extractionService: ExtractionService,
    private readonly confidenceService: ConfidenceService,
    private readonly reconciliationService: ReconciliationService,
    private readonly assetsService: AssetsService,
  ) {}

  async processFile(file: Express.Multer.File): Promise<{
    jobId: string;
    assetCount: number;
    assets: Asset[];
    duplicatesFound: number;
  }> {
    const jobId = file.filename.split('.')[0];
    const ext = extname(file.originalname).toLowerCase().replace('.', '');
    const fileType = this.detectFileType(ext);

    const fileInfo: FileInfo = {
      jobId,
      originalName: file.originalname,
      fileName: file.filename,
      filePath: file.path,
      fileType,
      fileSize: file.size,
      status: 'uploaded',
      uploadedAt: new Date(),
    };

    this.logger.log(`File uploaded: ${file.originalname} | Type: ${fileType} | jobId: ${jobId}`);

    try {
      fileInfo.status = 'processing';

      const analysis = await this.documentUnderstandingService.analyzeFile(file.path, fileType);
      const extracted = await this.extractionService.extractAssets({
        text: analysis.text,
        jobId,
        sourceFile: file.originalname,
        filePath: file.path,
        fileType,
      });

      const rescored = extracted.map((a) => this.confidenceService.scoreAsset(a));
      const reconciled = this.reconciliationService.reconcile(rescored);
      const canonical = reconciled.canonical;

      this.assetsService.saveAssets(canonical);

      const duplicatesFound = Object.values(reconciled.duplicateClusters).reduce(
        (sum, ids) => sum + Math.max(0, ids.length - 1),
        0,
      );

      fileInfo.status = 'done';
      return {
        jobId,
        assetCount: canonical.length,
        assets: canonical,
        duplicatesFound,
      };
    } catch (err: any) {
      fileInfo.status = 'failed';
      this.logger.error(`Pipeline failed for job ${jobId}: ${err?.message ?? err}`);
      return { jobId, assetCount: 0, assets: [], duplicatesFound: 0 };
    }
  }

  private detectFileType(ext: string): 'pdf' | 'xlsx' | 'xls' | 'csv' | 'zip' | 'unknown' {
    if (ext === 'pdf') return 'pdf';
    if (ext === 'xlsx') return 'xlsx';
    if (ext === 'xls') return 'xls';
    if (ext === 'csv') return 'csv';
    if (ext === 'zip') return 'zip';
    return 'unknown';
  }
}