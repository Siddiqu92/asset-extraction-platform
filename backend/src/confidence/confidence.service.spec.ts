import { Test, TestingModule } from '@nestjs/testing';
import { ConfidenceService } from './confidence.service';
import { Asset } from '../assets/asset.entity';

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'test-id',
    assetName: 'Test Asset',
    alternateName: [],
    alternateNames: [],
    value: 1_000_000,
    currency: 'USD',
    jurisdiction: 'New York, USA',
    latitude: 40.71,
    longitude: -74.0,
    assetType: 'Commercial Real Estate',
    valueBasis: 'market_value',
    parentAssetId: null,
    childAssetIds: [],
    fieldConfidence: {},
    overallConfidence: 0,
    sourceEvidence: ['Extracted from page 3'],
    explanation: '',
    validationFlags: [],
    duplicateClusterId: null,
    reviewRecommendation: 'review',
    factType: {},
    sourceFile: 'test.pdf',
    sourceJobId: 'job-1',
    datasetType: 'EIA860_PLANT',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ConfidenceService', () => {
  let service: ConfidenceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConfidenceService],
    }).compile();
    service = module.get<ConfidenceService>(ConfidenceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('scoreAsset()', () => {
    it('should return auto-accept for high-confidence EIA dataset', () => {
      const asset = makeAsset({ datasetType: 'EIA860_PLANT' });
      const result = service.scoreAsset(asset);
      expect(result.overallConfidence).toBeGreaterThan(0.85);
      expect(result.reviewRecommendation).toBe('auto-accept');
    });

    it('should return review for medium-confidence asset', () => {
      const asset = makeAsset({
        datasetType: 'CORPORATE_ANNUAL_REPORT',
        latitude: null,
        longitude: null,
      });
      const result = service.scoreAsset(asset);
      expect(result.overallConfidence).toBeGreaterThanOrEqual(0.5);
      expect(result.overallConfidence).toBeLessThanOrEqual(0.85);
      expect(result.reviewRecommendation).toBe('review');
    });

    it('should return reject for unknown dataset with no value or coords', () => {
      const asset = makeAsset({
        datasetType: 'UNKNOWN',
        value: null,
        latitude: null,
        longitude: null,
        jurisdiction: null,
        sourceEvidence: [],
      });
      const result = service.scoreAsset(asset);
      expect(result.overallConfidence).toBeLessThan(0.5);
      expect(result.reviewRecommendation).toBe('reject');
    });

    it('should reject asset with empty assetName', () => {
      const asset = makeAsset({ assetName: '' });
      const result = service.scoreAsset(asset);
      expect(result.overallConfidence).toBe(0);
      expect(result.reviewRecommendation).toBe('reject');
    });

    it('should add IMPOSSIBLE_COORDINATES flag for invalid latitude', () => {
      const asset = makeAsset({ latitude: 200 });
      const result = service.scoreAsset(asset);
      const codes = result.validationFlags.map((f) => f.code);
      expect(codes).toContain('IMPOSSIBLE_COORDINATES');
    });

    it('should add IMPOSSIBLE_COORDINATES flag for invalid longitude', () => {
      const asset = makeAsset({ longitude: -250 });
      const result = service.scoreAsset(asset);
      const codes = result.validationFlags.map((f) => f.code);
      expect(codes).toContain('IMPOSSIBLE_COORDINATES');
    });

    it('should not duplicate IMPOSSIBLE_COORDINATES flag on double call', () => {
      const asset = makeAsset({ latitude: 999 });
      const first = service.scoreAsset(asset);
      const second = service.scoreAsset(first);
      const flagCount = second.validationFlags.filter(
        (f) => f.code === 'IMPOSSIBLE_COORDINATES',
      ).length;
      expect(flagCount).toBe(1);
    });

    it('should lower confidence when SCANNED_PDF_OCR flag present', () => {
      const clean = makeAsset({ datasetType: 'EIA860_PLANT' });
      const withFlag = makeAsset({
        datasetType: 'EIA860_PLANT',
        validationFlags: [{ code: 'SCANNED_PDF_OCR', severity: 'warning', message: 'OCR used' }],
      });
      const cleanScore = service.scoreAsset(clean).overallConfidence;
      const flagScore = service.scoreAsset(withFlag).overallConfidence;
      expect(flagScore).toBeLessThan(cleanScore);
    });
  });
});
