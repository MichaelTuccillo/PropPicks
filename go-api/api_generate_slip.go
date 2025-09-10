package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

/* ---------------- Request / Filters ---------------- */

type generateSlipRequest struct {
	Filters GenerateFilters `json:"filters"`
}

type GenerateFilters struct {
	Sport   string  `json:"sport"`            // e.g., "MLB"
	Mode    string  `json:"mode"`             // "Single" | "SGP" | "SGP+"
	Legs    int     `json:"legs"`             // desired legs (ignored when Single)
	Slips   int     `json:"slips"`            // user asked for N; server still returns ONE best slip
	MinOdds float64 `json:"minOdds"`          // e.g., -120
	MaxOdds float64 `json:"maxOdds"`          // e.g., +200
	Model   string  `json:"model"`            // exactly one selected model
}

/* ---------------- Model Output ---------------- */

type slipLeg struct {
	Market string `json:"market"`
	Pick   string `json:"pick"`
	Line   string `json:"line,omitempty"`
	Odds   string `json:"odds,omitempty"`
	Notes  string `json:"notes,omitempty"`
}

type betSlip struct {
	Title        string    `json:"title"`
	Event        string    `json:"event"`
	Legs         []slipLeg `json:"legs"`
	CombinedOdds string    `json:"combinedOdds,omitempty"`
	Rationale    string    `json:"rationale,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}

/* ---------------- OpenAI payloads ---------------- */

type openAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIChatReq struct {
	Model       string          `json:"model"`
	Messages    []openAIMessage `json:"messages"`
	Temperature float32         `json:"temperature,omitempty"`
}

type openAIChatResp struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

/* ---------------- Handler ---------------- */

func handleGenerateSlip(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		errorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req generateSlipRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		errorJSON(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	key := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if key == "" {
		errorJSON(w, http.StatusInternalServerError, "server missing OPENAI_API_KEY")
		return
	}
	apiModel := strings.TrimSpace(os.Getenv("OPENAI_MODEL"))
	if apiModel == "" {
		apiModel = "gpt-4o-mini"
	}
	base := strings.TrimSpace(os.Getenv("OPENAI_BASE_URL"))
	if base == "" {
		base = "https://api.openai.com"
	}
	org := strings.TrimSpace(os.Getenv("OPENAI_ORG")) // optional

	userPrompt := buildPromptFromFilters(req.Filters)

	body := openAIChatReq{
		Model: apiModel,
		Messages: []openAIMessage{
			{Role: "system", Content: "You must output valid JSON only. Never include markdown code fences."},
			{Role: "user", Content: userPrompt},
		},
		Temperature: 0.3,
	}

	payload, _ := json.Marshal(body)
	httpReq, _ := http.NewRequest("POST", base+"/v1/chat/completions", bytes.NewReader(payload))
	httpReq.Header.Set("Authorization", "Bearer "+key)
	httpReq.Header.Set("Content-Type", "application/json")
	if org != "" {
		httpReq.Header.Set("OpenAI-Organization", org)
	}

	client := &http.Client{Timeout: 45 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		log.Printf("[generate-slip] upstream error: %v", err)
		errorJSON(w, http.StatusBadGateway, "upstream error contacting OpenAI")
		return
	}
	defer resp.Body.Close()

	slurp, _ := io.ReadAll(resp.Body)
	if resp.StatusCode/100 != 2 {
		log.Printf("[generate-slip] openai non-2xx: status=%d body=%s", resp.StatusCode, string(slurp))
		errorJSON(w, http.StatusBadGateway, strings.TrimSpace(string(slurp)))
		return
	}

	var ai openAIChatResp
	if err := json.Unmarshal(slurp, &ai); err != nil {
		log.Printf("[generate-slip] decode error: %v; raw=%s", err, string(slurp))
		errorJSON(w, http.StatusBadGateway, "bad openai response")
		return
	}
	if len(ai.Choices) == 0 {
		errorJSON(w, http.StatusBadGateway, "no choices from openai")
		return
	}
	content := strings.TrimSpace(ai.Choices[0].Message.Content)

	var slip betSlip
	if err := json.Unmarshal([]byte(content), &slip); err != nil {
		// Fallback so UI still renders something
		slip = betSlip{
			Title:     "Generated Slip",
			Event:     "",
			Legs:      []slipLeg{{Market: "Raw", Pick: content}},
			CreatedAt: time.Now().UTC(),
		}
	} else {
		slip.CreatedAt = time.Now().UTC()
	}

	writeJSON(w, http.StatusOK, slip) // uses your existing helper signature
}

/* ---------------- Prompt Builder (model-aware) ---------------- */

func buildPromptFromFilters(f GenerateFilters) string {
	// Legs based on mode
	legsWanted := 3
	switch strings.ToLower(strings.TrimSpace(f.Mode)) {
	case "single":
		legsWanted = 1
	default:
		if f.Legs > 0 {
			legsWanted = f.Legs
		}
	}

	// Model
	model := strings.TrimSpace(f.Model)
	if model == "" {
		model = "Narrative"
	}

	var sb strings.Builder

	// JSON schema (the format your Angular UI expects)
	sb.WriteString("Return ONLY JSON with this schema:\n")
	sb.WriteString(`{
  "title": "string",
  "event": "string",
  "legs": [
    {"market":"string","pick":"string","line":"string(optional)","odds":"string(optional)","notes":"string(optional)"}
  ],
  "combinedOdds": "string(optional)",
  "rationale": "string(optional)"
}` + "\n\n")

	// Context = ONLY the fields your page supplies
	if s := strings.TrimSpace(f.Sport); s != "" {
		sb.WriteString("- Sport: " + s + "\n")
	}
	sb.WriteString("- Mode: " + orDefault(f.Mode, "SGP") + "\n")
	sb.WriteString(fmt.Sprintf("- Desired legs: %d\n", legsWanted))
	if f.MinOdds != 0 || f.MaxOdds != 0 {
		sb.WriteString("- Odds range preference: ")
		if f.MinOdds != 0 {
			sb.WriteString(fmt.Sprintf("min %.0f ", f.MinOdds))
		}
		if f.MaxOdds != 0 {
			sb.WriteString(fmt.Sprintf("max %.0f ", f.MaxOdds))
		}
		sb.WriteString("\n")
	}
	if f.Slips > 0 {
		sb.WriteString(fmt.Sprintf("- User requested %d slip(s); return ONE best slip.\n", f.Slips))
	}
	sb.WriteString("\n")

	// Model-specific prompting
	sb.WriteString(promptForModel(model, legsWanted))
	return sb.String()
}

func promptForModel(model string, legsWanted int) string {
	switch strings.ToLower(strings.TrimSpace(model)) {
	case "narrative", "correlated", "narrative / correlated story":
		return fmt.Sprintf(`You are the "Narrative / Correlated Story" model.
Build a coherent game-script slip with %d leg(s) around −105 to −125 each.
Base every leg on recent articles from Action Network, Covers, Oddshark, or Hero Sports (no sportsbook blogs).
For each leg, include a short "notes" rationale that stitches the story; avoid redundant overlap (e.g., same-team ML + alt spread).
Set "title": "Narrative SGP".`, legsWanted)

	case "weird", "obscure", "weird / obscure angles":
		return fmt.Sprintf(`You are the "Weird / Obscure Angles" model.
Create %d leg(s) from article-backed picks (Action Network / Covers / Oddshark / Hero Sports only).
For each leg, add one quirky but real support in "notes" (e.g., umpire zone, Statcast pitch-type vs hitter, travel/park wind).
Keep legs near −110; avoid conflicts. Title: "Weird Angles SGP".`, legsWanted)

	case "random", "controlled randomness":
		return fmt.Sprintf(`You are the "Controlled Randomness" model.
From ~15 recent article-backed picks (Action Network / Covers / Oddshark / Hero Sports), transparently randomize to choose %d leg(s).
Exclude in-play, heavy juice (<−140), or conflicting markets. Put selection index/seed in "notes" with a quick sanity check.
Keep around −110. Title: "Controlled Random SGP".`, legsWanted)

	case "contrarian", "market-based":
		return fmt.Sprintf(`You are the "Market-Based / Contrarian" model.
Select %d leg(s) where market signals disagree with public consensus (reverse line moves, handle≠tickets, computer pick vs public).
For each leg, add a 'market quirk' in "notes": %% tickets vs %% handle, opener→current, off-market pockets. Keep ~−110.
Base legs on articles from Action Network / Covers / Oddshark / Hero Sports. Title: "Contrarian SGP".`, legsWanted)

	case "micro-edges", "micro":
		return fmt.Sprintf(`You are the "Micro-Edges" model.
Choose %d leg(s) where the edge is micro: bullpen fatigue (L3D), catcher framing/SB game, park & weather, defensive alignment quirks.
Each leg must originate from Action Network / Covers / Oddshark / Hero Sports; put the micro rationale in "notes". Keep ~−110.
Title: "Micro-Edges SGP".`, legsWanted)

	case "pessimist", "underminer":
		return fmt.Sprintf(`You are the "Pessimist / Underminer" model.
Bias to UNDERS or less-happens outcomes. Build %d leg(s) from article-backed picks (Action Network / Covers / Oddshark / Hero Sports).
If the exact Under isn’t available, choose the nearest alt-under to keep legs ~−105 to −125. In "notes", add an extra pessimist check (weather drag, tight zone, fatigue, hidden regression, elite framer).
Provide a short "rationale" summarizing the pessimistic script. Title: "Pessimist SGP".`, legsWanted)

	case "heat-check", "heat check":
		return fmt.Sprintf(`You are the "Heat-Check / Regression" model.
Focus on fading hot streaks. Build %d leg(s) from article-backed picks (Action Network / Covers / Oddshark / Hero Sports).
Keep ~−105 to −125 (use alt lines if needed) and add a "heat-check test" in "notes" (e.g., xwOBA−wOBA gap, xERA≫ERA, HR/FB%% spike, BABIP luck, opponent 3PT luck).
Provide a brief "rationale" for the regression thesis. Title: "Heat-Check SGP".`, legsWanted)

	default:
		return fmt.Sprintf(`You are the "Narrative / Correlated Story" model (default).
Build %d coherent leg(s) ~−105 to −125 from Action Network / Covers / Oddshark / Hero Sports. Use "notes" to stitch a single game script.
Title: "Narrative SGP".`, legsWanted)
	}
}

func orDefault(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}
