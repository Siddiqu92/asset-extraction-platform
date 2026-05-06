export type DatasetType =
  | 'NY_ASSESSMENT_ROLL'
  | 'GSA_BUILDINGS'
  | 'FEDERAL_INSTALLATIONS'
  | 'EIA860_PLANT'
  | 'EIA860_GENERATOR'
  | 'EIA861_SALES'
  | 'EUROPEAN_RENEWABLE'
  | 'REMPD_REFERENCE'
  | 'COUNTY_GEOCODING_REF'
  | 'CORPORATE_ANNUAL_REPORT'
  | 'INVESTOR_PRESENTATION'
  | 'UNKNOWN';

export function detectDatasetType(filename: string): DatasetType {
  const fn = (filename ?? '').toLowerCase();
  if (fn.includes('assessment-roll') || fn.includes('assessment_roll')) return 'NY_ASSESSMENT_ROLL';
  if (fn.includes('rexus') || fn.includes('bldg')) return 'GSA_BUILDINGS';
  if (fn.includes('frpp')) return 'FEDERAL_INSTALLATIONS';
  if (fn.includes('plant_y20')) return 'EIA860_PLANT';
  if (fn.includes('generator_y20')) return 'EIA860_GENERATOR';
  if (fn.match(/table_\d+/)) return 'EIA861_SALES';
  if (fn.match(/wind_energy|solar_energy|bioenergy|hydropower|energy_storage/))
    return 'EUROPEAN_RENEWABLE';
  if (fn.includes('rempd') || fn.includes('material_quantity')) return 'REMPD_REFERENCE';
  if (fn.includes('vcerare') || fn.includes('lat-long-fips')) return 'COUNTY_GEOCODING_REF';
  if (fn.includes('annual-report') || fn.includes('annual_report') || fn.includes('10-k'))
    return 'CORPORATE_ANNUAL_REPORT';
  if (fn.includes('investor-presentation') || fn.includes('investor_presentation'))
    return 'INVESTOR_PRESENTATION';
  return 'UNKNOWN';
}

