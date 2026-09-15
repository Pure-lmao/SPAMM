type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeWalletBalanceRefresh(listener: Listener): () => void {
   listeners.add(listener);
   return () => {
      listeners.delete(listener);
   };
}

export function requestWalletBalanceRefresh(): void {
   for (const listener of listeners) {
      listener();
   }
}
