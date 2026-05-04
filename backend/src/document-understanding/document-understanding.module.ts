import { Module } from '@nestjs/common';
import { DocumentUnderstandingService } from './document-understanding.service';

@Module({
  providers: [DocumentUnderstandingService],
  exports: [DocumentUnderstandingService],
})
export class DocumentUnderstandingModule {}

