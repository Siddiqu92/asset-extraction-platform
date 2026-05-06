import { Injectable, Logger } from '@nestjs/common';
import { Asset, ValidationFlag } from '../assets/asset.entity';

@Injectable()
export class ConfidenceService {
  private readonly logger = new Logger(ConfidenceService.name);

  private readonly baseByDataset: Record<string, number> = {
    NY_ASSESSMENT_ROLL: 0.85,
    EIA860_PLANT: 0.95,
    EUROPEAN_RENEWABLE: 0.9,
    GSA_BUILDINGS: 0.55,
    FEDERAL_INSTALLATIONS: 0.5,
    EIA861_SALES: 0.7,
    CORPORATE_ANNUAL_REPORT: 0.6,
    INVESTOR_PRESENTATION: 0.65,
    REMPD_REFERENCE: 0,
    COUNTY_GEOCODING_REF: 0,
    UNKNOWN: 0.3,
  };

  scoreAsset(asset: Asset): Asset {
    try {
      const updated: Asset = {
        ...asset,
        fieldConfidence: { ...(asset.fieldConfidence ?? {}) },
        validationFlags: [...(asset.validationFlags ?? [])],
        updatedAt: new Date(),
      };

      // Impossible coordinates — add structured ValidationFlag
      if (updated.latitude !== null && (updated.latitude > 90 || updated.latitude < -90)) {
        this.addFlag(updated, {
          code: 'IMPOSSIBLE_COORDINATES',
          severity: 'error',
          message: `Latitude ${updated.latitude} is out of valid range [-90, 90]`,
        });
        updated.fieldConfidence.latitude = 0;
      }
      if (updated.longitude !== null && (updated.longitude > 180 || updated.longitude < -180)) {
        this.addFlag(updated, {
          code: 'IMPOSSIBLE_COORDINATES',
          severity: 'error',
          message: `Longitude ${updated.longitude} is out of valid range [-180, 180]`,
        });
        updated.fieldConfidence.longitude = 0;
      }

      const dataset = (updated.datasetType ?? 'UNKNOWN').toUpperCase();
      let overall = this.baseByDataset[dataset] ?? this.baseByDataset.UNKNOWN;

      if (updated.value === null || updated.value === 0) overall -= 0.15;
      if (updated.latitude === null || updated.longitude === null) overall -= 0.15;
      if (!updated.jurisdiction) overall -= 0.05;
      if (!updated.sourceEvidence?.length) overall -= 0.05;

      // Check flags by code
      const flagCodes = this.getFlagCodes(updated.validationFlags);
      if (flagCodes.has('COORDINATES_GEOCODED_NOT_EXACT')) overall -= 0.1;
      if (flagCodes.has('SCANNED_PDF_OCR')) overall -= 0.2;
      if (flagCodes.has('DECOMMISSIONED')) overall -= 0.1;

      overall = this.clamp01(overall);

      if (!updated.assetName || updated.assetName.trim().length === 0) {
        updated.overallConfidence = 0;
        updated.reviewRecommendation = 'reject';
        return updated;
      }

      updated.overallConfidence = overall;

      if (updated.validationFlags.length > 3) {
        updated.reviewRecommendation = 'review';
      }

      if (overall > 0.85) updated.reviewRecommendation = 'auto-accept';
      else if (overall >= 0.5) updated.reviewRecommendation = 'review';
      else updated.reviewRecommendation = 'reject';

      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`scoreAsset failed: ${msg}`);
      return asset;
    }
  }

  private getFlagCodes(flags: ValidationFlag[]): Set<string> {
    return new Set(
      flags
        .filter((f): f is ValidationFlag => typeof f === 'object' && 'code' in f)
        .map((f) => f.code),
    );
  }

  private addFlag(asset: Asset, flag: ValidationFlag): void {
    const existing = this.getFlagCodes(asset.validationFlags);
    if (!existing.has(flag.code)) {
      asset.validationFlags.push(flag);
    }
  }

  private clamp01(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }
}