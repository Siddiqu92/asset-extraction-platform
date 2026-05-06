import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { diskStorage } from 'multer';
import * as path from 'path';
import { DocumentUnderstandingModule } from '../document-understanding/document-understanding.module';
import { ExtractionModule } from '../extraction/extraction.module';
import { ConfidenceModule } from '../confidence/confidence.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { AssetsModule } from '../assets/assets.module';
import { ZipIngestionService } from './zip-ingestion.service';
import { CountyGeocodingService } from './county-geocoding.service';

@Module({
  imports: [
    MulterModule.register({
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, uniqueSuffix + path.extname(file.originalname));
        },
      }),
      fileFilter: (req, file, cb) => {
        const allowed = ['.pdf', '.xlsx', '.xls', '.csv', '.zip'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) {
          cb(null, true);
        } else {
          cb(
            new Error('Only PDF, Excel (.xlsx/.xls), CSV, and ZIP uploads are supported'),
            false,
          );
        }
      },
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
    DocumentUnderstandingModule,
    ExtractionModule,
    ConfidenceModule,
    ReconciliationModule,
    AssetsModule,
  ],
  controllers: [IngestionController],
  providers: [IngestionService, ZipIngestionService, CountyGeocodingService],
  exports: [IngestionService],
})
export class IngestionModule {}