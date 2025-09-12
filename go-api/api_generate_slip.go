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
	Sport    string  `json:"sport"`    // e.g., "NFL", "MLB"
	Mode     string  `json:"mode"`     // "Single" | "SGP" | "SGP+"
	Legs     int     `json:"legs"`     // desired legs (ignored when Single)
	Slips    int     `json:"slips"`    // requested count; we still produce one best slip
	MinOdds  float64 `json:"minOdds"`  // if >= +100, treat as overall payout lower bound
	MaxOdds  float64 `json:"maxOdds"`  // if >= +100, treat as overall payout upper bound
	Model    string  `json:"model"`    // exactly one selected model
	BoostPct float64 `json:"boostPct"` // e.g., 0, 30, 50 (percentage)
	Games    []GameDTO `json:"games"`
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
	Title           string    `json:"title"`
	Event           string    `json:"event"`
	Legs            []slipLeg `json:"legs"`
	CombinedOdds    string    `json:"combinedOdds,omitempty"`
	EstimatedPayout *struct {
		PreBoostMultiple  float64 `json:"preBoostMultiple"`
		PreBoostAmerican  string  `json:"preBoostAmerican"`
		PostBoostMultiple float64 `json:"postBoostMultiple"`
		PostBoostAmerican string  `json:"postBoostAmerican"`
		Assumptions       string  `json:"assumptions"`
	} `json:"estimatedPayout,omitempty"`
	Rationale string    `json:"rationale,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
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

/* ---------------- Handler (LIVE MODE) ---------------- */

// POST /api/generate-slip
// Calls OpenAI, logs the prompt AND what was returned, then responds with parsed JSON.
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

	prompt := buildPromptFromFilters(req.Filters)

	// ----- PRINT PROMPT (debug) -----
	log.Println("----- /api/generate-slip PROMPT -----")
	log.Printf("Filters: %+v\n", req.Filters)
	log.Println("----- BEGIN PROMPT -----")
	log.Println(prompt)
	log.Println("------ END PROMPT ------")

	// Env/config
	key := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	if key == "" {
		errorJSON(w, http.StatusInternalServerError, "server missing OPENAI_API_KEY")
		return
	}
	apiModel := strings.TrimSpace(os.Getenv("OPENAI_MODEL"))
	if apiModel == "" {
		apiModel = "gpt-5"
	}
	base := strings.TrimSpace(os.Getenv("OPENAI_BASE_URL"))
	if base == "" {
		base = "https://api.openai.com"
	}
	org := strings.TrimSpace(os.Getenv("OPENAI_ORG")) // optional

	// Build request
	body := openAIChatReq{
		Model: apiModel,
		Messages: []openAIMessage{
			{Role: "system", Content: "You must output valid JSON only. Never include markdown code fences."},
			{Role: "user", Content: prompt},
		},
		Temperature: 1, // gpt-5-mini only supports the default (1)
	}
	payload, _ := json.Marshal(body)

	httpReq, _ := http.NewRequest("POST", base+"/v1/chat/completions", bytes.NewReader(payload))
	httpReq.Header.Set("Authorization", "Bearer "+key)
	httpReq.Header.Set("Content-Type", "application/json")
	if org != "" {
		httpReq.Header.Set("OpenAI-Organization", org)
	}

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		log.Printf("[generate-slip] upstream error: %v", err)
		errorJSON(w, http.StatusBadGateway, "upstream error contacting OpenAI")
		return
	}
	defer resp.Body.Close()

	slurp, _ := io.ReadAll(resp.Body)

	// ----- PRINT RAW OPENAI BODY -----
	log.Println("----- OPENAI RAW HTTP BODY -----")
	log.Println(string(slurp))
	log.Println("----- END RAW BODY -----")

	if resp.StatusCode/100 != 2 {
		log.Printf("[generate-slip] openai non-2xx: status=%d", resp.StatusCode)
		errorJSON(w, http.StatusBadGateway, strings.TrimSpace(string(slurp)))
		return
	}

	var ai openAIChatResp
	if err := json.Unmarshal(slurp, &ai); err != nil {
		log.Printf("[generate-slip] decode error: %v; raw preserved above", err)
		errorJSON(w, http.StatusBadGateway, "bad openai response")
		return
	}
	if len(ai.Choices) == 0 {
		errorJSON(w, http.StatusBadGateway, "no choices from openai")
		return
	}

	content := strings.TrimSpace(ai.Choices[0].Message.Content)

	// ----- PRINT CHOICE CONTENT -----
	log.Println("----- OPENAI CHOICE CONTENT -----")
	log.Println(content)
	log.Println("----- END CHOICE CONTENT -----")

	// Parse model JSON -> betSlip
	var slip betSlip
	if err := json.Unmarshal([]byte(content), &slip); err != nil {
		// Fallback: still return something so UI can render
		log.Printf("[generate-slip] JSON parse failed; returning raw content as a single-leg slip")
		slip = betSlip{
			Title:     "Generated Slip",
			Event:     "",
			Legs:      []slipLeg{{Market: "Raw", Pick: content}},
			CreatedAt: time.Now().UTC(),
		}
	} else {
		slip.CreatedAt = time.Now().UTC()
	}

	// ----- PRINT PARSED SLIP (WHAT WE RETURN) -----
	if bs, err := json.MarshalIndent(slip, "", "  "); err == nil {
		log.Println("----- PARSED SLIP (SENT TO CLIENT) -----")
		log.Println(string(bs))
		log.Println("----- END PARSED SLIP -----")
	}

	writeJSON(w, http.StatusOK, slip)
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

	// Single model & sport
	model := strings.TrimSpace(f.Model)
	if model == "" {
		model = "Narrative"
	}
	sport := strings.TrimSpace(f.Sport)

	// Current time in America/Toronto to gate out already-started games
	loc, _ := time.LoadLocation("America/Toronto")
	now := time.Now().In(loc).Format("Mon Jan 2 2006 15:04 MST")

	var sb strings.Builder

	// >>> Add these lines at the very start of the prompt <<<
	sb.WriteString(fmt.Sprintf("Current time (America/Toronto): %s\n", now))
	sb.WriteString("Only use markets for games that have NOT started as of the current time above. Do not use in-play or finished games.\n")
	sb.WriteString("Populate \"event\" with the matchup plus local start date/time for the relevant game(s). For SGP+, list all games used separated by '; '.\n\n")

	if len(f.Games) > 0 {
		sb.WriteString("- Restrict all selections to these upcoming games:\n")
		for _, g := range f.Games {
			sb.WriteString(fmt.Sprintf("  • [%s] %s @ %s — starts %s (id=%s)\n",
				g.Sport, g.Away, g.Home, g.Start, g.ID))
		}
	}

	// JSON schema your UI expects (unchanged)
	sb.WriteString("Return ONLY JSON with this schema:\n")
	sb.WriteString(`{
  "title": "string",
  "event": "string",
  "legs": [
    {"market":"string","pick":"string","line":"string(optional)","odds":"string(optional)","notes":"string(optional)"}
  ],
  "combinedOdds": "string(optional)",
  "estimatedPayout": {
    "preBoostMultiple": number,
    "preBoostAmerican": "string",
    "postBoostMultiple": number,
    "postBoostAmerican": "string",
    "assumptions": "string"
  },
  "rationale": "string(optional)"
}` + "\n\n")

	// Model-specific instructions (sport-aware + payout-aware + SGP/SGP+ rules)
	sb.WriteString(promptForModel(model, legsWanted, sport, f.MinOdds, f.MaxOdds, f.BoostPct, f.Mode))
	return sb.String()
}

func promptForModel(model string, legsWanted int, sport string, minOdds, maxOdds, boostPct float64, mode string) string {
	modelKey := strings.ToLower(strings.TrimSpace(model))
	modeRules := sgpRules(mode)
	payoutBlock := payoutGuidance(minOdds, maxOdds, boostPct, legsWanted, sport)

	switch modelKey {
	case "narrative", "correlated", "narrative / correlated story":
		return fmt.Sprintf(
			`You are the "Narrative / Correlated Story" model for the sport: %s.
%s
Build a coherent script slip with exactly %d leg(s).
Base every leg on recent articles from Action Network, Covers, Oddshark, or Hero Sports (no sportsbook blogs).
For each leg, include a short "notes" rationale that stitches the story; avoid redundant overlap (e.g., same-team ML + alt spread).
Set "title": "Narrative SGP".
%s`, sport, modeRules, legsWanted, payoutBlock)

	case "weird", "obscure", "weird / obscure angles":
		return fmt.Sprintf(
			`You are the "Weird / Obscure Angles" model for the sport: %s.
%s
Create exactly %d leg(s) from article-backed picks (Action Network / Covers / Oddshark / Hero Sports only).
For each leg, add one quirky but real support in "notes" (e.g., umpire zone, Statcast pitch-type vs hitter, travel/park wind).
Avoid conflicts.
Title: "Weird Angles SGP".
%s`, sport, modeRules, legsWanted, payoutBlock)

	case "random", "controlled randomness", "controlled randomness (for exploration)":
		return fmt.Sprintf(
			`You are the "Controlled Randomness" model for the sport: %s.
%s
From ~15 recent article-backed picks (Action Network / Covers / Oddshark / Hero Sports), transparently randomize to choose exactly %d leg(s).
Exclude in-play, heavy juice (<−140), or conflicting markets. In "notes", include selection index/seed and a quick sanity check.
Title: "Controlled Random SGP".
%s`, sport, modeRules, legsWanted, payoutBlock)

	case "contrarian", "market-based", "market-based / contrarian (fade the crowd)":
		return fmt.Sprintf(
			`You are the "Market-Based / Contrarian" model for the sport: %s.
%s
Select exactly %d leg(s) where market signals disagree with public consensus (reverse line moves, handle≠tickets, computer pick vs public).
For each leg, add a 'market quirk' in "notes": %% tickets vs %% handle, opener→current, off-market pockets. Avoid redundant correlations.
Base legs on articles from Action Network / Covers / Oddshark / Hero Sports.
Title: "Contrarian SGP".
%s`, sport, modeRules, legsWanted, payoutBlock)

	case "micro-edges", "micro", "micro edges", "micro-edges (injury/bullpen/park micro)":
		return fmt.Sprintf(
			`You are the "Micro-Edges" model for the sport: %s.
%s
Choose exactly %d leg(s) where the edge is micro: bullpen fatigue (L3D), catcher framing/SB game, park & weather, defensive alignment quirks.
Each leg must originate from Action Network / Covers / Oddshark / Hero Sports; put the micro rationale in "notes".
Title: "Micro-Edges SGP".
%s`, sport, modeRules, legsWanted, payoutBlock)

	case "pessimist", "underminer", "pessimist / “underminer” (lean under on purpose)":
		return fmt.Sprintf(
			`You are the "Pessimist / Underminer" model for the sport: %s.
%s
Bias to UNDERS or less-happens outcomes. Build exactly %d leg(s) from article-backed picks (Action Network / Covers / Oddshark / Hero Sports).
If the exact Under isn’t available, choose the nearest alt-under. In "notes", add an extra pessimist check (weather drag, tight zone, fatigue, hidden regression, elite framer).
Provide a short "rationale" summarizing the pessimistic script.
Title: "Pessimist SGP".
%s`, sport, modeRules, legsWanted, payoutBlock)

	case "heat-check", "heat check", "heat-check / regression (fade the hot streak)":
		return fmt.Sprintf(
			`You are the "Heat-Check / Regression" model for the sport: %s.
%s
Focus on fading hot streaks. Build exactly %d leg(s) from article-backed picks (Action Network / Covers / Oddshark / Hero Sports).
Add a "heat-check test" in "notes" (e.g., xwOBA−wOBA gap, xERA≫ERA, HR/FB%% spike, BABIP luck, opponent 3PT luck).
Provide a brief "rationale" for the regression thesis.
Title: "Heat-Check SGP".
%s`, sport, modeRules, legsWanted, payoutBlock)

	default:
		return fmt.Sprintf(
			`You are the "Narrative / Correlated Story" model (default) for the sport: %s.
%s
Build exactly %d coherent leg(s) from Action Network / Covers / Oddshark / Hero Sports. Use "notes" to stitch a single game script.
Title: "Narrative SGP".
%s`, sport, modeRules, legsWanted, payoutBlock)
	}
}

// Adds explicit constraints for Single / SGP / SGP+ to be included in each model wrapper.
func sgpRules(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "single":
		return "- Bet type rules: SINGLE — one standalone selection (not a parlay). Ignore SGP/SGP+ constraints."
	case "sgp":
		return "- Bet type rules: SGP — Legs can be from different games or the same game."
	case "sgp+":
		return "- Bet type rules: SGP+ — At least TWO legs must come from the SAME specific game; remaining legs may be from distinct games. Clearly indicate which legs share the same game."
	default:
		return "- Bet type rules: (unspecified) default to SGP behavior unless impossible."
	}
}

// Shared payout guidance appended to every model wrapper.
func payoutGuidance(minOdds, maxOdds, boostPct float64, legs int, sport string) string {
	var b strings.Builder
	b.WriteString("\nPayout estimation instructions:\n")
	b.WriteString("- Convert each leg's American odds o to decimal multiple m: if o >= 0 then m = 1 + (o/100); if o < 0 then m = 1 + (100/|o|).\n")
	b.WriteString("- Multiply all m across the ")
	b.WriteString(fmt.Sprintf("%d", legs))
	b.WriteString(" legs to get parlayMultiple.\n")
	b.WriteString("- Apply an SGP correlation tax τ in [0.85, 0.95] (use 0.92 by default) → preBoostMultiple = parlayMultiple × τ.\n")
	if boostPct > 0 {
		b.WriteString(fmt.Sprintf("- Apply the sportsbook boost AFTER tax: postBoostMultiple = preBoostMultiple × (1 + %.0f/100).\n", boostPct))
	} else {
		b.WriteString("- No boost: postBoostMultiple = preBoostMultiple.\n")
	}
	b.WriteString("- Convert multiples to American odds (usually positive for parlays): american = '+' + round((multiple−1)×100).\n")
	if minOdds >= 100 || maxOdds >= 100 {
		b.WriteString("- Try to keep the POST-BOOST American payout within the user range ")
		if minOdds >= 100 && maxOdds >= 100 {
			b.WriteString(fmt.Sprintf("[+%.0f, +%.0f]", minOdds, maxOdds))
		} else if minOdds >= 100 {
			b.WriteString(fmt.Sprintf("[≥ +%.0f]", minOdds))
		} else {
			b.WriteString(fmt.Sprintf("[≤ +%.0f]", maxOdds))
		}
		b.WriteString(" if reasonable; it's okay to exceed modestly when leg count or sport constraints require it.\n")
	}
	b.WriteString("- Populate \"estimatedPayout\" with preBoostMultiple, preBoostAmerican, postBoostMultiple, postBoostAmerican, and a one-line 'assumptions' summary (leg prices used, τ value, boost applied).\n")
	return b.String()
}

func orDefault(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}
