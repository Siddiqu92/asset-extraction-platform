import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IngestionModule } from './ingestion/ingestion.module';
import { DocumentUnderstandingModule } from './document-understanding/document-understanding.module';
import { ExtractionModule } from './extraction/extraction.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { ConfidenceModule } from './confidence/confidence.module';
import { AssetsModule } from './assets/assets.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    IngestionModule,
    DocumentUnderstandingModule,
    ExtractionModule,
    ReconciliationModule,
    ConfidenceModule,
    AssetsModule,
  ],
})
export class AppModule {}