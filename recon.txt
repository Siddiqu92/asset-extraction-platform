import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { Asset, AssetFactType, ValidationFlag } from '../assets/asset.entity';
import { ValidationService } from '../validation/validation.service';
import { InferenceService } from '../inference/inference.service';

type ReconcileResult = {
  canonical: Asset[];
  duplicateClusters: Record<string, string[]>;
};

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly validationService: ValidationService,
    private readonly inferenceService: InferenceService,
  ) {}

  async reconcile(assets: Asset[]): Promise<ReconcileResult> {
    try {
      // Step 1: Enrich missing fields via inference
      const enriched = await this.enrichAssets(assets);

      // Step 2: Cluster duplicates
      const clusters = this.clusterAssets(enriched);
      const duplicateClusters: Record<string, string[]> = {};
      const canonical: Asset[] = [];

      for (const clusterAssets of clusters) {
        if (clusterAssets.length === 1) {
          canonical.push(clusterAssets[0]);
          continue;
        }
        const clusterId = uuidv4();
        for (const a of clusterAssets) a.duplicateClusterId = clusterId;
        duplicateClusters[clusterId] = clusterAssets.map((a) => a.id);
        canonical.push(this.mergeCluster(clusterAssets, clusterId));
      }

      // Step 3: Run validation on final canonical assets
      for (const asset of canonical) {
        const flags = this.validationService.validateAsset(asset, canonical);
        if (flags.length > 0) {
          // Merge with any existing flags
          const existing = Array.isArray(asset.validationFlags)
            ? (asset.validationFlags as ValidationFlag[])
            : [];
          asset.validationFlags = [
            ...existing.filter((f): f is ValidationFlag => typeof f === 'object' && 'code' in f),
            ...flags,
          ];
        }
      }

      this.logger.log(
        `Reconciled ${assets.length} → ${canonical.length} canonical; clusters: ${Object.keys(duplicateClusters).length}`,
      );
      return { canonical, duplicateClusters };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`reconcile failed: ${msg}`);
      return { canonical: assets, duplicateClusters: {} };
    }
  }

  /**
   * Enrich assets with inferred currency, assetType, coordinates
   */
  private async enrichAssets(assets: Asset[]): Promise<Asset[]> {
    const enriched: Asset[] = [];

    for (const asset of assets) {
      const updated = { ...asset };

      // Infer currency if missing
      if (!updated.currency && updated.jurisdiction) {
        const inferred = this.inferenceService.inferCurrency(updated.jurisdiction);
        if (inferred) {
          updated.currency = inferred;
          updated.factType = { ...updated.factType, currency: 'inferred' };
          this.logger.debug(`Inferred currency "${inferred}" for "${updated.assetName}"`);
        }
      }

      // Infer assetType if missing
      if (!updated.assetType && updated.assetName) {
        const inferred = this.inferenceService.inferAssetType(
          updated.assetName,
          updated.sourceEvidence?.join(' ') ?? '',
        );
        if (inferred) {
          updated.assetType = inferred;
          updated.factType = { ...updated.factType, assetType: 'inferred' };
        }
      }

      // Infer coordinates from jurisdiction if missing (skip if no jurisdiction)
      if (
        updated.latitude === null &&
        updated.longitude === null &&
        updated.jurisdiction &&
        updated.jurisdiction.length > 3
      ) {
        try {
          const coords = await this.inferenceService.inferCoordinates(updated.jurisdiction);
          if (coords) {
            updated.latitude = coords.lat;
            updated.longitude = coords.lon;
            updated.factType = {
              ...updated.factType,
              latitude: 'inferred',
              longitude: 'inferred',
            };
          }
        } catch {
          // geocoding failure is non-fatal
        }
      }

      enriched.push(updated);
    }

    return enriched;
  }

  private clusterAssets(assets: Asset[]): Asset[][] {
    const remaining = new Set<string>(assets.map((a) => a.id));
    const byId = new Map<string, Asset>(assets.map((a) => [a.id, a]));
    const clusters: Asset[][] = [];

    for (const id of assets.map((a) => a.id)) {
      if (!remaining.has(id)) continue;
      remaining.delete(id);
      const seed = byId.get(id)!;
      const cluster: Asset[] = [seed];
      let changed = true;
      while (changed) {
        changed = false;
        for (const otherId of Array.from(remaining)) {
          const other = byId.get(otherId)!;
          if (cluster.some((a) => this.isDuplicate(a, other))) {
            remaining.delete(otherId);
            cluster.push(other);
            changed = true;
          }
        }
      }
      clusters.push(cluster);
    }

    return clusters;
  }

  private isDuplicate(a: Asset, b: Asset): boolean {
    const aName = (a.assetName ?? '').trim().toLowerCase();
    const bName = (b.assetName ?? '').trim().toLowerCase();
    if (aName && bName && aName === bName) return true;

    if (
      a.latitude !== null && a.longitude !== null &&
      b.latitude !== null && b.longitude !== null
    ) {
      if (Math.abs(a.latitude - b.latitude) <= 0.01 &&
          Math.abs(a.longitude - b.longitude) <= 0.01) return true;
    }

    if (
      a.jurisdiction && b.jurisdiction &&
      a.jurisdiction.trim().toLowerCase() === b.jurisdiction.trim().toLowerCase() &&
      a.value !== null && b.value !== null && a.value === b.value
    ) return true;

    return false;
  }

  private mergeCluster(cluster: Asset[], clusterId: string): Asset {
    const now = new Date();
    const base = cluster[0];

    const allEvidence = this.uniqueStrings(cluster.flatMap((a) => a.sourceEvidence ?? []));
    const allFlags: ValidationFlag[] = cluster.flatMap((a) =>
      Array.isArray(a.validationFlags)
        ? (a.validationFlags as ValidationFlag[]).filter(
            (f): f is ValidationFlag => typeof f === 'object' && 'code' in f,
          )
        : [],
    );
    const childIds = this.uniqueStrings(cluster.flatMap((a) => a.childAssetIds ?? []));
    const altNames = this.uniqueStrings(
      cluster
        .flatMap((a) => [a.assetName, ...(a.alternateName ?? []), ...(a.alternateNames ?? [])])
        .filter((n): n is string => !!n),
    );

    const merged: Asset = {
      ...base,
      id: base.id,
      alternateName: altNames.filter(
        (n) => n.trim().toLowerCase() !== base.assetName.trim().toLowerCase(),
      ),
      alternateNames: altNames.filter(
        (n) => n.trim().toLowerCase() !== base.assetName.trim().toLowerCase(),
      ),
      childAssetIds: childIds,
      sourceEvidence: allEvidence,
      validationFlags: allFlags,
      duplicateClusterId: clusterId,
      fieldConfidence: { ...(base.fieldConfidence ?? {}) },
      factType: { ...(base.factType ?? {}) },
      explanation: this.mergeExplanations(cluster),
      createdAt: base.createdAt ?? now,
      updatedAt: now,
    };

    const fields: (keyof Asset)[] = [
      'assetName', 'value', 'currency', 'jurisdiction',
      'latitude', 'longitude', 'assetType', 'valueBasis',
      'parentAssetId', 'sourceFile', 'sourceJobId',
    ];

    for (const field of fields) {
      const { value, confidence, conflicting } = this.pickBestField(cluster, field as string);
      (merged as unknown as Record<string, unknown>)[field] = value;
      merged.fieldConfidence[field as string] = confidence;
      if (conflicting) {
        merged.factType[field as string] = 'conflicting';
        merged.fieldConfidence[field as string] = Math.min(confidence, 0.4);
      } else if (!merged.factType[field as string]) {
        merged.factType[field as string] = 'inferred';
      }
    }

    merged.overallConfidence = this.clamp01(
      this.weightedOverallFromFields(merged.fieldConfidence, merged.overallConfidence),
    );
    merged.reviewRecommendation =
      merged.overallConfidence > 0.85 ? 'auto-accept'
      : merged.overallConfidence >= 0.5 ? 'review'
      : 'reject';

    return merged;
  }

  private pickBestField(
    cluster: Asset[],
    field: string,
  ): { value: unknown; confidence: number; conflicting: boolean } {
    const vals = cluster.map((a) => ({
      value: (a as unknown as Record<string, unknown>)[field],
      confidence: this.clamp01(Number((a.fieldConfidence ?? {})[field] ?? 0)),
      factType: (a.factType ?? {})[field] as AssetFactType | undefined,
    }));

    const normalized = vals
      .filter((v) => v.value !== undefined)
      .map((v) => ({
        ...v,
        norm: typeof v.value === 'string' ? v.value.trim().toLowerCase() : v.value,
      }));

    const distinct = new Set(normalized.map((v) => JSON.stringify(v.norm)));
    const conflicting = distinct.size > 1 && normalized.length > 1;

    let best = normalized[0];
    for (const v of normalized) {
      if (v.confidence > (best?.confidence ?? 0)) best = v;
    }

    const baseConfidence = best?.confidence ?? 0;
    return {
      value: best?.value ?? null,
      confidence: this.clamp01(conflicting ? Math.max(0, baseConfidence - 0.2) : baseConfidence),
      conflicting,
    };
  }

  private mergeExplanations(cluster: Asset[]): string {
    return this.uniqueStrings(
      cluster.map((a) => (a.explanation ?? '').trim()).filter((p) => p.length > 0),
    ).join('\n---\n');
  }

  private weightedOverallFromFields(
    fieldConfidence: Record<string, number>,
    fallback: number,
  ): number {
    const weights: Record<string, number> = {
      assetName: 3, value: 2.5, jurisdiction: 1.2,
      latitude: 1, longitude: 1, assetType: 1,
      currency: 0.8, valueBasis: 0.8, parentAssetId: 0.5,
    };
    let num = 0; let den = 0;
    for (const [k, w] of Object.entries(weights)) {
      num += this.clamp01(Number(fieldConfidence?.[k] ?? 0)) * w;
      den += w;
    }
    return den <= 0 ? this.clamp01(fallback ?? 0) : this.clamp01(num / den);
  }

  private uniqueStrings(arr: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of arr) {
      const key = (s ?? '').toString().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    return out;
  }

  private clamp01(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }
}

