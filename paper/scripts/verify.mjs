import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { benchmark } from '../../dist/index.js';
import { mean, wilson, bootstrap } from '../template/stats.mjs';
const read=async f=>JSON.parse(await readFile(f)), hash=s=>createHash('sha256').update(s).digest('hex');
const s=await read('paper/data/summary.generated.json'), runs=await read('paper/data/runs.generated.json'), repeats=await read('paper/data/repeat.generated.json'), pop=await read('paper/data/simulation.generated.json'), meta=await read('paper/meta.json'), p=await read('paper/data/provenance.generated.json');
const tasks=await benchmark.listTasks(), semantic=r=>r.rows.map(({taskId,submission,score,reason,details})=>({taskId,submission,score,reason,details}));
for(const [file,digest] of Object.entries(p.hashes)) assert.equal(hash(await readFile(file)),digest,file);
for(const file of ['src/benchmark.ts','src/a11y.ts','src/a11y-dom.ts','data/tasks.jsonl','package-lock.json']) assert.equal(hash(execFileSync('git',['show',`${p.source_commit}:${file}`])),p.hashes[file]);
assert.equal(hash(execFileSync('git',['show',`${p.plan_commit}:paper/PREREG.md`])),p.hashes['paper/PREREG.md']);
assert.equal(execFileSync('git',['ls-tree','-r','--name-only',p.plan_commit,'paper/data'],{encoding:'utf8'}).trim(),'');
for(const {policy,report} of runs) {
  const stat=s.stats.find(x=>x.policy===policy), rep=repeats.find(x=>x.policy===policy);
  assert.equal(hash(JSON.stringify(semantic(report))),rep.sha256); assert.equal(hash(JSON.stringify(semantic(rep.repeat))),rep.sha256);
  assert.deepEqual(report.rows.map(r=>r.taskId),tasks.map(t=>t.id));
  for(const [i,row] of report.rows.entries()) { const grade=await benchmark.score(tasks[i],row.submission); assert.equal(grade.score,row.score); assert.deepEqual({...grade.details,tier:tasks[i].metadata.tier},row.details); }
  const groups=['easy','hard'].map(t=>report.rows.filter(r=>r.details.tier===t));
  assert.deepEqual(stat.mean,bootstrap(groups,gs=>mean(gs.flat().map(r=>r.score))));
  assert.deepEqual(stat.full,wilson(report.rows.filter(r=>r.score===1).length,tasks.length));
}
for(const cell of pop) { assert.equal(cell.kind,'simulated'); for(const agent of cell.agents) { for(const row of agent.rows) { const original=runs.find(r=>r.policy===row.policy).report.rows.find(r=>r.taskId===row.taskId); assert.equal(row.score,original.score); const d=original.details; assert.equal(row.noGate,Math.max(0,Math.min(1,(d.defectsFixed-.5*d.regressions)/Math.max(1,d.defectsTotal)))); } assert.equal(agent.mean,mean(agent.rows.map(r=>r.score))); assert.equal(agent.noGate,mean(agent.rows.map(r=>r.noGate))); } assert.deepEqual(cell.guarded,bootstrap([cell.agents],gs=>mean(gs.flat().map(a=>a.mean)))); assert.deepEqual(cell.noGate,bootstrap([cell.agents],gs=>mean(gs.flat().map(a=>a.noGate)))); assert.deepEqual(cell.difference,bootstrap([cell.agents],gs=>mean(gs.flat().map(a=>a.mean-a.noGate)))); }
assert.ok(/^[\x00-\x7F]*$/.test(meta.abstract)&&meta.abstract.length<=1920); assert.equal(meta.license,'CC-BY-4.0');
const tex=await readFile('paper/paper.tex','utf8'), log=await readFile('paper/paper.log','utf8'); assert.ok(!tex.includes('\u2014')); assert.ok(!/Overfull|undefined references|undefined citations/.test(log));
const info=execFileSync('pdfinfo',[`paper/${meta.artifact_name}`],{encoding:'utf8'}),pages=Number(info.match(/Pages:\s+(\d+)/)[1]); assert.ok(pages>=8);
const pdfText=execFileSync('pdftotext',[`paper/${meta.artifact_name}`,'-'],{encoding:'utf8'}); for(const label of ['Figure 1','Figure 2','Figure 3','References']) assert.ok(pdfText.includes(label));
const result={ok:true,pages,tasks:tasks.length,scriptedConditions:runs.length,scriptedExecutions:s.executions,simulatedConditions:pop.length,simulatedAgentsPerCondition:pop[0].agents.length,semanticRepeats:true,publicRescoring:true,sourceAndPlanVerified:true,pdfSha256:hash(await readFile(`paper/${meta.artifact_name}`))};
await writeFile('paper/data/verification.generated.json',JSON.stringify(result,null,2)+'\n'); console.log(JSON.stringify(result));
