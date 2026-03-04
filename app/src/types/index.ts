export interface TradeData {
  holdings: Holding[];
  transactions: Transaction[];
  summary: {
    totalAssets: number;
    totalProfit: number;
    profitRate: number;
  };
}

export interface Holding {
  stockName: string;
  stockCode: string;
  shares: number;
  avgCost: number;
  currentPrice: number;
  profit: number;
  profitRate: number;
}

export interface Transaction {
  date: string;
  stockName: string;
  stockCode: string;
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  amount: number;
}

export interface AnalysisReport {
  traderArchetype: string;
  archetypeDescription: string;
  personalityTraits: TraitAnalysis[];
  tradingPatterns: PatternAnalysis[];
  strengths: StrengthAnalysis[];
  weaknesses: WeaknessAnalysis[];
  destinyPrediction: string;
  advice: string;
}

export interface TraitAnalysis {
  trait: string;
  description: string;
  evidence?: string;
}

export interface PatternAnalysis {
  pattern: string;
  description: string;
  evidence?: string;
}

export interface StrengthAnalysis {
  strength: string;
  description: string;
  evidence?: string;
}

export interface WeaknessAnalysis {
  weakness: string;
  description: string;
  evidence?: string;
}

export interface UploadedImage {
  id: string;
  file: File;
  preview: string;
  ocrSource?: string;
  type: 'holdings' | 'transactions';
}
