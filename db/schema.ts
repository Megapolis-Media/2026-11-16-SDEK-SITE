import { type AnySQLiteColumn, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const chatMessage = sqliteTable('chat_message', {
  id: text('id').primaryKey(),
  clientKey: text('client_key').notNull(),
  body: text('body').notNull(),
  createdAt: integer('created_at').notNull(),
  authorKey: text('author_key'),
  authorName: text('author_name'),
  editorial: integer('editorial', { mode: 'boolean' }).notNull().default(false),
  parentId: text('parent_id').references((): AnySQLiteColumn => chatMessage.id),
  threadId: text('thread_id').references((): AnySQLiteColumn => chatMessage.id),
  imageKey: text('image_key'),
  imageType: text('image_type'),
  imageDigest: text('image_digest'),
  imageWidth: integer('image_width'),
  imageHeight: integer('image_height'),
}, table => [
  index('chat_client_time').on(table.clientKey, table.createdAt),
  index('chat_created_at').on(table.createdAt),
  index('chat_thread_time').on(table.threadId, table.createdAt, table.id),
  index('chat_parent').on(table.parentId),
  index('chat_author_time').on(table.authorKey, table.createdAt),
]);

export const siteStudio = sqliteTable('site_studio', {
  id: integer('id').primaryKey(),
  content: text('content').notNull(),
  revision: integer('revision').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const studioSession = sqliteTable('studio_session', {
  tokenHash: text('token_hash').primaryKey().notNull(),
  passwordVersion: text('password_version').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('studio_session_expiry').on(table.expiresAt)]);

export const studioLoginAttempt = sqliteTable('studio_login_attempt', {
  clientKey: text('client_key').primaryKey().notNull(),
  attempts: integer('attempts').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('studio_login_attempt_expiry').on(table.expiresAt)]);

export const chatModeration = sqliteTable('chat_moderation', {
  id: integer('id').primaryKey(),
  revision: integer('revision').notNull(),
});

export const trackRequest = sqliteTable('track_request', {
  id: text('id').primaryKey(),
  authorKey: text('author_key').notNull(),
  authorName: text('author_name').notNull(),
  title: text('title').notNull(),
  artist: text('artist').notNull(),
  phase: text('phase').notNull(),
  createdAt: integer('created_at').notNull(),
  acceptedAt: integer('accepted_at'),
}, table => [
  index('track_created').on(table.createdAt),
  index('track_author_time').on(table.authorKey, table.createdAt),
]);
