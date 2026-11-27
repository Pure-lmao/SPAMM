import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Leg } from "../markets/leg";

export type SnapKind = "ticket" | "pick";

export type Snap = {
   id: string;
   ownerId: number;
   ownerName: string;
   legs: Leg[];
   stake: string | null;
   payout: string | null;
   result: string | null;
   betAddress: string | null;
   kind: SnapKind;
   inlineMessageId: string | null;
   chatId: number | null;
   messageId: number | null;
   tracking: boolean;
   created: number;
};

type FileShape = {
   snaps: Snap[];
   launchers: Record<string, string>;
};

const FILE = join(import.meta.dir, "..", "..", "data", "shared.json");
const MAX_SNAPS = 500;

const snaps = new Map<string, Snap>();
const launchers = new Map<string, string>();
let chain: Promise<void> = Promise.resolve();

function load(): void {
   try {
      const raw = readFileSync(FILE, "utf8");
      const body = JSON.parse(raw) as FileShape;
      for (const snap of body.snaps ?? []) {
         if (snap != null && typeof snap.id === "string") {
            snaps.set(snap.id, snap);
         }
      }
      for (const [chat, id] of Object.entries(body.launchers ?? {})) {
         if (typeof id === "string") {
            launchers.set(chat, id);
         }
      }
   } catch {
      return;
   }
}

function persist(): Promise<void> {
   const body: FileShape = {
      snaps: [...snaps.values()],
      launchers: Object.fromEntries(launchers),
   };
   chain = chain.then(() => {
      mkdirSync(dirname(FILE), { recursive: true });
      const tmp = `${FILE}.tmp`;
      writeFileSync(tmp, JSON.stringify(body));
      renameSync(tmp, FILE);
   }).catch(() => undefined);
   return chain;
}

function trim(): void {
   if (snaps.size <= MAX_SNAPS) {
      return;
   }
   const ordered = [...snaps.values()].sort((a, b) => a.created - b.created);
   for (const snap of ordered) {
      if (snaps.size <= MAX_SNAPS) {
         break;
      }
      if (!snap.tracking) {
         snaps.delete(snap.id);
      }
   }
   for (const snap of ordered) {
      if (snaps.size <= MAX_SNAPS) {
         break;
      }
      snaps.delete(snap.id);
   }
}

load();

export function stableId(key: string): string {
   let hash = 2166136261;
   for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
   }
   return (hash >>> 0).toString(36);
}

export function shareQuery(id: string): string {
   return `t:${id}`;
}

export function getSnap(id: string): Snap | null {
   return snaps.get(id) ?? null;
}

export function rememberSnap(next: Omit<Snap, "inlineMessageId" | "chatId" | "messageId" | "tracking" | "created"> & { tracking?: boolean }): Snap {
   const prev = snaps.get(next.id);
   const snap: Snap = {
      ...next,
      inlineMessageId: prev?.inlineMessageId ?? null,
      chatId: prev?.chatId ?? null,
      messageId: prev?.messageId ?? null,
      tracking: next.tracking ?? prev?.tracking ?? false,
      created: prev?.created ?? Date.now(),
   };
   snaps.set(snap.id, snap);
   trim();
   void persist();
   return snap;
}

export function attachInline(id: string, inlineMessageId: string | undefined): void {
   const snap = snaps.get(id);
   if (snap == null || inlineMessageId == null || inlineMessageId === "") {
      return;
   }
   snap.inlineMessageId = inlineMessageId;
   snap.tracking = snap.result == null || snap.result === "Pending";
   void persist();
}

export function attachChat(id: string, chatId: number, messageId: number): void {
   const snap = snaps.get(id);
   if (snap == null) {
      return;
   }
   snap.chatId = chatId;
   snap.messageId = messageId;
   snap.tracking = snap.result == null || snap.result === "Pending";
   void persist();
}

export function trackingSnaps(): Snap[] {
   return [...snaps.values()].filter((snap) => snap.tracking && (snap.inlineMessageId != null || snap.messageId != null));
}

export function settleSnap(id: string, result: string): Snap | null {
   const snap = snaps.get(id);
   if (snap == null) {
      return null;
   }
   snap.result = result;
   snap.tracking = false;
   void persist();
   return snap;
}

export function launcherFor(chatId: number): string | null {
   return launchers.get(String(chatId)) ?? null;
}

export function setLauncher(chatId: number, inlineMessageId: string): void {
   launchers.set(String(chatId), inlineMessageId);
   void persist();
}
