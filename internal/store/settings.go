// Package store 管理本地设置与数据（%AppData%/evolver-music/）。
package store

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Settings 用户设置。
type Settings struct {
	APIKey       string `json:"apiKey"`
	BaseURL      string `json:"baseUrl"`
	Model        string `json:"model"`
	FirstRunDone bool   `json:"firstRunDone"`
}

// Defaults 默认指向智谱开放平台 GLM Flash 免费模型。
func Defaults() Settings {
	return Settings{
		BaseURL: "https://open.bigmodel.cn/api/paas/v4",
		Model:   "glm-4-flash",
	}
}

// DirOverride 测试注入数据目录。
var DirOverride string

// Dir 数据目录（%AppData%/evolver-music）。
func Dir() (string, error) {
	if DirOverride != "" {
		return DirOverride, os.MkdirAll(DirOverride, 0o755)
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "evolver-music")
	return dir, os.MkdirAll(dir, 0o755)
}

// Load 读取设置；不存在时返回默认值。
func Load() (Settings, error) {
	s := Defaults()
	dir, err := Dir()
	if err != nil {
		return s, err
	}
	data, err := os.ReadFile(filepath.Join(dir, "settings.json"))
	if os.IsNotExist(err) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	if err := json.Unmarshal(data, &s); err != nil {
		return Defaults(), nil // 损坏则重置
	}
	if s.BaseURL == "" {
		s.BaseURL = Defaults().BaseURL
	}
	if s.Model == "" {
		s.Model = Defaults().Model
	}
	return s, nil
}

// Save 写入设置。
func Save(s Settings) error {
	dir, err := Dir()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "settings.json"), data, 0o644)
}

// MarkFirstRunDone 首启动引导完成。
func MarkFirstRunDone() error {
	s, err := Load()
	if err != nil {
		s = Defaults()
	}
	s.FirstRunDone = true
	return Save(s)
}
