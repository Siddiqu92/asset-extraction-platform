import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import type { Asset, AssetDelta, ValidationFlag } from '../types/asset';
import { AssetDetailModal } from '../components/AssetDetailModal';

async function fetchAssets(): Promise<Asset[]> {
  const res = await api.get<Asset[]>('/assets');
  return res.data;
}

async function fetchDelta(jobId: string): Promise<AssetDelta[]> {
  const res = await api.get<AssetDelta[]>(`/assets/delta/${jobId}`);
  return res.data;
}

function confidenceClass(conf: number): string {
  if (conf > 0.8) return 'aep-pill aep-pill--green';
  if (conf >= 0.5) return 'aep-pill aep-pill--yellow';
  return 'aep-pill aep-pill--red';
}

function formatValue(value: number | null | undefined, currency: string | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const cur = (currency ?? 'USD').trim() || 'USD';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: cur.length === 3 ? cur : 'USD',
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${cur} ${value.toLocaleString()}`;
  }
}

function reviewClass(r: Asset['reviewRecommendation']): string {
  if (r === 'auto-accept') return 'aep-pill aep-pill--green';
  if (r === 'review') return 'aep-pill aep-pill--yellow';
  return 'aep-pill aep-pill--red';
}

function reviewLabel(r: Asset['reviewRecommendation']): string {
  if (r === 'auto-accept') return 'Auto Accept';
  if (r === 'review') return 'Needs Review';
  return 'Reject';
}

function sourceTypeLabel(datasetType?: string): string {
  switch ((datasetType ?? 'UNKNOWN').toUpperCase()) {
    case 'NY_ASSESSMENT_ROLL': return '🏛️ NY Assessment';
    case 'EIA860_PLANT':
    case 'EIA860_GENERATOR': return '⚡ EIA-860 Plant';
    case 'GSA_BUILDINGS': return '🏢 GSA Buildings';
    case 'FEDERAL_INSTALLATIONS': return '🏢 Federal Facilities';
    case 'EUROPEAN_RENEWABLE': return '🌬️ Renewable Energy';
    case 'CORPORATE_ANNUAL_REPORT': return '🏦 Annual Report';
    case 'INVESTOR_PRESENTATION': return '📊 Investor Presentation';
    case 'SEC_FILING': return '📄 SEC Filing';
    case 'EIA861_SALES': return '💡 Utility Sales';
    case 'REMPD_REFERENCE': return '📚 REMPD Reference';
    case 'COUNTY_GEOCODING_REF': return '🗺️ County Reference';
    default: return '—';
  }
}

// FactType badge colors
function factTypeBadge(ft: string): React.ReactElement {
  const styles: Record<string, React.CSSProperties> = {
    extracted:   { background: '#2563eb', color: '#fff' },
    inferred:    { background: '#d97706', color: '#fff' },
    estimated:   { background: '#ca8a04', color: '#fff' },
    conflicting: { background: '#dc2626', color: '#fff' },
    unsupported: { background: '#6b7280', color: '#fff' },
  };
  const style = styles[ft] ?? styles.unsupported;
  return (
    <span style={{ ...style, borderRadius: 4, padding: '2px 6px', fontSize: 11, fontWeight: 600 }}>
      {ft}
    </span>
  );
}

// Delta change type colors
function deltaChangeStyle(changeType: AssetDelta['changeType']): React.CSSProperties {
  if (changeType === 'added')    return { background: '#dcfce7', borderLeft: '4px solid #16a34a', padding: '6px 10px', marginBottom: 4 };
  if (changeType === 'removed')  return { background: '#fee2e2', borderLeft: '4px solid #dc2626', padding: '6px 10px', marginBottom: 4 };
  return { background: '#fef9c3', borderLeft: '4px solid #ca8a04', padding: '6px 10px', marginBottom: 4 };
}

type TabType = 'assets' | 'review' | 'changes';

export function AssetsPage() {
  const [selected, setSelected]   = useState<Asset | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('assets');
  const [deltaJobId, setDeltaJobId] = useState('');
  const [deltaJobInput, setDeltaJobInput] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['assets', 'all'],
    queryFn: fetchAssets,
    staleTime: 5_000,
  });

  const { data: deltaData, isLoading: deltaLoading, refetch: refetchDelta } = useQuery({
    queryKey: ['delta', deltaJobId],
    queryFn: () => fetchDelta(deltaJobId),
    enabled: deltaJobId.length > 0,
    staleTime: 0,
  });

  const rows        = useMemo(() => data ?? [], [data]);
  const reviewRows  = useMemo(() => rows.filter((a) => a.reviewRecommendation === 'review'), [rows]);
  const deltas      = useMemo(() => deltaData ?? [], [deltaData]);

  React.useEffect(() => {
    if (isError) toast.error(error instanceof Error ? error.message : 'Failed to load assets');
  }, [isError, error]);

  const tabBtn = (tab: TabType, label: string, count?: number) => (
    <button
      onClick={() => setActiveTab(tab)}
      style={{
        padding: '8px 18px',
        borderRadius: '6px 6px 0 0',
        border: 'none',
        cursor: 'pointer',
        fontWeight: activeTab === tab ? 700 : 400,
        background: activeTab === tab ? '#fff' : '#f1f5f9',
        borderBottom: activeTab === tab ? '2px solid #2563eb' : '2px solid transparent',
        marginRight: 4,
      }}
    >
      {label}{count !== undefined ? ` (${count})` : ''}
    </button>
  );

  return (
    <div className="aep-page">
      <div className="aep-page__header aep-page__header--row">
        <div>
          <h1 className="aep-h1">Assets</h1>
          <p className="aep-muted">All extracted assets currently stored in memory.</p>
        </div>
        <button className="aep-btn" onClick={() => refetch()} disabled={isLoading}>
          Refresh
        </button>
      </div>

      {/* TABS */}
      <div style={{ marginBottom: 0, borderBottom: '1px solid #e2e8f0' }}>
        {tabBtn('assets',  '📋 All Assets',   rows.length)}
        {tabBtn('review',  '🔍 Review Queue', reviewRows.length)}
        {tabBtn('changes', '📊 Changes')}
      </div>

      {/* ALL ASSETS TAB */}
      {activeTab === 'assets' && (
        <div className="aep-card aep-card--p0">
          <div className="aep-tablewrap">
            <table className="aep-table">
              <thead>
                <tr>
                  <th>Asset Name</th>
                  <th>Type</th>
                  <th>Value</th>
                  <th>Value Basis</th>
                  <th>Currency</th>
                  <th>Jurisdiction</th>
                  <th>Lat</th>
                  <th>Lng</th>
                  <th>Confidence</th>
                  <th>Fact Type</th>
                  <th>Flags</th>
                  <th>Review</th>
                  <th>Source Type</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={13} className="aep-td-muted">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={13} className="aep-td-muted">No assets yet. Upload a file to extract.</td></tr>
                ) : (
                  rows.map((a) => (
                    <tr key={a.id} className="aep-tr-click" onClick={() => setSelected(a)}>
                      <td className="aep-td-strong">{a.assetName}</td>
                      <td>{a.assetType ?? '—'}</td>
                      <td className="aep-mono">{formatValue(a.value, a.currency)}</td>
                      <td>
                        {a.valueBasis ? (
                          <span style={{ background: '#f1f5f9', borderRadius: 4, padding: '2px 6px', fontSize: 11 }}>
                            {a.valueBasis}
                          </span>
                        ) : '—'}
                      </td>
                      <td>{a.currency ?? '—'}</td>
                      <td>{a.jurisdiction ?? '—'}</td>
                      <td className="aep-mono">{a.latitude ?? '—'}</td>
                      <td className="aep-mono">{a.longitude ?? '—'}</td>
                      <td>
                        <span className={confidenceClass(a.overallConfidence)}>
                          {(a.overallConfidence * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td>{factTypeBadge(a.factType?.assetName ?? 'unsupported')}</td>
                      <td>
                        {(a.validationFlags?.length ?? 0) > 0 ? (
                          <span style={{ color: '#dc2626', fontWeight: 700, fontSize: 13 }}>
                            ⚠️ {a.validationFlags.length}
                          </span>
                        ) : (
                          <span style={{ color: '#16a34a', fontSize: 13 }}>✓</span>
                        )}
                      </td>
                      <td>
                        <span className={reviewClass(a.reviewRecommendation)}>
                          {reviewLabel(a.reviewRecommendation)}
                        </span>
                      </td>
                      <td>{sourceTypeLabel(a.datasetType)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* REVIEW QUEUE TAB */}
      {activeTab === 'review' && (
        <div className="aep-card aep-card--p0">
          <div className="aep-tablewrap">
            <table className="aep-table">
              <thead>
                <tr>
                  <th>Asset Name</th>
                  <th>Type</th>
                  <th>Value</th>
                  <th>Value Basis</th>
                  <th>Confidence</th>
                  <th>Validation Flags</th>
                  <th>Jurisdiction</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {reviewRows.length === 0 ? (
                  <tr><td colSpan={8} className="aep-td-muted">No assets need review.</td></tr>
                ) : (
                  reviewRows.map((a) => (
                    <tr key={a.id} className="aep-tr-click" onClick={() => setSelected(a)}>
                      <td className="aep-td-strong">{a.assetName}</td>
                      <td>{a.assetType ?? '—'}</td>
                      <td className="aep-mono">{formatValue(a.value, a.currency)}</td>
                      <td>
                        {a.valueBasis ? (
                          <span style={{ background: '#f1f5f9', borderRadius: 4, padding: '2px 6px', fontSize: 11 }}>
                            {a.valueBasis}
                          </span>
                        ) : '—'}
                      </td>
                      <td>
                        <span className={confidenceClass(a.overallConfidence)}>
                          {(a.overallConfidence * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td>
                        {(a.validationFlags ?? []).length === 0 ? (
                          <span style={{ color: '#6b7280', fontSize: 12 }}>None</span>
                        ) : (
                          <div>
                            {(a.validationFlags as ValidationFlag[]).map((f, i) => (
                              <div key={i} style={{ fontSize: 11, marginBottom: 2 }}>
                                {f.severity === 'error' ? '🔴' : '⚠️'} <strong>{f.code}</strong>: {f.message}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>{a.jurisdiction ?? '—'}</td>
                      <td className="aep-td-muted">{a.sourceFile ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CHANGES / DELTA TAB */}
      {activeTab === 'changes' && (
        <div className="aep-card">
          <p className="aep-muted" style={{ marginBottom: 12 }}>
            Enter a Job ID to see what changed between uploads of the same file.
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <input
              type="text"
              placeholder="Enter Job ID (e.g. abc123)"
              value={deltaJobInput}
              onChange={(e) => setDeltaJobInput(e.target.value)}
              style={{ flex: 1, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
            />
            <button
              className="aep-btn aep-btn--primary"
              onClick={() => { setDeltaJobId(deltaJobInput.trim()); refetchDelta(); }}
              disabled={!deltaJobInput.trim()}
            >
              Load Changes
            </button>
          </div>

          {deltaLoading && <p className="aep-muted">Loading changes…</p>}

          {!deltaLoading && deltaJobId && deltas.length === 0 && (
            <p className="aep-muted">No changes found for this job ID.</p>
          )}

          {deltas.length > 0 && (
            <div>
              <p style={{ fontWeight: 600, marginBottom: 12 }}>
                {deltas.length} change(s) detected:
              </p>
              {deltas.map((d, i) => (
                <div key={i} style={deltaChangeStyle(d.changeType)}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {d.changeType === 'added' ? '➕' : d.changeType === 'removed' ? '➖' : '✏️'}
                    {' '}{d.assetName}
                    <span style={{ fontWeight: 400, fontSize: 12, marginLeft: 8, color: '#64748b' }}>
                      [{d.changeType.toUpperCase()}]
                    </span>
                  </div>
                  {d.changedFields.length > 0 && (
                    <table style={{ marginTop: 6, fontSize: 12, borderCollapse: 'collapse', width: '100%' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', padding: '2px 8px', color: '#475569' }}>Field</th>
                          <th style={{ textAlign: 'left', padding: '2px 8px', color: '#dc2626' }}>Old Value</th>
                          <th style={{ textAlign: 'left', padding: '2px 8px', color: '#16a34a' }}>New Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.changedFields.map((cf, j) => (
                          <tr key={j}>
                            <td style={{ padding: '2px 8px', fontWeight: 600 }}>{cf.field}</td>
                            <td style={{ padding: '2px 8px', color: '#dc2626' }}>{String(cf.oldValue ?? '—')}</td>
                            <td style={{ padding: '2px 8px', color: '#16a34a' }}>{String(cf.newValue ?? '—')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {selected ? <AssetDetailModal asset={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}