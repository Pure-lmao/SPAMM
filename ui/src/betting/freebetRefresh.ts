type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeFreebetRefresh(listener: Listener): () => void {
   listeners.add(listener);
   return () => {
      listeners.delete(listener);
   };
}

export function requestFreebetRefresh(): void {
   for (const listener of listeners) {
      listener();
   }
}
