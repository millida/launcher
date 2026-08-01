import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = join(root, "src-tauri");

const MODES = {
  fast: {
    description: "быстрая проверка правок: exe без установщика, профиль fast",
    profile: "fast",
    bundle: false,
  },
  "fast-bundle": {
    description: "установщик из быстрой сборки, свой кэш в target/fast-bundle",
    profile: "fast",
    bundle: true,
  },
  release: {
    description: "то же, что собирает CI: профиль release, установщик, подпись",
    profile: "release",
    bundle: true,
  },
};

const mode = process.argv[2] ?? "fast";
const flags = new Set(process.argv.slice(3));
const timings = flags.has("--timings");
const explain = flags.has("--why");

if (!MODES[mode]) {
  console.error(`Неизвестный режим «${mode}». Доступно: ${Object.keys(MODES).join(", ")}`);
  process.exit(2);
}

const config = MODES[mode];

function run(command, args, { cwd = root, env = {}, capture = false } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",
      stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
      env: { ...process.env, ...env },
    });
    let output = "";
    if (capture) {
      child.stdout.on("data", (chunk) => {
        output += chunk;
        process.stdout.write(chunk);
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
    }
    child.on("error", fail);
    child.on("close", (code) =>
      code === 0 ? done(output) : fail(new Error(`${command} завершился с кодом ${code}`)),
    );
  });
}

function human(seconds) {
  const total = Math.round(seconds);
  return total >= 60 ? `${Math.floor(total / 60)}м ${String(total % 60).padStart(2, "0")}с` : `${total}с`;
}

function reportTimings(targetDir) {
  const dir = join(targetDir, "cargo-timings");
  if (!existsSync(dir)) return;
  const latest = readdirSync(dir)
    .filter((name) => name.startsWith("cargo-timing-") && name.endsWith(".html"))
    .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at)[0];
  if (!latest) return;

  const html = readFileSync(join(dir, latest.name), "utf8");
  const raw = html.match(/const UNIT_DATA = (\[[\s\S]*?\]);/);
  if (!raw) return;

  const units = JSON.parse(raw[1]);
  const compiled = units
    .map((unit) => ({
      name: `${unit.name} v${unit.version}${unit.mode === "build" ? "" : ` (${unit.mode})`}`,
      duration: unit.duration,
      codegen: unit.rmeta_time ? unit.duration - unit.rmeta_time : 0,
    }))
    .sort((a, b) => b.duration - a.duration);

  const wall = Math.max(...units.map((unit) => unit.start + unit.duration));
  const cpu = compiled.reduce((sum, unit) => sum + unit.duration, 0);

  console.log(`\nЧто именно собиралось (${compiled.length} единиц, суммарно ${human(cpu)} CPU):`);
  for (const unit of compiled.slice(0, 12)) {
    console.log(`  ${human(unit.duration).padStart(7)}  ${unit.name}`);
  }
  const linkShare = compiled[0] && compiled[0].duration / wall;
  if (compiled.length <= 3 && linkShare > 0.5) {
    console.log(
      `\n  Пересобран только сам крейт — остальное время это линковка. ` +
        `Если долго и в профиле fast, смотри lto/codegen-units в src-tauri/Cargo.toml.`,
    );
  }
  console.log(`\n  Полный отчёт: ${join(dir, latest.name)}`);
}

function reportFingerprints(log) {
  const dirty = [...log.matchAll(/fingerprint dirty for ([^:]+): (.+)/g)].map((match) => ({
    unit: match[1].trim(),
    reason: match[2].trim(),
  }));
  if (!dirty.length) {
    console.log("\nПересборок не потребовалось: весь кэш свежий.");
    return;
  }
  console.log(`\nПочему пересобиралось (${dirty.length} единиц):`);
  for (const item of dirty.slice(0, 20)) {
    console.log(`  ${item.unit}\n      ${item.reason}`);
  }
}

const targetDir =
  config.bundle && config.profile !== "release"
    ? join(tauriDir, "target", "fast-bundle")
    : process.env.CARGO_TARGET_DIR || join(tauriDir, "target");

const started = Date.now();
console.log(`Сборка: ${mode} — ${config.description}`);
console.log(`Профиль cargo: ${config.profile}, кэш: ${targetDir}\n`);

const cargoEnv = {};
if (config.bundle && config.profile !== "release") {
  cargoEnv.CARGO_TARGET_DIR = targetDir;
  cargoEnv.CARGO_PROFILE_RELEASE_LTO = "false";
  cargoEnv.CARGO_PROFILE_RELEASE_CODEGEN_UNITS = "16";
  cargoEnv.CARGO_PROFILE_RELEASE_INCREMENTAL = "true";
}
if (explain) cargoEnv.CARGO_LOG = "cargo::core::compiler::fingerprint=info";

try {
  if (config.bundle) {
    const args = ["tauri", "build"];
    if (config.profile === "release") args.push("--config", "src-tauri/tauri.release.conf.json");
    const log = await run("bun", args, { env: cargoEnv, capture: explain });
    if (explain) reportFingerprints(log);
  } else {
    await run("bun", ["run", "build:web"]);
    const args = ["build", "--profile", config.profile];
    if (timings) args.push("--timings");
    const log = await run("cargo", args, { cwd: tauriDir, env: cargoEnv, capture: explain });
    if (explain) reportFingerprints(log);
    if (timings) reportTimings(targetDir);
    const exe = join(
      targetDir,
      config.profile,
      process.platform === "win32" ? "millida-launcher.exe" : "millida-launcher",
    );
    if (existsSync(exe)) console.log(`\nГотово: ${exe}`);
  }
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(1);
}

console.log(`\nВсего: ${human((Date.now() - started) / 1000)}`);
