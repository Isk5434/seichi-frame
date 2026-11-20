import { env } from "cloudflare:workers";

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_USER_BYTES = 500 * 1024 * 1024;

function identity(request: Request) {
  const user = request.headers.get("oai-authenticated-user-id");
  const url = new URL(request.url);
  const spotId = url.searchParams.get("spotId") ?? "";
  const photoId = url.searchParams.get("photoId") ?? "";
  if (!user) return { error: Response.json({ error: "認証が必要です。" }, { status: 401 }) };
  if (!/^[a-f0-9]{16}$/.test(spotId)) return { error: Response.json({ error: "地点が不正です。" }, { status: 400 }) };
  if (photoId && !/^[a-f0-9-]{36}$/.test(photoId)) return { error: Response.json({ error: "写真IDが不正です。" }, { status: 400 }) };
  return { user, spotId, photoId };
}

export async function GET(request: Request) {
  const item = identity(request);
  if ("error" in item) return item.error;
  if (!item.photoId) {
    const result = await env.DB.prepare("SELECT id, mime_type, byte_size, created_at FROM spot_photos WHERE user_id = ? AND spot_id = ? ORDER BY created_at DESC")
      .bind(item.user, item.spotId).all<{ id: string; mime_type: string; byte_size: number; created_at: string }>();
    return Response.json({ photos: result.results }, { headers: { "cache-control": "no-store" } });
  }
  const row = await env.DB.prepare("SELECT object_key, mime_type FROM spot_photos WHERE user_id = ? AND spot_id = ? AND id = ?")
    .bind(item.user, item.spotId, item.photoId).first<{ object_key: string; mime_type: string }>();
  if (!row) return new Response(null, { status: 404 });
  const object = await env.BUCKET.get(row.object_key);
  if (!object) return new Response(null, { status: 404 });
  return new Response(object.body, { headers: { "content-type": row.mime_type, "content-length": String(object.size), "cache-control": "private, max-age=60", etag: object.httpEtag } });
}

export async function POST(request: Request) {
  const item = identity(request);
  if ("error" in item) return item.error;
  const type = request.headers.get("content-type")?.split(";")[0] ?? "";
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (!type.startsWith("image/") || declared > MAX_FILE_BYTES) return Response.json({ error: "画像は4MB以下にしてください。" }, { status: 413 });
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES) return Response.json({ error: "画像は4MB以下にしてください。" }, { status: 413 });
  const [mediaTotal, photosTotal] = await Promise.all([
    env.DB.prepare("SELECT COALESCE(SUM(byte_size), 0) AS total FROM media WHERE user_id = ?").bind(item.user).first<{ total: number }>(),
    env.DB.prepare("SELECT COALESCE(SUM(byte_size), 0) AS total FROM spot_photos WHERE user_id = ?").bind(item.user).first<{ total: number }>(),
  ]);
  if ((mediaTotal?.total ?? 0) + (photosTotal?.total ?? 0) + bytes.byteLength > MAX_USER_BYTES) {
    return Response.json({ error: "クラウド写真が500MBに達しました。不要な写真を削除してください。" }, { status: 413 });
  }
  const id = crypto.randomUUID();
  const key = `users/${encodeURIComponent(item.user)}/${item.spotId}/photos/${id}`;
  const createdAt = new Date().toISOString();
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type } });
  await env.DB.prepare("INSERT INTO spot_photos (id, user_id, spot_id, object_key, mime_type, byte_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, item.user, item.spotId, key, type, bytes.byteLength, createdAt).run();
  return Response.json({ photo: { id, mime_type: type, byte_size: bytes.byteLength, created_at: createdAt } }, { status: 201 });
}

export async function DELETE(request: Request) {
  const item = identity(request);
  if ("error" in item) return item.error;
  if (!item.photoId) return Response.json({ error: "写真IDが必要です。" }, { status: 400 });
  const row = await env.DB.prepare("SELECT object_key FROM spot_photos WHERE user_id = ? AND spot_id = ? AND id = ?")
    .bind(item.user, item.spotId, item.photoId).first<{ object_key: string }>();
  if (row) await env.BUCKET.delete(row.object_key);
  await env.DB.prepare("DELETE FROM spot_photos WHERE user_id = ? AND spot_id = ? AND id = ?")
    .bind(item.user, item.spotId, item.photoId).run();
  return Response.json({ ok: true });
}
