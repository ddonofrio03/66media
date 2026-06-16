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
  | "related_toll_express_lane_issue"
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
  important: DigestItem[];
  confirmed: DigestItem[];
  likely: DigestItem[];
  social: DigestItem[];
  uncertain: DigestItem[];
  suppressedCount: number;
  noRelevantCoverage: boolean;
};
