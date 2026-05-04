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
  alternateName: string[];
  value: number | null;
  currency: string | null;
  jurisdiction: string | null;
  latitude: number | null;
  longitude: number | null;
  assetType: string | null;
  valueBasis: string | null;
  parentAssetId: string | null;
  childAssetIds: string[];
  fieldConfidence: Record<string, number>;
  overallConfidence: number;
  sourceEvidence: string[];
  explanation: string;
  validationFlags: string[];
  duplicateClusterId: string | null;
  reviewRecommendation: ReviewRecommendation;
  factType: Record<string, AssetFactType>;
  sourceFile: string;
  sourceJobId: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

