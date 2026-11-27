type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeBetRefresh(listener: Listener): () => void {
   listeners.add(listener);
   return () => {
      listeners.delete(listener);
   };
}

/** Bet account is confirmed. Listeners reload open bets; a second pass covers a lagging account scan. */
export function requestBetRefresh(): void {
   for (const listener of listeners) {
      listener();
   }
   window.setTimeout(() => {
      for (const listener of listeners) {
         listener();
      }
   }, 1500);
}
