/**
 * Cuts Kaiba's broadcast.
 *
 *   npx tsx scripts/broadcast-film.ts
 *
 * The film is nine shots of him saying it. Each one was performed by Higgsfield
 * (Veo 3.1 Lite) from a start frame drawn off Mike's picture of him
 * (`kaiba.webp`, beside the takes) — one line of `BROADCAST_WORDS` a shot, his
 * mouth on the words — and then put through Higgsfield's voice change into one
 * voice, because Veo casts a new throat for every shot and a broadcast is one
 * man talking. The change keeps the performance and its timing, so the mouths
 * still land. Under it all, a score (Higgsfield's Sonilo).
 *
 * `data/story/broadcast/takes.json` is the edit: which take of each shot, where
 * it lives, what made it, and the second it cuts out — chosen by eye and ear,
 * after the last word and before whatever the shot does next. The takes are
 * downloaded into `.cache` rather than kept in the repository, the way the
 * world's assets are.
 *
 * The cut: the first frame held while the picture fades up, so the first word
 * is never under a fade; a dissolve between shots, with each shot's voice laid
 * in at full level from its first frame, because most of them start talking
 * at once and a crossfade would eat the syllable; every shot levelled to the
 * same loudness with a plain gain, not a compressor; the last frame held while
 * it fades out, so the last word is not under one either. The score is ducked
 * under him.
 *
 * It writes `public/story/broadcast.mp4`, a poster (`broadcast.jpg`, the first
 * frame of the first shot), and the second each line starts — measured off the
 * voice — into `src/story/generated/broadcast.json`, which is where the
 * captions read it. It refuses to cut if a take's line is not the caption's.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BROADCAST_WORDS } from '../src/story/broadcast';

const SRC = 'data/story/broadcast';
const OUT = 'public/story';
const WORK = '.cache/broadcast';
const W = 720;
const H = 1280;
const FPS = 24;
/** The dissolve between shots. */
const XF = 0.35;
/** The first frame, held while the picture fades up from black. */
const LEAD = 0.9;
/** The last frame, held while it fades back down. */
const TAIL = 1.6;
/** Every shot's voice is brought to this, and the finished film to `FILM_LUFS`. */
const SHOT_LUFS = -17;
const FILM_LUFS = -16;
/** The picture's bitrate. */
const VIDEO_RATE = '1150k';

interface Take {
  id: number;
  line: string;
  url: string;
  job?: string;
  /** Where the shot cuts out, in seconds of the take. The whole take if absent. */
  out?: number;
}

/** Runs ffmpeg and returns what it reported, which it does on stderr. */
const ffmpeg = (args: string[]) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', ...args], { maxBuffer: 64 * 1024 * 1024 });
  if (r.status) throw new Error(String(r.stderr));
  return String(r.stderr) + String(r.stdout);
};
const seconds = (file: string) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
const norm = (t: string) => t.replace(/[’']/g, "'").replace(/[^a-z0-9' ]/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

/** The first moment somebody is talking: the first 25 ms within 18 dB of the take's speech. */
function onset(file: string, until: number): number {
  const log = ffmpeg(['-v', 'error', '-i', file, '-vn', '-af',
    `atrim=0:${until},aresample=16000,asetnsamples=n=400:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-`,
    '-f', 'null', '-']);
  const levels = [...log.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (m[1] === '-inf' ? -120 : Number(m[1])));
  const loud = [...levels].sort((a, b) => b - a)[Math.floor(levels.length * 0.1)] ?? -20;
  return Math.max(0, levels.findIndex((l) => l > loud - 18)) * 0.025;
}

/** Integrated loudness of the part of a take that is used. */
function loudness(file: string, until: number): number {
  const log = ffmpeg(['-i', file, '-vn', '-af', `atrim=0:${until},ebur128`, '-f', 'null', '-']);
  const all = [...log.matchAll(/I:\s+(-?[\d.]+) LUFS/g)];
  return Number(all[all.length - 1][1]);
}

/** Two-pass loudness for the finished mix: measure, then one linear gain. */
function loudnormMeasure(file: string, target: number) {
  const log = ffmpeg(['-i', file, '-vn', '-af', `loudnorm=I=${target}:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-']);
  return JSON.parse(log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1)) as Record<string, string>;
}

async function main() {
  mkdirSync(join(WORK, 'shots'), { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const takes = (JSON.parse(readFileSync(join(SRC, 'takes.json'), 'utf8')) as Take[]).sort((a, b) => a.id - b.id);

  /* ---- the words, the same on both sides ---- */
  if (takes.length !== BROADCAST_WORDS.length || takes.some((t, i) => norm(t.line) !== norm(BROADCAST_WORDS[i]))) {
    console.error('The takes and the captions do not say the same thing:');
    takes.forEach((t, i) => norm(t.line) !== norm(BROADCAST_WORDS[i] ?? '') && console.error(`  shot ${t.id}\n    take:    ${t.line}\n    caption: ${BROADCAST_WORDS[i]}`));
    process.exit(1);
  }

  /* ---- each shot: fetched, measured ---- */
  const shots = takes.map((take) => {
    const raw = join(WORK, 'shots', `shot${take.id}.mp4`);
    if (!existsSync(raw)) execFileSync('curl', ['-sfL', '-o', raw, take.url]);
    const length = seconds(raw);
    const out = +Math.min(length, take.out ?? length).toFixed(3);
    const speaks = onset(raw, out);
    const gain = +(SHOT_LUFS - loudness(raw, out)).toFixed(2);
    console.log(`  shot ${take.id}: ${length.toFixed(2)} s, used to ${out.toFixed(2)} s, speaking from ${speaks.toFixed(2)} s, ${gain >= 0 ? '+' : ''}${gain} dB`);
    return { file: raw, out, speaks, gain };
  });

  /* ---- where each shot starts in the film ---- */
  const starts: number[] = [];
  let t = LEAD;
  for (const s of shots) {
    starts.push(+t.toFixed(3));
    t += s.out - XF;
  }
  const last = shots.length - 1;
  const total = +(starts[last] + shots[last].out + TAIL).toFixed(3);
  const at = shots.map((s, i) => +(starts[i] + s.speaks).toFixed(3));

  /* ---- picture: held, dissolved, held, faded ---- */
  let graph = '';
  shots.forEach((s, i) => {
    const hold = [i === 0 ? `tpad=start_duration=${LEAD}:start_mode=clone` : '', i === last ? `tpad=stop_duration=${TAIL}:stop_mode=clone` : '']
      .filter(Boolean)
      .join(',');
    graph += `[${i}:v]trim=0:${s.out},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},setsar=1,format=yuv420p${hold ? ',' + hold : ''}[v${i}];`;
  });
  let chain = '[v0]';
  for (let i = 1; i < shots.length; i++) {
    const into = i === last ? '[cut]' : `[x${i}]`;
    graph += `${chain}[v${i}]xfade=transition=fade:duration=${XF}:offset=${starts[i].toFixed(3)}${into};`;
    chain = into;
  }
  graph += `[cut]fade=t=in:st=0:d=0.75,fade=t=out:st=${(total - 1.3).toFixed(3)}:d=1.3,format=yuv420p[v];`;

  /* ---- voice: every shot at full level from its first frame ---- */
  shots.forEach((s, i) => {
    const ms = Math.round(starts[i] * 1000);
    graph += `[${i}:a]atrim=0:${s.out},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=mono,volume=${s.gain}dB,` +
      `afade=t=in:d=0.012,afade=t=out:st=${(s.out - 0.25).toFixed(3)}:d=0.25,adelay=${ms}:all=1[a${i}];`;
  });
  graph += `${shots.map((_, i) => `[a${i}]`).join('')}amix=inputs=${shots.length}:normalize=0:duration=longest,apad=whole_dur=${total},atrim=0:${total},aformat=channel_layouts=stereo[voice];`;

  /* ---- the score, ducked under him ---- */
  const bed = shots.length;
  graph +=
    `[voice]asplit=2[vmix][vkey];` +
    `[${bed}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total},asetpts=N/SR/TB,volume=0.34,afade=t=in:st=0:d=1.4,afade=t=out:st=${(total - 2.2).toFixed(3)}:d=2.2[score];` +
    `[score][vkey]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=420[ducked];` +
    `[ducked][vmix]amix=inputs=2:normalize=0,afade=t=out:st=${(total - 1.3).toFixed(3)}:d=1.3[a]`;

  const inputs = shots.flatMap((s) => ['-i', s.file]);
  const master = join(WORK, 'master.mov');
  ffmpeg(['-v', 'error', '-y', ...inputs, '-i', join(SRC, 'bed.m4a'), '-filter_complex', graph, '-map', '[v]', '-map', '[a]',
    '-t', String(total), '-c:v', 'libx264', '-crf', '12', '-preset', 'fast', '-c:a', 'pcm_s24le', master]);

  /* ---- the finished film: one linear gain to the target, then encoded ---- */
  const m = loudnormMeasure(master, FILM_LUFS);
  const level =
    `loudnorm=I=${FILM_LUFS}:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:` +
    `measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`;
  /* Two passes at a fixed budget: Veo's cities and holograms would take a
     constant-quality encode past 20 MB, and a phone downloads this once, at
     the moment the player is waiting for it. At this rate the stills are hard
     to tell from the master. */
  const film = join(OUT, 'broadcast.mp4');
  const x264 = ['-c:v', 'libx264', '-b:v', VIDEO_RATE, '-maxrate', '2500k', '-bufsize', '3000k', '-tune', 'animation', '-preset', 'slow',
    '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-passlogfile', join(WORK, 'pass')];
  ffmpeg(['-v', 'error', '-y', '-i', master, '-an', ...x264, '-pass', '1', '-f', 'mp4', '/dev/null']);
  ffmpeg(['-v', 'error', '-y', '-i', master, '-af', level, ...x264, '-pass', '2',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-movflags', '+faststart', film]);
  ffmpeg(['-v', 'error', '-y', '-i', shots[0].file, '-frames:v', '1', '-vf', `scale=${W}:${H}`, '-q:v', '3', join(OUT, 'broadcast.jpg')]);
  writeFileSync('src/story/generated/broadcast.json', JSON.stringify({ at, length: total }) + '\n');
  console.log(`→ ${film}: ${seconds(film).toFixed(1)} s, ${(statSync(film).size / 1e6).toFixed(1)} MB; lines at ${at.map((a) => a.toFixed(2)).join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
