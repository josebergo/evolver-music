// 离线渲染与音频编码：AudioBuffer → WAV / MP3 字节流。
import * as Tone from "tone";
import { buildGraph, scheduleOnTransport } from "./engine";
import type { CompiledTrack } from "../music/compiler";

const BEAT_SEC = (bpm: number) => 60 / bpm;

/** 离线渲染整曲（含尾部混响余量），与实时播放同一套图与调度。 */
export async function renderOffline(track: CompiledTrack): Promise<AudioBuffer> {
  const duration = track.totalBeats * BEAT_SEC(track.bpm) + 2.5;
  const rendered = await Tone.Offline(async () => {
    const graph = await buildGraph(track, { live: false });
    const transport = Tone.getTransport();
    scheduleOnTransport(transport, track, graph);
    transport.start(0);
  }, duration);
  return rendered.get() as AudioBuffer;
}

/** AudioBuffer → 16bit PCM WAV。 */
export function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const numCh = Math.min(2, buffer.numberOfChannels);
  const len = buffer.length;
  const bytesPerSample = 2;
  const dataSize = len * numCh * bytesPerSample;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * numCh * bytesPerSample, true);
  view.setUint16(32, numCh * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const chans: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return out;
}

/** AudioBuffer → MP3（lamejs 纯 JS 编码）。 */
export async function encodeMp3(buffer: AudioBuffer, kbps = 160): Promise<Blob> {
  const lame = await import("@breezystack/lamejs");
  const numCh = Math.min(2, buffer.numberOfChannels);
  const enc = new lame.Mp3Encoder(numCh, buffer.sampleRate, kbps);
  const toInt16 = (f: Float32Array) => {
    const out = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const s = Math.max(-1, Math.min(1, f[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  };
  const left = toInt16(buffer.getChannelData(0));
  const right = numCh > 1 ? toInt16(buffer.getChannelData(1)) : null;
  const blockSize = 1152;
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < left.length; i += blockSize) {
    const l = left.subarray(i, i + blockSize);
    const r = right ? right.subarray(i, i + blockSize) : undefined;
    const buf = numCh > 1 && r ? enc.encodeBuffer(l, r) : enc.encodeBuffer(l);
    if (buf.length > 0) chunks.push(new Uint8Array(buf));
  }
  const end = enc.flush();
  if (end.length > 0) chunks.push(new Uint8Array(end));
  return new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
}

/** 渲染并编码，返回供 Go 保存对话框使用的字节。 */
export async function renderToBytes(track: CompiledTrack, format: "wav" | "mp3"): Promise<Uint8Array> {
  const buffer = await renderOffline(track);
  if (format === "mp3") {
    const blob = await encodeMp3(buffer);
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Uint8Array(encodeWav(buffer));
}
