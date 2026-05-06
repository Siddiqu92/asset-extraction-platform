import { Module } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import { ValidationModule } from '../validation/validation.module';
import { InferenceModule } from '../inference/inference.module';

@Module({
  imports: [ValidationModule, InferenceModule],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}