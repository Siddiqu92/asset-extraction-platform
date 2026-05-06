import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class CountyGeocodingService {
  private readonly logger = new Logger(CountyGeocodingService.name);
  private readonly countyLookup = new Map<string, { lat: number; lng: number }>();
  private readonly stateCodeToName = new Map<string, string>([
    ['AL', 'alabama'],
    ['AK', 'alaska'],
    ['AZ', 'arizona'],
    ['AR', 'arkansas'],
    ['CA', 'california'],
    ['CO', 'colorado'],
    ['CT', 'connecticut'],
    ['DE', 'delaware'],
    ['DC', 'district of columbia'],
    ['FL', 'florida'],
    ['GA', 'georgia'],
    ['HI', 'hawaii'],
    ['ID', 'idaho'],
    ['IL', 'illinois'],
    ['IN', 'indiana'],
    ['IA', 'iowa'],
    ['KS', 'kansas'],
    ['KY', 'kentucky'],
    ['LA', 'louisiana'],
    ['ME', 'maine'],
    ['MD', 'maryland'],
    ['MA', 'massachusetts'],
    ['MI', 'michigan'],
    ['MN', 'minnesota'],
    ['MS', 'mississippi'],
    ['MO', 'missouri'],
    ['MT', 'montana'],
    ['NE', 'nebraska'],
    ['NV', 'nevada'],
    ['NH', 'new hampshire'],
    ['NJ', 'new jersey'],
    ['NM', 'new mexico'],
    ['NY', 'new york'],
    ['NC', 'north carolina'],
    ['ND', 'north dakota'],
    ['OH', 'ohio'],
    ['OK', 'oklahoma'],
    ['OR', 'oregon'],
    ['PA', 'pennsylvania'],
    ['RI', 'rhode island'],
    ['SC', 'south carolina'],
    ['SD', 'south dakota'],
    ['TN', 'tennessee'],
    ['TX', 'texas'],
    ['UT', 'utah'],
    ['VT', 'vermont'],
    ['VA', 'virginia'],
    ['WA', 'washington'],
    ['WV', 'west virginia'],
    ['WI', 'wisconsin'],
    ['WY', 'wyoming'],
  ]);

  async loadCountyData(csvPath: string): Promise<void> {
    try {
      if (!fs.existsSync(csvPath)) {
        this.logger.warn(`County geocoding CSV not found: ${csvPath}`);
        return;
      }
      const raw = await fs.promises.readFile(csvPath, 'utf8');
      const lines = raw.split(/\r?\n/).filter((x) => x.trim().length > 0);
      if (lines.length < 2) return;
      for (const line of lines.slice(1)) {
        const cells = line.split(',');
        if (cells.length < 4) continue;
        const lat = Number(cells[0]?.trim());
        const lng = Number(cells[1]?.trim());
        const name = cells.slice(3).join(',').trim();
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !name) continue;
        this.countyLookup.set(this.normalize(name), { lat, lng });
      }
      this.logger.log(`Loaded ${this.countyLookup.size} county geocoding entries`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed loading county geocoding table: ${msg}`);
    }
  }

  lookupCounty(county: string, state: string): { lat: number; lng: number } | null {
    const key = this.normalize(`${county}_${state}`);
    return this.countyLookup.get(key) ?? null;
  }

  lookupState(stateCode: string): { lat: number; lng: number } | null {
    const stateName = this.stateCodeToName.get((stateCode ?? '').toUpperCase());
    if (!stateName) return null;
    let latSum = 0;
    let lngSum = 0;
    let count = 0;
    for (const [key, val] of this.countyLookup.entries()) {
      if (key.endsWith(`_${stateName}`)) {
        latSum += val.lat;
        lngSum += val.lng;
        count += 1;
      }
    }
    if (count === 0) return null;
    return { lat: latSum / count, lng: lngSum / count };
  }

  defaultCsvPath(): string {
    return path.join(process.cwd(), '..', 'vcerare-county-lat-long-fips.csv');
  }

  private normalize(value: string): string {
    return (value ?? '').toLowerCase().replace(/\s+/g, '_').replace(/__+/g, '_');
  }
}

