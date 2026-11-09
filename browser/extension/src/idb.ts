// IndexedDB storage for the Store, in the background service worker.
// Comments (with their thread and screenshot list) in one store, PNG data in another.
import type { Comment } from '@brm/shared';
import type { Counter, Db, StoredShot } from './store.ts';

const NAME = 'browser-review';
const VERSION = 1;

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class IdbDb implements Db {
  #db: Promise<IDBDatabase> | null = null;

  #open(): Promise<IDBDatabase> {
    this.#db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('comments', { keyPath: 'id' });
        db.createObjectStore('shots', { keyPath: 'id' }).createIndex('commentId', 'commentId');
        db.createObjectStore('counters');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        this.#db = null;
        reject(req.error);
      };
    });
    return this.#db;
  }

  async #store(name: string, mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
    return (await this.#open()).transaction(name, mode).objectStore(name);
  }

  async getComment(id: number): Promise<Comment | undefined> {
    return done((await this.#store('comments')).get(id) as IDBRequest<Comment | undefined>);
  }

  async allComments(): Promise<Comment[]> {
    return done((await this.#store('comments')).getAll() as IDBRequest<Comment[]>);
  }

  async putComment(c: Comment): Promise<void> {
    const store = await this.#store('comments', 'readwrite');
    store.put(c);
    await finished(store.transaction);
  }

  async deleteComment(id: number): Promise<void> {
    const tx = (await this.#open()).transaction(['comments', 'shots'], 'readwrite');
    tx.objectStore('comments').delete(id);
    const shots = tx.objectStore('shots');
    const keys = await done(shots.index('commentId').getAllKeys(id));
    for (const k of keys) shots.delete(k);
    await finished(tx);
  }

  async putShot(shot: StoredShot): Promise<void> {
    const store = await this.#store('shots', 'readwrite');
    store.put(shot);
    await finished(store.transaction);
  }

  async getShot(id: number): Promise<StoredShot | undefined> {
    return done((await this.#store('shots')).get(id) as IDBRequest<StoredShot | undefined>);
  }

  async nextId(counter: Counter): Promise<number> {
    const store = await this.#store('counters', 'readwrite');
    const current = ((await done(store.get(counter))) as number | undefined) ?? 0;
    store.put(current + 1, counter);
    await finished(store.transaction);
    return current + 1;
  }
}
