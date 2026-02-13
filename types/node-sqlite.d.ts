declare module "node:sqlite" {
  export type SqlRunResult = {
    changes: number;
    lastInsertRowid: number | bigint;
  };

  export class StatementSync {
    run(...params: unknown[]): SqlRunResult;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }

  export const constants: Record<string, unknown>;
  export function backup(...args: unknown[]): Promise<void>;
}
