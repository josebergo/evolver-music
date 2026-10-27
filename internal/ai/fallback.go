package ai

import (
	"hash/fnv"
	"math"
	"strings"

	"evolver-music/internal/schema"
)

// keywordGroups 情感词典（子串匹配，中英混排）。
var keywordGroups = []struct {
	dim    string  // valence | energy | tension | warmth
	weight float64 // 正/负号表示方向，绝对值为单次命中权重
	words  []string
}{
	{"valence", -0.20, []string{"丧", "难过", "悲伤", "悲", "痛苦", "沮丧", "失落", "孤独", "孤单", "委屈", "压抑", "郁闷", "烦", "崩溃", "失恋", "分手", "遗憾", "后悔", "失望", "无力", "空虚", "麻木", "自卑", "抑郁", "emo", "sad", "lonely"}},
	{"valence", -0.10, []string{"累", "疲惫", "疲倦", "加班", "哭", "眼泪", "泪", "雨", "阴天", "阴", "冷", "想家", "焦虑", "焦躁", "tired"}},
	{"valence", +0.20, []string{"开心", "高兴", "快乐", "兴奋", "满足", "幸福", "幸运", "愉快", "喜悦", "惊喜", "甜", "庆祝", "成功", "赢", "happy", "joy", "excited", "grateful"}},
	{"valence", +0.10, []string{"阳光", "期待", "希望", "治愈", "喜欢", "爱", "舒畅", "畅快", "爽", "顺"}},
	{"energy", +0.20, []string{"兴奋", "激动", "狂欢", "蹦迪", "派对", "运动", "跑", "冲", "刺激", "燃", "战斗", "电", "赶"}},
	{"energy", +0.10, []string{"高压", "紧张", "焦虑", "焦躁", "愤怒", "生气", "火", "快", "deadline", "慌"}},
	{"energy", -0.20, []string{"平静", "安静", "放松", "冥想", "发呆", "睡", "困", "慵懒", "躺", "安宁", "沉浸"}},
	{"energy", -0.10, []string{"累", "疲惫", "疲倦", "深夜", "夜晚", "夜", "缓", "慢", "空", "舒服", "惬意"}},
	{"tension", +0.15, []string{"紧张", "焦虑", "焦躁", "恐惧", "害怕", "压力", "截止", "deadline", "赶", "慌", "冲突", "争吵", "吵", "愤怒", "生气", "崩溃", "不安"}},
	{"warmth", +0.15, []string{"温暖", "阳光", "治愈", "家", "拥抱", "咖啡", "回忆", "温柔", "怀旧", "奶茶", "冬日", "陪伴", "想念", "老歌"}},
	{"warmth", -0.12, []string{"冷", "雨", "阴", "冬", "雪", "冰", "孤独", "空", "苍白", "灰"}},
}

// styleKeywords 风格关键词：auto 模式下命中即锁定该风格。
var styleKeywords = []struct {
	style string
	words []string
}{
	{"guofeng", []string{"古风", "江湖", "侠", "竹笛", "古筝", "水墨", "江南", "武侠", "国风", "琵琶", "笛子"}},
	{"blues", []string{"蓝调", "布鲁斯", "blues"}},
	{"jazz", []string{"爵士", "jazz", "萨克斯", "即兴"}},
	{"piano", []string{"钢琴", "琴键", "piano"}},
	{"ambient", []string{"冥想", "睡眠", "白噪音", "空灵", "ambient", "瑜伽"}},
	{"synthwave", []string{"蒸汽波", "赛博", "复古电子", "80年代", "synthwave", "vaporwave"}},
	{"cinematic", []string{"电影", "史诗", "预告片", "大片", "配乐", "cinematic"}},
	{"edm", []string{"蹦迪", "电音", "edm", "夜店", "dj", "打碟", "remix"}},
	{"lofi", []string{"lo-fi", "lofi", "学习", "摸鱼", "咖啡厅"}},
}

// 调性候选池。
var minorTonics = []string{"A", "E", "B", "D", "F#", "C#", "G", "Bb"}
var majorTonics = []string{"C", "G", "D", "F", "Bb", "A", "Eb", "A"}

// chordDegree 和弦模板元素：相对主音的半音偏移 + 质量。
type chordDegree struct {
	offset  int
	quality string
}

var progressions = map[string][]chordDegree{
	"lofi/sad":      {{0, "m7"}, {8, "maj7"}, {5, "m7"}, {10, "7"}},
	"lofi/neutral":  {{0, "m7"}, {3, "maj7"}, {8, "maj7"}, {10, "maj7"}},
	"lofi/calmMaj":  {{0, "maj7"}, {9, "m7"}, {5, "maj7"}, {7, "7"}},
	"lofi/happyMaj": {{0, "maj7"}, {5, "maj7"}, {9, "m7"}, {7, "7"}},

	// 12 小节蓝调（快变体），整段作为主段循环
	"blues/12bar": {
		{0, "7"}, {5, "7"}, {0, "7"}, {0, "7"},
		{5, "7"}, {5, "7"}, {0, "7"}, {0, "7"},
		{7, "7"}, {5, "7"}, {0, "7"}, {7, "7"},
	},
	"blues/head": {{0, "7"}, {5, "7"}, {0, "7"}, {7, "7"}},

	"ambient/minor": {{0, "m7"}, {8, "maj7"}},
	"ambient/major": {{0, "maj7"}, {5, "maj7"}},

	"piano/minor": {{0, "m"}, {5, "m"}, {8, "maj7"}, {3, "maj7"}},
	"piano/major": {{0, ""}, {7, ""}, {9, "m"}, {5, ""}},

	"jazz/minor": {{2, "m7"}, {7, "7"}, {0, "maj7"}, {0, "maj7"}},
	"jazz/major": {{2, "m7"}, {7, "7"}, {0, "maj7"}, {5, "maj7"}},
	"jazz/head":  {{2, "m7"}, {7, "7"}},

	"guofeng/minor": {{0, "m"}, {10, ""}, {8, ""}, {10, ""}},
	"guofeng/major": {{0, ""}, {7, ""}, {9, "m"}, {5, ""}},

	"synthwave/minor": {{0, "m"}, {8, ""}, {10, ""}, {8, ""}},
	"synthwave/tense": {{0, "m"}, {10, ""}, {8, ""}, {7, ""}},
	"synthwave/major": {{0, ""}, {5, ""}, {9, "m"}, {7, ""}},

	"edm/minor": {{0, "m"}, {8, ""}, {3, ""}, {10, ""}},
	"edm/tense": {{0, "m"}, {10, ""}, {8, ""}, {10, ""}},
	"edm/major": {{0, ""}, {7, ""}, {9, "m"}, {5, ""}},

	"cinematic/minor": {{0, "m"}, {8, ""}, {10, ""}, {7, ""}},
	"cinematic/major": {{0, ""}, {9, "m"}, {5, ""}, {7, ""}},
}

// pitchClassNames 半音级 → 音名。
var pitchClassNames = []string{"C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"}

// styleCfg 降级引擎的按风格配置。
type styleCfg struct {
	tempo      func(energy float64) int
	minor      string // 小调进行模板键
	major      string // 大调进行模板键
	head       string // intro/outro 短循环模板键（空则取进行前 2 个）
	fixedLoop  int    // >0 表示主段固定小节数（如蓝调 12 小节）
}

var styleCfgs = map[string]styleCfg{
	"lofi":      {tempo: func(e float64) int { return int(70 + e*28) }, minor: "lofi/sad", major: "lofi/calmMaj"},
	"edm":       {tempo: func(e float64) int { return int(118 + e*22) }, minor: "edm/minor", major: "edm/major"},
	"blues":     {tempo: func(e float64) int { return int(64 + e*30) }, minor: "blues/12bar", major: "blues/12bar", head: "blues/head", fixedLoop: 12},
	"ambient":   {tempo: func(e float64) int { return int(56 + e*16) }, minor: "ambient/minor", major: "ambient/major"},
	"piano":     {tempo: func(e float64) int { return int(66 + e*32) }, minor: "piano/minor", major: "piano/major"},
	"jazz":      {tempo: func(e float64) int { return int(100 + e*42) }, minor: "jazz/minor", major: "jazz/major", head: "jazz/head"},
	"guofeng":   {tempo: func(e float64) int { return int(66 + e*22) }, minor: "guofeng/minor", major: "guofeng/major"},
	"synthwave": {tempo: func(e float64) int { return int(88 + e*26) }, minor: "synthwave/minor", major: "synthwave/major"},
	"cinematic": {tempo: func(e float64) int { return int(62 + e*34) }, minor: "cinematic/minor", major: "cinematic/major"},
}

// Fallback 离线降级引擎：不依赖任何网络与模型，永不失败。
type Fallback struct{}

// Compose 由心情文本推导规格。相同文本输出恒定（确定性）。
func (f *Fallback) Compose(opts ComposeInput) *schema.MusicSpec {
	text := opts.Text
	mood := analyzeMood(text)
	seed := opts.Seed
	if seed == 0 {
		seed = hashSeed(text)
	}

	style := resolveStyle(opts.Style, text, mood)
	spec := &schema.MusicSpec{Mood: mood, Style: style, Seed: seed}

	cfg := styleCfgs[style]
	spec.Tempo = clampInt(cfg.tempo(mood.Energy), schema.Styles[style].TempoRange[0], schema.Styles[style].TempoRange[1])

	// 调性：偏消极→小调；偏积极→大调；主音由种子挑选。
	minor := mood.Valence < 0.45
	pool := majorTonics
	if minor {
		pool = minorTonics
	}
	spec.Key = pool[int(uint64(seed)%uint64(len(pool)))]
	if minor {
		spec.Key += "m"
	}

	progKey := cfg.minor
	if !minor {
		progKey = cfg.major
	}
	// 心情细分微调
	switch {
	case style == "lofi" && minor && mood.Valence < 0.3:
		progKey = "lofi/sad"
	case style == "lofi" && minor:
		progKey = "lofi/neutral"
	case style == "lofi" && mood.Energy < 0.45:
		progKey = "lofi/calmMaj"
	case style == "lofi":
		progKey = "lofi/happyMaj"
	case style == "synthwave" && mood.Tension >= 0.55:
		progKey = "synthwave/tense"
	case style == "edm" && mood.Tension >= 0.55:
		progKey = "edm/tense"
	}

	if _, _, ok := schema.ParseKey(spec.Key); !ok {
		spec.Key = "Am"
		progKey = "lofi/sad"
	}
	prog := progressions[progKey]
	if len(prog) == 0 {
		prog = progressions["lofi/sad"] // 防御：模板缺失时兜底
	}
	tonic, _, _ := schema.ParseKey(spec.Key)
	fullLoop := make([]string, len(prog))
	for i, d := range prog {
		fullLoop[i] = pitchClassNames[(tonic+d.offset)%12] + d.quality
	}
	headLoop := []string{fullLoop[0], fullLoop[1]}
	if cfg.head != "" {
		hp := progressions[cfg.head]
		headLoop = make([]string, len(hp))
		for i, d := range hp {
			headLoop[i] = pitchClassNames[(tonic+d.offset)%12] + d.quality
		}
	}

	spec.Sections = buildSections(style, planBars(style, spec.Tempo, cfg.fixedLoop, opts.DurationSec), mood, fullLoop, headLoop)
	spec.Mix = mixFor(style, mood)
	return spec
}

// resolveStyle 风格决策：显式指定 > 关键词命中 > 心情路由。
func resolveStyle(requested, text string, mood schema.Mood) string {
	if def, ok := schema.Styles[requested]; ok {
		return def.Name
	}
	lower := strings.ToLower(text)
	for _, kw := range styleKeywords {
		for _, w := range kw.words {
			if strings.Contains(lower, strings.ToLower(w)) {
				return kw.style
			}
		}
	}
	switch { // 心情路由（按优先级）
	case mood.Energy >= 0.62:
		return "edm"
	case mood.Energy >= 0.45 && mood.Tension >= 0.45:
		return "synthwave"
	case mood.Tension >= 0.55:
		return "cinematic"
	case mood.Valence >= 0.5 && mood.Energy <= 0.4 && mood.Warmth >= 0.6:
		return "piano"
	case mood.Valence >= 0.5 && mood.Energy <= 0.4:
		return "ambient"
	case mood.Valence >= 0.25 && mood.Valence < 0.5 && mood.Warmth >= 0.5:
		return "blues"
	case mood.Valence >= 0.5 && mood.Energy > 0.4 && mood.Tension < 0.45:
		return "jazz"
	default:
		return "lofi"
	}
}

type barsPlan struct {
	edge   int
	verse  int
	chorus int
	total  int // 非 fixed-loop 风格：总小节数
}

// planBars 按目标时长规划段落规模；有固定循环的风格（蓝调 12 小节）从候选结构中选最接近的。
// 候选为 {intro/outro 边宽, 主段, 副段} 小节；和弦循环短于段长时自动截取前几小节。
var fixedLoopCandidates = [][3]int{
	{0, 8, 0}, {0, 12, 0}, {0, 16, 0}, {2, 8, 8}, {2, 12, 12},
	{4, 12, 12}, {4, 12, 16}, {4, 12, 24}, {4, 24, 24},
}

func planBars(style string, tempo, fixedLoop, durationSec int) barsPlan {
	barDur := 4.0 * 60.0 / float64(tempo)
	if fixedLoop > 0 {
		best := fixedLoopCandidates[0]
		bestDiff := math.MaxFloat64
		for _, c := range fixedLoopCandidates {
			total := c[0]*2 + c[1] + c[2]
			d := math.Abs(float64(total)*barDur - float64(durationSec))
			if d < bestDiff {
				bestDiff, best = d, c
			}
		}
		return barsPlan{edge: best[0], verse: best[1], chorus: best[2]}
	}
	n := int(math.Round(float64(durationSec) / barDur))
	n = clampInt(n, 8, 64)
	if n%2 != 0 {
		n--
	}
	return barsPlan{total: n}
}

func mixFor(style string, m schema.Mood) schema.Mix {
	switch style {
	case "edm":
		return schema.Mix{Reverb: clamp01v(0.22 + m.Tension*0.12), Sidechain: clamp01v(0.65 + m.Energy*0.25)}
	case "blues":
		return schema.Mix{Reverb: 0.25, LofiCharacter: clamp01v(0.2 + 0.2*(1-m.Energy))}
	case "ambient":
		return schema.Mix{Reverb: clamp01v(0.62 + m.Warmth*0.15)}
	case "piano":
		return schema.Mix{Reverb: clamp01v(0.38 + m.Warmth*0.15)}
	case "jazz":
		return schema.Mix{Reverb: 0.2, LofiCharacter: 0.08}
	case "guofeng":
		return schema.Mix{Reverb: 0.5}
	case "synthwave":
		return schema.Mix{Reverb: 0.35, Sidechain: clamp01v(0.25 + m.Energy*0.25)}
	case "cinematic":
		return schema.Mix{Reverb: clamp01v(0.55 + m.Tension*0.15)}
	default:
		return schema.Mix{Reverb: clamp01v(0.32 + m.Warmth*0.2), LofiCharacter: clamp01v(0.5 + 0.3*(1-m.Energy))}
	}
}

func buildSections(style string, plan barsPlan, mood schema.Mood, fullLoop, headLoop []string) []schema.Section {
	var edge, verse, chorus int
	if plan.edge > 0 || plan.verse > 0 { // fixed-loop 风格：edge/chorus 可为 0（省略该段）
		edge, verse, chorus = plan.edge, plan.verse, plan.chorus
	} else {
		total := plan.total
		edge = 4
		if total < 16 {
			edge = 2
		}
		middle := total - edge*2
		if middle < 8 {
			middle = 8
		}
		chorus = middle / 2
		if r := chorus % 4; r != 0 {
			chorus += 4 - r
		}
		if chorus < 4 {
			chorus = 4
		}
		verse = middle - chorus
		if verse < 4 {
			verse = 4
		}
	}

	base := mood.Energy
	var sections []schema.Section
	if edge > 0 {
		sections = append(sections, schema.Section{Name: "intro", Bars: edge, Energy: clamp01v(0.30 + base*0.1), Chords: headLoop})
	}
	sections = append(sections, schema.Section{
		Name: "verse", Bars: verse, Energy: clamp01v(0.45 + base*0.15), Chords: fullLoop,
	})
	if chorus > 0 {
		sections = append(sections, schema.Section{Name: "chorus", Bars: chorus, Energy: clamp01v(0.75 + base*0.2), Chords: fullLoop})
	}
	if edge > 0 {
		sections = append(sections, schema.Section{Name: "outro", Bars: edge, Energy: clamp01v(0.25 + base*0.1), Chords: headLoop})
	}
	for i := range sections {
		applyStyleLayer(style, &sections[i])
	}
	return sections
}

// applyStyleLayer 按风格×段落填节奏型与乐层。
func applyStyleLayer(style string, sec *schema.Section) {
	switch style {
	case "edm":
		sec.BassPattern, sec.DrumPattern = "eight_root", "four_floor"
		sec.Layers = []string{"supersaw", "melody", "bass", "kick", "snare", "hat"}
	case "blues":
		sec.BassPattern, sec.DrumPattern = "blues_walk", "blues_shuffle"
		sec.Layers = []string{"organ", "melody", "bass", "kick", "snare", "hat"}
	case "ambient":
		sec.BassPattern, sec.DrumPattern = "drone_root", "none_ambient"
		sec.Layers = []string{"piano", "pad", "bass"}
	case "piano":
		sec.BassPattern, sec.DrumPattern = "piano_root", "none_quiet"
		sec.Layers = []string{"piano", "melody"}
	case "jazz":
		sec.BassPattern, sec.DrumPattern = "jazz_walk", "jazz_swing"
		sec.Layers = []string{"epiano", "bass", "hat", "snare", "kick"}
	case "guofeng":
		sec.BassPattern, sec.DrumPattern = "drone_fifth", "none_quiet"
		sec.Layers = []string{"guzheng", "strings", "bass"}
	case "synthwave":
		sec.BassPattern, sec.DrumPattern = "octave_pulse", "synth_gate"
		sec.Layers = []string{"supersaw", "pluck", "bass", "kick", "snare", "hat"}
	case "cinematic":
		sec.BassPattern, sec.DrumPattern = "drone_root", "cine_pulse"
		sec.Layers = []string{"strings", "piano"}
	default: // lofi
		sec.BassPattern, sec.DrumPattern = "soft_walk", "lofi_swing"
		sec.Layers = []string{"epiano", "melody", "bass", "kick", "snare", "hat", "vinyl"}
	}

	name := sec.Name
	switch style {
	case "edm":
		switch name {
		case "intro":
			sec.BassPattern, sec.DrumPattern = "sub_pulse", "four_floor_break"
			sec.Layers = []string{"pad", "riser", "hat"}
		case "chorus":
			sec.BassPattern, sec.DrumPattern = "octave_pulse", "big_room"
			sec.Layers = []string{"supersaw", "pad", "melody", "bass", "kick", "snare", "hat", "riser"}
		case "outro":
			sec.BassPattern, sec.DrumPattern = "sub_pulse", "four_floor_break"
			sec.Layers = []string{"pad", "melody"}
		}
	case "blues":
		switch name {
		case "intro":
			sec.BassPattern, sec.DrumPattern = "root_long", "blues_slow"
			sec.Layers = []string{"organ", "hat"}
		case "chorus":
			sec.BassPattern, sec.DrumPattern = "blues_walk", "blues_stomp"
			sec.Layers = []string{"organ", "melody", "bass", "kick", "snare", "hat"}
		case "outro":
			sec.BassPattern, sec.DrumPattern = "root_long", "blues_slow"
			sec.Layers = []string{"organ", "melody"}
		}
	case "ambient":
		switch name {
		case "intro":
			sec.Layers = []string{"pad", "bass"}
		case "chorus":
			sec.Layers = []string{"piano", "pad", "melody", "bass"}
		case "outro":
			sec.Layers = []string{"pad", "bass"}
		}
	case "piano":
		switch name {
		case "intro":
			sec.Layers = []string{"piano"}
		case "outro":
			sec.Layers = []string{"piano"}
		}
	case "jazz":
		switch name {
		case "intro":
			sec.DrumPattern = "jazz_ballad"
			sec.Layers = []string{"epiano", "hat"}
		case "chorus":
			sec.Layers = []string{"epiano", "melody", "bass", "hat", "snare", "kick"}
		case "outro":
			sec.DrumPattern = "jazz_ballad"
			sec.Layers = []string{"epiano"}
		}
	case "guofeng":
		switch name {
		case "intro":
			sec.BassPattern = "drone_root"
			sec.Layers = []string{"strings"}
		case "chorus":
			sec.DrumPattern = "taiko_light"
			sec.Layers = []string{"guzheng", "dizi", "strings", "bass"}
		case "outro":
			sec.BassPattern = "drone_root"
			sec.Layers = []string{"strings"}
		}
	case "synthwave":
		switch name {
		case "intro":
			sec.BassPattern, sec.DrumPattern = "sub_pulse", "synth_break"
			sec.Layers = []string{"pad", "hat", "riser"}
		case "chorus":
			sec.Layers = []string{"supersaw", "pluck", "pad", "melody", "bass", "kick", "snare", "hat"}
		case "outro":
			sec.BassPattern, sec.DrumPattern = "sub_pulse", "synth_break"
			sec.Layers = []string{"pad"}
		}
	case "cinematic":
		switch name {
		case "intro":
			sec.Layers = []string{"strings"}
		case "chorus":
			sec.DrumPattern = "cine_impact"
			sec.Layers = []string{"strings", "piano", "melody", "kick", "riser"}
		case "outro":
			sec.Layers = []string{"strings", "piano"}
		}
	default: // lofi
		switch name {
		case "intro":
			sec.BassPattern, sec.DrumPattern = "root_long", "lofi_sparse"
			sec.Layers = []string{"epiano", "vinyl", "hat"}
		case "chorus":
			sec.BassPattern, sec.DrumPattern = "root_fifth", "lofi_dense"
			sec.Layers = []string{"epiano", "pad", "melody", "bass", "kick", "snare", "hat", "vinyl"}
		case "outro":
			sec.BassPattern, sec.DrumPattern = "root_long", "lofi_sparse"
			sec.Layers = []string{"epiano", "vinyl"}
		}
	}
}

// analyzeMood 情感词典命中统计 → 四维。基准值取中性偏暖。
func analyzeMood(text string) schema.Mood {
	score := map[string]float64{"valence": 0, "energy": 0, "tension": 0, "warmth": 0}
	for _, g := range keywordGroups {
		for _, w := range g.words {
			if containsSub(text, w) {
				score[g.dim] += g.weight // 每个词各计一次，多词自然累积
			}
		}
	}
	return schema.Mood{
		Valence: clamp01v(0.5 + score["valence"]),
		Energy:  clamp01v(0.5 + score["energy"]),
		Tension: clamp01v(0.3 + score["tension"]),
		Warmth:  clamp01v(0.55 + score["warmth"]),
	}
}

func hashSeed(s string) int64 {
	h := fnv.New64a()
	h.Write([]byte(s))
	return int64(h.Sum64())
}

func clamp01v(v float64) float64 { return math.Max(0, math.Min(1, v)) }

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clampEven(v, lo, hi int) int {
	if v < lo {
		v = lo
	}
	if v > hi {
		v = hi
	}
	if v%2 != 0 {
		v--
	}
	return v
}

func containsSub(s, sub string) bool {
	return strings.Contains(strings.ToLower(s), strings.ToLower(sub))
}
