import { Injectable } from '@angular/core';
import { Sport } from './types';

export type GeneratorMode = 'Single' | 'SGP' | 'SGP+';

export interface GeneratorInput {
  sport: Sport;
  mode: GeneratorMode;
  legs: number;   // forced to 1 when mode === 'Single'
  slips: number;
  minOdds: number;
  maxOdds: number;
  models: string[];
}

export interface SlipLeg {
  player: string;
  market: string;
  line: string;
  odds: number;   // per-leg odds
}

export interface Slip {
  title: string;
  odds: number;   // combined / single odds
  legs: SlipLeg[];
  rationale?: string[];
}

@Injectable({ providedIn: 'root' })
export class GeneratorService {
  /** Enforce: no American odds in (-99..99). */
  normalizeAmericanOdds(v: number): number {
    if (!Number.isFinite(v) || v === 0) return 100;
    if (v > 0 && v < 100)  return 100;
    if (v < 0 && v > -100) return -100;
    return Math.trunc(v);
  }

  private randomOdds(min: number, max: number): number {
    min = this.normalizeAmericanOdds(min);
    max = this.normalizeAmericanOdds(max);
    if (min > max) [min, max] = [max, min];

    let v = 0;
    do {
      v = Math.round(min + Math.random() * (max - min));
      v = this.normalizeAmericanOdds(v);
    } while (Math.abs(v) < 100);
    return v;
  }

  // --- Lightweight in-service catalogs for demo ---
  private playersBySport: Record<string, string[]> = {
    NBA: ['Nikola Jokić','Jayson Tatum','Luka Dončić','Shai Gilgeous-Alexander','Giannis Antetokounmpo'],
    NHL: ['Connor McDavid','Auston Matthews','Nathan MacKinnon','David Pastrňák','Cale Makar'],
    NFL: ['Patrick Mahomes','Christian McCaffrey','Tyreek Hill','Josh Allen','Micah Parsons'],
    MLB: ['Shohei Ohtani','Mookie Betts','Ronald Acuña Jr.','Juan Soto','Spencer Strider'],
    WNBA: ['A’ja Wilson','Breanna Stewart','Sabrina Ionescu','Napheesa Collier','Kelsey Plum'],
    NCAAF: ['Caleb Williams','Drake Maye','Marvin Harrison Jr.','Blake Corum','Brock Bowers'],
    'ATP/WTA': ['Novak Djokovic','Carlos Alcaraz','Iga Świątek','Aryna Sabalenka','Jannik Sinner']
  };

  private marketsBySport: Record<string, string[]> = {
    NBA: ['Points','Rebounds','Assists','3PT Made','PRA'],
    NHL: ['Shots','Points','Goals','Assists','SOG+Pts'],
    NFL: ['Passing Yds','Rushing Yds','Receiving Yds','Receptions','Anytime TD'],
    MLB: ['Hits','Total Bases','Home Run','RBIs','Strikeouts'],
    WNBA: ['Points','Rebounds','Assists','3PT Made','PRA'],
    NCAAF: ['Passing Yds','Rushing Yds','Receiving Yds','Receptions','Anytime TD'],
    'ATP/WTA': ['Aces','Double Faults','1st Serve %','Games Won','Break Points']
  };

  private pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random()*arr.length)];
  }

  private randomLeg(sport: Sport): SlipLeg {
    const ps = this.playersBySport[sport] ?? ['Player A','Player B','Player C'];
    const ms = this.marketsBySport[sport] ?? ['Market 1','Market 2'];
    const player = this.pick(ps);
    const market = this.pick(ms);
    const line = (Math.random() > .5 ? '+' : '-') + (Math.floor(Math.random()*3)+1).toFixed(1);
    const odds = this.randomOdds(100, 600);
    return { player, market, line, odds };
  }

  /** Combine american odds (very rough demo). */
  private combineAmerican(legs: number[], mode: GeneratorMode): number {
    const decimals = legs.map(ao => ao > 0 ? 1 + ao/100 : 1 + 100/Math.abs(ao));
    let prod = decimals.reduce((a,b)=>a*b, 1);
    if (mode === 'SGP+') prod *= 1.08; // minor boost for demo
    if (prod >= 2) return Math.round((prod - 1) * 100);
    return Math.round(-100 / (prod - 1));
  }

  generate(input: GeneratorInput): Slip[] {
    const legsCount = input.mode === 'Single' ? 1 : Math.max(1, input.legs);
    const slips: Slip[] = [];

    for (let i=0; i<input.slips; i++) {
      const legs: SlipLeg[] = [];
      for (let j=0; j<legsCount; j++) {
        legs.push(this.randomLeg(input.sport));
      }

      let odds: number;
      if (input.mode === 'Single') {
        odds = this.randomOdds(input.minOdds, input.maxOdds);
      } else {
        const legOdds = legs.map(() => this.randomOdds(input.minOdds, input.maxOdds));
        legOdds.forEach((o, idx) => legs[idx].odds = o);
        odds = this.combineAmerican(legOdds, input.mode);
      }

      slips.push({
        title: input.mode === 'Single'
          ? `${input.sport} Single`
          : `${input.sport} ${input.mode} x${legsCount}`,
        odds,
        legs,
        rationale: [
          'Leans align across multiple models.',
          'Favorable matchup and pace.',
          'Recent form supports this angle.'
        ]
      });
    }
    return slips;
  }
}
