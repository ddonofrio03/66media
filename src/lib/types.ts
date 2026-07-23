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
