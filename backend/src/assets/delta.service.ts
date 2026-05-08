// ============================================================
// FILE: backend/src/assets/delta.service.ts
// FIX: Delta tracking — compare old vs new assets per job
// ============================================================
import { Injectable } from '@nestjs/common';
import { Asset } from './asset.entity';

export interface AssetDelta {
  assetId: string;
  assetName: string;
  changeType: 'added' | 'removed' | 'modified';
  changedFields: {
    field: string;
    oldValue: unknown;
    newValue: unknown;
  }[];
}

// Fields we diff (matches frontend asset.ts type)
const DIFFABLE_FIELDS: Array<keyof Asset> = [
  'assetName', 'value', 'currency', 'jurisdiction',
  'latitude', 'longitude', 'assetType', 'valueBasis',
  'overallConfidence', 'reviewRecommendation',
];

@Injectable()
export class DeltaService {
  // In-memory: jobId → snapshot of assets at time of job
  private readonly snapshots = new Map<string, Asset[]>();

  /** Save a snapshot BEFORE new assets are merged (call from ingestion) */
  saveSnapshot(jobId: string, currentAssets: Asset[]): void {
    // Deep copy so mutations don't affect snapshot
    this.snapshots.set(jobId, currentAssets.map((a) => ({ ...a })));
  }

  /** Compute delta between snapshot (old) and new assets list */
  computeDelta(jobId: string, newAssets: Asset[]): AssetDelta[] {
    const oldAssets = this.snapshots.get(jobId) ?? [];
    const deltas: AssetDelta[] = [];

    const oldMap = new Map(oldAssets.map((a) => [a.id, a]));
    const newMap = new Map(newAssets.map((a) => [a.id, a]));

    // Added assets
    for (const [id, asset] of newMap.entries()) {
      if (!oldMap.has(id)) {
        deltas.push({
          assetId: id,
          assetName: asset.assetName,
          changeType: 'added',
          changedFields: DIFFABLE_FIELDS
            .filter((f) => asset[f] !== null && asset[f] !== undefined)
            .map((f) => ({ field: String(f), oldValue: null, newValue: asset[f] })),
        });
      }
    }

    // Removed assets
    for (const [id, asset] of oldMap.entries()) {
      if (!newMap.has(id)) {
        deltas.push({
          assetId: id,
          assetName: asset.assetName,
          changeType: 'removed',
          changedFields: [],
        });
      }
    }

    // Modified assets
    for (const [id, newAsset] of newMap.entries()) {
      const oldAsset = oldMap.get(id);
      if (!oldAsset) continue;

      const changed = DIFFABLE_FIELDS
        .filter((f) => !this.deepEqual(oldAsset[f], newAsset[f]))
        .map((f) => ({
          field: String(f),
          oldValue: oldAsset[f],
          newValue: newAsset[f],
        }));

      if (changed.length > 0) {
        deltas.push({
          assetId: id,
          assetName: newAsset.assetName,
          changeType: 'modified',
          changedFields: changed,
        });
      }
    }

    return deltas;
  }

  /** Get delta by jobId (for GET /assets/delta/:jobId endpoint) */
  getDelta(jobId: string, currentAssets: Asset[]): AssetDelta[] {
    if (!this.snapshots.has(jobId)) return [];
    return this.computeDelta(jobId, currentAssets);
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a !== typeof b) return false;
    if (typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
    return false;
  }
}
