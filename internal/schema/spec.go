// Package schema 定义"心情 → 音乐规格"的核心数据契约。
// 该契约与前端 frontend/src/music/schema.ts (zod) 双侧对齐，
// 由 internal/schema/spec_test.go 与前端编译器测试共同保证不漂移。
package schema

import (
	"fmt"
	"math"
	"strings"
)

// Mood 心情四维，取值均为 0~1。
type Mood struct {
	Valence float64 `json:"valence"` // 愉悦度：0 极度消极，1 极度积极
	Energy  float64 `json:"energy"`  // 唤醒度：0 极静，1 极动
	Tension float64 `json:"tension"` // 紧张度：0 松弛，1 紧绷
	Warmth  float64 `json:"warmth"`  // 温暖度：0 冷冽，1 温暖
}

// Section 乐曲段落。
type Section struct {
	Name        string   `json:"name"`        // intro | verse | chorus | outro
	Bars        int      `json:"bars"`        // 小节数（2~32，4 的倍数最佳）
	Energy      float64  `json:"energy"`      // 段落相对能量 0~1
	Chords      []string `json:"chords"`      // 和弦符号，逐小节循环（如 Bm7/Gmaj7/D/A7）
	BassPattern string   `json:"bassPattern"` // 贝斯节奏型，枚举见 Styles
	DrumPattern string   `json:"drumPattern"` // 鼓组节奏型，枚举见 Styles
	Layers      []string `json:"layers"`      // 发声乐层，枚举见 Styles
}

// Mix 整体混音倾向 0~1。
type Mix struct {
	Reverb        float64 `json:"reverb"`
	Sidechain     float64 `json:"sidechain"`     // 侧链压缩强度（电子风格用）
	LofiCharacter float64 `json:"lofiCharacter"` // 黑胶/降采样质感（lo-fi 用）
}

// MusicSpec 音乐规格，渲染的唯一输入。
type MusicSpec struct {
	Mood     Mood      `json:"mood"`
	Style    string    `json:"style"` // lofi | edm（M1 支持两种）
	Tempo    int       `json:"tempo"` // BPM
	Key      string    `json:"key"`   // 大写根音 + 可选 #/b + 可选 m（如 C / F# / Bbm）
	Seed     int64     `json:"seed"`  // 渲染端确定性随机种子
	Sections []Section `json:"sections"`
	Mix      Mix       `json:"mix"`
}

// 支持的风格及其约束。两侧（Go/TS）修改必须同步。
var Styles = map[string]StyleDef{
	"lofi": {
		Name:       "lofi",
		Label:      "Lo-Fi Chill",
		TempoRange: [2]int{65, 100},
		BassPatterns:  []string{"root_long", "soft_walk", "root_fifth"},
		DrumPatterns:  []string{"lofi_sparse", "lofi_swing", "lofi_dense"},
		LayerVocab:    []string{"epiano", "pad", "vinyl", "melody", "bass", "kick", "snare", "hat"},
	},
	"edm": {
		Name:       "edm",
		Label:      "DJ/EDM",
		TempoRange: [2]int{118, 140},
		BassPatterns:  []string{"eight_root", "octave_pulse", "sub_pulse"},
		DrumPatterns:  []string{"four_floor", "four_floor_break", "big_room"},
		LayerVocab:    []string{"supersaw", "pluck", "pad", "melody", "bass", "kick", "snare", "hat", "riser"},
	},
	"blues": {
		Name:       "blues",
		Label:      "蓝调 Blues",
		TempoRange: [2]int{58, 96},
		BassPatterns:  []string{"blues_walk", "root_long", "root_fifth"},
		DrumPatterns:  []string{"blues_shuffle", "blues_slow", "blues_stomp"},
		LayerVocab:    []string{"organ", "melody", "bass", "kick", "snare", "hat"},
	},
	"ambient": {
		Name:       "ambient",
		Label:      "氛围 Ambient",
		TempoRange: [2]int{52, 76},
		BassPatterns:  []string{"drone_root", "drone_fifth"},
		DrumPatterns:  []string{"none_ambient"},
		LayerVocab:    []string{"piano", "pad", "melody", "bass"},
	},
	"piano": {
		Name:       "piano",
		Label:      "钢琴独奏",
		TempoRange: [2]int{60, 104},
		BassPatterns:  []string{"piano_root", "root_long"},
		DrumPatterns:  []string{"none_quiet"},
		LayerVocab:    []string{"piano", "melody"},
	},
	"jazz": {
		Name:       "jazz",
		Label:      "爵士 Jazz",
		TempoRange: [2]int{92, 148},
		BassPatterns:  []string{"jazz_walk", "soft_walk", "root_fifth"},
		DrumPatterns:  []string{"jazz_swing", "jazz_ballad"},
		LayerVocab:    []string{"epiano", "melody", "bass", "kick", "snare", "hat"},
	},
	"guofeng": {
		Name:       "guofeng",
		Label:      "古风",
		TempoRange: [2]int{62, 92},
		BassPatterns:  []string{"drone_fifth", "drone_root"},
		DrumPatterns:  []string{"none_quiet", "taiko_light"},
		LayerVocab:    []string{"guzheng", "dizi", "strings", "bass", "melody"},
	},
	"synthwave": {
		Name:       "synthwave",
		Label:      "Synthwave 复古电子",
		TempoRange: [2]int{84, 118},
		BassPatterns:  []string{"octave_pulse", "eight_root", "sub_pulse"},
		DrumPatterns:  []string{"synth_gate", "synth_break"},
		LayerVocab:    []string{"supersaw", "pluck", "pad", "melody", "bass", "kick", "snare", "hat", "riser"},
	},
	"cinematic": {
		Name:       "cinematic",
		Label:      "电影感 Cinematic",
		TempoRange: [2]int{56, 100},
		BassPatterns:  []string{"drone_root", "drone_fifth"},
		DrumPatterns:  []string{"cine_pulse", "cine_impact"},
		LayerVocab:    []string{"strings", "piano", "melody", "kick", "riser"},
	},
}

// StyleDef 单一风格的约束模板。
type StyleDef struct {
	Name          string
	Label         string
	TempoRange    [2]int
	BassPatterns  []string
	DrumPatterns  []string
	LayerVocab    []string
}

// 和弦白名单：根音 × 质量后缀。
var chordQualities = map[string]bool{
	"": true, "m": true, "7": true, "m7": true, "maj7": true, "sus2": true, "sus4": true,
}

var noteNames = map[string]int{
	"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5,
	"F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11,
}

// ParseChord 解析和弦符号 → (根音 MIDI 值基准(0~11), 质量后缀)。
// 例：Bm7 → (11, "m7")；Gmaj7 → (7, "maj7")；D → (2, "")。
func ParseChord(sym string) (root int, quality string, ok bool) {
	sym = strings.TrimSpace(sym)
	if sym == "" {
		return 0, "", false
	}
	i := 1
	if len(sym) > 1 && (sym[1] == '#' || sym[1] == 'b') {
		i = 2
	}
	rootName, quality := sym[:i], sym[i:]
	if len(rootName) == 2 && rootName[1] == 'b' && rootName[0] == 'B' {
		rootName = "Bb"
	}
	pc, rootOk := noteNames[rootName]
	if !rootOk || !chordQualities[quality] {
		return 0, "", false
	}
	return pc, quality, true
}

// ParseKey 解析调号 → (主音 pitch class, 是否小调)。如 "F#m" → (6, true)。
func ParseKey(key string) (tonic int, minor bool, ok bool) {
	key = strings.TrimSpace(key)
	if key == "" {
		return 0, false, false
	}
	minor = strings.HasSuffix(key, "m")
	if minor {
		key = strings.TrimSuffix(key, "m")
	}
	pc, rootOk := noteNames[key]
	if !rootOk {
		return 0, false, false
	}
	return pc, minor, true
}

func clamp01(v float64) float64 { return math.Max(0, math.Min(1, v)) }

// Repair 尽力把 LLM 输出修正为合法规格：越界的收敛、非法枚举回退默认值。
// 返回后规格必然通过 Validate（同名段落数量、和弦仍在白名单的前提下）。
func (s *MusicSpec) Repair() {
	s.Mood.Valence = clamp01(s.Mood.Valence)
	s.Mood.Energy = clamp01(s.Mood.Energy)
	s.Mood.Tension = clamp01(s.Mood.Tension)
	s.Mood.Warmth = clamp01(s.Mood.Warmth)
	s.Mix.Reverb = clamp01(s.Mix.Reverb)
	s.Mix.Sidechain = clamp01(s.Mix.Sidechain)
	s.Mix.LofiCharacter = clamp01(s.Mix.LofiCharacter)

	if _, ok := Styles[s.Style]; !ok {
		s.Style = "lofi"
	}
	def := Styles[s.Style]

	// BPM 收敛进风格区间。
	lo, hi := def.TempoRange[0], def.TempoRange[1]
	if s.Tempo < lo || s.Tempo > hi {
		s.Tempo = (lo + hi) / 2
	}

	// 调号非法 → A 小调。
	if _, _, ok := ParseKey(s.Key); !ok {
		s.Key = "Am"
	}

	if len(s.Sections) == 0 {
		s.Sections = []Section{{Name: "verse", Bars: 8, Energy: 0.6,
			Chords: []string{"Am7", "Fmaj7", "Cmaj7", "G7"}}}
	}

	for i := range s.Sections {
		sec := &s.Sections[i]
		switch sec.Name {
		case "intro", "verse", "chorus", "outro":
		default:
			sec.Name = "verse"
		}
		if sec.Bars < 2 {
			sec.Bars = 4
		}
		if sec.Bars > 32 {
			sec.Bars = 32
		}
		sec.Energy = clamp01(sec.Energy)

		// 和弦：非法符号回退为根音三和弦；为空则给默认进行。
		if len(sec.Chords) == 0 {
			sec.Chords = []string{"Am7", "Fmaj7", "Cmaj7", "G7"}
		}
		for j, ch := range sec.Chords {
			if _, _, ok := ParseChord(ch); !ok {
				fixed := ""
				if len(ch) > 0 {
					fixed = string(ch[0]) + "m7"
				}
				if _, _, ok2 := ParseChord(fixed); ok2 {
					sec.Chords[j] = fixed
				} else {
					sec.Chords[j] = "Am7"
				}
			}
		}

		if !contains(def.BassPatterns, sec.BassPattern) {
			sec.BassPattern = def.BassPatterns[0]
		}
		if !contains(def.DrumPatterns, sec.DrumPattern) {
			sec.DrumPattern = def.DrumPatterns[0]
		}
		if len(sec.Layers) == 0 {
			sec.Layers = def.LayerVocab[:4]
		}
		for j, l := range sec.Layers {
			if !contains(def.LayerVocab, l) {
				sec.Layers[j] = def.LayerVocab[0]
			}
		}
	}
}

// Validate 严格校验。错误信息面向开发/日志，不面向用户。
func (s *MusicSpec) Validate() error {
	if s == nil {
		return fmt.Errorf("spec 为空")
	}
	def, ok := Styles[s.Style]
	if !ok {
		return fmt.Errorf("未知风格 %q", s.Style)
	}
	if s.Tempo < def.TempoRange[0] || s.Tempo > def.TempoRange[1] {
		return fmt.Errorf("tempo %d 超出 %s 区间 [%d,%d]", s.Tempo, s.Style, def.TempoRange[0], def.TempoRange[1])
	}
	if _, _, ok := ParseKey(s.Key); !ok {
		return fmt.Errorf("非法调号 %q", s.Key)
	}
	for _, v := range []float64{s.Mood.Valence, s.Mood.Energy, s.Mood.Tension, s.Mood.Warmth,
		s.Mix.Reverb, s.Mix.Sidechain, s.Mix.LofiCharacter} {
		if v < 0 || v > 1 || math.IsNaN(v) {
			return fmt.Errorf("0~1 维度越界: %v", v)
		}
	}
	if len(s.Sections) == 0 {
		return fmt.Errorf("缺少段落")
	}
	seen := map[string]bool{}
	for _, sec := range s.Sections {
		switch sec.Name {
		case "intro", "verse", "chorus", "outro":
		default:
			return fmt.Errorf("非法段落名 %q", sec.Name)
		}
		if seen[sec.Name] {
			return fmt.Errorf("段落 %q 重复", sec.Name)
		}
		seen[sec.Name] = true
		if sec.Bars < 2 || sec.Bars > 32 {
			return fmt.Errorf("段落 %q 小节数 %d 非法", sec.Name, sec.Bars)
		}
		if sec.Energy < 0 || sec.Energy > 1 {
			return fmt.Errorf("段落 %q 能量越界", sec.Name)
		}
		if len(sec.Chords) == 0 {
			return fmt.Errorf("段落 %q 缺少和弦", sec.Name)
		}
		for _, ch := range sec.Chords {
			if _, _, ok := ParseChord(ch); !ok {
				return fmt.Errorf("段落 %q 非法和弦 %q", sec.Name, ch)
			}
		}
		if !contains(def.BassPatterns, sec.BassPattern) {
			return fmt.Errorf("段落 %q 非法贝斯节奏型 %q", sec.Name, sec.BassPattern)
		}
		if !contains(def.DrumPatterns, sec.DrumPattern) {
			return fmt.Errorf("段落 %q 非法鼓组节奏型 %q", sec.Name, sec.DrumPattern)
		}
		for _, l := range sec.Layers {
			if !contains(def.LayerVocab, l) {
				return fmt.Errorf("段落 %q 非法乐层 %q", sec.Name, l)
			}
		}
	}
	return nil
}

// TotalBars 总小节数。
func (s *MusicSpec) TotalBars() int {
	n := 0
	for _, sec := range s.Sections {
		n += sec.Bars
	}
	return n
}

// DurationSec 按当前 BPM 估算时长（秒）。
func (s *MusicSpec) DurationSec() float64 {
	return float64(s.TotalBars()) * 4.0 * 60.0 / float64(s.Tempo)
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
