const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot is active and running 24/7!');
});

app.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});

require('dotenv').config({ override: true });

const fs = require('node:fs');
const path = require('node:path');
const {
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');

const PURPLE = 0x9b59b6;
let currentInterval = 2 * 60 * 1000;
let automaticAzkarInterval;
const discordToken = process.env.DISCORD_TOKEN?.trim();
const clientId = process.env.CLIENT_ID?.trim();
const azkar = JSON.parse(fs.readFileSync(path.join(__dirname, 'azkar.json'), 'utf8'));
const azkarCategories = ['morning', 'evening', 'random'];
const allAzkar = azkarCategories.flatMap((category) => azkar[category] || []);
const configPath = path.join(__dirname, 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    console.error('Could not load Azkar config:', error.message);
    return { channelId: null };
  }
}

function saveConfig(config) {
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function getRandomZikr(category = 'random') {
  const entries = category === 'random' ? allAzkar : azkar[category] || allAzkar;
  return entries[Math.floor(Math.random() * entries.length)];
}

function buildAzkarEmbed(zikr, category) {
  const categoryNames = {
    morning: 'أذكار الصباح',
    evening: 'أذكار المساء',
    random: 'ذكر ودعاء'
  };
  const displayCategory = categoryNames[zikr.category] || categoryNames[category] || categoryNames.random;
  const trimField = (value, limit = 1024) => String(value || 'غير متوفر').slice(0, limit);

  return new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle('✦ JONT / Athkar ✦')
    .addFields(
      { name: '❖ الذكر', value: trimField(`**${zikr.text}**`) },
      { name: '❖ التصنيف', value: displayCategory, inline: true },
      {
        name: '❖ العدد / المرجع',
        value: trimField(`التكرار: ${zikr.count || 1}\n${zikr.source || 'مرجع غير متوفر'}`),
        inline: true
      }
    )
    .setFooter({ text: 'JONT / Athkar • أذكار وأدعية مختارة بعناية' })
    .setTimestamp();
}

const commands = [
  new SlashCommandBuilder()
    .setName('azkar')
    .setDescription('يعرض ذكرًا عشوائيًا أو ذكرًا من تصنيف محدد')
    .addStringOption((option) =>
      option
        .setName('category')
        .setDescription('اختر تصنيف الأذكار')
        .setRequired(false)
        .addChoices(
          { name: 'أذكار الصباح', value: 'morning' },
          { name: 'أذكار المساء', value: 'evening' },
          { name: 'أذكار وأدعية عشوائية', value: 'random' }
        )
    ),
  new SlashCommandBuilder()
    .setName('set-channel')
    .setDescription('يحدد القناة التي تُرسل فيها الأذكار تلقائيًا')
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('القناة النصية المستهدفة')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('setime')
    .setDescription('يغير وقت إرسال الأذكار التلقائي بالدقائق')
    .addIntegerOption((option) =>
      option
        .setName('minutes')
        .setDescription('عدد الدقائق بين كل إرسال')
        .setMinValue(1)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
].map((command) => command.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(discordToken);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
}

function resetAutomaticAzkarInterval() {
  if (automaticAzkarInterval) clearInterval(automaticAzkarInterval);
  automaticAzkarInterval = setInterval(sendAutomaticAzkar, currentInterval);
}

async function sendAutomaticAzkar() {
  try {
    const { channelId } = loadConfig();
    if (!channelId) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return;

    await channel.send({ embeds: [buildAzkarEmbed(getRandomZikr(), 'random')] });
  } catch (error) {
    console.error('Could not send automatic Azkar:', error);
  }
}

client.once('clientReady', (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  readyClient.user.setActivity('JONT / Athkar', { type: 3 });
  resetAutomaticAzkarInterval();
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'azkar') {
      const category = interaction.options.getString('category') || 'random';
      await interaction.reply({ embeds: [buildAzkarEmbed(getRandomZikr(category), category)] });
      return;
    }

    if (interaction.commandName === 'set-channel') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
          content: 'ليس لديك صلاحية Administrator لاستخدام هذا الأمر.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const channel = interaction.options.getChannel('channel', true);
      saveConfig({ channelId: channel.id });
      await interaction.reply({
        content: `تم تحديد ${channel} لإرسال الأذكار تلقائيًا.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (interaction.commandName === 'setime') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
          content: 'ليس لديك صلاحية Administrator لاستخدام هذا الأمر.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const minutes = interaction.options.getInteger('minutes', true);
      currentInterval = minutes * 60 * 1000;
      resetAutomaticAzkarInterval();
      await interaction.reply({
        content: `تم تغيير وقت إرسال الأذكار إلى كل ${minutes} دقيقة.`,
        flags: MessageFlags.Ephemeral
      });
    }
  } catch (error) {
    console.error('Could not respond to Azkar interaction:', error);
    const response = { content: 'تعذر تنفيذ أمر الأذكار حاليًا.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(response).catch(() => null);
    else await interaction.reply(response).catch(() => null);
  }
});

if (!discordToken || !clientId) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID in .env');
  process.exit(1);
}

registerCommands()
  .then(() => client.login(discordToken))
  .catch((error) => {
    if (error.code === 401 || error.status === 401) {
      console.error('Discord rejected the token (401 Unauthorized).');
    } else {
      console.error('Failed to register slash commands:', error);
    }
    process.exit(1);
  });

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});
