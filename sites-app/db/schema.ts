import { sqliteTable, text, integer, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const settings = sqliteTable('settings', {id:text('id').primaryKey(), data:text('data').notNull()});
export const services = sqliteTable('services', {id:text('id').primaryKey(), data:text('data').notNull()});
export const resources = sqliteTable('resources', {id:text('id').primaryKey(), data:text('data').notNull()});
export const requests = sqliteTable('requests', {id:text('id').primaryKey(), token:text('token').notNull(), idempotency:text('idempotency').notNull(), data:text('data').notNull(), version:integer('version').notNull()}, t=>[uniqueIndex('request_token').on(t.token),uniqueIndex('request_idempotency').on(t.idempotency)]);
export const operations = sqliteTable('operations', {key:text('key').primaryKey(), at:text('at').notNull()});
export const reservations = sqliteTable('reservations', {resourceId:text('resource_id').notNull(),slot:text('slot').notNull(),unit:integer('unit').notNull(),requestId:text('request_id').notNull()},t=>[primaryKey({columns:[t.resourceId,t.slot,t.unit]})]);
export const blocks = sqliteTable('blocks', {id:text('id').primaryKey(), data:text('data').notNull()});
export const rateLimits = sqliteTable('rate_limits', {key:text('key').primaryKey(),count:integer('count').notNull()});

export const tourDepartures = sqliteTable('tour_departures', {id:text('id').primaryKey(),data:text('data').notNull(),version:integer('version').notNull()});
