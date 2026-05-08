// ============================================================
// FILE: backend/src/app.module.ts  (REPLACE existing file)
// FIX: OcrModule add kiya
// ============================================================
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IngestionModule } from './ingestion/ingestion.module';
import { DocumentUnderstandingModule } from './document-understanding/document-understanding.module';
import { ExtractionModule } from './extraction/extraction.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { ConfidenceModule } from './confidence/confidence.module';
import { AssetsModule } from './assets/assets.module';
import { AiModule } from './ai/ai.module';
import { ValidationModule } from './validation/validation.module';
import { InferenceModule } from './inference/inference.module';
import { OcrModule } from './ocr/ocr.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AiModule,
    ValidationModule,
    InferenceModule,
    OcrModule,
    IngestionModule,
    DocumentUnderstandingModule,
    ExtractionModule,
    ReconciliationModule,
    ConfidenceModule,
    AssetsModule,
  ],
})
export class AppModule {}
