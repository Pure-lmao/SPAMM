const STORAGE_KEY = "spamm_invite_ref_code";

const REF_ALPHABET = "ABCDEFIGHJKLMNPQRSTUVWXYZ0123456789";

function randomRefCode(): string {
   const cryptoObj = globalThis.crypto;
   if (cryptoObj == null || typeof cryptoObj.getRandomValues !== "function") {
      let s = "";
      for (let i = 0; i < 6; i++) {
         s += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)]!;
      }
      return s;
   }
   const bytes = new Uint8Array(6);
   cryptoObj.getRandomValues(bytes);
   let out = "";
   for (let i = 0; i < 6; i++) {
      out += REF_ALPHABET[bytes[i]! % REF_ALPHABET.length]!;
   }
   return out;
}

export function isValidRefCode(raw: string): boolean {
   if (raw.length < 3) {
      return false;
   }
   return true;
}

export function sanitizeRefCodeInput(raw: string): string {
   const up = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
   return up;
}

export function loadOrCreateRefCode(): string {
   try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored != null && isValidRefCode(stored)) {
         return stored;
      }
   } catch {
      /* private mode etc. */
   }
   const code = randomRefCode();
   try {
      localStorage.setItem(STORAGE_KEY, code);
   } catch {
      /* ignore */
   }
   return code;
}

export function persistRefCode(code: string): void {
   if (!isValidRefCode(code)) {
      return;
   }
   try {
      localStorage.setItem(STORAGE_KEY, code);
   } catch {
      /* ignore */
   }
}
