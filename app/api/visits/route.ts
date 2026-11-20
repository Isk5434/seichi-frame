import { env } from "cloudflare:workers";

function userId(request: Request) {
  return request.headers.get("oai-authenticated-user-id");
}

export async function GET(request: Request) {
  const user = userId(request);
  if (!user) return Response.json({ error: "認証が必要です。" }, { status: 401 });
  const result = await env.DB.prepare("SELECT spot_id FROM visits WHERE user_id = ? ORDER BY visited_at DESC")
    .bind(user).all<{ spot_id: string }>();
  return Response.json({ visits: result.results.map((row) => row.spot_id) }, {
    headers: { "cache-control": "no-store" },
  });
}

export async function PUT(request: Request) {
  const user = userId(request);
  if (!user) return Response.json({ error: "認証が必要です。" }, { status: 401 });
  const body = await request.json() as { spotId?: string; visited?: boolean };
  if (!body.spotId || !/^[a-f0-9]{16}$/.test(body.spotId) || typeof body.visited !== "boolean") {
    return Response.json({ error: "地点または訪問状態が不正です。" }, { status: 400 });
  }
  if (body.visited) {
    await env.DB.prepare("INSERT INTO visits (user_id, spot_id, visited_at) VALUES (?, ?, ?) ON CONFLICT(user_id, spot_id) DO UPDATE SET visited_at = excluded.visited_at")
      .bind(user, body.spotId, new Date().toISOString()).run();
  } else {
    await env.DB.prepare("DELETE FROM visits WHERE user_id = ? AND spot_id = ?")
      .bind(user, body.spotId).run();
  }
  return Response.json({ ok: true });
}
