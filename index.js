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
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { spawn } = require('node:child_process');
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
const {
  AudioPlayerStatus,
  StreamType,
  NoSubscriberBehavior,
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  entersState,
  VoiceConnectionStatus
} = require('@discordjs/voice');
const ffmpegPath = require('ffmpeg-static');

const QURAN_VOICE_CHANNEL_ID = process.env.QURAN_VOICE_CHANNEL_ID || '1537366844149727313';
const QURAN_STREAM_URL = process.env.QURAN_STREAM_URL || 'https://qurango.net/radio/mix';
console.log(`Quran configuration loaded: channel=${QURAN_VOICE_CHANNEL_ID}, streamConfigured=${Boolean(process.env.QURAN_STREAM_URL)}`);
let currentInterval = 2 * 60 * 1000;
let automaticAzkarInterval;
let quranConnection;
let quranPlayer;
let quranProcess;
let quranRestartTimer;
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

function getRainbowColor() {
  const hue = (Date.now() / 25) % 360;
  const saturation = 0.9;
  const lightness = 0.55;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hueSegment = hue / 60;
  const secondComponent = chroma * (1 - Math.abs((hueSegment % 2) - 1));
  const match = lightness - chroma / 2;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (hueSegment < 1) [red, green, blue] = [chroma, secondComponent, 0];
  else if (hueSegment < 2) [red, green, blue] = [secondComponent, chroma, 0];
  else if (hueSegment < 3) [red, green, blue] = [0, chroma, secondComponent];
  else if (hueSegment < 4) [red, green, blue] = [0, secondComponent, chroma];
  else if (hueSegment < 5) [red, green, blue] = [secondComponent, 0, chroma];
  else [red, green, blue] = [chroma, 0, secondComponent];

  return (Math.round((red + match) * 255) << 16)
    | (Math.round((green + match) * 255) << 8)
    | Math.round((blue + match) * 255);
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
    .setColor(getRainbowColor())
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

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

function stopQuranProcess() {
  if (quranProcess && !quranProcess.killed) quranProcess.kill('SIGTERM');
  quranProcess = null;
}

function scheduleQuranRestart(reason) {
  console.error(`Quran stream stopped (${reason}). Retrying in 5 seconds.`);
  if (quranRestartTimer) return;
  quranRestartTimer = setTimeout(() => {
    quranRestartTimer = null;
    const restart = quranConnection?.state.status === VoiceConnectionStatus.Disconnected
      ? connectQuranVoice()
      : startQuranStream();
    restart.catch((error) => console.error('Could not restart Quran stream:', error));
  }, 5000);
}

function startQuranStream() {
  if (!quranPlayer || !quranConnection) return Promise.resolve();

  stopQuranProcess();
  const streamProcess = spawn(ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-i', 'pipe:0',
    '-vn',
    '-ac', '2',
    '-ar', '48000',
    '-c:a', 'libopus',
    '-b:a', '128k',
    '-f', 'ogg',
    'pipe:1'
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  quranProcess = streamProcess;
  console.log(`Starting Quran audio stream from ${new URL(QURAN_STREAM_URL).hostname}`);

  pipeQuranSource(QURAN_STREAM_URL, streamProcess).catch((error) => {
    console.error('Could not read Quran stream:', error);
    if (!streamProcess.killed) streamProcess.kill('SIGTERM');
  });

  streamProcess.stderr.on('data', (data) => {
    console.error('Quran FFmpeg:', data.toString().trim());
  });
  streamProcess.once('error', (error) => scheduleQuranRestart(`FFmpeg error: ${error.message}`));
  streamProcess.once('close', (code) => {
    if (quranProcess === streamProcess) {
      quranProcess = null;
      scheduleQuranRestart(`FFmpeg exited with code ${code}`);
    }
  });

  quranPlayer.play(createAudioResource(streamProcess.stdout, { inputType: StreamType.OggOpus }));
  console.log('Quran audio player started.');
  return Promise.resolve();
}

function pipeQuranSource(url, process, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('Too many Quran stream redirects.'));

  return new Promise((resolve, reject) => {
    const transport = url.startsWith('https:') ? https : http;
    console.log(`Connecting to Quran stream${redirects ? ` after redirect ${redirects}` : ''}...`);
    const request = transport.get(url, {
      headers: { 'User-Agent': 'JONT-Athkar-Quran-Radio/1.0' }
    }, (response) => {
      console.log(`Quran stream response: HTTP ${response.statusCode}`);
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        pipeQuranSource(new URL(response.headers.location, url).toString(), process, redirects + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Quran stream returned HTTP ${response.statusCode}.`));
        return;
      }

      response.on('error', reject);
      process.stdin.on('error', reject);
      response.pipe(process.stdin);
      resolve();
    });
    request.on('error', reject);
  });
}

async function connectQuranVoice() {
  try {
    console.log(`Attempting to connect to Quran voice channel ${QURAN_VOICE_CHANNEL_ID}...`);
    const channel = await client.channels.fetch(QURAN_VOICE_CHANNEL_ID);
    console.log(`Quran voice channel fetched: ${channel?.name || 'unknown'}`);
    if (!channel?.isVoiceBased() || !channel.guild) {
      throw new Error(`Quran channel is not a voice channel: ${QURAN_VOICE_CHANNEL_ID}`);
    }

    quranPlayer = quranPlayer || createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play }
    });
    quranPlayer.removeAllListeners(AudioPlayerStatus.Idle);
    quranPlayer.removeAllListeners('error');
    quranPlayer.removeAllListeners('stateChange');
    quranPlayer.on('stateChange', (oldState, newState) => {
      console.log(`Quran audio state: ${oldState.status} -> ${newState.status}`);
    });
    quranPlayer.on(AudioPlayerStatus.Idle, () => scheduleQuranRestart('audio player idle'));
    quranPlayer.on('error', (error) => scheduleQuranRestart(`audio player error: ${error.message}`));

    console.log('Creating Discord voice connection...');
    quranConnection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false
    });
    quranConnection.subscribe(quranPlayer);
    console.log('Voice connection created and audio player subscribed.');
    quranConnection.on('error', (error) => scheduleQuranRestart(`voice connection error: ${error.message}`));
    quranConnection.on('stateChange', (_, newState) => {
      console.log(`Quran voice connection state: ${newState.status}`);
      if (newState.status === VoiceConnectionStatus.Disconnected) scheduleQuranRestart('voice connection disconnected');
    });
    console.log('Waiting for Discord voice connection readiness...');
    await entersState(quranConnection, VoiceConnectionStatus.Ready, 20_000);
    console.log('Discord voice connection is ready.');
    await startQuranStream();
    console.log(`Quran stream started in ${channel.name}`);
  } catch (error) {
    console.error('Could not connect Quran voice stream:', error);
    scheduleQuranRestart('connection failure');
  }
}

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
  connectQuranVoice().catch((error) => console.error('Could not start Quran voice stream:', error));
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
