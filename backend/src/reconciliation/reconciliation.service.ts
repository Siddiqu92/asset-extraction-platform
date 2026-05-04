import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { Asset, AssetFactType } from '../assets/asset.entity';

type ReconcileResult = {
  canonical: Asset[];
  duplicateClusters: Record<string, string[]>;
};

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  reconcile(assets: Asset[]): ReconcileResult {
    try {
      const clusters = this.clusterAssets(assets);
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

      this.logger.log(
        `Reconciled ${assets.length} assets into ${canonical.length} canonical; clusters: ${Object.keys(duplicateClusters).length}`,
      );
      return { canonical, duplicateClusters };
    } catch (err: any) {
      this.logger.error(`reconcile failed: ${err?.message ?? err}`);
      return { canonical: assets, duplicateClusters: {} };
    }
  }

  private clusterAssets(assets: Asset[]): Asset[][] {
    const remaining = new Set<string>(assets.map((a) => a.id));
    const byId = new Map<string, Asset>(assets.map((a) => [a.id, a]));
    const clusters: Asset[][] = [];

    const ids = assets.map((a) => a.id);
    for (const id of ids) {
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
      a.latitude !== null &&
      a.longitude !== null &&
      b.latitude !== null &&
      b.longitude !== null
    ) {
      const dLat = Math.abs(a.latitude - b.latitude);
      const dLng = Math.abs(a.longitude - b.longitude);
      if (dLat <= 0.01 && dLng <= 0.01) return true;
    }

    if (
      a.jurisdiction &&
      b.jurisdiction &&
      a.jurisdiction.trim().toLowerCase() === b.jurisdiction.trim().toLowerCase()
    ) {
      if (a.value !== null && b.value !== null && a.value === b.value) return true;
    }

    return false;
  }

  private mergeCluster(cluster: Asset[], clusterId: string): Asset {
    const now = new Date();
    const base = cluster[0];
    const allEvidence = this.uniqueStrings(cluster.flatMap((a) => a.sourceEvidence ?? []));
    const allFlags = this.uniqueStrings(cluster.flatMap((a) => a.validationFlags ?? []));
    const childIds = this.uniqueStrings(cluster.flatMap((a) => a.childAssetIds ?? []));
    const altNames = this.uniqueStrings(
      cluster.flatMap((a) => [a.assetName, ...(a.alternateName ?? [])]).filter(Boolean) as string[],
    );

    const merged: Asset = {
      ...base,
      id: base.id,
      alternateName: altNames.filter((n) => n.trim().toLowerCase() !== base.assetName.trim().toLowerCase()),
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
      'assetName',
      'value',
      'currency',
      'jurisdiction',
      'latitude',
      'longitude',
      'assetType',
      'valueBasis',
      'parentAssetId',
      'sourceFile',
      'sourceJobId',
    ];

    for (const field of fields) {
      const { value, confidence, conflicting } = this.pickBestField(cluster, field as string);
      (merged as any)[field] = value;

      merged.fieldConfidence[field as string] = confidence;
      if (conflicting) {
        merged.factType[field as string] = 'conflicting';
        merged.fieldConfidence[field as string] = Math.min(merged.fieldConfidence[field as string] ?? confidence, 0.4);
      } else if (!merged.factType[field as string]) {
        merged.factType[field as string] = 'inferred';
      }
    }

    merged.overallConfidence = this.clamp01(
      this.weightedOverallFromFields(merged.fieldConfidence, merged.overallConfidence),
    );
    merged.reviewRecommendation =
      merged.overallConfidence > 0.85 ? 'auto-accept' : merged.overallConfidence >= 0.5 ? 'review' : 'reject';

    return merged;
  }

  private pickBestField(
    cluster: Asset[],
    field: string,
  ): { value: any; confidence: number; conflicting: boolean } {
    const vals: { value: any; confidence: number; factType?: AssetFactType }[] = cluster.map((a) => ({
      value: (a as any)[field],
      confidence: this.clamp01(Number((a.fieldConfidence ?? {})[field] ?? 0)),
      factType: (a.factType ?? {})[field],
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
      if (!best || v.confidence > best.confidence) best = v;
    }

    const baseConfidence = best ? best.confidence : 0;
    const confidence = conflicting ? Math.max(0, baseConfidence - 0.2) : baseConfidence;
    return { value: best?.value ?? null, confidence: this.clamp01(confidence), conflicting };
  }

  private mergeExplanations(cluster: Asset[]): string {
    const parts = cluster
      .map((a) => (a.explanation ?? '').trim())
      .filter((p) => p.length > 0);
    return this.uniqueStrings(parts).join('\n---\n');
  }

  private weightedOverallFromFields(
    fieldConfidence: Record<string, number>,
    fallback: number,
  ): number {
    const weights: Record<string, number> = {
      assetName: 3,
      value: 2.5,
      jurisdiction: 1.2,
      latitude: 1,
      longitude: 1,
      assetType: 1,
      currency: 0.8,
      valueBasis: 0.8,
      parentAssetId: 0.5,
    };

    let num = 0;
    let den = 0;
    for (const [k, w] of Object.entries(weights)) {
      const c = this.clamp01(Number(fieldConfidence?.[k] ?? 0));
      num += c * w;
      den += w;
    }
    if (den <= 0) return this.clamp01(fallback ?? 0);
    return this.clamp01(num / den);
  }

  private uniqueStrings(arr: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const s of arr) {
      const v = (s ?? '').toString();
      if (!v) continue;
      const key = v.trim();
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
    return out;
  }

  private clamp01(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }
}

