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

export type IngestionJobStatus = {
  status: 'not-found' | 'queued' | 'extracting' | 'complete' | 'error';
  assetCount: number;
  error?: string;
  message?: string;
};

export type ProcessFileResult = {
  jobId: string;
  status: 'complete' | 'processing' | 'failed';
  message?: string;
  assetCount: number;
  assets: Asset[];
  duplicatesFound: number;
};

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  private readonly jobStatus = new Map<string, IngestionJobStatus>();

  constructor(
    private readonly documentUnderstandingService: DocumentUnderstandingService,
    private readonly extractionService: ExtractionService,
    private readonly confidenceService: ConfidenceService,
    private readonly reconciliationService: ReconciliationService,
    private readonly assetsService: AssetsService,
  ) {}

  getJobStatus(jobId: string): IngestionJobStatus {
    return this.jobStatus.get(jobId) ?? { status: 'not-found', assetCount: 0 };
  }

  async processFile(file: Express.Multer.File): Promise<ProcessFileResult> {
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

    if (fileType === 'zip') {
      this.jobStatus.set(jobId, {
        status: 'extracting',
        assetCount: 0,
        message: 'ZIP extraction started',
      });
      void this.runZipPipelineInBackground(file, jobId, fileType, fileInfo).catch(
        (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`Async ZIP processing failed ${jobId}: ${msg}`);
          this.jobStatus.set(jobId, {
            status: 'error',
            assetCount: 0,
            error: msg,
          });
        },
      );

      return {
        jobId,
        status: 'processing',
        message:
          'ZIP file is being processed in the background. Poll GET /ingestion/jobs/:jobId/status for progress.',
        assetCount: 0,
        assets: [],
        duplicatesFound: 0,
      };
    }

    return this.runPipelineAndFinish(file, jobId, fileType, fileInfo);
  }

  private async runZipPipelineInBackground(
    file: Express.Multer.File,
    jobId: string,
    fileType: FileInfo['fileType'],
    fileInfo: FileInfo,
  ): Promise<void> {
    await this.runPipelineAndFinish(file, jobId, fileType, fileInfo);
    this.logger.log(`Background ZIP processing finished: ${jobId}`);
  }

  private async runPipelineAndFinish(
    file: Express.Multer.File,
    jobId: string,
    fileType: FileInfo['fileType'],
    fileInfo: FileInfo,
  ): Promise<ProcessFileResult> {
    fileInfo.status = 'processing';
    this.jobStatus.set(jobId, {
      status: 'extracting',
      assetCount: 0,
      message: 'Running document understanding and extraction',
    });

    try {
      const analysis = await this.documentUnderstandingService.analyzeFile(
        file.path,
        fileType,
      );
      const extracted = await this.extractionService.extractAssets({
        text: analysis.text,
        jobId,
        sourceFile: file.originalname,
        filePath: file.path,
        fileType,
      });

      this.jobStatus.set(jobId, {
        status: 'extracting',
        assetCount: extracted.length,
        message: 'Scoring and reconciling',
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
      this.jobStatus.set(jobId, {
        status: 'complete',
        assetCount: canonical.length,
        message: 'Processing complete',
      });

      return {
        jobId,
        status: 'complete',
        assetCount: canonical.length,
        assets: canonical,
        duplicatesFound,
      };
    } catch (err: unknown) {
      fileInfo.status = 'failed';
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Pipeline failed for job ${jobId}: ${msg}`);
      this.jobStatus.set(jobId, {
        status: 'error',
        assetCount: 0,
        error: msg,
      });
      return {
        jobId,
        status: 'failed',
        message: msg,
        assetCount: 0,
        assets: [],
        duplicatesFound: 0,
      };
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
