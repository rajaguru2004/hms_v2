#!/usr/bin/env node
/**
 * `npm run dev` - bring up everything the API needs, then run the API.
 *
 * The point of this file is that `npm run dev` is the only command anyone has
 * to remember. It starts Docker Desktop if the daemon is down, brings up
 * Postgres/Redis/MinIO, starts Ollama and the AI sidecar if they are not
 * already answering, frees the API port if the containerised demo API is
 * holding it, and only then hands over to `nest start --watch`.
 *
 * Every dependency is checked before it is started, so running this twice is
 * harmless and costs a few seconds.
 *
 * Nothing here is hardcoded that .env.local already states. The ports, the
 * Ollama URL and the model name are read back out of that file, because it is
 * what the API itself resolves - a constant here could disagree with the API's
 * own configuration, and "postgres up" against a *different* project's
 * database on 5432 is exactly the failure that would hide behind it.
 *
 * Flags:
 *   --skip-ollama    do not start or check Ollama
 *   --skip-sidecar   do not start or check the AI sidecar (STT/TTS/OCR)
 *   --no-api         bring the dependencies up and exit without running Nest
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sidecarDir = path.join(root, 'ai-sidecar');
const args = new Set(process.argv.slice(2));

const SKIP_OLLAMA = args.has('--skip-ollama');
const SKIP_SIDECAR = args.has('--skip-sidecar');
const NO_API = args.has('--no-api');

// The container the demo stack publishes on 3000. The source-run API cannot
// bind that port while this is up, and stopping it is the whole reason we look.
const DEMO_API_CONTAINER = 'hms_v2_api_demo';
const DEV_SIDECAR_CONTAINER = 'medihive_sidecar_dev';
const SIDECAR_IMAGE = 'medihive-sidecar:demo';

const log = (msg) => console.log(msg);
const step = (n, title) => console.log(`\n=== ${n}  ${title} ===`);
const warn = (msg) => console.log(`  ! ${msg}`);

/**
 * Windows will not find `docker` without an extension, and Node does not try
 * PATHEXT the way a shell does. Naming the .exe is what lets every call below
 * run with `shell: false` - which matters because a shell concatenates rather
 * than escapes arguments, and Node 22+ emits DEP0190 to say so.
 */
const exe = (cmd) => (process.platform === 'win32' && !cmd.includes('.') ? `${cmd}.exe` : cmd);

/** Run a command to completion. Returns {status, stdout, stderr}; never throws. */
function sh(cmd, argv, opts = {}) {
  const r = spawnSync(exe(cmd), argv, {
    encoding: 'utf8',
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  return {
    status: r.status ?? 1,
    stdout: (r.stdout ?? '').trim(),
    stderr: (r.stderr ?? '').trim(),
  };
}

function tcpProbe(port, host = '127.0.0.1', timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait for a port to accept a connection. Returns false on timeout rather than
 * throwing, so the caller decides whether a missing dependency is fatal.
 */
async function waitPort(port, name, timeoutSec = 120) {
  process.stdout.write(`  waiting for ${name} on :${port} `);
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (await tcpProbe(port)) {
      console.log(' up');
      return true;
    }
    await sleep(1500);
    process.stdout.write('.');
  }
  console.log(' TIMEOUT');
  return false;
}

/**
 * The ports and URLs the API itself will use.
 *
 * .env.local is read rather than restated because docker-compose.local.yml's
 * canonical host ports (5432, 9000) are held on this machine by other
 * projects' containers and are remapped by docker-compose.local.ports.yml.
 * One source of truth, and it is the one the API reads.
 */
function readEnvLocal() {
  const file = path.join(root, '.env.local');
  const cfg = {
    apiPort: 3000,
    pgPort: 5432,
    redisPort: 6379,
    s3Port: 9000,
    ollamaUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'gemma3:4b',
    sidecarUrl: 'http://127.0.0.1:8801',
  };
  if (!existsSync(file)) {
    warn('.env.local missing - falling back to defaults, which are probably wrong here');
    return cfg;
  }
  const text = readFileSync(file, 'utf8');
  const pick = (re) => text.match(re)?.[1];

  cfg.apiPort = Number(pick(/^\s*PORT\s*=\s*"?(\d+)/m) ?? cfg.apiPort);
  cfg.pgPort = Number(pick(/DATABASE_URL\s*=\s*"?[^"\r\n]*?@[^:/\r\n]+:(\d+)\//) ?? cfg.pgPort);
  cfg.redisPort = Number(pick(/^\s*REDIS_PORT\s*=\s*"?(\d+)/m) ?? cfg.redisPort);
  cfg.s3Port = Number(pick(/S3_ENDPOINT\s*=\s*"?https?:\/\/[^:/\r\n]+:(\d+)/) ?? cfg.s3Port);
  cfg.ollamaUrl = pick(/^\s*OLLAMA_URL\s*=\s*"?([^"\r\n]+)/m) ?? cfg.ollamaUrl;
  cfg.ollamaModel = pick(/^\s*OLLAMA_MODEL\s*=\s*"?([^"\r\n]+)/m) ?? cfg.ollamaModel;
  cfg.sidecarUrl = pick(/^\s*AI_SIDECAR_URL\s*=\s*"?([^"\r\n]+)/m) ?? cfg.sidecarUrl;
  return cfg;
}

const portOf = (url, fallback) => Number(new URL(url).port || fallback);

/** First non-internal IPv4 address - what a phone on the same Wi-Fi dials. */
function lanAddress() {
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    // Skip Hyper-V / WSL virtual switches: they are up and have addresses, but
    // nothing outside this machine can route to them.
    if (/vEthernet|WSL|Loopback|Default Switch/i.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}

async function ensureDocker() {
  step('1/6', 'Docker');
  // `docker version` rather than `docker info`: during Desktop's startup the
  // named pipe exists and answers 500, and `info` has been seen to exit 0 with
  // an empty version, which reads as "up" when it is not.
  const probe = () => sh('docker', ['version', '--format', '{{.Server.Version}}']);
  let r = probe();
  if (r.status === 0 && r.stdout) {
    log(`  docker ok (${r.stdout})`);
    return true;
  }

  const desktop = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe';
  if (process.platform === 'win32' && existsSync(desktop)) {
    log('  daemon down, starting Docker Desktop (takes a minute)');
    spawn(desktop, { detached: true, stdio: 'ignore' }).unref();
  } else {
    warn('docker daemon is not running and Docker Desktop was not found - start it yourself');
    return false;
  }

  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    await sleep(5000);
    process.stdout.write('.');
    r = probe();
    if (r.status === 0 && r.stdout) {
      console.log(`\n  docker ok (${r.stdout})`);
      return true;
    }
  }
  console.log('');
  warn('docker daemon did not come up within 4 minutes');
  return false;
}

async function ensureInfra(cfg) {
  step('2/6', 'Postgres / Redis / MinIO');
  const composeArgs = ['compose', '-f', 'docker-compose.local.yml'];
  // Both overrides are untracked, machine-local and optional.
  //   .ports.yml   remaps host-side ports away from the ones other projects'
  //                containers already hold. Absent means those were free.
  //   .windows.yml turns on Postgres TCP keepalives, without which idle
  //                connections are dropped by Docker Desktop's port proxy and
  //                surface later as P1017.
  for (const [file, why] of [
    ['docker-compose.local.ports.yml', 'host-port override'],
    ['docker-compose.local.windows.yml', 'windows keepalive override'],
  ]) {
    if (existsSync(path.join(root, file))) {
      composeArgs.push('-f', file);
      log(`  using ${why}`);
    }
  }
  const up = sh('docker', [...composeArgs, 'up', '-d', 'postgres', 'redis', 'minio']);
  if (up.status !== 0) {
    warn(`compose up failed:\n${up.stderr || up.stdout}`);
    return false;
  }
  // On a single-drive MinIO a directory under /data *is* a bucket, so this is
  // exactly what `mc mb` would do - and it means the first upload cannot fail
  // with NoSuchBucket from inside the S3 client, which is nowhere anyone looks.
  sh('docker', ['exec', 'hms_v2_minio_local', 'mkdir', '-p', '/data/hmsbucket']);

  return (
    (await waitPort(cfg.pgPort, 'postgres')) &&
    (await waitPort(cfg.redisPort, 'redis')) &&
    (await waitPort(cfg.s3Port, 'minio'))
  );
}

async function ensureOllama(cfg) {
  step('3/6', 'Ollama');
  if (SKIP_OLLAMA) {
    log('  skipped');
    return true;
  }

  const port = portOf(cfg.ollamaUrl, 11434);
  if (await tcpProbe(port)) {
    log(`  already listening on :${port}`);
  } else {
    // OLLAMA_HOST is read by the server at startup, not per request, so it has
    // to be in the environment of the process we spawn. 0.0.0.0 rather than
    // loopback because a container (the sidecar) has to reach it too.
    log(`  starting ollama on :${port}`);
    const child = spawn(exe('ollama'), ['serve'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, OLLAMA_HOST: `0.0.0.0:${port}` },
    });
    child.unref();
    if (!(await waitPort(port, 'ollama', 60))) {
      warn('ollama did not start - AI features will fail.');
      warn('install:  winget install --id Ollama.Ollama -e');
      return false;
    }
  }

  // Being up is not the same as having the model. A missing model surfaces as
  // a failure on the first AI request, minutes later and far from the cause.
  try {
    const res = await fetch(new URL('/api/tags', cfg.ollamaUrl), {
      signal: AbortSignal.timeout(5000),
    });
    const names = (await res.json()).models?.map((m) => m.name) ?? [];
    if (names.includes(cfg.ollamaModel)) {
      log(`  model ${cfg.ollamaModel} present`);
    } else {
      warn(`model ${cfg.ollamaModel} is NOT pulled (have: ${names.join(', ') || 'none'})`);
      warn(`pull it:  ollama pull ${cfg.ollamaModel}`);
    }
  } catch (e) {
    warn(`could not list models at ${cfg.ollamaUrl}: ${e.message}`);
  }
  return true;
}

async function ensureSidecar(cfg) {
  step('4/6', 'AI sidecar (STT / TTS / OCR)');
  if (SKIP_SIDECAR) {
    log('  skipped');
    return true;
  }

  const port = portOf(cfg.sidecarUrl, 8801);
  if (await tcpProbe(port)) {
    log(`  already listening on :${port}`);
    return true;
  }

  // Prefer the container: the image already carries the Python runtime, Piper
  // and rapidocr, so it does not depend on a host virtualenv being in whatever
  // state someone last left it in.
  const hasImage = sh('docker', ['image', 'inspect', SIDECAR_IMAGE]).status === 0;
  if (hasImage) {
    // A previous dev run may have left a stopped container of the same name.
    sh('docker', ['rm', '-f', DEV_SIDECAR_CONTAINER]);
    const ollamaPort = portOf(cfg.ollamaUrl, 11434);
    const hfCache = path.join(os.homedir(), '.cache', 'huggingface');
    const run = sh('docker', [
      'run',
      '-d',
      '--name',
      DEV_SIDECAR_CONTAINER,
      // Published on loopback only, deliberately: the sidecar authenticates
      // nobody, so the only thing allowed to call it is the API on this host.
      '-p',
      `127.0.0.1:${port}:8801`,
      '--add-host',
      'host.docker.internal:host-gateway',
      '-e',
      `OLLAMA_URL=http://host.docker.internal:${ollamaPort}`,
      '-e',
      'MEDIHIVE_STT_MODEL=small',
      '-e',
      'MEDIHIVE_STT_DEVICE=cpu',
      '-e',
      'MEDIHIVE_STT_COMPUTE=int8',
      '-v',
      `${path.join(sidecarDir, 'voices')}:/app/voices:ro`,
      // The host's HF cache already holds faster-whisper-small; without this
      // the first spoken request downloads ~460 MB.
      '-v',
      `${hfCache}:/home/sidecar/.cache/huggingface`,
      SIDECAR_IMAGE,
    ]);
    if (run.status !== 0) {
      warn(`could not start sidecar container: ${run.stderr || run.stdout}`);
      return false;
    }
    log(`  started ${DEV_SIDECAR_CONTAINER} from ${SIDECAR_IMAGE}`);
    return waitPort(port, 'sidecar', 120);
  }

  // Fallback: the host virtualenv. run.ps1 owns the env defaults and the
  // loopback bind, so call it rather than restating the uvicorn line here.
  const runner = path.join(sidecarDir, 'run.ps1');
  const venvPython = path.join(sidecarDir, '.venv', 'Scripts', 'python.exe');
  if (process.platform === 'win32' && existsSync(runner) && existsSync(venvPython)) {
    log('  image not built; falling back to the host virtualenv');
    spawn(
      exe('powershell'),
      ['-NoExit', '-Command', `Set-Location '${sidecarDir}'; & '${runner}'`],
      { detached: true, stdio: 'ignore' },
    ).unref();
    return waitPort(port, 'sidecar', 120);
  }

  warn(`no ${SIDECAR_IMAGE} image and no usable virtualenv - STT/TTS/OCR will be unavailable`);
  warn(`build it:  docker build -t ${SIDECAR_IMAGE} ./ai-sidecar`);
  return false;
}

/**
 * The source-run API cannot bind its port while the containerised demo API has
 * it. That container is the only thing this will stop, and only when it is in
 * fact holding the port we need.
 */
async function freeApiPort(cfg) {
  step('5/6', `Port ${cfg.apiPort}`);
  if (!(await tcpProbe(cfg.apiPort))) {
    log(`  :${cfg.apiPort} is free`);
    return true;
  }

  const running = sh('docker', [
    'ps',
    '--filter',
    `name=${DEMO_API_CONTAINER}`,
    '--format',
    '{{.Ports}}',
  ]);
  if (running.status === 0 && running.stdout.includes(`:${cfg.apiPort}->`)) {
    log(`  ${DEMO_API_CONTAINER} holds :${cfg.apiPort} - stopping it so the source API can bind`);
    const stopped = sh('docker', ['stop', DEMO_API_CONTAINER]);
    if (stopped.status !== 0) {
      warn(`could not stop it: ${stopped.stderr || stopped.stdout}`);
      return false;
    }
    // Windows can hold the socket briefly after the container exits.
    for (let i = 0; i < 20; i++) {
      if (!(await tcpProbe(cfg.apiPort))) {
        log(`  :${cfg.apiPort} released`);
        return true;
      }
      await sleep(500);
    }
    warn(`:${cfg.apiPort} still busy after stopping the container`);
    return false;
  }

  warn(`something else is listening on :${cfg.apiPort} and it is not ${DEMO_API_CONTAINER}.`);
  warn(
    `find it:  Get-Process -Id (Get-NetTCPConnection -LocalPort ${cfg.apiPort} -State Listen).OwningProcess`,
  );
  return false;
}

function banner(cfg) {
  const lan = lanAddress();
  const base = lan ? `http://${lan}:${cfg.apiPort}/` : `http://localhost:${cfg.apiPort}/`;
  console.log('\n--- backend url ---');
  console.log(`  local   : http://localhost:${cfg.apiPort}/api`);
  if (lan) console.log(`  lan     : http://${lan}:${cfg.apiPort}/api`);
  console.log(`  swagger : http://localhost:${cfg.apiPort}/api/docs`);
  console.log(`  minio   : http://localhost:${cfg.s3Port + 1}  (minio_admin / minio_password)`);
  console.log('\n  the app is compiled against the LAN url by default; to override without a rebuild:');
  console.log(
    `    flutter run -d <device> --dart-define=MEDIHIVE_API=${base} --dart-define=MEDIHIVE_FILES=${base}`,
  );
  if (lan) {
    console.log(`\n  a phone needs inbound TCP ${cfg.apiPort} allowed through the Windows firewall.`);
    console.log(`  if this address is not ${'192.168.163.97'}, rebuild the app with the --dart-define above.`);
  }
  console.log('');
}

async function main() {
  const cfg = readEnvLocal();

  const dockerOk = await ensureDocker();
  if (!dockerOk) {
    warn('continuing without Docker - Postgres/Redis/MinIO will not come up, and the API will fail to start');
  } else {
    await ensureInfra(cfg);
  }
  await ensureOllama(cfg);
  await ensureSidecar(cfg);
  await freeApiPort(cfg);

  banner(cfg);

  if (NO_API) {
    log('--no-api: dependencies are up, not starting Nest.');
    return;
  }

  step('6/6', 'Nest API (watch mode)');
  // The CLI's entry script is run with this same node, rather than the `nest`
  // shim: the shim is a .cmd on Windows, which Node will only launch through a
  // shell, and a shell is what DEP0190 is about. It also means this works when
  // the file is run directly instead of through `npm run`, where node_modules/
  // .bin is not on PATH.
  //
  // Inherit stdio so Ctrl-C reaches Nest and the watch output is the normal
  // thing you would see from `nest start --watch`.
  const nestBin = path.join(root, 'node_modules', '@nestjs', 'cli', 'bin', 'nest.js');
  const nest = spawn(process.execPath, [nestBin, 'start', '--watch'], {
    cwd: root,
    stdio: 'inherit',
  });
  nest.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
