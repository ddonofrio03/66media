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

export function isDigestSendWindow(date = new Date()) {
  const parts = getNewYorkParts(date);
  return parts.hour === 6 && parts.minute === 30;
}

export function getDigestLookbackHours(date = new Date()) {
  const parts = getNewYorkParts(date);
  return parts.weekday === "Mon" ? 72 : 36;
}
