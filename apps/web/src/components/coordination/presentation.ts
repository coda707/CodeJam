import type { CoordinationSessionStatus } from "../../types";

export const activeSessionStatuses = new Set<CoordinationSessionStatus>([
  "forming_team",
  "executing",
  "verifying",
  "recovering",
]);

export const formatTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));

export const shortId = (value: string) => value.slice(0, 8);

export const formatNumber = (value: number) =>
  new Intl.NumberFormat().format(value);

export const formatDuration = (value: number) =>
  value < 1_000 ? `${value} ms` : `${(value / 1_000).toFixed(1)} s`;
