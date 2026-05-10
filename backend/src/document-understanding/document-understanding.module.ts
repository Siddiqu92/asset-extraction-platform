import { Module } from '@nestjs/common';
import { DocumentUnderstandingService } from './document-understanding.service';
import { OcrModule } from '../ocr/ocr.module';

@Module({
  imports: [OcrModule],
  providers: [DocumentUnderstandingService],
  exports: [DocumentUnderstandingService],
})
export class DocumentUnderstandingModule {}
