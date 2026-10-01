// @ts-nocheck
function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function extent(values, fallback = [0, 1]) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return fallback;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  return min === max ? [min - 1, max + 1] : [min, max];
}

function ticks(min, max, count = 5) {
  return Array.from({ length: count }, (_, index) => min + ((max - min) * index) / Math.max(1, count - 1));
}

function histogramBins(input, binCount = 10) {
  if (!Array.isArray(input) || !input.length) return [];
  if (input.every((item) => item && typeof item === 'object' && Number.isFinite(Number(item.start)) && Number.isFinite(Number(item.end)))) {
    return input;
  }
  const clean = input.map(Number).filter(Number.isFinite);
  if (!clean.length) return [];
  const count = Math.max(1, Math.min(24, Number(binCount) || 10));
  const min = Math.min(...clean);
  const rawMax = Math.max(...clean);
  const max = rawMax === min ? min + 1 : rawMax;
  const width = (max - min) / count;
  const bins = Array.from({ length: count }, (_, index) => ({
    index,
    start: min + index * width,
    end: index === count - 1 ? max : min + (index + 1) * width,
    count: 0,
    midpoint: min + (index + .5) * width
  }));
  for (const value of clean) {
    const index = Math.min(count - 1, Math.max(0, Math.floor((value - min) / width)));
    bins[index].count += 1;
  }
  return bins;
}

export function lineSeriesChart(rows, series, options = {}) {
  const clean = rows.filter((row) => series.some((item) => Number.isFinite(Number(row[item.key]))));
  if (!clean.length) return '<div class="empty-chart">当前数据不足，无法绘制此图表。</div>';
  const width = options.width || 900;
  const height = options.height || 260;
  const pad = { left: 48, right: 20, top: 18, bottom: 32 };
  const allValues = clean.flatMap((row) => series.map((item) => Number(row[item.key])).filter(Number.isFinite));
  const [rawMin, rawMax] = extent(allValues);
  const min = options.min ?? rawMin;
  const max = options.max ?? rawMax;
  const x = (index) => pad.left + (clean.length <= 1 ? 0 : index / (clean.length - 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - ((Number(value) - min) / Math.max(.000001, max - min))) * (height - pad.top - pad.bottom);
  const grid = ticks(min, max).map((value) => `<g><line class="chart-grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(value)}" y2="${y(value)}"/><text class="chart-label" x="4" y="${y(value) + 3}">${esc(options.formatY ? options.formatY(value) : value.toFixed(1))}</text></g>`).join('');
  const paths = series.map((item, seriesIndex) => {
    let segment = '';
    const path = clean.map((row, index) => {
      const value = Number(row[item.key]);
      if (!Number.isFinite(value)) return '';
      const command = segment ? 'L' : 'M';
      segment = 'open';
      return `${command} ${x(index).toFixed(1)} ${y(value).toFixed(1)}`;
    }).filter(Boolean).join(' ');
    return `<path class="pro-line series-${seriesIndex + 1}" pathLength="1" style="--chart-delay:${seriesIndex * 120 + 70}ms" d="${path}"/>`;
  }).join('');
  const labels = clean.length > 1 ? `<text class="chart-label" x="${pad.left}" y="${height - 7}">${esc(options.startLabel ?? '开始')}</text><text class="chart-label" text-anchor="end" x="${width - pad.right}" y="${height - 7}">${esc(options.endLabel ?? `第 ${clean.length} 局`)}</text>` : '';
  const legend = `<div class="pro-chart-legend">${series.map((item, index) => `<span><i class="series-${index + 1}"></i>${esc(item.label)}</span>`).join('')}</div>`;
  return `<div class="pro-chart">${legend}<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${grid}${paths}${labels}</svg></div>`;
}

export function scatterChart(rows, xKey, yKey, options = {}) {
  const clean = rows.filter((row) => Number.isFinite(Number(row[xKey])) && Number.isFinite(Number(row[yKey])));
  if (!clean.length) return '<div class="empty-chart">当前数据不足，无法绘制此图表。</div>';
  const width = options.width || 900;
  const height = options.height || 280;
  const pad = { left: 48, right: 22, top: 20, bottom: 40 };
  const [xMin, xMax] = extent(clean.map((row) => row[xKey]));
  const [yMin, yMax] = extent(clean.map((row) => row[yKey]));
  const x = (value) => pad.left + ((Number(value) - xMin) / Math.max(.000001, xMax - xMin)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - ((Number(value) - yMin) / Math.max(.000001, yMax - yMin))) * (height - pad.top - pad.bottom);
  const xGrid = ticks(xMin, xMax).map((value) => `<g><line class="chart-grid-line" x1="${x(value)}" x2="${x(value)}" y1="${pad.top}" y2="${height - pad.bottom}"/><text class="chart-label" text-anchor="middle" x="${x(value)}" y="${height - 18}">${esc(options.formatX ? options.formatX(value) : value.toFixed(1))}</text></g>`).join('');
  const yGrid = ticks(yMin, yMax).map((value) => `<g><line class="chart-grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${y(value)}" y2="${y(value)}"/><text class="chart-label" x="4" y="${y(value) + 3}">${esc(options.formatY ? options.formatY(value) : value.toFixed(1))}</text></g>`).join('');
  const dots = clean.map((row, index) => `<circle class="scatter-dot ${row.win ? 'is-win' : 'is-loss'}${row.runId ? ' is-clickable' : ''}" style="--chart-delay:${Math.min(index, 24) * 16 + 220}ms" ${row.runId ? `data-chart-run-id="${esc(row.runId)}" tabindex="0"` : ''} cx="${x(row[xKey])}" cy="${y(row[yKey])}" r="4"><title>${esc(options.tooltip ? options.tooltip(row) : `${row[xKey]} · ${row[yKey]}`)}</title></circle>`).join('');
  return `<div class="pro-chart"><div class="pro-chart-axis-label y">${esc(options.yLabel || yKey)}</div><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${xGrid}${yGrid}${dots}<text class="chart-axis-title" text-anchor="middle" x="${width / 2}" y="${height - 2}">${esc(options.xLabel || xKey)}</text></svg></div>`;
}

export function histogramChart(input, options = {}) {
  const bins = histogramBins(input, options.binCount || 10);
  if (!bins?.length) return '<div class="empty-chart">当前数据不足，无法绘制此分布。</div>';
  const width = options.width || 900;
  const height = options.height || 250;
  const pad = { left: 38, right: 16, top: 18, bottom: 38 };
  const maxCount = Math.max(1, ...bins.map((bin) => Number(bin.count) || 0));
  const slot = (width - pad.left - pad.right) / bins.length;
  const barWidth = Math.max(2, slot - 3);
  const y = (value) => pad.top + (1 - (Number(value) || 0) / maxCount) * (height - pad.top - pad.bottom);
  const bars = bins.map((bin, index) => `<rect class="hist-bar${bin.runIds?.length ? ' is-clickable' : ''}" style="--chart-delay:${Math.min(index, 28) * 18 + 80}ms" ${bin.runIds?.length ? `data-chart-run-ids="${esc(bin.runIds.join(','))}" tabindex="0"` : ''} x="${pad.left + index * slot + 1.5}" y="${y(bin.count)}" width="${barWidth}" height="${height - pad.bottom - y(bin.count)}" rx="4"><title>${esc(options.formatRange ? options.formatRange(bin) : `${bin.start.toFixed(1)}–${bin.end.toFixed(1)}`)} · ${bin.count} 局${bin.runIds?.length ? ' · 点击查看' : ''}</title></rect>`).join('');
  const labelIndexes = [...new Set([0, Math.floor((bins.length - 1) / 2), bins.length - 1])];
  const labels = labelIndexes.map((index) => `<text class="chart-label" text-anchor="middle" x="${pad.left + (index + .5) * slot}" y="${height - 15}">${esc(options.formatX ? options.formatX(bins[index].midpoint) : bins[index].midpoint.toFixed(1))}</text>`).join('');
  return `<div class="pro-chart"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><line class="chart-grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${height - pad.bottom}" y2="${height - pad.bottom}"/>${bars}${labels}<text class="chart-axis-title" text-anchor="middle" x="${width / 2}" y="${height - 1}">${esc(options.xLabel || '')}</text></svg></div>`;
}

export function heatmapChart(rows, options = {}) {
  if (!rows?.length) return '<div class="empty-chart">当前数据不足，无法绘制此热力图。</div>';
  const acts = [...new Set(rows.map((row) => Number(row.act)))].sort((a, b) => a - b);
  const maxFloor = Math.max(1, ...rows.map((row) => Number(row.actFloor) || 0));
  const values = rows.map((row) => Number(row[options.valueKey || 'avgDamage']) || 0);
  const max = Math.max(.000001, ...values);
  const byKey = new Map(rows.map((row) => [`${row.act}:${row.actFloor}`, row]));
  let cellIndex = 0;
  return `<div class="heatmap-wrap"><div class="heatmap-grid" style="--heat-cols:${maxFloor}">${acts.map((act) => Array.from({ length: maxFloor }, (_, index) => {
    const floor = index + 1;
    const row = byKey.get(`${act}:${floor}`);
    const delay = Math.min(cellIndex++, 36) * 10 + 60;
    if (!row) return `<div class="heat-cell is-empty" style="--chart-delay:${delay}ms" title="第 ${act} 阶段 · 阶段内第 ${floor} 层：无样本"></div>`;
    const value = Number(row[options.valueKey || 'avgDamage']) || 0;
    const intensity = Math.min(1, value / max);
    const title = `第 ${act} 阶段 · 阶段内第 ${floor} 层 · ${options.tooltip ? options.tooltip(row) : value.toFixed(2)} · ${row.samples} 个样本`;
    return `<div class="heat-cell${row.runIds?.length ? ' is-clickable' : ''}" ${row.runIds?.length ? `data-chart-run-ids="${esc(row.runIds.join(','))}" tabindex="0"` : ''} style="--heat:${intensity.toFixed(3)};--chart-delay:${delay}ms" title="${esc(title)}${row.runIds?.length ? ' · 点击查看' : ''}"><span>${value >= (options.labelThreshold ?? max * .55) ? esc(options.formatValue ? options.formatValue(value) : value.toFixed(0)) : ''}</span></div>`;
  }).join('')).join('')}</div><div class="heatmap-act-labels">${acts.map((act) => `<span>第 ${act} 阶段</span>`).join('')}</div></div>`;
}

export function divergingBars(rows, options = {}) {
  if (!rows?.length) return '<div class="empty-chart">当前数据不足，无法进行此比较。</div>';
  const key = options.valueKey || 'value';
  const max = Math.max(.000001, ...rows.map((row) => Math.abs(Number(row[key]) || 0)));
  return `<div class="diverging-bars">${rows.map((row) => {
    const value = Number(row[key]) || 0;
    const width = Math.abs(value) / max * 50;
    return `<div class="diverging-row"><span>${esc(row.label || row.name)}</span><div class="diverging-track"><i class="${value >= 0 ? 'positive' : 'negative'}" style="width:${width}%;${value >= 0 ? 'left:50%' : `right:50%`}"></i><b>${esc(options.formatValue ? options.formatValue(value, row) : value.toFixed(2))}</b></div></div>`;
  }).join('')}</div>`;
}
