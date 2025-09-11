package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
)

/* ---------------- Request / Filters ---------------- */

type generateSlipRequest struct {
	Filters GenerateFilters `json:"filters"`
}

type GenerateFilters struct {
	Sport     string  `json:"sport"`     // e.g., "NFL", "MLB"
	Mode      string  `json:"mode"`      // "Single" | "SGP" | "SGP+"
	Legs      int     `json:"legs"`      // desired legs (ignored when Single)
	Slips     int     `json:"slips"`     // requested count; we still produce one best slip in test
	MinOdds   float64 `json:"minOdds"`   // if >= +100, treat as overall payout lower bound
	MaxOdds   float64 `json:"maxOdds"`   // if >= +100, treat as overall payout upper bound
	Model     string  `json:"model"`     // exactly one selected model
	BoostPct  float64 `json:"boostPct"`  // NEW: e.g., 0, 30, 50 (percentage)
}

/* ---------------- Handler (TEST MODE) ---------------- */

// TEST MODE: does not call OpenAI. Builds the prompt, prints it to terminal,
// and returns it as JSON so you can also see it in the browser/Network tab.
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

	// Build prompt
	prompt := buildPromptFromFilters(req.Filters)

	// ---------- PRINT TO TERMINAL ----------
	log.Println("----- /api/generate-slip TEST PROMPT -----")
	log.Printf("Filters: %+v\n", req.Filters)
	log.Println("----- BEGIN PROMPT -----")
	log.Println(prompt)
	log.Println("------ END PROMPT ------")
	// --------------------------------------

	// Also return it so you can read it in your browser / Network tab.
	writeJSON(w, http.StatusOK, map[string]any{
		"prompt": prompt,
	})
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

	// Determine if min/max look like overall payout bounds (positive American)
	minPayoutBound := ""
	maxPayoutBound := ""
	if f.MinOdds >= 100 {
		minPayoutBound = fmt.Sprintf("+%.0f", f.MinOdds)
	}
	if f.MaxOdds >= 100 {
		maxPayoutBound = fmt.Sprintf("+%.0f", f.MaxOdds)
	}

	var sb strings.Builder

	// JSON schema your UI will expect once you flip back to real generations
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

	// Context = ONLY the fields your page supplies
	if sport != "" {
		sb.WriteString("- Sport: " + sport + "\n")
	}
	sb.WriteString("- Mode: " + orDefault(f.Mode, "SGP") + "\n")
	sb.WriteString(fmt.Sprintf("- Desired legs: %d\n", legsWanted))
	if f.Slips > 0 {
		sb.WriteString(fmt.Sprintf("- User requested %d slip(s); return ONE best slip.\n", f.Slips))
	}

	// If caller wants overall payout bounds (positive American), hint the target range
	if minPayoutBound != "" || maxPayoutBound != "" {
		sb.WriteString("- Target final payout (American) after applying SGP tax and then boost: ")
		if minPayoutBound != "" && maxPayoutBound != "" {
			sb.WriteString(fmt.Sprintf("%s to %s (okay to exceed modestly if leg count forces it)\n", minPayoutBound, maxPayoutBound))
		} else if minPayoutBound != "" {
			sb.WriteString(fmt.Sprintf(">= %s (okay to exceed modestly)\n", minPayoutBound))
		} else {
			sb.WriteString(fmt.Sprintf("<= %s (okay to exceed modestly)\n", maxPayoutBound))
		}
	}

	// Boost guidance
	if f.BoostPct > 0 {
		sb.WriteString(fmt.Sprintf("- Sportsbook boost to apply AFTER SGP tax: %.0f%%\n", f.BoostPct))
	} else {
		sb.WriteString("- No sportsbook boost (boostPct = 0)\n")
	}
	sb.WriteString("\n")

	// Attach the model-specific instructions (sport-aware + payout-aware + SGP/SGP+ rules)
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
Build a coherent game-script slip with exactly %d leg(s) around −105 to −125 each when possible.
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
Keep legs near −110 and avoid conflicts.
Title: "Weird Angles SGP".
%s`, sport, modeRules, legsWanted, payoutBlock)

	case "random", "controlled randomness", "controlled randomness (for exploration)":
		return fmt.Sprintf(
			`You are the "Controlled Randomness" model for the sport: %s.
%s
From ~15 recent article-backed picks (Action Network / Covers / Oddshark / Hero Sports), transparently randomize to choose exactly %d leg(s).
Exclude in-play, heavy juice (<−140), or conflicting markets. In "notes", include selection index/seed and a quick sanity check.
Keep around −110.
Title: "Controlled Random SGP".
%s`, sport, modeRules, legsWanted, payoutBlock)

	case "contrarian", "market-based", "market-based / contrarian (fade the crowd)":
		return fmt.Sprintf(
			`You are the "Market-Based / Contrarian" model for the sport: %s.
%s
Select exactly %d leg(s) where market signals disagree with public consensus (reverse line moves, handle≠tickets, computer pick vs public).
For each leg, add a 'market quirk' in "notes": %% tickets vs %% handle, opener→current, off-market pockets. Keep ~−110; avoid redundant correlations.
Base legs on articles from Action Network / Covers / Oddshark / Hero Sports.
Title: "Contrarian SGP".
%s`, sport, modeRules, legsWanted, payoutBlock)

	case "micro-edges", "micro", "micro edges", "micro-edges (injury/bullpen/park micro)":
		return fmt.Sprintf(
			`You are the "Micro-Edges" model for the sport: %s.
%s
Choose exactly %d leg(s) where the edge is micro: bullpen fatigue (L3D), catcher framing/SB game, park & weather, defensive alignment quirks.
Each leg must originate from Action Network / Covers / Oddshark / Hero Sports; put the micro rationale in "notes". Keep ~−110.
Title: "Micro-Edges SGP".
%s`, sport, modeRules, legsWanted, payoutBlock)

	case "pessimist", "underminer", "pessimist / “underminer” (lean under on purpose)":
		return fmt.Sprintf(
			`You are the "Pessimist / Underminer" model for the sport: %s.
%s
Bias to UNDERS or less-happens outcomes. Build exactly %d leg(s) from article-backed picks (Action Network / Covers / Oddshark / Hero Sports).
If the exact Under isn’t available, choose the nearest alt-under to keep legs ~−105 to −125. In "notes", add an extra pessimist check (weather drag, tight zone, fatigue, hidden regression, elite framer).
Provide a short "rationale" summarizing the pessimistic script.
Title: "Pessimist SGP".
%s`, sport, modeRules, legsWanted, payoutBlock)

	case "heat-check", "heat check", "heat-check / regression (fade the hot streak)":
		return fmt.Sprintf(
			`You are the "Heat-Check / Regression" model for the sport: %s.
%s
Focus on fading hot streaks. Build exactly %d leg(s) from article-backed picks (Action Network / Covers / Oddshark / Hero Sports).
Keep ~−105 to −125 (use alt lines if needed) and add a "heat-check test" in "notes" (e.g., xwOBA−wOBA gap, xERA≫ERA, HR/FB%% spike, BABIP luck, opponent 3PT luck).
Provide a brief "rationale" for the regression thesis.
Title: "Heat-Check SGP".
%s`, sport, modeRules, legsWanted, payoutBlock)

	default:
		return fmt.Sprintf(
			`You are the "Narrative / Correlated Story" model (default) for the sport: %s.
%s
Build exactly %d coherent leg(s) ~−105 to −125 from Action Network / Covers / Oddshark / Hero Sports. Use "notes" to stitch a single game script.
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
		return "- Bet type rules: SGP — ALL legs must be from the SAME game (a true same-game parlay)."
	case "sgp+":
		return "- Bet type rules: SGP+ — At least TWO legs must come from the SAME specific game; remaining legs may be from distinct games. Clearly indicate which legs share the same game."
	default:
		return "- Bet type rules: (unspecified) default to SGP behavior unless impossible."
	}
}

// Shared payout guidance appended to every model wrapper.
// Describes: SGP "tax", optional boostPct, decimal conversion, and keeping within bounds when provided.
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
