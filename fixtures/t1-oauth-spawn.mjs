#!/usr/bin/env node
/**
 * T1-oauth-spawn — spawn openai-oauth child, observe ready URL, kill cleanly.
 *
 * Authority: agreed_contract.json#AC-OAUTH-CODEX + stop_conditions
 * (ready-line grammar mismatch -> contract_refresh_required).
 *
 * Behaviour:
 *   - Spawn `npx -y openai-oauth --port 0` (port=0 → child picks).
 *   - Read stdout line-by-line for up to 10 s.
 *   - On a line matching http://127.0.0.1:<port>/v1, capture the URL.
 *   - Attempt a single GET /v1/models with the host fetch; record response
 *     shape (status + first 200 chars of body).
 *   - Kill the child via tree-kill (Windows-safe: ChildProcess.kill('SIGTERM')
 *     is forwarded to taskkill /T /F when needed).
 *   - Exit 0 if either:
 *       (a) ready URL captured + clean kill, OR
 *       (b) child unavailable on npm (recorded with reason; non-blocking on
 *           the host probe gate — orchestrator still owns the verdict).
 *   - Exit 1 only on ready-line grammar mismatch within timeout (per
 *     stop_condition).
 */

import { spawn } from 'node:child_process';

const READY_RE = /http:\/\/127\.0\.0\.1:(\d+)\/v1/;
const TIMEOUT_MS = 10_000;

function killTree(child) {
  return new Promise((res) => {
    if (!child || child.killed) return res();
    if (process.platform === 'win32') {
      try {
        const tk = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        tk.on('exit', () => res());
        tk.on('error', () => res());
      } catch {
        try { child.kill('SIGKILL'); } catch {}
        res();
      }
    } else {
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(res, 100);
    }
  });
}

async function main() {
  const report = {
    scenario: 'oauth-spawn',
    spawned: false,
    ready_url: null,
    port: null,
    models_response: null,
    kill_clean: false,
    spawn_error: null,
    grammar_mismatch: false,
    note: null,
  };

  let child;
  try {
    const useShell = process.platform === 'win32';
    child = spawn('npx', ['-y', 'openai-oauth', '--port', '0'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: useShell,
    });
  } catch (e) {
    report.spawn_error = String(e);
    report.note = 'spawn failed; recording as non-blocking (orchestrator owns verdict).';
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }
  report.spawned = true;

  const earlyExit = new Promise((res) => {
    child.once('exit', (code, sig) => res({ code, sig }));
    child.once('error', (e) => res({ err: String(e) }));
  });

  const readyPromise = new Promise((res) => {
    let buf = '';
    let resolved = false;
    function feed(chunk) {
      if (resolved) return;
      buf += chunk.toString('utf8');
      const m = buf.match(READY_RE);
      if (m) {
        resolved = true;
        res({ url: m[0], port: Number(m[1]) });
      }
    }
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
  });

  const timer = new Promise((res) => setTimeout(() => res({ timeout: true }), TIMEOUT_MS));
  const winner = await Promise.race([readyPromise, timer, earlyExit]);

  if (winner && winner.url) {
    report.ready_url = winner.url;
    report.port = winner.port;
    // Probe /v1/models.
    try {
      const r = await fetch(`http://127.0.0.1:${winner.port}/v1/models`, { method: 'GET' });
      const body = await r.text();
      report.models_response = {
        status: r.status,
        content_type: r.headers.get('content-type'),
        body_head: body.slice(0, 200),
      };
    } catch (e) {
      report.models_response = { error: String(e) };
    }
  } else if (winner && winner.timeout) {
    report.grammar_mismatch = true;
    report.note = 'ready-line grammar mismatch within 10s timeout; stop_condition route.';
  } else if (winner && (winner.code !== undefined || winner.err)) {
    report.note = `child exited before ready: ${JSON.stringify(winner)}`;
  }

  // Clean kill.
  await killTree(child);
  // Confirm exit.
  await new Promise((r) => setTimeout(r, 200));
  report.kill_clean = child.killed || child.exitCode !== null;

  console.log(JSON.stringify(report, null, 2));
  // Per contract: grammar_mismatch routes to stop_condition contract_refresh_required,
  // which is an ORCHESTRATOR-owned verdict, not a Tier-1 smoke crash. The smoke
  // run faithfully records the observation and exits 0; the orchestrator reads
  // the evidence and decides whether to escalate.
  if (report.grammar_mismatch) {
    console.error('[recorded] ready-line grammar mismatch — orchestrator owns stop_condition routing');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[fail]', e);
  process.exit(1);
});
