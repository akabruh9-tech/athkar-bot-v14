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
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  StringSelectMenuBuilder
} = require('discord.js');
const { DisTube } = require('distube');
const { YouTubePlugin } = require('@distube/youtube');
const { SoundCloudPlugin } = require('@distube/soundcloud');
let parsedCookies = [];
try {
  if (process.env.YOUTUBE_COOKIES) {
    parsedCookies = JSON.parse(process.env.YOUTUBE_COOKIES);
  }
} catch (error) {
  console.error('Error parsing YOUTUBE_COOKIES:', error);
}

const soundcloudPlugin = new SoundCloudPlugin();
const youtubePlugin = new YouTubePlugin({ cookies: parsedCookies });

const CHANNEL_ID = "1540170401777455176";
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
  customFilters: {
    clarity: 'highpass=f=80,lowpass=f=16000',
    smooth: 'acompressor=threshold=-18dB:ratio=2:attack=20:release=250',
    cinema: 'stereowiden=delay=20:feedback=0.4:crossfeed=0.3',
    symphony: 'aecho=0.8:0.88:60:0.4,chorus=0.5:0.9:50:0.4:0.25:2',
    pure: 'highpass=f=40,lowpass=f=18000',
    soft: 'lowpass=f=12000,acompressor=threshold=-24dB:ratio=1.5',
    treblebass: 'equalizer=f=100:t=q:w=1:g=5,equalizer=f=8000:t=q:w=1:g=4'
  },
  plugins: [youtubePlugin, soundcloudPlugin]
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
    .setColor(PURPLE)
    .setTitle(`✦ JONT Music • ${title} ✦`)
    .setDescription(description)
    .setFooter({ text: 'JONT Music • Non-Prefix Controls' })
    .setTimestamp();
}

function buildMusicControls(queue) {
  const pauseButton = new ButtonBuilder()
    .setCustomId(`music:pause:${queue.guild.id}`)
    .setLabel(queue.paused ? 'تشغيل' : 'إيقاف مؤقت')
    .setEmoji(queue.paused ? '▶️' : '⏸️')
    .setStyle(ButtonStyle.Primary);
  const loopButton = new ButtonBuilder()
    .setCustomId(`music:loop:${queue.guild.id}`)
    .setLabel(`تكرار: ${queue.repeatMode === 0 ? 'متوقف' : queue.repeatMode === 1 ? 'الأغنية' : 'القائمة'}`)
    .setEmoji('🔁')
    .setStyle(queue.repeatMode === 0 ? ButtonStyle.Secondary : ButtonStyle.Success);
  const filterMenu = new StringSelectMenuBuilder()
    .setCustomId(`music:filter:${queue.guild.id}`)
    .setPlaceholder('🎛️ Select a filter')
    .addOptions(
      { label: 'بدون فلتر', value: 'off', emoji: '🎵' },
      { label: 'Clarity / وضوح', value: 'clarity', emoji: '✨' },
      { label: 'Smooth', value: 'smooth', emoji: '🌊' },
      { label: 'Cinema', value: 'cinema', emoji: '🎬' },
      { label: 'Symphony', value: 'symphony', emoji: '🎻' },
      { label: 'Pure', value: 'pure', emoji: '💎' },
      { label: 'Vaporwave', value: 'vaporwave', emoji: '🌌' },
      { label: 'Karaoke', value: 'karaoke', emoji: '🎤' },
      { label: 'Soft', value: 'soft', emoji: '☁️' },
      { label: 'Treblebass', value: 'treblebass', emoji: '🎚️' },
      { label: '8D', value: '3d', emoji: '🌀' }
    );

  return [
    new ActionRowBuilder().addComponents(
      pauseButton,
      new ButtonBuilder()
        .setCustomId(`music:skip:${queue.guild.id}`)
        .setLabel('تخطي')
        .setEmoji('⏭️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`music:stop:${queue.guild.id}`)
        .setLabel('إيقاف')
        .setEmoji('⏹️')
        .setStyle(ButtonStyle.Danger),
      loopButton
    ),
    new ActionRowBuilder().addComponents(filterMenu)
  ];
}

function buildNowPlayingEmbed(queue, song, title = '▶ JONT Music • تشغيل الآن') {
  const songLink = song.url ? `[فتح الرابط](${song.url})` : 'رابط غير متوفر';
  const requester = song.user?.tag || song.user?.username || 'غير معروف';
  const embed = new EmbedBuilder()
    .setColor(PURPLE)
    .setTitle(title)
    .setDescription(`**${song.name}**\n${songLink}`)
    .addFields(
      { name: 'المدة', value: `**${song.formattedDuration || formatDuration(song.duration)}**`, inline: true },
      { name: 'طلب بواسطة', value: `**${requester}**`, inline: true },
      { name: 'المقطع التالي', value: queue.songs[1] ? `**${queue.songs[1].name}**` : 'لا يوجد مقطع تالٍ حاليًا', inline: true }
    )
    .setFooter({ text: 'JONT Music • التشغيل المباشر • 24/7' })
    .setTimestamp();
  if (song.thumbnail) embed.setThumbnail(song.thumbnail);
  return embed;
}

async function sendMusicEmbed(queue, embed, components = []) {
  if (!queue?.textChannel?.isTextBased()) return;
  await queue.textChannel.send({ embeds: [embed], components }).catch((error) => {
    console.error('Could not send music embed:', error.message);
  });
}

function isDirectUrl(query) {
  try {
    new URL(query);
    return /^https?:\/\//i.test(query);
  } catch {
    return false;
  }
}

function isSoundCloudUrl(query) {
  try {
    const hostname = new URL(query).hostname.toLowerCase();
    return hostname === 'soundcloud.com' || hostname.endsWith('.soundcloud.com');
  } catch {
    return false;
  }
}

async function resolveSoundCloudQuery(query) {
  if (isDirectUrl(query)) {
    if (!isSoundCloudUrl(query)) {
      throw new Error('Only SoundCloud URLs and SoundCloud searches are supported.');
    }
    return query;
  }

  const results = await soundcloudPlugin.search(query, 'track', 1);
  if (!results.length || !results[0]?.url) {
    throw new Error(`No SoundCloud result found for: ${query}`);
  }
  return results[0].url;
}

async function handleMusicMessage(message) {
  if (!message.guild || message.author.bot) return;

  const content = message.content.trim();
  if (!content) return;
  const args = content.split(/ +/);
  const cmd = args[0].toLowerCase();
  const query = args.slice(1).join(' ').trim();
  const musicCommands = ['p', 'play', '-play', 'ش', 'شغل', 's', 'skip', 'stop', 'pause', 'seek', 'س', 'وقف', 'ايقاف', 'قدم', 'ق'];
  if (!musicCommands.includes(cmd)) return;

  try {
    if (['p', 'play', '-play', 'ش', 'شغل'].includes(cmd)) {
      if (!query) {
        await message.reply({
          embeds: [buildMusicEmbed('طريقة التشغيل', 'استخدم `p <اسم الأغنية أو الرابط>`.', 0xf1c40f)]
        });
        return;
      }

      if (!message.member?.voice?.channel) {
        await message.reply('يرجى دخول قناة صوتية أولاً!');
        return;
      }
      const voiceChannel = message.member.voice.channel;

  const soundCloudSource = await resolveSoundCloudQuery(query);
  await distube.play(voiceChannel, soundCloudSource, {
        textChannel: message.channel,
        member: message.member,
        message,
        skip: false
      }).catch((error) => {
        console.error('Play Error:', error);
        throw error;
      });
      return;
    }

    const queue = distube.getQueue(message.guildId);
    if (cmd === 's' || cmd === 'skip' || cmd === 'س') {
      if (!queue) {
        await message.reply({
          embeds: [buildMusicEmbed('لا توجد أغنية', 'لا توجد أغنية قيد التشغيل حاليًا.', 0xe67e22)]
        });
        return;
      }
      await queue.skip();
      await message.reply({
        embeds: [buildMusicEmbed('Skipped to next track', 'Skipped to next track', PURPLE)]
      });
      return;
    }

    if (cmd === 'stop' || cmd === 'وقف' || cmd === 'ايقاف') {
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

    if (cmd === 'pause') {
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

    if (cmd === 'seek' || cmd === 'قدم' || cmd === 'ق') {
      const seconds = Number(query);
      if (!queue || !query || !Number.isFinite(seconds) || seconds < 0) {
        await message.reply({
          embeds: [buildMusicEmbed('صيغة التقديم', 'استخدم `seek <seconds>` أثناء تشغيل أغنية.', 0xf1c40f)]
        });
        return;
      }
      await queue.seek(seconds);
      await message.reply({
        embeds: [buildMusicEmbed(`Seeked To .. ${seconds}s`, `Seeked To .. ${seconds}s`, PURPLE)]
      });
    }
  } catch (error) {
    console.error('Music command failed:', error);
    await message.reply({
      embeds: [buildMusicEmbed('تعذر التشغيل', `تعذر العثور على مصدر SoundCloud صالح.\n${error.message}`, 0xe74c3c)]
    }).catch(() => null);
  }
}

distube.on('playSong', async (queue, song) => {
  await sendMusicEmbed(
    queue,
    buildNowPlayingEmbed(queue, song),
    buildMusicControls(queue)
  );
});

distube.on('error', async (error, queue, song) => {
  console.error(`DisTube error${queue?.guild?.id ? ` in ${queue.guild.id}` : ''}:`, error);
  console.error('DisTube error details:', {
    message: error.message,
    stack: error.stack,
    song: song?.name || song?.url || 'unknown'
  });

  if (queue?.textChannel?.isTextBased()) {
    await queue.textChannel.send(`❌ حدث خطأ في تشغيل المقطع: ${error.message}`).catch((sendError) => {
      console.error('Could not report DisTube error in Discord:', sendError);
    });
  }
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
  if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.channelId !== CHANNEL_ID) return;

  if (interaction.isButton() || interaction.isStringSelectMenu()) {
    const [scope, action, guildId] = interaction.customId.split(':');
    if (scope !== 'music' || guildId !== interaction.guildId) return;

    const queue = distube.getQueue(guildId);
    if (!queue) {
      await interaction.reply({ content: 'لا توجد أغنية قيد التشغيل حالياً.', flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      if (interaction.isButton() && action === 'pause') {
        if (queue.paused) await queue.resume();
        else await queue.pause();
      } else if (interaction.isButton() && action === 'skip') {
        await queue.skip();
      } else if (interaction.isButton() && action === 'stop') {
        await queue.stop();
        await interaction.update({
          embeds: [buildMusicEmbed('تم الإيقاف', 'توقفت الموسيقى. يمكنك استخدام `p` أو `play` لتشغيل مقطع جديد.', 0xe74c3c)],
          components: []
        });
        return;
      } else if (interaction.isButton() && action === 'loop') {
        queue.setRepeatMode((queue.repeatMode + 1) % 3);
      } else if (interaction.isStringSelectMenu() && action === 'filter') {
        const filter = interaction.values[0];
        if (filter === 'off') queue.filters.clear();
        else queue.filters.set([filter]);
      } else {
        return;
      }

      await interaction.update({
        embeds: [buildNowPlayingEmbed(queue, queue.songs[0], '▶ JONT Music • تم تحديث التشغيل')],
        components: buildMusicControls(queue)
      });
    } catch (error) {
      console.error('Music control interaction failed:', error.message);
      const response = { content: 'تعذر تطبيق التغيير على التشغيل الحالي.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) await interaction.followUp(response).catch(() => null);
      else await interaction.reply(response).catch(() => null);
    }
    return;
  }

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
            .setColor(PURPLE)
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
