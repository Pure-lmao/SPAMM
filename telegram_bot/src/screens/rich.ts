import type { InputRichMessage } from "grammy/types";
import type { View } from "./view";

function esc(value: string): string {
   return value.replace(/[\\|*_`\[]/g, (ch) => `\\${ch}`);
}

function line(value: string): string {
   const parts = value.split(/(https?:\/\/[^\s]+)/g);
   return parts.map((part, index) => index % 2 === 1 ? `[${part}](${part})` : esc(part)).join("");
}

function table(headers: string[], rows: string[][]): string {
   const head = `| ${headers.map((cell) => esc(cell)).join(" | ")} |`;
   const rule = `| ${headers.map(() => "---").join(" | ")} |`;
   const body = rows.map((cells) => `| ${cells.map((cell) => esc(cell.replace(/\n/g, " · "))).join(" | ")} |`);
   return [head, rule, ...body].join("\n");
}

export function renderRich(view: View): InputRichMessage {
   const blocks: string[] = [];
   if (view.title != null && view.title !== "") {
      blocks.push(`# ${esc(view.title)}`);
   }
   if (view.table != null && view.table.rows.length > 0) {
      blocks.push(table(view.table.headers, view.table.rows));
   }
   const body = view.text.trim();
   if (body !== "") {
      blocks.push(body.split("\n").map((row) => line(row)).join("\n\n"));
   }
   const markdown = blocks.join("\n\n").slice(0, 8000);
   return { markdown: markdown === "" ? "Menu" : markdown, skip_entity_detection: true };
}
