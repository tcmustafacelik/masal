// Masal veri türleri: botun ürettiği dosyalar (docs/data/*.json) ve ayarlar (docs/ayarlar.json).
// Bot tarafında bir alanın biçimi değişirse uygulama derlenmeden önce burada uyarı verir.

type StrategyKey = 'grid' | 'dip' | 'trend' | 'live';
type Side = 'AL' | 'SAT';

/** [zaman (ms), bakiye, o andaki başlangıç parası] — eski kayıtlarda üçüncü değer olmayabilir */
type EquityPoint = [number, number, number?];

interface Trade {
  ts: number;
  inst: string;
  side: Side;
  price: number;
  qty: number;
  amount: number;
  reason: string;
  pnl?: number;
  pnl_pct?: number;
  real?: boolean;
}

interface Position {
  inst: string;
  lots: number;
  qty: number;
  cost: number;
  avg: number;
  price: number;
  value: number;
  pnl: number;
  pnl_pct: number;
  since: number;
  tp?: number | null;
  sl?: number | null;
  protected?: boolean | null;
}

interface CoinStat {
  inst: string;
  realized: number;
  sells: number;
  wins: number;
  buys: number;
  bought: number;
  open_qty: number;
  open_cost: number;
  open_pnl: number;
  price: number | null;
}

interface Risk {
  trade_size: number;
  max_positions: number;
  stop_loss: number;
  daily_loss_limit: number;
  kill_switch: number;
  lot?: number;
  [k: string]: number | undefined;
}

interface Strategy {
  name: string;
  desc?: string;
  live?: boolean;
  armed?: boolean;
  locked?: boolean;
  paused?: boolean;
  start_cash?: number;
  log?: [number, string][];
  kasa?: number;
  base?: number;
  topups?: number;
  last_topup?: number | null;
  checkpoint?: number;
  risk?: Risk;
  equity?: number;
  cash?: number;
  pnl?: number;
  pnl_pct?: number;
  today_pnl?: number;
  trades?: number;
  win_rate?: number | null;
  realized?: number;
  positions?: Position[];
  coins?: CoinStat[];
  recent?: Trade[];
  equity_series?: EquityPoint[];
  halted?: boolean;
  halt_reason?: string | null;
  blocked_today?: boolean;
  watch?: Watch | null;
  target_done?: string | null;
  cfg?: GridCfg | null;
}

interface WatchItem { i: string; p: number; t: number; g: number; f: boolean; h: number }
interface Watch { items: WatchItem[]; used: number; cap: number; lot: number; room: boolean; coins: number; max_coins: number }
interface GridCfg { step: number; lot: number; lot_tp: number; max_lots: number; max_coins: number; stop: number; max_use: number; coin_filter?: number | null; instant?: boolean; step3?: number; lot2?: number; lot3?: number; sma_h?: number }

interface OkxStatus {
  ok: boolean;
  status: string;
  try?: number;
  usdt?: number;
  usdt_tl?: number;
  quote?: string;
  ts?: number;
}

interface Sealed { enc: 1; iter: number; salt: string; iv: string; ct: string }

interface Settings {
  live: boolean;
  paused: boolean;
  liquidate: number;
  strategy: Exclude<StrategyKey, 'live'>;
  quote?: string;
  sell?: { ts: number; insts: string[] };
  target?: { on: boolean; amount: number; mode?: string };
  convert?: { ts: number };
  budget: number;
  kasa: number;
  topup: { amount: number; profit_pct: number; days: number };
  risk: { trade_pct: number; max_positions: number; stop_pct: number; daily_loss_pct: number; kill_pct: number };
  grid: { step_pct: number; lot_pct: number; lot_tp_pct: number; max_lots: number; max_coins: number; stop_pct: number; use_pct?: number; trend_filter_pct?: number; instant?: boolean; step3_pct?: number; lot2_pct?: number; lot3_pct?: number; sma_hours?: number };
  dip: { dip_pct: number; rsi_max: number; take_profit_pct: number; max_hold_hours: number };
  trend: { trailing_pct: number };
  notify: { enabled: boolean; topic: string | Sealed; trades: boolean; alerts: boolean; daily: boolean; money?: boolean };
  test_req?: { ts: number; s: Partial<Settings> };
  _bad?: Set<string>;
}

interface Summary {
  updated: number;
  created?: number;
  mode?: string;
  start_cash: number;
  risk: Risk;
  fee: number;
  slippage: number;
  universe: string[];
  strategies: Partial<Record<StrategyKey, Strategy>>;
  settings: Settings;
  okx: OkxStatus | null;
  live_enc?: Sealed;
  live_public?: { armed: boolean; paused: boolean };
}

interface BacktestResult {
  name: string;
  final: number;
  pnl: number;
  pnl_pct: number;
  trades: number;
  win_rate: number;
  max_drawdown: number;
  halted: boolean;
  equity: EquityPoint[];
}

interface Backtest {
  generated: number;
  days: number;
  symbols: string[];
  hold_pct: number;
  results: Partial<Record<Exclude<StrategyKey, 'live'>, BacktestResult>>;
  custom?: { ts: number; strategy: string } | null;
}

interface TradesFile {
  updated: number;
  strategies: Partial<Record<StrategyKey, Trade[]>>;
  live_enc?: Sealed;
}

interface VersionInfo { version: string; date?: string; notes?: string[] }

interface Check { lv: 'bad' | 'warn2' | 'info' | 'ok'; t: string; dsc: string }

interface Ticker { last: number; bid?: number; ch: number; vol: number; dir: number; ts: number }

interface Window { ICON_BAD: Set<string>; ICON_OK: Set<string> }
