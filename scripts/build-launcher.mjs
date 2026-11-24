#!/usr/bin/env node
// Gera release/leadflow.cjs (bundle do launcher) e, no Windows, release/Leadflow.exe via Node SEA + postject.
// Em outros SOs, gera pelo menos o leadflow.cjs (executável com `node release/leadflow.cjs`).
import { rmSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const releaseDir = resolve(projectRoot, 'release');

function sh(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    let realCmd = cmd;
    let realArgs = args;
    if (process.platform === 'win32' && /\.cmd$/i.test(cmd)) {
      realCmd = 'cmd';
      realArgs = ['/c', cmd, ...args];
    }
    const p = spawn(realCmd, realArgs, { stdio: 'inherit', ...opts });
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} -> ${code}`)));
  });
}

async function bundle() {
  rmSync(releaseDir, { recursive: true, force: true });
  mkdirSync(releaseDir, { recursive: true });
  await esbuild.build({
    entryPoints: [resolve(projectRoot, 'launcher', 'src', 'main.js')],
    platform: 'node',
    target: 'node22',
    outfile: resolve(releaseDir, 'leadflow.cjs'),
    bundle: true,
    format: 'cjs',
    sourcemap: false,
    legalComments: 'none',
  });
}

async function buildWindowsExe() {
  const seaConfigPath = resolve(releaseDir, 'sea-config.json');
  const blobPath = resolve(releaseDir, 'sea-prep.blob');
  const exePath = resolve(releaseDir, 'Leadflow.exe');
  const nodeExe = process.execPath; // usa o Node atual como host
  writeFileSync(seaConfigPath, JSON.stringify({ main: resolve(releaseDir, 'leadflow.cjs'), output: blobPath }, null, 2));
  await sh(process.execPath, ['--experimental-sea-config', seaConfigPath]);
  copyFileSync(nodeExe, exePath);
  const postjectBin = process.platform === 'win32'
    ? resolve(projectRoot, 'node_modules', '.bin', 'postject.cmd')
    : resolve(projectRoot, 'node_modules', '.bin', 'postject');
  await sh(postjectBin, [exePath, 'NODE_SEA_BLOB', blobPath]);
}

async function main() {
  await bundle();
  if (process.platform === 'win32') {
    try {
      await buildWindowsExe();
      console.log(`\nOK: release/Leadflow.exe e release/leadflow.cjs gerados.`);
    } catch (e) {
      console.warn('Aviso: não foi possível gerar o .exe (SEA/postject). Usando release/leadflow.cjs como fallback.');
      console.warn(String(e.message || e));
      console.log('Para iniciar: Iniciar-Leadflow.bat ou `node release/leadflow.cjs start --yes`.');
    }
  } else {
    console.log('OK: release/leadflow.cjs gerado. Para binário único neste SO, rode este comando nesta máquina.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
