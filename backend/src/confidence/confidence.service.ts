import { Injectable, Logger } from '@nestjs/common';
import { Asset } from '../assets/asset.entity';

@Injectable()
export class ConfidenceService {
  private readonly logger = new Logger(ConfidenceService.name);

  scoreAsset(asset: Asset): Asset {
    try {
      const updated: Asset = {
        ...asset,
        fieldConfidence: { ...(asset.fieldConfidence ?? {}) },
        validationFlags: [...(asset.validationFlags ?? [])],
        updatedAt: new Date(),
      };

      // Impossible coordinates
      if (
        updated.latitude !== null &&
        (updated.latitude > 90 || updated.latitude < -90)
      ) {
        this.addFlag(updated, 'IMPOSSIBLE_COORDINATES');
        updated.fieldConfidence.latitude = 0;
      }
      if (
        updated.longitude !== null &&
        (updated.longitude > 180 || updated.longitude < -180)
      ) {
        this.addFlag(updated, 'IMPOSSIBLE_COORDINATES');
        updated.fieldConfidence.longitude = 0;
      }

      // Base overallConfidence
      let overall = this.clamp01(
        typeof updated.overallConfidence === 'number' ? updated.overallConfidence : 0,
      );

      if (updated.value === null) overall -= 0.2;
      if (updated.jurisdiction === null) overall -= 0.1;
      if (updated.latitude === null || updated.longitude === null) overall -= 0.15;

      if (!updated.assetName || updated.assetName.trim().length === 0) {
        updated.overallConfidence = 0;
        updated.reviewRecommendation = 'reject';
        return updated;
      }

      overall = this.clamp01(overall);
      updated.overallConfidence = overall;

      if ((updated.validationFlags?.length ?? 0) > 3) {
        updated.reviewRecommendation = 'review';
      }

      if (overall > 0.85) updated.reviewRecommendation = 'auto-accept';
      else if (overall >= 0.5) updated.reviewRecommendation = 'review';
      else updated.reviewRecommendation = 'reject';

      return updated;
    } catch (err: any) {
      this.logger.error(`scoreAsset failed: ${err?.message ?? err}`);
      return asset;
    }
  }

  private clamp01(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  private addFlag(asset: Asset, flag: string) {
    if (!asset.validationFlags.includes(flag)) asset.validationFlags.push(flag);
  }
}

