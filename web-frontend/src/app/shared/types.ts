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

/* ---------- New: canonical sports & models ---------- */

export interface ModelOption {
  /** Stable id (must match backend PastBet.model / stats.model) */
  id: string;
  /** Display name */
  name: string;
  /** Optional default selection hint for UIs */
  selected?: boolean;
}

/** Major sports; 'All' is a UI filter and intentionally excluded here */
export const SPORTS: Sport[] = ['MLB', 'NBA', 'NFL', 'NHL'];

/** Models you support. Make sure ids match what the API returns/accepts. */
export const MODEL_OPTIONS: ModelOption[] = [
  { id:'narrative',   name:'Narrative'},
  { id:'weird',       name:'Weird'},
  { id:'random',      name:'Random'},
  { id:'contrarian',  name:'Contrarian'},
  { id:'micro',       name:'Micro-Edges'},
  { id:'pessimist',   name:'Pessimist'},
  { id:'heatcheck',   name:'Heat-Check'},
];
