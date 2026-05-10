import { Test, TestingModule } from '@nestjs/testing';
import { InferenceService } from './inference.service';

describe('InferenceService', () => {
  let service: InferenceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [InferenceService],
    }).compile();
    service = module.get<InferenceService>(InferenceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── inferCurrency ─────────────────────────────────────────────────

  describe('inferCurrency()', () => {
    it('should return USD for United States', () => {
      const result = service.inferCurrency('United States');
      expect(result?.value).toBe('USD');
    });

    it('should return USD for USA jurisdiction string', () => {
      const result = service.inferCurrency('New York, USA');
      expect(result?.value).toBe('USD');
    });

    it('should return GBP for United Kingdom', () => {
      const result = service.inferCurrency('London, United Kingdom');
      expect(result?.value).toBe('GBP');
    });

    it('should return EUR for Germany', () => {
      const result = service.inferCurrency('Berlin, Germany');
      expect(result?.value).toBe('EUR');
    });

    it('should return CAD for Canada', () => {
      const result = service.inferCurrency('Ontario, Canada');
      expect(result?.value).toBe('CAD');
    });

    it('should return null for unknown jurisdiction', () => {
      const result = service.inferCurrency('Some Unknown Place XYZ');
      expect(result).toBeNull();
    });

    it('should return null for null input', () => {
      const result = service.inferCurrency(null);
      expect(result).toBeNull();
    });

    it('should have confidence between 0 and 1', () => {
      const result = service.inferCurrency('USA');
      expect(result?.confidence).toBeGreaterThan(0);
      expect(result?.confidence).toBeLessThanOrEqual(1);
    });
  });

  // ── inferCoordsFromState ──────────────────────────────────────────

  describe('inferCoordsFromState()', () => {
    it('should return coordinates for Texas (TX)', () => {
      const result = service.inferCoordsFromState('Austin, TX, USA');
      expect(result?.value.lat).toBeDefined();
      expect(result?.value.lon).toBeDefined();
      expect(result?.value.lat).toBeCloseTo(31.47, 0);
    });

    it('should return coordinates for New York (NY)', () => {
      const result = service.inferCoordsFromState('Albany, NY, USA');
      expect(result?.value.lat).toBeDefined();
      expect(result?.confidence).toBeGreaterThan(0);
      expect(result?.confidence).toBeLessThanOrEqual(1);
    });

    it('should return null for non-US jurisdiction', () => {
      const result = service.inferCoordsFromState('London, UK');
      expect(result).toBeNull();
    });

    it('should return null for null input', () => {
      const result = service.inferCoordsFromState(null);
      expect(result).toBeNull();
    });

    it('should include method in result', () => {
      const result = service.inferCoordsFromState('Dallas, TX, USA');
      expect(result?.method).toBe('state-centroid');
    });
  });

  // ── inferAssetType ────────────────────────────────────────────────

  describe('inferAssetType()', () => {
    it('should infer Solar Power Plant', () => {
      const result = service.inferAssetType('Solar PV Plant', ['150 MW solar photovoltaic facility']);
      expect(result?.value).toBe('Solar Power Plant');
    });

    it('should infer Wind Farm', () => {
      const result = service.inferAssetType('Coastal Wind Farm', ['offshore wind turbines']);
      expect(result?.value).toBe('Wind Farm');
    });

    it('should infer Commercial Real Estate from office building', () => {
      const result = service.inferAssetType('Downtown Office Tower', ['commercial building lease']);
      expect(result?.value).toBe('Commercial Real Estate');
    });

    it('should infer Government Building from federal facility', () => {
      const result = service.inferAssetType('Federal Building 123', ['federal installation']);
      expect(result?.value).toBe('Government Building');
    });

    it('should return null for unrecognized type', () => {
      const result = service.inferAssetType('Unknown XYZ Corp', []);
      expect(result).toBeNull();
    });

    it('should have confidence between 0 and 1 when matched', () => {
      const result = service.inferAssetType('Nuclear Power Station', []);
      expect(result?.confidence).toBeGreaterThan(0);
      expect(result?.confidence).toBeLessThanOrEqual(1);
    });
  });

  // ── estimateValueFromPortfolio ────────────────────────────────────

  describe('estimateValueFromPortfolio()', () => {
    it('should estimate value per asset correctly', () => {
      const result = service.estimateValueFromPortfolio(10_000_000, 5);
      expect(result?.value).toBe(2_000_000);
    });

    it('should return low confidence for portfolio estimate', () => {
      const result = service.estimateValueFromPortfolio(10_000_000, 5);
      expect(result?.confidence).toBeLessThan(0.5);
    });

    it('should return null when count is 0', () => {
      const result = service.estimateValueFromPortfolio(1_000_000, 0);
      expect(result).toBeNull();
    });

    it('should return null when portfolio total is 0', () => {
      const result = service.estimateValueFromPortfolio(0, 5);
      expect(result).toBeNull();
    });
  });
});
