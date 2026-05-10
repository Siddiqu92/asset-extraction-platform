import { Test, TestingModule } from '@nestjs/testing';
import { ValidationService } from './validation.service';
import { Asset } from '../assets/asset.entity';

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'v-test',
    assetName: 'Solar Farm Alpha',
    alternateName: [],
    alternateNames: [],
    value: 5_000_000,
    currency: 'USD',
    jurisdiction: 'Texas, USA',
    latitude: 31.0,
    longitude: -99.0,
    assetType: 'Solar Power Plant',
    valueBasis: 'market_value',
    parentAssetId: null,
    childAssetIds: [],
    fieldConfidence: {},
    overallConfidence: 0.8,
    sourceEvidence: [],
    explanation: '',
    validationFlags: [],
    duplicateClusterId: null,
    reviewRecommendation: 'review',
    factType: {},
    sourceFile: 'test.csv',
    sourceJobId: 'job-v',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ValidationService', () => {
  let service: ValidationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ValidationService],
    }).compile();
    service = module.get<ValidationService>(ValidationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── validateCoordinates ───────────────────────────────────────────

  describe('validateCoordinates()', () => {
    it('should return no flags for valid coordinates', () => {
      const flags = service.validateCoordinates(40.71, -74.0);
      expect(flags).toHaveLength(0);
    });

    it('should flag latitude out of range', () => {
      const flags = service.validateCoordinates(100, 0);
      expect(flags.some((f) => f.code === 'INVALID_LATITUDE')).toBe(true);
    });

    it('should flag longitude out of range', () => {
      const flags = service.validateCoordinates(0, 200);
      expect(flags.some((f) => f.code === 'INVALID_LONGITUDE')).toBe(true);
    });

    it('should flag null island (0,0)', () => {
      const flags = service.validateCoordinates(0, 0);
      expect(flags.some((f) => f.code === 'NULL_ISLAND_COORDINATES')).toBe(true);
    });

    it('should return no flags when both coords are null', () => {
      const flags = service.validateCoordinates(null, null);
      expect(flags).toHaveLength(0);
    });
  });

  // ── validateCurrencyUnitMatch ────────────────────────────────────

  describe('validateCurrencyUnitMatch()', () => {
    it('should flag value too small when source mentions billions', () => {
      const flags = service.validateCurrencyUnitMatch(
        500,
        'USD',
        ['Total portfolio worth 3 billion USD'],
      );
      expect(flags.some((f) => f.code === 'UNIT_SCALE_MISMATCH')).toBe(true);
    });

    it('should flag value too small when source mentions millions', () => {
      const flags = service.validateCurrencyUnitMatch(
        50,
        'USD',
        ['Property valued at 5 million dollars'],
      );
      expect(flags.some((f) => f.code === 'UNIT_SCALE_MISMATCH')).toBe(true);
    });

    it('should not flag correct value scale', () => {
      const flags = service.validateCurrencyUnitMatch(
        5_000_000,
        'USD',
        ['Property valued at 5 million dollars'],
      );
      expect(flags).toHaveLength(0);
    });

    it('should not flag when no evidence provided', () => {
      const flags = service.validateCurrencyUnitMatch(50, 'USD', []);
      expect(flags).toHaveLength(0);
    });
  });

  // ── validateEnergyUnitMismatch ───────────────────────────────────

  describe('validateEnergyUnitMismatch()', () => {
    it('should flag MWh for a solar power plant (should be MW)', () => {
      const asset = makeAsset({
        assetType: 'Solar Power Plant',
        sourceEvidence: ['Generates 500 MWh annually from 200 panels'],
      });
      const flags = service.validateEnergyUnitMismatch(asset);
      expect(flags.some((f) => f.code === 'ENERGY_UNIT_MISMATCH')).toBe(true);
    });

    it('should not flag MW for a solar power plant', () => {
      const asset = makeAsset({
        assetType: 'Solar Power Plant',
        sourceEvidence: ['Installed capacity of 150 MW'],
      });
      const flags = service.validateEnergyUnitMismatch(asset);
      expect(flags.filter((f) => f.code === 'ENERGY_UNIT_MISMATCH')).toHaveLength(0);
    });

    it('should flag MW for battery storage (should be MWh)', () => {
      const asset = makeAsset({
        assetType: 'Battery Storage',
        sourceEvidence: ['Battery rated at 50 MW output'],
      });
      const flags = service.validateEnergyUnitMismatch(asset);
      expect(flags.some((f) => f.code === 'ENERGY_UNIT_MISMATCH')).toBe(true);
    });
  });

  // ── validateHQMisattribution ──────────────────────────────────────

  describe('validateHQMisattribution()', () => {
    it('should flag energy asset at NYC financial district coords', () => {
      const asset = makeAsset({
        assetType: 'Solar Power Plant',
        latitude: 40.71,
        longitude: -74.006,
      });
      const flags = service.validateHQMisattribution(asset);
      expect(flags.some((f) => f.code === 'HQ_MISATTRIBUTION')).toBe(true);
    });

    it('should not flag energy asset at non-financial-district coords', () => {
      const asset = makeAsset({
        assetType: 'Solar Power Plant',
        latitude: 35.0,
        longitude: -100.0,
      });
      const flags = service.validateHQMisattribution(asset);
      expect(flags).toHaveLength(0);
    });

    it('should not flag non-physical asset type at financial district', () => {
      const asset = makeAsset({
        assetType: 'Financial Fund',
        latitude: 40.71,
        longitude: -74.006,
      });
      const flags = service.validateHQMisattribution(asset);
      expect(flags).toHaveLength(0);
    });
  });

  // ── validateAsset (full) ──────────────────────────────────────────

  describe('validateAsset()', () => {
    it('should return empty flags for a clean valid asset', () => {
      const asset = makeAsset();
      const flags = service.validateAsset(asset, []);
      expect(flags).toHaveLength(0);
    });

    it('should return multiple flags for a problematic asset', () => {
      const asset = makeAsset({
        latitude: 999,
        longitude: 0,
        sourceEvidence: ['Worth 3 billion dollars'],
        value: 100,
      });
      const flags = service.validateAsset(asset, []);
      expect(flags.length).toBeGreaterThanOrEqual(2);
    });
  });
});
