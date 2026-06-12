// Central place for all user-visible Chinese labels.

export const MARKET_TYPES = {
  FULL_TIME_1X2: "full_time_1x2",
  FULL_TIME_CORRECT_SCORE: "full_time_correct_score",
  HALF_TIME_1X2: "half_time_1x2",
  HALF_TIME_CORRECT_SCORE: "half_time_correct_score"
};

export const MARKET_LABELS = {
  [MARKET_TYPES.FULL_TIME_1X2]: "全场独赢",
  [MARKET_TYPES.FULL_TIME_CORRECT_SCORE]: "全场正确比分",
  [MARKET_TYPES.HALF_TIME_1X2]: "半场独赢",
  [MARKET_TYPES.HALF_TIME_CORRECT_SCORE]: "半场正确比分"
};

export const EMPTY_MARKET_HINTS = {
  [MARKET_TYPES.FULL_TIME_1X2]: "暂无全场独赢盘口",
  [MARKET_TYPES.FULL_TIME_CORRECT_SCORE]: "暂无全场正确比分盘口",
  [MARKET_TYPES.HALF_TIME_1X2]: "暂无半场独赢盘口",
  [MARKET_TYPES.HALF_TIME_CORRECT_SCORE]: "暂无半场正确比分盘口"
};

// 三选一标签
export const OUTCOME_LABELS = {
  home: "主胜",
  draw: "平局",
  away: "客胜"
};

export const HALF_OUTCOME_LABELS = {
  home: "半场主胜",
  draw: "半场平局",
  away: "半场客胜"
};

// 比赛阶段 -> 中文状态
export const PHASE_LABELS = {
  live: "进行中",
  starting_soon: "即将开始",
  today: "今日未开赛",
  future: "未开赛",
  ended: "已结束"
};

// 根据原始状态 + 阶段映射出中文状态
export function statusLabel(rawStatus, phase) {
  const raw = String(rawStatus ?? "").toLowerCase();
  if (raw.includes("suspend")) {
    return "暂停";
  }
  if (phase && PHASE_LABELS[phase]) {
    return PHASE_LABELS[phase];
  }
  if (raw.includes("live") || raw.includes("inplay")) {
    return "进行中";
  }
  if (raw.includes("end") || raw.includes("finish") || raw.includes("closed")) {
    return "已结束";
  }
  return "未开赛";
}

export function outcomeLabel(marketType, outcomeKey, fallback) {
  const isHalf =
    marketType === MARKET_TYPES.HALF_TIME_1X2 ||
    marketType === MARKET_TYPES.HALF_TIME_CORRECT_SCORE;
  const map = isHalf ? HALF_OUTCOME_LABELS : OUTCOME_LABELS;
  return map[outcomeKey] ?? fallback ?? outcomeKey;
}
