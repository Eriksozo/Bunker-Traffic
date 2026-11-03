// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const records = sqliteTable('bunker_records', {
 key: text('key').primaryKey(), payload: text('payload').notNull(),
 revision: integer('revision').notNull().default(0), updatedAt: text('updated_at').notNull(),
});

export const reports = sqliteTable('bunker_reports', {
 id: text('id').primaryKey(), project: text('project').notNull(),
 createdAt: text('created_at').notNull(), payload: text('payload').notNull(),
}, table => [index('bunker_reports_project_created_idx').on(table.project,table.createdAt,table.id)]);
