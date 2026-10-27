// Package ai 实现"心情文本 → 音乐规格"的两条路径：
//  1. Provider：调用 OpenAI 兼容接口（默认智谱 GLM Flash 免费模型）
//  2. Fallback：纯本地情感词典 + 风格配方（离线可用，永不失败）
package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"evolver-music/internal/schema"
)

// Provider 调用 OpenAI 兼容的 chat/completions 接口生成音乐规格。
type Provider struct {
	BaseURL string // 如 https://open.bigmodel.cn/api/paas/v4
	APIKey  string
	Model   string // 如 glm-4-flash
	Client  *http.Client
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	Temperature float64       `json:"temperature"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Code    any    `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// Compose 调用模型生成规格：先严格校验，失败则 Repair 后再校验一次，
// 仍失败则返回错误（由上层降级到本地引擎）。
func (p *Provider) Compose(ctx context.Context, opts ComposeInput) (*schema.MusicSpec, error) {
	if p.APIKey == "" {
		return nil, fmt.Errorf("未配置 API Key")
	}
	sys, user := buildPrompt(opts)
	reqBody := chatRequest{
		Model: p.Model,
		Messages: []chatMessage{
			{Role: "system", Content: sys},
			{Role: "user", Content: user},
		},
		Temperature: 0.85,
	}
	raw, err := p.chat(ctx, reqBody)
	if err != nil {
		return nil, err
	}
	spec, err := parseSpec(raw)
	if err != nil {
		return nil, err
	}
	if err := spec.Validate(); err != nil {
		spec.Repair()
		if err := spec.Validate(); err != nil {
			return nil, fmt.Errorf("模型输出修复后仍不合法: %w", err)
		}
	}
	return spec, nil
}

func (p *Provider) chat(ctx context.Context, body chatRequest) (string, error) {
	client := p.Client
	if client == nil {
		client = &http.Client{Timeout: 90 * time.Second}
	}
	data, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	url := strings.TrimRight(p.BaseURL, "/") + "/chat/completions"
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.APIKey)

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()
	out, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncate(string(out), 200))
	}
	var cr chatResponse
	if err := json.Unmarshal(out, &cr); err != nil {
		return "", fmt.Errorf("响应解析失败: %w", err)
	}
	if cr.Error != nil {
		return "", fmt.Errorf("接口错误: %s", cr.Error.Message)
	}
	if len(cr.Choices) == 0 || strings.TrimSpace(cr.Choices[0].Message.Content) == "" {
		return "", fmt.Errorf("空响应")
	}
	return cr.Choices[0].Message.Content, nil
}

// parseSpec 从模型输出中稳健提取 JSON（容忍 markdown 代码块、前后闲话）。
func parseSpec(raw string) (*schema.MusicSpec, error) {
	text := strings.TrimSpace(raw)
	text = strings.ReplaceAll(text, "```json", "```")
	if i := strings.Index(text, "```"); i >= 0 {
		if j := strings.Index(text[i+3:], "```"); j >= 0 {
			text = text[i+3 : i+3+j]
		}
	}
	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return nil, fmt.Errorf("输出中找不到 JSON")
	}
	var spec schema.MusicSpec
	if err := json.Unmarshal([]byte(text[start:end+1]), &spec); err != nil {
		return nil, fmt.Errorf("JSON 解析失败: %w", err)
	}
	return &spec, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
