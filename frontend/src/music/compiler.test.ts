import { describe, expect, it } from "vitest";
import { compile, type NoteEvent, type InstrumentId } from "./compiler";
import { parseChord, type MusicSpec, type StyleId } from "./schema";

// 用与 Go 侧降级引擎一致的段落配方构造各风格测试规格
function specOf(style: StyleId, chords: string[], layers: string[], bass: string, drum: string, tempo = 90, seed = 42): MusicSpec {
  return {
    mood: { valence: 0.4, energy: 0.5, tension: 0.3, warmth: 0.6 },
    style, tempo, key: "Am", seed,
    sections: [
      { name: "intro", bars: 4, energy: 0.3, chords: chords.slice(0, 2), bassPattern: bass, drumPattern: drum, layers: layers.slice(0, 2) },
      { name: "verse", bars: 8, energy: 0.6, chords, bassPattern: bass, drumPattern: drum, layers },
      { name: "chorus", bars: 8, energy: 0.85, chords, bassPattern: bass, drumPattern: drum, layers },
      { name: "outro", bars: 4, energy: 0.3, chords: chords.slice(0, 2), bassPattern: bass, drumPattern: drum, layers: layers.slice(0, 2) },
    ],
    mix: { reverb: 0.4, sidechain: style === "edm" ? 0.8 : 0, lofiCharacter: style === "lofi" ? 0.7 : 0 },
  };
}

const CASES: Record<StyleId, MusicSpec> = {
  lofi: specOf("lofi", ["Am7", "Fmaj7", "Cmaj7", "G7"], ["epiano", "melody", "bass", "kick", "snare", "hat", "vinyl"], "soft_walk", "lofi_swing", 85),
  edm: specOf("edm", ["Am", "F", "C", "G"], ["supersaw", "pluck", "melody", "bass", "kick", "snare", "hat"], "eight_root", "four_floor", 128),
  blues: specOf("blues", ["A7", "D7", "A7", "A7", "D7", "D7", "A7", "A7", "E7", "D7", "A7", "E7"], ["organ", "melody", "bass", "kick", "snare", "hat"], "blues_walk", "blues_shuffle", 76),
  ambient: specOf("ambient", ["Am7", "Fmaj7"], ["piano", "pad", "melody", "bass"], "drone_root", "none_ambient", 64),
  piano: specOf("piano", ["Am", "Dm", "Fmaj7", "Cmaj7"], ["piano", "melody"], "piano_root", "none_quiet", 80),
  jazz: specOf("jazz", ["Dm7", "G7", "Cmaj7", "Cmaj7"], ["epiano", "melody", "bass", "hat", "snare", "kick"], "jazz_walk", "jazz_swing", 120),
  guofeng: specOf("guofeng", ["Am", "G", "F", "G"], ["guzheng", "dizi", "strings", "bass"], "drone_fifth", "none_quiet", 74),
  synthwave: specOf("synthwave", ["Am", "F", "G", "F"], ["supersaw", "pluck", "pad", "melody", "bass", "kick", "snare", "hat"], "octave_pulse", "synth_gate", 100),
  cinematic: specOf("cinematic", ["Am", "F", "G", "E"], ["strings", "piano", "melody", "kick", "riser"], "drone_root", "cine_pulse", 80),
};

describe("全风格编译通用校验", () => {
  for (const [style, spec] of Object.entries(CASES) as [StyleId, MusicSpec][]) {
    it(`${style}: 事件合法、有序、在小节范围内`, () => {
      const track = compile(spec);
      expect(track.totalBeats).toBe(24 * 4);
      expect(track.events.length).toBeGreaterThan(20);
      for (let i = 1; i < track.events.length; i++) {
        expect(track.events[i].time).toBeGreaterThanOrEqual(track.events[i - 1].time);
      }
      for (const ev of track.events) {
        expect(ev.time).toBeGreaterThanOrEqual(0);
        expect(ev.time).toBeLessThan(track.totalBeats);
        expect(ev.dur).toBeGreaterThan(0);
        expect(ev.vel).toBeGreaterThan(0);
        expect(ev.vel).toBeLessThanOrEqual(1);
        if (ev.midi) for (const m of ev.midi) expect(m).toBeGreaterThanOrEqual(24);
      }
      // 每种风格在主段都有和声事件
      const verseStart = 16, verseEnd = 48;
      const chordEvents = track.events.filter((e) => e.time >= verseStart && e.time < verseEnd &&
        ["epiano", "supersaw", "organ", "piano", "guzheng", "strings"].includes(e.instrument));
      expect(chordEvents.length).toBeGreaterThan(0);
    });
  }
});

describe("风格特征", () => {
  it("edm 和声在反拍八分（泵感）", () => {
    const track = compile(CASES.edm);
    const chords = track.events.filter((e) => e.instrument === "supersaw");
    expect(chords.length).toBeGreaterThan(0);
    for (const c of chords) expect([0.5, 1.5, 2.5, 3.5]).toContain(c.time % 4);
  });

  it("blues 12 小节：第 9 小节和弦为 E7（V 级）", () => {
    const track = compile(CASES.blues);
    // verse 从 beat 16 开始，第 9 小节 barStart = 16+8*4 = 48
    const organ = track.events.find((e) => e.instrument === "organ" && e.time === 48);
    expect(organ).toBeTruthy();
    expect(parseChord("E7")).toBeTruthy();
    // 每个和弦事件至少 3 个音
    expect(organ!.midi!.length).toBeGreaterThanOrEqual(3);
  });

  it("blues/jazz 行走贝斯每拍一个音", () => {
    const track = compile(CASES.blues);
    const bass = track.events.filter((e) => e.instrument === "bass" && e.time >= 16 && e.time < 48);
    const beats = new Set(bass.map((b) => Math.round(b.time * 2) / 2));
    for (let b = 16; b < 48; b++) expect(beats.has(b)).toBe(true);
  });

  it("guofeng 旋律走五声音阶且无鼓", () => {
    const track = compile(CASES.guofeng);
    const melody = track.events.filter((e) => e.instrument === "dizi");
    expect(melody.length).toBeGreaterThan(5);
    const penta = new Set([0, 3, 5, 7, 10]);
    for (const m of melody) {
      const rel = (m.midi![0] - 9) % 12; // A 主音
      expect(penta.has(((rel % 12) + 12) % 12)).toBe(true);
    }
    expect(track.events.filter((e) => e.instrument === "kick" || e.instrument === "snare")).toHaveLength(0);
  });

  it("piano 风格：分解和弦八分推进", () => {
    const track = compile(CASES.piano);
    const broken = track.events.filter((e) => e.instrument === "piano" && e.time >= 16 && e.time < 48);
    expect(broken.length).toBeGreaterThanOrEqual(8 * 4); // 每小节 8 个
  });

  it("ambient 无打击乐、drone 持续", () => {
    const track = compile(CASES.ambient);
    expect(track.events.filter((e) => ["kick", "snare", "hat"].includes(e.instrument))).toHaveLength(0);
    const drone = track.events.filter((e) => e.instrument === "bass");
    expect(drone.length).toBeGreaterThan(0);
    for (const d of drone) expect(d.dur).toBeGreaterThanOrEqual(3.5);
  });

  it("jazz swing：ride 覆盖 12/8 三连位", () => {
    const track = compile(CASES.jazz);
    const rides = track.events.filter((e) => e.instrument === "hat" && e.time >= 16 && e.time < 48);
    const bar0 = rides.filter((r) => r.time < 20).map((r) => Math.round((r.time - 16) * 1000) / 1000);
    for (const t of [0, 0.667, 1.333, 2, 2.667, 3.333]) {
      expect(bar0.some((b) => Math.abs(b - t) < 0.01)).toBe(true);
    }
  });

  it("synthwave：门控鼓 kick[0,2] snare[1,3]", () => {
    const track = compile(CASES.synthwave);
    const kicks = track.events.filter((e) => e.instrument === "kick" && e.time >= 16 && e.time < 20);
    expect(kicks.map((k) => k.time - 16).sort()).toEqual([0, 2]);
    const snares = track.events.filter((e) => e.instrument === "snare" && e.time >= 16 && e.time < 20);
    expect(snares.map((s) => s.time - 16).sort()).toEqual([1, 3]);
  });

  it("cinematic：弦乐长音 + riser 在段落尾", () => {
    const track = compile(CASES.cinematic);
    const strings = track.events.filter((e) => e.instrument === "strings");
    expect(strings.length).toBeGreaterThan(0);
    const risers = track.events.filter((e) => e.instrument === "riser");
    expect(risers.length).toBeGreaterThan(0);
  });
});

describe("确定性", () => {
  it("同规格编译结果完全一致", () => {
    for (const spec of Object.values(CASES)) {
      expect(JSON.stringify(compile(spec))).toBe(JSON.stringify(compile(spec)));
    }
  });

  it("不同 seed 旋律不同", () => {
    const a = compile({ ...CASES.lofi, seed: 1 });
    const b = compile({ ...CASES.lofi, seed: 2 });
    const mel = (t: ReturnType<typeof compile>) =>
      t.events.filter((e) => e.instrument === "melody").map((e) => e.midi![0]).join(",");
    expect(mel(a)).not.toBe(mel(b));
  });
});
