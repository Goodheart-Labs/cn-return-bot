import type { ReactNode } from "react";
import type { WlLBranch, WritingLimitMetrics } from "../lib/writingLimit";
import { formatPercent, formatSignedPercent } from "../lib/format";

const HR14D_DESCRIPTION =
  'Hit rate over the last 14 days, excluding notes with <10 ratings that have not been assigned Helpful or Not Helpful status ((CRH-CRNH)/TotalNotes among qualifying notes from the last 14 days)';

interface InputRow {
  symbol: string;
  value: string;
  description: string;
  available?: boolean;
}

function inputRows(m: WritingLimitMetrics): InputRow[] {
  return [
    {
      symbol: "NH_5",
      value: `${m.NH_5}`,
      description:
        'Number of notes with CRNH ("Currently Rated Not Helpful") status among last 5 notes with a non-NMR ("Needs More Ratings") status',
    },
    {
      symbol: "NH_10",
      value: `${m.NH_10}`,
      description: "Number of notes with CRNH status among last 10 notes with a non-NMR status",
    },
    {
      symbol: "HR_R",
      value: formatSignedPercent(m.HR_R),
      description:
        "Recent hit rate (e.g. (CRH-CRNH)/TotalNotes among most recent 20 notes). CRH = “Currently Rated Helpful” status",
    },
    {
      symbol: "HR_100",
      value: formatSignedPercent(m.HR_100),
      description: "Hit rate over the most recent 100 notes ((CRH-CRNH)/TotalNotes among most recent 100 notes)",
    },
    {
      symbol: "HR_14d",
      value: m.HR_14d == null ? "n/a (no rating data in last 14d)" : formatSignedPercent(m.HR_14d),
      description: HR14D_DESCRIPTION,
      available: m.HR_14d != null,
    },
    {
      symbol: "DN_30",
      value: m.DN_30.toFixed(2),
      description: "Average daily notes written in last 30 days",
    },
    {
      symbol: "T",
      value: `${m.T}`,
      description: "Total notes written",
    },
  ];
}

function InputRowDisplay({ row }: { row: InputRow }) {
  return (
    <div className="font-mono text-sm leading-6">
      <span className="font-semibold text-gray-900">{row.symbol}</span>
      <span className="text-gray-500"> = </span>
      <span className="text-gray-900">{row.value}</span>
      <span className="text-gray-500"> ({row.description})</span>
    </div>
  );
}

function HrLLine({ m }: { m: WritingLimitMetrics }) {
  const hr100 = formatSignedPercent(m.HR_100);
  const hr14 = m.HR_14d == null ? "n/a" : formatSignedPercent(m.HR_14d);
  const result = formatSignedPercent(m.HR_L);
  return (
    <div className="font-mono text-sm leading-6">
      <span className="font-semibold text-gray-900">HR_L</span>
      <span className="text-gray-500"> = max(HR_100, HR_14d) = max(</span>
      <span className="text-gray-900">{hr100}</span>
      <span className="text-gray-500">, </span>
      <span className="text-gray-900">{hr14}</span>
      <span className="text-gray-500">) = </span>
      <span className="text-gray-900 font-semibold">{result}</span>
      <span className="text-gray-500"> (Longer-term hit rate = max(HR_100, HR_14d))</span>
    </div>
  );
}

function PseudocodeLine({
  active,
  indent = 0,
  children,
}: {
  active?: boolean;
  indent?: number;
  children: ReactNode;
}) {
  const pad = "  ".repeat(indent);
  const cls = active
    ? "bg-yellow-100 text-gray-900"
    : "text-gray-500";
  return (
    <div className={`whitespace-pre font-mono text-sm leading-6 ${cls}`}>
      {pad}
      {children}
    </div>
  );
}

function WlLBlock({ m }: { m: WritingLimitMetrics }) {
  const hrL = m.HR_L;
  const hrR = m.HR_R;
  const cases: { branch: WlLBranch; condition: string; formula: string; resolved: string }[] = [
    {
      branch: 0,
      condition: "If HR_L < 5%:",
      formula: "WL_L = 300 × max(HR_R, HR_L)",
      resolved: `= 300 × max(${formatSignedPercent(hrR)}, ${formatSignedPercent(hrL)}) = ${(300 * Math.max(hrR, hrL)).toFixed(2)}`,
    },
    {
      branch: 1,
      condition: "Else If HR_L < 10%:",
      formula: "WL_L = 15 + 700 × (HR_L - 5%)",
      resolved: `= 15 + 700 × (${formatSignedPercent(hrL)} - 5%) = ${(15 + 700 * (hrL - 0.05)).toFixed(2)}`,
    },
    {
      branch: 2,
      condition: "Else If HR_L < 15%:",
      formula: "WL_L = 50 + 3000 × (HR_L - 10%)",
      resolved: `= 50 + 3000 × (${formatSignedPercent(hrL)} - 10%) = ${(50 + 3000 * (hrL - 0.10)).toFixed(2)}`,
    },
    {
      branch: 3,
      condition: "Else If HR_L < 20%:",
      formula: "WL_L = 200 + 6000 × (HR_L - 15%)",
      resolved: `= 200 + 6000 × (${formatSignedPercent(hrL)} - 15%) = ${(200 + 6000 * (hrL - 0.15)).toFixed(2)}`,
    },
    {
      branch: 4,
      condition: "Else:",
      formula: "WL_L = 500",
      resolved: "= 500",
    },
  ];

  return (
    <div className="space-y-2">
      <div className="font-mono text-sm leading-6">
        <span className="font-semibold text-gray-900">WL_L</span>
        <span className="text-gray-500"> = </span>
        <span className="text-gray-900 font-semibold">{m.WL_L.toFixed(2)}</span>
        <span className="text-gray-500"> (Internal writing limit — the writing limit before accounting for the delta in writing volume vs. DN_30)</span>
      </div>
      <div>
        {cases.map((c) => {
          const active = c.branch === m.wlLBranch;
          return (
            <div key={c.branch}>
              <PseudocodeLine active={active} indent={0}>
                {c.condition}
              </PseudocodeLine>
              <PseudocodeLine active={active} indent={1}>
                {active ? `${c.formula} ${c.resolved}` : c.formula}
              </PseudocodeLine>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WlBlock({ m }: { m: WritingLimitMetrics }) {
  const dn30x5 = m.DN_30 * 5;
  const mainResolved = `= max(5, floor(min(DN_30 × 5, WL_L))) = max(5, floor(min(${dn30x5.toFixed(2)}, ${m.WL_L.toFixed(2)}))) = ${m.WL}`;

  const cases: {
    key: WritingLimitMetrics["wlBranch"];
    condition: string;
    formula: string;
    resolved?: string;
  }[] = [
    { key: "nh10", condition: "If NH_10 ≥ 8:", formula: "WL = 2" },
    { key: "nh5", condition: "Else If NH_5 ≥ 3:", formula: "WL = 5" },
    { key: "newWriter", condition: "Else If T < 20 (new writer):", formula: "WL = 10" },
    {
      key: "main",
      condition: "Else:",
      formula: "WL = max(5, floor(min(DN_30 × 5, WL_L)))",
      resolved: mainResolved,
    },
  ];

  return (
    <div className="space-y-2">
      <div className="font-mono text-sm leading-6">
        <span className="font-semibold text-gray-900">WL</span>
        <span className="text-gray-500"> = </span>
        <span className="text-gray-900 font-semibold">{m.WL}</span>
        <span className="text-gray-500"> (Daily writing limit)</span>
      </div>
      <div>
        {cases.map((c) => {
          const active = c.key === m.wlBranch;
          return (
            <div key={c.key}>
              <PseudocodeLine active={active} indent={0}>
                {c.condition}
              </PseudocodeLine>
              <PseudocodeLine active={active} indent={1}>
                {active && c.resolved ? c.resolved : c.formula}
              </PseudocodeLine>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CheckMark({ ok }: { ok: boolean }) {
  return (
    <span className={ok ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>
      {ok ? "✓" : "✗"}
    </span>
  );
}

function HighPerformingBlock({ m }: { m: WritingLimitMetrics }) {
  const hasEnoughNotes = m.T >= 100;
  const hrLOk = m.HR_L >= 0.05;
  const crnhOk = m.crnhRate100 != null && m.crnhRate100 <= 0.10;
  const impactOk = m.impact90d >= 100;

  const tier = m.highPerformingXxl
    ? "XXL"
    : m.highPerformingLargeXl
      ? "Large / XL"
      : "Not high-performing";

  return (
    <div className="space-y-3">
      <div className="font-mono text-sm leading-6">
        <span className="font-semibold text-gray-900">High-performing tier</span>
        <span className="text-gray-500"> = </span>
        <span className="text-gray-900 font-semibold">{tier}</span>
      </div>

      <div>
        <div className="font-mono text-sm leading-6 text-gray-700">
          Required for both Large and XL:
        </div>
        <ul className="font-mono text-sm leading-6 ml-4 space-y-0.5">
          <li>
            <CheckMark ok={hasEnoughNotes} />{" "}
            <span className="text-gray-900">Has written at least 100 notes</span>{" "}
            <span className="text-gray-500">(T = {m.T})</span>
          </li>
          <li>
            <CheckMark ok={hrLOk} />{" "}
            <span className="text-gray-900">HR_L ≥ 5%</span>{" "}
            <span className="text-gray-500">(HR_L = {formatSignedPercent(m.HR_L)})</span>
          </li>
          <li>
            <CheckMark ok={crnhOk} />{" "}
            <span className="text-gray-900">CRNH rate for the most recent 100 notes ≤ 10%</span>{" "}
            <span className="text-gray-500">
              (= {m.crnhRate100 == null ? "n/a" : formatPercent(m.crnhRate100)})
            </span>
          </li>
        </ul>
      </div>

      <div>
        <div className="font-mono text-sm leading-6 text-gray-700">
          Required for XXL (in addition to the above):
        </div>
        <ul className="font-mono text-sm leading-6 ml-4 space-y-0.5">
          <li>
            <CheckMark ok={impactOk} />{" "}
            <span className="text-gray-900">
              Writing impact (#CRH − #CRNH) ≥ 100 in the past 90 days
            </span>{" "}
            <span className="text-gray-500">(= {m.impact90d})</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

export function WritingLimitPanel({ metrics }: { metrics: WritingLimitMetrics }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-6">
      <h3 className="text-sm font-medium text-gray-800">
        Writing-limit metrics (selected notes)
      </h3>

      <section className="space-y-1">
        <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-1">Inputs</h4>
        {inputRows(metrics).map((row) => (
          <InputRowDisplay key={row.symbol} row={row} />
        ))}
      </section>

      <section className="space-y-1">
        <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-1">
          Derived: longer-term hit rate
        </h4>
        <HrLLine m={metrics} />
      </section>

      <section className="space-y-2">
        <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-1">
          Internal writing limit (WL_L)
        </h4>
        <WlLBlock m={metrics} />
      </section>

      <section className="space-y-2">
        <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-1">
          Daily writing limit (WL)
        </h4>
        <WlBlock m={metrics} />
      </section>

      <section className="space-y-2">
        <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-1">High-performing</h4>
        <HighPerformingBlock m={metrics} />
      </section>
    </div>
  );
}
