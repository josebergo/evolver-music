package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// HistoryEntry 一条生成历史。音频不落盘：规格含种子，确定性重编译即可回放。
type HistoryEntry struct {
	ID          string          `json:"id"`
	Text        string          `json:"text"`
	Style       string          `json:"style"`
	DurationSec int             `json:"durationSec"`
	Spec        json.RawMessage `json:"spec"`
	Source      string          `json:"source"`
	Favorite    bool            `json:"favorite"`
	CreatedAt   time.Time       `json:"createdAt"`
}

const maxHistory = 500

var historyMu sync.Mutex

func historyPath() (string, error) {
	dir, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "history.jsonl"), nil
}

// ListHistory 按时间倒序返回全部历史。
func ListHistory() ([]HistoryEntry, error) {
	historyMu.Lock()
	defer historyMu.Unlock()
	return listUnlocked()
}

func listUnlocked() ([]HistoryEntry, error) {
	path, err := historyPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return []HistoryEntry{}, nil
	}
	if err != nil {
		return nil, err
	}
	var entries []HistoryEntry
	for _, line := range splitLines(data) {
		if len(line) == 0 {
			continue
		}
		var e HistoryEntry
		if json.Unmarshal(line, &e) == nil {
			entries = append(entries, e)
		}
	}
	sort.SliceStable(entries, func(i, j int) bool { return entries[i].CreatedAt.After(entries[j].CreatedAt) })
	return entries, nil
}

// AddHistory 追加一条（写头部，超出上限裁尾）。
func AddHistory(e HistoryEntry) error {
	historyMu.Lock()
	defer historyMu.Unlock()
	path, err := historyPath()
	if err != nil {
		return err
	}
	entries, _ := listUnlocked()
	entries = append([]HistoryEntry{e}, entries...)
	if len(entries) > maxHistory {
		entries = entries[:maxHistory]
	}
	return rewrite(path, entries)
}

// ToggleFavorite 收藏/取消收藏。
func ToggleFavorite(id string) error {
	return mutate(func(e *HistoryEntry) bool {
		if e.ID == id {
			e.Favorite = !e.Favorite
			return true
		}
		return false
	})
}

// DeleteHistory 删除一条。
func DeleteHistory(id string) error {
	historyMu.Lock()
	defer historyMu.Unlock()
	path, err := historyPath()
	if err != nil {
		return err
	}
	entries, err := listUnlocked()
	if err != nil {
		return err
	}
	kept := entries[:0]
	for _, e := range entries {
		if e.ID != id {
			kept = append(kept, e)
		}
	}
	return rewrite(path, kept)
}

func mutate(fn func(*HistoryEntry) bool) error {
	historyMu.Lock()
	defer historyMu.Unlock()
	path, err := historyPath()
	if err != nil {
		return err
	}
	entries, err := listUnlocked()
	if err != nil {
		return err
	}
	changed := false
	for i := range entries {
		if fn(&entries[i]) {
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return rewrite(path, entries)
}

func rewrite(path string, entries []HistoryEntry) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	for _, e := range entries {
		if err := enc.Encode(e); err != nil {
			return err
		}
	}
	return nil
}

func splitLines(data []byte) [][]byte {
	var lines [][]byte
	start := 0
	for i, b := range data {
		if b == '\n' {
			lines = append(lines, data[start:i])
			start = i + 1
		}
	}
	if start < len(data) {
		lines = append(lines, data[start:])
	}
	return lines
}
