import { Component, OnInit, computed, inject, signal } from '@angular/core';
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

import { MockDataService } from '../../shared/mock-data.service';
import { GeneratorService, GeneratorInput, Slip } from '../../shared/generator.service';
import { Sport } from '../../shared/types';
import { AiSlipService, AiBetSlip, AiFilters } from '../../shared/ai-slip.service';
import { GamesService, GameDTO } from '../../shared/games.service';
import { PastBetsService, PastBet, SavePastBetPayload } from '../../shared/past-bets.service';

type BetMode = 'Single' | 'SGP' | 'SGP+';

@Component({
  selector: 'app-bet-generator',
  standalone: true,
  imports: [
    NgIf, NgFor,
    MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatOptionModule,
    MatButtonModule, MatButtonToggleModule, MatCheckboxModule, MatIconModule
  ],
  templateUrl: './bet-generator.component.html',
  styleUrls: ['./bet-generator.component.scss']
})
export class BetGeneratorComponent implements OnInit {
  // Services
  public data = inject(MockDataService);
  private gen  = inject(GeneratorService);
  private ai   = inject(AiSlipService);
  private gamesSvc = inject(GamesService);
  private past   = inject(PastBetsService);

  // trackBys used in the template
  trackChoice = (_: number, opt: { value: number }) => opt.value;
  trackDay    = (_: number, d: { dateKey: string }) => d.dateKey;
  trackGame   = (_: number, g: GameDTO) => g.id;

  aiLoading = signal(false);
  aiError   = signal<string | null>(null);
  aiSlip    = signal<AiBetSlip | null>(null);

  // Games & selection
  games = signal<GameDTO[]>([]);
  gamesLoading = signal(false);
  gamesError = signal<string | null>(null);
  selectedGameIds = signal<Set<string>>(new Set());

  // Expose sports
  sports = this.data.sports;

  // Parameters
  sport = signal<Sport>('MLB');
  mode  = signal<BetMode>('Single');
  legs  = signal(1);

  // Odds
  minOdds = signal(300);
  maxOdds = signal(700);

  // Models
  models = computed(() => this.data.models);
  selectedIds = signal(new Set<string>());

  // Output slips (for mock generator)
  private out = signal<Slip[] | null>(null);
  slipsOut = computed(() => this.out());

  // Boost
  boostEnabled = signal(false);
  boostPct = signal<number | null>(null);

  // Date range filter (today..+6)
  startOffset = signal(0);
  endOffset   = signal(0);

  // Editable odds for the AI slip
  editableOdds = signal<string>('');

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
    if (m === 'Single') this.legs.set(1);
  }

  private clampInt(n: number, lo: number, hi: number) {
    if (Number.isNaN(n)) return lo;
    return Math.min(hi, Math.max(lo, Math.trunc(n)));
  }

  onLegsInput(e: Event) {
    const el = e.target as HTMLInputElement;
    const v = this.clampInt(el.valueAsNumber ?? Number(el.value), 1, 12);
    this.legs.set(this.mode() === 'Single' ? 1 : v);
  }

  private lastMin = this.minOdds();
  private lastMax = this.maxOdds();

  onOddsInput(which: 'min' | 'max', e: Event) {
    const input = e.target as HTMLInputElement;
    let v = Number(input.value);
    const prev = which === 'min' ? this.lastMin : this.lastMax;

    v = this.snapOdds(v, prev);

    if (which === 'min') { this.minOdds.set(v); this.lastMin = v; }
    else { this.maxOdds.set(v); this.lastMax = v; }

    input.value = String(v);
  }

  private snapOdds(v: number, prev: number): number {
    if (Number.isNaN(v)) return prev;

    v = Math.round(v / 5) * 5;
    const dir = v - prev;

    if (dir > 0 && prev <= -105 && v >= -100) return 100;
    if (dir < 0 && prev >= 100  && v <= 100)  return -105;
    if (v === -100) return dir > 0 ? 100 : -105;
    if (v > -100 && v < 100) return dir >= 0 ? 100 : -105;

    return v;
  }

  oddsInvalid(which: 'min' | 'max') {
    const v = which === 'min' ? this.minOdds() : this.maxOdds();
    return v !== 0 && Math.abs(v) < 100;
  }

  setPreset(kind: 'safe' | 'balanced' | 'longshot') {
    switch (kind) {
      case 'safe':      this.minOdds.set(100); this.maxOdds.set(300); break;
      case 'balanced':  this.minOdds.set(300); this.maxOdds.set(700); break;
      case 'longshot':  this.minOdds.set(600); this.maxOdds.set(1000); break;
    }
  }

  selectAllModels() { this.selectedIds.set(new Set(this.models().map(m => m.id))); }
  clearModels()      { this.selectedIds.set(new Set()); }
  toggleModel(id: string, checked: boolean) {
    this.selectedIds.update(prev => {
      const n = new Set(prev); checked ? n.add(id) : n.delete(id); return n;
    });
  }
  trackModel = (_: number, m: { id: string }) => m.id;

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

  groupedGames = computed(() => {
    const arr = this.games();
    if (!arr || !arr.length) return [];
    const from = this.visibleStart();
    const to   = this.visibleEnd();
    const filtered = arr
      .filter(g => {
        const d = new Date(g.start);
        return d >= from && d <= to;
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

  // Count of visible selected games
  selectedVisibleCount = computed(() => {
    const chosen = this.selectedGameIds();
    let n = 0;
    for (const day of this.groupedGames()) {
      for (const g of day.items) if (chosen.has(g.id)) n++;
    }
    return n;
  });

  // Gate generation
  canGenerate = computed(() =>
    !this.oddsInvalid('min') &&
    !this.oddsInvalid('max') &&
    (this.mode() === 'Single' ? this.legs() === 1 : this.legs() >= 1) &&
    this.selectedIds().size === 1 &&
    this.selectedVisibleCount() > 0 &&
    !this.boostInvalid()
  );

  // Mock generator (kept; uses slips: 1)
  generate() {
    if (!this.canGenerate()) return;
    const input: GeneratorInput = {
      sport: this.sport(),
      mode: this.mode(),
      legs: this.mode() === 'Single' ? 1 : this.legs(),
      slips: 1,
      minOdds: this.minOdds(),
      maxOdds: this.maxOdds(),
      models: Array.from(this.selectedIds())
    };
    this.out.set(this.gen.generate(input));
  }

  clearResults() { this.out.set(null); }

  getSelection(l: unknown): string {
    const a = l as any;
    return (a?.selection ?? a?.pick ?? a?.side ?? '') + '';
  }

  selectedModel = computed<string>(() => {
    const set = this.selectedIds();
    return set && set.size ? Array.from(set)[0] : 'Narrative';
  });

  setExclusiveModel(name: string, checked: boolean) {
    if (!checked) return;
    this.selectedIds.set(new Set([name]));
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

  // Pretty local time
  formatTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
    });
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

  toggleGame(id: string, checked: boolean) {
    const next = new Set(this.selectedGameIds());
    if (checked) next.add(id); else next.delete(id);
    this.selectedGameIds.set(next);
  }

  // ===== AI call + editable odds / save / discard =====
  generateAiSlip() {
    if (this.selectedVisibleCount() === 0) {
      this.aiError.set('Select at least one game in the chosen date range.');
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
      legs:   this.mode() === 'Single' ? 1 : Math.max(1, Number(this.legs() ?? 1)),
      minOdds: Number(this.minOdds() ?? 0),
      maxOdds: Number(this.maxOdds() ?? 0),
      model:  this.selectedModel(),
      boostPct: this.boostEnabled() ? (this.boostPct() ?? 0) : 0,
      games: visible,
    };

    this.ai.generateSlip(filters).subscribe({
      next: (s) => {
        this.aiSlip.set(s);
        // init editable odds
        const eo = this.initialEditableOdds(s);
        this.editableOdds.set(eo);
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

  discardAiSlip() { this.aiSlip.set(null); }

  saveAiSlip() {
    const s = this.aiSlip();
    if (!s) return;

    // Choose the odds: use edited value if present, else any combinedOdds/rationalized odds from the AI slip.
    const edited = (this as any).editOdds?.(); // if you have an edit field
    const fallback = (s as any).combinedOdds || (s as any).estimatedPayout?.postBoostAmerican || (s as any).estimatedPayout?.preBoostAmerican || '';
    const oddsText = (edited ?? '').toString().trim() || String(fallback || '').trim();

    const payload: SavePastBetPayload = {
      type: this.mode(),
      date: new Date().toISOString(),
      model: this.selectedModel(),   // your single selected model id/name
      sport: this.sport(),
      event: s.event || s.title || 'Bet Slip',
      odds: oddsText
    };

    this.past.save(payload).subscribe({
      next: () => {
        // Clear the slip from screen once saved
        this.aiSlip.set(null);
        // optionally show a toast/snackbar
      },
      error: (err) => {
        this.aiError.set(err?.error?.message || err?.message || 'Failed to save bet');
      }
    });
  }


  // Boost helpers
  toggleBoost(checked: boolean) {
    this.boostEnabled.set(checked);
    if (!checked) this.boostPct.set(null);
  }
  onBoostInput(ev: Event) {
    const v = Number((ev.target as HTMLInputElement).value);
    this.boostPct.set(Number.isFinite(v) ? v : null);
  }
  boostInvalid(): boolean {
    if (!this.boostEnabled()) return false;
    const v = this.boostPct();
    return v == null || v < 0 || v > 100;
  }
}

/* ---------- local date helpers ---------- */
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
