
import React, { useMemo, useState, useRef } from "react";

/**
 * PDC Capacity Simulator — MVP (SVG)
 * -----------------------------------------------------------
 * Visualizes capacity for Pick, Pack, and Inbound by Hour, Shift, or Day.
 * Station types include TE, OSR Standard, DKR, SmallPack, Pallet Receiving, etc.
 * Tailwind CSS for styling.
 */

const flows = ["pick", "pack", "inbound"] as const;
type Flow = typeof flows[number];

const nice = (n: number) => new Intl.NumberFormat().format(Math.round(n));

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h % 24) * 60 + (m || 0);
};

const hourInShift = (hour: number, start: string, end: string) => {
  const mid = hour * 60 + 30;
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return true;
  if (s < e) return mid >= s && mid < e;
  return mid >= s || mid < e;
};

const palette = (keys: string[]): Record<string, string> => {
  const base = [
    "#2563eb",
    "#16a34a",
    "#dc2626",
    "#9333ea",
    "#ea580c",
    "#0891b2",
    "#4f46e5",
    "#059669",
    "#b91c1c",
    "#7c3aed",
  ];
  const map: Record<string, string> = {};
  keys.forEach((k, i) => (map[k] = base[i % base.length]));
  return map;
};

type ShiftId = "A" | "B" | "C";
type ShiftCfg = {
  id: ShiftId;
  name: string;
  start: string;
  end: string;
  enabled: boolean;
};

const defaultShifts: ShiftCfg[] = [
  { id: "A", name: "A", start: "06:00", end: "14:00", enabled: true },
  { id: "B", name: "B", start: "14:00", end: "22:00", enabled: true },
  { id: "C", name: "C", start: "22:00", end: "06:00", enabled: false },
];

type StationTypeCfg = {
  id: string;
  name: string;
  flow: Flow;
  stations: number;
  ratePerHour: number;
  shiftMix: Record<ShiftId, number>;
  enabled: boolean;
};

const initialStations: StationTypeCfg[] = [
  { id: "TE", name: "TE", flow: "pick", stations: 10, ratePerHour: 120, shiftMix: { A: 1, B: 1, C: 0 }, enabled: true },
  { id: "OSR", name: "OSR Standard", flow: "pick", stations: 154, ratePerHour: 33, shiftMix: { A: 1, B: 1, C: 0 }, enabled: true },
  { id: "DKR", name: "DKR", flow: "pick", stations: 48, ratePerHour: 19, shiftMix: { A: 1, B: 1, C: 0 }, enabled: true },
  { id: "MSL", name: "Pick", flow: "pick", stations: 36, ratePerHour: 22, shiftMix: { A: 1, B: 1, C: 0 }, enabled: true },
  { id: "LPK", name: "Large Pack", flow: "pack", stations: 10, ratePerHour: 60, shiftMix: { A: 1, B: 1, C: 0 }, enabled: true },
  { id: "INB-PAL", name: "Inbound Pallet", flow: "inbound", stations: 6, ratePerHour: 30, shiftMix: { A: 1, B: 1, C: 0.3 }, enabled: true },
  { id: "INB-SM", name: "Inbound Small Pack", flow: "inbound", stations: 8, ratePerHour: 70, shiftMix: { A: 1, B: 1, C: 0.3 }, enabled: true },
];

type ViewMode = "hourly" | "shift" | "day";

// Demand data type: stores per-hour demand for each flow.
type DemandData = Record<Flow, number[]>;

// Default demand: zeros for each hour and flow.
const defaultDemand: DemandData = {
  pick: Array(24).fill(0),
  pack: Array(24).fill(0),
  inbound: Array(24).fill(0),
};

type Filters = {
  flows: Record<Flow, boolean>;
  grouping: "flow" | "station";
};

function computeHourlyBuckets(stationTypes: StationTypeCfg[], shifts: ShiftCfg[], filters: Filters) {
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const activeStationTypes = stationTypes.filter((s) => s.enabled && filters.flows[s.flow]);
  const groupKeys =
    filters.grouping === "flow"
      ? Array.from(new Set(activeStationTypes.map((s) => s.flow)))
      : Array.from(new Set(activeStationTypes.map((s) => s.name)));
  const bins = hours.map(() => Object.fromEntries(groupKeys.map((g) => [g, 0])) as Record<string, number>);

  for (const st of activeStationTypes) {
    for (const sh of shifts) {
      if (!sh.enabled) continue;
      const frac = st.shiftMix[sh.id] ?? 0;
      if (frac <= 0) continue;
      const perHour = st.ratePerHour * st.stations * frac;
      for (const h of hours) {
        if (!hourInShift(h, sh.start, sh.end)) continue;
        const key = filters.grouping === "flow" ? st.flow : st.name;
        bins[h][key] += perHour;
      }
    }
  }
  return { hours, groupKeys, bins };
}

function computeShiftBuckets(stationTypes: StationTypeCfg[], shifts: ShiftCfg[], filters: Filters) {
  const activeStationTypes = stationTypes.filter((s) => s.enabled && filters.flows[s.flow]);
  const groupKeys =
    filters.grouping === "flow"
      ? Array.from(new Set(activeStationTypes.map((s) => s.flow)))
      : Array.from(new Set(activeStationTypes.map((s) => s.name)));

  const enabledShifts = shifts.filter((s) => s.enabled);
  const bins = enabledShifts.map(() => Object.fromEntries(groupKeys.map((g) => [g, 0])) as Record<string, number>);

  for (const st of activeStationTypes) {
    for (let i = 0; i < enabledShifts.length; i++) {
      const sh = enabledShifts[i];
      const frac = st.shiftMix[sh.id] ?? 0;
      if (frac <= 0) continue;
      const hoursInShift = hoursCovered(sh.start, sh.end);
      const perHour = st.ratePerHour * st.stations * frac;
      const totalForShift = perHour * hoursInShift;
      const key = filters.grouping === "flow" ? st.flow : st.name;
      bins[i][key] += totalForShift;
    }
  }
  const labels = enabledShifts.map((s) => s.name);
  return { labels, groupKeys, bins };
}

function hoursCovered(start: string, end: string) {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return 24;
  if (s < e) return (e - s) / 60;
  return (24 * 60 - s + e) / 60;
}

function computeDayTotal(stationTypes: StationTypeCfg[], shifts: ShiftCfg[], filters: Filters) {
  const activeStationTypes = stationTypes.filter((s) => s.enabled && filters.flows[s.flow]);
  const groupKeys =
    filters.grouping === "flow"
      ? Array.from(new Set(activeStationTypes.map((s) => s.flow)))
      : Array.from(new Set(activeStationTypes.map((s) => s.name)));

  const bin = Object.fromEntries(groupKeys.map((g) => [g, 0])) as Record<string, number>;

  for (const st of activeStationTypes) {
    for (const sh of shifts) {
      if (!sh.enabled) continue;
      const frac = st.shiftMix[sh.id] ?? 0;
      if (frac <= 0) continue;
      const totalHours = hoursCovered(sh.start, sh.end);
      bin[filters.grouping === "flow" ? st.flow : st.name] += st.ratePerHour * st.stations * frac * totalHours;
    }
  }
  return { groupKeys, bin };
}

type StackedBarChartProps = {
  width?: number;
  height?: number;
  bins: Record<string, number>[];
  groupKeys: string[];
  labels: string[];
  valueLabel: string;
  // Optional demand series for overlay; length must match bins/labels.
  demandSeries?: number[];
  // Optional utilization series (0-1) for each bin; used for tooltips if desired.
  utilizationSeries?: number[];
};

const StackedBarChart: React.FC<StackedBarChartProps> = ({
  width = 980,
  height = 360,
  bins,
  groupKeys,
  labels,
  valueLabel,
  demandSeries,
  utilizationSeries,
}) => {
  const margin = { top: 24, right: 16, bottom: 40, left: 56 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const totals = bins.map((b) => groupKeys.reduce((acc, k) => acc + (b[k] || 0), 0));
  // Demand values across bins (if provided)
  const demandValues = demandSeries ?? [];
  // Determine the y-axis maximum based on both capacity and demand
  const maxDemand = demandValues.length > 0 ? Math.max(...demandValues) : 0;
  const maxY = Math.max(1, Math.max(...totals, maxDemand));

  const xBand = (i: number) => (i * innerW) / bins.length;
  const bandW = (innerW / bins.length) * 0.8;
  const bandPad = (innerW / bins.length - bandW) / 2;
  const yScale = (v: number) => innerH - (v / maxY) * innerH;
  const colors = React.useMemo(() => palette(groupKeys), [groupKeys.join(",")]);

  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto select-none">
        <g transform={`translate(${margin.left},${margin.top})`}>
          {Array.from({ length: 5 }, (_, t) => t + 1).map((t) => {
            const v = (t * maxY) / 5;
            const y = yScale(v);
            return (
              <g key={t}>
                <line x1={0} x2={innerW} y1={y} y2={y} stroke="#e5e7eb" />
                <text x={-8} y={y} className="fill-gray-500 text-xs" textAnchor="end" dominantBaseline="middle">
                  {nice(v)}
                </text>
              </g>
            );
          })}

          {/* Stacks */}
          {bins.map((b, i) => {
            let yCursor = innerH;
            const x = xBand(i) + bandPad;
            const w = bandW;
            const pieces = groupKeys.map((k) => ({ k, v: b[k] || 0 }));
            return (
              <g
                key={`stack-${i}`}
                onMouseEnter={() => setHover({ i, x: x + margin.left + w / 2, y: yScale(totals[i]) + margin.top })}
                onMouseLeave={() => setHover(null)}
              >
                {pieces.map(({ k, v }) => {
                  const h = v <= 0 ? 0 : (v / maxY) * innerH;
                  const y = yCursor - h;
                  yCursor -= h;
                  return <rect key={k} x={x} y={y} width={w} height={h} fill={colors[k]} rx={4} ry={4} />;
                })}
              </g>
            );
          })}

          {/* Demand overlay line */}
          {demandValues.length === bins.length && (
            <path
              d={
                demandValues
                  .map((v, i) => {
                    const x = xBand(i) + bandPad + bandW / 2;
                    const y = yScale(v);
                    const cmd = i === 0 ? "M" : "L";
                    return `${cmd}${x},${y}`;
                  })
                  .join(" ")
              }
              fill="none"
              stroke="#000"
              strokeWidth={2}
              transform={`translate(0,0)`}
            />
          )}

          {/* Demand points */}
          {demandValues.length === bins.length &&
            demandValues.map((v, i) => {
              const x = xBand(i) + bandPad + bandW / 2;
              const y = yScale(v);
              return <circle key={`dem-${i}`} cx={x} cy={y} r={3} fill="#000" />;
            })}
          {labels.map((lab, i) => (
            <text key={i} x={xBand(i) + bandPad + bandW / 2} y={innerH + 18} className="fill-gray-700 text-xs" textAnchor="middle">
              {lab}
            </text>
          ))}

          <text x={-margin.left + 8} y={-8} className="fill-gray-900 font-medium">
            Capacity
          </text>
          <text x={innerW / 2} y={innerH + 34} className="fill-gray-900 text-sm" textAnchor="middle">
            {valueLabel}
          </text>
        </g>
      </svg>

      <div className="mt-2 flex flex-wrap gap-3">
        {groupKeys.map((k) => (
          <div key={k} className="flex items-center gap-2 text-sm">
            <span className="inline-block w-3 h-3 rounded" style={{ background: palette(groupKeys)[k] }} />
            <span className="text-gray-800">{k}</span>
          </div>
        ))}
        {demandValues.length === bins.length && (
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-block w-3 h-3 rounded bg-black" />
            <span className="text-gray-800">Demand</span>
          </div>
        )}
      </div>

      {hover && (
        <div
          className="absolute bg-white border border-gray-200 shadow-md rounded-md px-3 py-2 text-sm"
          style={{ left: Math.max(8, hover.x - 60), top: Math.max(8, hover.y - 50) }}
        >
          <div className="font-medium mb-1">{labels[hover.i]}</div>
          {groupKeys.map((k) => (
            <div key={k} className="flex justify-between gap-6">
              <span className="text-gray-600">{k}</span>
              <span className="font-medium">{nice(bins[hover.i][k] || 0)}</span>
            </div>
          ))}
          <div className="mt-1 pt-1 border-t text-gray-700 flex justify-between">
            <span>Total</span>
            <span className="font-semibold">{nice(totals[hover.i])}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [view, setView] = useState<ViewMode>("hourly");
  const [grouping, setGrouping] = useState<Filters["grouping"]>("flow");
  const [shiftCfg, setShiftCfg] = useState<ShiftCfg[]>(defaultShifts);
  const [stationTypes, setStationTypes] = useState<StationTypeCfg[]>(initialStations);
  const [flowOn, setFlowOn] = useState<Record<Flow, boolean>>({ pick: true, pack: true, inbound: true });

  // State for demand data (per-hour per flow)
  const [demandData, setDemandData] = useState<DemandData>(defaultDemand);

  // File input ref for loading configs
  const fileRef = useRef<HTMLInputElement | null>(null);

  const filters: Filters = React.useMemo(() => ({ flows: flowOn, grouping }), [flowOn, grouping]);

  const hourly = React.useMemo(() => computeHourlyBuckets(stationTypes, shiftCfg, filters), [stationTypes, shiftCfg, filters]);
  const shiftBins = React.useMemo(() => computeShiftBuckets(stationTypes, shiftCfg, filters), [stationTypes, shiftCfg, filters]);
  const dayTotal = React.useMemo(() => computeDayTotal(stationTypes, shiftCfg, filters), [stationTypes, shiftCfg, filters]);

  // Compute demand per hour for all flows (respecting flowOn)
  const hourlyDemand = useMemo(() => {
    const totals: number[] = Array(24).fill(0);
    flows.forEach((f) => {
      if (flowOn[f]) {
        demandData[f].forEach((v, i) => {
          totals[i] += v || 0;
        });
      }
    });
    return totals;
  }, [demandData, flowOn]);

  // Compute demand per enabled shift
  const shiftDemand = useMemo(() => {
    return shiftCfg
      .filter((s) => s.enabled)
      .map((sh) => {
        let sum = 0;
        for (let h = 0; h < 24; h++) {
          if (hourInShift(h, sh.start, sh.end)) {
            sum += hourlyDemand[h];
          }
        }
        return sum;
      });
  }, [hourlyDemand, shiftCfg]);

  // Compute total day demand
  const dayDemand = useMemo(() => hourlyDemand.reduce((a, b) => a + b, 0), [hourlyDemand]);

  const chartData = React.useMemo(() => {
    if (view === "hourly") {
      return {
        bins: hourly.bins,
        groupKeys: hourly.groupKeys,
        labels: hourly.hours.map((h) => `${h.toString().padStart(2, "0")}:00`),
        valueLabel: "Per Hour Capacity",
        demandSeries: hourlyDemand,
      };
    } else if (view === "shift") {
      return {
        bins: shiftBins.bins,
        groupKeys: shiftBins.groupKeys,
        labels: shiftBins.labels,
        valueLabel: "Per Shift Capacity",
        demandSeries: shiftDemand,
      };
    } else {
      return {
        bins: [dayTotal.bin],
        groupKeys: dayTotal.groupKeys,
        labels: ["Day Total"],
        valueLabel: "Per Day Capacity",
        demandSeries: [dayDemand],
      };
    }
  }, [view, hourly, shiftBins, dayTotal, hourlyDemand, shiftDemand, dayDemand]);

  const updateStationField = (id: string, field: keyof StationTypeCfg, value: any) => {
    setStationTypes((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };

  const updateStationShiftMix = (id: string, sh: ShiftId, value: number) => {
    setStationTypes((prev) =>
      prev.map((s) => (s.id === id ? { ...s, shiftMix: { ...s.shiftMix, [sh]: value } } : s))
    );
  };

  const updateShiftCfg = (id: ShiftId, field: keyof ShiftCfg, value: any) => {
    setShiftCfg((prev) => prev.map((sh) => (sh.id === id ? { ...sh, [field]: value } : sh)));
  };

  const totalDayCapacity = React.useMemo(() => Object.values(dayTotal.bin).reduce((a, b) => a + b, 0), [dayTotal]);

  // Compute overall utilization (0-1) for current view
  const overallUtilization = useMemo(() => {
    if (view === "hourly") {
      const capTotals = hourly.bins.map((b) => Object.values(b).reduce((a, c) => a + c, 0));
      const demandSum = hourlyDemand.reduce((a, b) => a + b, 0);
      const capSum = capTotals.reduce((a, b) => a + b, 0);
      return capSum > 0 ? demandSum / capSum : 0;
    } else if (view === "shift") {
      const capTotals = shiftBins.bins.map((b) => Object.values(b).reduce((a, c) => a + c, 0));
      const demandSum = shiftDemand.reduce((a, b) => a + b, 0);
      const capSum = capTotals.reduce((a, b) => a + b, 0);
      return capSum > 0 ? demandSum / capSum : 0;
    } else {
      const capSum = Object.values(dayTotal.bin).reduce((a, b) => a + b, 0);
      const demandSum = dayDemand;
      return capSum > 0 ? demandSum / capSum : 0;
    }
  }, [view, hourly, shiftBins, dayTotal, hourlyDemand, shiftDemand, dayDemand]);

  return (
    <div className="w-full min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">PDC Capacity Simulator (SVG) — MVP</h1>
            <p className="text-gray-600 mt-1">
              Edit station counts, rates, and shift coverage. View capacity by hour, shift, or day. Group stacks by{" "}
              <span className="font-medium">Flow</span> or by <span className="font-medium">Station Type</span>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl overflow-hidden border border-gray-200">
              {(["hourly", "shift", "day"] as ViewMode[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-2 text-sm ${view === v ? "bg-white" : "bg-gray-100 hover:bg-gray-200"}`}
                >
                  {v === "hourly" ? "By Hour" : v === "shift" ? "By Shift" : "By Day"}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-xl overflow-hidden border border-gray-200">
              {(["flow", "station"] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setGrouping(g)}
                  className={`px-3 py-2 text-sm ${grouping === g ? "bg-white" : "bg-gray-100 hover:bg-gray-200"}`}
                >
                  Group: {g}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 border border-gray-200 rounded-xl px-3 py-2 bg-white">
              {flows.map((f) => (
                <label key={f} className="inline-flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    className="accent-blue-600"
                    checked={flowOn[f]}
                    onChange={(e) => setFlowOn((prev) => ({ ...prev, [f]: e.target.checked }))}
                  />
                  <span className="capitalize">{f}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-2xl shadow-sm border p-4">
            <div className="text-sm text-gray-500">Day Capacity (All Visible)</div>
            <div className="text-2xl font-bold mt-1">{nice(totalDayCapacity)}</div>
            <div className="text-xs text-gray-500">Sum of all enabled flows/stations across enabled shifts</div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border p-4">
            <div className="text-sm text-gray-500">Enabled Shifts</div>
            <div className="text-2xl font-bold mt-1">{shiftCfg.filter((s) => s.enabled).length} / 3</div>
            <div className="text-xs text-gray-500">{shiftCfg.filter((s) => s.enabled).map((s) => s.name).join(", ") || "None"}</div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border p-4">
            <div className="text-sm text-gray-500">Enabled Station Types</div>
            <div className="text-2xl font-bold mt-1">{stationTypes.filter((s) => s.enabled).length}</div>
            <div className="text-xs text-gray-500">Across Pick / Pack / Inbound</div>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border p-4">
            <div className="text-sm text-gray-500">Utilization (Avg)</div>
            <div className="text-2xl font-bold mt-1">{(overallUtilization * 100).toFixed(1)}%</div>
            <div className="text-xs text-gray-500">Across visible flows for current view</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border p-5 mb-6">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold">Capacity View</h2>
            <div className="text-sm text-gray-500">
              {view === "hourly"
                ? "Per-hour capacity across enabled shifts"
                : view === "shift"
                ? "Total capacity per enabled shift"
                : "Total capacity for enabled shifts combined"}
            </div>
          </div>
          <StackedBarChart
            bins={chartData.bins}
            groupKeys={chartData.groupKeys}
            labels={chartData.labels}
            valueLabel={chartData.valueLabel}
            demandSeries={chartData.demandSeries}
          />
        </div>

        <div className="bg-white rounded-2xl shadow-sm border p-5 mb-6">
          <h3 className="text-lg font-semibold mb-3">Demand Data &amp; Config</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {flows.map((f) => (
              <div key={f} className="flex flex-col">
                <label className="text-sm font-medium capitalize mb-1">
                  {f} demand (24 comma-separated)
                </label>
                <textarea
                  className="border rounded-lg p-2 text-xs h-24 resize-y"
                  value={demandData[f].join(",")}
                  onChange={(e) => {
                    const parts = e.target.value
                      .split(",")
                      .map((x) => Number(x.trim()));
                    const arr = Array.from({ length: 24 }, (_, i) =>
                      Number.isFinite(parts[i]) ? parts[i] : 0
                    );
                    setDemandData((prev) => ({ ...prev, [f]: arr }));
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => {
                const config = {
                  stationTypes,
                  shiftCfg,
                  demandData,
                  flowOn,
                };
                const blob = new Blob([JSON.stringify(config, null, 2)], {
                  type: "application/json",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "pdc-config.json";
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="px-3 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700"
            >
              Save Config
            </button>
            <button
              onClick={() => {
                fileRef.current?.click();
              }}
              className="px-3 py-2 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700"
            >
              Load Config
            </button>
            <input
              type="file"
              accept="application/json"
              className="hidden"
              ref={fileRef}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  try {
                    const data = JSON.parse(reader.result as string);
                    if (data.stationTypes && Array.isArray(data.stationTypes))
                      setStationTypes(data.stationTypes);
                    if (data.shiftCfg && Array.isArray(data.shiftCfg)) setShiftCfg(data.shiftCfg);
                    if (data.demandData) setDemandData(data.demandData);
                    if (data.flowOn) setFlowOn(data.flowOn);
                  } catch (err) {
                    console.error("Failed to load config", err);
                  }
                };
                reader.readAsText(file);
                e.target.value = "";
              }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Enter demand per hour for each flow or leave empty for zeros. Save your scenario as a JSON file and
            load it later.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Station Types</h3>
              <button
                onClick={() =>
                  setStationTypes((prev) => [
                    ...prev,
                    {
                      id: `NEW-${prev.length + 1}`,
                      name: "New Station",
                      flow: "pick",
                      stations: 1,
                      ratePerHour: 60,
                      shiftMix: { A: 1, B: 0, C: 0 },
                      enabled: true,
                    },
                  ])
                }
                className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              >
                + Add Station Type
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600 border-b">
                    <th className="py-2 pr-4">On</th>
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Flow</th>
                    <th className="py-2 pr-4">Stations</th>
                    <th className="py-2 pr-4">Rate/hr</th>
                    <th className="py-2 pr-2 text-center">Shift A</th>
                    <th className="py-2 pr-2 text-center">Shift B</th>
                    <th className="py-2 pr-2 text-center">Shift C</th>
                    <th className="py-2 pr-2">Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {stationTypes.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <input
                          type="checkbox"
                          className="accent-blue-600"
                          checked={s.enabled}
                          onChange={(e) => updateStationField(s.id, "enabled", e.target.checked)}
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          className="border rounded-lg px-2 py-1 w-48"
                          value={s.name}
                          onChange={(e) => updateStationField(s.id, "name", e.target.value)}
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <select
                          className="border rounded-lg px-2 py-1"
                          value={s.flow}
                          onChange={(e) => updateStationField(s.id, "flow", e.target.value as Flow)}
                        >
                          {flows.map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          type="number"
                          min={0}
                          className="border rounded-lg px-2 py-1 w-24 text-right"
                          value={s.stations}
                          onChange={(e) => updateStationField(s.id, "stations", Number(e.target.value))}
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          type="number"
                          min={0}
                          className="border rounded-lg px-2 py-1 w-24 text-right"
                          value={s.ratePerHour}
                          onChange={(e) => updateStationField(s.id, "ratePerHour", Number(e.target.value))}
                        />
                      </td>
                      {(["A", "B", "C"] as ShiftId[]).map((sh) => (
                        <td key={sh} className="py-2 pr-2 text-center">
                          <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.1}
                            className="border rounded-lg px-2 py-1 w-20 text-right"
                            value={s.shiftMix[sh] ?? 0}
                            onChange={(e) => updateStationShiftMix(s.id, sh, Number(e.target.value))}
                          />
                          <div className="text-[10px] text-gray-500">fraction</div>
                        </td>
                      ))}
                      <td className="py-2 pr-2">
                        <button
                          onClick={() => setStationTypes((prev) => prev.filter((x) => x.id != s.id))}
                          className="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-red-50 hover:text-red-600 border"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Tip: Shift mix is a fraction of stations staffed per shift (e.g., 1.0 = all stations staffed; 0.5 = half).
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border p-5 h-fit">
            <h3 className="text-lg font-semibold mb-3">Shifts</h3>
            <div className="space-y-3">
              {shiftCfg.map((sh) => (
                <div key={sh.id} className="border rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">Shift {sh.name}</div>
                    <label className="text-sm inline-flex items-center gap-2">
                      <span className="text-gray-600">Enabled</span>
                      <input
                        type="checkbox"
                        className="accent-blue-600"
                        checked={sh.enabled}
                        onChange={(e) => updateShiftCfg(sh.id, "enabled", e.target.checked)}
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <label className="text-sm">
                      <div className="text-gray-600">Start (24h)</div>
                      <input
                        type="time"
                        className="border rounded-lg px-2 py-1 w-full"
                        value={sh.start}
                        onChange={(e) => updateShiftCfg(sh.id, "start", e.target.value)}
                      />
                    </label>
                    <label className="text-sm">
                      <div className="text-gray-600">End (24h)</div>
                      <input
                        type="time"
                        className="border rounded-lg px-2 py-1 w-full"
                        value={sh.end}
                        onChange={(e) => updateShiftCfg(sh.id, "end", e.target.value)}
                      />
                    </label>
                  </div>
                  {toMinutes(sh.start) > toMinutes(sh.end) && (
                    <div className="text-xs text-amber-600 mt-2">Overnight shift detected (wraps past midnight)</div>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-3">Note: If Start = End, it's treated as 24-hour coverage.</p>
          </div>
        </div>

        <div className="mt-8 text-xs text-gray-500">
          MVP: capacity only. Next: demand overlays, utilization, CSV/JSON import-export, downtime windows, labor calendars, efficiency curves.
        </div>
      </div>
    </div>
  );
}
