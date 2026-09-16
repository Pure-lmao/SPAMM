export type DemoEvent = {
   id: number;
   sport_id: number;
   league_id: number;
   event_name: string;
   home_name: string;
   away_name: string;
   start_time: number;
};

const apiDomain = import.meta.env.VITE_API_DOMAIN?.trim() ?? "";

async function readJson(res: Response): Promise<unknown> {
   const text = await res.text();
   let data: unknown;
   try {
      data = text === "" ? null : JSON.parse(text);
   } catch {
      throw new Error(`${res.status} ${res.statusText}`);
   }
   if (!res.ok) {
      const err =
         data != null && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : `${res.status} ${res.statusText}`;
      throw new Error(err);
   }
   return data;
}

export async function fetchDemoEvents(): Promise<DemoEvent[]> {
   const res = await fetch(`${apiDomain}/api/demo/events`);
   const data = await readJson(res);
   if (!Array.isArray(data)) {
      throw new Error("Expected array from /api/demo/events");
   }
   return data as DemoEvent[];
}

export async function postDemoFreebet(user: string): Promise<{ signature: string; freebetId: number }> {
   const res = await fetch(`${apiDomain}/api/demo/freebet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user }),
   });
   const data = await readJson(res);
   if (data == null || typeof data !== "object") {
      throw new Error("Unexpected freebet response");
   }
   const rec = data as Record<string, unknown>;
   return {
      signature: String(rec.signature ?? ""),
      freebetId: Number(rec.freebetId),
   };
}

export async function postDemoPromo(body: {
   title: string;
   eventId: number;
   odds: number;
   yesLabel: string;
   description?: string;
   allow?: string;
}): Promise<{ id: number }> {
   const res = await fetch(`${apiDomain}/api/demo/promo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
   });
   const data = await readJson(res);
   if (data == null || typeof data !== "object") {
      throw new Error("Unexpected promo response");
   }
   const rec = data as Record<string, unknown>;
   return { id: Number(rec.id) };
}
