import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import type { Asset } from '../types/asset';

async function fetchReviewAssets(): Promise<Asset[]> {
  const res = await api.get<Asset[]>('/assets/review');
  return res.data;
}

async function patchReviewRecommendation(
  id: string,
  reviewRecommendation: Asset['reviewRecommendation'],
): Promise<Asset> {
  const res = await api.patch<Asset>(`/assets/${id}`, { reviewRecommendation });
  return res.data;
}

function Field(props: { label: string; value: React.ReactNode }) {
  return (
    <div className="aep-kv">
      <div className="aep-kv__k">{props.label}</div>
      <div className="aep-kv__v">{props.value}</div>
    </div>
  );
}

export function ReviewPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['assets', 'review'],
    queryFn: fetchReviewAssets,
    staleTime: 5_000,
  });

  const mutation = useMutation({
    mutationFn: ({ id, rec }: { id: string; rec: Asset['reviewRecommendation'] }) =>
      patchReviewRecommendation(id, rec),
    onSuccess: (_updated, vars) => {
      qc.setQueryData<Asset[]>(['assets', 'review'], (prev) =>
        (prev ?? []).filter((a) => a.id !== vars.id),
      );
      qc.invalidateQueries({ queryKey: ['assets', 'all'] }).catch(() => undefined);
    },
  });

  React.useEffect(() => {
    if (isError) toast.error(error instanceof Error ? error.message : 'Failed to load review queue');
  }, [isError, error]);

  const items = data ?? [];

  const act = async (id: string, rec: Asset['reviewRecommendation']) => {
    try {
      await mutation.mutateAsync({ id, rec });
      toast.success(rec === 'auto-accept' ? 'Accepted' : 'Rejected');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    }
  };

  return (
    <div className="aep-page">
      <div className="aep-page__header">
        <h1 className="aep-h1">Review Queue</h1>
        <p className="aep-muted">Assets requiring human review before acceptance.</p>
      </div>

      {isLoading ? (
        <div className="aep-card">Loading…</div>
      ) : items.length === 0 ? (
        <div className="aep-card">No assets currently need review.</div>
      ) : (
        <div className="aep-grid">
          {items.map((a) => (
            <div key={a.id} className="aep-card">
              <div className="aep-card__title">{a.assetName || 'Unnamed asset'}</div>
              <div className="aep-card__subtitle">
                Confidence {(a.overallConfidence * 100).toFixed(0)}% • Source {a.sourceFile}
              </div>

              <div className="aep-kvgrid">
                <Field label="Type" value={a.assetType ?? '—'} />
                <Field
                  label="Value"
                  value={
                    <span className="aep-mono">
                      {a.value ?? '—'} {a.currency ?? ''}
                    </span>
                  }
                />
                <Field label="Jurisdiction" value={a.jurisdiction ?? '—'} />
                <Field
                  label="Coordinates"
                  value={
                    <span className="aep-mono">
                      {a.latitude ?? '—'}, {a.longitude ?? '—'}
                    </span>
                  }
                />
                <Field label="Duplicate Cluster" value={a.duplicateClusterId ?? '—'} />
                <Field label="Value Basis" value={a.valueBasis ?? '—'} />
                <Field label="Parent" value={a.parentAssetId ?? '—'} />
                <Field label="Children" value={a.childAssetIds?.length ? a.childAssetIds.join(', ') : '—'} />
              </div>

              <div className="aep-subsection">
                <div className="aep-subsection__title">Source evidence</div>
                {a.sourceEvidence?.length ? (
                  <div className="aep-evidence">
                    {a.sourceEvidence.map((q, idx) => (
                      <blockquote key={idx} className="aep-quote">
                        {q}
                      </blockquote>
                    ))}
                  </div>
                ) : (
                  <div className="aep-muted">No evidence provided.</div>
                )}
              </div>

              <div className="aep-subsection">
                <div className="aep-subsection__title">Validation flags</div>
                {a.validationFlags?.length ? (
                  <div className="aep-flags">
                    {a.validationFlags.map((f) => (
                      <span key={f} className="aep-flag">
                        {f}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="aep-muted">No validation flags.</div>
                )}
              </div>

              <div className="aep-subsection">
                <div className="aep-subsection__title">Explanation</div>
                <pre className="aep-pre">{a.explanation || '—'}</pre>
              </div>

              <div className="aep-actions">
                <button
                  className="aep-btn aep-btn--primary"
                  disabled={mutation.isPending}
                  onClick={() => act(a.id, 'auto-accept')}
                >
                  Accept
                </button>
                <button
                  className="aep-btn aep-btn--danger"
                  disabled={mutation.isPending}
                  onClick={() => act(a.id, 'reject')}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

