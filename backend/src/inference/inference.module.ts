// FILE: backend/src/inference/inference.module.ts
import { Module } from '@nestjs/common';
import { InferenceService } from './inference.service';

@Module({
  providers: [InferenceService],
  exports: [InferenceService],
})
export class InferenceModule {}
