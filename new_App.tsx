import React, { useState, useRef, useMemo } from "react";

/**
 * PDC Capacity Simulator — Enhanced UI
 * -----------------------------------------------------------
 * Visualizes capacity for Pick, Pack, and Inbound by hour, shift, or day.  
 * Provides modern card-based layout with clear grouping of options, summary, demand
 * configuration, and editable tables for station types and shifts.  
 * Uses a custom SVG stacked bar chart to present capacity alongside optional
 * demand overlays.  
 */

// Define the possible flows. These values are used throughout the simulator
// to group station types and demand arrays.
const flows = ["pick", "pack", "inbound"] as const;
type Flow = typeof flows[number];

// Format a number with commas and round to the nearest integer.
const nice = (n: number) => new Intl.NumberFormat().format(Math.round(n));

// Convert an "HH:MM" string into minutes since midnight. Hours wrap at 24.
const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return ((h % 24) * 60) + (m || 0);
};

// Determine if the midpoint of a given hour (0–23) falls within a shift.  
// Supports overnight shifts where the end time is earlier than the start.
const hourInShift = (hour: number, start: string, end: string) => {
  const mid = hour * 60 + 30;
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return true;
  if (s < e) return mid >= s && mid < e;
  return mid >= s || mid < e;
};

// Compute the number of hours covered by a shift, accounting for overnight spans.
function hoursCovered(start: string, end: string) {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return 24;
  if (s < e) return (e - s) / 60;
  return (24 * 60 - s + e) / 60;
}

// Type definitions for shift configuration
type ShiftId = "A" | "B" | "C";
type ShiftCfg = {
  id: ShiftId;
  name: string;
  start: string;
  end: string;
  enabled: boolean;
};

// Default shift schedule: A and B active by default; C disabled.
const defaultShifts: ShiftCfg[] = [
  { id: "A", name: "A", start: "06:00", end: "14:00", enabled: true },
  { id: "B", name: "B", start: "14:00", end: "22:00", enabled: true },
  { id: "C", name: "C", start: "22:00", end: "06:00", enabled: false },
];

// Type definition for station type configuration
type StationTypeCfg = {
  id: string;
  name: string;
  flow: Flow;
  stations: number;
  ratePerHour: number;
  shiftMix: Record<ShiftId, number>;
  enabled: boolean;
};

// Initial station definitions matching the user's data.  
// Each entry specifies its flow, the number of stations, hourly rate, and the
// mix of those stations assigned to each shift (fractions 0–1).
const initialStations: StationTypeCfg[] = [
  { id: "TE", name: "TE", flow: "pick", stations: 10, ratePerHour: 120, shiftMix: { A: 1, B: 1, C: 0 }, enabled: true },
  { id: "OSR", name: "OSR Standard", flow: "pick", stations: 154, ratePerHour: 33, shiftMix: { A: 1, B: 1, C: 0 }, enabled: true },
  { id: "DKR", name: "DKR", flow: "pick", stations: 48, ratePerHour: 19, shiftMix: { A: 1, B: 1, C: 0 }, enabled: true },
  { id: "MSL", name: "Pick", flow: "pick", stations: 36, ratePerHour: 22, shiftMix: { A: 1, B: 1, C: 0 }, enabled: true },
  { id: "LPK", name: "Large Pack", flow: "pack", stations: 10, ratePerHour: 60, shiftMix: { A: 1, B: 1, C: 0 }, enabled: true },
  { id: "INB-PAL", name: "Inbound Pallet", flow: "inbound", stations: 6, ratePerHour: 30, shiftMix: { A: 1, B: 1, C: 0.3 }, enabled: true },
  { id: "INB-SM", name: "Inbound Small Pack", flow: "inbound", stations: 8, ratePerHour: 70, shiftMix: { A: 1, B: 1, C: 0.3 }, enabled: true },
];

// Demand data stores per-hour demand for each flow; arrays of 24 numbers (one per hour).
type DemandData = Record<Flow, number[]>;

// Default demand arrays (all zeros). Users can override via the UI.
const defaultDemand: DemandData = {
  pick: Array(24).fill(0),
  pack: Array(24).fill(0),
  inbound: Array(24).fill(0),
};

// Filters controlling which flows are visible and how to group stacks.
type Filters = {
  flows: Record<Flow, boolean>;
  grouping: "flow" | "station";
};

// Compute per-hour capacity across active station types and shifts.  
// Returns bins keyed by group (flow or station name), along with groupKeys and hour labels.
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

// Compute capacity totals per enabled shift.
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

// Compute total day capacity for all enabled shifts combined.
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

// Assign a distinct color to each group key. Reuses colors when more keys than base palette.
function palette(keys: string[]): Record<string, string> {
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
  keys.forEach((k, i) => {
    map[k] = base[i % base.length];
  });
  return map;
}

// Props for the StackedBarChart component
type StackedBarChartProps = {
  width?: number;
  height?: number;
  bins: Record<string, number>[];
  groupKeys: string[];
  labels: string[];
  valueLabel: string;
  demandSeries?: number[];
  utilizationSeries?: number[];
};

/**
 * StackedBarChart
 *
 * Renders a stacked bar chart where each bin is composed of segments for each
 * group key. An optional demandSeries overlays a line and points on top of
 * the bars. Hovering a bar reveals a tooltip with per-group values and totals.
 */
const StackedBarChart: React.FC<StackedBarChartProps> = ({
  width = 980,
  height = 360,
  bins,
  groupKeys,
  labels,
  valueLabel,
  demandSeries,
}) => {
  const margin = { top: 24, right: 16, bottom: 40, left: 56 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const totals = bins.map((b) => groupKeys.reduce((acc, k) => acc + (b[k] || 0), 0));
  const demandValues = demandSeries ?? [];
  const maxDemand = demandValues.length > 0 ? Math.max(...demandValues) : 0;
  const maxY = Math.max(1, Math.max(...totals, maxDemand));
  const xBand = (i: number) => (i * innerW) / bins.length;
  const bandW = (innerW / bins.length) * 0.8;
  const bandPad = (innerW / bins.length - bandW) / 2;
  const yScale = (v: number) => innerH - (v / maxY) * innerH;
  const colors = useMemo(() => palette(groupKeys), [groupKeys.join(",")]);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  return (
    <div className="relative overflow-x-auto">
      <svg width={width} height={height}>
        {/* Y-axis grid and labels */}
        {Array.from({ length: 5 }, (_, t) => t + 1).map((t) => {
          const v = (t * maxY) / 5;
          const y = yScale(v);
          return (
            <g key={t}>
              <line x1={margin.left} x2={width - margin.right} y1={margin.top + y} y2={margin.top + y} stroke="#e5e7eb" strokeWidth={1} />
              <text x={margin.left - 6} y={margin.top + y + 4} textAnchor="end" fontSize="10" fill="#6b7280">
                {nice(v)}
              </text>
            </g>
          );
        })}
        {/* Stacked bars */}
        {bins.map((b, i) => {
          let yCursor = innerH;
          const x = xBand(i) + bandPad;
          const w = bandW;
          const pieces = groupKeys.map((k) => ({ k, v: b[k] || 0 }));
          return (
            <g
              key={i}
              transform={`translate(${margin.left},${margin.top})`}
              onMouseEnter={(e) => {
                const rect = (e.currentTarget as SVGGElement).getBoundingClientRect();
                setHover({ i, x: rect.left + w / 2 - margin.left, y: yScale(totals[i]) });
              }}
              onMouseLeave={() => setHover(null)}
            >
              {pieces.map(({ k, v }) => {
                const h = v <= 0 ? 0 : (v / maxY) * innerH;
                const y = yCursor - h;
                yCursor -= h;
                return (
                  <rect key={k} x={x} y={y} width={w} height={h} fill={colors[k]} />
                );
              })}
            </g>
          );
        })}
        {/* Demand overlay line */}
        {demandValues.length === bins.length && (
          <path
            d={demandValues
              .map((v, i) => {
                const x = xBand(i) + bandPad + bandW / 2 + margin.left;
                const y = yScale(v) + margin.top;
                const cmd = i === 0 ? "M" : "L";
                return `${cmd}${x},${y}`;
              })
              .join(" ")}
            fill="none"
            stroke="#111827"
            strokeWidth={2}
          />
        )}
        {/* Demand points */}
        {demandValues.length === bins.length &&
          demandValues.map((v, i) => {
            const x = xBand(i) + bandPad + bandW / 2 + margin.left;
            const y = yScale(v) + margin.top;
            return <circle key={i} cx={x} cy={y} r={3} fill="#111827" />;
          })}
        {/* X-axis labels */}
        {labels.map((lab, i) => {
          const x = xBand(i) + bandPad + bandW / 2 + margin.left;
          return (
            <text key={i} x={x} y={height - margin.bottom + 14} textAnchor="middle" fontSize="10" fill="#374151">
              {lab}
            </text>
          );
        })}
        {/* Axis titles */}
        <text
          x={(margin.left + innerW + margin.right) / 2}
          y={height - 4}
          textAnchor="middle"
          fontSize="12"
          fill="#374151"
        >
          {valueLabel}
        </text>
        <text
          transform={`translate(12,${margin.top + innerH / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize="12"
          fill="#374151"
        >
          Capacity
        </text>
        {/* Legend */}
        {groupKeys.map((k, i) => {
          const x = margin.left + i * 120;
          const y = 8;
          return (
            <g key={k} transform={`translate(${x},${y})`}>
              <rect width={12} height={12} fill={colors[k]} />
              <text x={16} y={10} fontSize="10" fill="#374151">
                {k}
              </text>
            </g>
          );
        })}
        {demandValues.length === bins.length && (
          <g transform={`translate(${margin.left + groupKeys.length * 120},8)`}>
            <line x1={0} x2={12} y1={6} y2={6} stroke="#111827" strokeWidth={2} />
            <circle cx={6} cy={6} r={3} fill="#111827" />
            <text x={16} y={10} fontSize="10" fill="#374151">
              Demand
            </text>
          </g>
        )}
      </svg>
      {/* Tooltip */}
      {hover && (
        <div
          className="absolute z-10 px-3 py-2 bg-white rounded-lg shadow-xl text-xs text-gray-800 border"
          style={{
            left: hover.x + 50,
            top: hover.y + 10,
          }}
        >
          <div className="font-semibold mb-1">{labels[hover.i]}</div>
          {groupKeys.map((k) => (
            <div key={k} className="flex justify-between">
              <span>{k}</span>
              <span>{nice(bins[hover.i][k] || 0)}</span>
            </div>
          ))}
          <div className="flex justify-between mt-1 border-t pt-1">
            <span>Total</span>
            <span>{nice(totals[hover.i])}</span>
          </div>
        </div>
      )}
    </div>
  );
};

// Main application component
export default function App() {
  const [view, setView] = useState<"hourly" | "shift" | "day">("hourly");
  const [grouping, setGrouping] = useState<"flow" | "station">("flow");
  const [shiftCfg, setShiftCfg] = useState<ShiftCfg[]>(defaultShifts);
  const [stationTypes, setStationTypes] = useState<StationTypeCfg[]>(initialStations);
  const [flowOn, setFlowOn] = useState<Record<Flow, boolean>>({ pick: true, pack: true, inbound: true });
  const [demandData, setDemandData] = useState<DemandData>(defaultDemand);
  // File input ref for loading JSON configs
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Build filters for capacity computation
  const filters: Filters = useMemo(() => ({ flows: flowOn, grouping }), [flowOn, grouping]);
  const hourly = useMemo(() => computeHourlyBuckets(stationTypes, shiftCfg, filters), [stationTypes, shiftCfg, filters]);
  const shiftBins = useMemo(() => computeShiftBuckets(stationTypes, shiftCfg, filters), [stationTypes, shiftCfg, filters]);
  const dayTotal = useMemo(() => computeDayTotal(stationTypes, shiftCfg, filters), [stationTypes, shiftCfg, filters]);
  // Aggregate demand across flows, respecting flowOn toggles
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
  }, [shiftCfg, hourlyDemand]);
  const dayDemand = useMemo(() => hourlyDemand.reduce((a, b) => a + b, 0), [hourlyDemand]);
  // Determine dataset for chart based on view
  const chartData = useMemo(() => {
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
  // Compute average utilization across visible flows for current view
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
      return capSum > 0 ? dayDemand / capSum : 0;
    }
  }, [view, hourly, shiftBins, dayTotal, hourlyDemand, shiftDemand, dayDemand]);
  // Helpers to update station fields, shift mix, and shift configs
  const updateStationField = (id: string, field: keyof StationTypeCfg, value: any) => {
    setStationTypes((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };
  const updateStationShiftMix = (id: string, sh: ShiftId, value: number) => {
    setStationTypes((prev) =>
      prev.map((s) => (s.id === id ? { ...s, shiftMix: { ...s.shiftMix, [sh]: value } } : s))
    );
  };
  const updateShiftCfg = (id: ShiftId, field: keyof ShiftCfg, value: any) => {
    setShiftCfg((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  };
  // Handler for loading JSON config
  const handleLoadConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const obj = JSON.parse(ev.target?.result as string);
        if (obj.stationTypes) setStationTypes(obj.stationTypes);
        if (obj.shiftCfg) setShiftCfg(obj.shiftCfg);
        if (obj.demandData) setDemandData(obj.demandData);
        if (obj.flowOn) setFlowOn(obj.flowOn);
      } catch (err) {
        console.error("Invalid config", err);
      }
    };
    reader.readAsText(file);
  };
  // Handler for saving current config to a JSON file
  const handleSaveConfig = () => {
    const config = { stationTypes, shiftCfg, demandData, flowOn };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pdc-config.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold text-gray-900">PDC Capacity Simulator</h1>
        {/* Top section: options + summary + chart */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left two-thirds: controls and chart */}
          <div className="lg:col-span-2 space-y-6">
            {/* Controls card */}
            <div className="bg-white rounded-2xl shadow p-4 space-y-4">
              {/* View toggles */}
              <div className="flex flex-wrap items-center gap-2">
                {(["hourly", "shift", "day"] as ("hourly" | "shift" | "day")[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`px-3 py-2 text-sm rounded-lg font-medium ${
                      view === v ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {v === "hourly" ? "By Hour" : v === "shift" ? "By Shift" : "By Day"}
                  </button>
                ))}
              </div>
              {/* Grouping toggles */}
              <div className="flex flex-wrap items-center gap-2">
                {(["flow", "station"] as ("flow" | "station")[]).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGrouping(g)}
                    className={`px-3 py-2 text-sm rounded-lg font-medium ${
                      grouping === g ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {g === "flow" ? "Group: Flow" : "Group: Station"}
                  </button>
                ))}
              </div>
              {/* Flow toggles */}
              <div className="flex flex-wrap items-center gap-4">
                {flows.map((f) => (
                  <label key={f} className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={flowOn[f]}
                      onChange={(e) => setFlowOn((prev) => ({ ...prev, [f]: e.target.checked }))}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                    />
                    <span className="capitalize">{f}</span>
                  </label>
                ))}
              </div>
            </div>
            {/* Chart card */}
            <div className="bg-white rounded-2xl shadow p-4">
              <h2 className="text-lg font-semibold mb-2">Capacity View</h2>
              <p className="text-xs text-gray-500 mb-4">
                {view === "hourly"
                  ? "Per-hour capacity across enabled shifts"
                  : view === "shift"
                  ? "Total capacity per enabled shift"
                  : "Total capacity for enabled shifts combined"}
              </p>
              <div className="overflow-x-auto">
                <StackedBarChart
                  width={960}
                  height={360}
                  bins={chartData.bins}
                  groupKeys={chartData.groupKeys}
                  labels={chartData.labels}
                  valueLabel={chartData.valueLabel}
                  demandSeries={chartData.demandSeries}
                />
              </div>
            </div>
          </div>
          {/* Right third: summary and demand */}
          <div className="space-y-6">
            {/* Summary card */}
            <div className="bg-white rounded-2xl shadow p-4">
              <h2 className="text-lg font-semibold mb-2">Summary</h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-gray-500">Day Capacity</div>
                  <div className="font-medium">{nice(Object.values(dayTotal.bin).reduce((a, b) => a + b, 0))}</div>
                  <div className="text-xs text-gray-400">Sum across all enabled flows/stations & shifts</div>
                </div>
                <div>
                  <div className="text-gray-500">Utilization (Avg)</div>
                  <div className="font-medium">{(overallUtilization * 100).toFixed(1)}%</div>
                  <div className="text-xs text-gray-400">Across visible flows for current view</div>
                </div>
                <div>
                  <div className="text-gray-500">Enabled Shifts</div>
                  <div className="font-medium">{shiftCfg.filter((s) => s.enabled).length} / 3</div>
                  <div className="text-xs text-gray-400">
                    {shiftCfg.filter((s) => s.enabled).map((s) => s.name).join(", ") || "None"}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">Enabled Station Types</div>
                  <div className="font-medium">{stationTypes.filter((s) => s.enabled).length}</div>
                  <div className="text-xs text-gray-400">Across pick / pack / inbound</div>
                </div>
              </div>
            </div>
            {/* Demand & Config card */}
            <div className="bg-white rounded-2xl shadow p-4 space-y-4">
              <h2 className="text-lg font-semibold">Demand Data & Config</h2>
              {flows.map((f) => (
                <div key={f}>
                  <label className="text-sm font-medium capitalize">{f} demand (24 comma-separated)</label>
                  <input
                    type="text"
                    value={demandData[f].join(", ")}
                    onChange={(e) => {
                      const parts = e.target.value
                        .split(",")
                        .map((x) => Number(x.trim()));
                      const arr = Array.from({ length: 24 }, (_, i) => (Number.isFinite(parts[i]) ? parts[i] : 0));
                      setDemandData((prev) => ({ ...prev, [f]: arr }));
                    }}
                    className="mt-1 w-full border border-gray-300 rounded-lg p-2 text-sm"
                  />
                </div>
              ))}
              <div className="flex gap-4">
                <button
                  onClick={handleSaveConfig}
                  className="px-3 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700"
                >
                  Save Config
                </button>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="px-3 py-2 rounded-lg text-sm font-medium bg-purple-600 text-white hover:bg-purple-700"
                >
                  Load Config
                </button>
                <input
                  type="file"
                  accept="application/json"
                  className="hidden"
                  ref={fileRef}
                  onChange={handleLoadConfig}
                />
              </div>
            </div>
          </div>
        </div>
        {/* Station Types table */}
        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-lg font-semibold mb-2">Station Types</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1 text-left font-semibold">Enabled</th>
                  <th className="px-2 py-1 text-left font-semibold">Name</th>
                  <th className="px-2 py-1 text-left font-semibold">Flow</th>
                  <th className="px-2 py-1 text-right font-semibold">Stations</th>
                  <th className="px-2 py-1 text-right font-semibold">Rate/hr</th>
                  <th colSpan={3} className="px-2 py-1 text-center font-semibold">Shift Mix</th>
                </tr>
                <tr>
                  <th></th>
                  <th></th>
                  <th></th>
                  <th></th>
                  <th></th>
                  {(["A", "B", "C"] as ShiftId[]).map((sh) => (
                    <th key={sh} className="px-2 py-1 text-center font-semibold">
                      {sh}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stationTypes.map((st) => (
                  <tr key={st.id} className="border-t">
                    <td className="px-2 py-1 text-center">
                      <input
                        type="checkbox"
                        checked={st.enabled}
                        onChange={(e) => updateStationField(st.id, "enabled", e.target.checked)}
                        className="h-4 w-4 text-blue-600 rounded"
                      />
                    </td>
                    <td className="px-2 py-1">{st.name}</td>
                    <td className="px-2 py-1 capitalize">{st.flow}</td>
                    <td className="px-2 py-1 text-right">
                      <input
                        type="number"
                        value={st.stations}
                        onChange={(e) => updateStationField(st.id, "stations", Number(e.target.value))}
                        className="w-20 border border-gray-300 rounded px-1 py-0.5 text-right"
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <input
                        type="number"
                        value={st.ratePerHour}
                        onChange={(e) => updateStationField(st.id, "ratePerHour", Number(e.target.value))}
                        className="w-20 border border-gray-300 rounded px-1 py-0.5 text-right"
                      />
                    </td>
                    {(["A", "B", "C"] as ShiftId[]).map((sh) => (
                      <td key={sh} className="px-1 py-1 text-center">
                        <input
                          type="number"
                          value={st.shiftMix[sh] ?? 0}
                          onChange={(e) => updateStationShiftMix(st.id, sh, Math.max(0, Math.min(1, Number(e.target.value))))}
                          step="0.1"
                          min={0}
                          max={1}
                          className="w-16 border border-gray-300 rounded px-1 py-0.5 text-right"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {/* Shifts table */}
        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="text-lg font-semibold mb-2">Shifts</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1 text-left font-semibold">Enabled</th>
                  <th className="px-2 py-1 text-left font-semibold">Name</th>
                  <th className="px-2 py-1 text-left font-semibold">Start</th>
                  <th className="px-2 py-1 text-left font-semibold">End</th>
                </tr>
              </thead>
              <tbody>
                {shiftCfg.map((sh) => (
                  <tr key={sh.id} className="border-t">
                    <td className="px-2 py-1 text-center">
                      <input
                        type="checkbox"
                        checked={sh.enabled}
                        onChange={(e) => updateShiftCfg(sh.id, "enabled", e.target.checked)}
                        className="h-4 w-4 text-blue-600 rounded"
                      />
                    </td>
                    <td className="px-2 py-1">{sh.name}</td>
                    <td className="px-2 py-1">
                      <input
                        type="time"
                        value={sh.start}
                        onChange={(e) => updateShiftCfg(sh.id, "start", e.target.value)}
                        className="border border-gray-300 rounded px-1 py-0.5"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="time"
                        value={sh.end}
                        onChange={(e) => updateShiftCfg(sh.id, "end", e.target.value)}
                        className="border border-gray-300 rounded px-1 py-0.5"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}