package main

import (
	"context"
	"testing"

	"evolver-music/internal/store"
)

func TestComposeWithoutKeyUsesFallback(t *testing.T) {
	app := &App{
		ctx:    context.Background(),
		loader: func() (store.Settings, error) { return store.Defaults(), nil },
	}
	resp := app.Compose(ComposeRequest{Text: "下雨天有点丧", Style: "auto", DurationSec: 60})
	if resp.Source != "fallback" {
		t.Fatalf("无 Key 应走 fallback，得到 %s", resp.Source)
	}
	if resp.Spec == nil || resp.Spec.Validate() != nil {
		t.Fatal("fallback 规格缺失或不合法")
	}
	if resp.Notice == "" {
		t.Error("应提示未配置 AI")
	}
}

func TestComposeClampsDuration(t *testing.T) {
	app := &App{
		ctx:    context.Background(),
		loader: func() (store.Settings, error) { return store.Defaults(), nil },
	}
	resp := app.Compose(ComposeRequest{Text: "测试", Style: "auto", DurationSec: 99999})
	if resp.Spec.DurationSec() > 300*1.5 {
		t.Errorf("时长未收敛: %.0fs", resp.Spec.DurationSec())
	}
}
