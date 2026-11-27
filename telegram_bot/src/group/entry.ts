import { InlineKeyboard, type Context } from "grammy";
import { logError } from "../chain/rpc";
import { fetchOpenBets, isPending, legsForRow, rowAmount, rowPayout, rowResult } from "../betting/bets";
import { searchEvents } from "../markets/search";
import { findEvent, loadSlate } from "../markets/slate";
import { BetResult } from "spamm-aggregator-sdk";
import { t } from "../i18n";
import { ensureWallet } from "../wallet/privy";
import { closeCard, gameArticle, inlineArticle, legsOpen } from "./cards";
import { attachInline, getSnap, launcherFor, rememberSnap, setLauncher, stableId } from "./store";

function stripMention(text: string, username: string): string {
   const mention = username === "" ? "" : new RegExp(`@${username}\\b`, "ig");
   return text.replace(mention, " ").replace(/\s+/g, " ").trim();
}

export async function onInline(ctx: Context): Promise<void> {
   const query = ctx.inlineQuery;
   if (query == null) {
      return;
   }
   const text = query.query.trim();
   const results = [];
   try {
      if (text.startsWith("t:")) {
         const snap = getSnap(text.slice(2));
         if (snap != null) {
            const open = (snap.result == null || snap.result === "Pending") && await legsOpen(snap.legs);
            results.push(inlineArticle(snap, open));
         }
      } else {
         const q = text.toLowerCase();
         const walletTask = ensureWallet(query.from.id).catch((error: unknown) => {
            logError(error);
            return null;
         });
         if (q !== "") {
            const tree = await loadSlate();
            for (const hit of searchEvents(tree, text).slice(0, 25)) {
               const found = findEvent(tree, hit.sportId, hit.leagueId, hit.eventId);
               if (found == null) {
                  continue;
               }
               results.push(gameArticle(query.from.id, query.from.first_name ?? "", found.event));
            }
         }
         const wallet = await walletTask;
         if (wallet != null) {
            const open = await fetchOpenBets(wallet.address).catch(() => []);
            for (const row of open) {
               if (results.length >= 50) {
                  break;
               }
               const legs = await legsForRow(row);
               const hay = legs.map((leg) => `${leg.eventTitle} ${leg.outcomeLabel}`).join(" ").toLowerCase();
               if (q !== "" && !hay.includes(q)) {
                  continue;
               }
               const pending = isPending(row);
               const snap = rememberSnap({
                  id: stableId(`bet:${row.address}`),
                  ownerId: query.from.id,
                  ownerName: query.from.first_name ?? "",
                  legs,
                  stake: rowAmount(row).toString(),
                  payout: rowPayout(row).toString(),
                  result: pending ? "Pending" : (BetResult[rowResult(row)] ?? "Graded"),
                  betAddress: row.address,
                  kind: "ticket",
               });
               results.push(inlineArticle(snap, pending && await legsOpen(legs)));
            }
         }
      }
   } catch (error) {
      logError(error);
   }
   await ctx.answerInlineQuery(results, { cache_time: 0, is_personal: true }).catch((error: unknown) => {
      logError(error);
   });
}

export async function onChosen(ctx: Context): Promise<void> {
   const chosen = ctx.chosenInlineResult;
   if (chosen == null) {
      return;
   }
   attachInline(chosen.result_id, chosen.inline_message_id);
   if (chosen.query.startsWith("t:")) {
      attachInline(chosen.query.slice(2), chosen.inline_message_id);
   }
}

export async function onGuest(ctx: Context, username: string): Promise<void> {
   const message = ctx.update.guest_message;
   const guestId = message?.guest_query_id;
   if (message == null || guestId == null) {
      return;
   }
   const text = stripMention(typeof message.text === "string" ? message.text : "", username);
   const chatId = message.chat.id;
   if (text === "") {
      const rich = { markdown: "# SPAMM", skip_entity_detection: true as const };
      const markup = new InlineKeyboard().text(t("en", "open"), "m:open");
      const existing = launcherFor(chatId);
      if (existing != null) {
         try {
            await ctx.api.editMessageTextInline(existing, rich, { reply_markup: markup });
            return;
         } catch (error) {
            logError(error);
         }
      }
      try {
         const sent = await ctx.api.answerGuestQuery(guestId, {
            type: "article",
            id: stableId(`open:${chatId}`),
            title: t("en", "open"),
            input_message_content: { rich_message: rich },
            reply_markup: markup,
         });
         setLauncher(chatId, sent.inline_message_id);
      } catch (error) {
         logError(error);
      }
      return;
   }
   try {
      const tree = await loadSlate();
      const hit = searchEvents(tree, text)[0];
      const found = hit == null ? null : findEvent(tree, hit.sportId, hit.leagueId, hit.eventId);
      if (found == null) {
         await ctx.api.answerGuestQuery(guestId, {
            type: "article",
            id: stableId(`miss:${text}`),
            title: t("en", "searchTitle"),
            input_message_content: { rich_message: { markdown: t("en", "searchEmpty"), skip_entity_detection: true } },
         });
         return;
      }
      const article = gameArticle(message.from?.id ?? 0, message.from?.first_name ?? "", found.event);
      await ctx.api.answerGuestQuery(guestId, {
         ...article,
         id: stableId(`game:${found.event.id}:${text}`),
         description: hit?.label ?? article.description,
      });
   } catch (error) {
      logError(error);
   }
}

export async function postedCard(ctx: Context, id: string): Promise<void> {
   const snap = getSnap(id);
   if (snap == null || (snap.result != null && snap.result !== "Pending")) {
      return;
   }
   if (await legsOpen(snap.legs)) {
      return;
   }
   const inlineId = ctx.callbackQuery?.inline_message_id ?? snap.inlineMessageId;
   if (inlineId == null) {
      return;
   }
   snap.inlineMessageId = inlineId;
   try {
      await closeCard(ctx.api, snap, "Closed");
   } catch (error) {
      logError(error);
   }
}
