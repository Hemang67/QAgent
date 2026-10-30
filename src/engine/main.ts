/**
 * QAgent engine: a separate Node process, so a long or crashed run never
 * freezes the editor. No vscode imports.
 *
 * Protocol (one JSON object per line):
 *   stdin  line 1: the RunPlan (it carries credentials, so it never goes to disk)
 *   stdin  later:  {"kind":"cancel"}; stdin closing also cancels (the parent died)
 *   stdout:        EngineMessage lines (progress, results, done)
 */
import readline from 'readline';
import type { EngineMessage, RunPlan } from '../shared/types';
import { writeFallback, writeWorkbook } from './report/excel';
import { Runner } from './runner';

const emit = (m: EngineMessage) => process.stdout.write(JSON.stringify(m) + '\n');

const main = async () => {
  const rl = readline.createInterface({ input: process.stdin });
  let runner: Runner | null = null;
  let finished = false;

  const plan = await new Promise<RunPlan>((resolve, reject) => {
    rl.once('line', (line) => {
      try {
        resolve(JSON.parse(line));
      } catch (e) {
        reject(new Error(`Invalid run plan: ${(e as Error).message}`));
      }
    });
    rl.once('close', () => reject(new Error('No run plan received')));
  });

  runner = new Runner(plan, emit);
  rl.on('line', (line) => {
    if (line.includes('"cancel"')) {
      emit({ kind: 'log', text: 'Cancelling: finishing the pages in progress…' });
      runner?.cancel();
    }
  });
  rl.on('close', () => {
    if (!finished) runner?.cancel();
  });

  // The session folder must go whatever happens
  const bail = (signal: string) => {
    runner?.cancel();
    runner?.cleanup();
    emit({ kind: 'error', text: `Stopped by ${signal}` });
    process.exit(130);
  };
  process.on('SIGINT', () => bail('SIGINT'));
  process.on('SIGTERM', () => bail('SIGTERM'));
  process.on('exit', () => runner?.cleanup());

  const jobs = await runner.run();
  finished = true;
  const meta = { projectName: plan.projectName, runBy: plan.runBy, device: plan.device };
  try {
    const sheets = await writeWorkbook(plan.resultsFile, jobs, meta, (text) => emit({ kind: 'log', text }));
    emit({ kind: 'workbook', file: plan.resultsFile, sheets });
  } catch (e) {
    const dir = writeFallback(plan.fallbackDir, jobs, meta);
    emit({ kind: 'fallback', dir, error: (e as Error).message });
  }
  emit({ kind: 'done', ok: !jobs.some((j) => j.status === 'failed') });
  rl.close();
};

main().catch((e) => {
  emit({ kind: 'error', text: (e as Error).stack || String(e) });
  process.exitCode = 1;
});
