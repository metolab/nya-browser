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
  createdAt: text('created_at').notNull(),
  lastTestAt: text('last_test_at'),
  lastTest: text('last_test'),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  groupId: text('group_id'),
  proxyId: text('proxy_id'),
  timezone: text('timezone').notNull(),
  chromeLanguage: text('chrome_language').notNull().default('zh-CN'),
  homeUrl: text('home_url').notNull(),
  idleTimeoutMinutes: integer('idle_timeout_minutes').notNull().default(0),
  fingerprint: text('fingerprint').notNull(),
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
});

export const authTokens = sqliteTable('auth_tokens', {
  token: text('token').primaryKey(),
  userId: text('user_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
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
