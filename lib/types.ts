// Trade status types
export type TradeStatus = 'ACTIVE' | 'EXIT_NOW' | 'CLOSED';
export type TradeDirection = 'LONG' | 'SHORT';
export type ActionType = 'EXIT' | 'REDUCE' | 'NOTE' | 'OVERRIDE' | 'RULE_VIOLATION' | 'MULTI_TRADE_ACK';

// Database models
export interface Trade {
  id: number;
  createdAt: string;
  ticker: string;
  direction: TradeDirection;
  setup: string;
  timeframe: string;
  invalidationPrice: number;
  entryTime: string;
  status: TradeStatus;
  closedAt: string | null;
  notes: string | null;
  exitNowTriggeredAt: string | null; // Track when EXIT_NOW was first triggered
  is0DTE: boolean; // Whether this is a 0DTE (same-day expiry) position
}

export interface PriceUpdate {
  id: number;
  tradeId: number;
  time: string;
  price: number;
  chop: boolean;
  unsure: boolean;
  inProfit: boolean;
  statusAfter: TradeStatus;
  reason: string | null;
}

export interface Action {
  id: number;
  tradeId: number;
  time: string;
  type: ActionType;
  payload: string; // JSON string
}

// Form inputs
export interface NewTradeInput {
  ticker: string;
  direction: TradeDirection;
  setup: string;
  timeframe: string;
  invalidationPrice: number;
  is0DTE: boolean;
  notes?: string;
}

export interface PriceUpdateInput {
  price: number;
  chop: boolean;
  unsure: boolean;
  inProfit: boolean;
  reason?: string;
}

export interface ActionPayload {
  reason?: string;
  amount?: string;
  note?: string;
  seconds?: number;
  tradeId?: number;
  acknowledged?: boolean;
}

// Metrics for review page
export interface TradeMetrics {
  totalTrades: number;
  avgExitDelaySeconds: number | null;
  exitNowIgnoredPct: number | null;
  ruleViolationCount: number;
  avgReduceCountPerTrade: number;
  avgHoldTimeMinutes: number | null;
}
