// ============================================================
// FILE: backend/src/inference/inference.service.ts
// FIX: Infer missing currency, value, location, asset type
// ============================================================
import { Injectable } from '@nestjs/common';

// Jurisdiction → currency mapping
const JURISDICTION_CURRENCY: Record<string, string> = {
  usa: 'USD', 'united states': 'USD', us: 'USD',
  uk: 'GBP', 'united kingdom': 'GBP', england: 'GBP', britain: 'GBP',
  eu: 'EUR', europe: 'EUR', germany: 'EUR', france: 'EUR', italy: 'EUR',
  spain: 'EUR', netherlands: 'EUR', belgium: 'EUR', austria: 'EUR',
  japan: 'JPY', china: 'CNY', canada: 'CAD', australia: 'AUD',
  switzerland: 'CHF', india: 'INR', brazil: 'BRL', mexico: 'MXN',
  'south korea': 'KRW', russia: 'RUB', singapore: 'SGD',
  'hong kong': 'HKD', 'new zealand': 'NZD', sweden: 'SEK',
  norway: 'NOK', denmark: 'DKK', 'south africa': 'ZAR',
  pakistan: 'PKR', 'saudi arabia': 'SAR', uae: 'AED',
};

// US state abbreviation → centroid [lat, lon]
const US_STATE_CENTROIDS: Record<string, [number, number]> = {
  AL: [32.7794, -86.8287], AK: [64.2008, -153.4937], AZ: [34.2744, -111.6602],
  AR: [34.8938, -92.4426], CA: [37.1841, -119.4696], CO: [38.9972, -105.5478],
  CT: [41.6219, -72.7273], DE: [38.9896, -75.5050], FL: [28.6305, -82.4497],
  GA: [32.6415, -83.4426], HI: [20.2927, -156.3737], ID: [44.3509, -114.6130],
  IL: [40.0417, -89.1965], IN: [39.8942, -86.2816], IA: [42.0751, -93.4960],
  KS: [38.4937, -98.3804], KY: [37.5347, -85.3021], LA: [31.0689, -91.9968],
  ME: [45.3695, -69.2428], MD: [39.0550, -76.7909], MA: [42.2596, -71.8083],
  MI: [44.3467, -85.4102], MN: [46.2807, -94.3053], MS: [32.7364, -89.6678],
  MO: [38.3566, -92.4580], MT: [46.8797, -110.3626], NE: [41.5378, -99.7951],
  NV: [39.3289, -116.6312], NH: [43.6805, -71.5811], NJ: [40.1907, -74.6728],
  NM: [34.4071, -106.1126], NY: [42.9538, -75.5268], NC: [35.5557, -79.3877],
  ND: [47.4501, -100.4659], OH: [40.2862, -82.7937], OK: [35.5889, -97.4943],
  OR: [43.9336, -120.5583], PA: [40.8781, -77.7996], RI: [41.6762, -71.5562],
  SC: [33.9169, -80.8964], SD: [44.4443, -100.2263], TN: [35.8580, -86.3505],
  TX: [31.4757, -99.3312], UT: [39.3210, -111.0937], VT: [44.0687, -72.6658],
  VA: [37.5215, -78.8537], WA: [47.3826, -120.4472], WV: [38.6409, -80.6227],
  WI: [44.6243, -89.9941], WY: [42.9957, -107.5512],
};

export interface InferenceResult<T> {
  value: T;
  confidence: number;
  method: string;
  explanation: string;
}

@Injectable()
export class InferenceService {

  // ── Currency from jurisdiction ──────────────────────────────────────
  inferCurrency(jurisdiction: string | null): InferenceResult<string> | null {
    if (!jurisdiction) return null;
    const lower = jurisdiction.toLowerCase();

    for (const [key, currency] of Object.entries(JURISDICTION_CURRENCY)) {
      if (lower.includes(key)) {
        return {
          value: currency,
          confidence: 0.8,
          method: 'jurisdiction-to-currency',
          explanation: `Inferred ${currency} from jurisdiction "${jurisdiction}" matching "${key}"`,
        };
      }
    }

    // Try state code pattern (e.g. ", TX, USA")
    const stateMatch = lower.match(/\b([a-z]{2}),?\s*usa\b/);
    if (stateMatch) {
      return {
        value: 'USD',
        confidence: 0.85,
        method: 'us-state-pattern',
        explanation: `US state pattern detected in "${jurisdiction}" — inferred USD`,
      };
    }

    return null;
  }

  // ── Coordinates from US state ───────────────────────────────────────
  inferCoordsFromState(jurisdiction: string | null): InferenceResult<{ lat: number; lon: number }> | null {
    if (!jurisdiction) return null;
    const upper = jurisdiction.toUpperCase();

    // Match 2-letter state codes
    for (const [code, [lat, lon]] of Object.entries(US_STATE_CENTROIDS)) {
      if (upper.includes(` ${code},`) || upper.includes(` ${code} `) ||
          upper.endsWith(` ${code}`) || upper.startsWith(`${code},`)) {
        return {
          value: { lat, lon },
          confidence: 0.4,
          method: 'state-centroid',
          explanation: `State centroid used for ${code} — not asset-level coordinates`,
        };
      }
    }

    return null;
  }

  // ── Asset type from context keywords ───────────────────────────────
  inferAssetType(name: string, evidence: string[]): InferenceResult<string> | null {
    const text = `${name} ${evidence.join(' ')}`.toLowerCase();

    const rules: Array<[RegExp, string]> = [
      [/solar|photovoltaic|pv\s*plant/, 'Solar Power Plant'],
      [/wind\s*(farm|turbine|park)/, 'Wind Farm'],
      [/hydro(electric)?|dam|reservoir/, 'Hydroelectric Plant'],
      [/nuclear|atomic\s*power/, 'Nuclear Plant'],
      [/gas\s*(plant|turbine)|natural\s*gas/, 'Gas Power Plant'],
      [/coal\s*(plant|mine|power)/, 'Coal Plant'],
      [/power\s*plant|generation\s*facility/, 'Power Plant'],
      [/office\s*(building|park|tower)|commercial\s*(building|real\s*estate)/, 'Commercial Real Estate'],
      [/warehouse|industrial|manufacturing\s*plant/, 'Industrial Property'],
      [/apartment|residential|housing/, 'Residential Real Estate'],
      [/hotel|resort|hospitality/, 'Hospitality Property'],
      [/pipeline|transmission\s*line/, 'Infrastructure'],
      [/utility|electric\s*(co|company|cooperative)/, 'Electric Utility'],
      [/assessment|parcel|land\s*record/, 'Real Property'],
      [/federal\s*(building|facility|installation)/, 'Government Building'],
    ];

    for (const [pattern, type] of rules) {
      if (pattern.test(text)) {
        return {
          value: type,
          confidence: 0.7,
          method: 'keyword-matching',
          explanation: `Asset type inferred from name/evidence keywords matching pattern ${pattern.source}`,
        };
      }
    }

    return null;
  }

  // ── Value estimation: portfolio total / count ───────────────────────
  estimateValueFromPortfolio(
    portfolioTotal: number,
    assetCount: number,
  ): InferenceResult<number> | null {
    if (!portfolioTotal || !assetCount || assetCount === 0) return null;
    const estimated = portfolioTotal / assetCount;
    return {
      value: Math.round(estimated),
      confidence: 0.3,
      method: 'portfolio-average',
      explanation: `Estimated as portfolio total ${portfolioTotal} ÷ ${assetCount} assets = ${Math.round(estimated)}. Low confidence — use only as placeholder.`,
    };
  }

  // ── Validate: impossible coordinate check ──────────────────────────
  validateCoordinates(lat: number | null, lon: number | null): string[] {
    const flags: string[] = [];
    if (lat === null && lon === null) return flags;
    if (lat !== null && (lat < -90 || lat > 90)) flags.push(`INVALID_LATITUDE:${lat}`);
    if (lon !== null && (lon < -180 || lon > 180)) flags.push(`INVALID_LONGITUDE:${lon}`);
    if (lat === 0 && lon === 0) flags.push('NULL_ISLAND_COORDINATES');
    return flags;
  }

  // ── Validate: portfolio double-counting ────────────────────────────
  detectDoubleCountedAssets(assets: Array<{ assetName: string; value: number | null }>): string[] {
    const seen = new Map<string, number[]>();
    for (const a of assets) {
      const key = a.assetName?.trim().toLowerCase();
      if (!key) continue;
      const vals = seen.get(key) || [];
      if (a.value !== null) vals.push(a.value);
      seen.set(key, vals);
    }

    const flags: string[] = [];
    for (const [name, vals] of seen.entries()) {
      if (vals.length > 1) {
        const sum = vals.reduce((a, b) => a + b, 0);
        flags.push(`DOUBLE_COUNTING:${name}:total=${sum}:occurrences=${vals.length}`);
      }
    }
    return flags;
  }
}
