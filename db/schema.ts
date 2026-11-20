import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const visits = sqliteTable("visits", {
  userId: text("user_id").notNull(),
  spotId: text("spot_id").notNull(),
  visitedAt: text("visited_at").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.spotId] })]);

export const media = sqliteTable("media", {
  userId: text("user_id").notNull(),
  spotId: text("spot_id").notNull(),
  kind: text("kind", { enum: ["own", "reference"] }).notNull(),
  objectKey: text("object_key").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.spotId, table.kind] })]);
