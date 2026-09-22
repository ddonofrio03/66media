import { mintFreshShareLink } from "@/lib/metro-monitor";

/**
 * Click-time redirect for Metro Monitor clip links. Metro Monitor's own
 * share links expire within ~1-2 days of being minted, so a link stored at
 * collection time is stale before anyone clicks it (see the header comment
 * in src/lib/metro-monitor.ts). This route mints a fresh one on demand and
 * redirects, using the story's stable id instead of a stored uuid.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const idParam = url.searchParams.get("id");
  const shareType = url.searchParams.get("type");
  const id = idParam ? Number(idParam) : NaN;

  if (!Number.isFinite(id) || !shareType) {
    return new Response("Missing or invalid id/type.", { status: 400 });
  }

  const freshUrl = await mintFreshShareLink(id, shareType);
  if (!freshUrl) {
    return new Response(
      "This Metro Monitor clip couldn't be refreshed right now. It may no " +
        "longer be available, or Metro Monitor's site may be down.",
      { status: 502, headers: { "Content-Type": "text/plain" } },
    );
  }

  return Response.redirect(freshUrl, 302);
}
