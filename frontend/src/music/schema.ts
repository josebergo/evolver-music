// 与 Go 侧 internal/schema/spec.go 双侧对齐的音乐规格定义。
// Go 是权威校验方（Repair 后必然合法）；此处 zod 做结构性防线。
import { z } from "zod";

export const MoodSchema = z.object({
  valence: z.number(),
  energy: z.number(),
  tension: z.number(),
  warmth: z.number(),
});

export const SectionSchema = z.object({
  name: z.enum(["intro", "verse", "chorus", "outro"]),
  bars: z.number().int(),
  energy: z.number(),
  chords: z.array(z.string()).min(1),
  bassPattern: z.string(),
  drumPattern: z.string(),
  layers: z.array(z.string()),
});

export const MixSchema = z.object({
  reverb: z.number(),
  sidechain: z.number(),
  lofiCharacter: z.number(),
});

export const MusicSpecSchema = z.object({
  mood: MoodSchema,
  style: z.enum(["lofi", "edm", "blues", "ambient", "piano", "jazz", "guofeng", "synthwave", "cinematic"]),
  tempo: z.number().int(),
  key: z.string(),
  seed: z.number(),
  sections: z.array(SectionSchema).min(1),
  mix: MixSchema,
});

export type Mood = z.infer<typeof MoodSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type Mix = z.infer<typeof MixSchema>;
export type MusicSpec = z.infer<typeof MusicSpecSchema>;

// 风格约束模板（镜像 Go 侧 Styles，仅渲染端使用）。
export const STYLE_DEFS = {
  lofi: { label: "Lo-Fi Chill", tempoRange: [65, 100] as const },
  edm: { label: "DJ/EDM", tempoRange: [118, 140] as const },
  blues: { label: "蓝调 Blues", tempoRange: [58, 96] as const },
  ambient: { label: "氛围 Ambient", tempoRange: [52, 76] as const },
  piano: { label: "钢琴独奏", tempoRange: [60, 104] as const },
  jazz: { label: "爵士 Jazz", tempoRange: [92, 148] as const },
  guofeng: { label: "古风", tempoRange: [62, 92] as const },
  synthwave: { label: "Synthwave", tempoRange: [84, 118] as const },
  cinematic: { label: "电影感", tempoRange: [56, 100] as const },
} as const;

export type StyleId = keyof typeof STYLE_DEFS;

// 和弦质量 → 相对根音的半音间隔。
const QUALITY_INTERVALS: Record<string, number[]> = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  "7": [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
};

const NOTE_PC: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
  "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

export interface Chord {
  /** 根音 pitch class 0~11 */
  pc: number;
  /** 和弦内音（相对根音的半音偏移） */
  intervals: number[];
  symbol: string;
}

/** 解析和弦符号：Bm7 → {pc:11, intervals:[0,3,7,10]}。非法返回 null。 */
export function parseChord(symbol: string): Chord | null {
  const s = symbol.trim();
  if (!s) return null;
  let split = 1;
  if (s.length > 1 && (s[1] === "#" || s[1] === "b")) split = 2;
  const rootName = s.slice(0, split);
  const quality = s.slice(split);
  const pc = NOTE_PC[rootName];
  const intervals = QUALITY_INTERVALS[quality];
  if (pc === undefined || !intervals) return null;
  return { pc, intervals, symbol: s };
}

export interface KeyInfo {
  /** 主音 pitch class */
  pc: number;
  minor: boolean;
  /** 自然音阶相对主音的半音偏移 */
  scale: number[];
}

/** 解析调号：F#m → {pc:6, minor:true, scale:小调音阶}。非法返回 null。 */
export function parseKey(key: string): KeyInfo | null {
  const s = key.trim();
  if (!s) return null;
  const minor = s.endsWith("m");
  const rootName = minor ? s.slice(0, -1) : s;
  const pc = NOTE_PC[rootName];
  if (pc === undefined) return null;
  return {
    pc,
    minor,
    scale: minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11],
  };
}

/** pitch class → 音名（与 Go 侧 pitchClassNames 一致）。 */
export const PC_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

/** MIDI 音符频率名（Tone.js 用）。 */
export function midiToNote(midi: number): string {
  const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}
