export async function fetchSnapshot() {
  const response = await fetch("/api/snapshot", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`快照请求失败 (${response.status})`);
  }
  return response.json();
}

export async function setWatched(slug) {
  try {
    await fetch("/api/watch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug })
    });
  } catch {
    // 高频订阅失败不影响展示，忽略即可。
  }
}

export async function triggerMockChange(slug) {
  const response = await fetch("/api/mock-change", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(slug ? { slug } : {})
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error ?? `模拟变化失败 (${response.status})`);
  }
  return response.json();
}

export function oddsKey(item) {
  return `${item.eventId}:${item.marketType}:${item.outcomeName}`;
}
