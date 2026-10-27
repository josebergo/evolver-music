import { useMemo } from "react";
import { store } from "../../wailsjs/go/models";

type HistoryEntry = store.HistoryEntry;
import { MusicSpecSchema, STYLE_DEFS, type MusicSpec } from "../music/schema";

/** 历史即心情日记：按日期分组，卡片含心情色带与回放。 */
export function HistoryPanel({
  entries,
  currentId,
  playingId,
  onPlay,
  onFav,
  onDelete,
}: {
  entries: HistoryEntry[];
  currentId: string | null;
  playingId: string | null;
  onPlay: (id: string, spec: MusicSpec, entry: HistoryEntry) => void;
  onFav: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, HistoryEntry[]>();
    for (const e of entries) {
      const d = new Date(e.createdAt);
      const today = new Date();
      const yesterday = new Date(today.getTime() - 86400000);
      let label: string;
      if (sameDay(d, today)) label = "今天";
      else if (sameDay(d, yesterday)) label = "昨天";
      else label = `${d.getMonth() + 1}月${d.getDate()}日`;
      const list = map.get(label) ?? [];
      list.push(e);
      map.set(label, list);
    }
    return [...map.entries()];
  }, [entries]);

  if (entries.length === 0) {
    return <div className="history-empty">还没有生成记录——写下第一句心情吧 ✦</div>;
  }

  return (
    <div className="history">
      {groups.map(([label, list]) => (
        <div key={label} className="history-group">
          <div className="history-date">{label}</div>
          <div className="history-cards">
            {list.map((e) => {
              const spec = MusicSpecSchema.safeParse(e.spec as unknown);
              const mood = spec.success ? spec.data.mood : null;
              return (
                <div key={e.id} className={`history-card card ${currentId === e.id ? "current" : ""}`}>
                  <button
                    className={`history-play ${playingId === e.id ? "playing" : ""}`}
                    title="回放"
                    onClick={() => spec.success && onPlay(e.id, spec.data, e)}
                  >
                    ▶
                  </button>
                  <div className="history-info">
                    <div className="history-text">{e.text || "（未填写）"}</div>
                    <div className="history-meta">
                      <span>{spec.success ? STYLE_DEFS[spec.data.style].label : e.style}</span>
                      <span>{spec.success ? `${spec.data.tempo} BPM · ${spec.data.key}` : ""}</span>
                      <span className={`src ${e.source === "glm" ? "ai" : ""}`}>
                        {e.source === "glm" ? "AI" : "离线"}
                      </span>
                    </div>
                    {mood && (
                      <div className="history-mood" title={`愉悦${mood.valence.toFixed(2)} 能量${mood.energy.toFixed(2)} 张力${mood.tension.toFixed(2)} 温度${mood.warmth.toFixed(2)}`}>
                        <span style={{ width: `${mood.valence * 100}%` }} />
                        <span style={{ width: `${mood.energy * 100}%` }} />
                        <span style={{ width: `${mood.tension * 100}%` }} />
                        <span style={{ width: `${mood.warmth * 100}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="history-ops">
                    <button className={`fav ${e.favorite ? "on" : ""}`} title="收藏" onClick={() => onFav(e.id)}>
                      {e.favorite ? "★" : "☆"}
                    </button>
                    <button className="del" title="删除" onClick={() => onDelete(e.id)}>
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
