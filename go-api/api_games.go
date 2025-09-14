package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

/* ---------- Shared DTO with frontend ---------- */

type GameDTO struct {
	ID    string `json:"id"`
	Sport string `json:"sport"`
	Start string `json:"start"` // RFC3339
	Home  string `json:"home"`
	Away  string `json:"away"`
	Label string `json:"label"`
}

/* ---------- Route: GET /api/games ---------- */

func handleListGames(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	sport := strings.ToUpper(strings.TrimSpace(q.Get("sport")))
	if sport == "" {
		errorJSON(w, http.StatusBadRequest, "missing sport")
		return
	}

	days := 7
	if v := strings.TrimSpace(q.Get("days")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 1 && n <= 30 {
			days = n
		}
	}

	start := time.Now().UTC()
	end := start.Add(time.Duration(days) * 24 * time.Hour)

	var (
		out []GameDTO
		err error
	)
	switch sport {
	case "NBA":
		out, err = fetchESPNGames("basketball/nba", "NBA", start, end)
	case "NFL":
		out, err = fetchESPNGames("football/nfl", "NFL", start, end)
	case "NHL":
		out, err = fetchESPNGames("hockey/nhl", "NHL", start, end)
	case "MLB":
		out, err = fetchESPNGames("baseball/mlb", "MLB", start, end)
	default:
		errorJSON(w, http.StatusBadRequest, "unsupported sport (use NBA, NFL, NHL, MLB)")
		return
	}

	if err != nil {
		log.Printf("[games] %s error: %v", sport, err)
		errorJSON(w, http.StatusBadGateway, "failed to fetch games")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"games": out})
}

/* ---------- ESPN Scoreboard provider (free, no key) ---------- */
/*
Correct endpoint:
https://site.api.espn.com/apis/site/v2/sports/{sportPath}/scoreboard?dates=YYYYMMDD
We query each day in the window and merge.
*/

type espnScoreboard struct {
	Events []struct {
		ID   string `json:"id"`
		Date string `json:"date"`

		Competitions []struct {
			Date        string `json:"date"`
			Competitors []struct {
				HomeAway string `json:"homeAway"`
				Team     struct {
					DisplayName      string `json:"displayName"`
					ShortDisplayName string `json:"shortDisplayName"`
				} `json:"team"`
			} `json:"competitors"`
		} `json:"competitions"`
	} `json:"events"`
}

func fetchESPNGames(sportPath, sportLabel string, start, end time.Time) ([]GameDTO, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	byID := make(map[string]GameDTO)
	hadErr := false

	buildURL := func(ds string) string {
		u := url.URL{
			Scheme: "https",
			Host:   "site.api.espn.com",
			Path:   "/apis/site/v2/sports/" + sportPath + "/scoreboard",
		}
		q := u.Query()
		q.Set("dates", ds)
		u.RawQuery = q.Encode()
		return u.String()
	}

	day := start.Truncate(24 * time.Hour)
	for !day.After(end) {
		ds := day.Format("20060102") // YYYYMMDD
		urlStr := buildURL(ds)

		req, _ := http.NewRequest("GET", urlStr, nil)
		req.Header.Set("User-Agent", "PropPicks/1.0 (+https://proppicks.local)")
		req.Header.Set("Accept", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			hadErr = true
			log.Printf("[espn] %s request failed for %s: %v", sportLabel, ds, err)
			day = day.Add(24 * time.Hour)
			continue
		}

		func() {
			defer resp.Body.Close()

			if resp.StatusCode/100 != 2 {
				hadErr = true
				b, _ := io.ReadAll(resp.Body)
				snip := string(b)
				if len(snip) > 240 {
					snip = snip[:240]
				}
				log.Printf("[espn] %s %s status=%d body=%q", sportLabel, ds, resp.StatusCode, snip)
				return
			}

			var sb espnScoreboard
			if err := json.NewDecoder(resp.Body).Decode(&sb); err != nil {
				hadErr = true
				log.Printf("[espn] decode %s failed for %s: %v", sportLabel, ds, err)
				return
			}

			for _, ev := range sb.Events {
				home := ""
				away := ""
				if len(ev.Competitions) > 0 {
					for _, c := range ev.Competitions[0].Competitors {
						name := c.Team.DisplayName
						if name == "" {
							name = c.Team.ShortDisplayName
						}
						if strings.ToLower(c.HomeAway) == "home" {
							home = name
						} else {
							away = name
						}
					}
				}

				// Robust date parsing
				t, ok := parseESPNTime(ev.Date)
				if !ok && len(ev.Competitions) > 0 {
					t, ok = parseESPNTime(ev.Competitions[0].Date)
				}
				if !ok {
					hadErr = true
					compDate := ""
					if len(ev.Competitions) > 0 {
						compDate = ev.Competitions[0].Date
					}
					log.Printf("[espn] %s %s: could not parse time (event.id=%s, event.date=%q, comp.date=%q)",
						sportLabel, ds, ev.ID, ev.Date, compDate)
					continue
				}

				// Convert to UTC and skip games that already started relative to 'start'
				t = t.UTC()
				if t.Before(start) {
					continue
				}

				label := fmt.Sprintf("%s @ %s — %s", away, home, t.Format("Mon 01/02 3:04 PM MST"))
				byID[ev.ID] = GameDTO{
					ID:    ev.ID,
					Sport: sportLabel,
					Start: t.Format(time.RFC3339),
					Home:  home,
					Away:  away,
					Label: label,
				}
			}
		}()

		day = day.Add(24 * time.Hour)
	}

	out := make([]GameDTO, 0, len(byID))
	for _, g := range byID {
		out = append(out, g)
	}
	// Stable-ish sort by Start (simple insertion; n is small)
	for i := 1; i < len(out); i++ {
		j := i
		for j > 0 && out[j].Start < out[j-1].Start {
			out[j], out[j-1] = out[j-1], out[j]
			j--
		}
	}

	if hadErr && len(out) == 0 {
		return nil, fmt.Errorf("espn returned no parseable data for the requested window")
	}
	return out, nil
}

/* ---------- helpers ---------- */

// parseESPNTime tries common ESPN formats: RFC3339 with/without seconds,
// with optional fractional seconds, and Z or offset timezones.
func parseESPNTime(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, false
	}
	layouts := []string{
		time.RFC3339,                    // 2006-01-02T15:04:05Z07:00
		"2006-01-02T15:04Z07:00",        // no seconds, with offset
		"2006-01-02T15:04:05Z",          // seconds, Z
		"2006-01-02T15:04Z",             // no seconds, Z
		"2006-01-02T15:04:05.000Z07:00", // millis + offset
		"2006-01-02T15:04:05.000Z",      // millis + Z
	}
	for _, l := range layouts {
		if t, err := time.Parse(l, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}
