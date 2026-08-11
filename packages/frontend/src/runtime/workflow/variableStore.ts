/**
 * @file packages/frontend/src/runtime/workflow/variableStore.ts
 * @description VariableStore managing workflow execution variables and condition expressions.
 */

export class VariableStore {
  private readonly store = new Map<string, unknown>();

  public constructor(initialVariables: Record<string, unknown> = {}) {
    for (const [key, val] of Object.entries(initialVariables)) {
      this.store.set(key, val);
    }
  }

  public get<T = unknown>(key: string): T | undefined {
    return this.store.get(key) as T;
  }

  public set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  public has(key: string): boolean {
    return this.store.has(key);
  }

  public toObject(): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of this.store.entries()) {
      obj[k] = v;
    }
    return obj;
  }

  public interpolate(input: unknown): unknown {
    if (typeof input === 'string') {
      return input.replace(/\$\{vars\.([a-zA-Z0-9_.]+)\}/g, (_, path) => {
        const val = this.get(path);
        return val !== undefined ? String(val) : '';
      });
    }
    if (Array.isArray(input)) {
      return input.map((item) => this.interpolate(item));
    }
    if (typeof input === 'object' && input !== null) {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
        result[k] = this.interpolate(v);
      }
      return result;
    }
    return input;
  }

  public evaluateCondition(expression: string): boolean {
    try {
      const vars = this.toObject();
      const fn = new Function('vars', `return Boolean(${expression});`);
      return fn(vars);
    } catch {
      return false;
    }
  }
}
