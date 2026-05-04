import { Module } from '@nestjs/common';
import { ExtractionService } from './extraction.service';
import { ExtractionController } from './extraction.controller';

@Module({
  providers: [ExtractionService],
  controllers: [ExtractionController],
  exports: [ExtractionService],
})
export class ExtractionModule {}

