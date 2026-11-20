const ALLOWED_HOST = "mymaps.usercontent.google.com";

export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get("url");
  if (!source) return new Response(null, { status: 400 });
  let url: URL;
  try { url = new URL(source); } catch { return new Response(null, { status: 400 }); }
  if (url.protocol !== "https:" || url.hostname !== ALLOWED_HOST || !url.pathname.startsWith("/hostedimage/")) {
    return new Response(null, { status: 403 });
  }
  url.searchParams.set("fife", "s1600");
  const upstream = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 86400 } });
  if (!upstream.ok || !upstream.headers.get("content-type")?.startsWith("image/")) {
    return new Response(null, { status: 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type")!,
      "cache-control": "private, max-age=86400",
    },
  });
}
