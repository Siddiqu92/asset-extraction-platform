import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Asset, AssetDelta } from './asset.entity';

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);
  private readonly store = new Map<string, Asset>();
  private readonly deltaStore = new Map<string, AssetDelta[]>();

  saveAssets(assets: Asset[], jobId?: string): void {
    const previousAssets = jobId
      ? Array.from(this.store.values()).filter((a) => a.sourceJobId === jobId)
      : Array.from(this.store.values());

    if (jobId) {
      for (const [id, asset] of this.store.entries()) {
        if (asset.sourceJobId === jobId) this.store.delete(id);
      }
    } else {
      this.store.clear();
    }

    for (const asset of assets) this.store.set(asset.id, asset);

    // Compute and store deltas
    if (jobId && previousAssets.length > 0) {
      const deltas = this.computeDelta(previousAssets, assets);
      if (deltas.length > 0) {
        this.deltaStore.set(jobId, deltas);
        this.logger.log(`Delta: ${deltas.length} changes for job ${jobId}`);
      }
    }

    this.logger.log(
      `Saved ${assets.length} assets (job: ${jobId ?? 'unknown'}). Total: ${this.store.size}`,
    );
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

  getDeltaForJob(jobId: string): AssetDelta[] {
    return this.deltaStore.get(jobId) ?? [];
  }

  updateAsset(id: string, updates: Partial<Asset>): Asset {
    const existing = this.store.get(id);
    if (!existing) throw new NotFoundException(`Asset not found: ${id}`);

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
    this.deltaStore.clear();
    this.logger.warn('Cleared all assets and deltas from in-memory store');
  }

  /**
   * Compute what changed between two versions of assets for a job
   */
  computeDelta(previousAssets: Asset[], newAssets: Asset[]): AssetDelta[] {
    const deltas: AssetDelta[] = [];
    const makeKey = (a: Asset) =>
      `${(a.assetName ?? '').trim().toLowerCase()}|${(a.jurisdiction ?? '').trim().toLowerCase()}`;

    const prevMap = new Map(previousAssets.map((a) => [makeKey(a), a]));
    const newMap = new Map(newAssets.map((a) => [makeKey(a), a]));

    const trackedFields: (keyof Asset)[] = [
      'value', 'currency', 'jurisdiction', 'latitude',
      'longitude', 'assetType', 'valueBasis', 'overallConfidence',
    ];

    // Added + Modified
    for (const [key, newAsset] of newMap.entries()) {
      const prev = prevMap.get(key);
      if (!prev) {
        deltas.push({
          assetId: newAsset.id,
          assetName: newAsset.assetName,
          changeType: 'added',
          changedFields: [],
        });
      } else {
        const changedFields = trackedFields
          .filter((f) => JSON.stringify(prev[f]) !== JSON.stringify(newAsset[f]))
          .map((f) => ({ field: f as string, oldValue: prev[f], newValue: newAsset[f] }));

        if (changedFields.length > 0) {
          deltas.push({
            assetId: newAsset.id,
            assetName: newAsset.assetName,
            changeType: 'modified',
            changedFields,
          });
        }
      }
    }

    // Removed
    for (const [key, prevAsset] of prevMap.entries()) {
      if (!newMap.has(key)) {
        deltas.push({
          assetId: prevAsset.id,
          assetName: prevAsset.assetName,
          changeType: 'removed',
          changedFields: [],
        });
      }
    }

    return deltas;
  }
}