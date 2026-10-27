package ai

import (
	"encoding/json"
	"testing"

	"evolver-music/internal/schema"
)

func TestFallbackSadRainyLofi(t *testing.T) {
	fb := Fallback{}
	spec := fb.Compose(ComposeInput{Text: "下雨天有点丧", Style: "auto", DurationSec: 60})
	if err := spec.Validate(); err != nil {
		t.Fatalf("降级引擎输出不合法: %v", err)
	}
	if spec.Style != "lofi" {
		t.Errorf("低能量心情应为 lofi，得到 %s", spec.Style)
	}
	if spec.Mood.Valence >= 0.5 {
		t.Errorf("丧文本 valence 应 <0.5，得到 %.2f", spec.Mood.Valence)
	}
	if _, minor, _ := schema.ParseKey(spec.Key); !minor {
		t.Errorf("消极心情应为小调，得到 %s", spec.Key)
	}
}

func TestFallbackPartyEdm(t *testing.T) {
	fb := Fallback{}
	spec := fb.Compose(ComposeInput{Text: "今晚蹦迪派对，超级兴奋！", Style: "auto", DurationSec: 60})
	if err := spec.Validate(); err != nil {
		t.Fatalf("不合法: %v", err)
	}
	if spec.Style != "edm" {
		t.Errorf("高能量心情应为 edm，得到 %s", spec.Style)
	}
	if spec.Mood.Energy < 0.55 {
		t.Errorf("派对文本 energy 应 ≥0.55，得到 %.2f", spec.Mood.Energy)
	}
}

func TestFallbackExplicitStyleRespected(t *testing.T) {
	fb := Fallback{}
	spec := fb.Compose(ComposeInput{Text: "平静的海边，风很温柔", Style: "edm", DurationSec: 60})
	if spec.Style != "edm" {
		t.Errorf("显式指定 edm 应被尊重，得到 %s", spec.Style)
	}
}

func TestFallbackDeterministic(t *testing.T) {
	fb := Fallback{}
	a := fb.Compose(ComposeInput{Text: "加班到深夜，地铁上很空", Style: "auto", DurationSec: 60})
	b := fb.Compose(ComposeInput{Text: "加班到深夜，地铁上很空", Style: "auto", DurationSec: 60})
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	if string(ja) != string(jb) {
		t.Error("相同输入应产生相同输出")
	}
}

func TestFallbackDurationReasonable(t *testing.T) {
	fb := Fallback{}
	for _, target := range []int{30, 60, 120} {
		spec := fb.Compose(ComposeInput{Text: "有点累但很平静", Style: "auto", DurationSec: target})
		got := spec.DurationSec()
		if got < float64(target)*0.7 || got > float64(target)*1.4 {
			t.Errorf("目标 %ds，实际 %.0fs 偏差过大", target, got)
		}
	}
}

func TestFallbackEmptyText(t *testing.T) {
	fb := Fallback{}
	spec := fb.Compose(ComposeInput{Text: "", Style: "auto", DurationSec: 60})
	if err := spec.Validate(); err != nil {
		t.Fatalf("空文本也应输出合法规格: %v", err)
	}
}

func TestBuildPromptContainsConstraints(t *testing.T) {
	sys, user := buildPrompt(ComposeInput{Text: "开心", Style: "lofi", DurationSec: 60, Seed: 7})
	for _, want := range []string{"root_long", "lofi_sparse", "65", "100", "maj7", "开心", "60"} {
		if !contains(sys+user, want) {
			t.Errorf("prompt 缺少约束 %q", want)
		}
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})()
}

func TestParseSpecFromNoisyModelOutput(t *testing.T) {
	raw := "好的，这是规格：\n```json\n" + `{"style":"lofi","tempo":85,"key":"Am","seed":1,"mood":{"valence":0.5,"energy":0.5,"tension":0.3,"warmth":0.5},"sections":[],"mix":{"reverb":0.3,"sidechain":0,"lofiCharacter":0.6}}` + "\n```\n希望能帮到你！"
	spec, err := parseSpec(raw)
	if err != nil {
		t.Fatalf("parseSpec: %v", err)
	}
	if spec.Style != "lofi" || spec.Tempo != 85 {
		t.Errorf("解析结果不对: %+v", spec)
	}
}

func TestAllStylesProduceValidSpecs(t *testing.T) {
	fb := Fallback{}
	for style := range schema.Styles {
		for _, text := range []string{"下雨天有点丧", "今天超开心去蹦迪", "", "平静"} {
			spec := fb.Compose(ComposeInput{Text: text, Style: style, DurationSec: 60})
			if err := spec.Validate(); err != nil {
				t.Fatalf("style=%s text=%q 不合法: %v", style, text, err)
			}
			if spec.Style != style {
				t.Fatalf("显式 style=%s 被改成 %s", style, spec.Style)
			}
		}
	}
}

func TestStyleKeywordRouting(t *testing.T) {
	cases := map[string]string{
		"江湖夜雨，侠客独行":                    "guofeng",
		"来一段蓝调，慢慢摇":                   "blues",
		"深夜爵士酒吧，萨克斯即兴":              "jazz",
		"只想要安静的钢琴曲":                  "piano",
		"冥想放空，空灵一点":                  "ambient",
		"赛博朋克夜城，蒸汽波霓虹":             "synthwave",
		"电影预告片那种史诗感":                "cinematic",
		"今晚电音派对蹦迪":                   "edm",
		"心情不好，来一段DJ音乐":              "edm",
	}
	fb := Fallback{}
	for text, want := range cases {
		got := fb.Compose(ComposeInput{Text: text, Style: "auto", DurationSec: 60}).Style
		if got != want {
			t.Errorf("文本 %q 期望 %s 得到 %s", text, want, got)
		}
	}
}

func TestBluesTwelveBar(t *testing.T) {
	fb := Fallback{}
	spec := fb.Compose(ComposeInput{Text: "蓝调之夜", Style: "blues", DurationSec: 90})
	verse := spec.Sections[1]
	if len(verse.Chords) != 12 || verse.Bars%12 != 0 {
		t.Errorf("蓝调主段应为 12 小节循环: chords=%d bars=%d", len(verse.Chords), verse.Bars)
	}
	// 第 9 小节应是 V 级
	if root, _, ok := schema.ParseChord(verse.Chords[8]); !ok || root != (parsePc(spec.Key)+7)%12 {
		t.Errorf("蓝调第 9 小节应为 V7，得到 %s", verse.Chords[8])
	}
}

func parsePc(key string) int {
	pc, _, _ := schema.ParseKey(key)
	return pc
}

func TestMoodRoutingCinematic(t *testing.T) {
	fb := Fallback{}
	spec := fb.Compose(ComposeInput{Text: "项目要截止了，压力巨大，紧张到手抖", Style: "auto", DurationSec: 60})
	if spec.Style != "cinematic" && spec.Style != "edm" && spec.Style != "synthwave" {
		t.Errorf("高压紧张文本应路由到紧张系风格，得到 %s", spec.Style)
	}
}

func TestBuildPromptAutoContainsAllStyles(t *testing.T) {
	sys, _ := buildPrompt(ComposeInput{Text: "测试", Style: "auto", DurationSec: 60})
	for _, name := range []string{"lofi", "edm", "blues", "ambient", "piano", "jazz", "guofeng", "synthwave", "cinematic"} {
		if !contains(sys, name) {
			t.Errorf("auto prompt 缺少风格 %s", name)
		}
	}
}
