import { useCallback, useEffect, useRef, useState } from "react";
import {
  Compose, ExportAudio, GetSettings, HistoryDelete, HistoryList,
  HistoryToggleFavorite, SaveHistoryEntry, SaveSettings,
} from "../wailsjs/go/main/App";
import { store } from "../wailsjs/go/models";

type HistoryEntry = store.HistoryEntry;
type WailsSettings = store.Settings;
import { MusicSpecSchema, STYLE_DEFS, type MusicSpec } from "./music/schema";
import { compile, type CompiledTrack } from "./music/compiler";
import { engine } from "./audio/engine";
import { renderToBytes } from "./audio/render";
import { bytesToBase64 } from "./audio/base64";
import { Spectrum } from "./ui/Spectrum";
import { Onboarding } from "./ui/Onboarding";
import { HistoryPanel } from "./ui/HistoryPanel";
import "./App.css";

const STYLE_OPTIONS = [
  { id: "auto", label: "自动 · AI 判断" },
  { id: "lofi", label: "Lo-Fi" },
  { id: "edm", label: "DJ/EDM" },
  { id: "blues", label: "蓝调" },
  { id: "jazz", label: "爵士" },
  { id: "piano", label: "钢琴" },
  { id: "ambient", label: "氛围" },
  { id: "guofeng", label: "古风" },
  { id: "synthwave", label: "Synthwave" },
  { id: "cinematic", label: "电影感" },
];

const DURATION_OPTIONS = [30, 60, 90, 120];
const MOOD_DIMS = [
  { key: "valence", label: "愉悦" },
  { key: "energy", label: "能量" },
  { key: "tension", label: "张力" },
  { key: "warmth", label: "温度" },
] as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 客户端参数微调：能量偏置 + 速度缩放（收敛在风格区间内）。 */
function applyTweaks(spec: MusicSpec, energyBias: number, tempoScale: number): MusicSpec {
  const range = STYLE_DEFS[spec.style].tempoRange;
  const tempo = Math.round(Math.min(range[1], Math.max(range[0], spec.tempo * tempoScale)));
  return {
    ...spec,
    tempo,
    mood: { ...spec.mood, energy: clamp01(spec.mood.energy + energyBias) },
    sections: spec.sections.map((s) => ({ ...s, energy: clamp01(s.energy + energyBias) })),
  };
}

function fmtTime(sec: number): string {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function App() {
  const [text, setText] = useState("");
  const [style, setStyle] = useState("auto");
  const [duration, setDuration] = useState(60);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [source, setSource] = useState("");
  const [spec, setSpec] = useState<MusicSpec | null>(null);
  const [track, setTrack] = useState<CompiledTrack | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [energyBias, setEnergyBias] = useState(0);
  const [tempoScale, setTempoScale] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<WailsSettings>(store.Settings.createFrom({}));
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [onboarded, setOnboarded] = useState(true);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);
  const [playingHistoryId, setPlayingHistoryId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"wav" | "mp3" | null>(null);
  const posTimer = useRef<number | null>(null);

  const refreshHistory = useCallback(() => {
    HistoryList().then((l) => setHistory(l ?? []));
  }, []);

  useEffect(() => {
    GetSettings().then((s) => {
      setSettings(s);
      setOnboarded(s.firstRunDone);
    });
    refreshHistory();
    return () => { void engine.stop(); };
  }, [refreshHistory]);

  useEffect(() => {
    if (playing) {
      posTimer.current = window.setInterval(() => {
        setPos(engine.positionSec);
        if (!engine.playing) setPlaying(false);
      }, 200);
    } else if (posTimer.current) {
      window.clearInterval(posTimer.current);
      posTimer.current = null;
      setPos(0);
    }
    return () => {
      if (posTimer.current) window.clearInterval(posTimer.current);
    };
  }, [playing]);

  /** 编译 + （可选）自动播放。 */
  const buildAndPlay = useCallback(async (s: MusicSpec, autoplay: boolean) => {
    const compiled = compile(s);
    setSpec(s);
    setTrack(compiled);
    await engine.load(compiled);
    if (autoplay) {
      await engine.play();
      setPlaying(true);
    }
  }, []);

  async function generate() {
    const t = text.trim();
    if (!t || generating) return;
    setGenerating(true);
    setError("");
    setNotice("");
    setSource("");
    try {
      await engine.stop();
      setPlaying(false);
      const resp = await Compose({ text: t, style, durationSec: duration });
      const parsed = MusicSpecSchema.safeParse(resp.spec);
      if (!parsed.success) {
        setError("收到的音乐规格不合法，请再试一次");
        return;
      }
      setSource(resp.source);
      setNotice(resp.notice || "");
      setEnergyBias(0);
      setTempoScale(1);
      const id = await SaveHistoryEntry({
        text: t, style: parsed.data.style, durationSec: duration,
        spec: parsed.data as unknown as never, source: resp.source,
      });
      setCurrentHistoryId(id || null);
      setPlayingHistoryId(id || null);
      refreshHistory();
      await buildAndPlay(parsed.data, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e) || "生成失败，请重试");
    } finally {
      setGenerating(false);
    }
  }

  /** 换个旋律：只换种子，和弦与结构保持不变。 */
  async function reseedMelody() {
    if (!spec) return;
    const next = { ...spec, seed: (Date.now() & 0xffffff) ^ spec.seed };
    setError("");
    await engine.stop();
    setPlaying(false);
    await buildAndPlay(next, true);
  }

  /** 滑杆变更：重建当前曲目（不打断提示状态）。 */
  useEffect(() => {
    if (!spec || generating) return;
    const timer = window.setTimeout(() => {
      const tweaked = applyTweaks(spec, energyBias, tempoScale);
      void (async () => {
        const wasPlaying = playing;
        await engine.stop();
        setPlaying(false);
        await buildAndPlay(tweaked, wasPlaying);
      })();
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [energyBias, tempoScale]);

  async function togglePlay() {
    if (!track) return;
    if (playing) {
      await engine.stop();
      setPlaying(false);
      setPlayingHistoryId(null);
    } else {
      await engine.load(track);
      await engine.play();
      setPlaying(true);
    }
  }

  async function exportAudio(fmt: "wav" | "mp3") {
    if (!track || exporting) return;
    setExporting(fmt);
    setError("");
    try {
      const bytes = await renderToBytes(track, fmt);
      const name = `evolver-${track.style}-${track.bpm}bpm.${fmt}`;
      const err = await ExportAudio(bytesToBase64(bytes), name);
      if (err && err !== "已取消") setError(`导出失败：${err}`);
    } catch (e) {
      setError(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(null);
    }
  }

  async function saveSettings() {
    const err = await SaveSettings(settings);
    if (err) setError(err);
    else {
      setSettingsSaved(true);
      window.setTimeout(() => setSettingsSaved(false), 1500);
    }
  }

  const onHistoryPlay = useCallback(async (id: string, entrySpec: MusicSpec) => {
    setError("");
    setNotice("");
    setSource("");
    await engine.stop();
    setPlaying(false);
    setCurrentHistoryId(id);
    setPlayingHistoryId(id);
    setEnergyBias(0);
    setTempoScale(1);
    await buildAndPlay(entrySpec, true);
  }, [buildAndPlay]);

  const onHistoryFav = useCallback(async (id: string) => {
    await HistoryToggleFavorite(id);
    refreshHistory();
  }, [refreshHistory]);

  const onHistoryDelete = useCallback(async (id: string) => {
    await HistoryDelete(id);
    if (currentHistoryId === id) setCurrentHistoryId(null);
    refreshHistory();
  }, [refreshHistory, currentHistoryId]);

  const durationSec = track ? (track.totalBeats * 60) / track.bpm : 0;
  const verseChords = spec?.sections.find((s) => s.name === "verse")?.chords ?? [];

  return (
    <div className="app">
      {!onboarded && (
        <Onboarding
          onDone={() => setOnboarded(true)}
          onOpenSettings={() => setShowSettings(true)}
        />
      )}

      <header className="header">
        <div className="brand">
          <span className="brand-dot" />
          Evolver Music
        </div>
        <button className="ghost-btn" onClick={() => setShowSettings((v) => !v)}>
          设置{settings.apiKey ? "" : " · 未配置AI"}
        </button>
      </header>

      {showSettings && (
        <div className="settings card">
          <div className="settings-hint">
            填入智谱开放平台免费 API Key 后由 AI 作曲，留空则始终使用离线引擎。
            在 <a href="https://bigmodel.cn" target="_blank" rel="noreferrer">bigmodel.cn</a> 注册后于控制台创建（免费）。
          </div>
          <div className="settings-grid">
            <label>
              API Key
              <input
                type="password"
                value={settings.apiKey}
                placeholder="在 bigmodel.cn 控制台创建"
                onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
              />
            </label>
            <label>
              接口地址
              <input
                value={settings.baseUrl}
                placeholder="https://open.bigmodel.cn/api/paas/v4"
                onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })}
              />
            </label>
            <label>
              模型
              <input
                value={settings.model}
                placeholder="glm-4-flash"
                onChange={(e) => setSettings({ ...settings, model: e.target.value })}
              />
            </label>
          </div>
          <button className="primary-btn small" onClick={saveSettings} disabled={!settings.baseUrl || !settings.model}>
            {settingsSaved ? "已保存 ✓" : "保存设置"}
          </button>
        </div>
      )}

      <section className="input card">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="现在的心情是…（几个词、一句话，或一整段文字都行）"
          rows={4}
        />
        <div className="controls">
          <div className="pill-group wrap">
            {STYLE_OPTIONS.map((o) => (
              <button key={o.id} className={`pill ${style === o.id ? "active" : ""}`} onClick={() => setStyle(o.id)}>
                {o.label}
              </button>
            ))}
          </div>
          <div className="pill-group">
            {DURATION_OPTIONS.map((d) => (
              <button key={d} className={`pill ${duration === d ? "active" : ""}`} onClick={() => setDuration(d)}>
                {d >= 60 ? `${d / 60} 分钟` : `${d} 秒`}
              </button>
            ))}
          </div>
          <button className="primary-btn" onClick={generate} disabled={!text.trim() || generating}>
            {generating ? "生成中…" : "✦ 生成音乐"}
          </button>
        </div>
      </section>

      {error && <div className="error">⚠ {error}</div>}
      {notice && !error && <div className="notice">ℹ {notice}</div>}

      {spec && track && (
        <section className="player card">
          <div className="player-top">
            <button className={`play-btn ${playing ? "playing" : ""}`} onClick={togglePlay} disabled={generating}>
              {playing ? "⏸" : "▶"}
            </button>
            <div className="progress-wrap">
              <div className="progress">
                <div className="progress-fill" style={{ width: `${durationSec ? (pos / durationSec) * 100 : 0}%` }} />
              </div>
              <div className="time">{fmtTime(pos)} / {fmtTime(durationSec)} · 循环播放</div>
            </div>
            <div className="badges">
              <span className="badge">{STYLE_DEFS[spec.style].label}</span>
              <span className="badge">{spec.tempo} BPM</span>
              <span className="badge">{spec.key}</span>
              <span className={`badge ${source === "glm" ? "ai" : "offline"}`}>
                {source === "glm" ? "AI 作曲" : "离线引擎"}
              </span>
            </div>
          </div>

          {playing && <Spectrum active={playing} getData={() => engine.spectrum} />}

          <div className="mood-grid">
            {MOOD_DIMS.map((d) => (
              <div key={d.key} className="mood-row">
                <span className="mood-label">{d.label}</span>
                <div className="mood-bar">
                  <div className="mood-fill" style={{ width: `${spec.mood[d.key] * 100}%` }} />
                </div>
                <span className="mood-val">{spec.mood[d.key].toFixed(2)}</span>
              </div>
            ))}
          </div>

          {verseChords.length > 0 && (
            <div className="chords">
              {verseChords.slice(0, 8).map((c, i) => (
                <span key={i} className="chord">{c}</span>
              ))}
            </div>
          )}

          <div className="tweak-row">
            <label className="slider">
              <span>能量 {energyBias >= 0 ? "+" : ""}{(energyBias * 100).toFixed(0)}%</span>
              <input
                type="range" min={-0.25} max={0.25} step={0.05}
                value={energyBias}
                onChange={(e) => setEnergyBias(Number(e.target.value))}
              />
            </label>
            <label className="slider">
              <span>速度 ×{tempoScale.toFixed(2)}</span>
              <input
                type="range" min={0.85} max={1.15} step={0.01}
                value={tempoScale}
                onChange={(e) => setTempoScale(Number(e.target.value))}
              />
            </label>
          </div>

          <div className="player-actions">
            <button className="ghost-btn" onClick={reseedMelody} disabled={generating}>🎲 换个旋律</button>
            <button className="ghost-btn" onClick={() => exportAudio("wav")} disabled={!track || !!exporting}>
              {exporting === "wav" ? "渲染中…" : "导出 WAV"}
            </button>
            <button className="ghost-btn" onClick={() => exportAudio("mp3")} disabled={!track || !!exporting}>
              {exporting === "mp3" ? "编码中…" : "导出 MP3"}
            </button>
          </div>
        </section>
      )}

      <section className="history-section">
        <h2 className="section-title">心情日记</h2>
        <HistoryPanel
          entries={history}
          currentId={currentHistoryId}
          playingId={playingHistoryId}
          onPlay={(id, s) => void onHistoryPlay(id, s)}
          onFav={(id) => void onHistoryFav(id)}
          onDelete={(id) => void onHistoryDelete(id)}
        />
      </section>
    </div>
  );
}
