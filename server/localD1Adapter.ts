import fs from 'node:fs';
import path from 'node:path';
import type { D1Database, D1ExecResult, D1PreparedStatement, D1Result } from './d1Types.ts';
import { D1_SCHEMA_SQL } from './schemaSql.ts';

interface SqliteStatement {
  run: (...params: unknown[]) => { changes?: number | bigint; lastInsertRowid?: number | bigint };
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  all: (...params: unknown[]) => Record<string, unknown>[];
}

interface SqliteDatabase {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
}

function sanitizeParam(val: unknown): string | number | bigint | Uint8Array | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (
    typeof val === 'string' ||
    typeof val === 'number' ||
    typeof val === 'bigint' ||
    val instanceof Uint8Array
  ) {
    return val;
  }
  return String(val);
}

/**
 * Node.js local SQLite adapter implementing the Cloudflare D1Database interface
 * using Node 22 built-in `node:sqlite`. Used only in Express local dev / Docker mode.
 */
export async function createLocalD1Adapter(
  dbFilePath = path.resolve(process.cwd(), '.data', 'lova-d1.sqlite')
): Promise<D1Database> {
  const dir = path.dirname(dbFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sqliteModule = (await import('node:sqlite')) as unknown as {
    DatabaseSync: new (location: string) => SqliteDatabase;
  };
  const nativeDb = new sqliteModule.DatabaseSync(dbFilePath);
  nativeDb.exec('PRAGMA journal_mode = WAL;');
  nativeDb.exec('PRAGMA foreign_keys = ON;');

  const schemaPath = path.resolve(process.cwd(), 'schema.sql');
  const schemaSql = fs.existsSync(schemaPath)
    ? fs.readFileSync(schemaPath, 'utf8')
    : D1_SCHEMA_SQL;
  nativeDb.exec(schemaSql);

  class LocalPreparedStatement implements D1PreparedStatement {
    private query: string;
    private params: unknown[];

    constructor(query: string, params: unknown[] = []) {
      this.query = query;
      this.params = params;
    }

    bind(...values: unknown[]): D1PreparedStatement {
      return new LocalPreparedStatement(this.query, values.map(sanitizeParam));
    }

    async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
      const row = nativeDb.prepare(this.query).get(...this.params);
      if (!row) return null;
      if (colName) {
        return (row[colName] as T) ?? null;
      }
      return { ...row } as unknown as T;
    }

    async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      const start = Date.now();
      const info = nativeDb.prepare(this.query).run(...this.params);
      return {
        results: [],
        success: true,
        meta: {
          duration: Date.now() - start,
          changes: Number(info?.changes ?? 0),
          last_row_id: Number(info?.lastInsertRowid ?? 0),
        },
      };
    }

    async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      const start = Date.now();
      const rows = nativeDb.prepare(this.query).all(...this.params);
      return {
        results: rows.map((r) => ({ ...r })) as unknown as T[],
        success: true,
        meta: {
          duration: Date.now() - start,
          changes: 0,
          last_row_id: 0,
        },
      };
    }

    async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
      const rows = nativeDb.prepare(this.query).all(...this.params);
      if (rows.length === 0) return [];
      const keys = Object.keys(rows[0]);
      const values = rows.map((r) => keys.map((k) => r[k])) as unknown as T[];
      if (options?.columnNames) {
        return [keys as unknown as T, ...values];
      }
      return values;
    }

    executeSync<T = Record<string, unknown>>(): D1Result<T> {
      const start = Date.now();
      const trimmed = this.query.trim().toUpperCase();
      if (trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA') || trimmed.startsWith('WITH')) {
        const rows = nativeDb.prepare(this.query).all(...this.params);
        return {
          results: rows.map((r) => ({ ...r })) as unknown as T[],
          success: true,
          meta: {
            duration: Date.now() - start,
            changes: 0,
            last_row_id: 0,
          },
        };
      }
      const info = nativeDb.prepare(this.query).run(...this.params);
      return {
        results: [],
        success: true,
        meta: {
          duration: Date.now() - start,
          changes: Number(info?.changes ?? 0),
          last_row_id: Number(info?.lastInsertRowid ?? 0),
        },
      };
    }
  }

  return {
    prepare(query: string): D1PreparedStatement {
      return new LocalPreparedStatement(query);
    },
    async dump(): Promise<ArrayBuffer> {
      const buf = fs.readFileSync(dbFilePath);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    async batch<T = Record<string, unknown>>(
      statements: D1PreparedStatement[]
    ): Promise<D1Result<T>[]> {
      nativeDb.exec('BEGIN IMMEDIATE');
      try {
        const results: D1Result<T>[] = [];
        for (const stmt of statements) {
          results.push((stmt as LocalPreparedStatement).executeSync<T>());
        }
        nativeDb.exec('COMMIT');
        return results;
      } catch (err) {
        try {
          nativeDb.exec('ROLLBACK');
        } catch {
          // ignore rollback error
        }
        throw err;
      }
    },
    async exec(query: string): Promise<D1ExecResult> {
      const start = Date.now();
      nativeDb.exec(query);
      return {
        count: 1,
        duration: Date.now() - start,
      };
    },
  };
}
