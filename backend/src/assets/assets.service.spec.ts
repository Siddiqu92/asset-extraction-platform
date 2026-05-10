import { Test, TestingModule } from '@nestjs/testing';
import { AssetsService } from './assets.service';
import { Asset } from './asset.entity';

function makeAsset(id: string, overrides: Partial<Asset> = {}): Asset {
  return {
    id,
    assetName: `Asset ${id}`,
    alternateName: [],
    alternateNames: [],
    value: 500_000,
    currency: 'USD',
    jurisdiction: 'California, USA',
    latitude: 37.5,
    longitude: -119.5,
    assetType: 'Commercial Real Estate',
    valueBasis: 'market_value',
    parentAssetId: null,
    childAssetIds: [],
    fieldConfidence: { assetName: 0.9, value: 0.85 },
    overallConfidence: 0.8,
    sourceEvidence: ['Source text here'],
    explanation: 'Extracted from document',
    validationFlags: [],
    duplicateClusterId: null,
    reviewRecommendation: 'auto-accept',
    factType: { assetName: 'extracted', value: 'extracted' },
    sourceFile: 'test.csv',
    sourceJobId: 'job-001',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('AssetsService', () => {
  let service: AssetsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AssetsService],
    }).compile();
    service = module.get<AssetsService>(AssetsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── saveAssets + getAllAssets ──────────────────────────────────────

  describe('saveAssets() + getAllAssets()', () => {
    it('should save and retrieve assets', () => {
      const assets = [makeAsset('a1'), makeAsset('a2')];
      service.saveAssets(assets, 'job-001');
      const all = service.getAllAssets();
      expect(all).toHaveLength(2);
      expect(all.map((a) => a.id)).toContain('a1');
    });

    it('should replace assets for same jobId on re-upload', () => {
      service.saveAssets([makeAsset('a1'), makeAsset('a2')], 'job-001');
      service.saveAssets([makeAsset('a3')], 'job-001');
      const all = service.getAllAssets();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe('a3');
    });

    it('should not clear assets from other jobs', () => {
      service.saveAssets([makeAsset('a1')], 'job-001');
      service.saveAssets([makeAsset('b1')], 'job-002');
      const all = service.getAllAssets();
      expect(all).toHaveLength(2);
    });
  });

  // ── getAssetById ──────────────────────────────────────────────────

  describe('getAssetById()', () => {
    it('should return asset by id', () => {
      service.saveAssets([makeAsset('find-me')], 'job-001');
      const found = service.getAssetById('find-me');
      expect(found?.id).toBe('find-me');
    });

    it('should return undefined for unknown id', () => {
      const found = service.getAssetById('not-exist');
      expect(found).toBeUndefined();
    });
  });

  // ── getAssetsForReview ────────────────────────────────────────────

  describe('getAssetsForReview()', () => {
    it('should return only review assets', () => {
      service.saveAssets([
        makeAsset('r1', { reviewRecommendation: 'review' }),
        makeAsset('r2', { reviewRecommendation: 'auto-accept' }),
        makeAsset('r3', { reviewRecommendation: 'reject' }),
      ], 'job-001');
      const reviewAssets = service.getAssetsForReview();
      expect(reviewAssets).toHaveLength(1);
      expect(reviewAssets[0].id).toBe('r1');
    });

    it('should return empty array when no review assets', () => {
      service.saveAssets([makeAsset('ok', { reviewRecommendation: 'auto-accept' })], 'job-001');
      expect(service.getAssetsForReview()).toHaveLength(0);
    });
  });

  // ── updateAsset ───────────────────────────────────────────────────

  describe('updateAsset()', () => {
    it('should update asset fields', () => {
      service.saveAssets([makeAsset('upd')], 'job-001');
      const updated = service.updateAsset('upd', { value: 999_999, currency: 'GBP' });
      expect(updated.value).toBe(999_999);
      expect(updated.currency).toBe('GBP');
    });

    it('should preserve original id and createdAt', () => {
      const original = makeAsset('upd');
      service.saveAssets([original], 'job-001');
      const updated = service.updateAsset('upd', { value: 1 });
      expect(updated.id).toBe('upd');
      expect(updated.createdAt).toEqual(original.createdAt);
    });

    it('should throw NotFoundException for unknown id', () => {
      expect(() => service.updateAsset('no-exist', {})).toThrow();
    });
  });

  // ── clearAll ──────────────────────────────────────────────────────

  describe('clearAll()', () => {
    it('should remove all assets', () => {
      service.saveAssets([makeAsset('a1'), makeAsset('a2')], 'job-001');
      service.clearAll();
      expect(service.getAllAssets()).toHaveLength(0);
    });
  });

  // ── computeDelta ──────────────────────────────────────────────────

  describe('computeDelta()', () => {
    it('should detect added assets', () => {
      const prev: Asset[] = [];
      const next = [makeAsset('new-1')];
      const deltas = service.computeDelta(prev, next);
      expect(deltas.some((d) => d.changeType === 'added' && d.assetId === 'new-1')).toBe(true);
    });

    it('should detect removed assets', () => {
      const prev = [makeAsset('gone')];
      const next: Asset[] = [];
      const deltas = service.computeDelta(prev, next);
      expect(deltas.some((d) => d.changeType === 'removed' && d.assetId === 'gone')).toBe(true);
    });

    it('should detect modified assets by name+jurisdiction key', () => {
      const prev = [makeAsset('id-1', { value: 100_000 })];
      const next = [makeAsset('id-1', { value: 200_000 })];
      const deltas = service.computeDelta(prev, next);
      expect(deltas.some((d) => d.changeType === 'modified')).toBe(true);
    });

    it('should return empty array when nothing changed', () => {
      const assets = [makeAsset('same')];
      const deltas = service.computeDelta(assets, assets);
      expect(deltas).toHaveLength(0);
    });
  });
});
