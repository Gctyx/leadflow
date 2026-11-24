#!/usr/bin/env node
/*
  Leadflow Launcher — Node puro (sem deps)
  - Confere/instala Docker (no Windows, via winget)
  - Gera .env com segredos aleatórios e porta livre
  - docker compose up -d --build e aguarda /health/ready
  - Abre Swagger e oferece um menu básico
*/
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const http = require('node:http');
const readline = require('node:readline');

function ts() { return new Date().toISOString(); }
function log(objOrMsg, msg) {
  if (typeof objOrMsg === 'string') console.log(`[leadflow] ${ts()} - ${objOrMsg}`);
  else console.log(`[leadflow] ${ts()} - ${msg||''}`, objOrMsg);
}
function err(objOrMsg, msg) {
  if (typeof objOrMsg === 'string') console.error(`[leadflow] ${ts()} - ${objOrMsg}`);
  else console.error(`[leadflow] ${ts()} - ${msg||''}`, objOrMsg);
}

const isWindows = process.platform === 'win32';

function baseDir() {
  // Se empacotado (SEA), use a pasta do executável. Em dev, pasta do repo (2 níveis acima deste arquivo)
  if (process.pkg) return path.dirname(process.execPath);
  // heuristic: launcher/src/main.js -> repo root
  return path.resolve(__dirname, '..');
}

function spawn(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = cp.spawn(cmd, args, { stdio: 'inherit', shell: false, ...opts });
    p.on('close', (code) => resolve(code ?? 0));
  });
}

function execOut(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = cp.spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, ...opts });
    let out = '', err = '';
    p.stdout.on('data', (d) => out += d.toString());
    p.stderr.on('data', (d) => err += d.toString());
    p.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error(err || `exit ${code}`)));
  });
}

async function ensureDocker() {
  try {
    const v = await execOut('docker', ['version']);
    log({ line: v.split('\n')[0] }, 'Docker OK (daemon)');
    const cv = await execOut('docker', ['compose', 'version']).catch(() => 'compose: unavailable');
    if (!/Docker Compose/.test(cv)) {
      err('Docker Compose v2 não encontrado. Atualize o Docker Desktop/Engine.');
      process.exit(1);
    }
    return;
  } catch {
    if (!isWindows) {
      err('Docker não encontrado. Instale Docker Engine/Compose e tente novamente: https://docs.docker.com/get-docker/');
      process.exit(1);
    }
    // Tenta iniciar o Docker Desktop e aguardar
    log('Tentando iniciar Docker Desktop...');
    spawn('powershell', ['-NoProfile', '-Command', 'Start-Process -FilePath "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe" -ErrorAction SilentlyContinue']);
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      try { await execOut('docker', ['version']); return; } catch { await new Promise(r => setTimeout(r, 3000)); }
    }
    // Se ainda assim não, tenta instalar via winget
    log('Docker não respondeu. Tentando instalar via winget...');
    const code = await spawn('winget', ['install', '-e', '--id', 'Docker.DockerDesktop']);
    if (code === 0) {
      log('Iniciando Docker Desktop...');
      spawn('powershell', ['-NoProfile', '-Command', 'Start-Process -FilePath "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"']);
      const dl2 = Date.now() + 180_000;
      while (Date.now() < dl2) {
        try { await execOut('docker', ['version']); return; } catch { await new Promise(r => setTimeout(r, 3000)); }
      }
    }
    err('Docker não respondeu. Abra o Docker Desktop e tente novamente.');
    process.exit(1);
  }
}

function randomHex(bytes = 24) { return crypto.randomBytes(bytes).toString('hex'); }

function pickFreePort(defaultPort = 3000) {
  return new Promise((resolve) => {
    const server = http.createServer(() => {}).listen(defaultPort, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      // tenta em faixa 3001-3999
      const tryNext = () => {
        const s = http.createServer(() => {});
        s.listen(0, '127.0.0.1', () => {
          const { port } = s.address();
          s.close(() => resolve(port));
        });
      };
      tryNext();
    });
  });
}

async function ensureEnv(projectDir) {
  const envPath = path.join(projectDir, '.env');
  const examplePath = path.join(projectDir, '.env.example');
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : fs.readFileSync(examplePath, 'utf8');
  const get = (key) => {
    const m = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m ? m[1] : null;
  };
  const set = (key, value) => {
    if (content.match(new RegExp(`^${key}=`, 'm'))) {
      content = content.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
  };
  const mustReplace = (v) => !v || /CHANGE_ME|change-me/.test(v);

  const regenIfWeak = (label, value) => {
    if (!value || value.length < 16 || /CHANGE_ME|change-me/.test(value)) {
      const newVal = randomHex(24);
      log({ label }, 'Gerando segredo aleatório');
      return newVal;
    }
    return value;
  };

  set('API_KEYS', regenIfWeak('API_KEYS', get('API_KEYS')));
  set('WEBHOOK_SECRETS', regenIfWeak('WEBHOOK_SECRETS', get('WEBHOOK_SECRETS')));
  set('MYSQL_PASSWORD', regenIfWeak('MYSQL_PASSWORD', get('MYSQL_PASSWORD')));
  set('MYSQL_ROOT_PASSWORD', regenIfWeak('MYSQL_ROOT_PASSWORD', get('MYSQL_ROOT_PASSWORD')));
  set('REDIS_PASSWORD', regenIfWeak('REDIS_PASSWORD', get('REDIS_PASSWORD')));
  if (mustReplace(get('LEADFLOW_PORT'))) set('LEADFLOW_PORT', String(await pickFreePort(3000)));

  fs.writeFileSync(envPath, content, 'utf8');
  return { envPath, port: Number(get('LEADFLOW_PORT')) || 3000, apiKey: get('API_KEYS'), webhookSecret: get('WEBHOOK_SECRETS') };
}

async function dockerCompose(projectDir, args) {
  const code = await spawn('docker', ['compose', ...args], { cwd: projectDir });
  if (code !== 0) throw new Error(`docker compose ${args.join(' ')} falhou (${code})`);
}

async function waitReady(port, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/health/ready`;
  while (Date.now() < deadline) {
    try {
      const ok = await new Promise((resolve) => {
        const req = http.get(url, (res) => {
          let buf = '';
          res.on('data', (d) => buf += d);
          res.on('end', () => {
            const isOk = res.statusCode === 200 || (res.statusCode === 503 && buf.includes('degraded'));
            log({ status: res.statusCode, body: buf.slice(0, 120) }, 'readiness probe');
            resolve(isOk);
          });
        });
        req.on('error', () => resolve(false));
        req.setTimeout(3000, () => { req.destroy(); resolve(false); });
      });
      if (ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

function openBrowser(url) {
  if (isWindows) return spawn('cmd', ['/c', 'start', '', url]);
  if (process.platform === 'darwin') return spawn('open', [url]);
  return spawn('xdg-open', [url]);
}

async function startFlow(projectDir, autoDemo = false) {
  await ensureDocker();
  const cfg = await ensureEnv(projectDir);
  log('Subindo containers (MySQL, Redis, migrations, API, worker)...');
  await dockerCompose(projectDir, ['up', '-d', '--build']);
  // Checa status inicial
  try {
    const ps = await execOut('docker', ['compose', 'ps', '--format', 'json'], { cwd: projectDir });
    log({ ps: ps.slice(0, 500) }, 'compose ps');
  } catch (e) {
    err({ error: String(e.message || e) }, 'falha ao checar compose ps');
  }
  log('Aguardando API ficar pronta...');
  const ready = await waitReady(cfg.port, 180_000);
  if (!ready) throw new Error('API não ficou pronta dentro do prazo. Veja os logs.');
  log('API pronta. Abrindo Swagger...');
  await openBrowser(`http://localhost:${cfg.port}/docs`);
  log('Chaves:');
  console.log(`  API_KEY: ${cfg.apiKey}`);
  console.log(`  WEBHOOK_SECRET: ${cfg.webhookSecret}`);
  if (autoDemo) {
    log('Demonstração automática ainda não implementada nesta versão.');
  }
}

async function stopFlow(projectDir) {
  await dockerCompose(projectDir, ['stop']);
}

async function cleanFlow(projectDir, force = false) {
  if (!force) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(r => rl.question('Digite APAGAR para remover containers, volumes e imagens: ', (a) => { rl.close(); r(a.trim()); }));
    if (answer !== 'APAGAR') { log('Cancelado.'); return; }
  }
  await dockerCompose(projectDir, ['down', '-v', '--rmi', 'local']);
}

async function main() {
  const projectDir = baseDir();
  const args = process.argv.slice(2);
  const cmd = args[0] || 'menu';
  try {
    if (cmd === 'start') {
      const autoDemo = args.includes('--demo');
      await startFlow(projectDir, autoDemo);
      return;
    }
    if (cmd === 'status') {
      const out = await execOut('docker', ['compose', 'ps'], { cwd: projectDir }).catch(e => String(e.message || e));
      console.log(out);
      return;
    }
    if (cmd === 'logs') {
      await spawn('docker', ['compose', 'logs', '-f', '--tail', '100'], { cwd: projectDir });
      return;
    }
    if (cmd === 'restart') {
      await dockerCompose(projectDir, ['restart']);
      return;
    }
    if (cmd === 'docs') {
      const env = await ensureEnv(projectDir);
      await openBrowser(`http://localhost:${env.port}/docs`);
      return;
    }
    if (cmd === 'keys') {
      const env = await ensureEnv(projectDir);
      console.log(`API_KEY=${env.apiKey}`);
      console.log(`WEBHOOK_SECRET=${env.webhookSecret}`);
      return;
    }
    if (cmd === 'stop') {
      await stopFlow(projectDir); return;
    }
    if (cmd === 'clean') {
      await cleanFlow(projectDir, args.includes('--yes')); return;
    }
    if (cmd === 'where') { console.log(projectDir); return; }
    if (cmd === 'version') { console.log('leadflow-launcher 1.0.0'); return; }
    // menu básico
    await startFlow(projectDir, false);
    log('Opções rápidas:');
    console.log('  - leadflow docs    # abre o Swagger');
    console.log('  - leadflow keys    # mostra chaves');
    console.log('  - leadflow status  # mostra status dos containers');
    console.log('  - leadflow logs    # segue os logs');
    console.log('  - leadflow restart # reinicia serviços');
    console.log('  - leadflow stop    # para containers');
    console.log('  - leadflow clean   # apaga tudo (dados)');
  } catch (e) {
    err({ error: String(e.message || e), stack: e.stack }, 'falha no launcher');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
