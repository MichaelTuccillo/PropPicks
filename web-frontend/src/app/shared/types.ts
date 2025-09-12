export type Sport = 'All' | 'NFL' | 'NHL' | 'NBA' | 'MLB';

export interface ModelSummary {
  id: string;
  name: string;
  l14_wl: string;
  l14_roi: number;
  all_wl: string;
  all_roi: number;
  selected?: boolean;
}

export interface BetRow {
  date: string;
  modelId: string;
  modelName: string;
  sport: Sport;
  event: string;
  betType: string;
  combinedOdds: string;
  resultUnits: number;
}

export interface EquityPoint {
  label: string;
  value: number;
}

export interface ModelDetailStats {
  l14_wl: string;
  l14_roi: number;
  all_wl: string;
  all_roi: number;
  avgSgpOdds: string;
  hitRate: number;
  maxDrawdown: number;
  longestWin: number;
  longestLoss: number;
}
