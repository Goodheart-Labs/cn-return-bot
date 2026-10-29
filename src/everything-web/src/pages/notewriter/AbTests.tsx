import { useMemo, useState } from "react";
import { AxisTop } from "@visx/axis";
import { useParentSize } from "@visx/responsive";
import { scaleLinear } from "@visx/scale";
import {
  BASE_STAT_OPTIONS,
  computeDomain,
  forcesAllRuns,
  lowerIsBetter,
  statInterval,
  statKind,
  statLabel,
  windowLabel,
  windowStartDate,
  WINDOW_DAY_OPTIONS,
  type AbComparisonStat,
  type AbStatKind,
  type Domain,
} from "@cn/core/abStats";
import { Z_BY_LEVEL, type ConfidenceLevel, type Interval } from "@cn/core/confidenceIntervals";
import type { AbTest, NotewriterSource } from "@cn/core/notewriter";
import { LoadFailed } from "@cn/features/query/LoadFailed";
import { Button } from "@cn/ui/Button";
import { Card } from "@cn/ui/Card";
import { DropdownMenu, type MenuEntry } from "@cn/ui/DropdownMenu";
import { Checkbox } from "@cn/ui/Field";
import { IconButton } from "@cn/ui/IconButton";
import { CloseIcon } from "@cn/ui/icons";
import { PickerButton } from "@cn/ui/PickerButton";
import { pillButtonClass, QueryChip } from "@cn/ui/QueryChip";
import { humanizeTagName, isNegativeRatingReason } from "@cn/core/ratingReasons";
import { AXIS_COLOR, tickLabel } from "../../components/chart/chartTheme";
import { OLDER_TESTS, RECENT_TESTS } from "./noteFields";
import { useAbCombos, useAbReasons, useAbTests } from "./queries";

/** The database compares at most this many tests at once. */
const MAX_COMPARED_TESTS = 6;
const LEVELS: ConfidenceLevel[] = [90, 95, 99];
const ROW_HEIGHT = 22;
const AXIS_HEIGHT = 24;
/** Room at both ends, so an interval at the edge of the axis is not cut off. */
const AXIS_INSET = 8;

/** A metric as one menu value: "base:pct_helpful", "failure_mode:<tag>" or
 *  "rating_type:<reason>". */
const statValue = (stat: AbComparisonStat) => (stat.kind === "failure_mode" ? `failure_mode:${stat.tag}` : stat.kind === "rating_type" ? `rating_type:${stat.reason}` : `base:${stat.kind}`);

function statFromValue(value: string): AbComparisonStat {
  const [kind, ...rest] = value.split(":");
  const name = rest.join(":");
  if (kind === "failure_mode") return { kind: "failure_mode", tag: name };
  if (kind === "rating_type") return { kind: "rating_type", reason: name };
  return { kind: name as (typeof BASE_STAT_OPTIONS)[number] };
}

function formatValue(point: number, kind: AbStatKind): string {
  if (kind === "cost") return `$${point.toFixed(point < 1 ? 3 : 2)}`;
  const percent = (Math.abs(point) * 100).toFixed(1);
  if (kind === "diff") return `${point >= 0 ? "+" : "−"}${percent}%`;
  return `${percent}%`;
}

const formatTick = (value: number, kind: AbStatKind) => (kind === "cost" ? `$${value.toFixed(value >= 10 ? 0 : 2)}` : `${Math.round(value * 100)}%`);

/** The Metric menu: the six plain metrics, then the failure modes reviewers
 *  tagged and the reasons raters gave, each in a submenu when there are any. */
function metricEntries(stat: AbComparisonStat, onChange: (stat: AbComparisonStat) => void, reasons: { kind: string; name: string; count: number }[]): MenuEntry[] {
  const pick = (values: string[]) => values[0] && onChange(statFromValue(values[0]));
  const choice = (key: string, options: { value: string; label: string; count?: number }[]): MenuEntry => ({ type: "choice", key, multiple: false, options, selected: [statValue(stat)], onChange: pick });
  const failureModes = reasons.filter((r) => r.kind === "failure_mode");
  const ratingReasons = reasons.filter((r) => r.kind === "rating_reason");
  const reasonOption = (prefix: string) => (r: { name: string; count: number }) => ({ value: `${prefix}:${r.name}`, label: prefix === "failure_mode" ? r.name : humanizeTagName(r.name), count: r.count });
  const entries: MenuEntry[] = [choice("base", BASE_STAT_OPTIONS.map((kind) => ({ value: `base:${kind}`, label: statLabel({ kind }) })))];
  if (failureModes.length > 0 || ratingReasons.length > 0) entries.push({ type: "separator", key: "separator" });
  if (failureModes.length > 0) entries.push({ type: "submenu", key: "failure_mode", label: "Failure mode", entries: [choice("failure_modes", failureModes.map(reasonOption("failure_mode")))] });
  if (ratingReasons.length > 0) {
    entries.push({
      type: "submenu",
      key: "rating_type",
      label: "Rating type",
      entries: [
        { type: "heading", key: "helpful", label: "Helpful" },
        choice("helpful_reasons", ratingReasons.filter((r) => !isNegativeRatingReason(r.name)).map(reasonOption("rating_type"))),
        { type: "heading", key: "not_helpful", label: "Not helpful" },
        choice("not_helpful_reasons", ratingReasons.filter((r) => isNegativeRatingReason(r.name)).map(reasonOption("rating_type"))),
      ],
    });
  }
  return entries;
}

/** The Compare menu: the tests varied in the last 3 days, then the others in
 *  a submenu, each ticked when it is compared. The order of the ticks is the
 *  order of the row labels. */
function CompareMenu({ tests, chosen, onChange }: { tests: AbTest[]; chosen: string[]; onChange: (chosen: string[]) => void }) {
  const toggle = (picked: string[], group: AbTest[]) => {
    const others = chosen.filter((name) => !group.some((t) => t.name === name));
    const kept = chosen.filter((name) => picked.includes(name) && group.some((t) => t.name === name));
    const added = picked.filter((name) => !chosen.includes(name));
    onChange([...others, ...kept, ...added].slice(0, MAX_COMPARED_TESTS));
  };
  const choice = (key: string, group: AbTest[]): MenuEntry => ({
    type: "choice",
    key,
    multiple: true,
    options: group.map((t) => ({ value: t.name, label: t.name })),
    selected: chosen.filter((name) => group.some((t) => t.name === name)),
    onChange: (picked) => toggle(picked, group),
  });
  const recent = tests.filter((t) => t.recentlyVaried);
  const older = tests.filter((t) => !t.recentlyVaried);
  const entries: MenuEntry[] = [];
  if (recent.length > 0) entries.push({ type: "heading", key: "recent-heading", label: RECENT_TESTS }, choice("recent", recent));
  if (older.length > 0) {
    const chosenOlder = chosen.filter((name) => older.some((t) => t.name === name)).length;
    entries.push({ type: "submenu", key: "older", label: OLDER_TESTS, value: chosenOlder > 0 ? `${chosenOlder} on` : undefined, entries: [choice("older", older)] });
  }
  return (
    <DropdownMenu
      label="Compare A/B tests"
      entries={entries}
      trigger={
        <button type="button" className={pillButtonClass}>
          {chosen.length > 0 ? `Compare (${chosen.length})` : "Compare"}
        </button>
      }
    />
  );
}

/** The axis every interval row shares, and the rows' intervals, on one scale. */
function useAxis(domain: Domain, width: number) {
  return useMemo(() => scaleLinear<number>({ domain: [domain.min, domain.max], range: [AXIS_INSET, Math.max(AXIS_INSET + 1, width - AXIS_INSET)] }), [domain, width]);
}

function IntervalAxis({ domain, kind, width }: { domain: Domain; kind: AbStatKind; width: number }) {
  const x = useAxis(domain, width);
  return (
    <svg width={width} height={AXIS_HEIGHT} className="block">
      <AxisTop top={AXIS_HEIGHT - 1} scale={x} numTicks={5} stroke={AXIS_COLOR} tickStroke={AXIS_COLOR} tickFormat={(v) => formatTick(Number(v), kind)} tickLabelProps={() => ({ ...tickLabel, textAnchor: "middle" })} />
    </svg>
  );
}

/** One interval: a filled band from its low to its high end with a stroke
 *  at the estimate, and a zero line when the metric is a difference. */
function IntervalBar({ interval, domain, kind, width }: { interval: Interval; domain: Domain; kind: AbStatKind; width: number }) {
  const x = useAxis(domain, width);
  return (
    <svg width={width} height={ROW_HEIGHT} className="block">
      {kind === "diff" && <line x1={x(0)} x2={x(0)} y1={0} y2={ROW_HEIGHT} stroke={AXIS_COLOR} />}
      <rect x={x(interval.lo)} y={6} width={Math.max(2, x(interval.hi) - x(interval.lo))} height={ROW_HEIGHT - 12} rx={3} fill="var(--cn-positive-selected)" stroke="var(--cn-positive-solid)" />
      <line x1={x(interval.point)} x2={x(interval.point)} y1={3} y2={ROW_HEIGHT - 3} stroke="var(--cn-positive-solid)" strokeWidth={2} />
    </svg>
  );
}

/** The label gutter takes this share of the width, within these bounds. */
const LABEL_SHARE = 0.35;
const LABEL_WIDTH = { min: 160, max: 260 };
const HIDE_BUTTON_WIDTH = 24;
const COLUMN_GAP = 12;
/** Below this width a row's label sits above its interval, which then gets
 *  the whole width. */
const STACKED_BELOW = 560;

/** The label gutter, the plot and the hide button, in pixels, shared by the
 *  axis row and every interval row, so the intervals line up under the axis.
 *  On a narrow screen the label gutter is dropped and labels span the row. */
function rowColumns(width: number) {
  const stacked = width < STACKED_BELOW;
  const label = stacked ? 0 : Math.min(LABEL_WIDTH.max, Math.max(LABEL_WIDTH.min, width * LABEL_SHARE));
  const plot = Math.max(0, width - label - HIDE_BUTTON_WIDTH - (stacked ? 1 : 2) * COLUMN_GAP);
  const columns = stacked ? `${plot}px ${HIDE_BUTTON_WIDTH}px` : `${label}px ${plot}px ${HIDE_BUTTON_WIDTH}px`;
  return { plot, stacked, style: { display: "grid", alignItems: "center", columnGap: COLUMN_GAP, rowGap: 2, gridTemplateColumns: columns } };
}

/** A combination's arms, one test per line. */
function ComboLabel({ tests, picks }: { tests: string[]; picks: Record<string, string> }) {
  return (
    <div className="text-sm leading-tight text-fg [overflow-wrap:anywhere]">
      {tests.map((test) => (
        <div key={test}>
          <span className="text-fg-muted">{test} = </span>
          {picks[test]}
        </div>
      ))}
    </div>
  );
}

/** The A/B comparison: pick tests, and every combination of their arms gets a
 *  row with the chosen metric's estimate and confidence interval, the best on
 *  top. A row can be hidden and brought back. `source` says whose runs and
 *  notes: the X bot's or Common Notes'. */
export function AbTests({ source }: { source: NotewriterSource }) {
  const tests = useAbTests(source);
  const reasons = useAbReasons(source);
  const [chosen, setChosen] = useState<string[]>([]);
  const [stat, setStat] = useState<AbComparisonStat>({ kind: "pct_helpful" });
  const [windowDays, setWindowDays] = useState<number | null>(null);
  const [level, setLevel] = useState<ConfidenceLevel>(95);
  const [withRuns, setWithRuns] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const combos = useAbCombos(source, chosen, windowStartDate(windowDays));

  if (tests.isError) return <LoadFailed what="The A/B tests" onRetry={() => void tests.refetch()} />;
  if (!tests.data) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (tests.data.length === 0)
    return (
      <p className="py-12 text-center text-sm text-fg-muted">
        No A/B test has varied here yet. A test shows up once a run draws an arm other than its control.
      </p>
    );

  const kind = statKind(stat);
  const forceAll = forcesAllRuns(stat);
  const label = (picks: Record<string, string>) => chosen.map((test) => `${test}=${picks[test]}`).join(" · ");
  const rows = (combos.data ?? []).map((combo) => ({
    key: label(combo.picks),
    picks: combo.picks,
    result: statInterval(combo.counts, stat, forceAll || withRuns, Z_BY_LEVEL[level]),
  }));
  const shown = rows
    .filter((row) => !hidden.has(row.key))
    .sort((a, b) => {
      if (a.result && b.result) return (lowerIsBetter(stat) ? 1 : -1) * (a.result.interval.point - b.result.interval.point);
      return a.result ? -1 : b.result ? 1 : a.key.localeCompare(b.key);
    });
  const hiddenRows = rows.filter((row) => hidden.has(row.key));
  const domain = computeDomain(shown.flatMap((row) => (row.result ? [row.result.interval] : [])), kind);
  const remove = (test: string) => setChosen(chosen.filter((name) => name !== test));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <CompareMenu tests={tests.data} chosen={chosen} onChange={setChosen} />
        {chosen.map((test, index) => (
          <QueryChip
            key={test}
            label={
              <>
                <span className="text-fg-muted">{index + 1}.</span> {test}
              </>
            }
            menu={[{ type: "action", key: "remove", label: "Stop comparing this test", onSelect: () => remove(test) }]}
            menuLabel={test}
            removeLabel={`Stop comparing ${test}`}
            onRemove={() => remove(test)}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <PickerButton label="Metric" value={statLabel(stat)} entries={metricEntries(stat, setStat, reasons.data ?? [])} />
        <PickerButton
          label="Window"
          value={windowLabel(windowDays)}
          entries={[{ type: "choice", key: "window", multiple: false, options: WINDOW_DAY_OPTIONS.map((days) => ({ value: String(days), label: windowLabel(days) })), selected: [String(windowDays)], onChange: ([days]) => setWindowDays(days === "null" ? null : Number(days)) }]}
        />
        <PickerButton
          label="Confidence"
          value={`${level}%`}
          entries={[{ type: "choice", key: "level", multiple: false, options: LEVELS.map((l) => ({ value: String(l), label: `${l}%` })), selected: [String(level)], onChange: ([l]) => setLevel(Number(l) as ConfidenceLevel) }]}
        />
        <Checkbox checked={forceAll || withRuns} disabled={forceAll} onChange={setWithRuns} className="text-sm text-fg-secondary">
          Include non-candidate runs
        </Checkbox>
      </div>
      {chosen.length === 0 ? (
        <p className="text-sm text-fg-muted">Pick one or more A/B tests to compare.</p>
      ) : combos.isError ? (
        <LoadFailed what="The comparison" onRetry={() => void combos.refetch()} />
      ) : !combos.data ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-muted">No notes or runs drew these tests in this window.</p>
      ) : (
        <Card className="p-4">
          <IntervalRows rows={shown} tests={chosen} stat={stat} domain={domain} onHide={(key) => setHidden(new Set(hidden).add(key))} />
          {hiddenRows.length > 0 && <HiddenRows keys={hiddenRows.map((row) => row.key)} onRestore={(key) => setHidden(new Set([...hidden].filter((k) => k !== key)))} onRestoreAll={() => setHidden(new Set())} />}
        </Card>
      )}
    </div>
  );
}

interface IntervalRow {
  key: string;
  picks: Record<string, string>;
  result: ReturnType<typeof statInterval>;
}

/** The axis and one row per combination: its arms, its sample size and
 *  estimate, its interval, and a button that hides it. */
function IntervalRows({ rows, tests, stat, domain, onHide }: { rows: IntervalRow[]; tests: string[]; stat: AbComparisonStat; domain: Domain; onHide: (key: string) => void }) {
  const { parentRef, width } = useParentSize({ debounceTime: 50 });
  const kind = statKind(stat);
  const { plot, stacked, style } = rowColumns(width);
  const spanRow = stacked ? { gridColumn: "1 / -1" } : undefined;
  return (
    <div ref={parentRef} className="space-y-3">
      {width > 0 && (
        <>
          <div style={style}>
            <div className="truncate text-xs font-semibold text-fg-muted" style={spanRow}>
              {statLabel(stat)}
            </div>
            <IntervalAxis domain={domain} kind={kind} width={plot} />
          </div>
          {rows.map((row) => (
            <div key={row.key} style={style}>
              <div className="min-w-0" style={spanRow}>
                <ComboLabel tests={tests} picks={row.picks} />
                <div className="text-xs text-fg-muted">
                  {row.result ? (
                    <>
                      n={row.result.n} · <span className="font-semibold text-fg-secondary">{formatValue(row.result.interval.point, kind)}</span>
                    </>
                  ) : (
                    "no data"
                  )}
                </div>
              </div>
              <div>{row.result && <IntervalBar interval={row.result.interval} domain={domain} kind={kind} width={plot} />}</div>
              <IconButton label="Hide this combination" onClick={() => onHide(row.key)}>
                <CloseIcon size={14} aria-hidden />
              </IconButton>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function HiddenRows({ keys, onRestore, onRestoreAll }: { keys: string[]; onRestore: (key: string) => void; onRestoreAll: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3">
      <div className="flex gap-4 text-sm">
        <Button variant="link" onClick={() => setOpen(!open)}>
          {open ? "Hide the hidden rows" : `Show hidden rows (${keys.length})`}
        </Button>
        <Button variant="link" onClick={onRestoreAll}>
          Bring all back
        </Button>
      </div>
      {open && (
        <div className="flex flex-wrap gap-2">
          {keys.map((key) => (
            <Button key={key} variant="secondary" onClick={() => onRestore(key)} title="Bring this row back">
              {key}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
