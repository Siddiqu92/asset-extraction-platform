import { Module } from '@nestjs/common';
import { ExtractionService } from './extraction.service';
import { ExtractionController } from './extraction.controller';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  providers: [ExtractionService],
  controllers: [ExtractionController],
  exports: [ExtractionService],
})
export class ExtractionModule {}