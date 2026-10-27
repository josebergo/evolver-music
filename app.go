package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"log"
	"os"
	"time"

	"evolver-music/internal/ai"
	"evolver-music/internal/schema"
	"evolver-music/internal/store"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App 应用主体，方法由 Wails 绑定给前端。
type App struct {
	ctx    context.Context
	fb     ai.Fallback
	saver  SettingsSaver
	loader SettingsLoader
}

// SettingsSaver/Loader 便于测试注入。
type SettingsSaver func(store.Settings) error
type SettingsLoader func() (store.Settings, error)

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{saver: store.Save, loader: store.Load}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// ComposeRequest 生成请求。
type ComposeRequest struct {
	Text        string `json:"text"`
	Style       string `json:"style"`       // auto | lofi | edm
	DurationSec int    `json:"durationSec"` // 30/60/90/120
}

// ComposeResponse 生成结果。
type ComposeResponse struct {
	Spec   *schema.MusicSpec `json:"spec"`
	Source string            `json:"source"` // glm | fallback
	Notice string            `json:"notice"` // 降级原因等提示（空 = 一切正常）
}

// Compose 心情文本 → 音乐规格。AI 失败自动降级本地引擎，永不返回错误。
func (a *App) Compose(req ComposeRequest) ComposeResponse {
	if req.DurationSec <= 0 {
		req.DurationSec = 60
	}
	if req.DurationSec > 300 {
		req.DurationSec = 300
	}

	input := ai.ComposeInput{
		Text:        req.Text,
		Style:       req.Style,
		DurationSec: req.DurationSec,
	}

	if s, err := a.loader(); err == nil && s.APIKey != "" {
		p := &ai.Provider{BaseURL: s.BaseURL, APIKey: s.APIKey, Model: s.Model}
		ctx, cancel := context.WithTimeout(a.ctx, 2*time.Minute)
		spec, err := p.Compose(ctx, input)
		cancel()
		if err == nil {
			return ComposeResponse{Spec: spec, Source: "glm"}
		}
		log.Printf("AI 作曲失败，降级本地引擎: %v", err)
		spec = a.fb.Compose(input)
		return ComposeResponse{Spec: spec, Source: "fallback", Notice: "AI 调用失败，已用离线引擎生成：" + err.Error()}
	}

	spec := a.fb.Compose(input)
	notice := ""
	if s, err := a.loader(); err != nil || s.APIKey == "" {
		notice = "未配置 AI（设置里填入智谱免费 API Key 后体验更佳），已用离线引擎生成"
	}
	return ComposeResponse{Spec: spec, Source: "fallback", Notice: notice}
}

// ExportAudio 弹出保存对话框，把渲染结果写盘（base64 传输，避免大数组的 JSON 序列化）。返回 "" 表示成功。
func (a *App) ExportAudio(b64 string, suggestedName string) string {
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return err.Error()
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultFilename: suggestedName,
		Title:           "导出音频",
		Filters: []runtime.FileFilter{
			{DisplayName: "音频文件", Pattern: "*.wav;*.mp3"},
		},
	})
	if err != nil || path == "" {
		return "已取消"
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return err.Error()
	}
	return ""
}

// MarkOnboarded 首启动引导完成。
func (a *App) MarkOnboarded() string {
	if err := store.MarkFirstRunDone(); err != nil {
		return err.Error()
	}
	return ""
}

// SaveHistoryEntry 保存一条生成历史（spec 原样透传，含种子可确定性回放）。
func (a *App) SaveHistoryEntry(req SaveHistoryRequest) string {
	id := uuid.NewString()
	spec, err := json.Marshal(req.Spec)
	if err != nil {
		return err.Error()
	}
	e := store.HistoryEntry{
		ID: id, Text: req.Text, Style: req.Style, DurationSec: req.DurationSec,
		Spec: spec, Source: req.Source, CreatedAt: time.Now(),
	}
	if err := store.AddHistory(e); err != nil {
		return err.Error()
	}
	return id
}

// SaveHistoryRequest 历史保存请求。
type SaveHistoryRequest struct {
	Text        string          `json:"text"`
	Style       string          `json:"style"`
	DurationSec int             `json:"durationSec"`
	Spec        json.RawMessage `json:"spec"`
	Source      string          `json:"source"`
}

// HistoryList 返回全部历史（倒序）。
func (a *App) HistoryList() []store.HistoryEntry {
	list, err := store.ListHistory()
	if err != nil {
		log.Printf("读取历史失败: %v", err)
		return []store.HistoryEntry{}
	}
	return list
}

// HistoryToggleFavorite 收藏/取消。
func (a *App) HistoryToggleFavorite(id string) string {
	if err := store.ToggleFavorite(id); err != nil {
		return err.Error()
	}
	return ""
}

// HistoryDelete 删除一条。
func (a *App) HistoryDelete(id string) string {
	if err := store.DeleteHistory(id); err != nil {
		return err.Error()
	}
	return ""
}

// GetSettings 返回当前设置。
func (a *App) GetSettings() store.Settings {
	s, err := a.loader()
	if err != nil {
		return store.Defaults()
	}
	return s
}

// SaveSettings 保存设置。
func (a *App) SaveSettings(s store.Settings) string {
	if err := a.saver(s); err != nil {
		return err.Error()
	}
	return ""
}
