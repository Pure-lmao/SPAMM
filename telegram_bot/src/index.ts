import { Bot, type Context } from "grammy";
import { TELEGRAM_BOT_TOKEN } from "./env";
import { APP_NETWORK } from "./network";
import { logError } from "./chain/rpc";
import { debug, installLogTimestamps } from "./debug";
import { DEBUG } from "./env";
import { languageOf, t } from "./i18n";
import { applyAct, applyText } from "./screens/apply";
import { sessionFor, type Session } from "./session";
import { ensureWallet, type BotWallet } from "./wallet/privy";
import { startSlateRefresh } from "./markets/slate";
import { solFreeAddress } from "./wallet/solFree";
import { telegramFetch } from "./telegramFetch";
import { claim, ephemeralReply, groupish, show } from "./group/panel";
import { followSnap, marketsSnap, otherSnap, postSnap } from "./group/cards";
import { onChosen, onGuest, onInline, postedCard } from "./group/entry";
import { sweepCards } from "./group/grade";

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
let botUsername = "";
const memberChats = new Set<number>();
const guestChats = new Set<number>();

async function canPost(ctx: Context): Promise<boolean> {
   const id = ctx.chat?.id;
   const kind = ctx.chat?.type;
   if (id == null || (kind !== "group" && kind !== "supergroup")) {
      return false;
   }
   if (memberChats.has(id)) {
      return true;
   }
   if (guestChats.has(id)) {
      return false;
   }
   if (ctx.message != null) {
      memberChats.add(id);
      return true;
   }
   try {
      await ctx.api.getChat(id);
      memberChats.add(id);
      return true;
   } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (text.includes("not a member") || text.includes("chat not found") || text.includes("kicked")) {
         guestChats.add(id);
      }
      logError(error);
      return false;
   }
}

bot.use(async (ctx, next) => {
   if (ctx.update.guest_message != null) {
      await onGuest(ctx, botUsername);
      return;
   }
   await next();
});

async function run(ctx: Context, work: (session: Session, wallet: BotWallet) => Promise<void>): Promise<void> {
   const from = ctx.from;
   if (from == null) {
      return;
   }
   const session = sessionFor(from.id);
   session.lang = languageOf(from.language_code);
   session.userName = from.first_name ?? session.userName;
   session.surface = groupish(ctx) ? "group" : "dm";
   session.canPost = await canPost(ctx);
   if (session.busy) {
      if (ctx.callbackQuery != null) {
         await ctx.answerCallbackQuery({ text: "Still working on the last action." });
      }
      return;
   }
   session.busy = true;
   let claimed = true;
   if (session.surface === "group") {
      claimed = await claim(ctx, session);
   }
   if (ctx.callbackQuery != null) {
      const text = claimed ? undefined : t(session.lang, "openMenu");
      await ctx.answerCallbackQuery(text == null ? undefined : { text }).catch(() => undefined);
   }
   try {
      const walletStarted = Date.now();
      const wallet = await ensureWallet(from.id);
      debug("wallet", { ms: Date.now() - walletStarted });
      debug("update", { user: from.id, nav: session.nav.name });
      await work(session, wallet);
      await show(ctx, session, wallet);
   } catch (error) {
      logError(error);
      session.notice = FAILED;
      try {
         const wallet = await ensureWallet(from.id);
         await show(ctx, session, wallet);
      } catch (inner) {
         logError(inner);
         if (session.surface !== "group") {
            await ctx.reply(FAILED).catch(() => undefined);
         }
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
bot.command("help", (ctx) => run(ctx, async (session, wallet) => {
   await applyAct(session, wallet, { t: "help" });
}));
bot.command("settings", (ctx) => run(ctx, async (session, wallet) => {
   await applyAct(session, wallet, { t: "settings" });
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
   await run(ctx, async (session, wallet) => {
      if (data === "m:open") {
         await applyAct(session, wallet, { t: "menu" });
         return;
      }
      if (data.startsWith("f:")) {
         const id = data.slice(2);
         await followSnap(session, id);
         if (session.notice != null) {
            await postedCard(ctx, id);
         }
         return;
      }
      if (data.startsWith("o:")) {
         const id = data.slice(2);
         await otherSnap(session, id);
         if (session.notice != null) {
            await postedCard(ctx, id);
         }
         return;
      }
      if (data.startsWith("k:")) {
         await marketsSnap(session, data.slice(2));
         return;
      }
      if (data.startsWith("s:")) {
         const chatId = ctx.chat?.id;
         if (chatId == null || !session.canPost) {
            return;
         }
         const posted = await postSnap(ctx.api, chatId, data.slice(2));
         session.notice = posted ? null : t(session.lang, "gone");
         return;
      }
      if (!data.startsWith("a:")) {
         return;
      }
      const act = session.acts[Number(data.slice(2))];
      if (act == null) {
         session.notice = "That button is out of date. Open the menu.";
         return;
      }
      await applyAct(session, wallet, act);
   });
});

bot.on("inline_query", (ctx) => onInline(ctx));
bot.on("chosen_inline_result", (ctx) => onChosen(ctx));

bot.on("message:text", async (ctx) => {
   if (ctx.message.text.startsWith("/")) {
      return;
   }
   const kind = ctx.chat.type;
   if ((kind === "group" || kind === "supergroup") && !ephemeralReply(ctx)) {
      return;
   }
   await run(ctx, async (session, wallet) => {
      await applyText(session, wallet, ctx.message.text);
   });
});

bot.catch((err) => {
   logError(err.error ?? err);
});

const COMMANDS = [
   { command: "start", description: "Start" },
   { command: "menu", description: "Menu" },
   { command: "bets", description: "Open bets" },
   { command: "combo", description: "Combo" },
   { command: "balance", description: "Balance" },
   { command: "settings", description: "Settings" },
   { command: "help", description: "Help" },
   { command: "cancel", description: "Cancel" },
];

const sponsor = await solFreeAddress().catch((error: unknown) => {
   logError(error);
   return null;
});
debug("solfree address", sponsor);
startSlateRefresh(() => {
   void sweepCards(bot.api);
});
const me = await bot.api.getMe().catch((error: unknown) => {
   logError(error);
   return null;
});
botUsername = me?.username ?? "";
await bot.api.setMyCommands(COMMANDS).catch((error: unknown) => {
   logError(error);
});
await bot.api.setMyCommands(
   COMMANDS.filter((command) => command.command !== "start").map((command) => ({ ...command, is_ephemeral: true })),
   { scope: { type: "all_group_chats" } },
).catch((error: unknown) => {
   logError(error);
});
await bot.api.setMySettings({
   supports_inline_queries: true,
   supports_guest_queries: true,
   inline_feedback_share_denominator: 1,
}).catch((error: unknown) => {
   logError(error);
});
console.log(`telegram bot polling on ${APP_NETWORK}${DEBUG ? " (debug)" : ""}`);
await bot.start({ timeout: 10 });
