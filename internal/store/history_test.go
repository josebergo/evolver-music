package store

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

func withTempDir(t *testing.T) {
	t.Helper()
	DirOverride = t.TempDir()
	t.Cleanup(func() { DirOverride = "" })
}

func entry(id string, fav bool) HistoryEntry {
	return HistoryEntry{ID: id, Text: "测试" + id, Favorite: fav, CreatedAt: time.Now()}
}

func TestHistoryRoundtrip(t *testing.T) {
	withTempDir(t)
	if err := AddHistory(entry("a", false)); err != nil {
		t.Fatal(err)
	}
	time.Sleep(10 * time.Millisecond)
	if err := AddHistory(entry("b", false)); err != nil {
		t.Fatal(err)
	}
	list, err := ListHistory()
	if err != nil || len(list) != 2 {
		t.Fatalf("期望 2 条: %v %v", len(list), err)
	}
	if list[0].ID != "b" { // 倒序
		t.Fatalf("最新在前，得到 %s", list[0].ID)
	}

	if err := ToggleFavorite("a"); err != nil {
		t.Fatal(err)
	}
	list, _ = ListHistory()
	for _, e := range list {
		if e.ID == "a" && !e.Favorite {
			t.Fatal("收藏未生效")
		}
	}

	if err := DeleteHistory("b"); err != nil {
		t.Fatal(err)
	}
	list, _ = ListHistory()
	if len(list) != 1 || list[0].ID != "a" {
		t.Fatalf("删除后应剩 a: %+v", list)
	}
}

func TestHistorySpecSurvivesRoundtrip(t *testing.T) {
	withTempDir(t)
	spec := json.RawMessage(`{"style":"lofi","tempo":85,"seed":42}`)
	if err := AddHistory(HistoryEntry{ID: "x", Spec: spec}); err != nil {
		t.Fatal(err)
	}
	list, _ := ListHistory()
	var back struct {
		Style string `json:"style"`
		Seed  int    `json:"seed"`
	}
	if err := json.Unmarshal(list[0].Spec, &back); err != nil {
		t.Fatal(err)
	}
	if back.Style != "lofi" || back.Seed != 42 {
		t.Fatalf("spec 往返损坏: %+v", back)
	}
	if _, err := os.Stat(DirOverride + string(os.PathSeparator) + "history.jsonl"); err != nil {
		t.Fatal("历史文件应存在")
	}
}
