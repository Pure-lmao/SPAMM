import { DEBUG } from "./env";

const original = {
   log: console.log.bind(console),
   error: console.error.bind(console),
   warn: console.warn.bind(console),
};

function clock(): string {
   const now = new Date();
   const pad = (value: number, width = 2) => value.toString().padStart(width, "0");
   return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
}

let stamped = false;

/** Prefix console.log, console.error, and console.warn with the local time. */
export function installLogTimestamps(): void {
   if (stamped) {
      return;
   }
   stamped = true;
   for (const method of ["log", "error", "warn"] as const) {
      const write = original[method];
      console[method] = (...args: unknown[]) => {
         write(clock(), ...args);
      };
   }
}

export function debug(step: string, detail?: unknown): void {
   if (!DEBUG) {
      return;
   }
   if (detail === undefined) {
      console.log(`[debug] ${step}`);
      return;
   }
   console.log(`[debug] ${step}`, detail);
}
