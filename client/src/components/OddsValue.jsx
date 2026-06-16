import { formatOdds } from "../lib/format.js";

const DIRECTION_LABELS = {
  up: "赔率上涨",
  down: "赔率下降",
  suspended: "盘口暂停",
  resumed: "盘口恢复"
};

const DIRECTION_BADGES = {
  up: "↑",
  down: "↓",
  suspended: "停",
  resumed: "开"
};

export function OddsValue({
  value,
  direction = "",
  placeholder = "--",
  className = "",
  suspended = false
}) {
  const hasValue = value !== null && value !== undefined && value !== "";
  const isSignal = direction in DIRECTION_LABELS;
  const label = DIRECTION_LABELS[direction] ?? "";
  const text = suspended ? "暂停" : hasValue ? formatOdds(value) : placeholder;
  const classes = [
    "odds-value",
    suspended ? "suspended" : "",
    isSignal ? "is-flashing" : "",
    isSignal ? direction : "",
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} aria-label={isSignal ? `${text} ${label}` : undefined}>
      <span className="odds-number">{text}</span>
      {isSignal ? (
        <span className={`odds-change-badge ${direction}`} aria-hidden="true">
          {DIRECTION_BADGES[direction]}
        </span>
      ) : null}
    </span>
  );
}
