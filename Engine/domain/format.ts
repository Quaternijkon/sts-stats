import { metricFor } from './query.js';

export function formatNumber(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(value);
}

export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`;
}

export function formatMetric(metricId: string, value: number | string | null): string {
  if (typeof value === 'string') return value;
  if (value === null || !Number.isFinite(value)) return '—';
  const format = metricFor(metricId)?.format;
  if (format === 'percent') return formatPercent(value);
  if (format === 'duration') return formatDuration(value);
  if (format === 'floors') return `${formatNumber(value)} 层`;
  return formatNumber(value);
}

export function formatDateTime(timestamp: number | null): string {
  if (!timestamp) return '尚未刷新';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(timestamp);
}

export function downloadText(name: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
