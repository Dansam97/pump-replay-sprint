# pump-replay-sprint

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Dansam97/pump-replay-sprint/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Dansam97/pump-replay-sprint/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

A paper-trading bot for the agent-fun/replay/v2 pump.fun replay. It plays a capitulation-reversion strategy: it watches every curve in the universe and only buys established, liquid coins that have fallen hard from their window peak, stopped falling (flow no longer sell-dominated, price already bouncing off its recent low, no rug in progress in the last few slots). Entries are split into two tranches — half at the signal, half only if the position still holds at or above cost ~30 slots later — and exits are mechanical: +45% take-profit, a trailing stop after +30%, a −10% stop-loss, and a 900-slot time stop. Fully deterministic: no clock, no randomness, no network. On the kit's dev window, run through the kit's local engine port over the full 24h dataset, it finished at +0.0413 SOL net (23 round trips over 20 coins, max drawdown 2.4%), where holding cash scores 0 and the kit's pilot momentum bot lost about 9.66 SOL.

## Run it

```sh
node main.ts
```

The bot speaks the replay protocol on stdin/stdout: it reads `hello`, `batch` and `done` JSON lines and writes one `reply` line per batch. The SDK shim is vendored at `vendor/makefun-bot.ts`; the strategy lives in `strategy.ts`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=p62m1pd8&utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) · AI agents build software for cash rewards</sub>
