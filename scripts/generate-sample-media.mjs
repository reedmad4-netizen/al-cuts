import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const postersDir = path.join(root, "public/media/posters");
const clipsDir = path.join(root, "public/media/clips");
const streamsDir = path.join(root, "public/media/streams");
const fontBold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const fontMono = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf";

fs.mkdirSync(clipsDir, { recursive: true });
fs.mkdirSync(streamsDir, { recursive: true });

const samples = [
  {
    id: "fps-clutch",
    poster: path.join(postersDir, "fps-clutch.jpg"),
    output: path.join(clipsDir, "demo-fps-clutch.mp4"),
    duration: 28, // 20s pre-buffer + 8s post-event
    hudTitle: "NEON PROTOCOL  |  RANKED IMMORTAL",
    eventText: "ACE  //  1v5 SITE RETAKE",
    hasMusic: false,
    zoomExpr: "1.04+0.08*sin(on/90)",
    panX: "iw/2-(iw/zoom/2)+24*sin(on/55)",
    panY: "ih/2-(ih/zoom/2)+12*cos(on/70)",
  },
  {
    id: "br-finale",
    poster: path.join(postersDir, "br-finale.jpg"),
    output: path.join(clipsDir, "demo-br-finale.mp4"),
    duration: 30, // 20s pre-buffer + 10s post-event
    hudTitle: "APEX HORIZON  |  FINAL RING 6",
    eventText: "SQUAD WIPE  //  CHAMPION",
    hasMusic: false,
    zoomExpr: "1.05+0.07*cos(on/85)",
    panX: "iw/2-(iw/zoom/2)-22*sin(on/60)",
    panY: "ih/2-(ih/zoom/2)+14*sin(on/75)",
  },
  {
    id: "cyber-race",
    poster: path.join(postersDir, "cyber-race.jpg"),
    output: path.join(clipsDir, "demo-cyber-race.mp4"),
    duration: 26, // 20s pre-buffer + 6s post-event
    hudTitle: "VELOCITY ZERO  |  TOKYO EXPRESSWAY",
    eventText: "PHOTO FINISH  //  +0.012s RECORD",
    hasMusic: true, // Contains continuous melodic synthwave backing track for Music Detection
    zoomExpr: "1.06+0.09*sin(on/50)",
    panX: "iw/2-(iw/zoom/2)+30*cos(on/45)",
    panY: "ih/2-(ih/zoom/2)+10*sin(on/40)",
  },
  {
    id: "boss-parry",
    poster: path.join(postersDir, "boss-parry.jpg"),
    output: path.join(clipsDir, "demo-boss-parry.mp4"),
    duration: 28, // 20s pre-buffer + 8s post-event
    hudTitle: "ASHEN CROWN  |  NO-HIT BOSS RUN",
    eventText: "FRAME-PERFECT PARRY  //  STAGGER",
    hasMusic: false,
    zoomExpr: "1.04+0.08*sin(on/75)",
    panX: "iw/2-(iw/zoom/2)+20*sin(on/65)",
    panY: "ih/2-(ih/zoom/2)-12*cos(on/60)",
  },
];

function buildAudioFilter(duration, hasMusic) {
  if (hasMusic) {
    // Rich continuous stereo synthwave chord bed (detectable high sustained tonal energy)
    return (
      `aevalsrc='` +
      `0.22*sin(2*PI*220*t)+0.16*sin(2*PI*261.63*t)+0.15*sin(2*PI*329.63*t)+` +
      `0.12*sin(2*PI*440*t)*(0.6+0.4*sin(2*PI*2*t))+` +
      `0.14*sin(2*PI*110*t)*(0.5+0.5*sin(2*PI*4*t))` +
      `:s=44100:c=stereo:d=${duration}',afade=t=in:st=0:d=0.5,afade=t=out:st=${duration - 1}:d=1[aout]`
    );
  }
  // Clean sparse gameplay ambience + sharp reaction/impact burst around t=19.5s-22.5s (trigger moment!)
  return (
    `aevalsrc='` +
    `0.025*sin(2*PI*65*t)+` +
    `if(between(t,19.4,22.4), 0.36*sin(2*PI*(180+90*sin(18*t))*t)*exp(-2.2*mod(t-19.4,0.45)), 0)+` +
    `if(between(t,8.0,8.4), 0.12*sin(2*PI*140*t)*exp(-5*(t-8.0)), 0)` +
    `:s=44100:c=stereo:d=${duration}',afade=t=in:st=0:d=0.3,afade=t=out:st=${duration - 0.8}:d=0.8[aout]`
  );
}

for (const s of samples) {
  console.log(`Generating ${path.basename(s.output)} (${s.duration}s, music=${s.hasMusic})...`);
  const frames = s.duration * 24;
  // Normalize poster to 1440x810 then smooth dynamic camera pan/zoom to 1280x720 + subtle tactical HUD + highlight flash at t=20s
  const safeHud = s.hudTitle.replace(/:/g, "\\:");
  const safeEvt = s.eventText.replace(/:/g, "\\:");

  const vf = [
    `[0:v]scale=1536:864:force_original_aspect_ratio=increase,crop=1536:864`,
    `zoompan=z='${s.zoomExpr}':x='${s.panX}':y='${s.panY}':d=${frames}:s=1280x720:fps=24`,
    `eq=contrast='1+0.12*between(t,19.8,22.2)':brightness='0.05*between(t,19.8,20.5)':saturation='1.05+0.18*between(t,19.8,23.0)'`,
    // Subtle top-left HUD chip
    `drawbox=x=28:y=24:w=430:h=38:color=black@0.58:t=fill`,
    `drawbox=x=28:y=24:w=4:h=38:color=0x2563EB@0.95:t=fill`,
    `drawtext=fontfile=${fontMono}:text='${safeHud}':fontcolor=white@0.92:fontsize=14:x=44:y=36`,
    // Subtle top-right timecode
    `drawbox=x=1092:y=24:w=160:h=38:color=black@0.58:t=fill`,
    `drawtext=fontfile=${fontMono}:text='TC %{pts\\:hms}':fontcolor=white@0.9:fontsize=13:x=1106:y=37`,
    // Center reticle subtle
    `drawbox=x=636:y=359:w=8:h=2:color=0x60A5FA@0.7:t=fill`,
    `drawbox=x=639:y=356:w=2:h=8:color=0x60A5FA@0.7:t=fill`,
    // In-game event callout banner when exciting moment hits at t=20.0s (after 20s pre-buffer!)
    `drawbox=x=370:y=92:w=540:h=46:color=0x09090B@0.78:t=fill:enable='between(t,19.8,24.2)'`,
    `drawbox=x=370:y=92:w=540:h=3:color=0x2563EB@1.0:t=fill:enable='between(t,19.8,24.2)'`,
    `drawtext=fontfile=${fontBold}:text='${safeEvt}':fontcolor=white:fontsize=19:x=(w-text_w)/2:y=106:enable='between(t,19.8,24.2)'`,
    `format=yuv420p[vout]`,
  ].join(",");

  const af = buildAudioFilter(s.duration, s.hasMusic);
  const filterComplex = `${vf};${af}`;

  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      s.poster,
      "-filter_complex",
      filterComplex,
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "28",
      "-maxrate",
      "1500k",
      "-bufsize",
      "3000k",
      "-g",
      "48",
      "-threads",
      "2",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-t",
      String(s.duration),
      s.output,
    ],
    { stdio: "inherit" }
  );
}

// Create a combined 54s demo source stream (fps-clutch 28s clean + cyber-race 26s music) for real rolling-buffer extraction!
console.log("Generating demo-feed.mp4 continuous source stream...");
const concatList = path.join(streamsDir, "concat.txt");
fs.writeFileSync(
  concatList,
  `file '${path.join(clipsDir, "demo-fps-clutch.mp4")}'\nfile '${path.join(clipsDir, "demo-cyber-race.mp4")}'\n`
);
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatList,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    path.join(streamsDir, "demo-feed.mp4"),
  ],
  { stdio: "inherit" }
);
fs.unlinkSync(concatList);

console.log("All sample gaming media generated successfully!");
