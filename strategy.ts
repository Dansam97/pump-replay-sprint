// Capitulation-reversion strategy for the agent-fun/replay/v2 pump.fun
// replay.
//
// The tape's base rate is hostile: most curves bleed out, and chasing
// momentum — fast or slow — lost money on the dev window, as did buying dips
// while they were still falling. The one state with clearly positive
// forward returns was a hard capitulation that had stopped falling: an
// established, liquid coin (many lifetime trades, real reserves of several
// SOL) trading at most ~62% of its window peak and no higher than its price
// one window ago, whose window flow is no longer sell-dominated, whose last
// few slots are not a rug in progress, and whose price has already bounced
// a little off its recent low. Entries are split in two tranches: half the
// stake at the signal, the other half only if the position is still at or
// above cost ~30 slots later, so a coin that keeps collapsing costs half as
// much. Exits are mechanical: take-profit at +45%, a trailing stop once a
// position is +30%, a −10% stop-loss, and a time stop that frees the slot
// after 900 slots unless the position is clearly winning. A momentum mode
// is kept in the code for comparison but is not the shipped configuration.
// Everything derives from the replay data itself: no clock, no randomness,
// no network, so two runs over the same window agree byte for byte.

import {
  LAMPORTS_PER_SOL,
  type Batch,
  type Bot,
  type BotState,
  type OrderInput,
  type Pubkey,
} from './vendor/makefun-bot.ts';

export interface Params {
  /** Target spend per entry, lamports. */
  stakeLamports: bigint;
  /** Smallest acceptable size cap (1% of real reserves) for an entry. */
  minCapLamports: bigint;
  /** Smallest acceptable actual spend for an entry. */
  minBuyLamports: bigint;
  /** Rolling window, in slots, for flow and price samples. */
  windowSlots: number;
  /** Trades inside the window before a coin can be entered. */
  minWindowTrades: number;
  /** (buy - sell) / (buy + sell) quote flow inside the window, minimum. */
  minFlowRatio: number;
  /** Slots back for the trend reference price. */
  trendLookbackSlots: number;
  /** Price must be at least this multiple of the reference price. */
  minTrendGain: number;
  /** Skip when the price already multiplied by more than this in the window. */
  maxWindowGain: number;
  /** A coin must be at least this many slots old before entry. */
  minAgeSlots: number;
  /** Sell everything once net value reaches this multiple of cost. */
  takeProfitX100: bigint;
  /** Trailing stop arms at this multiple of cost... */
  trailStartX100: bigint;
  /** ...and fires when net value falls to this share (x100) of its peak. */
  trailDropX100: bigint;
  /** Sell everything once net value falls to this share (x100) of cost. */
  stopLossX100: bigint;
  /** Sell a position older than this when it is not clearly winning. */
  timeStopSlots: number;
  /** "Clearly winning" for the time stop: this multiple (x100) of cost. */
  timeStopWinX100: bigint;
  /** Slots to wait after exiting a coin before it may be re-entered. */
  reentryCooldownSlots: number;
  buySlippageBps: number;
  sellSlippageBps: number;
  /** New entries allowed per batch. */
  maxEntriesPerBatch: number;
  /** Which entry signal to use. */
  entryMode: 'momentum' | 'reversion';
  /** Reversion: the coin must have at least this many trades in its life. */
  revMinTotalTrades: number;
  /** Reversion: real SOL reserves must be at least this, lamports. */
  revMinReserves: bigint;
  /** Reversion: window flow ratio may not be below this (selling exhausting). */
  revMinFlowRatio: number;
  /** Reversion: slots back for the stabilisation reference price. */
  revStabLookbackSlots: number;
  /** Reversion: price must be at least this share (x1000) of the reference. */
  revStabX1000: number;
  /** Reversion: slots back for the turn-confirmation reference price. */
  revTurnLookbackSlots: number;
  /** Reversion: price must be at least this share (x1000) of that reference. */
  revTurnX1000: number;
  /** Reversion: price must be at or below this share (x100) of the price one window ago. */
  revDipRefX100: bigint;
  /** Reversion: window flow ratio may not exceed this (no chasing a rebound already crowded). */
  revMaxFlowRatio: number;
  /** Reversion: slots back over which the recent low is taken. */
  revLowLookbackSlots: number;
  /** Reversion: price must be at least this share (x1000) of that recent low. */
  revBounceX1000: number;
  /** Reversion: price must be at or below this share (x100) of the window peak price. */
  revDipPeakX100: bigint;
  /** Reversion: the coin's most recent trade may be at most this many slots old. */
  revMaxIdleSlots: number;
  /** Reversion: flow over the last revRecentSlots may not be below this. */
  revRecentFlowMin: number;
  /** Reversion: slots in the recent-flow window. */
  revRecentSlots: number;
  /** Reversion: first tranche of an entry, as a share (x100) of the stake. */
  revFirstShareX100: bigint;
  /** Reversion: slots after entry before the second tranche may be added. */
  revAddAfterSlots: number;
  /** Reversion: the position must be worth at least this share (x100) of cost to add. */
  revAddMinX100: bigint;
}

export const DEFAULT_PARAMS: Params = {
  stakeLamports: LAMPORTS_PER_SOL / 5n,
  minCapLamports: LAMPORTS_PER_SOL / 33n,
  minBuyLamports: LAMPORTS_PER_SOL / 20n,
  windowSlots: 150,
  minWindowTrades: 8,
  minFlowRatio: 0.22,
  trendLookbackSlots: 60,
  minTrendGain: 1.04,
  maxWindowGain: 3.5,
  minAgeSlots: 50,
  takeProfitX100: 145n,
  trailStartX100: 130n,
  trailDropX100: 85n,
  stopLossX100: 90n,
  timeStopSlots: 900,
  timeStopWinX100: 105n,
  reentryCooldownSlots: 300,
  buySlippageBps: 700,
  sellSlippageBps: 1500,
  maxEntriesPerBatch: 2,
  entryMode: 'reversion',
  revMinTotalTrades: 40,
  revMinReserves: LAMPORTS_PER_SOL * 6n,
  revMinFlowRatio: -0.2,
  revStabLookbackSlots: 15,
  revStabX1000: 940,
  revTurnLookbackSlots: 10,
  revTurnX1000: 0,
  revDipRefX100: 100n,
  revMaxFlowRatio: 0.25,
  revLowLookbackSlots: 60,
  revBounceX1000: 1030,
  revDipPeakX100: 62n,
  revMaxIdleSlots: 40,
  revRecentFlowMin: -0.35,
  revRecentSlots: 25,
  revFirstShareX100: 50n,
  revAddAfterSlots: 30,
  revAddMinX100: 100n,
};

/** Combined curve fee (protocol + creator fallback) kept from a sale's gross. */
const FEE_KEEP_X10000 = 9875n;

interface FlowTrade {
  slot: number;
  /** Signed quote lamports: positive for a buy, negative for a sell. */
  quote: bigint;
}

interface PriceSample {
  slot: number;
  /** Virtual quote per virtual token, as a float ratio. */
  price: number;
}

interface MintTrack {
  firstSeenSlot: number;
  trades: FlowTrade[];
  samples: PriceSample[];
  lastExitSlot: number;
  totalTrades: number;
}

interface PositionBook {
  entrySlot: number;
  /** Highest net value (lamports) marked for this position so far. */
  peakNet: bigint;
  /** Reversion two-tranche entries: the second tranche has been sent. */
  added: boolean;
}

export function createStrategy(params: Params = DEFAULT_PARAMS): Bot {
  const tracks = new Map<Pubkey, MintTrack>();
  const book = new Map<Pubkey, PositionBook>();

  const trackFor = (mint: Pubkey, slot: number): MintTrack => {
    let t = tracks.get(mint);
    if (t === undefined) {
      t = { firstSeenSlot: slot, trades: [], samples: [], lastExitSlot: -1, totalTrades: 0 };
      tracks.set(mint, t);
    }
    return t;
  };

  /** Net lamports a full sale of `tokens` would return at the curve's latest reserves. */
  const netValue = (state: BotState, mint: Pubkey, tokens: bigint): bigint => {
    const c = state.curves.get(mint);
    if (c === undefined || tokens <= 0n) return 0n;
    const gross = (tokens * c.virtual_quote_reserves) / (c.virtual_token_reserves + tokens);
    const afterFees = (gross * FEE_KEEP_X10000) / 10_000n;
    const net = afterFees - state.txFeeLamports();
    return net > 0n ? net : 0n;
  };

  const hasPending = (state: BotState, mint: Pubkey, side: 'buy' | 'sell'): boolean => {
    for (const p of state.pending.values()) {
      if (p.order.mint === mint && p.order.side === side) return true;
    }
    return false;
  };

  return {
    onBatch(state: BotState, batch: Batch): OrderInput[] {
      const slot = batch.slot;
      const orders: OrderInput[] = [];
      const tx = state.txFeeLamports();

      // ---- fold this batch's trades into the per-mint flow tracks --------
      const tradedHere = new Set<Pubkey>();
      for (const e of batch.events) {
        if (e.event === 'CreateEvent') {
          trackFor(e.mint, slot);
        } else if (e.event === 'TradeEvent') {
          const t = trackFor(e.mint, slot);
          const q = BigInt(e.sol_amount);
          t.trades.push({ slot, quote: e.is_buy ? q : -q });
          t.totalTrades++;
          tradedHere.add(e.mint);
        }
      }
      for (const mint of tradedHere) {
        const t = tracks.get(mint)!;
        const c = state.curves.get(mint);
        if (c !== undefined && c.virtual_token_reserves > 0n) {
          const price = Number(c.virtual_quote_reserves) / Number(c.virtual_token_reserves);
          const last = t.samples[t.samples.length - 1];
          if (last === undefined || last.slot < slot) t.samples.push({ slot, price });
        }
        // Prune what the windows no longer reach.
        const flowFloor = slot - params.windowSlots;
        while (t.trades.length > 0 && t.trades[0]!.slot < flowFloor) t.trades.shift();
        const sampleFloor = slot - params.windowSlots * 2;
        while (t.samples.length > 0 && t.samples[0]!.slot < sampleFloor) t.samples.shift();
      }

      // ---- position bookkeeping: note exits, open books for new fills ---
      for (const mint of [...book.keys()]) {
        if (!state.positions.has(mint)) {
          const t = tracks.get(mint);
          if (t !== undefined) t.lastExitSlot = slot;
          book.delete(mint);
        }
      }
      for (const mint of state.positions.keys()) {
        if (!book.has(mint)) book.set(mint, { entrySlot: slot, peakNet: 0n, added: false });
      }

      // ---- exits ---------------------------------------------------------
      for (const [mint, held] of state.positions) {
        if (hasPending(state, mint, 'sell')) continue;
        const b = book.get(mint);
        if (b === undefined) continue;
        const net = netValue(state, mint, held.token_amount);
        if (net > b.peakNet) b.peakNet = net;
        const cost = held.cost_lamports;
        let exit = false;
        if (net * 100n >= cost * params.takeProfitX100) exit = true;
        else if (net * 100n <= cost * params.stopLossX100) exit = true;
        else if (b.peakNet * 100n >= cost * params.trailStartX100 && net * 100n <= b.peakNet * params.trailDropX100) exit = true;
        else if (slot - b.entrySlot >= params.timeStopSlots && net * 100n < cost * params.timeStopWinX100) exit = true;
        if (exit) {
          orders.push({ side: 'sell', mint, token_amount: held.token_amount, max_slippage_bps: params.sellSlippageBps });
        }
      }

      // ---- reversion second tranches: add only into a position that held -
      if (params.entryMode === 'reversion') {
        for (const [mint, held] of state.positions) {
          if (orders.length >= state.hello.caps.max_orders_per_batch) break;
          const b = book.get(mint);
          if (b === undefined || b.added) continue;
          if (slot - b.entrySlot < params.revAddAfterSlots) continue;
          if (hasPending(state, mint, 'buy') || hasPending(state, mint, 'sell')) continue;
          const net = netValue(state, mint, held.token_amount);
          if (net * 100n < held.cost_lamports * params.revAddMinX100) continue;
          const want = params.stakeLamports - held.cost_lamports;
          if (want < params.minBuyLamports) {
            b.added = true;
            continue;
          }
          const capAdd = state.maxBuyLamports(mint);
          const addAmount = capAdd < want ? capAdd : want;
          if (addAmount < params.minBuyLamports) continue;
          if (state.freeCashLamports() < addAmount + tx) continue;
          orders.push({ side: 'buy', mint, quote_lamports: addAmount, max_slippage_bps: params.buySlippageBps });
          b.added = true;
        }
      }

      // ---- entries -------------------------------------------------------
      let entries = 0;
      let reserved = 0n;
      const maxOpen = state.hello.caps.max_open_positions;
      for (const [mint, curve] of state.curves) {
        if (entries >= params.maxEntriesPerBatch) break;
        if (orders.length >= state.hello.caps.max_orders_per_batch) break;
        if (curve.complete) continue;
        if (state.positions.has(mint)) continue;
        if (hasPending(state, mint, 'buy')) continue;
        if (state.committedPositionCount() + entries >= maxOpen) break;

        const t = tracks.get(mint);
        if (t === undefined) continue;
        const born = curve.created_slot ?? t.firstSeenSlot;
        if (slot - born < params.minAgeSlots) continue;
        if (t.lastExitSlot >= 0 && slot - t.lastExitSlot < params.reentryCooldownSlots) continue;

        const cap = state.maxBuyLamports(mint);
        if (cap < params.minCapLamports) continue;
        let amount = cap < params.stakeLamports ? cap : params.stakeLamports;
        if (params.entryMode === 'reversion') amount = (amount * params.revFirstShareX100) / 100n;
        if (amount < params.minBuyLamports) continue;
        if (state.freeCashLamports() - reserved < amount + tx) continue;

        // Flow inside the window, shared by both entry modes.
        let buyQ = 0n;
        let sellQ = 0n;
        let n = 0;
        for (const tr of t.trades) {
          if (tr.quote > 0n) buyQ += tr.quote;
          else sellQ -= tr.quote;
          n++;
        }
        if (n < params.minWindowTrades) continue;
        const total = buyQ + sellQ;
        if (total <= 0n) continue;
        const flowRatio = Number(buyQ - sellQ) / Number(total);

        const samples = t.samples;
        if (samples.length < 2) continue;
        const nowPrice = samples[samples.length - 1]!.price;
        if (nowPrice <= 0) continue;
        /** Price of the newest sample at or before `slot - back`, if any. */
        const priceAt = (back: number): number | undefined => {
          let found: PriceSample | undefined;
          for (const s of samples) {
            if (s.slot <= slot - back) found = s;
            else break;
          }
          return found?.price;
        };

        if (params.entryMode === 'momentum') {
          // Flow clearly buy-dominated, price rising but not parabolic.
          if (flowRatio < params.minFlowRatio) continue;
          const ref = priceAt(params.trendLookbackSlots);
          if (ref === undefined || ref <= 0) continue;
          if (nowPrice < ref * params.minTrendGain) continue;
          const windowStart = samples[0]!;
          if (windowStart.price > 0 && nowPrice > windowStart.price * params.maxWindowGain) continue;
        } else {
          // Reversion: an established, liquid coin that has fallen hard
          // against its price one window ago, while its flow is no longer
          // sell-dominated and the fall has stopped accelerating. On the dev
          // window this was the one state with clearly positive forward
          // returns; everything else on the tape drifts down.
          if (t.totalTrades < params.revMinTotalTrades) continue;
          if (curve.real_quote_reserves < params.revMinReserves) continue;
          const lastTrade = t.trades[t.trades.length - 1];
          if (lastTrade === undefined || slot - lastTrade.slot > params.revMaxIdleSlots) continue;
          // A rug in progress shows violently negative flow in the last few
          // slots even when the whole window looks balanced: refuse those.
          let rBuy = 0n;
          let rSell = 0n;
          for (const tr of t.trades) {
            if (tr.slot < slot - params.revRecentSlots) continue;
            if (tr.quote > 0n) rBuy += tr.quote;
            else rSell -= tr.quote;
          }
          if (rBuy + rSell > 0n && Number(rBuy - rSell) / Number(rBuy + rSell) < params.revRecentFlowMin) continue;
          if (flowRatio < params.revMinFlowRatio) continue;
          if (flowRatio > params.revMaxFlowRatio) continue;
          const refWindow = priceAt(params.windowSlots);
          if (refWindow !== undefined && refWindow > 0) {
            if (BigInt(Math.round(nowPrice * 1e6)) * 100n > BigInt(Math.round(refWindow * 1e6)) * params.revDipRefX100) continue;
          }
          let peak = 0;
          for (const s of samples) {
            if (s.slot >= slot - params.windowSlots && s.price > peak) peak = s.price;
          }
          if (peak <= 0) continue;
          if (BigInt(Math.round(nowPrice * 1e6)) * 100n > BigInt(Math.round(peak * 1e6)) * params.revDipPeakX100) continue;
          const ref = priceAt(params.revStabLookbackSlots);
          if (ref === undefined || ref <= 0) continue;
          if (nowPrice * 1000 < ref * params.revStabX1000) continue;
          // The turn must have begun: price already off its recent low.
          let low = Infinity;
          for (const s of samples) {
            if (s.slot >= slot - params.revLowLookbackSlots && s.price < low) low = s.price;
          }
          if (!Number.isFinite(low) || low <= 0) continue;
          if (nowPrice * 1000 < low * params.revBounceX1000) continue;
          if (params.revTurnX1000 > 0) {
            const turnRef = priceAt(params.revTurnLookbackSlots);
            if (turnRef === undefined || turnRef <= 0) continue;
            if (nowPrice * 1000 < turnRef * params.revTurnX1000) continue;
          }
        }

        orders.push({ side: 'buy', mint, quote_lamports: amount, max_slippage_bps: params.buySlippageBps });
        reserved += amount + tx;
        entries++;
      }

      return orders;
    },
  };
}
