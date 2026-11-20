import { env } from "cloudflare:workers";

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_USER_BYTES = 500 * 1024 * 1024;
type Kind = "own" | "reference";

function identify(request: Request) {
  const user = request.headers.get("oai-authenticated-user-id");
  const url = new URL(request.url);
  const spotId = url.searchParams.get("spotId") ?? "";
  const kind = url.searchParams.get("kind") as Kind | null;
  if (!user) return { error: Response.json({ error: "認証が必要です。" }, { status: 401 }) };
  if (!/^[a-f0-9]{16}$/.test(spotId) || !kind || !["own", "reference"].includes(kind)) {
    return { error: Response.json({ error: "地点または画像種別が不正です。" }, { status: 400 }) };
  }
  return { user, spotId, kind };
}

export async function GET(request: Request) {
  const identity = identify(request);
  if ("error" in identity) return identity.error;
  const row = await env.DB.prepare("SELECT object_key, mime_type FROM media WHERE user_id = ? AND spot_id = ? AND kind = ?")
    .bind(identity.user, identity.spotId, identity.kind).first<{ object_key: string; mime_type: string }>();
  if (!row) return new Response(null, { status: 404 });
  const object = await env.BUCKET.get(row.object_key);
  if (!object) return new Response(null, { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": row.mime_type,
      "content-length": String(object.size),
      "cache-control": "private, max-age=60",
      etag: object.httpEtag,
    },
  });
}

export async function PUT(request: Request) {
  const identity = identify(request);
  if ("error" in identity) return identity.error;
  const type = request.headers.get("content-type")?.split(";")[0] ?? "";
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (!type.startsWith("image/") || declared > MAX_FILE_BYTES) {
    return Response.json({ error: "画像は4MB以下にしてください。" }, { status: 413 });
  }
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES) {
    return Response.json({ error: "画像は4MB以下にしてください。" }, { status: 413 });
  }
  const previous = await env.DB.prepare("SELECT byte_size FROM media WHERE user_id = ? AND spot_id = ? AND kind = ?")
    .bind(identity.user, identity.spotId, identity.kind).first<{ byte_size: number }>();
  const total = await env.DB.prepare("SELECT COALESCE(SUM(byte_size), 0) AS total FROM media WHERE user_id = ?")
    .bind(identity.user).first<{ total: number }>();
  if ((total?.total ?? 0) - (previous?.byte_size ?? 0) + bytes.byteLength > MAX_USER_BYTES) {
    return Response.json({ error: "クラウド写真が500MBに達しました。不要な写真を削除してください。" }, { status: 413 });
  }
  const key = `users/${encodeURIComponent(identity.user)}/${identity.spotId}/${identity.kind}`;
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type } });
  await env.DB.prepare("INSERT INTO media (user_id, spot_id, kind, object_key, mime_type, byte_size, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, spot_id, kind) DO UPDATE SET object_key = excluded.object_key, mime_type = excluded.mime_type, byte_size = excluded.byte_size, updated_at = excluded.updated_at")
    .bind(identity.user, identity.spotId, identity.kind, key, type, bytes.byteLength, new Date().toISOString()).run();
  return Response.json({ ok: true, byteSize: bytes.byteLength });
}

export async function DELETE(request: Request) {
  const identity = identify(request);
  if ("error" in identity) return identity.error;
  const row = await env.DB.prepare("SELECT object_key FROM media WHERE user_id = ? AND spot_id = ? AND kind = ?")
    .bind(identity.user, identity.spotId, identity.kind).first<{ object_key: string }>();
  if (row) await env.BUCKET.delete(row.object_key);
  await env.DB.prepare("DELETE FROM media WHERE user_id = ? AND spot_id = ? AND kind = ?")
    .bind(identity.user, identity.spotId, identity.kind).run();
  return Response.json({ ok: true });
}
