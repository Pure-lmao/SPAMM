import { InlineKeyboard, type Context } from "grammy";
import type { InputRichMessage } from "grammy/types";
import { logError } from "../chain/rpc";
import { debug } from "../debug";
import { t } from "../i18n";
import { explain } from "../screens/apply";
import { renderRich } from "../screens/rich";
import { buildView, type View, type ViewRow } from "../screens/view";
import type { Act } from "../screens/acts";
import type { Session } from "../session";
import type { BotWallet } from "../wallet/privy";

export function groupish(ctx: Context): boolean {
   const kind = ctx.chat?.type ?? ctx.callbackQuery?.message?.chat.type;
   if (kind === "group" || kind === "supergroup") {
      return true;
   }
   const data = ctx.callbackQuery?.data ?? "";
   if (ctx.callbackQuery?.inline_message_id != null && ctx.callbackQuery.message == null) {
      return true;
   }
   return data === "m:open" || data.startsWith("f:") || data.startsWith("o:") || data.startsWith("k:");
}

export function ephemeralReply(ctx: Context): boolean {
   const message = ctx.message;
   if (message == null) {
      return false;
   }
   if (message.ephemeral_message_id != null) {
      return true;
   }
   const replied = message.reply_to_message;
   return replied != null && "ephemeral_message_id" in replied && replied.ephemeral_message_id != null;
}

function pushButton(kb: InlineKeyboard, session: Session, row: ViewRow, acts: Act[]): void {
   const text = row.text.slice(0, 60);
   if (row.share != null) {
      if (session.canPost) {
         kb.text(text, `s:${row.share.slice(2)}`);
         return;
      }
      if (session.surface === "group") {
         kb.switchInlineCurrent(text, row.share);
      } else {
         kb.switchInline(text, row.share);
      }
      return;
   }
   kb.text(text, `a:${acts.length}`);
   acts.push(row.act);
}

function keyboardFor(session: Session, view: View): InlineKeyboard {
   const kb = new InlineKeyboard();
   const acts: Act[] = [];
   let index = 0;
   while (index < view.rows.length) {
      const row = view.rows[index]!;
      if (row.band != null) {
         const band = row.band;
         while (index < view.rows.length && view.rows[index]?.band === band) {
            pushButton(kb, session, view.rows[index]!, acts);
            index += 1;
         }
         kb.row();
         continue;
      }
      pushButton(kb, session, row, acts);
      kb.row();
      index += 1;
   }
   session.acts = acts;
   return kb;
}

async function editPanel(ctx: Context, session: Session, rich: InputRichMessage, markup: InlineKeyboard): Promise<boolean> {
   const panel = session.ephemeral;
   const userId = ctx.from?.id;
   if (panel == null || userId == null) {
      return false;
   }
   try {
      await ctx.api.editEphemeralMessageText(panel.chatId, userId, panel.id, rich, { reply_markup: markup });
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

async function openEphemeral(ctx: Context, session: Session, rich: InputRichMessage, markup: InlineKeyboard): Promise<boolean> {
   const userId = ctx.from?.id;
   if (userId == null) {
      return false;
   }
   const callbackId = ctx.callbackQuery?.id;
   const commandEph = ctx.message?.ephemeral_message_id;
   const replace = ctx.callbackQuery?.data === "m:open";
   try {
      const sent = callbackId != null
         ? await ctx.api.sendRichMessageEphemeralForCallback(callbackId, rich, {
            reply_markup: markup,
            ephemeral_message_parameters: { replace_callback_query_message: replace },
         })
         : commandEph != null && ctx.chat != null
            ? await ctx.api.sendRichMessage(ctx.chat.id, rich, {
               reply_markup: markup,
               reply_parameters: { ephemeral_message_id: commandEph },
               ephemeral_message_parameters: { receiver_user_id: userId },
            })
            : null;
      if (sent?.ephemeral_message_id == null) {
         return false;
      }
      session.ephemeral = { chatId: sent.chat.id, id: sent.ephemeral_message_id };
      return true;
   } catch (error) {
      logError(error);
      return false;
   }
}

export async function claim(ctx: Context, session: Session): Promise<boolean> {
   if (session.surface !== "group") {
      return true;
   }
   const rich: InputRichMessage = { markdown: t(session.lang, "opening"), skip_entity_detection: true };
   const markup = new InlineKeyboard();
   if (session.ephemeral != null && await editPanel(ctx, session, rich, markup)) {
      return true;
   }
   return openEphemeral(ctx, session, rich, markup);
}

async function showPrivate(ctx: Context, session: Session, rich: InputRichMessage, markup: InlineKeyboard): Promise<void> {
   const chatId = ctx.chat?.id;
   if (chatId != null && session.anchorId != null) {
      try {
         await ctx.api.editMessageText(chatId, session.anchorId, rich, { reply_markup: markup });
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
   const sent = await ctx.api.sendRichMessage(chatId, rich, { reply_markup: markup });
   session.anchorId = sent.message_id;
}

export async function show(ctx: Context, session: Session, wallet: BotWallet): Promise<void> {
   debug("present", session.nav.name);
   const view = await buildView(session, wallet);
   session.notice = null;
   session.heading = null;
   const rich = renderRich(view);
   const markup = keyboardFor(session, view);
   if (session.surface === "group") {
      if (session.ephemeral != null) {
         await editPanel(ctx, session, rich, markup);
      }
      return;
   }
   await showPrivate(ctx, session, rich, markup);
}
