import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Asset } from './asset.entity';

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);
  private readonly store = new Map<string, Asset>();

  saveAssets(assets: Asset[]): void {
    for (const asset of assets) {
      this.store.set(asset.id, asset);
    }
    this.logger.log(`Saved ${assets.length} assets. Total in store: ${this.store.size}`);
  }

  getAllAssets(): Asset[] {
    return Array.from(this.store.values());
  }

  getAssetById(id: string): Asset | undefined {
    return this.store.get(id);
  }

  getAssetsForReview(): Asset[] {
    return this.getAllAssets().filter((a) => a.reviewRecommendation === 'review');
  }

  updateAsset(id: string, updates: Partial<Asset>): Asset {
    const existing = this.store.get(id);
    if (!existing) {
      throw new NotFoundException(`Asset not found: ${id}`);
    }

    const updated: Asset = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
    };

    this.store.set(id, updated);
    return updated;
  }

  clearAll(): void {
    this.store.clear();
    this.logger.warn('Cleared all assets from in-memory store');
  }
}

