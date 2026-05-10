import { Module } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';
import { DeltaService } from './delta.service';

@Module({
  providers: [AssetsService, DeltaService],
  controllers: [AssetsController],
  exports: [AssetsService, DeltaService],
})
export class AssetsModule {}
