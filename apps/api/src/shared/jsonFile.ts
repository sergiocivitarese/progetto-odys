import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * File JSON con scrittura atomica (file temporaneo + rename) e coda seriale,
 * così due richieste concorrenti non si sovrascrivono a metà.
 */
export class JsonFile<T> {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string, private readonly fallback: () => T) {}

  async read(): Promise<T> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.fallback();
      throw error;
    }
  }

  async readRaw(): Promise<string | null> {
    try {
      return await readFile(this.filePath, 'utf8');
    } catch {
      return null;
    }
  }

  async writeRaw(value: string): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmp, value, 'utf8');
    await rename(tmp, this.filePath);
  }

  /** Legge, trasforma e riscrive in modo esclusivo rispetto alle altre update. */
  update<R>(fn: (current: T) => Promise<{ next: T; result: R }> | { next: T; result: R }): Promise<R> {
    const run = this.queue.then(async () => {
      const { next, result } = await fn(await this.read());
      await this.writeRaw(JSON.stringify(next, null, 2));
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
