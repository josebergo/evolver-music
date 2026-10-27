// 规格 → 音符事件编译器。纯函数、确定性（同 seed 同输出），可单测。
// 渲染端（Tone.js 引擎）只认 NoteEvent，不认规格。
import { MusicSpec, parseChord, parseKey, StyleId } from "./schema";

/** 引擎认识的乐器 ID（即乐层名 + 打击乐/氛围）。 */
export type InstrumentId =
  | "epiano" | "supersaw" | "organ" | "piano" | "strings" | "guzheng" | "dizi"
  | "pad" | "melody" | "pluck" | "bass"
  | "kick" | "snare" | "hat" | "vinyl" | "riser";

export interface NoteEvent {
  instrument: InstrumentId;
  /** 绝对拍位（从乐曲开头起算的 beat 数） */
  time: number;
  /** 持续拍数 */
  dur: number;
  /** 音高（MIDI）。打击乐/氛围层为空 */
  midi?: number[];
  /** 力度 0~1 */
  vel: number;
}

export interface CompiledTrack {
  bpm: number;
  style: StyleId;
  totalBeats: number;
  events: NoteEvent[];
  sidechain: number;
  lofi: number;
  reverb: number;
}

// mulberry32：体积小、质量足够的确定性 PRNG。
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 每风格：和声层名、和声织体、旋律层名、旋律音阶覆盖
interface StyleTraits {
  chordLayer: InstrumentId;
  chordTexture:
    | "lofi-hold" | "edm-offbeat" | "synth-hold" | "blues-shuffle"
    | "bar-hold" | "piano-broken" | "jazz-stab" | "guofeng-roll" | "cine-swell";
  melodyLayer: InstrumentId;
  melodyScale?: number[]; // 覆盖自然音阶（相对主音半音）
  melodySnap: boolean; // 强拍是否吸附和弦音
  melodyDensity: number; // 密度系数
}

const BLUES_SCALE = [0, 3, 5, 6, 7, 10];
const PENTA_MINOR = [0, 3, 5, 7, 10];
const PENTA_MAJOR = [0, 2, 4, 7, 9];

const STYLE_TRAITS: Record<StyleId, StyleTraits> = {
  lofi:      { chordLayer: "epiano",   chordTexture: "lofi-hold",    melodyLayer: "melody", melodySnap: true,  melodyDensity: 1 },
  edm:       { chordLayer: "supersaw", chordTexture: "edm-offbeat",  melodyLayer: "melody", melodySnap: true,  melodyDensity: 1.1 },
  blues:     { chordLayer: "organ",    chordTexture: "blues-shuffle", melodyLayer: "melody", melodyScale: BLUES_SCALE, melodySnap: false, melodyDensity: 0.9 },
  ambient:   { chordLayer: "piano",    chordTexture: "bar-hold",     melodyLayer: "melody", melodySnap: true,  melodyDensity: 0.55 },
  piano:     { chordLayer: "piano",    chordTexture: "piano-broken", melodyLayer: "melody", melodySnap: true,  melodyDensity: 0.85 },
  jazz:      { chordLayer: "epiano",   chordTexture: "jazz-stab",    melodyLayer: "melody", melodySnap: true,  melodyDensity: 1 },
  guofeng:   { chordLayer: "guzheng",  chordTexture: "guofeng-roll", melodyLayer: "dizi",   melodyScale: PENTA_MINOR, melodySnap: false, melodyDensity: 0.8 },
  synthwave: { chordLayer: "supersaw", chordTexture: "synth-hold",   melodyLayer: "melody", melodySnap: true,  melodyDensity: 1 },
  cinematic: { chordLayer: "strings",  chordTexture: "cine-swell",   melodyLayer: "melody", melodySnap: true,  melodyDensity: 0.7 },
};

/** 和弦声位：根音在 C3~B3，上方音上翻一个八度形成开离声位。 */
function voiceChord(pc: number, intervals: number[], bright: number): number[] {
  const base = 48 + pc;
  const notes = intervals.map((iv, i) => base + iv + (i >= 2 ? 12 : 0));
  if (bright > 0.75 && notes.length >= 3) notes.push(notes[1] + 12);
  return notes;
}

function midiFromDegree(keyPc: number, scale: number[], degree: number): number {
  const octave = Math.floor(degree / scale.length);
  const idx = ((degree % scale.length) + scale.length) % scale.length;
  return 60 + keyPc + octave * 12 + scale[idx];
}

function nearestChordTone(midi: number, chordTones: number[]): number {
  return chordTones.reduce((best, t) =>
    Math.abs(t - midi) < Math.abs(best - midi) ? t : best, chordTones[0]);
}

export function compile(spec: MusicSpec): CompiledTrack {
  const events: NoteEvent[] = [];
  const key = parseKey(spec.key) ?? { pc: 9, minor: true, scale: [0, 2, 3, 5, 7, 8, 10] };
  const traits = STYLE_TRAITS[spec.style];
  const melodyScale = traits.melodyScale
    ?? (key.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]);
  // 古风大调换大调五声
  if (spec.style === "guofeng" && !key.minor) {
    melodyScale.length = 0;
    melodyScale.push(...PENTA_MAJOR);
  }
  const rngMelody = mulberry32(spec.seed || 1);
  const rngBass = mulberry32((spec.seed || 1) ^ 0x9e3779b9);
  let degree = 4;
  let barOffset = 0;

  for (const sec of spec.sections) {
    const has = (l: string) => sec.layers.includes(l);
    const secStart = barOffset;
    const secBeats = sec.bars * 4;

    for (let bar = 0; bar < sec.bars; bar++) {
      const barStart = secStart + bar * 4;
      const chord = parseChord(sec.chords[bar % sec.chords.length]);
      if (!chord) continue;
      const bassBase = 36 + chord.pc;

      // ── 和声层 ──────────────────────────────────────────────
      if (has(traits.chordLayer)) {
        const voiced = voiceChord(chord.pc, chord.intervals, sec.energy);
        const cvel = 0.34 + sec.energy * 0.14;
        switch (traits.chordTexture) {
          case "lofi-hold":
            events.push({ instrument: traits.chordLayer, time: barStart, dur: 3.25, midi: voiced, vel: cvel });
            if (sec.energy >= 0.5) {
              events.push({ instrument: traits.chordLayer, time: barStart + 2.5, dur: 1.2, midi: voiced, vel: cvel * 0.7 });
            }
            break;
          case "edm-offbeat":
            for (const t of [0.5, 1.5, 2.5, 3.5]) {
              events.push({ instrument: traits.chordLayer, time: barStart + t, dur: 0.4, midi: voiced, vel: cvel });
            }
            break;
          case "synth-hold":
            events.push({ instrument: traits.chordLayer, time: barStart, dur: 2, midi: voiced, vel: cvel * 0.9 });
            events.push({ instrument: traits.chordLayer, time: barStart + 2, dur: 2, midi: voiced, vel: cvel });
            break;
          case "blues-shuffle": // 12/8 摇摆切分
            for (const t of [0, 1.667, 3.333]) {
              events.push({ instrument: traits.chordLayer, time: barStart + t, dur: 0.9, midi: voiced, vel: cvel * 0.9 });
            }
            break;
          case "bar-hold":
            events.push({ instrument: traits.chordLayer, time: barStart, dur: 3.9, midi: voiced, vel: 0.24 + sec.energy * 0.08 });
            break;
          case "piano-broken": { // 分解和弦八分上下行
            const tones = [...voiced, voiced[voiced.length - 1] + 0].slice(0, 5);
            const seq = [...tones.slice(0, 4), ...tones.slice(0, 4).reverse()];
            for (let e = 0; e < 8; e++) {
              events.push({ instrument: traits.chordLayer, time: barStart + e * 0.5, dur: 0.5, midi: [seq[e % seq.length]], vel: 0.22 + sec.energy * 0.1 });
            }
            break;
          }
          case "jazz-stab":
            for (const t of [1.667, 3.5]) {
              events.push({ instrument: traits.chordLayer, time: barStart + t, dur: 0.35, midi: voiced, vel: cvel * 0.8 });
            }
            break;
          case "guofeng-roll": { // 古筝四声琶音
            const tones = voiceChord(chord.pc, chord.intervals, 0).map((n) => n + 12);
            for (let q = 0; q < 4; q++) {
              const t = tones[q % tones.length];
              events.push({ instrument: traits.chordLayer, time: barStart + q, dur: 0.95, midi: [t], vel: 0.26 + sec.energy * 0.1 });
            }
            break;
          }
          case "cine-swell":
            events.push({ instrument: traits.chordLayer, time: barStart, dur: 3.9, midi: voiced, vel: 0.2 + sec.energy * 0.14 });
            break;
        }
      }

      // ── Pad（整小节长音） ────────────────────────────────────
      if (has("pad")) {
        const voiced = voiceChord(chord.pc, chord.intervals, 0).map((n) => n + 12);
        events.push({ instrument: "pad", time: barStart, dur: 4, midi: voiced, vel: 0.28 + sec.energy * 0.08 });
      }

      // ── 电影感钢琴副层（四分琶音铺底） ────────────────────────
      if (spec.style === "cinematic" && has("piano")) {
        const tones = voiceChord(chord.pc, chord.intervals, 0);
        for (let q = 0; q < 4; q++) {
          events.push({ instrument: "piano", time: barStart + q, dur: 0.95, midi: [tones[q % tones.length] + 12], vel: 0.2 });
        }
      }

      // ── 旋律（种子化随机游走 + 可选强拍吸附和弦音） ─────────────
      if (has(traits.melodyLayer)) {
        const chordTones = chord.intervals
          .map((iv) => 60 + key.pc + iv)
          .concat(chord.intervals.map((iv) => 72 + key.pc + iv));
        const targetNotes = Math.max(
          1,
          Math.round((1 + sec.energy * 3.5 + rngMelody() * 1.5) * traits.melodyDensity),
        );
        const grid = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
        const positions: number[] = [];
        while (positions.length < Math.min(targetNotes, grid.length)) {
          const p = grid[Math.floor(rngMelody() * grid.length)];
          if (!positions.includes(p)) positions.push(p);
        }
        positions.sort((a, b) => a - b);
        positions.forEach((pos, i) => {
          if (rngMelody() < 0.18 * (1 - sec.energy)) return; // 低能量留白
          const steps = [-2, -1, -1, 1, 1, 1, 2, 0];
          degree += steps[Math.floor(rngMelody() * steps.length)];
          degree = Math.max(0, Math.min(melodyScale.length * 2 - 1, degree));
          let midi = midiFromDegree(key.pc, melodyScale, degree);
          if (traits.melodySnap && pos % 1 === 0) midi = nearestChordTone(midi, chordTones);
          midi = Math.max(64, Math.min(88, midi));
          const next = positions[i + 1] ?? 4;
          const dur = Math.min(2.5, Math.max(0.4, next - pos));
          events.push({
            instrument: traits.melodyLayer, time: barStart + pos, dur,
            midi: [midi], vel: 0.3 + sec.energy * 0.2 + rngMelody() * 0.06,
          });
        });
      }

      // ── 拨奏琶音（电子系：八分上下行） ────────────────────────
      if (has("pluck")) {
        const tones = chord.intervals.map((iv) => 60 + chord.pc + iv + 12);
        const order = [0, 1, 2, 1];
        for (let e = 0; e < 8; e++) {
          const t = tones[order[e % order.length] % tones.length] ?? tones[0];
          events.push({ instrument: "pluck", time: barStart + e * 0.5, dur: 0.3, midi: [t], vel: 0.2 + sec.energy * 0.08 });
        }
      }

      // ── 贝斯 ────────────────────────────────────────────────
      if (has("bass")) {
        const bvel = 0.45 + sec.energy * 0.15;
        const third = chord.intervals[1] ?? 4;
        const fifth = chord.intervals[2] ?? 7;
        switch (sec.bassPattern) {
          case "root_long":
            events.push({ instrument: "bass", time: barStart, dur: 3.8, midi: [bassBase], vel: bvel });
            break;
          case "soft_walk":
            events.push({ instrument: "bass", time: barStart, dur: 1.5, midi: [bassBase], vel: bvel });
            events.push({ instrument: "bass", time: barStart + 2, dur: 1.5, midi: [bassBase + 7], vel: bvel * 0.9 });
            break;
          case "root_fifth":
            events.push({ instrument: "bass", time: barStart, dur: 1.9, midi: [bassBase], vel: bvel });
            events.push({ instrument: "bass", time: barStart + 2, dur: 1.9, midi: [bassBase + 7], vel: bvel * 0.9 });
            break;
          case "eight_root":
            for (let e = 0; e < 8; e++) {
              events.push({ instrument: "bass", time: barStart + e * 0.5, dur: 0.42, midi: [bassBase], vel: 0.4 + sec.energy * 0.12 });
            }
            break;
          case "octave_pulse":
            for (let e = 0; e < 8; e++) {
              events.push({ instrument: "bass", time: barStart + e * 0.5, dur: 0.42, midi: [bassBase + (e % 2) * 12], vel: 0.42 + sec.energy * 0.12 });
            }
            break;
          case "sub_pulse":
            events.push({ instrument: "bass", time: barStart, dur: 3.9, midi: [bassBase], vel: 0.55 + sec.energy * 0.1 });
            break;
          case "blues_walk":
          case "jazz_walk": { // 四分行走：根-三-五-六
            const walk = [0, third, fifth, 9];
            for (let q = 0; q < 4; q++) {
              events.push({ instrument: "bass", time: barStart + q, dur: 0.95, midi: [bassBase + walk[q]], vel: bvel * (q === 0 ? 1 : 0.9) });
            }
            break;
          }
          case "drone_root":
            events.push({ instrument: "bass", time: barStart, dur: 3.9, midi: [bassBase - 5 > 28 ? bassBase - 5 : bassBase], vel: 0.5 });
            break;
          case "drone_fifth":
            events.push({ instrument: "bass", time: barStart, dur: 3.9, midi: [bar % 2 === 0 ? bassBase : bassBase + 7], vel: 0.5 });
            break;
          case "piano_root":
            events.push({ instrument: "bass", time: barStart, dur: 3.9, midi: [Math.max(28, bassBase - 12)], vel: 0.42 });
            break;
        }
        if (sec.energy > 0.6 && rngBass() < 0.35 && !["eight_root", "octave_pulse", "blues_walk", "jazz_walk"].includes(sec.bassPattern)) {
          const next = parseChord(sec.chords[(bar + 1) % sec.chords.length]);
          if (next) events.push({ instrument: "bass", time: barStart + 3.5, dur: 0.4, midi: [35 + next.pc], vel: bvel * 0.8 });
        }
      }

      // ── 鼓组 ────────────────────────────────────────────────
      const dv = 0.6 + sec.energy * 0.5;
      const addDrum = (inst: InstrumentId, t: number, dur = 0.2, vel = 0.5) => {
        if (!has(inst)) return;
        events.push({ instrument: inst, time: barStart + t, dur, vel: Math.min(1, vel * dv) });
      };
      const TRIPLET_HATS = [0, 0.667, 1.333, 2, 2.667, 3.333];
      switch (sec.drumPattern) {
        case "lofi_sparse":
          addDrum("kick", 0, 0.3, 0.7); addDrum("kick", 2.5, 0.3, 0.5);
          addDrum("snare", 1, 0.25, 0.45); addDrum("snare", 3, 0.25, 0.4);
          for (let e = 0; e < 8; e++) addDrum("hat", e * 0.5, 0.1, e % 2 === 0 ? 0.28 : 0.16);
          break;
        case "lofi_swing":
          addDrum("kick", 0, 0.3, 0.75); addDrum("kick", 2.5, 0.3, 0.55);
          addDrum("snare", 1, 0.25, 0.5); addDrum("snare", 3, 0.25, 0.45);
          for (let e = 0; e < 8; e++) {
            const swing = e % 2 === 1 ? 0.08 : 0;
            addDrum("hat", e * 0.5 + swing, 0.1, e % 2 === 0 ? 0.3 : 0.17);
          }
          break;
        case "lofi_dense":
          addDrum("kick", 0, 0.3, 0.8); addDrum("kick", 1.75, 0.3, 0.5); addDrum("kick", 2.5, 0.3, 0.6);
          addDrum("snare", 1, 0.25, 0.55); addDrum("snare", 3, 0.25, 0.5);
          for (let e = 0; e < 8; e++) addDrum("hat", e * 0.5, 0.1, 0.3);
          addDrum("hat", 3.5, 0.35, 0.3);
          break;
        case "four_floor":
          for (let b = 0; b < 4; b++) addDrum("kick", b, 0.3, 0.85);
          addDrum("snare", 1, 0.25, 0.5); addDrum("snare", 3, 0.25, 0.5);
          for (const t of [0.5, 1.5, 2.5, 3.5]) addDrum("hat", t, 0.1, 0.35);
          break;
        case "four_floor_break":
          for (const b of [0, 1, 2]) addDrum("kick", b, 0.3, 0.8);
          addDrum("snare", 1, 0.25, 0.5); addDrum("snare", 3, 0.25, 0.55);
          for (const t of [0.5, 1.5, 2.5, 3.5]) addDrum("hat", t, 0.1, 0.32);
          break;
        case "big_room":
          for (let b = 0; b < 4; b++) addDrum("kick", b, 0.32, 0.9);
          addDrum("snare", 1, 0.25, 0.55); addDrum("snare", 3, 0.25, 0.55);
          for (const t of [0.5, 1.5, 2.5]) addDrum("hat", t, 0.1, 0.35);
          addDrum("hat", 3.5, 0.45, 0.4);
          break;
        case "blues_shuffle":
          addDrum("kick", 0, 0.3, 0.7); addDrum("kick", 2, 0.3, 0.55);
          addDrum("snare", 1, 0.25, 0.45); addDrum("snare", 3, 0.25, 0.45);
          for (const t of TRIPLET_HATS) addDrum("hat", t, 0.1, 0.26);
          break;
        case "blues_slow":
          addDrum("kick", 0, 0.3, 0.65); addDrum("snare", 2, 0.25, 0.4);
          for (const t of TRIPLET_HATS) addDrum("hat", t, 0.1, 0.22);
          break;
        case "blues_stomp":
          for (const b of [0, 1, 2, 3]) addDrum("kick", b, 0.3, 0.85);
          addDrum("snare", 1, 0.25, 0.5); addDrum("snare", 3, 0.25, 0.55);
          break;
        case "jazz_swing":
          for (const t of TRIPLET_HATS) addDrum("hat", t, 0.12, 0.3); // ride
          addDrum("snare", 1, 0.15, 0.22); addDrum("snare", 3, 0.15, 0.25); // ghost
          addDrum("kick", 0, 0.2, 0.25); addDrum("kick", 2, 0.2, 0.22); // feather
          break;
        case "jazz_ballad":
          for (let b = 0; b < 4; b++) addDrum("hat", b, 0.12, 0.25);
          addDrum("snare", 1, 0.2, 0.3); addDrum("snare", 3, 0.2, 0.3);
          break;
        case "synth_gate":
          addDrum("kick", 0, 0.3, 0.8); addDrum("kick", 2, 0.3, 0.7);
          addDrum("snare", 1, 0.3, 0.6); addDrum("snare", 3, 0.3, 0.6);
          for (let e = 0; e < 8; e++) addDrum("hat", e * 0.5, 0.1, 0.3);
          break;
        case "synth_break":
          addDrum("kick", 0, 0.3, 0.75);
          addDrum("snare", 3, 0.3, 0.5);
          for (let e = 0; e < 4; e++) addDrum("hat", e * 0.5, 0.1, 0.28);
          break;
        case "taiko_light":
          addDrum("kick", 0, 0.8, 0.8); addDrum("kick", 2.5, 0.8, 0.6);
          break;
        case "cine_pulse":
          addDrum("kick", 0, 0.6, 0.7); addDrum("kick", 2, 0.5, 0.45);
          break;
        case "cine_impact":
          addDrum("kick", 0, 0.7, 0.95); addDrum("kick", 3.5, 0.5, 0.6);
          addDrum("snare", 3, 0.25, 0.35);
          break;
        // none_ambient / none_quiet：无鼓
      }
    }

    // ── 段落级氛围层 ──────────────────────────────────────────
    if (sec.layers.includes("vinyl")) {
      events.push({ instrument: "vinyl", time: secStart, dur: secBeats, vel: 0.4 + spec.mix.lofiCharacter * 0.4 });
    }
    if (sec.layers.includes("riser") && sec.bars >= 4) {
      events.push({ instrument: "riser", time: secStart + secBeats - 4, dur: 3.9, vel: 0.45 });
    }

    barOffset += secBeats;
  }

  return {
    bpm: spec.tempo,
    style: spec.style,
    totalBeats: barOffset,
    events: events.sort((a, b) => a.time - b.time),
    sidechain: spec.mix.sidechain,
    lofi: spec.mix.lofiCharacter,
    reverb: spec.mix.reverb,
  };
}
