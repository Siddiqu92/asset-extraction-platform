import React from 'react';
import type { Asset, AssetFactType } from '../types/asset';

type Props = {
  asset: Asset;
  onClose: () => void;
};

function factTypeClass(ft: AssetFactType | undefined): string {
  switch (ft) {
    case 'extracted':
      return 'aep-ft aep-ft--extracted';
    case 'inferred':
      return 'aep-ft aep-ft--inferred';
    case 'estimated':
      return 'aep-ft aep-ft--estimated';
    case 'conflicting':
      return 'aep-ft aep-ft--conflicting';
    default:
      return 'aep-ft aep-ft--unsupported';
  }
}

function formatValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function FieldRow(props: {
  label: string;
  value: unknown;
  confidence?: number;
  factType?: AssetFactType;
}) {
  const pct = Math.round(((props.confidence ?? 0) * 100 + Number.EPSILON) * 100) / 100;
  return (
    <div className="aep-fieldrow">
      <div className="aep-fieldrow__label">{props.label}</div>
      <div className="aep-fieldrow__value">
        <div className="aep-fieldrow__topline">
          <span className="aep-mono">{formatValue(props.value)}</span>
          <span className={factTypeClass(props.factType)}>{props.factType ?? 'unsupported'}</span>
        </div>
        <div className="aep-progress">
          <div className="aep-progress__bar" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
        <div className="aep-fieldrow__meta">{pct.toFixed(0)}% confidence</div>
      </div>
    </div>
  );
}

export function AssetDetailModal({ asset, onClose }: Props) {
  const fieldConfidence = asset.fieldConfidence ?? {};
  const factType = asset.factType ?? {};

  const fields: Array<{ key: keyof Asset; label: string }> = [
    { key: 'id', label: 'ID' },
    { key: 'assetName', label: 'Asset Name' },
    { key: 'alternateName', label: 'Alternate Names' },
    { key: 'assetType', label: 'Asset Type' },
    { key: 'value', label: 'Value' },
    { key: 'currency', label: 'Currency' },
    { key: 'jurisdiction', label: 'Jurisdiction' },
    { key: 'latitude', label: 'Latitude' },
    { key: 'longitude', label: 'Longitude' },
    { key: 'valueBasis', label: 'Value Basis' },
    { key: 'parentAssetId', label: 'Parent Asset ID' },
    { key: 'childAssetIds', label: 'Child Asset IDs' },
    { key: 'duplicateClusterId', label: 'Duplicate Cluster ID' },
    { key: 'reviewRecommendation', label: 'Review Recommendation' },
    { key: 'overallConfidence', label: 'Overall Confidence' },
    { key: 'sourceFile', label: 'Source File' },
    { key: 'sourceJobId', label: 'Source Job ID' },
    { key: 'createdAt', label: 'Created At' },
    { key: 'updatedAt', label: 'Updated At' },
  ];

  return (
    <div className="aep-modal__backdrop" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="aep-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="aep-modal__header">
          <div>
            <div className="aep-modal__title">{asset.assetName || 'Asset detail'}</div>
            <div className="aep-modal__subtitle">
              Overall confidence: {(asset.overallConfidence * 100).toFixed(0)}% • Review:{' '}
              {asset.reviewRecommendation}
            </div>
          </div>
          <button className="aep-btn aep-btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="aep-modal__content">
          <section className="aep-section">
            <div className="aep-section__title">Fields</div>
            <div className="aep-fields">
              {fields.map((f) => (
                <FieldRow
                  key={String(f.key)}
                  label={f.label}
                  value={asset[f.key]}
                  confidence={fieldConfidence[String(f.key)]}
                  factType={factType[String(f.key)]}
                />
              ))}
            </div>
          </section>

          <section className="aep-section">
            <div className="aep-section__title">Source evidence</div>
            {asset.sourceEvidence?.length ? (
              <div className="aep-evidence">
                {asset.sourceEvidence.map((q, idx) => (
                  <blockquote key={idx} className="aep-quote">
                    {q}
                  </blockquote>
                ))}
              </div>
            ) : (
              <div className="aep-muted">No evidence provided.</div>
            )}
          </section>

          <section className="aep-section">
            <div className="aep-section__title">Validation flags</div>
            {asset.validationFlags?.length ? (
              <div className="aep-flags">
                {asset.validationFlags.map((f) => (
                  <span key={f} className="aep-flag">
                    {f}
                  </span>
                ))}
              </div>
            ) : (
              <div className="aep-muted">No validation flags.</div>
            )}
          </section>

          <section className="aep-section">
            <div className="aep-section__title">Explanation</div>
            <pre className="aep-pre">{asset.explanation || '—'}</pre>
          </section>
        </div>
      </div>
    </div>
  );
}

