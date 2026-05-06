import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { extname } from 'path';
import * as path from 'path';
import * as fs from 'fs';
import { DocumentUnderstandingService } from '../document-understanding/document-understanding.service';
import { ExtractionService } from '../extraction/extraction.service';
import { ConfidenceService } from '../confidence/confidence.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { AssetsService } from '../assets/assets.service';
import { Asset } from '../assets/asset.entity';
import { ZipIngestionService } from './zip-ingestion.service';
import { CountyGeocodingService } from './county-geocoding.service';
import { detectDatasetType } from './dataset-type.util';

export interface FileInfo {
  jobId: string;
  originalName: string;
  fileName: string;
  filePath: string;
  fileType: 'pdf' | 'xlsx' | 'xls' | 'csv' | 'zip' | 'xz' | 'unknown';
  fileSize: number;
  status: 'uploaded' | 'processing' | 'done' | 'failed';
  uploadedAt: Date;
  datasetType?: string;
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
export class IngestionService implements OnModuleInit {
  private readonly logger = new Logger(IngestionService.name);
  private readonly jobStatus = new Map<string, IngestionJobStatus>();

  constructor(
    private readonly documentUnderstandingService: DocumentUnderstandingService,
    private readonly extractionService: ExtractionService,
    private readonly confidenceService: ConfidenceService,
    private readonly reconciliationService: ReconciliationService,
    private readonly assetsService: AssetsService,
    private readonly zipIngestionService: ZipIngestionService,
    private readonly countyGeocodingService: CountyGeocodingService,
  ) {}

  async onModuleInit(): Promise<void> {
    const candidates = [
      path.join(process.cwd(), 'vcerare-county-lat-long-fips.csv'),
      path.join(process.cwd(), '..', 'vcerare-county-lat-long-fips.csv'),
      path.join(process.cwd(), '..', '..', 'vcerare-county-lat-long-fips.csv'),
    ];
    const existing = candidates.find((p) => fs.existsSync(p));
    if (existing) {
      await this.countyGeocodingService.loadCountyData(existing);
    } else {
      this.logger.warn('County geocoding reference CSV not found at startup');
    }
  }

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
      datasetType: detectDatasetType(file.originalname),
    };

    this.logger.log(
      `File uploaded: ${file.originalname} | Type: ${fileType} | jobId: ${jobId}`,
    );

    if (fileType === 'zip' || fileType === 'xz') {
      this.jobStatus.set(jobId, {
        status: 'extracting',
        assetCount: 0,
        message:
          fileType === 'xz' ? 'XZ extraction started' : 'ZIP extraction started',
      });

      void this.runZipPipelineInBackground(file, jobId, fileInfo).catch(
        (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Async ${fileType.toUpperCase()} processing failed ${jobId}: ${msg}`,
          );
          this.jobStatus.set(jobId, { status: 'error', assetCount: 0, error: msg });
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
    fileInfo: FileInfo,
  ): Promise<void> {
    const extracted = await this.zipIngestionService.extractAndProcess(
      file.path,
      jobId,
    );

    this.jobStatus.set(jobId, {
      status: 'extracting',
      assetCount: 0,
      message: `ZIP expanded (${extracted.length} files). Processing extracts...`,
    });

    let combinedAssets: Asset[] = [];
    for (const extractedPath of extracted) {
      const child: Express.Multer.File = {
        ...file,
        originalname: path.basename(extractedPath),
        path: extractedPath,
        filename: path.basename(extractedPath),
        size: fs.statSync(extractedPath).size,
      };
      const childType = this.detectFileType(
        extname(extractedPath).toLowerCase().replace('.', ''),
      );
      const result = await this.runPipelineAndFinish(
        child,
        `${jobId}:${child.filename}`,
        childType,
        {
          ...fileInfo,
          originalName: child.originalname,
          fileName: child.filename,
          filePath: child.path,
          fileType: childType,
        },
      );
      combinedAssets = combinedAssets.concat(result.assets);
    }

    this.jobStatus.set(jobId, {
      status: 'complete',
      assetCount: combinedAssets.length,
      message: `ZIP processing complete (${extracted.length} files)`,
    });
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

      // reconcile is now async (calls InferenceService for geocoding)
      const reconciled = await this.reconciliationService.reconcile(rescored);
      const canonical = reconciled.canonical;

      this.assetsService.saveAssets(canonical, jobId);

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
      this.jobStatus.set(jobId, { status: 'error', assetCount: 0, error: msg });
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

  private detectFileType(
    ext: string,
  ): 'pdf' | 'xlsx' | 'xls' | 'csv' | 'zip' | 'xz' | 'unknown' {
    if (ext === 'pdf') return 'pdf';
    if (ext === 'xlsx') return 'xlsx';
    if (ext === 'xls') return 'xls';
    if (ext === 'csv') return 'csv';
    if (ext === 'zip') return 'zip';
    if (ext === 'xz' || ext === 'txz') return 'xz';
    return 'unknown';
  }
}