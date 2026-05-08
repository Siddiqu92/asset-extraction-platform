// ============================================================
// COMPLETE CANONICAL ASSET SCHEMA
// Fixes: missing alternate names, parent/child, value basis,
//        explanation, validation flags, inference metadata
// ============================================================

export type FactType = 'extracted' | 'inferred' | 'estimated' | 'conflicting' | 'unsupported';
export type ReviewRecommendation = 'auto-accept' | 'review' | 'reject';

export interface FieldConfidence {
  value: any;
  confidence: number;          // 0-1
  factType: FactType;
  sourceEvidence: SourceEvidence[];
  explanation: string;         // WHY this value was chosen / how it was derived
  inferenceMethod?: string;    // e.g. "currency-from-jurisdiction", "geocode-from-address"
  conflictsWith?: any[];       // other values seen for same field
}

export interface SourceEvidence {
  fileId: string;
  fileName: string;
  pageNumber?: number;
  rowIndex?: number;
  columnName?: string;
  rawText: string;             // exact snippet from source
  extractionMethod: 'rule-based' | 'openai' | 'claude' | 'ocr' | 'inference';
}

export interface ValidationFlag {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  field?: string;
  details?: any;
}

export interface AssetRelationship {
  relatedAssetId: string;
  relationType: 'parent' | 'child' | 'duplicate' | 'linked';
  confidence: number;
  rationale: string;
}

export interface CanonicalAsset {
  id: string;
  version: number;             // increments on each update (for delta tracking)
  createdAt: string;
  updatedAt: string;

  // ── Core required fields ──────────────────────────────────
  assetName:      FieldConfidence;
  value:          FieldConfidence;
  currency:       FieldConfidence;
  jurisdiction:   FieldConfidence;
  latitude:       FieldConfidence;
  longitude:      FieldConfidence;
  assetType:      FieldConfidence;

  // ── Extended required fields ──────────────────────────────
  alternateNames:  string[];
  valueBasis:      FieldConfidence;  // e.g. "market value", "book value", "assessed value"
  parentAssetId?:  string;
  childAssetIds:   string[];

  // ── Audit / quality fields ─────────────────────────────────
  overallConfidence:      number;
  validationFlags:        ValidationFlag[];
  reviewRecommendation:   ReviewRecommendation;
  duplicateClusterId?:    string;
  relationships:          AssetRelationship[];

  // ── Source tracking ────────────────────────────────────────
  sourceFileIds:   string[];
  extractionRuns:  string[];   // IDs of extraction jobs that contributed
}

// ── Delta / change record ─────────────────────────────────────
export interface AssetDelta {
  assetId: string;
  fromVersion: number;
  toVersion: number;
  changedAt: string;
  triggeredBy: string;         // extraction run ID
  fieldChanges: FieldChange[];
  overallConfidenceChange: number;
  reviewRecommendationChange?: {
    from: ReviewRecommendation;
    to: ReviewRecommendation;
  };
}

export interface FieldChange {
  field: string;
  previousValue: any;
  newValue: any;
  previousConfidence: number;
  newConfidence: number;
  changeType: 'added' | 'updated' | 'removed' | 'confidence-only';
  explanation: string;
}
