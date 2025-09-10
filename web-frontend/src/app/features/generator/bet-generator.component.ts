import { Component, computed, inject, signal } from '@angular/core';
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
import { AiSlipService, AiBetSlip, AiFilters  } from '../../shared/ai-slip.service';

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
export class BetGeneratorComponent {
  // Services
  public data = inject(MockDataService);           // public so template can read .sports
  private gen  = inject(GeneratorService);
  private ai = inject(AiSlipService);


  aiLoading = signal(false);
  aiError   = signal<string | null>(null);
  aiSlip    = signal<AiBetSlip | null>(null);


  // Expose sports to template
  sports = this.data.sports;

  // Parameters
  sport = signal<Sport>('MLB');
  mode  = signal<BetMode>('Single');
  legs  = signal(1);
  slips = signal(5);

  // Odds: forbid (-100, 100) range (no snapping)
  minOdds = signal(300);
  maxOdds = signal(700);

  // Models as a checklist
  models = computed(() => this.data.models);
  selectedIds = signal(new Set<string>());

  // Output slips
  private out = signal<Slip[] | null>(null);
  slipsOut = computed(() => this.out());

  // ----- UI helpers -----
  setSport(s: Sport) { this.sport.set(s); }
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
  onSlipsInput(e: Event) {
    const el = e.target as HTMLInputElement;
    const v = this.clampInt(el.valueAsNumber ?? Number(el.value), 1, 20);
    this.slips.set(v);
  }
  // remember last committed values so we can infer spinner direction
  private lastMin = this.minOdds();
  private lastMax = this.maxOdds();

  onOddsInput(which: 'min' | 'max', e: Event) {
    const input = e.target as HTMLInputElement;
    let v = Number(input.value);
    const prev = which === 'min' ? this.lastMin : this.lastMax;

    v = this.snapOdds(v, prev);

    if (which === 'min') {
        this.minOdds.set(v);
        this.lastMin = v;
    } else {
        this.maxOdds.set(v);
        this.lastMax = v;
    }

    // reflect any snapping back into the UI
    input.value = String(v);
  }

  private snapOdds(v: number, prev: number): number {
    if (Number.isNaN(v)) return prev;

    // snap to multiples of 5
    v = Math.round(v / 5) * 5;
    const dir = v - prev; // >0 up, <0 down

    // Explicitly handle crossing the boundary at -100 / 100
    if (dir > 0 && prev <= -105 && v >= -100) return 100;   // -105 ↑ -100 -> 100
    if (dir < 0 && prev >= 100  && v <= 100)  return -105;  // 100  ↓  95  -> -105

    // If exactly -100, choose based on direction
    if (v === -100) return dir > 0 ? 100 : -105;

    // Inside the forbidden band -> snap to edge based on direction
    if (v > -100 && v < 100) return dir >= 0 ? 100 : -105;

    return v;
  }

  oddsInvalid(which: 'min' | 'max') {
    const v = which === 'min' ? this.minOdds() : this.maxOdds();
    return v !== 0 && Math.abs(v) < 100; // disallow values between −100 and +100
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
  // TrackBy to keep checkbox list snappy
  trackModel = (_: number, m: { id: string }) => m.id;

  canGenerate = computed(() =>
    !this.oddsInvalid('min') &&
    !this.oddsInvalid('max') &&
    (this.mode() === 'Single' ? this.legs() === 1 : this.legs() >= 1) &&
    this.slips() >= 1 &&
    this.selectedIds().size > 0
  );

  generate() {
    if (!this.canGenerate()) return;

    const input: GeneratorInput = {
      sport: this.sport(),
      mode: this.mode(),
      legs: this.mode() === 'Single' ? 1 : this.legs(),
      slips: this.slips(),
      minOdds: this.minOdds(),
      maxOdds: this.maxOdds(),
      // IMPORTANT: GeneratorInput expects 'models'
      models: Array.from(this.selectedIds())
    };
    this.out.set(this.gen.generate(input));
  }

  clearResults() { this.out.set(null); }

  // ---- NEW: safe label helper used in the template (replaces '(l as any)....') ----
  getSelection(l: unknown): string {
    const a = l as any;
    return (a?.selection ?? a?.pick ?? a?.side ?? '') + '';
  }

  private collectFiltersForAI() {
    return {
        sport:  this.sport(),
        mode:   this.mode(),
        legs:   this.mode() === 'Single' ? 1 : this.legs(),
        slips:  this.slips(),
        minOdds: this.minOdds(),
        maxOdds: this.maxOdds(),
        // IMPORTANT: the mock generator expects 'models' as an array of IDs
        models: Array.from(this.selectedIds()),
    };
  }

  // If you have selectedIds(): Set<string>, derive a single model from it.
  // Fallback default = 'Narrative'
  selectedModel = computed<string>(() => {
    const anyThis = this as any;
    if (typeof anyThis.selectedIds === 'function') {
        const set: Set<string> = anyThis.selectedIds();
        if (set && set.size) return Array.from(set)[0];
    }
    return 'Narrative';
  });

  setExclusiveModel(name: string, checked: boolean) {
    if (!checked) return; // keep one selected
    const anyThis = this as any;
    if (typeof anyThis.selectedIds === 'function' && typeof anyThis.selectedIds.set === 'function') {
        anyThis.selectedIds.set(new Set([name]));
    }
  }

  generateAiSlip() {
    this.aiError.set(null);
    this.aiSlip.set(null);
    this.aiLoading.set(true);

    const anyThis = this as any;
    const filters: AiFilters = {
        sport:  anyThis.sport?.() ?? '',
        mode:   anyThis.mode?.() ?? 'SGP',
        legs:   anyThis.mode?.() === 'Single' ? 1 : Math.max(1, Number(anyThis.legs?.() ?? 1)),
        slips:  Math.max(1, Number(anyThis.slips?.() ?? 1)),
        minOdds: Number(anyThis.minOdds?.() ?? 0),
        maxOdds: Number(anyThis.maxOdds?.() ?? 0),
        model:  this.selectedModel(),
    };

    this.ai.generateSlip(filters).subscribe({
        next: (s) => { this.aiSlip.set(s); this.aiLoading.set(false); },
        error: (err) => {
        const raw = err?.error;
        const msg = (typeof raw === 'string' && raw) || raw?.message || err?.message || 'Failed to generate slip';
        this.aiError.set(msg);
        this.aiLoading.set(false);
        }
    });
  }

  discardAiSlip() { this.aiSlip.set(null); }
  saveAiSlip() { /* hook up later */ }
}
