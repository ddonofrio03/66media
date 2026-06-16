/**
 * Direct RSS / Atom / YouTube feeds for broadcast (TV & radio), transportation
 * agencies, and local outlets. Unlike the search providers (Google/Bing/GDELT),
 * these are pulled straight from the source so coverage does not depend on a
 * search engine indexing the outlet. Every item still runs through the same
 * keyword + I-66 classifier, so a station's full feed is filtered down to only
 * 66-relevant stories.
 *
 * `kind` selects the parse strategy:
 *   - "rss"     standard RSS 2.0 <item> (WordPress and most newsroom feeds)
 *   - "youtube" YouTube channel Atom feed (videos.xml?channel_id=...)
 *
 * `medium` drives where items land in the digest: TV/Radio → the broadcast
 * section; Agency/Online → the normal news buckets.
 *
 * URLs are populated from the verified-feed discovery pass; only add a feed
 * here once it has been confirmed to return valid XML.
 */
export type FeedKind = "rss" | "youtube";
export type FeedMedium = "TV" | "Radio" | "Agency" | "Online";

export type FeedSource = {
  name: string;
  url: string;
  kind: FeedKind;
  medium: FeedMedium;
  domain?: string;
};

// Each URL below was confirmed to return valid XML with live items. WUSA9's
// /rss hub, NBC4's bare ?rss=y, and the 66 Express sub-category feeds were
// dropped because they 404'd or returned no items. Fox5 and WJLA expose no
// usable RSS, so those stations are covered via their YouTube feeds only.
export const MEDIA_FEEDS: FeedSource[] = [
  // Radio — WTOP is the priority: DC's all-news traffic station, multiple
  // I-66-relevant category feeds.
  { name: "WTOP", url: "https://wtop.com/feed/", kind: "rss", medium: "Radio", domain: "wtop.com" },
  { name: "WTOP Virginia", url: "https://wtop.com/region/local/virginia/feed/", kind: "rss", medium: "Radio", domain: "wtop.com" },
  { name: "WTOP Traffic", url: "https://wtop.com/traffic/feed/", kind: "rss", medium: "Radio", domain: "wtop.com" },
  { name: "WTOP Transit", url: "https://wtop.com/dc-transit/feed/", kind: "rss", medium: "Radio", domain: "wtop.com" },
  { name: "WAMU", url: "https://wamu.org/feed/", kind: "rss", medium: "Radio", domain: "wamu.org" },
  { name: "Federal News Network", url: "https://federalnewsnetwork.com/feed/", kind: "rss", medium: "Radio", domain: "federalnewsnetwork.com" },
  { name: "WMAL", url: "https://www.wmal.com/feed/", kind: "rss", medium: "Radio", domain: "wmal.com" },

  // TV — station newsroom feeds (Fox5/WJLA have no RSS; see YouTube below).
  { name: "NBC4 Washington", url: "https://www.nbcwashington.com/news/local/?rss=y", kind: "rss", medium: "TV", domain: "nbcwashington.com" },
  { name: "WUSA9", url: "https://www.wusa9.com/feeds/syndication/rss/news/local", kind: "rss", medium: "TV", domain: "wusa9.com" },
  { name: "DC News Now", url: "https://www.dcnewsnow.com/feed/", kind: "rss", medium: "TV", domain: "dcnewsnow.com" },

  // Agency / operator — flows into the normal news buckets, not broadcast.
  { name: "66 Express (operator)", url: "https://ride66express.com/feed/", kind: "rss", medium: "Agency", domain: "ride66express.com" },

  // YouTube — actual aired TV segments (and WTOP video). Highest-confidence
  // feeds; channel ids verified live.
  { name: "NBC4 Washington", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC1VKVKhJLc7PjdPPVxTDk0Q", kind: "youtube", medium: "TV", domain: "youtube.com" },
  { name: "FOX 5 DC", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCHLyP4MuA-JAFBCwxXOEDdA", kind: "youtube", medium: "TV", domain: "youtube.com" },
  { name: "7News WJLA", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCfIjR00qhYUFkbWIugAAbGg", kind: "youtube", medium: "TV", domain: "youtube.com" },
  { name: "WUSA9", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCcT6w3xUyVshyR2_2vrMp1w", kind: "youtube", medium: "TV", domain: "youtube.com" },
  { name: "WTOP", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCIFD9TMCLBXvJJMe2OpCtCA", kind: "youtube", medium: "Radio", domain: "youtube.com" },
];
