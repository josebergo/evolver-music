// Tone.js 渲染引擎：把 CompiledTrack 变成声音。
// 图构建与调度抽成纯函数，实时播放（AudioContext）与离线导出（OfflineAudioContext）共用同一实现。
import * as Tone from "tone";
import { Soundfont } from "smplr";
import type { CompiledTrack, InstrumentId, NoteEvent } from "../music/compiler";
import { midiToNote } from "../music/schema";

const BEAT_SEC = (bpm: number) => 60 / bpm;

/** 引擎实际会用到的 SoundFont 乐器（MusyngKite mp3 子集，随应用打包）。 */
const SOUNDFONTS: Partial<Record<InstrumentId, string>> = {
  piano: "acoustic_grand_piano",
  strings: "string_ensemble_1",
  guzheng: "koto",
  organ: "percussive_organ",
  bass: "acoustic_bass", // 仅原声风格启用（见 bassVoice）
};

type SfInstance = ReturnType<typeof Soundfont>;

/** 每上下文一份 SoundFont 缓存（离线渲染用独立上下文，不与实时共享）。 */
const sfCache = new Map<BaseAudioContext, Map<string, SfInstance | null>>();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

async function loadSoundfont(name: string, ctx: BaseAudioContext): Promise<SfInstance | null> {
  let perCtx = sfCache.get(ctx);
  if (!perCtx) {
    perCtx = new Map();
    sfCache.set(ctx, perCtx);
  }
  if (perCtx.has(name)) return perCtx.get(name) ?? null;
  try {
    const inst = Soundfont(ctx, {
      instrumentUrl: `/soundfonts/${name}-mp3.js`,
    });
    await withTimeout(inst.ready, 12000);
    perCtx.set(name, inst);
    return inst;
  } catch {
    perCtx.set(name, null); // 失败记住，避免反复尝试
    return null;
  }
}

/** 统一声部接口：触发一次（和弦/单音/打击乐均适用）。 */
interface Voice {
  trigger(midis: number[], durSec: number, when: number, vel: number): void;
}

/** SoundFont 声部（通过原生 gain 接入 Tone 图）。 */
class SoundfontVoice implements Voice {
  constructor(
    private inst: SfInstance,
    private gain: GainNode,
  ) {}
  trigger(midis: number[], durSec: number, when: number, vel: number) {
    for (const m of midis) {
      this.inst.start({ note: midiToNote(m), time: when, duration: durSec, velocity: Math.max(0.05, vel) });
    }
  }
  get output(): GainNode {
    return this.gain;
  }
}

/** 一次完整渲染图的全部节点与声部。 */
export interface TrackGraph {
  voices: Map<InstrumentId, Voice>;
  duckBus: Tone.Gain; // 和声类声部总线（侧链作用对象）
  vinyl: Tone.Noise | null;
  analyser: Tone.Analyser | null; // 主输出频谱（仅实时图）
  dispose(): void;
}

/** 构建渲染图。在 Tone.Offline 回调内调用时自动绑定离线上下文。 */
export async function buildGraph(track: CompiledTrack, opts: { live?: boolean } = {}): Promise<TrackGraph> {
  const style = track.style;
  const disposables: (Tone.ToneAudioNode | Tone.Noise)[] = [];
  const keep = <T extends Tone.ToneAudioNode | Tone.Noise>(n: T): T => {
    disposables.push(n);
    return n;
  };

  const master = keep(new Tone.Limiter(-1)).toDestination();
  let out: Tone.ToneAudioNode = keep(new Tone.Volume(-4)).connect(master);
  if (track.lofi > 0.05) {
    out = keep(new Tone.Filter(12000 - track.lofi * 7000, "lowpass")).connect(out);
  }

  // 算法混响（Freeverb 无需 IR 生成，实时/离线一致）
  const reverb = keep(new Tone.Freeverb({ roomSize: 0.82, dampening: style === "edm" ? 2200 : 3400 }));
  reverb.wet.value = track.reverb * 0.5;
  reverb.connect(out);

  const duckBus = keep(new Tone.Gain(1));
  duckBus.connect(out);
  duckBus.connect(reverb);

  const ctx = Tone.getContext().rawContext as BaseAudioContext;

  const voices = new Map<InstrumentId, Voice>();
  const usedInstruments = new Set(track.events.map((e) => e.instrument));

  const poly = (synth: Tone.PolySynth, dest: Tone.ToneAudioNode, toReverb = false) => {
    synth.connect(dest);
    if (toReverb) synth.connect(reverb);
    return { trigger: (m: number[], d: number, w: number, v: number) => synth.triggerAttackRelease(m.map(midiToNote), d, w, v) };
  };

  const ensureVoice = async (id: InstrumentId): Promise<Voice> => {
    const existing = voices.get(id);
    if (existing) return existing;
    let voice: Voice;

    // ── 可用 SoundFont 的乐器 ────────────────────────────────
    const sfName = SOUNDFONTS[id];
    if (sfName && !(id === "bass" && (style === "edm" || style === "synthwave"))) {
      const inst = await loadSoundfont(sfName, ctx);
      if (inst) {
        const gain = ctx.createGain();
        const db = id === "piano" ? 0.9 : id === "organ" ? 0.8 : id === "bass" ? 1.2 : 0.85;
        gain.gain.value = db;
        Tone.connect(gain, duckBus as unknown as AudioNode);
        voice = new SoundfontVoice(inst, gain);
        voices.set(id, voice);
        return voice;
      }
    }

    // ── 合成器兜底 ──────────────────────────────────────────
    switch (id) {
      case "epiano":
        voice = poly(keep(new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 3.01,
          modulationIndex: style === "jazz" ? 8 : 6,
          envelope: { attack: 0.02, decay: 1.2, sustain: 0.35, release: 1.4 },
          volume: -13,
        })), duckBus);
        break;
      case "supersaw":
        voice = poly(keep(new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "fatsawtooth", count: 3, spread: 26 },
          envelope: { attack: 0.015, decay: 0.22, sustain: 0.75, release: 0.25 },
          volume: -17,
        })), duckBus);
        break;
      case "organ":
        voice = poly(keep(new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "custom", partials: [1, 0.5, 0.25, 0.125, 0.0625] },
          envelope: { attack: 0.01, decay: 0.2, sustain: 0.9, release: 0.3 },
          volume: -15,
        })), duckBus);
        break;
      case "piano":
        voice = poly(keep(new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "triangle" },
          envelope: { attack: 0.003, decay: 1.4, sustain: 0.16, release: 1.8 },
          volume: -10,
        })), duckBus, true);
        break;
      case "strings":
        voice = poly(keep(new Tone.PolySynth(Tone.AMSynth, {
          envelope: { attack: 0.7, decay: 0.5, sustain: 0.85, release: 2.4 },
          volume: -17,
        })), duckBus, true);
        break;
      case "guzheng":
        voice = {
          trigger: (m, d, w, v) => {
            const p = keep0Pluck();
            p.triggerAttack(midiToNote(m[0]), w);
          },
        };
        break;
      case "dizi":
      case "melody": {
        const osc: Tone.ToneOscillatorType =
          style === "edm" || style === "synthwave" ? "sawtooth"
          : style === "blues" ? "square"
          : style === "ambient" || style === "cinematic" ? "sine"
          : "triangle";
        const synth = keep(new Tone.Synth({
          oscillator: { type: osc },
          envelope: { attack: 0.015, decay: 0.25, sustain: 0.4, release: 0.6 },
          volume: -12,
        }));
        if (id === "dizi" || style === "blues") {
          // 竹笛/口琴式颤音
          const vib = keep(new Tone.Vibrato({ frequency: 5.2, depth: 0.12 }));
          synth.chain(vib, duckBus);
        } else {
          synth.connect(duckBus);
        }
        synth.connect(reverb);
        voice = { trigger: (m, d, w, v) => synth.triggerAttackRelease(midiToNote(m[0]), d, w, v) };
        break;
      }
      case "pluck": {
        const p = keep(new Tone.PluckSynth({ attackNoise: 0.8, dampening: 3600, resonance: 0.92, volume: -14 }));
        p.connect(duckBus);
        voice = { trigger: (m, _d, w) => p.triggerAttack(midiToNote(m[0]), w) };
        break;
      }
      case "bass": {
        const oscType = style === "edm" || style === "synthwave" ? "sawtooth"
          : style === "ambient" || style === "cinematic" || style === "guofeng" ? "sine" : "triangle";
        const synth = keep(new Tone.MonoSynth({
          oscillator: { type: oscType },
          filter: { type: "lowpass", Q: 2 },
          filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.4, baseFrequency: style === "edm" ? 520 : 320 },
          envelope: { attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.3 },
          volume: -8,
        }));
        synth.connect(out);
        voice = { trigger: (m, d, w, v) => synth.triggerAttackRelease(midiToNote(m[0]), d, w, v) };
        break;
      }
      case "kick":
        voice = (() => {
          const k = keep(new Tone.MembraneSynth({
            pitchDecay: 0.045, octaves: 7,
            envelope: { attack: 0.001, decay: 0.42, sustain: 0.01, release: 0.8 },
            volume: -6,
          }));
          k.connect(out);
          return {
            trigger: (_m, d, w, v) => {
              k.triggerAttackRelease("C1", Math.max(0.2, d), w, v);
              duckAt(w, track.sidechain);
            },
          };
        })();
        break;
      case "snare":
        voice = (() => {
          const s = keep(new Tone.NoiseSynth({
            noise: { type: "white" },
            envelope: { attack: 0.001, decay: 0.22, sustain: 0 },
            volume: -14,
          }));
          s.connect(out);
          s.connect(reverb);
          return { trigger: (_m, d, w, v) => s.triggerAttackRelease(d, w, v) };
        })();
        break;
      case "hat":
        voice = (() => {
          const h = keep(new Tone.MetalSynth({
            envelope: { attack: 0.001, decay: 0.05, release: 0.02 },
            harmonicity: 5.1, modulationIndex: 32, resonance: 6000, octaves: 1.5,
            volume: -26,
          }));
          h.connect(out);
          return { trigger: (_m, d, w, v) => h.triggerAttackRelease(d, w, Math.min(1, v * 1.6)) };
        })();
        break;
      case "riser":
        voice = (() => {
          const r = keep(new Tone.NoiseSynth({
            noise: { type: "pink" },
            envelope: { attack: 3.0, decay: 0.4, sustain: 1, release: 0.5 },
            volume: -20,
          }));
          r.connect(out);
          r.connect(reverb);
          return { trigger: (_m, d, w, v) => r.triggerAttackRelease(d, w, v) };
        })();
        break;
      default:
        voice = { trigger: () => undefined };
    }
    voices.set(id, voice);
    return voice;
  };

  // guzheng 兜底单例（PluckSynth）
  let pluckSynth: Tone.PluckSynth | null = null;
  const keep0Pluck = (): Tone.PluckSynth => {
    if (!pluckSynth) {
      pluckSynth = keep(new Tone.PluckSynth({ attackNoise: 1.2, dampening: 2600, resonance: 0.9, volume: -12 }));
      pluckSynth.connect(duckBus);
      pluckSynth.connect(reverb);
    }
    return pluckSynth;
  };

  /** 侧链：底鼓落下时压低和声总线。 */
  function duckAt(when: number, amount: number) {
    if (amount <= 0.03) return;
    const g = duckBus.gain;
    g.cancelScheduledValues(when);
    g.setValueAtTime(1 - 0.65 * amount, when);
    g.linearRampToValueAtTime(1, when + 0.22);
  }

  // 预加载本曲用到的全部声部（含 SoundFont 尝试）
  await Promise.all([...usedInstruments].map((id) => ensureVoice(id)));

  // 黑胶底噪
  let vinyl: Tone.Noise | null = null;
  if (usedInstruments.has("vinyl")) {
    vinyl = new Tone.Noise("pink");
    const vinylFilter = keep(new Tone.Filter(4000, "highpass"));
    const vinylVol = keep(new Tone.Volume(-46));
    vinyl.chain(vinylFilter, vinylVol, out);
  }

  // 主频谱分析（仅实时）
  let analyser: Tone.Analyser | null = null;
  if (opts.live) {
    analyser = keep(new Tone.Analyser("fft", 64));
    (out as Tone.ToneAudioNode).connect(analyser);
  }

  return {
    voices, duckBus, vinyl, analyser,
    dispose: () => {
      vinyl?.stop();
      for (const d of disposables) {
        try { d.dispose(); } catch { /* 已释放 */ }
      }
    },
  };
}

/** 把曲目调度到给定 Transport（实时与离线共用）。 */
export function scheduleOnTransport(
  transport: ReturnType<typeof Tone.getTransport>,
  track: CompiledTrack,
  graph: TrackGraph,
) {
  const bs = BEAT_SEC(track.bpm);
  const byTime = new Map<number, NoteEvent[]>();
  for (const ev of track.events) {
    const list = byTime.get(ev.time) ?? [];
    list.push(ev);
    byTime.set(ev.time, list);
  }
  for (const [beats, evs] of byTime) {
    transport.schedule((when: number) => {
      for (const ev of evs) fire(graph, ev, when, bs);
    }, beats * bs);
  }
}

function fire(graph: TrackGraph, ev: NoteEvent, when: number, bs: number) {
  if (ev.instrument === "vinyl") {
    if (graph.vinyl) {
      graph.vinyl.start(when);
      graph.vinyl.stop(when + ev.dur * bs + bs);
    }
    return;
  }
  const voice = graph.voices.get(ev.instrument);
  if (!voice) return;
  voice.trigger(ev.midi ?? [], Math.max(0.05, ev.dur * bs), when, ev.vel);
}

/** 实时播放器。 */
export class MusicEngine {
  private track: CompiledTrack | null = null;
  private graph: TrackGraph | null = null;
  playing = false;

  get durationSec(): number {
    return this.track ? this.track.totalBeats * BEAT_SEC(this.track.bpm) : 0;
  }

  get positionSec(): number {
    if (!this.track) return 0;
    return Math.max(0, Math.min(this.durationSec, Tone.getTransport().seconds));
  }

  get spectrum(): Float32Array | null {
    return this.graph?.analyser?.getValue() as Float32Array | null;
  }

  async load(track: CompiledTrack) {
    await this.stop();
    await Tone.getContext().resume();
    this.track = track;
    this.graph = await buildGraph(track, { live: true });
    scheduleOnTransport(Tone.getTransport(), track, this.graph);
  }

  async play() {
    if (!this.track) return;
    await Tone.getContext().resume();
    const transport = Tone.getTransport();
    transport.bpm.value = this.track.bpm;
    transport.loopStart = 0;
    transport.loopEnd = this.durationSec;
    transport.loop = true;
    await transport.start();
    this.playing = true;
  }

  async stop() {
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel();
    transport.position = 0;
    this.playing = false;
    this.graph?.dispose();
    this.graph = null;
  }
}

export const engine = new MusicEngine();
