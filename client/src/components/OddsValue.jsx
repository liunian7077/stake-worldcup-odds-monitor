import { formatOdds } from "../lib/format.js";

export function OddsValue({ value, direction = "", placeholder = "--", className = "" }) {
  const hasValue = value !== null && value !== undefined && value !== "";
  const isActive = direction === "up" || direction === "down";
  const label = direction === "up" ? "赔率上涨" : direction === "down" ? "赔率下降" : "";
  const text = hasValue ? formatOdds(value) : placeholder;
  const classes = ["odds-value", isActive ? "is-flashing" : "", isActive ? direction : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} aria-label={isActive ? `${text} ${label}` : undefined}>
      <span className="odds-number">{text}</span>
      {isActive ? (
        <span className={`odds-change-badge ${direction}`} aria-hidden="true">
          {direction === "up" ? "↑" : "↓"}
        </span>
      ) : null}
    </span>
  );
}
