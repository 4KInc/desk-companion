// Measures agent latency and token use per endpoint and model, to choose models by data.
// Usage: npm run latency -- [runs=5] [model ...]
// Reads ANTHROPIC_API_KEY from .env. Spends a little API credit (a few cents per run).
import { readFileSync } from 'node:fs';
import { draftTask, lastUsage, splitBrainDump, splitTask } from '../server/brain-dump.ts';

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}

const runs = Number(process.argv[2] ?? 5);
const models = process.argv.slice(3).length ? process.argv.slice(3) : ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5-20251001'];
const DUMPS = [
  "Finish the Q4 roadmap doc, review Sam's pull request before noon, 1:1 with Alex, prep slides for Thursday's demo, reply to the recruiter, book flights to Berlin, maybe tidy up the backlog",
  'call the dentist\nwrite the grant summary\nfix the login bug\nplan next sprint',
  'I need to email the landlord about the leak, study for the exam on Friday, go to the gym and probably clean the kitchen',
];
const SPLITS: Array<[string, number]> = [['Finish the Q4 roadmap doc', 180], ['Prepare the quarterly board deck', 240], ['Migrate the billing service to the new API', 300]];
const DELEGATES: Array<[string, number, string]> = [['Reply to the recruiter', 15, 'email'], ["Prep slides for Thursday's demo", 90, 'writing'], ['Tidy up the backlog', 45, 'admin']];

const endpoints = {
  brainDump: (i: number) => splitBrainDump(DUMPS[i % DUMPS.length]),
  split: (i: number) => splitTask(...SPLITS[i % SPLITS.length]),
  delegate: (i: number) => draftTask(...DELEGATES[i % DELEGATES.length]),
} as const;
const envName = { brainDump: 'DC_MODEL_BRAIN_DUMP', split: 'DC_MODEL_SPLIT', delegate: 'DC_MODEL_DELEGATE' } as const;

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
console.log('endpoint   model                        p50 ms  p95 ms  fail  avg in/out tokens');
for (const [name, call] of Object.entries(endpoints) as Array<[keyof typeof endpoints, (i: number) => Promise<unknown>]>) {
  for (const model of models) {
    process.env[envName[name]] = model;
    const times: number[] = [];
    let failed = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      try {
        const result = await call(i);
        if (!result || (Array.isArray(result) && result.length === 0)) failed++;
        times.push(performance.now() - start);
        tokensIn += lastUsage.input;
        tokensOut += lastUsage.output;
      } catch (error) {
        failed++;
        console.error(`  ${name} ${model}: ${error instanceof Error ? error.message.slice(0, 120) : error}`);
      }
    }
    times.sort((a, b) => a - b);
    const ok = times.length || 1;
    console.log(
      `${name.padEnd(10)} ${model.padEnd(28)} ${String(Math.round(pct(times, 0.5) ?? 0)).padStart(6)}  ${String(Math.round(pct(times, 0.95) ?? 0)).padStart(6)}  ${String(failed).padStart(4)}  ${Math.round(tokensIn / ok)}/${Math.round(tokensOut / ok)}`,
    );
  }
}
