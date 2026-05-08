import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
} from '@nestjs/common';
import { AssetsService } from './assets.service';
import type { Asset, AssetDelta } from './asset.entity';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get()
  getAll(): Asset[] {
    return this.assetsService.getAllAssets();
  }

  @Get('review')
  getForReview(): Asset[] {
    return this.assetsService.getAssetsForReview();
  }

  // NOTE: 'delta/:jobId' must be BEFORE ':id' — otherwise NestJS
  // treats "delta" as an id param and routes to getById() instead.
  @Get('delta/:jobId')
  getDelta(@Param('jobId') jobId: string): AssetDelta[] {
    return this.assetsService.getDeltaForJob(jobId);
  }

  @Get(':id')
  getById(@Param('id') id: string): Asset {
    const asset = this.assetsService.getAssetById(id);
    if (!asset) {
      throw new NotFoundException(`Asset not found: ${id}`);
    }
    return asset;
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updates: Partial<Asset>): Asset {
    return this.assetsService.updateAsset(id, updates);
  }

  @Delete()
  clearAll(): { ok: true } {
    this.assetsService.clearAll();
    return { ok: true };
  }
}
