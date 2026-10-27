import { useState } from "react";
import { MarkOnboarded } from "../../wailsjs/go/main/App";

/** 首启动引导：说明产品 + 引导填 Key（可跳过离线体验）。 */
export function Onboarding({ onDone, onOpenSettings }: { onDone: () => void; onOpenSettings: () => void }) {
  const [busy, setBusy] = useState(false);

  async function finish(openSettings: boolean) {
    setBusy(true);
    await MarkOnboarded();
    onDone();
    if (openSettings) onOpenSettings();
  }

  return (
    <div className="onboarding-mask">
      <div className="onboarding card">
        <div className="onboarding-logo">🎵</div>
        <h1>Evolver Music</h1>
        <p className="onboarding-sub">把此刻的心情，谱成一段属于你的音乐</p>
        <ul className="onboarding-list">
          <li>输入几个词、一句话或一整段心情文字</li>
          <li>选择风格（Lo-Fi、蓝调、古风、EDM…）或交给 AI 自动判断</li>
          <li>生成、循环试听、导出 WAV/MP3，自动归档成心情日记</li>
        </ul>
        <div className="onboarding-actions">
          <button className="primary-btn" disabled={busy} onClick={() => finish(true)}>
            配置 AI（推荐）
          </button>
          <button className="ghost-btn" disabled={busy} onClick={() => finish(false)}>
            先离线体验
          </button>
        </div>
        <p className="onboarding-note">
          配置智谱免费 API Key 后由 GLM 作曲；不配置也能用内置离线引擎生成。
        </p>
      </div>
    </div>
  );
}
