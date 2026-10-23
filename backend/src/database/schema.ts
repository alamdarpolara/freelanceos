import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

// Fresh builders per table; explicit SQL names are the single naming mechanism.
export function idColumn() {
  return uuid('id').default(sql`uuidv7()`).primaryKey();
}

export function timestampColumns() {
  return {
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull().defaultNow(),
  };
}
