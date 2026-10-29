import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { benchmark, run } from '../../dist/index.js';
import { mean, wilson, bootstrap } from '../template/stats.mjs';
import { regexFix } from './fixer.mjs';
const hash = s => createHash('sha256').update(s).digest('hex');
const save = (n,x) => writeFile(`paper/data/${n}.generated.json`,JSON.stringify(x,null,2)+'\n');
const config = JSON.parse(await readFile('paper/config.json')), tasks = await benchmark.listTasks();
const broken = t => t.prompt.match(/```html\s*([\s\S]*?)```/)[1];
const mutate = (t,style) => { assert.match(t.expected,/<main\b/); return t.expected.replace(/<main\b/,`<main style="${style}"`); };
const policies = { reference:t=>t.expected, empty:()=>'', constant:()=> 'The page is accessible.', echo:broken, refusal:()=> 'I cannot repair this page.', fixer:t=>regexFix(broken(t)), hidden:t=>mutate(t,'display:none'), clipped:t=>mutate(t,'clip-path:inset(100%)') };
const options = { seed:1, concurrency:1, retries:0, budgetUsd:0 };
const semantic = r => r.rows.map(({taskId,submission,score,reason,details})=>({taskId,submission,score,reason,details}));
const runs=[], repeats=[];
for (const [policy,fn] of Object.entries(policies)) {
  const adapter={id:`script:${policy}`,complete:async(_,ctx)=>({content:fn(ctx.task)}),chat:async()=>{throw Error('Single-turn only');}};
  const report=await run(adapter,options), repeat=await run(adapter,options);
  for(const r of [report,repeat]) { assert.deepEqual(r.rows.map(x=>x.taskId),tasks.map(t=>t.id)); assert.ok(r.rows.every(x=>!x.error)); assert.equal(r.totals.costUsd??0,0); }
  const sha256=hash(JSON.stringify(semantic(report))), repeatSha256=hash(JSON.stringify(semantic(repeat)));
  assert.equal(sha256,repeatSha256); runs.push({policy,report}); repeats.push({policy,sha256,repeatSha256,repeat});
}
const groups = rows => ['easy','hard'].map(t=>rows.filter(r=>r.details.tier===t));
const summarize = rows => ({mean:bootstrap(groups(rows),gs=>mean(gs.flat().map(r=>r.score))),full:wilson(rows.filter(r=>r.score===1).length,rows.length),autoZero:wilson(rows.filter(r=>r.details.autoZero).length,rows.length)});
const stats=runs.map(({policy,report})=>({policy,...summarize(report.rows),tiers:Object.fromEntries(['easy','hard'].map(t=>{const rows=report.rows.filter(r=>r.details.tier===t);return [t,{n:rows.length,mean:bootstrap([rows],gs=>mean(gs.flat().map(r=>r.score))),full:wilson(rows.filter(r=>r.score===1).length,rows.length)}];}))}));
const ids=[...new Set(tasks.flatMap(t=>t.metadata.defects))].sort();
const coverage=ids.map(id=>({id,...Object.fromEntries(['easy','hard'].map(tier=>[tier,tasks.filter(t=>t.metadata.tier===tier&&t.metadata.defects.includes(id)).length]))}));
const lookup=Object.fromEntries(runs.map(r=>[r.policy,r.report.rows]));
const uniform=(a,t,kind)=>parseInt(hash(`${a}:${t}:${kind}`).slice(0,8),16)/2**32;
const populations=[];
for(const q of [0,.25,.5,.75,1]) {
  const agents=[];
  for(let a=1;a<=100;a++) {
    const rows=tasks.map((t,i)=> { const repaired=uniform(a,t.id,'repair')<.75, hide=uniform(a,t.id,'hide')<q; const policy=repaired?(hide?'hidden':'reference'):'echo'; const r=lookup[policy][i],d=r.details; const noGate=Math.max(0,Math.min(1,(d.defectsFixed-.5*d.regressions)/Math.max(1,d.defectsTotal))); return {taskId:t.id,policy,score:r.score,noGate}; });
    agents.push({agent:a,mean:mean(rows.map(r=>r.score)),noGate:mean(rows.map(r=>r.noGate)),rows});
  }
  populations.push({kind:'simulated',q,agents,guarded:bootstrap([agents],gs=>mean(gs.flat().map(a=>a.mean))),noGate:bootstrap([agents],gs=>mean(gs.flat().map(a=>a.noGate))),difference:bootstrap([agents],gs=>mean(gs.flat().map(a=>a.mean-a.noGate)))});
}
await save('runs',runs); await save('repeat',repeats); await save('simulation',populations);
await save('summary',{kind:'scripted-controls',tasks:tasks.length,conditions:runs.length,executions:tasks.length*runs.length*2,ciLevel:95,costUsd:0,coverage,stats,repeatIdentical:true,freeModels:{status:'not-run',reason:'Learned inference is not configured or probed in this study.'}});
const files=['data/tasks.jsonl','src/benchmark.ts','src/a11y.ts','src/a11y-dom.ts','package-lock.json','paper/PREREG.md','paper/scripts/run.mjs','paper/scripts/fixer.mjs','paper/scripts/render.mjs','paper/scripts/verify.mjs','paper/template/stats.mjs','paper/template/layout.tex','paper/template/build.py','paper/template/reproduce.sh'];
await save('provenance',{...config,node:process.version,platform:process.platform,hashes:Object.fromEntries(await Promise.all(files.map(async f=>[f,hash(await readFile(f))])))});
console.log(JSON.stringify(stats.map(s=>({policy:s.policy,mean:s.mean,full:s.full.k,tiers:s.tiers})),null,2));
