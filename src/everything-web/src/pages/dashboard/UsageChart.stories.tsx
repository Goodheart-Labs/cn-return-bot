import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ClaudeUsageRow } from "@cn/core/dashboard";
import { queryKeys } from "@cn/features/query/queryKeys";
import { UsageChart } from "./UsageChart";

const READING_EVERY_MS = 5 * 60_000;
const DAY_MS = 24 * 3600_000;
const START = Date.parse("2026-10-18T00:00:00Z");
const RESET_AT = Date.parse("2026-10-21T11:00:00Z");

/* A fictional week: the usage climbs by about 15 points a day, drops to zero
 * at the weekly reset, and climbs again. */
const ROWS: ClaudeUsageRow[] = Array.from({ length: (7 * DAY_MS) / READING_EVERY_MS }, (_, i) => {
  const at = START + i * READING_EVERY_MS;
  const since = at < RESET_AT ? at - (RESET_AT - 7 * DAY_MS) : at - RESET_AT;
  return {
    at: new Date(at).toISOString(),
    weekly: Math.min(100, Math.round((since / DAY_MS) * 15)),
    weekly_resets_at: new Date(at < RESET_AT ? RESET_AT : RESET_AT + 7 * DAY_MS).toISOString(),
  };
});

const meta = {
  title: "Website/Claude usage chart",
  component: UsageChart,
  parameters: { queries: [[queryKeys.dashboardClaudeUsage(7), ROWS]] },
} satisfies Meta<typeof UsageChart>;
export default meta;

export const AWeek: StoryObj<typeof meta> = {};
