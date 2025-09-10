// web-frontend/src/app/shared/models.ts
export interface SlipLeg {
  market: string;
  pick: string;
  line?: string;
  odds?: string;
  notes?: string;
}

export interface BetSlip {
  title: string;
  event: string;
  legs: SlipLeg[];
  combinedOdds?: string;
  rationale?: string;
  createdAt?: string;
}
