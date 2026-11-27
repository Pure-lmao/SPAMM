import { InlineKeyboard, type Context } from "grammy";
import { logError } from "../chain/rpc";
import { debug } from "../debug";
import { postedHtml, postedKeyboard } from "./card";
import { explain } from "../screens/apply";
import { buildView, renderView } from "../screens/view";
import type { Session } from "../session";
import type { BotWallet } from "../wallet/privy";

export function groupish(ctx: Context): boolean {
   const kind = ctx.chat?.type;
   if (kind === "group" || kind === "supergroup") {
      return true;
   }
   const data = ctx.callbackQuery?.data ?? "";
   return data === "m:open" || data.startsWith("b:") || data.startsWith("e:");
}

/** Uses the tap immediately. Telegram drops it if the menu waits on the wallet first. */
export async function claimEphemeral(ctx: Context, session: Session): Promise<boolean> {
   const callbackId = ctx.callbackQuery?.id;
   if (callbackId == null || session.ephemeral != null) {
      return session.ephemeral != null;
   }
   try {
      const sent = await ctx.api.raw.sendMessage({
         text: "Opening…",
         ephemeral_message_parameters: {
            callback_query_id: callbackId,
            replace_callback_query_message: ctx.callbackQuery?.data === "m:open",
         },
      });
      if (sent.ephemeral_message_id == null) {
         return false;
      }
      session.ephemeral = { chatId: sent.chat.id, id: sent.ephemeral_message_id };
      const kind = sent.chat.type;
      if (kind === "group" || kind === "supergroup") {
         session.groupChatId = sent.chat.id;
      }
      return true;
   } catch (error) {
      logError(error);
      return false;
   }
}

function keyboardFor(session: Session, view: Awaited<ReturnType<typeof buildView>>): InlineKeyboard {
   const kb = new InlineKeyboard();
   const acts: Session["acts"] = [];
   for (const row of view.rows) {
      if (row.share != null) {
         kb.switchInline(row.text.slice(0, 60), row.share).row();
         continue;
      }
      kb.text(row.text.slice(0, 60), `a:${acts.length}`).row();
      acts.push(row.act);
   }
   session.acts = acts;
   return kb;
}

async function editPanel(ctx: Context, session: Session, html: string, markup: InlineKeyboard): Promise<boolean> {
   const panel = session.ephemeral;
   const userId = ctx.from?.id;
   if (panel == null || userId == null) {
      return false;
   }
   try {
      await ctx.api.editEphemeralMessageText(panel.chatId, userId, panel.id, html, {
         parse_mode: "HTML",
         reply_markup: markup,
      });
      return true;
   } catch (error) {
      if (explain(error).includes("message is not modified")) {
         return true;
      }
      logError(error);
      session.ephemeral = null;
      return false;
   }
}

async function openPanel(ctx: Context, session: Session, html: string, markup: InlineKeyboard): Promise<boolean> {
   const userId = ctx.from?.id;
   if (userId == null) {
      return false;
   }
   const callbackId = ctx.callbackQuery?.id;
   const replied = ctx.message?.reply_to_message;
   const replyEph = ctx.message?.ephemeral_message_id
      ?? (replied != null && "ephemeral_message_id" in replied ? replied.ephemeral_message_id : undefined);
   try {
      const sent = callbackId != null
         ? await ctx.api.raw.sendMessage({
            text: html,
            parse_mode: "HTML",
            reply_markup: markup,
            ephemeral_message_parameters: {
               callback_query_id: callbackId,
               replace_callback_query_message: ctx.callbackQuery?.data === "m:open",
            },
         })
         : replyEph != null && ctx.chat != null
            ? await ctx.api.sendMessage(ctx.chat.id, html, {
               parse_mode: "HTML",
               reply_markup: markup,
               reply_parameters: { ephemeral_message_id: replyEph },
               ephemeral_message_parameters: { receiver_user_id: userId },
            })
            : null;
      if (sent == null) {
         await ctx.reply("Use /menu. It opens on your screen, and the group does not see it.").catch(() => undefined);
         return false;
      }
      if (sent.ephemeral_message_id == null) {
         if (sent.message_id > 0) {
            await ctx.api.deleteMessage(sent.chat.id, sent.message_id).catch(() => undefined);
         }
         throw new Error("Telegram did not keep that screen private");
      }
      session.ephemeral = { chatId: sent.chat.id, id: sent.ephemeral_message_id };
      const kind = sent.chat.type;
      if (kind === "group" || kind === "supergroup") {
         session.groupChatId = sent.chat.id;
      }
      return true;
   } catch (error) {
      logError(error);
      return false;
   }
}

async function publishCard(ctx: Context, session: Session): Promise<void> {
   const card = session.publicCard;
   if (card == null) {
      return;
   }
   session.publicCard = null;
   const text = postedHtml(ctx.from?.first_name ?? "", card.detail);
   const reply_markup = postedKeyboard(card.legs);
   try {
      if (session.guestInlineId != null) {
         await ctx.api.editMessageTextInline(session.guestInlineId, text, {
            parse_mode: "HTML",
            reply_markup,
         });
         session.guestInlineId = null;
         debug("posted guest card");
         return;
      }
      if (session.groupChatId != null) {
         await ctx.api.sendMessage(session.groupChatId, text, {
            parse_mode: "HTML",
            reply_markup,
         });
         debug("posted group card", session.groupChatId);
      }
   } catch (error) {
      logError(error);
   }
}

async function showPrivate(ctx: Context, session: Session, html: string, markup: InlineKeyboard): Promise<void> {
   const chatId = ctx.chat?.id;
   const options = { reply_markup: markup, parse_mode: "HTML" as const };
   if (chatId != null && session.anchorId != null) {
      try {
         await ctx.api.editMessageText(chatId, session.anchorId, html, options);
         return;
      } catch (error) {
         if (explain(error).includes("message is not modified")) {
            return;
         }
         logError(error);
      }
   }
   if (chatId == null) {
      return;
   }
   const sent = await ctx.reply(html, options);
   session.anchorId = sent.message_id;
}

export async function show(ctx: Context, session: Session, wallet: BotWallet): Promise<void> {
   debug("present", session.nav.name);
   const view = await buildView(session, wallet);
   session.notice = null;
   session.heading = null;
   const html = renderView(view).slice(0, 4000);
   const markup = keyboardFor(session, view);
   if (session.surface === "group") {
      const edited = session.ephemeral != null && await editPanel(ctx, session, html, markup);
      const plainGroupText = ctx.callbackQuery == null
         && ctx.message?.ephemeral_message_id == null
         && ctx.message?.text?.startsWith("/") !== true;
      if (!edited && !plainGroupText) {
         await openPanel(ctx, session, html, markup);
      }
      await publishCard(ctx, session);
      return;
   }
   await showPrivate(ctx, session, html, markup);
}
