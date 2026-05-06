import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import type { Asset } from '../types/asset';
import { AssetDetailModal } from '../components/AssetDetailModal';

async function fetchAssets(): Promise<Asset[]> {
  const res = await api.get<Asset[]>('/assets');
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
    case 'NY_ASSESSMENT_ROLL':
      return '🏛️ NY Assessment';
    case 'EIA860_PLANT':
    case 'EIA860_GENERATOR':
      return '⚡ EIA-860 Plant';
    case 'GSA_BUILDINGS':
      return '🏢 GSA Buildings';
    case 'FEDERAL_INSTALLATIONS':
      return '🏢 Federal Facilities';
    case 'EUROPEAN_RENEWABLE':
      return '🌬️ Renewable Energy';
    case 'CORPORATE_ANNUAL_REPORT':
      return '🏦 Annual Report';
    case 'INVESTOR_PRESENTATION':
      return '📊 Investor Presentation';
    case 'SEC_FILING':
      return '📄 SEC Filing';
    case 'EIA861_SALES':
      return '💡 Utility Sales';
    case 'REMPD_REFERENCE':
      return '📚 REMPD Reference';
    case 'COUNTY_GEOCODING_REF':
      return '🗺️ County Reference';
    default:
      return '—';
  }
}

export function AssetsPage() {
  const [selected, setSelected] = useState<Asset | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['assets', 'all'],
    queryFn: fetchAssets,
    staleTime: 5_000,
  });

  const rows = useMemo(() => data ?? [], [data]);

  React.useEffect(() => {
    if (isError) {
      toast.error(error instanceof Error ? error.message : 'Failed to load assets');
    }
  }, [isError, error]);

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

      <div className="aep-card aep-card--p0">
        <div className="aep-tablewrap">
          <table className="aep-table">
            <thead>
              <tr>
                <th>Asset Name</th>
                <th>Type</th>
                <th>Value</th>
                <th>Currency</th>
                <th>Jurisdiction</th>
                <th>Lat</th>
                <th>Lng</th>
                <th>Confidence</th>
                <th>Fact Type</th>
                <th>Review</th>
                <th>Source</th>
                <th>Source Type</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={12} className="aep-td-muted">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="aep-td-muted">
                    No assets yet. Upload a file to extract.
                  </td>
                </tr>
              ) : (
                rows.map((a) => (
                  <tr key={a.id} className="aep-tr-click" onClick={() => setSelected(a)}>
                    <td className="aep-td-strong">{a.assetName}</td>
                    <td>{a.assetType ?? '—'}</td>
                    <td className="aep-mono">{formatValue(a.value, a.currency)}</td>
                    <td>{a.currency ?? '—'}</td>
                    <td>{a.jurisdiction ?? '—'}</td>
                    <td className="aep-mono">{a.latitude ?? '—'}</td>
                    <td className="aep-mono">{a.longitude ?? '—'}</td>
                    <td>
                      <span className={confidenceClass(a.overallConfidence)}>
                        {(a.overallConfidence * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td>
                      <span className="aep-pill aep-pill--neutral">
                        {a.factType?.assetName ?? 'unsupported'}
                      </span>
                    </td>
                    <td>
                      <span className={reviewClass(a.reviewRecommendation)}>
                        {reviewLabel(a.reviewRecommendation)}
                      </span>
                    </td>
                    <td className="aep-td-muted" title={a.sourceFile}>
                      {a.sourceFile ?? '—'}
                    </td>
                    <td>{sourceTypeLabel(a.datasetType)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected ? <AssetDetailModal asset={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

