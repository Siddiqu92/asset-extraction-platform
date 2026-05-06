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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AiModule,
    ValidationModule,
    InferenceModule,
    IngestionModule,
    DocumentUnderstandingModule,
    ExtractionModule,
    ReconciliationModule,
    ConfidenceModule,
    AssetsModule,
  ],
})
export class AppModule {}