/**
 * Discord bot — prediction contest DB + on-chain admin.
 *
 * Env: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, DISCORD_CLIENT_ID, DISCORD_ADMIN_IDS
 * Optional: SOLANA_RPC_URL, SCORE_PREDICT_SIGNER_KEYPAIR (defaults to aggregator admin keypair)
 */

import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';

import { marketHandlers } from '../../api/bot/handlers.ts';
import { discordCommands } from './commands.ts';
import {
   handlePredictionClose,
   handlePredictionCreate,
   handlePredictionFetchContest,
   handlePredictionFetchUser,
   handlePredictionGet,
   handlePredictionList,
   handlePredictionResult,
   handlePredictionUpdate,
} from './handlers.ts';

const token = process.env.DISCORD_BOT_TOKEN?.trim();
const guildId = process.env.DISCORD_GUILD_ID?.trim();
const clientId = process.env.DISCORD_CLIENT_ID?.trim();
const adminIds = new Set(
   (process.env.DISCORD_ADMIN_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
);

if (!token || !guildId || !clientId) {
   console.error('Set DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, and DISCORD_CLIENT_ID');
   process.exit(1);
}

function isAdmin(userId: string): boolean {
   return adminIds.size === 0 || adminIds.has(userId);
}

const rest = new REST({ version: '10' }).setToken(token);
await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: discordCommands });

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const handlers: Record<string, (interaction: import('discord.js').ChatInputCommandInteraction) => Promise<void>> = {
   'prediction-create': handlePredictionCreate,
   'prediction-update': handlePredictionUpdate,
   'prediction-get': handlePredictionGet,
   'prediction-list': handlePredictionList,
   'prediction-result': handlePredictionResult,
   'prediction-fetch-user': handlePredictionFetchUser,
   'prediction-fetch-contest': handlePredictionFetchContest,
   'prediction-close': handlePredictionClose,
   ...marketHandlers,
};

client.on('interactionCreate', async (interaction) => {
   if (!interaction.isChatInputCommand()) {
      return;
   }
   if (!isAdmin(interaction.user.id)) {
      await interaction.reply({ content: 'Not authorized.', ephemeral: true });
      return;
   }

   const handler = handlers[interaction.commandName];
   if (!handler) {
      await interaction.reply({ content: 'Unknown command.', ephemeral: true });
      return;
   }

   try {
      await handler(interaction);
   } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (interaction.deferred || interaction.replied) {
         await interaction.editReply({ content: `Error: ${message}` });
      } else {
         await interaction.reply({ content: `Error: ${message}`, ephemeral: true });
      }
   }
});

client.once('ready', () => {
   console.log(`Discord bot logged in as ${client.user?.tag}`);
});

await client.login(token);
