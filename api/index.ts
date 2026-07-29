import { ApiServer } from "./serve";
import { rfqHub, type MmWsData } from "./rfqHub";

const port = Number(process.env.PORT ?? 8787);
const api = new ApiServer();

Bun.serve<MmWsData>({
   port,
   fetch(req, server) {
      return api.fetch(req, server);
   },
   websocket: {
      open(ws) {
         rfqHub.onOpen(ws);
      },
      message(ws, message) {
         rfqHub.onMessage(ws, message);
      },
      close(ws) {
         rfqHub.onClose(ws);
      },
   },
});

console.log(`API listening on http://127.0.0.1:${port}`);
console.log(`MM RFQ WebSocket: ws://127.0.0.1:${port}/ws/mm`);
