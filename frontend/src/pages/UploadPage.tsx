import React, { useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';

type UploadResponse = {
  jobId: string;
  assetCount: number;
  assets: unknown[];
  duplicatesFound: number;
};

const ACCEPT = {
  'application/pdf': ['.pdf'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'text/csv': ['.csv'],
  'application/zip': ['.zip'],
} as const;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function UploadPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);

  const { mutateAsync, isPending } = useMutation({
    mutationFn: async (f: File) => {
      const fd = new FormData();
      fd.append('file', f);
      const res = await api.post<UploadResponse>('/ingestion/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data;
    },
  });

  const onDrop = (acceptedFiles: File[]) => {
    setFile(acceptedFiles[0] ?? null);
  };

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    accept: ACCEPT,
    multiple: false,
    onDrop,
    maxSize: 50 * 1024 * 1024,
  });

  const rejectionText = useMemo(() => {
    if (!fileRejections.length) return null;
    const first = fileRejections[0];
    const reason = first.errors[0]?.message ?? 'File rejected';
    return reason;
  }, [fileRejections]);

  const handleUpload = async () => {
    if (!file) {
      toast.error('Please select a file first');
      return;
    }
    try {
      const data = await mutateAsync(file);
      toast.success(`${data.assetCount} assets extracted`);
      navigate('/assets');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      toast.error(msg);
    }
  };

  return (
    <div className="aep-page">
      <div className="aep-page__header">
        <h1 className="aep-h1">Upload</h1>
        <p className="aep-muted">
          Drag-and-drop a document to extract assets. Supported: PDF, Excel, CSV, ZIP.
        </p>
      </div>

      <div className="aep-card">
        <div
          {...getRootProps()}
          className={`aep-dropzone ${isDragActive ? 'aep-dropzone--active' : ''}`}
        >
          <input {...getInputProps()} />
          <div className="aep-dropzone__title">
            {isDragActive ? 'Drop the file here…' : 'Drag & drop a file here, or click to select'}
          </div>
          <div className="aep-dropzone__subtitle">Max size 50 MB</div>
        </div>

        {rejectionText ? <div className="aep-alert aep-alert--error">{rejectionText}</div> : null}

        {file ? (
          <div className="aep-fileinfo">
            <div className="aep-fileinfo__row">
              <div className="aep-fileinfo__label">Name</div>
              <div className="aep-fileinfo__value">{file.name}</div>
            </div>
            <div className="aep-fileinfo__row">
              <div className="aep-fileinfo__label">Type</div>
              <div className="aep-fileinfo__value">{file.type || '—'}</div>
            </div>
            <div className="aep-fileinfo__row">
              <div className="aep-fileinfo__label">Size</div>
              <div className="aep-fileinfo__value">{formatBytes(file.size)}</div>
            </div>
          </div>
        ) : null}

        <div className="aep-actions">
          <button className="aep-btn aep-btn--primary" onClick={handleUpload} disabled={isPending}>
            {isPending ? (
              <span className="aep-spinner" aria-label="Uploading and processing" />
            ) : null}
            {isPending ? 'Processing…' : 'Upload & Extract'}
          </button>
          <button className="aep-btn" onClick={() => setFile(null)} disabled={isPending}>
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

