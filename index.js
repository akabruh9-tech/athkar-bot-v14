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

const INTERVAL_MS = 1200000;
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
  const randomColors = ['#FF5733', '#2ECC71', '#9B59B6', '#3498DB', '#E74C3C', '#F1C40F', '#1ABC9C', '#E67E22', '#00FFFF', '#FF007F'];
  const chosenColor = randomColors[Math.floor(Math.random() * randomColors.length)];

  return new EmbedBuilder()
    .setColor(chosenColor)
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
    .setDMPermission(false)
].map((command) => command.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(discordToken);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
}

async function sendAutomaticAzkar() {
  const { channelId } = loadConfig();
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  const zikr = getRandomZikr();
  await channel.send({ embeds: [buildAzkarEmbed(zikr, 'random')] }).catch((error) => {
    console.error('Could not send automatic Azkar:', error.message);
  });
}

client.once('clientReady', (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  client.user.setActivity('JONT / Athkar', { type: 3 });
  setInterval(sendAutomaticAzkar, INTERVAL_MS);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'azkar') {
      await interaction.deferReply();
      const category = interaction.options.getString('category') || 'random';
      const zikr = getRandomZikr(category);
      await interaction.editReply({ embeds: [buildAzkarEmbed(zikr, category)] });
      return;
    }

    if (interaction.commandName === 'set-channel') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
          content: 'ليس لديك صلاحية Administrator لاستخدام هذا الأمر.',
          ephemeral: true,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const channel = interaction.options.getChannel('channel', true);
      saveConfig({ channelId: channel.id });
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle('✦ JONT / Athkar ✦')
            .setDescription(`تم تحديد ${channel} لإرسال ذكر عشوائي كل 20 دقيقة.`)
            .setFooter({ text: 'JONT / Athkar • إعدادات الإرسال التلقائي' })
        ]
      });
    }
  } catch (error) {
    console.error('Could not respond to interaction:', error.message);
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
      console.error('Discord rejected the token (401 Unauthorized). Generate a new bot token in the Discord Developer Portal and update .env.');
    } else {
      console.error('Failed to register slash commands:', error.message);
    }
    process.exit(1);
  });
