export type AssetFactType =
  | 'extracted'
  | 'inferred'
  | 'estimated'
  | 'conflicting'
  | 'unsupported';

export type ReviewRecommendation = 'auto-accept' | 'review' | 'reject';

export interface Asset {
  id: string;
  assetName: string;
  alternateName: string[];       // kept for backward compat
  alternateNames: string[];      // NEW — assessment requirement
  value: number | null;
  currency: string | null;
  jurisdiction: string | null;
  latitude: number | null;
  longitude: number | null;
  assetType: string | null;
  valueBasis: string | null;     // e.g. "book_value", "market_value"
  parentAssetId: string | null;  // for child assets
  childAssetIds: string[];       // for parent assets
  fieldConfidence: Record<string, number>;
  overallConfidence: number;
  sourceEvidence: string[];
  explanation: string;
  validationFlags: ValidationFlag[];  // UPDATED — structured flags
  duplicateClusterId: string | null;
  reviewRecommendation: ReviewRecommendation;
  factType: Record<string, AssetFactType>;
  sourceFile: string;
  sourceJobId: string;
  datasetType?: string;
  createdAt: Date;
  updatedAt: Date;
}

// NEW — structured validation flag
export interface ValidationFlag {
  code: string;
  severity: 'warning' | 'error';
  message: string;
}

// NEW — delta tracking
export interface AssetDelta {
  assetId: string;
  assetName: string;
  changeType: 'added' | 'removed' | 'modified';
  changedFields: {
    field: string;
    oldValue: unknown;
    newValue: unknown;
  }[];
}