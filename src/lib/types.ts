export type SourcePriority = "high" | "medium" | "low";

export type Source = {
  sourceName: string;
  medium: string;
  geography: string;
  website: string;
  rawWebsiteOrEmail: string;
  twitterHandle: string;
  verificationStatus: string;
  originalStatus: string;
  priority: SourcePriority;
  monitoringMethod: string[];
  includeInV1: boolean;
  notes: string;
};

export type RelevanceLabel =
  | "confirmed_otb"
  | "likely_otb"
  | "uncertain_i66_segment"
  // Parent/operator (Ferrovial/Cintra/Meridiam) coverage tied to the corridor.
  | "related"
  | "noise";

/**
 * Audience response to a social post, as reported by the platform. Feeds the
 * "social echo" ranking in the reports — Meltwater's term for how far a mention
 * travelled beyond its original posting.
 *
 * Every field is optional because each provider exposes a different subset (X
 * gives all four, LinkedIn gives reactions/comments only, and so on). Absent is
 * meaningfully different from zero, so never default these to 0.
 */
export type Engagement = {
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
};

export type DigestItem = {
  id: string;
  title: string;
  source: string;
  url: string;
  sourceType: string;
  label: RelevanceLabel;
  priority: "important" | "normal" | "low";
  reason: string;
  snippet: string;
  publishedAt: string;
  /** Reporter/author credit, when the feed supplies one (RSS dc:creator). */
  byline?: string;
  /** Verbatim on-air excerpt from a caption match — quoted in the deck. */
  transcript?: string;
  /** Deep link to the moment of the mention, for playable-clip embeds. */
  clipUrl?: string;
  engagement?: Engagement;
};

export type DigestSnapshot = {
  generatedAt: string;
  windowLabel: string;
  recipients: string[];
  totalRelevantCount: number;
  important: DigestItem[];
  confirmed: DigestItem[];
  likely: DigestItem[];
  // Parent/operator (Ferrovial/Cintra/Meridiam) coverage tied to the corridor.
  related?: DigestItem[];
  broadcast: DigestItem[];
  social: DigestItem[];
  uncertain: DigestItem[];
  suppressedCount: number;
  // Items examined inside the time window (relevant + off-topic), and the
  // off-topic subset. Lets the digest say "scanned N, 1 relevant" instead of an
  // alarming "suppressed 369" that also counts stale, out-of-window feed items.
  scannedCount?: number;
  offTopicCount?: number;
  noRelevantCoverage: boolean;
  // Providers (Google News / Reddit / feeds) that errored on this run, so a
  // silent collection failure is visible instead of looking like "no news".
  degradedProviders: string[];
  // Items shown in this digest that had never been emailed before. Items
  // previously reported are suppressed unless they are `important`.
  newItemsCount: number;
  // Relevant items that were collected but suppressed because an earlier
  // digest already reported them.
  repeatedItemsCount: number;
};
