package ai

import (
	"fmt"
	"sort"
	"strings"

	"evolver-music/internal/schema"
)

// ComposeInput 一次作曲请求的输入。
type ComposeInput struct {
	Text        string // 心情文本（任意长度）
	Style       string // auto | 9 种风格之一
	DurationSec int    // 目标时长（秒）
	Seed        int64  // 确定性种子
}

// buildPrompt 构造 system/user 提示词。核心思路：风格是约束模板，
// 模型只在模板枚举内"填空"，从根上限制它输出听不了的东西。
func buildPrompt(opts ComposeInput) (system string, user string) {
	var styleLine, sectionRule string
	if def, ok := schema.Styles[opts.Style]; ok {
		styleLine = fmt.Sprintf(`"%s"（已指定，不可改）`, def.Name)
		sectionRule = styleRuleFor(def)
	} else {
		names := make([]string, 0, len(schema.Styles))
		for name := range schema.Styles {
			names = append(names, name)
		}
		sort.Strings(names)
		styleLine = "从 " + strings.Join(names, " / ") + " 中选（高能量蹦迪→edm；复古霓虹→synthwave；紧张史诗→cinematic；温暖叙事→piano；空灵放空→ambient；慵懒低落→lofi；苦中带暖→blues；轻快摇摆→jazz；江湖水墨→guofeng）"
		var rules []string
		for _, name := range names {
			rules = append(rules, styleRuleFor(schema.Styles[name]))
		}
		sectionRule = strings.Join(rules, "\n")
	}

	system = fmt.Sprintf(`你是一名"心情作曲引擎"：分析用户的心情文本，输出一份结构化的音乐规格 JSON，交给本地合成器渲染成器乐曲。

只输出一个 JSON 对象，不要 markdown、不要解释。字段定义：
{
  "mood": { "valence": 愉悦度0~1, "energy": 唤醒度0~1, "tension": 紧张度0~1, "warmth": 温暖度0~1 },
  "style": %s,
  "tempo": BPM 整数（遵守所选风格区间）,
  "key": 调号，根音C D E F G A B（可用#/b）+ 小写m表示小调，如 "Bm"、"F"、"Eb",
  "seed": %d,
  "sections": 段落数组，依次为 intro/verse/chorus/outro，每段 {
      "name": "intro|verse|chorus|outro",
      "bars": 小节数(4/8/16，蓝调可用12的倍数),
      "energy": 该段能量0~1（intro低、chorus最高）,
      "chords": 和弦数组逐小节循环，质量仅限 "" m 7 m7 maj7 sus2 sus4,
      "bassPattern": 贝斯节奏型枚举,
      "drumPattern": 鼓组节奏型枚举,
      "layers": 发声乐层枚举数组
  },
  "mix": { "reverb": 0~1, "sidechain": 0~1, "lofiCharacter": 0~1 }
}

硬性规则：
1. 心情四维必须从文本真实推断，不要默认取中值。
2. %s
3. 和弦进行要符合调号（多用调内和弦与七和弦制造色彩），chorus 比 verse 更开阔有力。
4. 段落能量曲线：intro < verse < chorus，outro 回落。
5. 小节数合计使总时长接近目标时长（总秒数 ≈ 小节数×4×60/BPM）。
6. 所有枚举值只能从风格约束中选，不要发明新词。`,
		styleLine, opts.Seed, sectionRule)

	user = fmt.Sprintf(`心情文本：
%s

目标时长：%d 秒左右
风格：%s

输出规格 JSON。`, strings.TrimSpace(opts.Text), opts.DurationSec, styleLabel(opts.Style))

	return system, user
}

func styleRuleFor(def schema.StyleDef) string {
	return fmt.Sprintf(`%s: tempo %d~%d；layers 从 %v 选；bassPattern 从 %v 选；drumPattern 从 %v 选`,
		def.Name, def.TempoRange[0], def.TempoRange[1],
		def.LayerVocab, def.BassPatterns, def.DrumPatterns)
}

func styleLabel(style string) string {
	if def, ok := schema.Styles[style]; ok {
		return def.Label
	}
	return "自动（由你判断最贴合心情的风格）"
}
