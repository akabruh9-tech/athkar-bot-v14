const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot is alive!');
});

app.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});

require('dotenv').config({ override: true });

const renderExternalUrl = process.env.RENDER_EXTERNAL_URL?.replace(/\/$/, '');
if (renderExternalUrl) {
  setInterval(() => {
    fetch(renderExternalUrl)
      .then((response) => {
        console.log(`Render keep-alive ping: HTTP ${response.status}`);
      })
      .catch((error) => {
        console.error('Render keep-alive ping failed:', error.message);
      });
  }, 5 * 60 * 1000);
}

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
const HOLY_DAYS_CHANNEL_ID = process.env.HOLY_DAYS_CHANNEL_ID?.trim();
console.log(`Quran configuration loaded: channel=${QURAN_VOICE_CHANNEL_ID}, streamConfigured=${Boolean(process.env.QURAN_STREAM_URL)}`);
let currentInterval = 2 * 60 * 1000;
let automaticAzkarInterval;
let holyDaysInterval;
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

const holyDayBackgrounds = [
  'https://images.unsplash.com/photo-1564121211835-e88c852648ab',
  'https://images.unsplash.com/photo-1539650116574-75c0c6d73f6e',
  'https://images.unsplash.com/photo-1519817650390-64a93db51149',
  'https://images.unsplash.com/photo-1609599006353-e629aaabfeae',
  'https://images.unsplash.com/photo-1542816417-0983c9c9ad53',
  'https://images.unsplash.com/photo-1591604129939-f1efa4d9f7fa',
  'https://images.unsplash.com/photo-1585036156171-384164a8c675',
  'https://images.unsplash.com/photo-1564769625905-50e93615e769',
  'https://images.unsplash.com/photo-1579546929518-9e396f3cc809',
  'https://images.unsplash.com/photo-1519682337058-a94d519337bc',
  'https://images.unsplash.com/photo-1490730141103-6cac27aaab94',
  'https://images.unsplash.com/photo-1519681393784-d120267933ba',
  'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8',
  'https://images.unsplash.com/photo-1500534623283-312aade485b7',
  'https://images.unsplash.com/photo-1506744038136-46273834b3fb',
  'https://images.unsplash.com/photo-1470770841072-f978cf4d019e',
  'https://images.unsplash.com/photo-1501785888041-af3ef285b470',
  'https://images.unsplash.com/photo-1511497584788-876760111969',
  'https://images.unsplash.com/photo-1534088568595-a066f410bcda',
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b'
].map((url) => `${url}?auto=format&fit=crop&w=2000&q=90`);

const holyDayThemes = [
  {
    title: 'يوم الجمعة',
    phrases: [
      'أكثروا من الصلاة والسلام على رسول الله ﷺ.',
      'اقرؤوا سورة الكهف، واجعلوا الجمعة نورًا بين الجمعتين.',
      'في يوم الجمعة أكثروا من الدعاء، فالخير واسع والفضل عظيم.',
      'اجعلوا الجمعة بداية جديدة للتوبة والعمل الصالح.',
      'اغتنموا ساعة الإجابة بالدعاء لأنفسكم وأهليكم.',
      'جمعة مباركة بذكر الله والصلاة على النبي ﷺ.',
      'طهّروا قلوبكم في الجمعة بالعفو وصلة الرحم.',
      'من جمال الجمعة أن تملأها بالصلاة والذكر والقرآن.',
      'لا تجعلوا الجمعة تمرّ دون صدقة أو دعوة طيبة.',
      'اجعلوا سورة الكهف رفيقة جمعتكم.',
      'الجمعة فرصة لمراجعة القلب وتجديد العهد مع الله.',
      'بارك الله جمعتكم بنور القرآن وسكينة الإيمان.'
    ]
  },
  {
    title: 'الأيام البيض',
    phrases: [
      'تذكير بصيام الثالث عشر والرابع عشر والخامس عشر من الشهر الهجري.',
      'الأيام البيض فرصة لتجديد النية وزيادة القرب من الله.',
      'من استطاع صيام الأيام البيض فليغتنم هذا العمل المبارك.',
      'اجمعوا في الأيام البيض بين الصيام والذكر والصدقة.',
      'ذكّروا من تحبون بصيام الأيام البيض برفق ومحبة.',
      'كل نية صادقة في الأيام البيض باب من أبواب الخير.',
      'الأيام البيض تذكير بأن الطاعة تستمر طوال العام.',
      'ابدؤوا الأيام البيض بدعاء صادق وقلب حاضر.',
      'الصيام مدرسة للصبر والشكر ومراقبة الله.',
      'اجعلوا أيام البيض موعدًا ثابتًا لمراجعة العادات.',
      'في الأيام البيض نور الصيام ونور النية الصالحة.',
      'تقبّل الله صيامكم وقيامكم وجعل أيامكم بيضاء بالطاعة.'
    ]
  },
  {
    title: 'الإثنين والخميس',
    phrases: [
      'صيام الإثنين والخميس سنة عظيمة لمن تيسّر له ذلك.',
      'جدّدوا نيتكم في الإثنين والخميس واطلبوا القبول من الله.',
      'اجعلوا الإثنين والخميس محطة أسبوعية للعبادة والصفاء.',
      'من رحمة الله تعدد أبواب الخير في كل أسبوع.',
      'الصيام يعلّم القلب الصبر ويعوّده مراقبة الله.',
      'لا تنسوا الدعاء عند الإفطار، فدعاء الصائم عظيم الرجاء.',
      'في يومي الإثنين والخميس فرصة لترك ما يثقل القلب.',
      'ابدؤوا أسبوعكم بالطاعة واختموه بالشكر والذكر.',
      'أحسنوا نية الصيام، فالأعمال بالنيات.',
      'صيام التطوع باب محبة، فاسألوا الله الإخلاص والثبات.',
      'شاركوا تذكيرًا لطيفًا بصيام الإثنين والخميس.',
      'كتب الله لكم أجر النية والعمل وجعل صيامكم نورًا.'
    ]
  },
  {
    title: 'فضل الذكر',
    phrases: [
      'اجعل لسانك رطبًا بذكر الله في كل وقت.',
      'سبحان الله والحمد لله والله أكبر، كلمات خفيفة وأجور عظيمة.',
      'أكثروا من الاستغفار، فالله يحب التوابين.',
      'اذكروا الله في الرخاء يذكركم في الشدة.',
      'الصباح والمساء مواسم جميلة للتحصين والطمأنينة.',
      'لا تحقرن ذكرًا قليلًا، فدوام الخير أحب الأعمال.',
      'اجعلوا في يومكم وردًا من التسبيح والتحميد والتهليل.',
      'الذكر يطمئن القلب ويجمع شتات النفس.',
      'سبّحوا الله بعدد ما خلق وملء ما في السماوات والأرض.',
      'استغفروا الله بنية صادقة واطلبوا منه الثبات.',
      'اذكروا الله عند النعمة شكرًا وعند البلاء صبرًا.',
      'اللهم أعنّا على ذكرك وشكرك وحسن عبادتك.'
    ]
  },
  {
    title: 'الأدعية الفضيلة',
    phrases: [
      'اللهم آت نفوسنا تقواها وزكّها أنت خير من زكّاها.',
      'ربنا آتنا في الدنيا حسنة وفي الآخرة حسنة وقنا عذاب النار.',
      'اللهم اغفر لنا ولوالدينا ولجميع المسلمين.',
      'رب اشرح لي صدري ويسّر لي أمري.',
      'اللهم اجعل القرآن ربيع قلوبنا ونور صدورنا.',
      'يا رب ارزقنا قلبًا سليمًا ولسانًا ذاكرًا وعملًا صالحًا.',
      'اللهم اهدنا وسددنا وبارك لنا في أوقاتنا.',
      'ربنا تقبل منا إنك أنت السميع العليم.',
      'اللهم ارزقنا الإخلاص في القول والعمل.',
      'يا حي يا قيوم برحمتك نستغيث فأصلح لنا شأننا كله.',
      'اللهم اجبر خواطرنا واشف مرضانا وارحم موتانا.',
      'رب اغفر وارحم وأنت خير الراحمين.'
    ]
  },
  {
    title: 'فضائل الأوقات',
    phrases: [
      'اغتنموا الأسحار بالدعاء والاستغفار وصدق الرجاء.',
      'بعد الصلاة وقت كريم للذكر والدعاء وحمد الله.',
      'اجعلوا آخر الليل موعدًا هادئًا مع القرآن.',
      'الوقت نعمة، فاملؤوه بما ينفعكم في الدنيا والآخرة.',
      'ساعة هدوء مع الله قد تغيّر يومًا كاملًا.',
      'ابدؤوا صباحكم بذكر الله ونية صالحة.',
      'اختموا يومكم بالتوبة والعفو عن الناس.',
      'بين الأذان والإقامة اغتنموا الدعاء والصلاة.',
      'لا تؤجلوا الخير، فالأيام تمضي والعمل يبقى.',
      'اجعلوا للقرآن وقتًا ثابتًا لا يزاحمه شيء.',
      'في كل ساعة فرصة لصدقة أو كلمة طيبة أو دعاء.',
      'بارك الله في أوقاتكم وجعلها عامرة بالطاعة.'
    ]
  }
];

function createHolyDaysContent() {
  return holyDayThemes.flatMap((theme) => theme.phrases.flatMap((phrase, phraseIndex) =>
    holyDayBackgrounds.map((image, imageIndex) => ({
      key: `${theme.title}-${phraseIndex}-${imageIndex}`,
      title: theme.title,
      text: phrase,
      image
    }))
  ));
}

const holyDaysContent = createHolyDaysContent();
let holyDaysDeck = [];
let lastHolyDayContentKey;

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

function shuffleHolyDaysDeck() {
  holyDaysDeck = [...holyDaysContent];
  for (let index = holyDaysDeck.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [holyDaysDeck[index], holyDaysDeck[randomIndex]] = [holyDaysDeck[randomIndex], holyDaysDeck[index]];
  }

  if (holyDaysDeck.length > 1 && holyDaysDeck[holyDaysDeck.length - 1].key === lastHolyDayContentKey) {
    [holyDaysDeck[0], holyDaysDeck[holyDaysDeck.length - 1]] = [holyDaysDeck[holyDaysDeck.length - 1], holyDaysDeck[0]];
  }
}

function getNextHolyDayContent() {
  if (!holyDaysDeck.length) shuffleHolyDaysDeck();
  const content = holyDaysDeck.pop();
  lastHolyDayContentKey = content.key;
  return content;
}

async function sendHolyDayImage() {
  if (!HOLY_DAYS_CHANNEL_ID) return;

  try {
    const channel = await client.channels.fetch(HOLY_DAYS_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased()) {
      console.error(`Holy days channel is unavailable: ${HOLY_DAYS_CHANNEL_ID}`);
      return;
    }

    const content = getNextHolyDayContent();
    const embed = new EmbedBuilder()
      .setColor(getRainbowColor())
      .setTitle(`✦ ${content.title} ✦`)
      .setDescription(content.text)
      .setImage(content.image)
      .setFooter({ text: 'JONT / Athkar • تذكير بالخير والطاعة' })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    console.log(`Holy days image sent to channel ${HOLY_DAYS_CHANNEL_ID}.`);
  } catch (error) {
    console.error('Could not send holy days image:', error);
  }
}

function startHolyDaysSchedule() {
  if (!HOLY_DAYS_CHANNEL_ID) {
    console.log('HOLY_DAYS_CHANNEL_ID is not configured; holy days schedule is disabled.');
    return;
  }

  sendHolyDayImage().catch((error) => console.error('Initial holy days image failed:', error));
  holyDaysInterval = setInterval(() => {
    sendHolyDayImage().catch((error) => console.error('Scheduled holy days image failed:', error));
  }, 60 * 60 * 1000);
}

client.once('clientReady', (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  readyClient.user.setActivity('JONT / Athkar', { type: 3 });
  resetAutomaticAzkarInterval();
  connectQuranVoice().catch((error) => console.error('Could not start Quran voice stream:', error));
  startHolyDaysSchedule();
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
