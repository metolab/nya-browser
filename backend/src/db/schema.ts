import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull(),
  disabled: integer('disabled').notNull(),
  createdAt: text('created_at').notNull(),
});

export const proxies = sqliteTable('proxies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  username: text('username').notNull(),
  password: text('password').notNull(),
  extra: text('extra').notNull().default('{}'),
  viaProxyId: text('via_proxy_id'),
  createdAt: text('created_at').notNull(),
  lastTestAt: text('last_test_at'),
  lastTest: text('last_test'),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  notepad: text('notepad').notNull().default(''),
  groupId: text('group_id'),
  proxyId: text('proxy_id'),
  customProxy: text('custom_proxy'),
  timezone: text('timezone').notNull(),
  chromeLanguage: text('chrome_language').notNull().default('zh-CN'),
  homeUrl: text('home_url').notNull(),
  idleTimeoutMinutes: integer('idle_timeout_minutes').notNull().default(0),
  fingerprint: text('fingerprint').notNull(),
  webauthn: text('webauthn').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const sessionGroups = sqliteTable('session_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  parentId: text('parent_id'),
  sortOrder: integer('sort_order').notNull(),
  createdAt: text('created_at').notNull(),
});

export const accessGrants = sqliteTable('access_grants', {
  userId: text('user_id').notNull(),
  kind: text('kind').notNull(),
  targetId: text('target_id').notNull(),
  allowNotepad: integer('allow_notepad').notNull(),
});

export const authTokens = sqliteTable('auth_tokens', {
  token: text('token').primaryKey(),
  userId: text('user_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  createdAt: text('created_at').notNull(),
  lastUsedAt: text('last_used_at'),
  expiresAt: integer('expires_at'),
});

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  at: text('at').notNull(),
  actorId: text('actor_id'),
  actorUsername: text('actor_username'),
  action: text('action').notNull(),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  ip: text('ip'),
  success: integer('success').notNull(),
  detail: text('detail'),
});

export const sessionPasskeys = sqliteTable('session_passkeys', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  rpId: text('rp_id').notNull(),
  credentialId: text('credential_id').notNull(),
  isResident: integer('is_resident').notNull(),
  userHandle: text('user_handle'),
  userName: text('user_name').notNull(),
  userDisplayName: text('user_display_name').notNull(),
  privateKey: text('private_key').notNull(),
  signCount: integer('sign_count').notNull(),
  backupEligibility: integer('backup_eligibility'),
  backupState: integer('backup_state'),
  largeBlob: text('large_blob'),
  status: text('status').notNull(),
  label: text('label').notNull(),
  origin: text('origin').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastUsedAt: text('last_used_at'),
});

export const passkeyEvents = sqliteTable('passkey_events', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull(),
  at: text('at').notNull(),
  kind: text('kind').notNull(),
  passkeyId: text('passkey_id'),
  rpId: text('rp_id').notNull(),
  credentialId: text('credential_id').notNull(),
  signCount: integer('sign_count'),
  url: text('url').notNull(),
  actor: text('actor').notNull(),
});

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const assetCacheEntries = sqliteTable('asset_cache_entries', {
  cacheKey: text('cache_key').primaryKey(),
  url: text('url').notNull(),
  host: text('host').notNull(),
  originBucket: text('origin_bucket').notNull(),
  varyLang: text('vary_lang').notNull(),
  resourceType: text('resource_type').notNull(),
  contentType: text('content_type').notNull(),
  responseHeaders: text('response_headers').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  immutable: integer('immutable').notNull(),
  hits: integer('hits').notNull(),
  savedBytes: integer('saved_bytes').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  lastHitAt: integer('last_hit_at').notNull(),
  softExpiresAt: integer('soft_expires_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
