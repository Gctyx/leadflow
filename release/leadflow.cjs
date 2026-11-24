#!/usr/bin/env node
"use strict";

// launcher/src/main.js
var os = require("node:os");
var fs = require("node:fs");
var path = require("node:path");
var crypto = require("node:crypto");
var cp = require("node:child_process");
var http = require("node:http");
var readline = require("node:readline");
function log(...args) {
  console.log("[leadflow]", ...args);
}
function err(...args) {
  console.error("[leadflow]", ...args);
}
var isWindows = process.platform === "win32";
function baseDir() {
  if (process.pkg) return path.dirname(process.execPath);
  return path.resolve(__dirname, "..");
}
function spawn(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = cp.spawn(cmd, args, { stdio: "inherit", shell: false, ...opts });
    p.on("close", (code) => resolve(code ?? 0));
  });
}
function execOut(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = cp.spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], shell: false, ...opts });
    let out = "", err2 = "";
    p.stdout.on("data", (d) => out += d.toString());
    p.stderr.on("data", (d) => err2 += d.toString());
    p.on("close", (code) => code === 0 ? resolve(out.trim()) : reject(new Error(err2 || `exit ${code}`)));
  });
}
async function ensureDocker() {
  try {
    const v = await execOut("docker", ["version"]);
    log(`Docker OK (daemon)
${v.split("\n")[0]}`);
    return;
  } catch {
    if (!isWindows) {
      err("Docker n\xE3o encontrado. Instale Docker Engine/Compose e tente novamente: https://docs.docker.com/get-docker/");
      process.exit(1);
    }
    log("Tentando iniciar Docker Desktop...");
    spawn("powershell", ["-NoProfile", "-Command", 'Start-Process -FilePath "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe" -ErrorAction SilentlyContinue']);
    const deadline = Date.now() + 18e4;
    while (Date.now() < deadline) {
      try {
        await execOut("docker", ["version"]);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 3e3));
      }
    }
    log("Docker n\xE3o respondeu. Tentando instalar via winget...");
    const code = await spawn("winget", ["install", "-e", "--id", "Docker.DockerDesktop"]);
    if (code === 0) {
      log("Iniciando Docker Desktop...");
      spawn("powershell", ["-NoProfile", "-Command", 'Start-Process -FilePath "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"']);
      const dl2 = Date.now() + 18e4;
      while (Date.now() < dl2) {
        try {
          await execOut("docker", ["version"]);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 3e3));
        }
      }
    }
    err("Docker n\xE3o respondeu. Abra o Docker Desktop e tente novamente.");
    process.exit(1);
  }
}
function randomHex(bytes = 24) {
  return crypto.randomBytes(bytes).toString("hex");
}
function pickFreePort(defaultPort = 3e3) {
  return new Promise((resolve) => {
    const server = http.createServer(() => {
    }).listen(defaultPort, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      const tryNext = () => {
        const s = http.createServer(() => {
        });
        s.listen(0, "127.0.0.1", () => {
          const { port } = s.address();
          s.close(() => resolve(port));
        });
      };
      tryNext();
    });
  });
}
async function ensureEnv(projectDir) {
  const envPath = path.join(projectDir, ".env");
  const examplePath = path.join(projectDir, ".env.example");
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : fs.readFileSync(examplePath, "utf8");
  const get = (key) => {
    const m = content.match(new RegExp(`^${key}=(.*)$`, "m"));
    return m ? m[1] : null;
  };
  const set = (key, value) => {
    if (content.match(new RegExp(`^${key}=`, "m"))) {
      content = content.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
    } else {
      content += `
${key}=${value}`;
    }
  };
  const mustReplace = (v) => !v || /CHANGE_ME|change-me/.test(v);
  if (mustReplace(get("API_KEYS"))) set("API_KEYS", randomHex(24));
  if (mustReplace(get("WEBHOOK_SECRETS"))) set("WEBHOOK_SECRETS", randomHex(24));
  if (mustReplace(get("MYSQL_PASSWORD"))) set("MYSQL_PASSWORD", randomHex(24));
  if (mustReplace(get("MYSQL_ROOT_PASSWORD"))) set("MYSQL_ROOT_PASSWORD", randomHex(24));
  if (mustReplace(get("REDIS_PASSWORD"))) set("REDIS_PASSWORD", randomHex(24));
  if (mustReplace(get("LEADFLOW_PORT"))) set("LEADFLOW_PORT", String(await pickFreePort(3e3)));
  fs.writeFileSync(envPath, content, "utf8");
  return { envPath, port: Number(get("LEADFLOW_PORT")) || 3e3, apiKey: get("API_KEYS"), webhookSecret: get("WEBHOOK_SECRETS") };
}
async function dockerCompose(projectDir, args) {
  const code = await spawn("docker", ["compose", ...args], { cwd: projectDir });
  if (code !== 0) throw new Error(`docker compose ${args.join(" ")} falhou (${code})`);
}
async function waitReady(port, timeoutMs = 12e4) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/health/ready`;
  while (Date.now() < deadline) {
    try {
      const ok = await new Promise((resolve) => {
        const req = http.get(url, (res) => {
          let buf = "";
          res.on("data", (d) => buf += d);
          res.on("end", () => {
            resolve(res.statusCode === 200 || res.statusCode === 503 && buf.includes("degraded"));
          });
        });
        req.on("error", () => resolve(false));
        req.setTimeout(3e3, () => {
          req.destroy();
          resolve(false);
        });
      });
      if (ok) return true;
    } catch {
    }
    await new Promise((r) => setTimeout(r, 2e3));
  }
  return false;
}
function openBrowser(url) {
  if (isWindows) return spawn("cmd", ["/c", "start", "", url]);
  if (process.platform === "darwin") return spawn("open", [url]);
  return spawn("xdg-open", [url]);
}
async function startFlow(projectDir, autoDemo = false) {
  await ensureDocker();
  const cfg = await ensureEnv(projectDir);
  log("Subindo containers (MySQL, Redis, migrations, API, worker)...");
  await dockerCompose(projectDir, ["up", "-d", "--build"]);
  log("Aguardando API ficar pronta...");
  const ready = await waitReady(cfg.port, 18e4);
  if (!ready) throw new Error("API n\xE3o ficou pronta dentro do prazo. Veja os logs.");
  log("API pronta. Abrindo Swagger...");
  await openBrowser(`http://localhost:${cfg.port}/docs`);
  log("Chaves:");
  console.log(`  API_KEY: ${cfg.apiKey}`);
  console.log(`  WEBHOOK_SECRET: ${cfg.webhookSecret}`);
  if (autoDemo) {
    log("Demonstra\xE7\xE3o autom\xE1tica ainda n\xE3o implementada nesta vers\xE3o.");
  }
}
async function stopFlow(projectDir) {
  await dockerCompose(projectDir, ["stop"]);
}
async function cleanFlow(projectDir, force = false) {
  if (!force) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((r) => rl.question("Digite APAGAR para remover containers, volumes e imagens: ", (a) => {
      rl.close();
      r(a.trim());
    }));
    if (answer !== "APAGAR") {
      log("Cancelado.");
      return;
    }
  }
  await dockerCompose(projectDir, ["down", "-v", "--rmi", "local"]);
}
async function main() {
  const projectDir = baseDir();
  const args = process.argv.slice(2);
  const cmd = args[0] || "menu";
  try {
    if (cmd === "start") {
      const autoDemo = args.includes("--demo");
      await startFlow(projectDir, autoDemo);
      return;
    }
    if (cmd === "docs") {
      const env = await ensureEnv(projectDir);
      await openBrowser(`http://localhost:${env.port}/docs`);
      return;
    }
    if (cmd === "keys") {
      const env = await ensureEnv(projectDir);
      console.log(`API_KEY=${env.apiKey}`);
      console.log(`WEBHOOK_SECRET=${env.webhookSecret}`);
      return;
    }
    if (cmd === "stop") {
      await stopFlow(projectDir);
      return;
    }
    if (cmd === "clean") {
      await cleanFlow(projectDir, args.includes("--yes"));
      return;
    }
    if (cmd === "where") {
      console.log(projectDir);
      return;
    }
    if (cmd === "version") {
      console.log("leadflow-launcher 1.0.0");
      return;
    }
    await startFlow(projectDir, false);
    log("Op\xE7\xF5es r\xE1pidas:");
    console.log("  - leadflow docs    # abre o Swagger");
    console.log("  - leadflow keys    # mostra chaves");
    console.log("  - leadflow stop    # para containers");
    console.log("  - leadflow clean   # apaga tudo (dados)");
  } catch (e) {
    err(e.message || e);
    process.exit(1);
  }
}
if (require.main === module) {
  main();
}
