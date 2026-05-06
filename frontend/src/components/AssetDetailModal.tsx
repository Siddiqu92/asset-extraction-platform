import React from 'react';
import type { Asset, AssetFactType, ValidationFlag } from '../types/asset';

type Props = {
  asset: Asset;
  onClose: () => void;
};

function factTypeStyle(ft: AssetFactType | undefined): React.CSSProperties {
  const styles: Record<string, React.CSSProperties> = {
    extracted:   { background: '#2563eb', color: '#fff', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 },
    inferred:    { background: '#d97706', color: '#fff', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 },
    estimated:   { background: '#ca8a04', color: '#fff', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 },
    conflicting: { background: '#dc2626', color: '#fff', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 },
    unsupported: { background: '#6b7280', color: '#fff', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600 },
  };
  return styles[ft ?? 'unsupported'] ?? styles.unsupported;
}

function formatValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return '—';
  if (typeof v === 'string') return v || '—';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function FieldRow(props: { label: string; value: unknown; confidence?: number; factType?: AssetFactType }) {
  const pct = Math.round((props.confidence ?? 0) * 100);
  const barColor = pct > 80 ? '#16a34a' : pct >= 50 ? '#ca8a04' : '#dc2626';
  return (
    <div className="aep-fieldrow">
      <div className="aep-fieldrow__label">{props.label}</div>
      <div className="aep-fieldrow__value">
        <div className="aep-fieldrow__topline">
          <span className="aep-mono">{formatValue(props.value)}</span>
          <span style={factTypeStyle(props.factType)}>{props.factType ?? 'unsupported'}</span>
        </div>
        <div className="aep-progress">
          <div className="aep-progress__bar" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: barColor }} />
        </div>
        <div className="aep-fieldrow__meta">{pct}% confidence</div>
      </div>
    </div>
  );
}

function ValidationFlagsPanel({ flags }: { flags: ValidationFlag[] }) {
  if (!flags || flags.length === 0) {
    return <div className="aep-muted" style={{ color: '#16a34a' }}>No validation issues found.</div>;
  }
  const errors = flags.filter((f) => f.severity === 'error');
  const warnings = flags.filter((f) => f.severity === 'warning');
  return (
    <div>
      {errors.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 600, color: '#dc2626', marginBottom: 6, fontSize: 13 }}>Errors ({errors.length})</div>
          {errors.map((f, i) => (
            <div key={i} style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 6, padding: '8px 12px', marginBottom: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#991b1b', marginBottom: 2 }}>{f.code}</div>
              <div style={{ fontSize: 13, color: '#7f1d1d' }}>{f.message}</div>
            </div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, color: '#d97706', marginBottom: 6, fontSize: 13 }}>Warnings ({warnings.length})</div>
          {warnings.map((f, i) => (
            <div key={i} style={{ background: '#fef9c3', border: '1px solid #fde047', borderRadius: 6, padding: '8px 12px', marginBottom: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#92400e', marginBottom: 2 }}>{f.code}</div>
              <div style={{ fontSize: 13, color: '#78350f' }}>{f.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AssetRelationshipTree({ asset }: { asset: Asset }) {
  const hasParent = !!asset.parentAssetId;
  const hasChildren = asset.childAssetIds && asset.childAssetIds.length > 0;
  if (!hasParent && !hasChildren) {
    return <div className="aep-muted">No parent/child relationships.</div>;
  }
  return (
    <div style={{ fontFamily: 'monospace', fontSize: 13 }}>
      {hasParent && (
        <div style={{ marginBottom: 6 }}>
          <span style={{ color: '#6b7280' }}>Parent: </span>
          <span style={{ background: '#f1f5f9', borderRadius: 4, padding: '2px 8px', color: '#2563eb' }}>{asset.parentAssetId}</span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ background: '#2563eb', color: '#fff', borderRadius: 4, padding: '3px 10px', fontWeight: 600 }}>
          {asset.assetName}
        </span>
        <span style={{ color: '#6b7280', fontSize: 11 }}>(current)</span>
      </div>
      {hasChildren && (
        <div style={{ marginTop: 6, paddingLeft: 20, borderLeft: '2px solid #e2e8f0' }}>
          <div style={{ color: '#6b7280', marginBottom: 4 }}>Children ({asset.childAssetIds.length}):</div>
          {asset.childAssetIds.map((childId, i) => (
            <div key={i} style={{ background: '#f8fafc', borderRadius: 4, padding: '2px 8px', marginBottom: 3, color: '#475569' }}>
              {childId}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AssetDetailModal({ asset, onClose }: Props) {
  const fieldConfidence = asset.fieldConfidence ?? {};
  const factType = asset.factType ?? {};

  const validationFlags: ValidationFlag[] = (asset.validationFlags ?? []).map((f) =>
    typeof f === 'string' ? { code: f, severity: 'warning' as const, message: f } : f as ValidationFlag,
  );

  const fields: Array<{ key: keyof Asset; label: string }> = [
    { key: 'assetName', label: 'Asset Name' },
    { key: 'assetType', label: 'Asset Type' },
    { key: 'value', label: 'Value' },
    { key: 'currency', label: 'Currency' },
    { key: 'valueBasis', label: 'Value Basis' },
    { key: 'jurisdiction', label: 'Jurisdiction' },
    { key: 'latitude', label: 'Latitude' },
    { key: 'longitude', label: 'Longitude' },
  ];

  const altNamesRaw = (asset.alternateNames ?? []).concat(asset.alternateName ?? []);
  const altNames = altNamesRaw.filter((n, i) => n && n !== asset.assetName && altNamesRaw.indexOf(n) === i);

  return (
    <div className="aep-modal__backdrop" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="aep-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="aep-modal__header">
          <div>
            <div className="aep-modal__title">{asset.assetName || 'Asset detail'}</div>
            <div className="aep-modal__subtitle">
              Confidence: {(asset.overallConfidence * 100).toFixed(0)}%
              {' | '}Review: {asset.reviewRecommendation}
              {asset.valueBasis && (
                <span style={{ marginLeft: 8, background: '#f1f5f9', borderRadius: 4, padding: '1px 6px', fontSize: 12, fontWeight: 600 }}>
                  {asset.valueBasis}
                </span>
              )}
              {validationFlags.length > 0 && (
                <span style={{ marginLeft: 8, color: '#dc2626', fontWeight: 700 }}>
                  {validationFlags.length} issue{validationFlags.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
          <button className="aep-btn aep-btn--ghost" onClick={onClose}>Close</button>
        </div>

        <div className="aep-modal__content">
          <section className="aep-section">
            <div className="aep-section__title">Fields</div>
            <div style={{ marginBottom: 8, fontSize: 12, color: '#64748b' }}>
              {(['extracted','inferred','estimated','conflicting','unsupported'] as AssetFactType[]).map((ft) => (
                <span key={ft} style={{ ...factTypeStyle(ft), marginRight: 6 }}>{ft}</span>
              ))}
            </div>
            <div className="aep-fields">
              {fields.map((f) => (
                <FieldRow key={String(f.key)} label={f.label} value={asset[f.key]}
                  confidence={fieldConfidence[String(f.key)]} factType={factType[String(f.key)] as AssetFactType} />
              ))}
            </div>
          </section>

          {altNames.length > 0 && (
            <section className="aep-section">
              <div className="aep-section__title">Alternate Names</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {altNames.map((n, i) => (
                  <span key={i} style={{ background: '#f1f5f9', borderRadius: 4, padding: '3px 10px', fontSize: 13, color: '#334155' }}>{n}</span>
                ))}
              </div>
            </section>
          )}

          <section className="aep-section">
            <div className="aep-section__title">Asset Relationships</div>
            <AssetRelationshipTree asset={asset} />
          </section>

          <section className="aep-section">
            <div className="aep-section__title">
              Validation Flags
              {validationFlags.length > 0 && (
                <span style={{ marginLeft: 8, background: '#fee2e2', color: '#dc2626', borderRadius: 10, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>
                  {validationFlags.length}
                </span>
              )}
            </div>
            <ValidationFlagsPanel flags={validationFlags} />
          </section>

          <section className="aep-section">
            <div className="aep-section__title">Source Evidence</div>
            {asset.sourceEvidence?.length ? (
              <div className="aep-evidence">
                {asset.sourceEvidence.map((q, idx) => <blockquote key={idx} className="aep-quote">{q}</blockquote>)}
              </div>
            ) : <div className="aep-muted">No evidence provided.</div>}
          </section>

          <section className="aep-section">
            <div className="aep-section__title">Explanation</div>
            <pre className="aep-pre">{asset.explanation || '—'}</pre>
          </section>

          <section className="aep-section">
            <div className="aep-section__title">Metadata</div>
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.8 }}>
              <div><strong>ID:</strong> {asset.id}</div>
              <div><strong>Source File:</strong> {asset.sourceFile}</div>
              <div><strong>Job ID:</strong> {asset.sourceJobId}</div>
              <div><strong>Dataset Type:</strong> {asset.datasetType ?? '—'}</div>
              <div><strong>Duplicate Cluster:</strong> {asset.duplicateClusterId ?? 'None'}</div>
              <div><strong>Created:</strong> {new Date(asset.createdAt).toLocaleString()}</div>
              <div><strong>Updated:</strong> {new Date(asset.updatedAt).toLocaleString()}</div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}