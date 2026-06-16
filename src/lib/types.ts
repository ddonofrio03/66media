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
  social: DigestItem[];
  uncertain: DigestItem[];
  suppressedCount: number;
  noRelevantCoverage: boolean;
  // Providers (GDELT / Google News / Reddit) that errored on this run, so a
  // silent collection failure is visible instead of looking like "no news".
  degradedProviders: string[];
  // Items shown in this digest that had never been emailed before. Items
  // previously reported are suppressed unless they are `important`.
  newItemsCount: number;
  // Relevant items that were collected but suppressed because an earlier
  // digest already reported them.
  repeatedItemsCount: number;
};
