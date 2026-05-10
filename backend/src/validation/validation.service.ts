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

// Energy asset types that carry capacity in MW (not MWh)
const CAPACITY_ASSET_TYPES = new Set([
  'energy', 'renewable_energy', 'power_plant', 'solar', 'wind',
  'hydro', 'nuclear', 'gas', 'coal', 'biomass', 'geothermal',
]);

// Energy asset types that carry energy in MWh (not MW)
const ENERGY_STORAGE_TYPES = new Set([
  'battery', 'battery_storage', 'energy_storage', 'pumped_hydro_storage',
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
    flags.push(...this.validateEnergyUnitMismatch(asset));
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
   * Flag MW vs MWh confusion:
   * - Power plants / generators should use MW (capacity) not MWh (energy)
   * - Battery / storage assets should use MWh not MW
   */
  validateEnergyUnitMismatch(asset: Asset): ValidationFlag[] {
    const flags: ValidationFlag[] = [];
    if (!asset.assetType) return flags;

    const assetTypeLower = asset.assetType.toLowerCase().replace(/[\s_-]/g, '_');
    const evidenceText = (asset.sourceEvidence ?? []).join(' ');
    const evidenceLower = evidenceText.toLowerCase();

    const hasMWh = /\bmwh\b/.test(evidenceLower);
    const hasMW  = /\bmw\b(?!h)/.test(evidenceLower);

    const isCapacityType  = CAPACITY_ASSET_TYPES.has(assetTypeLower) ||
      [...CAPACITY_ASSET_TYPES].some((t) => assetTypeLower.includes(t));
    const isStorageType   = ENERGY_STORAGE_TYPES.has(assetTypeLower) ||
      [...ENERGY_STORAGE_TYPES].some((t) => assetTypeLower.includes(t));

    if (isCapacityType && hasMWh && !hasMW) {
      flags.push({
        code: 'ENERGY_UNIT_MISMATCH',
        severity: 'warning',
        message: `Asset type "${asset.assetType}" typically uses MW (capacity) but source evidence contains MWh (energy). Verify unit — may indicate generation total rather than installed capacity.`,
      });
    }

    if (isStorageType && hasMW && !hasMWh) {
      flags.push({
        code: 'ENERGY_UNIT_MISMATCH',
        severity: 'warning',
        message: `Asset type "${asset.assetType}" typically uses MWh (stored energy) but source evidence contains MW. Verify unit — may indicate power rating rather than storage capacity.`,
      });
    }

    if ((isCapacityType || isStorageType) && hasMW && hasMWh) {
      flags.push({
        code: 'ENERGY_UNIT_AMBIGUOUS',
        severity: 'warning',
        message: `Both "MW" and "MWh" found in source evidence for "${asset.assetType}" asset. Confirm whether value represents capacity (MW) or energy (MWh).`,
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
   * Flag if coordinates point to financial district but asset type is physical infrastructure.
   *
   * FIX: Changed from exact Set.has() match to partial-match check using Array.some + includes().
   * This handles compound asset types like 'energy_generation', 'wind_energy', 'solar_power_plant'
   * that contain a known physical type as a substring but were not matching the exact Set entry.
   */
  validateHQMisattribution(asset: Asset): ValidationFlag[] {
    if (asset.latitude === null || asset.longitude === null) return [];
    if (!asset.assetType) return [];

    // FIX: normalize spaces and hyphens to underscores so 'Solar Power Plant' → 'solar_power_plant'
    // matches 'power_plant' in the set via partial-match (includes)
    const assetTypeLower = (asset.assetType ?? '').toLowerCase().replace(/[\s-]+/g, '_');

    const isPhysical =
      PHYSICAL_ASSET_TYPES.has(assetTypeLower) ||
      [...PHYSICAL_ASSET_TYPES].some((t) => assetTypeLower.includes(t));

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
