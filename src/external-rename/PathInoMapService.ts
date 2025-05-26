import type { App } from 'obsidian';
import { debounce } from 'obsidian';

const STORE_NAME = 'path-ino-sidecars-plugin'; // Unique store name
const DB_VERSION = 1;
const PROCESS_STORE_ACTIONS_DEBOUNCE_INTERVAL_IN_MILLISECONDS = 1000; // Reduced from 5000

interface DbEntry {
  ino: number;
  path: string;
}

async function getIDBRequestResult<T>(request: IDBRequest<T>): Promise<T> {
  if (request.readyState === 'done') {
    return request.result;
  }
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => {
      resolve(request.result);
    });
    request.addEventListener('error', () => {
      reject(request.error as Error);
    });
  });
}

export class PathInoMapService {
  private db!: IDBDatabase;
  private pendingStoreActions: ((store: IDBObjectStore) => void)[] = [];
  private processStoreActionsDebounced = debounce(() => {
    this.processStoreActions();
  }, PROCESS_STORE_ACTIONS_DEBOUNCE_INTERVAL_IN_MILLISECONDS, true);

  // Using two maps to simulate a TwoWayMap
  private pathToIno: Map<string, number> = new Map();
  private inoToPath: Map<number, string> = new Map();

  public async init(app: App): Promise<void> {
    const request = window.indexedDB.open(`${app.vault.getName()}/${STORE_NAME}`, DB_VERSION);
    request.addEventListener('upgradeneeded', (event) => {
      if (event.newVersion === 1) {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, {
                keyPath: 'path'
            });
        }
      }
    });

    this.db = await getIDBRequestResult(request);
    const transaction = this.db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const dbEntries = await getIDBRequestResult(store.getAll()) as DbEntry[];
    for (const entry of dbEntries) {
      this.pathToIno.set(entry.path, entry.ino);
      this.inoToPath.set(entry.ino, entry.path);
    }
    console.log(`PathInoMapService: Initialized with ${dbEntries.length} entries from IndexedDB.`);
  }

  public set(path: string, ino: number): void {
    const oldPathForIno = this.inoToPath.get(ino);
    const oldInoForPath = this.pathToIno.get(path);

    if (oldInoForPath !== undefined && oldInoForPath !== ino) {
        this.inoToPath.delete(oldInoForPath);
    }
    if (oldPathForIno !== undefined && oldPathForIno !== path) {
        this.pathToIno.delete(oldPathForIno);
    }

    this.pathToIno.set(path, ino);
    this.inoToPath.set(ino, path);

    this.addStoreAction((store) => {
      // Remove old entries if they conflict, then add the new one
      if (oldPathForIno !== undefined && oldPathForIno !== path) {
        store.delete(oldPathForIno);
      }
      // If the current path had a different ino before, that entry in DB is implicitly overwritten by keyPath 'path' or needs deletion if ino was key.
      // Since keyPath is 'path', store.put will handle update/insert.
      store.put({ ino, path });
    });
  }

  public deletePath(path: string): void {
    const ino = this.pathToIno.get(path);
    if (ino !== undefined) {
      this.pathToIno.delete(path);
      // Only delete from inoToPath if this path was indeed the one mapped to the ino
      if (this.inoToPath.get(ino) === path) {
          this.inoToPath.delete(ino);
      }
    }
    this.addStoreAction((store) => store.delete(path));
  }

  public getIno(path: string): number | undefined {
    return this.pathToIno.get(path);
  }

  public getPath(ino: number): string | undefined {
    return this.inoToPath.get(ino);
  }

  public async getPaths(): Promise<string[]> {
    // This method is used for cleanup, so it should reflect DB state or current map keys
    return Array.from(this.pathToIno.keys());
  }

  public clear(): void {
    this.pathToIno.clear();
    this.inoToPath.clear();
    this.addStoreAction((store) => store.clear());
  }

  private addStoreAction(storeAction: (store: IDBObjectStore) => void): void {
    this.pendingStoreActions.push(storeAction);
    this.processStoreActionsDebounced();
  }

  private processStoreActions(): void {
    if (!this.db || this.pendingStoreActions.length === 0) return;

    const pendingActions = [...this.pendingStoreActions];
    this.pendingStoreActions = [];

    try {
        const transaction = this.db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        for (const action of pendingActions) {
        action(store);
        }
        transaction.commit();
    } catch (error) {
        console.error("PathInoMapService: Error processing store actions:", error);
        // Optionally, re-queue failed actions or handle more gracefully
    }
  }
  
  public close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}
