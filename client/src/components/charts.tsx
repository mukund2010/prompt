import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Severity } from "../../../shared/types";

const AXIS = { stroke: "var(--muted)", fontSize: 11.5, tickLine: false, axisLine: false } as const;
export const SERIES = { original: "var(--series-a)", improved: "var(--series-b)" };
const SEV_COLOR: Record<Severity, string> = { critical: "var(--sev-critical)", high: "var(--sev-high)", medium: "var(--sev-medium)", low: "var(--sev-low)" };

interface TipProps {
  active?: boolean;
  label?: ReactNode;
  payload?: Array<{ name?: string; value?: number | string; color?: string; payload?: Record<string, unknown> }>;
  unit?: string;
}
function Tip({ active, label, payload, unit = "" }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="t">{label}</div>
      {payload.map((p) => (
        <div className="r" key={p.name}>
          <i className="dot" style={{ background: p.color }} />
          {p.name}
          <b>
            {typeof p.value === "number" ? p.value.toFixed(unit === "%" ? 1 : 0) : p.value}
            {unit}
          </b>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <i style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** Grouped bars: original vs improved per group. `percent` fixes the axis at 0–100%. */
export function GroupedBars({ data, percent = true }: { data: Array<{ name: string; original: number | null; improved: number | null }>; percent?: boolean }) {
  return (
    <div className="chart-box">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="name" {...AXIS} interval={0} tick={{ fontSize: 11 }} tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)} />
          <YAxis {...AXIS} domain={percent ? [0, 100] : [0, "auto"]} allowDecimals={false} tickFormatter={(v) => (percent ? `${v}%` : String(v))} width={48} />
          <Tooltip content={<Tip unit={percent ? "%" : ""} />} cursor={{ fill: "var(--panel-3)", opacity: 0.5 }} />
          <Bar isAnimationActive={false} dataKey="original" name="Original" fill={SERIES.original} radius={[4, 4, 0, 0]} maxBarSize={26} />
          <Bar isAnimationActive={false} dataKey="improved" name="Improved" fill={SERIES.improved} radius={[4, 4, 0, 0]} maxBarSize={26} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Severity distribution: horizontal bars. Status colours always paired with text labels. */
export function SeverityChart({ data, height = 200 }: { data: Record<Severity, number>; height?: number }) {
  const rows = (Object.keys(SEV_COLOR) as Severity[]).map((s) => ({ name: s[0].toUpperCase() + s.slice(1), value: data[s], key: s }));
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 28, left: 8, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
          <XAxis type="number" {...AXIS} allowDecimals={false} />
          <YAxis type="category" dataKey="name" {...AXIS} width={64} />
          <Tooltip content={<Tip />} cursor={{ fill: "var(--panel-3)", opacity: 0.5 }} />
          <Bar isAnimationActive={false} dataKey="value" name="Failures" radius={[0, 4, 4, 0]} maxBarSize={18} label={{ position: "right", fill: "var(--text-2)", fontSize: 11.5 }}>
            {rows.map((r) => (
              <Cell key={r.key} fill={SEV_COLOR[r.key]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Single-series pass-rate trend across runs. */
export function TrendChart({ data }: { data: Array<{ name: string; passRate: number; detail?: string }> }) {
  return (
    <div className="chart-box">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="name" {...AXIS} tick={{ fontSize: 11 }} />
          <YAxis {...AXIS} domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={48} />
          <Tooltip content={<Tip unit="%" />} cursor={{ stroke: "var(--border-strong)" }} />
          <Line isAnimationActive={false} type="monotone" dataKey="passRate" name="Pass rate" stroke="var(--accent)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: "var(--panel)" }} activeDot={{ r: 6 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Original vs improved pass rate per experiment. */
export function ImprovementChart({ data }: { data: Array<{ name: string; original: number; improved: number }> }) {
  return (
    <div className="chart-box">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="name" {...AXIS} tick={{ fontSize: 11 }} tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)} />
          <YAxis {...AXIS} domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={48} />
          <Tooltip content={<Tip unit="%" />} cursor={{ fill: "var(--panel-3)", opacity: 0.5 }} />
          <Bar isAnimationActive={false} dataKey="original" name="Original" fill={SERIES.original} radius={[4, 4, 0, 0]} maxBarSize={26} />
          <Bar isAnimationActive={false} dataKey="improved" name="Improved" fill={SERIES.improved} radius={[4, 4, 0, 0]} maxBarSize={26} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Pass / fail / error stacked meter with text labels. */
export function OutcomeMeter({ passed, failed, errored }: { passed: number; failed: number; errored: number }) {
  const total = passed + failed + errored || 1;
  return (
    <div>
      <div className="meter" aria-label={`${passed} passed, ${failed} failed, ${errored} errors`}>
        {passed > 0 && <span style={{ width: `${(passed / total) * 100}%`, background: "var(--good)" }} />}
        {failed > 0 && <span style={{ width: `${(failed / total) * 100}%`, background: "var(--bad)" }} />}
        {errored > 0 && <span style={{ width: `${(errored / total) * 100}%`, background: "var(--sev-low)" }} />}
      </div>
      <div className="legend mt-8">
        <span>
          <i style={{ background: "var(--good)" }} />
          {passed} passed
        </span>
        <span>
          <i style={{ background: "var(--bad)" }} />
          {failed} failed
        </span>
        {errored > 0 && (
          <span>
            <i style={{ background: "var(--sev-low)" }} />
            {errored} errors
          </span>
        )}
      </div>
    </div>
  );
}
