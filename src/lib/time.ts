export function getNewYorkParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    weekday: parts.weekday,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export function isWeekday(weekday: string) {
  return weekday !== "Sat" && weekday !== "Sun";
}

// The two Vercel crons fire at 10:30 and 11:30 UTC. Across DST exactly one of
// them lands in the 6 AM Eastern hour (10:30 UTC in EDT, 11:30 UTC in EST), so
// gating on the hour alone is unambiguous — and, unlike an exact `minute === 30`
// check, it tolerates the several minutes of drift Vercel cron invocations can
// have. With an exact-minute gate, a late invocation silently dropped the day's
// digest entirely. Once-per-day idempotency is enforced separately via the
// digest_sends table.
export function isDigestSendWindow(date = new Date()) {
  const parts = getNewYorkParts(date);
  return parts.hour === 6;
}

export function getDigestLookbackHours(date = new Date()) {
  const parts = getNewYorkParts(date);
  return parts.weekday === "Mon" ? 72 : 36;
}
