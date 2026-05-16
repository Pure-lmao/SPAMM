


/** Safe JSON stringify: handles BigInt, Map, Set, circular refs, Error, functions. */
export function safeJSONStringify(json: unknown, space?: number): string {
   try {
      return JSON.stringify(json, function replacer(_key: string, v: unknown): unknown {
         if (typeof v === "bigint") return v.toString();
         if (typeof v === "function") return `[Function${v.name ? `: ${v.name}` : ""}]`;
         if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
         if (v instanceof Map) {
            return Object.fromEntries([...v.entries()].map(([k, val]) => [String(k), replacer(k, val)]));
         }
         if (v instanceof Set) {
            return [...v].map((item, i) => replacer(String(i), item));
         }
         return v;
      }, space ?? 0);
   } catch (_e) {
      return '"unstringifiable"';
   }
}