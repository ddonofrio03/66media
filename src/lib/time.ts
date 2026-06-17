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
// them is meant to land in the 6 AM Eastern hour (10:30 UTC in EDT, 11:30 UTC
// in EST). We accept the 6 *and* 7 AM Eastern hours because Vercel's Hobby plan
// gives cron invocations a "flexible time window of 1 hour" — the 6:30 AM ET
// job can actually fire as late as ~7:30 AM ET, which an hour-6-only gate would
// silently drop (exactly the failure we hit). Accepting 6–7 keeps the in-window
// invocation guaranteed in both seasons; the once-per-day idempotency guard
// (digest_sends table) ensures only the first one actually sends, so the wider
// window never produces a duplicate digest.
export function isDigestSendWindow(date = new Date()) {
  const parts = getNewYorkParts(date);
  return parts.hour === 6 || parts.hour === 7;
}

export function getDigestLookbackHours(date = new Date()) {
  const parts = getNewYorkParts(date);
  return parts.weekday === "Mon" ? 72 : 36;
}
