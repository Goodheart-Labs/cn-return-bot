import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDonationSeries, type DonationDayRow } from "@cn/core/dashboard";
import { CHARITIES, type CharityId } from "@cn/core/donations";
import { queryKeys } from "@cn/features/query/queryKeys";
import { Card } from "@cn/ui/Card";
import { SegmentedControl } from "@cn/ui/SegmentedControl";
import { StatTile } from "@cn/ui/StatTile";
import { LoadState } from "./tableParts";
import { isoDay, LineChart, type Series } from "../../components/chart/LineChart";

type Amount = "outstanding" | "overall";
type TeamVotes = "included" | "excluded";

const AMOUNTS: readonly { id: Amount; label: string }[] = [
  { id: "outstanding", label: "Outstanding" },
  { id: "overall", label: "Overall" },
];

const TEAM_VOTE_CHOICES: readonly { id: TeamVotes; label: string }[] = [
  { id: "included", label: "With team votes" },
  { id: "excluded", label: "Without team votes" },
];

const TOTAL_COLOR = "var(--cn-fg)";
const CHARITY_COLORS: Record<CharityId, string> = {
  give_directly: "var(--cn-primary)",
  givewell: "var(--cn-pending-solid)",
  ace: "var(--cn-positive-solid)",
  ea_ltff: "var(--cn-caution-solid)",
};

const DAY_MS = 24 * 3600_000;

const dollars = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Every UTC day from `firstDay` to today. */
function daysFrom(firstDay: string): Date[] {
  const days: Date[] = [];
  for (let t = new Date(`${firstDay}T00:00:00Z`).getTime(); t <= Date.now(); t += DAY_MS) days.push(new Date(t));
  return days;
}

const amountOf = (row: DonationDayRow, amount: Amount) => (amount === "overall" ? row.paid + row.outstanding : row.outstanding);

/** The running totals per day: one line for all charities, then one for each
 *  charity that has a donation. */
function seriesFor(rows: DonationDayRow[], amount: Amount): Series[] {
  const days = daysFrom(rows[0]!.day);
  const line = (label: string, color: string, counts: (row: DonationDayRow) => boolean): Series => {
    const byDay = new Map<string, number>();
    for (const row of rows) if (counts(row)) byDay.set(row.day, (byDay.get(row.day) ?? 0) + amountOf(row, amount));
    let runningTotal = 0;
    return {
      label,
      color,
      points: days.map((date) => {
        runningTotal += byDay.get(isoDay(date)) ?? 0;
        return { date, value: runningTotal };
      }),
    };
  };
  const charities = CHARITIES.filter((c) => rows.some((row) => row.charity === c.id));
  return [line("All charities", TOTAL_COLOR, () => true), ...charities.map((c) => line(c.label, CHARITY_COLORS[c.id], (row) => row.charity === c.id))];
}

/** Today's amounts under the chosen team switch. */
function Totals({ rows }: { rows: DonationDayRow[] }) {
  const paid = rows.reduce((sum, row) => sum + row.paid, 0);
  const outstanding = rows.reduce((sum, row) => sum + row.outstanding, 0);
  return (
    <div className="flex flex-wrap gap-3">
      <StatTile label="Outstanding" value={dollars(outstanding)} />
      <StatTile label="Paid" value={dollars(paid)} />
      <StatTile label="Overall" value={dollars(paid + outstanding)} />
    </div>
  );
}

/** The vote donations as running totals over time, in all and per charity.
 *  One switch picks what is still to pay or everything owed, paid included.
 *  Another leaves out the donations from the team's own votes, the same split
 *  as `bun run donation-payout`. The rows are fetched once, and the switches
 *  recompute the lines from the cache. */
export function DonationsChart() {
  const [amount, setAmount] = useState<Amount>("outstanding");
  const [teamVotes, setTeamVotes] = useState<TeamVotes>("included");
  const query = useQuery({ queryKey: queryKeys.dashboardDonations, queryFn: fetchDonationSeries });
  const rows = useMemo(() => query.data?.filter((row) => teamVotes === "included" || !row.team_vote), [query.data, teamVotes]);
  const lines = useMemo(() => (rows?.length ? seriesFor(rows, amount) : []), [rows, amount]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <SegmentedControl label="Which donations" options={AMOUNTS} value={amount} onChange={setAmount} />
        <SegmentedControl label="Team votes" options={TEAM_VOTE_CHOICES} value={teamVotes} onChange={setTeamVotes} />
      </div>
      {!rows && <LoadState error={query.error} onRetry={() => void query.refetch()} />}
      {rows?.length === 0 && <p className="text-sm text-fg-muted">No donations yet.</p>}
      {rows && rows.length > 0 && (
        <>
          <Totals rows={rows} />
          <Card className="p-4 sm:p-5">
            <LineChart series={lines} granularity="day" formatValue={dollars} />
          </Card>
        </>
      )}
    </div>
  );
}
