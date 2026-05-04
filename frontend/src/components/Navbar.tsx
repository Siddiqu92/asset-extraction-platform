import React from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Asset } from '../types/asset';

async function fetchReviewAssets(): Promise<Asset[]> {
  const res = await api.get<Asset[]>('/assets/review');
  return res.data;
}

export function Navbar() {
  const { data } = useQuery({
    queryKey: ['assets', 'review'],
    queryFn: fetchReviewAssets,
    staleTime: 10_000,
  });

  const reviewCount = data?.length ?? 0;

  return (
    <header className="aep-navbar">
      <div className="aep-navbar__brand">Asset Extraction</div>
      <nav className="aep-navbar__links">
        <NavLink className="aep-navlink" to="/upload">
          Upload
        </NavLink>
        <NavLink className="aep-navlink" to="/assets">
          Assets
        </NavLink>
        <NavLink className="aep-navlink" to="/review">
          <span>Review Queue</span>
          {reviewCount > 0 ? (
            <span className="aep-badge" aria-label={`Review queue count: ${reviewCount}`}>
              {reviewCount}
            </span>
          ) : null}
        </NavLink>
      </nav>
    </header>
  );
}

