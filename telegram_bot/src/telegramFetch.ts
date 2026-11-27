import { request as httpsRequest } from "node:https";

function headerRecord(headers: RequestInit["headers"]): Record<string, string> {
   if (headers == null) {
      return {};
   }
   if (headers instanceof Headers) {
      const out: Record<string, string> = {};
      headers.forEach((value, key) => {
         out[key] = value;
      });
      return out;
   }
   const out: Record<string, string> = {};
   const pairs = Array.isArray(headers) ? headers : Object.entries(headers);
   for (const [key, value] of pairs) {
      out[key] = typeof value === "string" ? value : value.join(", ");
   }
   return out;
}

/** HTTPS fetch that finishes when the body arrives. Keep-alive was holding getUpdates open after Telegram had already sent the tap. */
export function telegramFetch(url: string | URL, init?: RequestInit): Promise<Response> {
   const target = typeof url === "string" ? new URL(url) : url;
   const headers = headerRecord(init?.headers);
   headers.connection = "close";
   const body = init?.body == null ? undefined : typeof init.body === "string" ? init.body : init.body instanceof Uint8Array ? Buffer.from(init.body) : undefined;
   return new Promise((resolve, reject) => {
      const req = httpsRequest(target, {
         method: init?.method ?? "GET",
         headers,
      }, (res) => {
         const chunks: Buffer[] = [];
         res.on("data", (chunk: Buffer) => chunks.push(chunk));
         res.on("end", () => {
            const raw = Buffer.concat(chunks);
            const responseHeaders = new Headers();
            for (const [key, value] of Object.entries(res.headers)) {
               if (typeof value === "string") {
                  responseHeaders.set(key, value);
               } else if (Array.isArray(value)) {
                  responseHeaders.set(key, value.join(", "));
               }
            }
            resolve(new Response(raw, { status: res.statusCode ?? 500, headers: responseHeaders }));
         });
      });
      const abort = () => {
         req.destroy();
         reject(new Error("Telegram request aborted"));
      };
      if (init?.signal != null) {
         if (init.signal.aborted) {
            abort();
            return;
         }
         init.signal.addEventListener("abort", abort, { once: true });
      }
      req.on("error", reject);
      if (body != null) {
         req.write(body);
      }
      req.end();
   });
}
