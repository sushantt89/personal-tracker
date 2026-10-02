import type { ReactNode } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, AreaChart, Area, ReferenceLine,
} from 'recharts';
import { Box, Stack, Typography, useTheme } from '@mui/material';
import { money } from '../utils/format';
import { useThemeMode } from '../theme/ThemeModeProvider';
import { EmptyState } from './common';

/* eslint-disable @typescript-eslint/no-explicit-any */
export function useChartStyle() {
  const t = useTheme();
  const { chart } = useThemeMode();
  return {
    palette: chart,
    grid: t.palette.divider,
    axis: { fontSize: 11, fill: t.palette.text.secondary },
    surface: t.palette.background.paper,
    text: t.palette.text.primary,
  };
}

export function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter = money }: any) {
  const t = useTheme();
  if (!active || !payload?.length) return null;
  return (
    <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2, px: 1.5, py: 1, boxShadow: t.shadows[3], minWidth: 140 }}>
      {label !== undefined && <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>{labelFormatter ? labelFormatter(label) : label}</Typography>}
      {payload.map((p: any) => (
        <Stack key={p.dataKey ?? p.name} direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: p.color ?? p.payload?.color ?? p.fill }} />
            <Typography variant="caption" color="text.secondary">{p.name}</Typography>
          </Stack>
          <Typography variant="caption" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>{valueFormatter(p.value)}</Typography>
        </Stack>
      ))}
    </Box>
  );
}

const axisMoney = (v: number) => money(v, { compact: true });
const hasData = (data: any[], keys: string[]) => data.some((d) => keys.some((k) => Number(d[k]) !== 0));
const Empty = ({ height }: { height: number }) => <Box sx={{ height, display: 'grid', placeItems: 'center' }}><EmptyState title="No data for this period" /></Box>;

export interface SeriesDef { key: string; name: string; color?: string; dashed?: boolean }

export function LineSeriesChart({ data, xKey, series, height = 260, xFormatter, valueFormatter }: { data: any[]; xKey: string; series: SeriesDef[]; height?: number; xFormatter?: (v: any) => string; valueFormatter?: (n: number) => string }) {
  const s = useChartStyle();
  if (!hasData(data, series.map((x) => x.key))) return <Empty height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={s.grid} vertical={false} />
        <XAxis dataKey={xKey} tick={s.axis} tickFormatter={xFormatter} axisLine={false} tickLine={false} minTickGap={12} />
        <YAxis tick={s.axis} tickFormatter={valueFormatter ? (v) => valueFormatter(v) : axisMoney} axisLine={false} tickLine={false} width={56} />
        <Tooltip content={<ChartTooltip labelFormatter={xFormatter} valueFormatter={valueFormatter} />} cursor={{ stroke: s.grid, strokeWidth: 1 }} />
        {series.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />}
        {series.map((x, i) => (
          <Line key={x.key} type="monotone" dataKey={x.key} name={x.name} stroke={x.color ?? s.palette[i]} strokeWidth={2} strokeDasharray={x.dashed ? '5 4' : undefined}
            dot={false} activeDot={{ r: 5, stroke: s.surface, strokeWidth: 2 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function BarSeriesChart({ data, xKey, series, height = 260, xFormatter, stacked, horizontal, valueFormatter, colorByRow }: {
  data: any[]; xKey: string; series: SeriesDef[]; height?: number; xFormatter?: (v: any) => string; stacked?: boolean; horizontal?: boolean; valueFormatter?: (n: number) => string; colorByRow?: (row: any) => string;
}) {
  const s = useChartStyle();
  if (!hasData(data, series.map((x) => x.key))) return <Empty height={height} />;
  const fmt = valueFormatter ?? axisMoney;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 12, left: horizontal ? 8 : 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
        <CartesianGrid stroke={s.grid} vertical={!!horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={s.axis} tickFormatter={fmt} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey={xKey} tick={s.axis} axisLine={false} tickLine={false} width={110} tickFormatter={xFormatter} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tick={s.axis} tickFormatter={xFormatter} axisLine={false} tickLine={false} minTickGap={8} />
            <YAxis tick={s.axis} tickFormatter={fmt} axisLine={false} tickLine={false} width={56} />
          </>
        )}
        <Tooltip content={<ChartTooltip labelFormatter={xFormatter} valueFormatter={valueFormatter} />} cursor={{ fill: s.grid, opacity: 0.5 }} />
        {series.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />}
        {series.map((x, i) => (
          <Bar key={x.key} dataKey={x.key} name={x.name} fill={x.color ?? s.palette[i]} stackId={stacked ? 'a' : undefined} stroke={s.surface} strokeWidth={stacked ? 1 : 0}
            radius={stacked && i < series.length - 1 ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={horizontal ? 18 : 28}>
            {colorByRow && data.map((row, j) => <Cell key={j} fill={colorByRow(row)} />)}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ data, height = 240, center }: { data: { name: string; value: number; color: string }[]; height?: number; center?: ReactNode }) {
  const s = useChartStyle();
  const total = data.reduce((a, d) => a + d.value, 0);
  if (!total) return <Empty height={height} />;
  // At most 7 named slices + "Other" so every slice stays identifiable
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const shown = sorted.length > 8 ? [...sorted.slice(0, 7), { name: 'Other', value: sorted.slice(7).reduce((a, d) => a + d.value, 0), color: '#9ca3af' }] : sorted;
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
      <Box sx={{ position: 'relative', width: { xs: '100%', sm: '50%' }, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={shown} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={1} stroke={s.surface} strokeWidth={2} isAnimationActive={false}>
              {shown.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
          {center ?? <Box><Typography variant="caption" color="text.secondary">Total</Typography><Typography variant="subtitle1" fontWeight={700}>{money(total, { cents: false })}</Typography></Box>}
        </Box>
      </Box>
      <Stack spacing={0.75} sx={{ flex: 1, width: '100%' }}>
        {shown.map((d) => (
          <Stack key={d.name} direction="row" spacing={1} alignItems="center">
            <Box sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: d.color, flexShrink: 0 }} />
            <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>{d.name}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round((d.value / total) * 100)}%</Typography>
            <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums', minWidth: 76, textAlign: 'right' }}>{money(d.value, { cents: false })}</Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}

export function CashFlowChart({ data, height = 260, xFormatter }: { data: { date: string; cumulative: number; income: number; expenses: number }[]; height?: number; xFormatter?: (v: string) => string }) {
  const s = useChartStyle();
  if (!hasData(data, ['income', 'expenses'])) return <Empty height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="cf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.palette[0]} stopOpacity={0.25} />
            <stop offset="100%" stopColor={s.palette[0]} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={s.grid} vertical={false} />
        <XAxis dataKey="date" tick={s.axis} tickFormatter={xFormatter} axisLine={false} tickLine={false} minTickGap={16} />
        <YAxis tick={s.axis} tickFormatter={axisMoney} axisLine={false} tickLine={false} width={56} />
        <ReferenceLine y={0} stroke={s.axis.fill} strokeOpacity={0.5} />
        <Tooltip content={<ChartTooltip labelFormatter={xFormatter} />} cursor={{ stroke: s.grid }} />
        <Area type="monotone" dataKey="cumulative" name="Running net" stroke={s.palette[0]} strokeWidth={2} fill="url(#cf)" activeDot={{ r: 5, stroke: s.surface, strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
