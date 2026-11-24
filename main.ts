// Pump.fun Replay Sprint — paper bot entrypoint.
// The grader runs `node /bot/main.ts`; the SDK shim is vendored beside this
// file and the strategy lives in strategy.ts.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

await runBot(createStrategy(DEFAULT_PARAMS));
