// One-off quality check: the same brain dump and delegate through two models, side by side.
import { readFileSync } from 'node:fs';
import { draftTask, splitBrainDump } from '../server/brain-dump.ts';
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const dump = "Finish the Q4 roadmap doc, review Sam's pull request before noon, 1:1 with Alex, prep slides for Thursday's demo, reply to the recruiter, book flights to Berlin, maybe tidy up the backlog";
for (const model of process.argv.slice(2)) {
  process.env.DC_MODEL_BRAIN_DUMP = model;
  process.env.DC_MODEL_DELEGATE = model;
  console.log(`\n== ${model}`);
  for (const t of await splitBrainDump(dump)) console.log(`  ${t.minutes}m p${t.priority} ${t.category}: ${t.title}`);
  const d = await draftTask("Prep slides for Thursday's demo", 90, 'writing');
  console.log(`  draft (${d?.kind}): ${d?.title}\n${d?.body.split('\n').map((l) => '    ' + l).join('\n')}\n  next: ${d?.nextStep}`);
}
