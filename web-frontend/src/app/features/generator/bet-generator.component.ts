import { Component, OnInit, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { NgIf, NgFor } from '@angular/common';

import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatOptionModule } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { Sport, SPORTS, MODEL_OPTIONS, ModelOption } from '../../shared/types';
import { AiSlipService, AiBetSlip, AiFilters } from '../../shared/ai-slip.service';
import { GamesService, GameDTO } from '../../shared/games.service';
import { PastBetsService } from '../../shared/past-bets.service';

type BetMode = 'Single' | 'SGP' | 'SGP+';

@Component({
  selector: 'app-bet-generator',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  imports: [
    NgIf, NgFor,
    MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatOptionModule,
    MatButtonModule, MatButtonToggleModule, MatCheckboxModule, MatIconModule, MatTooltipModule
  ],
  templateUrl: './bet-generator.component.html',
  styleUrls: ['./bet-generator.component.scss']
})
export class BetGeneratorComponent implements OnInit {
  private ai       = inject(AiSlipService);
  private gamesSvc = inject(GamesService);
  private past     = inject(PastBetsService);

  // trackBys used in template
  trackChoice = (_: number, opt: { value: number }) => opt.value;
  trackDay    = (_: number, d: { dateKey: string }) => d.dateKey;
  trackGame   = (_: number, g: GameDTO) => g.id;
  trackModel  = (_: number, m: { id: string }) => m.id;

  // UI state
  sport = signal<Sport>('MLB');
  mode  = signal<BetMode>('Single');
  legs  = signal(2); // min 2 for SGP/SGP+; Single is forced to 1

  // ----- Odds in filter section (with free typing + snap on blur) -----
  minOdds = signal(300);
  maxOdds = signal(700);
  minOddsText = signal('300');
  maxOddsText = signal('700');
  private lastMin = this.minOdds();
  private lastMax = this.maxOdds();

  // ----- AI slip odds (behave exactly like filter odds) -----
  editableOdds = signal<string>('');        // what we’ll save
  slipOddsText = signal<string>('');        // user-typed text
  private lastSlipOdds = 100;               // last valid numeric (default)

  // ----- Stake (units): allow any > 0; delete while typing -----
  units     = signal(1);
  unitsText = signal('1');

  // Boost
  boostEnabled = signal(false);
  boostPct = signal<number | null>(null);

  // Games & selection
  games = signal<GameDTO[]>([]);
  gamesLoading = signal(false);
  gamesError = signal<string | null>(null);
  selectedGameIds = signal<Set<string>>(new Set());

  // Canonical sports & models
  readonly sports: Sport[] = SPORTS;
  models = computed<ModelOption[]>(() => MODEL_OPTIONS);

  // Exactly one model must be selected
  selectedIds = signal(new Set<string>([MODEL_OPTIONS[0]?.id].filter(Boolean) as string[]));

  // === Model tooltip descriptions (summarized from spec) ===
  private modelDescriptions: Record<string, string> = {
    narrative:
      'Correlated story build: three legs from vetted articles that fit one game script',
    weird:
      'Weird/obscure angles: three article-based legs, each with a quirky but real supporting stat (umpire profiles, pitch-type run value, hot/cold zones, travel/park quirks)',
    random:
      'Controlled randomness: gather latest article picks, select at random with guardrails (no in-play / heavy juice / conflicts)',
    contrarian:
      'Market-based contrarian: pick legs where market signals disagree with public consensus (reverse line move, handle vs tickets, off-market pockets)',
    micro:
      'Micro-edges: stack small edges (bullpen fatigue, catcher framing/SB, park & weather, defensive alignment/BABIP)',
    pessimist:
      'Pessimist/Unders bias: prefer “less happens” outcomes (player/team unders, NRFI, outs under)',
    heatcheck:
      'Heat-check/regression: fade hot streaks and bet likely regression'
  };
  private canonKey(s: string): string { return (s || '').toLowerCase().replace(/[^a-z]+/g, ''); }
  getModelDesc(m: ModelOption): string {
    const keys = [m.id, m.name].filter(Boolean).map(v => this.canonKey(String(v)));
    for (const k of keys) {
      if (this.modelDescriptions[k]) return this.modelDescriptions[k];
      if (k.includes('narr')) return this.modelDescriptions['narrative'];
      if (k.includes('weird') || k.includes('obscure')) return this.modelDescriptions['weird'];
      if (k.includes('random')) return this.modelDescriptions['random'];
      if (k.includes('contrarian') || k.includes('market')) return this.modelDescriptions['contrarian'];
      if (k.includes('micro')) return this.modelDescriptions['micro'];
      if (k.includes('pessim')) return this.modelDescriptions['pessimist'];
      if (k.includes('heat')) return this.modelDescriptions['heatcheck'];
    }
    return 'Model description unavailable.';
  }

  // AI slip state
  aiLoading = signal(false);
  aiError   = signal<string | null>(null);
  aiSlip    = signal<AiBetSlip | null>(null);

  // Date range filter (today..+6)
  startOffset = signal(0);
  endOffset   = signal(0);

  // Visible window helpers
  private visibleStart = computed(() => {
    const base = startOfLocalDay(new Date());
    const d = new Date(base);
    d.setDate(d.getDate() + this.startOffset());
    return startOfLocalDay(d);
  });
  private visibleEnd = computed(() => {
    const base = startOfLocalDay(new Date());
    const d = new Date(base);
    d.setDate(d.getDate() + this.endOffset());
    return endOfLocalDay(d);
  });

  dayChoices = computed(() => {
    const out: { value: number; label: string }[] = [];
    const base = startOfLocalDay(new Date());
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      out.push({
        value: i,
        label: i === 0
          ? 'Today'
          : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: '2-digit' })
      });
    }
    return out;
  });

  groupedGames = computed(() => {
    const arr = this.games();
    if (!arr?.length) return [];

    // Only include future (not-yet-started) games
    const now = new Date();
    const from = this.visibleStart();
    const to   = this.visibleEnd();
    const minStart = new Date(Math.max(from.getTime(), now.getTime()));

    const filtered = arr
      .filter(g => {
        const d = new Date(g.start);
        return d >= minStart && d <= to;
      })
      .sort((a, b) => a.start.localeCompare(b.start));

    const map = new Map<string, { label: string; items: GameDTO[] }>();
    for (const g of filtered) {
      const d = new Date(g.start);
      const key = ymdLocal(d);
      const label = d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: '2-digit' });
      if (!map.has(key)) map.set(key, { label, items: [] });
      map.get(key)!.items.push(g);
    }
    return Array.from(map.entries()).map(([dateKey, v]) => ({
      dateKey, label: v.label, items: v.items
    }));
  });

  selectedVisibleCount = computed(() => {
    const chosen = this.selectedGameIds();
    let n = 0;
    for (const day of this.groupedGames()) for (const g of day.items) if (chosen.has(g.id)) n++;
    return n;
  });

  // ---- Validation (TEXT-based so typing can be free-form) ----
  oddsInvalid(which: 'min' | 'max') {
    const raw = which === 'min' ? this.minOddsText() : this.maxOddsText();
    if (raw === '' || raw === '-' || raw === '+') return false;
    const v = Number(raw);
    if (!Number.isFinite(v)) return false;
    return v !== 0 && Math.abs(v) < 100;
  }

  canGenerate = computed(() =>
    !this.oddsInvalid('min') &&
    !this.oddsInvalid('max') &&
    (this.mode() === 'Single' ? this.legs() === 1 : this.legs() >= 2) &&
    this.selectedIds().size === 1 &&
    this.selectedVisibleCount() > 0 &&
    !this.boostInvalid()
  );

  boostInvalid(): boolean {
    if (!this.boostEnabled()) return false;
    const v = this.boostPct();
    return v == null || v < 0 || v > 100;
  }

  ngOnInit(): void { this.loadGames(); }

  // ----- UI helpers -----
  setSport(s: Sport) {
    this.sport.set(s);
    this.selectedGameIds.set(new Set());
    this.startOffset.set(0);
    this.endOffset.set(0);
    this.loadGames();
  }

  setMode(m: BetMode) {
    this.mode.set(m);
    if (m === 'Single') {
      this.legs.set(1);
    } else {
      this.legs.update(v => Math.max(2, Number(v) || 2));
    }
  }

  private clampInt(n: number, lo: number, hi: number) {
    if (Number.isNaN(n)) return lo;
    return Math.min(hi, Math.max(lo, Math.trunc(n)));
  }

  onLegsInput(e: Event) {
    const el = e.target as HTMLInputElement;
    const raw = el.valueAsNumber ?? Number(el.value);
    const min = this.mode() === 'Single' ? 1 : 2;
    const v = this.clampInt(raw, min, 12);
    this.legs.set(this.mode() === 'Single' ? 1 : v);
    el.value = String(this.legs());
  }

  /** Let the user freely type/clear without snapping */
  onOddsInput(which: 'min' | 'max', e: Event) {
    const input = e.target as HTMLInputElement;
    const raw = (input.value ?? '');
    if (which === 'min') this.minOddsText.set(raw);
    else this.maxOddsText.set(raw);
  }

  /** Snap & sync on blur (or before generating).
   *  If empty/just sign, RESTORE the last valid value. */
  onOddsBlur(which: 'min' | 'max', e?: Event) {
    const isMin = which === 'min';
    const text = isMin ? this.minOddsText() : this.maxOddsText();
    const prev = isMin ? this.lastMin : this.lastMax;

    const raw = (text ?? '').trim();
    if (raw === '' || raw === '-' || raw === '+') {
      const out = String(prev);
      if (isMin) { this.minOdds.set(prev); this.minOddsText.set(out); }
      else       { this.maxOdds.set(prev); this.maxOddsText.set(out); }
      if (e) (e.target as HTMLInputElement).value = out;
      return;
    }

    const result = this.normalizeOddsFromText(text);
    if (!result) return; // invalid junk: leave as-is

    const { value, textOut } = result;
    if (isMin) {
      this.minOdds.set(value); this.lastMin = value; this.minOddsText.set(textOut);
      if (e) (e.target as HTMLInputElement).value = textOut;
    } else {
      this.maxOdds.set(value); this.lastMax = value; this.maxOddsText.set(textOut);
      if (e) (e.target as HTMLInputElement).value = textOut;
    }
  }

  // ---- AI slip odds: same behavior as filter odds ----
  onSlipOddsInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const raw = input.value ?? '';
    this.slipOddsText.set(raw);
  }
  onSlipOddsBlur(e?: Event) {
    const raw = (this.slipOddsText() ?? '').trim();
    if (raw === '' || raw === '-' || raw === '+') {
      const out = String(this.lastSlipOdds);
      this.slipOddsText.set(out);
      this.editableOdds.set(out);
      if (e) (e.target as HTMLInputElement).value = out;
      return;
    }
    const result = this.normalizeOddsFromText(raw);
    if (!result) return;
    const { value, textOut } = result;
    this.lastSlipOdds = value;
    this.slipOddsText.set(textOut);
    this.editableOdds.set(textOut);
    if (e) (e.target as HTMLInputElement).value = textOut;
  }
  private finalizeSlipOdds() { this.onSlipOddsBlur(); }

  // ---- Stake handlers: allow any > 0; no snapping while typing; no upper cap ----
  onUnitsInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this.unitsText.set(input.value ?? '');
  }
  onUnitsBlur(e?: Event) {
    const raw = (this.unitsText() ?? '').trim();
    if (!raw || raw === '.' || raw === '-' || raw === '+') {
      const prev = this.units();
      const out = prettyNumber(prev);
      this.unitsText.set(out);
      if (e) (e.target as HTMLInputElement).value = out;
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      const prev = this.units();
      const out = prettyNumber(prev);
      this.unitsText.set(out);
      if (e) (e.target as HTMLInputElement).value = out;
      return;
    }
    this.units.set(n);
    const out = prettyNumber(n);
    this.unitsText.set(out);
    if (e) (e.target as HTMLInputElement).value = out;
  }

  setPreset(kind: 'safe' | 'balanced' | 'longshot') {
    switch (kind) {
      case 'safe':      this.minOdds.set(100); this.maxOdds.set(300); break;
      case 'balanced':  this.minOdds.set(300); this.maxOdds.set(700); break;
      case 'longshot':  this.minOdds.set(600); this.maxOdds.set(1000); break;
    }
    this.minOddsText.set(String(this.minOdds()));
    this.maxOddsText.set(String(this.maxOdds()));
    this.lastMin = this.minOdds();
    this.lastMax = this.maxOdds();
  }

  selectAllModels() { this.selectedIds.set(new Set(this.models().map(m => m.id))); }
  clearModels()      { this.selectedIds.set(new Set()); }
  toggleModel(id: string, checked: boolean) {
    this.selectedIds.update(prev => {
      const n = new Set(prev); checked ? n.add(id) : n.delete(id); return n;
    });
  }
  setExclusiveModel(id: string, checked: boolean) {
    if (!checked) return;
    this.selectedIds.set(new Set([id]));
  }

  // Range handlers
  setStartOffset(v: number) {
    const s = clamp(Number(v), 0, 6);
    this.startOffset.set(s);
    if (this.endOffset() < s) this.endOffset.set(s);
    this.loadGames();
  }
  setEndOffset(v: number) {
    const e = clamp(Number(v), 0, 6);
    if (e < this.startOffset()) this.startOffset.set(e);
    this.endOffset.set(e);
    this.loadGames();
  }

  /** Toggle a single game (checkbox change) */
  toggleGame(id: string, checked: boolean) {
    const next = new Set(this.selectedGameIds());
    if (checked) next.add(id); else next.delete(id);
    this.selectedGameIds.set(next);
  }
  selectAllVisible() {
    const next = new Set(this.selectedGameIds());
    for (const day of this.groupedGames()) for (const g of day.items) next.add(g.id);
    this.selectedGameIds.set(next);
  }
  clearVisible() {
    const next = new Set(this.selectedGameIds());
    for (const day of this.groupedGames()) for (const g of day.items) next.delete(g.id);
    this.selectedGameIds.set(next);
  }
  selectDay(dateKey: string) {
    const next = new Set(this.selectedGameIds());
    const bucket = this.groupedGames().find(d => d.dateKey === dateKey);
    if (bucket) for (const g of bucket.items) next.add(g.id);
    this.selectedGameIds.set(next);
  }
  clearDay(dateKey: string) {
    const next = new Set(this.selectedGameIds());
    const bucket = this.groupedGames().find(d => d.dateKey === dateKey);
    if (bucket) for (const g of bucket.items) next.delete(g.id);
    this.selectedGameIds.set(next);
  }

  formatTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  }

  // Games API
  loadGames() {
    const s = this.sport?.();
    if (!s) { this.games.set([]); this.selectedGameIds.set(new Set()); return; }
    this.gamesLoading.set(true);
    this.gamesError.set(null);
    const days = Math.max(1, Math.min(7, this.endOffset() + 1)); // inclusive
    this.gamesSvc.listGames(s, days).subscribe({
      next: (res) => { this.games.set(res.games || []); this.gamesLoading.set(false); },
      error: (err) => {
        const raw = err?.error;
        const msg = (typeof raw === 'string' && raw) || raw?.message || err?.message || 'Failed to load games';
        this.gamesError.set(msg); this.gamesLoading.set(false);
      }
    });
  }

  // ===== AI call + editable odds + stake / save / discard =====
  generateAiSlip() {
    // Finalize odds & stake before reading numeric values
    this.onOddsBlur('min');
    this.onOddsBlur('max');
    this.onUnitsBlur();

    if (this.selectedVisibleCount() === 0) {
      this.aiError.set('Select at least one game in the chosen date range.');
      return;
    }
    if (this.selectedIds().size !== 1) {
      this.aiError.set('Select exactly one model.');
      return;
    }

    this.aiError.set(null);
    this.aiSlip.set(null);
    this.aiLoading.set(true);

    const chosenIds = this.selectedGameIds();
    const visible: GameDTO[] = [];
    for (const day of this.groupedGames()) for (const g of day.items) {
      if (chosenIds.has(g.id)) visible.push(g);
    }

    const filters: AiFilters = {
      sport:  this.sport(),
      mode:   this.mode(),
      legs:   this.mode() === 'Single' ? 1 : Math.max(2, Number(this.legs() ?? 2)),
      minOdds: Number(this.minOdds() ?? 0),
      maxOdds: Number(this.maxOdds() ?? 0),
      model:  Array.from(this.selectedIds())[0] || '',
      boostPct: this.boostEnabled() ? (this.boostPct() ?? 0) : 0,
      games: visible,
    };

    this.ai.generateSlip(filters).subscribe({
      next: (s) => {
        this.aiSlip.set(s);
        const init = this.initialEditableOdds(s);
        this.slipOddsText.set(init);
        const norm = this.normalizeOddsFromText(init);
        this.lastSlipOdds = norm ? norm.value : 100;
        this.editableOdds.set(init);
        this.aiLoading.set(false);
      },
      error: (err) => {
        const raw = err?.error;
        const msg = (typeof raw === 'string' && raw) || raw?.message || err?.message || 'Failed to generate slip';
        this.aiError.set(msg);
        this.aiLoading.set(false);
      }
    });
  }

  onEditableOddsInput(ev: Event) {
    // not used any more, kept for safety if template references linger
    this.editableOdds.set(String((ev.target as HTMLInputElement).value || '').trim());
  }

  private initialEditableOdds(s: AiBetSlip): string {
    if (this.mode() === 'Single') {
      const o = s?.legs?.[0]?.odds || '';
      return o || '';
    }
    return s?.combinedOdds ||
           s?.estimatedPayout?.postBoostAmerican ||
           s?.estimatedPayout?.preBoostAmerican || '';
  }

  clearResults() { this.aiSlip.set(null); }
  slipsOut() { return null as any; }
  getSelection(l: unknown): string { const a = l as any; return (a?.selection ?? a?.pick ?? a?.side ?? '') + ''; }
  discardAiSlip() { this.aiSlip.set(null); }

  saveAiSlip() {
    // Ensure slip odds and stake finalized
    this.finalizeSlipOdds();
    this.onUnitsBlur();

    const s = this.aiSlip();
    if (!s) return;

    const fallback =
      (s as any).combinedOdds ||
      (s as any).estimatedPayout?.postBoostAmerican ||
      (s as any).estimatedPayout?.preBoostAmerican || '';
    const oddsText = (this.slipOddsText() || '').trim() || String(fallback || '').trim();

    const stake = this.units();

    const payload: any = {
      type: this.mode(),
      date: new Date().toISOString(),
      model: Array.from(this.selectedIds())[0] || '',
      sport: this.sport(),
      event: (s as any).event || (s as any).title || 'Bet Slip',
      odds: oddsText,
      units: stake,
    };

    this.past.save(payload).subscribe({
      next: () => { this.aiSlip.set(null); },
      error: (err) => {
        this.aiError.set(err?.error?.message || err?.message || 'Failed to save bet');
      }
    });
  }

  private normalizeOddsFromText(text: string):
    | { value: number; textOut: string }
    | null {
    const raw = (text ?? '').trim();
    const num = Number(raw);
    if (!Number.isFinite(num)) return null;

    // Round to nearest 5
    let v = Math.round(num / 5) * 5;

    // Keep out of (-100, +100) range (0 allowed, but we’ll still sign it)
    if (v === -100) v = -105;
    else if (v > -100 && v < 100) v = v >= 0 ? 100 : -105;

    // Always include a sign for non-negative values
    const textOut = v >= 0 ? `+${v}` : String(v);
    return { value: v, textOut };
  }

}

/* ---------- local helpers ---------- */
function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? Math.trunc(n) : lo));
}
function prettyNumber(n: number): string {
  let s = n.toFixed(8);
  s = s.replace(/\.?0+$/, '');
  return s === '' ? '0' : s;
}
