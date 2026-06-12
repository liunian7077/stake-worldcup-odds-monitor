export function toDate(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTime(value) {
  const date = toDate(value);
  if (!date) {
    return "--";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function formatDateTime(value) {
  const date = toDate(value);
  if (!date) {
    return "--";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function formatClock(value) {
  const date = toDate(value);
  if (!date) {
    return "--";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isToday(value, now = new Date()) {
  const date = toDate(value);
  return date ? isSameDay(date, now) : false;
}

// 日期分组标题：今天 / 明天 / MM月DD日 / 未知日期
export function dateGroupLabel(value, now = new Date()) {
  const date = toDate(value);
  if (!date) {
    return "未知日期";
  }
  const today = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameDay(date, today)) {
    return "今天";
  }
  if (isSameDay(date, tomorrow)) {
    return "明天";
  }
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(date);
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatOdds(value) {
  return Number(value).toFixed(2);
}
