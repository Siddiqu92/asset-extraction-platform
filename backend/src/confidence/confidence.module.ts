import { Module } from '@nestjs/common';
import { ConfidenceService } from './confidence.service';

@Module({
  providers: [ConfidenceService],
  exports: [ConfidenceService],
})
export class ConfidenceModule {}

