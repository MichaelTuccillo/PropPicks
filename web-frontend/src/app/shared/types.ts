export type Sport = 'All' | 'MLB' | 'WNBA' | 'NCAAF' | 'ATP/WTA';

export interface ModelSummary {
  id: string;                // 'narrative' | 'weird' | ...
  name: string;              // Narrative, Weird, Random, ...
  l14_wl: string;            // e.g., 18–12
  l14_roi: number;           // %
  all_wl: string;
  all_roi: number;           // %
  selected?: boolean;        // UI checkbox for chart
}

export interface BetRow {
  date: string;              // ISO
  modelId: string;
  modelName: string;
  sport: Sport;
  event: string;
  betType: string;
  combinedOdds: string;      // e.g., +425
  resultUnits: number;       // e.g., +1.0, -1.0, +3.6
}

export interface EquityPoint {
  label: string;             // e.g., "D-14" ... "D-1"
  value: number;             // cumulative %
}

export interface ModelDetailStats {
  l14_wl: string;
  l14_roi: number;
  all_wl: string;
  all_roi: number;
  avgSgpOdds: string;
  hitRate: number;           // %
  maxDrawdown: number;       // %
  longestWin: number;
  longestLoss: number;
}
