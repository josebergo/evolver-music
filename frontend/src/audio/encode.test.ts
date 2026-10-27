import { describe, expect, it } from "vitest";
import { encodeWav } from "./render";

// 构造最小 AudioBuffer mock（浏览器环境外无 WebAudio）
function mockBuffer(channels: number, length: number, sampleRate = 44100): AudioBuffer {
  const data = channels === 1
    ? new Float32Array([0, 0.5, -0.5, 1])
    : [
        new Float32Array([0, 0.5, -0.5, 1]),
        new Float32Array([0, -0.5, 0.5, -1]),
      ];
  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    getChannelData: (c: number) => data[c] as Float32Array,
  } as unknown as AudioBuffer;
}

describe("encodeWav", () => {
  it("44 字节头 + 数据长度正确（立体声）", () => {
    const buf = encodeWav(mockBuffer(2, 4));
    expect(buf.byteLength).toBe(44 + 4 * 2 * 2);
    const v = new DataView(buf);
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe("RIFF");
    expect(String.fromCharCode(v.getUint8(8), v.getUint8(9), v.getUint8(10), v.getUint8(11))).toBe("WAVE");
    expect(v.getUint16(22, true)).toBe(2); // 双声道
    expect(v.getUint32(24, true)).toBe(44100); // 采样率
    expect(v.getUint16(34, true)).toBe(16); // 位深
  });

  it("样本值正确量化（1.0 → 0x7fff，-1 → 0x8000）", () => {
    const buf = encodeWav(mockBuffer(2, 4));
    const v = new DataView(buf);
    // 第 2 个样本左声道 0.5 → ~16384
    expect(v.getInt16(44 + 2 * 2, true)).toBeGreaterThan(16000);
    expect(v.getInt16(44 + 2 * 2, true)).toBeLessThan(16500);
    // 第 3 个样本左声道 -0.5
    expect(v.getInt16(44 + 4 * 2, true)).toBeLessThan(-16000);
  });

  it("单声道输出单声道头", () => {
    const buf = encodeWav(mockBuffer(1, 4));
    const v = new DataView(buf);
    expect(v.getUint16(22, true)).toBe(1);
    expect(buf.byteLength).toBe(44 + 4 * 2);
  });
});
