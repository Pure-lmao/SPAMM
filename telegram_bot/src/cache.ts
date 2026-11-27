export function ttlCache<T>(ttlMs: number): {
   get(load: () => Promise<T>): Promise<T>;
   /** Stored value immediately. A missing or old value refreshes in the background, and only the first load waits. */
   current(load: () => Promise<T>): Promise<T>;
   refresh(load: () => Promise<T>): Promise<T>;
   invalidate(): void;
} {
   let value: T | null = null;
   let at = 0;
   let pending: Promise<T> | null = null;

   function fresh(): boolean {
      return value != null && Date.now() - at < ttlMs;
   }

   function begin(load: () => Promise<T>): Promise<T> {
      if (pending != null) {
         return pending;
      }
      pending = load()
         .then((next) => {
            value = next;
            at = Date.now();
            return next;
         })
         .finally(() => {
            pending = null;
         });
      return pending;
   }

   return {
      get(load) {
         if (fresh()) {
            return Promise.resolve(value as T);
         }
         return begin(load);
      },
      current(load) {
         if (!fresh()) {
            const flight = begin(load);
            if (value == null) {
               return flight;
            }
         }
         return Promise.resolve(value as T);
      },
      refresh(load) {
         return begin(load);
      },
      invalidate() {
         value = null;
         at = 0;
      },
   };
}

export function ttlMap<T>(ttlMs: number): {
   get(key: string, load: () => Promise<T>): Promise<T>;
} {
   const hits = new Map<string, { at: number; value: T }>();
   const pending = new Map<string, Promise<T>>();
   return {
      get(key, load) {
         const hit = hits.get(key);
         if (hit != null && Date.now() - hit.at < ttlMs) {
            return Promise.resolve(hit.value);
         }
         const inflight = pending.get(key);
         if (inflight != null) {
            return inflight;
         }
         const run = load()
            .then((value) => {
               hits.set(key, { at: Date.now(), value });
               return value;
            })
            .finally(() => {
               pending.delete(key);
            });
         pending.set(key, run);
         return run;
      },
   };
}
