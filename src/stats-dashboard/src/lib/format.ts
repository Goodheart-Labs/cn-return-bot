export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

export function formatUsd(n: number, fractionDigits = 2): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })}`;
}

export function formatUsdMicro(n: number): string {
  // Cost per view is fractions of a cent — render as e.g. "$0.000012".
  if (n === 0) return "$0";
  return `$${n.toFixed(6)}`;
}

export function formatPercent(p: number, fractionDigits = 1): string {
  return `${(p * 100).toFixed(fractionDigits)}%`;
}

export function formatSignedPercent(p: number, fractionDigits = 2): string {
  const sign = p > 0 ? "+" : "";
  return `${sign}${(p * 100).toFixed(fractionDigits)}%`;
}
