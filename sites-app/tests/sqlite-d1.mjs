import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

// Execute the shipped migrations and real transaction SQL. Only the D1 transport
// is replaced; booking, authorization, allocation and mutation code is unchanged.
export class SQLiteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    const migrations = new URL('../drizzle/', import.meta.url);
    for (const file of readdirSync(migrations).filter(f => f.endsWith('.sql')).sort()) {
      this.sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
    }
  }

  prepare(sql) {
    const sqlite = this.sqlite;
    const prepared = args => ({
      bind(...values) { return prepared(values); },
      async first(column) {
        const row = sqlite.prepare(sql).get(...args);
        return column ? row?.[column] ?? null : row ?? null;
      },
      async all() {
        return {success: true, results: sqlite.prepare(sql).all(...args)};
      },
      async run() { return this.execute(); },
      execute() {
        const result = sqlite.prepare(sql).run(...args);
        return {success: true, results: [], meta: {changes: Number(result.changes)}};
      },
    });
    return prepared([]);
  }

  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const result = statements.map(s => s.execute());
      this.sqlite.exec('COMMIT');
      return result;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }

  close() { this.sqlite.close(); }
}
