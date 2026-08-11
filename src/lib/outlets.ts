/**
 * Estimated audience reach per mention, by outlet.
 *
 * WHAT THIS IS NOT: Meltwater's reach figures come from licensed audience
 * panels (Comscore, Nielsen). We do not have that data and cannot reproduce
 * their numbers. Everything here is a defensible order-of-magnitude estimate of
 * how many people plausibly see one mention in that outlet — a station's
 * average newscast audience, a site's typical article traffic — not a measured
 * figure. The reports label it "estimated" everywhere it appears, and it should
 * be used for RANKING and RELATIVE comparison, never quoted as a hard number.
 *
 * `source` records where each estimate came from so the weak ones are visible:
 *   "market"    — derived from DC market size / station rank
 *   "editorial" — a judgement call from the outlet's size and beat
 *
 * When a real audience-data feed arrives (Metro Monitoring may carry one),
 * replace these values and set source accordingly; nothing downstream changes.
 *
 * Outlets absent from this table report NULL reach, never 0. "We don't know"
 * and "nobody saw it" must stay distinguishable — the reports count and state
 * the unestimated remainder rather than quietly treating it as zero.
 */

export type Outlet = {
  /** Canonical display name. */
  name: string;
  /** Lowercase substrings that identify this outlet in a `source` value. */
  aliases: string[];
  medium: "tv" | "radio" | "online" | "print" | "trade";
  /** Estimated people reached per mention. */
  reach: number;
  source: "market" | "editorial";
};

export const OUTLET_REACH: Outlet[] = [
  // --- DC-market TV. Washington is a top-10 DMA (~2.5M TV households); a
  // single local newscast segment lands well below household count.
  { name: "WRC-TV (NBC4)", aliases: ["wrc", "nbc4", "nbcwashington", "nbc washington"], medium: "tv", reach: 90_000, source: "market" },
  { name: "WTTG (FOX5)", aliases: ["wttg", "fox5", "fox 5"], medium: "tv", reach: 70_000, source: "market" },
  { name: "WJLA (ABC7)", aliases: ["wjla", "abc7", "abc 7", "7news"], medium: "tv", reach: 60_000, source: "market" },
  { name: "WUSA9", aliases: ["wusa"], medium: "tv", reach: 60_000, source: "market" },
  { name: "DC News Now", aliases: ["dc news now", "dcnewsnow", "wdvm", "wdcw"], medium: "tv", reach: 15_000, source: "market" },

  // --- Radio. WTOP is the market's all-news station and the corridor's most
  // frequent broadcast mention (traffic adjacency).
  { name: "WTOP Radio", aliases: ["wtop"], medium: "radio", reach: 60_000, source: "market" },
  { name: "WAMU", aliases: ["wamu"], medium: "radio", reach: 25_000, source: "market" },
  { name: "WMAL", aliases: ["wmal"], medium: "radio", reach: 15_000, source: "market" },
  { name: "Federal News Network", aliases: ["federal news network"], medium: "radio", reach: 10_000, source: "editorial" },

  // --- Regional / statewide press.
  { name: "The Washington Post", aliases: ["washington post", "washingtonpost"], medium: "print", reach: 150_000, source: "editorial" },
  { name: "Washington Business Journal", aliases: ["washington business journal", "bizjournals"], medium: "print", reach: 20_000, source: "editorial" },
  { name: "Virginia Mercury", aliases: ["virginia mercury"], medium: "online", reach: 15_000, source: "editorial" },
  { name: "Cardinal News", aliases: ["cardinal news"], medium: "online", reach: 8_000, source: "editorial" },

  // --- Corridor local. These matter disproportionately for this client even
  // though their raw audience is small — they cover the road itself.
  { name: "InsideNoVa", aliases: ["insidenova", "inside nova"], medium: "online", reach: 12_000, source: "editorial" },
  { name: "Potomac Local", aliases: ["potomac local", "potomaclocal"], medium: "online", reach: 8_000, source: "editorial" },
  { name: "Prince William Times", aliases: ["prince william times"], medium: "online", reach: 8_000, source: "editorial" },
  { name: "Prince William Living", aliases: ["prince william living", "princewilliamliving"], medium: "online", reach: 5_000, source: "editorial" },
  { name: "ARLnow", aliases: ["arlnow"], medium: "online", reach: 15_000, source: "editorial" },
  { name: "FFXnow", aliases: ["ffxnow"], medium: "online", reach: 10_000, source: "editorial" },
  { name: "ALXnow", aliases: ["alxnow"], medium: "online", reach: 8_000, source: "editorial" },
  { name: "Loudoun Times-Mirror", aliases: ["loudoun times", "loudountimes"], medium: "online", reach: 10_000, source: "editorial" },
  { name: "Fairfax County Times", aliases: ["fairfax county times", "fairfaxtimes"], medium: "online", reach: 8_000, source: "editorial" },

  // --- Trade / industry, for the Relevant News tier.
  { name: "Tow Times", aliases: ["tow times", "towtimes"], medium: "trade", reach: 3_000, source: "editorial" },
  { name: "Roads & Bridges", aliases: ["roads & bridges", "roadsbridges"], medium: "trade", reach: 5_000, source: "editorial" },
  { name: "Transport Topics", aliases: ["transport topics"], medium: "trade", reach: 5_000, source: "editorial" },

  // --- Operator/agency channels. Owned rather than earned, but they do reach
  // people and the report counts them as coverage.
  { name: "Ride66Express", aliases: ["ride66express", "66 express"], medium: "online", reach: 4_000, source: "editorial" },
  { name: "VDOT", aliases: ["vdot", "virginia department of transportation"], medium: "online", reach: 20_000, source: "editorial" },
];

// Longest aliases first so "prince william times" wins over a hypothetical
// "prince william" entry — otherwise a short alias could shadow a specific one.
const SORTED = [...OUTLET_REACH].sort(
  (a, b) =>
    Math.max(...b.aliases.map((x) => x.length)) -
    Math.max(...a.aliases.map((x) => x.length)),
);

/**
 * Match a stored `source` string to a known outlet. Returns null when the
 * outlet has no estimate — callers must treat that as unknown, not zero.
 */
export function outletFor(source: string): Outlet | null {
  const haystack = source.toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  for (const outlet of SORTED) {
    if (outlet.aliases.some((alias) => haystack.includes(alias))) {
      return outlet;
    }
  }
  return null;
}

/** Estimated reach for a mention from this source, or null when unknown. */
export function reachFor(source: string): number | null {
  return outletFor(source)?.reach ?? null;
}

/** Compact display form: 1_200 -> "1.2K", 150_000 -> "150K", 1_500_000 -> "1.5M". */
export function formatReach(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1)}K`;
  }
  return String(value);
}
