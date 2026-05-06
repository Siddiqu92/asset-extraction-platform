import { Injectable, Logger } from '@nestjs/common';
import { Asset, ValidationFlag } from '../assets/asset.entity';

// Known financial district coordinates [lat, lon, radius_deg]
const FINANCIAL_DISTRICTS: { name: string; lat: number; lon: number; radius: number }[] = [
  { name: 'New York City', lat: 40.7128, lon: -74.006, radius: 0.3 },
  { name: 'London', lat: 51.5074, lon: -0.1278, radius: 0.3 },
  { name: 'Zurich', lat: 47.3769, lon: 8.5417, radius: 0.2 },
  { name: 'Hong Kong', lat: 22.3193, lon: 114.1694, radius: 0.2 },
  { name: 'Singapore', lat: 1.3521, lon: 103.8198, radius: 0.2 },
  { name: 'Frankfurt', lat: 50.1109, lon: 8.6821, radius: 0.2 },
];

const PHYSICAL_ASSET_TYPES = new Set([
  'energy', 'renewable_energy', 'infrastructure', 'real_estate',
  'commercial_real_estate', 'industrial', 'power_plant', 'pipeline',
  'transportation', 'utility',
]);

@Injectable()
export class ValidationService {
  private readonly logger = new Logger(ValidationService.name);

  /**
   * Run all validators on a single asset and return merged flags
   */
  validateAsset(asset: Asset, existingAssets: Asset[] = []): ValidationFlag[] {
    const flags: ValidationFlag[] = [];

    flags.push(...this.validateCoordinates(asset.latitude, asset.longitude));
    flags.push(...this.validateCurrencyUnitMatch(asset.value, asset.currency, asset.sourceEvidence));
    flags.push(...this.validateDuplicateCollision(asset, existingAssets));
    flags.push(...this.validateHQMisattribution(asset));
    flags.push(...this.validateUnsupportedPrecision(asset.value, asset.sourceEvidence));

    if (flags.length > 0) {
      this.logger.debug(`Asset "${asset.assetName}" has ${flags.length} validation flag(s)`);
    }

    return flags;
  }

  /**
   * Validate lat/lon are within valid ranges
   */
  validateCoordinates(lat: number | null, lon: number | null): ValidationFlag[] {
    const flags: ValidationFlag[] = [];
    if (lat === null && lon === null) return flags;

    if (lat !== null && (lat < -90 || lat > 90)) {
      flags.push({
        code: 'INVALID_LATITUDE',
        severity: 'error',
        message: `Latitude ${lat} is out of valid range [-90, 90]`,
      });
    }
    if (lon !== null && (lon < -180 || lon > 180)) {
      flags.push({
        code: 'INVALID_LONGITUDE',
        severity: 'error',
        message: `Longitude ${lon} is out of valid range [-180, 180]`,
      });
    }
    if (lat === 0 && lon === 0) {
      flags.push({
        code: 'NULL_ISLAND_COORDINATES',
        severity: 'warning',
        message: 'Coordinates are (0, 0) — likely a placeholder or extraction error',
      });
    }
    return flags;
  }

  /**
   * Flag if value scale seems mismatched with raw text (e.g. "millions" but value is small)
   */
  validateCurrencyUnitMatch(
    value: number | null,
    currency: string | null,
    sourceEvidence: string[],
  ): ValidationFlag[] {
    if (value === null || !sourceEvidence?.length) return [];

    const evidenceText = sourceEvidence.join(' ').toLowerCase();
    const flags: ValidationFlag[] = [];

    const mentionsMillions = /\b(million|millions|mm)\b/.test(evidenceText);
    const mentionsBillions = /\b(billion|billions|bn)\b/.test(evidenceText);
    const mentionsThousands = /\b(thousand|thousands|000s)\b/.test(evidenceText);

    if (mentionsBillions && value < 1_000_000) {
      flags.push({
        code: 'UNIT_SCALE_MISMATCH',
        severity: 'warning',
        message: `Value ${value} seems too small — source mentions "billions" (${currency ?? 'unknown currency'})`,
      });
    } else if (mentionsMillions && value < 1_000) {
      flags.push({
        code: 'UNIT_SCALE_MISMATCH',
        severity: 'warning',
        message: `Value ${value} seems too small — source mentions "millions" (${currency ?? 'unknown currency'})`,
      });
    } else if (mentionsThousands && value < 10) {
      flags.push({
        code: 'UNIT_SCALE_MISMATCH',
        severity: 'warning',
        message: `Value ${value} seems too small — source mentions "thousands" (${currency ?? 'unknown currency'})`,
      });
    }

    return flags;
  }

  /**
   * Flag if same name+jurisdiction already exists with >20% value difference
   */
  validateDuplicateCollision(asset: Asset, existingAssets: Asset[]): ValidationFlag[] {
    if (!asset.assetName || !asset.jurisdiction) return [];

    const nameKey = asset.assetName.trim().toLowerCase();
    const jurKey = asset.jurisdiction.trim().toLowerCase();

    const collision = existingAssets.find((a) => {
      if (a.id === asset.id) return false;
      const sameName = (a.assetName ?? '').trim().toLowerCase() === nameKey;
      const sameJur = (a.jurisdiction ?? '').trim().toLowerCase() === jurKey;
      if (!sameName || !sameJur) return false;
      if (a.value === null || asset.value === null) return false;
      const diff = Math.abs(a.value - asset.value) / Math.max(Math.abs(a.value), 1);
      return diff > 0.2;
    });

    if (collision) {
      return [{
        code: 'DUPLICATE_VALUE_COLLISION',
        severity: 'warning',
        message: `Duplicate asset "${asset.assetName}" in "${asset.jurisdiction}" with conflicting value: ${collision.value} vs ${asset.value}`,
      }];
    }

    return [];
  }

  /**
   * Flag if coordinates point to financial district but asset type is physical infrastructure
   */
  validateHQMisattribution(asset: Asset): ValidationFlag[] {
    if (asset.latitude === null || asset.longitude === null) return [];
    if (!asset.assetType) return [];

    const isPhysical = PHYSICAL_ASSET_TYPES.has((asset.assetType ?? '').toLowerCase());
    if (!isPhysical) return [];

    for (const district of FINANCIAL_DISTRICTS) {
      const dLat = Math.abs(asset.latitude - district.lat);
      const dLon = Math.abs(asset.longitude - district.lon);
      if (dLat <= district.radius && dLon <= district.radius) {
        return [{
          code: 'HQ_MISATTRIBUTION',
          severity: 'warning',
          message: `Asset "${asset.assetName}" is type "${asset.assetType}" but coordinates point to ${district.name} financial district — may be HQ address, not asset location`,
        }];
      }
    }

    return [];
  }

  /**
   * Flag if value has >2 decimal places with no supporting evidence
   */
  validateUnsupportedPrecision(value: number | null, sourceEvidence: string[]): ValidationFlag[] {
    if (value === null) return [];

    const str = value.toString();
    const dotIdx = str.indexOf('.');
    if (dotIdx === -1) return [];

    const decimals = str.length - dotIdx - 1;
    if (decimals <= 2) return [];

    const evidenceText = (sourceEvidence ?? []).join(' ');
    const hasExactValue = evidenceText.includes(str);

    if (!hasExactValue) {
      return [{
        code: 'UNSUPPORTED_PRECISION',
        severity: 'warning',
        message: `Value ${value} has ${decimals} decimal places but no exact match found in source evidence`,
      }];
    }

    return [];
  }
}