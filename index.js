const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const ffmpegPath = require('ffmpeg-static');

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
const { DisTube } = require('distube');
const { YtDlpPlugin } = require('@distube/yt-dlp');

const CHANNEL_ID = "1540170401777455176";

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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});

const distube = new DisTube(client, {
  ffmpeg: { path: ffmpegPath },
  leaveOnEmpty: false,
  leaveOnFinish: false,
  plugins: [new YtDlpPlugin()]
});

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

    const zikr = getRandomZikr();
    await channel.send({ embeds: [buildAzkarEmbed(zikr, 'random')] });
  } catch (error) {
    console.error('Could not send automatic Azkar:', error.message);
  }
}

async function joinMusicVoiceChannel() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel?.isVoiceBased()) {
      console.error(`Configured music channel is not voice-based: ${CHANNEL_ID}`);
      return;
    }

    await distube.voices.join(channel);
    console.log(`Joined music voice channel: ${channel.name}`);
  } catch (error) {
    console.error('Could not join music voice channel:', error.message);
  }
}

function formatDuration(seconds) {
  const totalSeconds = Number(seconds);
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return 'غير معروف';

  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
}

function buildMusicEmbed(title, description, color = 0x2ecc71) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`✦ JONT Music • ${title} ✦`)
    .setDescription(description)
    .setFooter({ text: 'JONT Music • Non-Prefix Controls' })
    .setTimestamp();
}

async function sendMusicEmbed(queue, embed) {
  if (!queue?.textChannel?.isTextBased()) return;
  await queue.textChannel.send({ embeds: [embed] }).catch((error) => {
    console.error('Could not send music embed:', error.message);
  });
}

async function handleMusicMessage(message) {
  if (!message.guild || message.author.bot) return;

  const [command, ...argumentParts] = message.content.trim().split(/\s+/);
  const normalizedCommand = command?.toLowerCase();
  const argument = argumentParts.join(' ').trim();
  const musicCommands = ['p', 'play', 'ش', 'شغل', 's', 'skip', 'stop', 'pause', 'seek', 'س', 'وقف', 'ايقاف', 'قدم', 'ق'];
  if (!musicCommands.includes(normalizedCommand) && !musicCommands.includes(command)) return;

  try {
    if (['p', 'play', 'ش', 'شغل'].includes(normalizedCommand) || ['ش', 'شغل'].includes(command)) {
      if (!argument) {
        await message.reply({
          embeds: [buildMusicEmbed('طريقة التشغيل', 'استخدم `p <اسم الأغنية أو الرابط>`.', 0xf1c40f)]
        });
        return;
      }

      const voiceChannel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
      if (!voiceChannel?.isVoiceBased()) return;

      await distube.play(voiceChannel, argument, {
        textChannel: message.channel,
        member: message.member
      });
      return;
    }

    const queue = distube.getQueue(message.guildId);
    if (normalizedCommand === 's' || normalizedCommand === 'skip' || command === 'س') {
      if (!queue) {
        await message.reply({
          embeds: [buildMusicEmbed('لا توجد أغنية', 'لا توجد أغنية قيد التشغيل حاليًا.', 0xe67e22)]
        });
        return;
      }
      await queue.skip();
      await message.reply({
        embeds: [buildMusicEmbed('تم التخطي', 'انتقل البوت إلى المقطع التالي.', 0x3498db)]
      });
      return;
    }

    if (normalizedCommand === 'stop' || command === 'وقف' || command === 'ايقاف') {
      if (!queue) {
        await message.reply({
          embeds: [buildMusicEmbed('لا توجد أغنية', 'لا توجد أغنية قيد التشغيل حاليًا.', 0xe67e22)]
        });
        return;
      }
      await queue.stop();
      await message.reply({
        embeds: [buildMusicEmbed('تم الإيقاف', 'توقفت الموسيقى وسيبقى البوت في الروم الصوتي.', 0xe74c3c)]
      });
      return;
    }

    if (normalizedCommand === 'pause') {
      if (!queue) {
        await message.reply({
          embeds: [buildMusicEmbed('لا توجد أغنية', 'لا توجد أغنية قيد التشغيل حاليًا.', 0xe67e22)]
        });
        return;
      }
      if (queue.paused) {
        await queue.resume();
        await message.reply({
          embeds: [buildMusicEmbed('تم الاستئناف', 'عادت الموسيقى إلى التشغيل.', 0x2ecc71)]
        });
      } else {
        await queue.pause();
        await message.reply({
          embeds: [buildMusicEmbed('تم الإيقاف المؤقت', 'أوقفت الموسيقى مؤقتًا.', 0xf1c40f)]
        });
      }
      return;
    }

    if (normalizedCommand === 'seek' || command === 'قدم' || command === 'ق') {
      const seconds = Number(argument);
      if (!queue || !argument || !Number.isFinite(seconds) || seconds < 0) {
        await message.reply({
          embeds: [buildMusicEmbed('صيغة التقديم', 'استخدم `seek <seconds>` أثناء تشغيل أغنية.', 0xf1c40f)]
        });
        return;
      }
      await queue.seek(seconds);
      await message.reply({
        embeds: [buildMusicEmbed('تم التقديم', `تم الانتقال إلى **${formatDuration(seconds)}**.`, 0x9b59b6)]
      });
    }
  } catch (error) {
    console.error('Music command failed:', error.message);
    await message.reply({
      embeds: [buildMusicEmbed('تعذر التشغيل', 'حدث خطأ عابر أثناء تنفيذ أمر الموسيقى.', 0xe74c3c)]
    }).catch(() => null);
  }
}

distube.on('playSong', async (queue, song) => {
  const nextSong = queue.songs[1];
  const songLink = song.url ? `[فتح الرابط](${song.url})` : 'رابط غير متوفر';
  const nextTitle = nextSong ? `**${nextSong.name}**` : 'لا يوجد مقطع تالٍ حاليًا';
  const requester = song.user?.tag || song.user?.username || 'غير معروف';
  const thumbnail = song.thumbnail || null;
  const musicEmbed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('▶ JONT Music • تشغيل الآن')
    .setDescription(`**${song.name}**\n${songLink}`)
    .addFields(
      { name: 'المدة', value: `**${song.formattedDuration || formatDuration(song.duration)}**`, inline: true },
      { name: 'طلب بواسطة', value: `**${requester}**`, inline: true },
      { name: 'المقطع التالي', value: nextTitle, inline: true }
    )
    .setFooter({ text: 'JONT Music • التشغيل المباشر • 24/7' })
    .setTimestamp();
  if (thumbnail) musicEmbed.setThumbnail(thumbnail);

  await sendMusicEmbed(
    queue,
    musicEmbed
  );
});

distube.on('error', (error, queue) => {
  console.error(`DisTube error${queue?.guild?.id ? ` in ${queue.guild.id}` : ''}:`, error.message);
});

client.once('clientReady', (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  client.user.setActivity('JONT / Athkar', { type: 3 });
  resetAutomaticAzkarInterval();
  joinMusicVoiceChannel();
});

client.on('messageCreate', (message) => {
  if (message.channel.id !== "1540170401777455176") return;
  handleMusicMessage(message);
});

client.on('voiceStateUpdate', (oldState, newState) => {
  if (oldState.id !== client.user?.id || newState.channelId === CHANNEL_ID) return;
  joinMusicVoiceChannel();
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

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});
