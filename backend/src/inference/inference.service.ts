
import { Injectable, Logger } from '@nestjs/common';

const JURISDICTION_CURRENCY: Record<string, string> = {
  'united states': 'USD', 'usa': 'USD', 'us': 'USD', 'new york': 'USD',
  'california': 'USD', 'texas': 'USD', 'florida': 'USD', 'illinois': 'USD',
  'canada': 'CAD', 'ontario': 'CAD', 'quebec': 'CAD', 'british columbia': 'CAD',
  'united kingdom': 'GBP', 'uk': 'GBP', 'england': 'GBP', 'scotland': 'GBP',
  'wales': 'GBP', 'london': 'GBP',
  'germany': 'EUR', 'france': 'EUR', 'italy': 'EUR', 'spain': 'EUR',
  'netherlands': 'EUR', 'belgium': 'EUR', 'austria': 'EUR', 'portugal': 'EUR',
  'finland': 'EUR', 'ireland': 'EUR', 'luxembourg': 'EUR', 'greece': 'EUR',
  'australia': 'AUD', 'new south wales': 'AUD', 'victoria': 'AUD',
  'japan': 'JPY', 'china': 'CNY', 'india': 'INR', 'brazil': 'BRL',
  'switzerland': 'CHF', 'sweden': 'SEK', 'norway': 'NOK', 'denmark': 'DKK',
  'singapore': 'SGD', 'hong kong': 'HKD', 'south korea': 'KRW',
  'new zealand': 'NZD', 'mexico': 'MXN', 'south africa': 'ZAR',
  'uae': 'AED', 'dubai': 'AED', 'abu dhabi': 'AED',
  'saudi arabia': 'SAR', 'qatar': 'QAR', 'kuwait': 'KWD',
};

const ASSET_TYPE_KEYWORDS: { keywords: string[]; type: string }[] = [
  { keywords: ['solar', 'wind', 'renewable', 'hydro', 'geothermal'], type: 'renewable_energy' },
  { keywords: ['power plant', 'power station', 'generation', 'nuclear'], type: 'energy' },
  { keywords: ['oil', 'gas', 'pipeline', 'refinery', 'petroleum'], type: 'oil_and_gas' },
  { keywords: ['office', 'commercial', 'retail', 'mall', 'shopping'], type: 'commercial_real_estate' },
  { keywords: ['industrial', 'warehouse', 'factory', 'manufacturing'], type: 'industrial' },
  { keywords: ['apartment', 'residential', 'housing', 'condo', 'flat'], type: 'residential' },
  { keywords: ['airport', 'port', 'terminal', 'railway', 'highway', 'road', 'bridge'], type: 'transportation' },
  { keywords: ['school', 'university', 'hospital', 'clinic', 'government'], type: 'public_infrastructure' },
  { keywords: ['data center', 'telecom', 'fiber', 'tower', 'cell'], type: 'technology_infrastructure' },
  { keywords: ['farm', 'agricultural', 'farmland', 'crop'], type: 'agriculture' },
  { keywords: ['mine', 'mining', 'quarry', 'mineral'], type: 'mining' },
  { keywords: ['hotel', 'resort', 'hospitality', 'lodging'], type: 'hospitality' },
  { keywords: ['land', 'lot', 'parcel', 'site', 'plot'], type: 'land' },
  { keywords: ['building', 'property', 'real estate', 'estate'], type: 'real_estate' },
];

@Injectable()
export class InferenceService {
  private readonly logger = new Logger(InferenceService.name);

  /**
   * Infer currency from jurisdiction string
   */
  inferCurrency(jurisdiction: string | null): string | null {
    if (!jurisdiction) return null;
    const key = jurisdiction.trim().toLowerCase();

    if (JURISDICTION_CURRENCY[key]) return JURISDICTION_CURRENCY[key];

    // Partial match
    for (const [jKey, currency] of Object.entries(JURISDICTION_CURRENCY)) {
      if (key.includes(jKey) || jKey.includes(key)) return currency;
    }

    return null;
  }

  /**
   * Infer asset type from name and context using keyword matching
   */
  inferAssetType(name: string, context = ''): string | null {
    const combined = `${name} ${context}`.toLowerCase();

    for (const entry of ASSET_TYPE_KEYWORDS) {
      if (entry.keywords.some((kw) => combined.includes(kw))) {
        return entry.type;
      }
    }

    return null;
  }

  /**
   * Infer coordinates from address using OpenStreetMap Nominatim (free, no key)
   */
  async inferCoordinates(address: string): Promise<{ lat: number; lon: number } | null> {
    if (!address?.trim()) return null;

    try {
      const encoded = encodeURIComponent(address.trim());
      const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1`;

      const resp = await fetch(url, {
        headers: { 'User-Agent': 'AssetExtractionPlatform/1.0' },
        signal: AbortSignal.timeout(5000),
      });

      if (!resp.ok) {
        this.logger.warn(`Nominatim error ${resp.status} for address: ${address}`);
        return null;
      }

      const data = await resp.json() as { lat: string; lon: string }[];
      if (!data?.length) return null;

      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

      this.logger.debug(`Inferred coordinates for "${address}": ${lat}, ${lon}`);
      return { lat, lon };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`inferCoordinates failed for "${address}": ${msg}`);
      return null;
    }
  }

  /**
   * Infer value from raw context text — looks for currency + number patterns
   */
  inferValue(context: string): { value: number; basis: string; confidence: number } | null {
    if (!context?.trim()) return null;

    const patterns = [
      // $1.5 billion / USD 1.5B
      { re: /(?:USD|CAD|GBP|EUR|AUD|[\$£€])\s*([\d,]+(?:\.\d+)?)\s*billion/i, multiplier: 1_000_000_000, basis: 'estimated' },
      { re: /(?:USD|CAD|GBP|EUR|AUD|[\$£€])\s*([\d,]+(?:\.\d+)?)\s*million/i, multiplier: 1_000_000, basis: 'estimated' },
      { re: /(?:USD|CAD|GBP|EUR|AUD|[\$£€])\s*([\d,]+(?:\.\d+)?)\s*(?:thousand|k)/i, multiplier: 1_000, basis: 'estimated' },
      // plain number with currency
      { re: /(?:USD|CAD|GBP|EUR|AUD|[\$£€])\s*([\d,]+(?:\.\d+)?)/i, multiplier: 1, basis: 'extracted' },
      // number followed by B/M/K
      { re: /([\d,]+(?:\.\d+)?)\s*B(?:\b|illion)/i, multiplier: 1_000_000_000, basis: 'estimated' },
      { re: /([\d,]+(?:\.\d+)?)\s*M(?:\b|illion)/i, multiplier: 1_000_000, basis: 'estimated' },
    ];

    for (const { re, multiplier, basis } of patterns) {
      const match = context.match(re);
      if (match) {
        const raw = parseFloat(match[1].replace(/,/g, ''));
        if (Number.isFinite(raw) && raw > 0) {
          return {
            value: raw * multiplier,
            basis,
            confidence: basis === 'extracted' ? 0.8 : 0.6,
          };
        }
      }
    }

    return null;
  }
}