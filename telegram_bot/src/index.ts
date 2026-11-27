import { Bot, InlineKeyboard, type Context } from "grammy";
import { TELEGRAM_BOT_TOKEN } from "./env";
import { APP_NETWORK } from "./network";
import { logError } from "./chain/rpc";
import { debug, installLogTimestamps } from "./debug";
import { DEBUG } from "./env";
import { applyAct, applyText, explain } from "./screens/apply";
import { buildView, renderView } from "./screens/view";
import { sessionFor, type Session } from "./session";
import { ensureWallet, type BotWallet } from "./wallet/privy";
import { startSlateRefresh } from "./markets/slate";
import { solFreeAddress } from "./wallet/solFree";
import { telegramFetch } from "./telegramFetch";

installLogTimestamps();

const bot = new Bot(TELEGRAM_BOT_TOKEN, {
   client: { fetch: telegramFetch },
});
if (DEBUG) {
   bot.api.config.use(async (prev, method, payload, signal) => {
      if (method !== "getUpdates") {
         return prev(method, payload, signal);
      }
      const started = Date.now();
      debug("poll");
      const result = await prev(method, payload, signal);
      const updates = result.ok && Array.isArray(result.result) ? result.result.length : 0;
      debug("poll back", { ms: Date.now() - started, updates });
      return result;
   });
}
const FAILED = "Something went wrong. Try again. If the issue persists, message @pure_lmao";

async function present(ctx: Context, session: Session, wallet: BotWallet): Promise<void> {
   debug("present", session.nav.name);
   const view = await buildView(session, wallet);
   session.notice = null;
   session.heading = null;
   session.acts = view.rows.map((row) => row.act);
   const kb = new InlineKeyboard();
   view.rows.forEach((row, index) => {
      kb.text(row.text.slice(0, 60), `a:${index}`).row();
   });
   const html = renderView(view).slice(0, 4000);
   const chatId = ctx.chat?.id;
   const markup = { reply_markup: kb, parse_mode: "HTML" as const };
   if (chatId != null && session.anchorId != null) {
      try {
         await ctx.api.editMessageText(chatId, session.anchorId, html, markup);
         return;
      } catch (error) {
         const msg = explain(error);
         if (msg.includes("message is not modified")) {
            return;
         }
         logError(error);
      }
   }
   if (chatId == null) {
      return;
   }
   const sent = await ctx.reply(html, markup);
   session.anchorId = sent.message_id;
}

async function run(ctx: Context, work: (session: Session, wallet: BotWallet) => Promise<void>): Promise<void> {
   const from = ctx.from;
   if (from == null) {
      return;
   }
   const session = sessionFor(from.id);
   if (session.busy) {
      if (ctx.callbackQuery != null) {
         await ctx.answerCallbackQuery({ text: "Still working on the last action." });
      }
      return;
   }
   session.busy = true;
   if (ctx.callbackQuery != null) {
      await ctx.answerCallbackQuery().catch(() => undefined);
   }
   try {
      const walletStarted = Date.now();
      const wallet = await ensureWallet(from.id);
      debug("wallet", { ms: Date.now() - walletStarted });
      debug("update", { user: from.id, nav: session.nav.name });
      await work(session, wallet);
      await present(ctx, session, wallet);
   } catch (error) {
      logError(error);
      session.notice = FAILED;
      try {
         const wallet = await ensureWallet(from.id);
         await present(ctx, session, wallet);
      } catch (inner) {
         logError(inner);
         await ctx.reply(FAILED).catch(() => undefined);
      }
   } finally {
      session.busy = false;
      debug("idle", { user: from.id, nav: session.nav.name });
   }
}

bot.command("start", (ctx) => run(ctx, async (session, wallet) => {
   await applyAct(session, wallet, { t: "menu" });
}));
bot.command("menu", (ctx) => run(ctx, async (session, wallet) => {
   await applyAct(session, wallet, { t: "menu" });
}));
bot.command("cancel", (ctx) => run(ctx, async (session) => {
   session.phase = "idle";
   session.nav = { name: "menu" };
   session.trail = [];
   session.notice = null;
   session.heading = null;
}));
bot.command("bets", (ctx) => run(ctx, async (session, wallet) => {
   await applyAct(session, wallet, { t: "bets", tab: "pending", page: 0 });
}));
bot.command("combo", (ctx) => run(ctx, async (session, wallet) => {
   await applyAct(session, wallet, { t: "combo" });
}));
bot.command("balance", (ctx) => run(ctx, async (session, wallet) => {
   await applyAct(session, wallet, { t: "balance" });
}));

bot.on("callback_query:data", async (ctx) => {
   const data = ctx.callbackQuery.data;
   if (!data.startsWith("a:")) {
      await ctx.answerCallbackQuery();
      return;
   }
   const index = Number(data.slice(2));
   await run(ctx, async (session, wallet) => {
      const act = session.acts[index];
      if (act == null) {
         session.notice = "That button is out of date. Open the menu.";
         return;
      }
      await applyAct(session, wallet, act);
   });
});

bot.on("message:text", async (ctx) => {
   if (ctx.message.text.startsWith("/")) {
      return;
   }
   await run(ctx, async (session, wallet) => {
      await applyText(session, wallet, ctx.message.text);
   });
});

bot.catch((err) => {
   logError(err.error ?? err);
});

const sponsor = await solFreeAddress().catch((error: unknown) => {
   logError(error);
   return null;
});
debug("solfree address", sponsor);
startSlateRefresh();
console.log(`telegram bot polling on ${APP_NETWORK}${DEBUG ? " (debug)" : ""}`);
await bot.start({ timeout: 10 });
