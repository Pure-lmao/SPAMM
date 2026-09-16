const DISCORD_CONTENT_MAX = 2000;

export function ephemeralJsonBlock(label: string, value: unknown, extra = ""): string {
   const raw = typeof value === "string" ? value : JSON.stringify(value, replacer, 2);
   return wrapFenced(label, "json", raw, extra);
}

/** Pack as many lines as fit in one Discord message (≤2000). */
export function ephemeralLineList(label: string, lines: string[], totalCount: number): string {
   let n = lines.length;
   while (n > 0) {
      const extra = totalCount > n ? `\n(Showing ${n} of ${totalCount})` : "";
      const msg = wrapFenced(label, "", lines.slice(0, n).join("\n"), extra);
      if (msg.length <= DISCORD_CONTENT_MAX) {
         return msg;
      }
      n--;
   }
   return `${label}\n(none)`;
}

function wrapFenced(label: string, lang: string, body: string, extra = ""): string {
   const prefix = `${label}\n\`\`\`${lang}\n`;
   const suffix = `\n\`\`\`${extra}`;
   const maxBody = DISCORD_CONTENT_MAX - prefix.length - suffix.length;
   return `${prefix}${truncateForDiscord(body, Math.max(0, maxBody))}${suffix}`;
}

function replacer(_key: string, value: unknown): unknown {
   return typeof value === "bigint" ? value.toString() : value;
}

function truncateForDiscord(text: string, max: number): string {
   if (text.length <= max) {
      return text;
   }
   const cut = "\n… (truncated)";
   return `${text.slice(0, Math.max(0, max - cut.length))}${cut}`;
}
