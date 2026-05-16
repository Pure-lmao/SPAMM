import { ApiServer } from "./serve";

const port = Number(process.env.PORT ?? 8787);

Bun.serve({
   port,
   fetch(req) {
      return new ApiServer().fetch(req);
   },
});

console.log(`API listening on http://127.0.0.1:${port}`);
