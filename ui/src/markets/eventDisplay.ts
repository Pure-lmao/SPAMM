export function displayEventTitle(ev: { event_name: string; home_name: string; away_name: string }): string {
   const n = ev.event_name.trim();
   if (n) {
      return n;
   }
   return `${ev.home_name} vs ${ev.away_name}`;
}

export function formatStart(ts: number): string {
   const d = new Date(ts);
   return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
   });
}
