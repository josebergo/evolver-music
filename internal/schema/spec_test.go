package schema

import (
	"encoding/json"
	"testing"
)

func TestParseChord(t *testing.T) {
	cases := []struct {
		in           string
		root         int
		quality      string
		ok           bool
	}{
		{"Bm7", 11, "m7", true},
		{"Gmaj7", 7, "maj7", true},
		{"D", 2, "", true},
		{"A7", 9, "7", true},
		{"F#m", 6, "m", true},
		{"Bbm", 10, "m", true},
		{"Csus2", 0, "sus2", true},
		{"Hm7", 0, "", false},  // 德式音名不支持
		{"Bm9", 0, "", false},  // 9 和弦 M1 不支持
		{"", 0, "", false},
		{"Cmaj9", 0, "", false},
	}
	for _, c := range cases {
		root, quality, ok := ParseChord(c.in)
		if ok != c.ok || (ok && (root != c.root || quality != c.quality)) {
			t.Errorf("ParseChord(%q) = (%d,%q,%v), want (%d,%q,%v)", c.in, root, quality, ok, c.root, c.quality, c.ok)
		}
	}
}

func TestParseKey(t *testing.T) {
	if pc, minor, ok := ParseKey("F#m"); !ok || pc != 6 || !minor {
		t.Errorf("ParseKey(F#m) = %d,%v,%v", pc, minor, ok)
	}
	if pc, minor, ok := ParseKey("Eb"); !ok || pc != 3 || minor {
		t.Errorf("ParseKey(Eb) = %d,%v,%v", pc, minor, ok)
	}
	if _, _, ok := ParseKey("Xm"); ok {
		t.Error("ParseKey(Xm) 应失败")
	}
}

const goodSpec = `{
  "mood": {"valence":0.35,"energy":0.25,"tension":0.2,"warmth":0.6},
  "style":"lofi","tempo":85,"key":"Bm","seed":42,
  "sections":[
    {"name":"intro","bars":4,"energy":0.3,"chords":["Bm7","Gmaj7"],"bassPattern":"root_long","drumPattern":"lofi_sparse","layers":["epiano","vinyl","hat"]},
    {"name":"verse","bars":8,"energy":0.55,"chords":["Bm7","Gmaj7","D","A7"],"bassPattern":"soft_walk","drumPattern":"lofi_swing","layers":["epiano","melody","bass","kick","snare","hat","vinyl"]},
    {"name":"chorus","bars":8,"energy":0.85,"chords":["Bm7","Gmaj7","D","A7"],"bassPattern":"root_fifth","drumPattern":"lofi_dense","layers":["epiano","pad","melody","bass","kick","snare","hat","vinyl"]},
    {"name":"outro","bars":4,"energy":0.3,"chords":["Bm7","Gmaj7"],"bassPattern":"root_long","drumPattern":"lofi_sparse","layers":["epiano","vinyl"]}
  ],
  "mix":{"reverb":0.4,"sidechain":0,"lofiCharacter":0.7}
}`

func mustSpec(t *testing.T, raw string) *MusicSpec {
	t.Helper()
	var s MusicSpec
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return &s
}

func TestValidateGood(t *testing.T) {
	if err := mustSpec(t, goodSpec).Validate(); err != nil {
		t.Errorf("合法规格不应报错: %v", err)
	}
}

func TestValidateBad(t *testing.T) {
	cases := map[string]func(*MusicSpec){
		"tempo越界":  func(s *MusicSpec) { s.Tempo = 140 },
		"非法和弦":   func(s *MusicSpec) { s.Sections[0].Chords[0] = "X#m9" },
		"非法节奏型":  func(s *MusicSpec) { s.Sections[1].DrumPattern = "rock" },
		"重复段落":   func(s *MusicSpec) { s.Sections[1].Name = "intro" },
		"心情越界":   func(s *MusicSpec) { s.Mood.Valence = 1.5 },
		"未知风格":   func(s *MusicSpec) { s.Style = "jazz" },
	}
	for name, mutate := range cases {
		s := mustSpec(t, goodSpec)
		mutate(s)
		if err := s.Validate(); err == nil {
			t.Errorf("%s: 应校验失败", name)
		}
	}
}

func TestRepairFixesEverything(t *testing.T) {
	bad := mustSpec(t, `{
	  "mood":{"valence":9,"energy":-3,"tension":0.5,"warmth":0.5},
	  "style":"heavy-metal","tempo":999,"key":"Zm","seed":1,
	  "sections":[{"name":"drop","bars":0,"energy":5,"chords":["Y#m11"],"bassPattern":"wobble","drumPattern":"blast","layers":["guitar"]}],
	  "mix":{"reverb":8,"sidechain":-1,"lofiCharacter":0.5}
	}`)
	bad.Repair()
	if err := bad.Validate(); err != nil {
		t.Fatalf("Repair 后仍不合法: %v", err)
	}
}

func TestDurationSec(t *testing.T) {
	s := mustSpec(t, goodSpec) // 24 小节 @85bpm
	want := 24 * 4 * 60.0 / 85
	if got := s.DurationSec(); got < want-0.01 || got > want+0.01 {
		t.Errorf("DurationSec = %v, want %v", got, want)
	}
}
