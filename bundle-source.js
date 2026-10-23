/**
 * bundle-source.js — 우리 팀 소스를 한 개의 파일로 묶습니다.
 *
 * 쓰는 법 (Next.js 프로젝트 폴더에서):
 *   node bundle-source.js              ← 화면 코드만
 *   node bundle-source.js D:\          ← Pico(CIRCUITPY) 코드도 같이
 *
 * 비밀번호가 들어있는 파일(.env, settings.toml)은 자동으로 빠집니다.
 */
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PICO_DRIVE = process.argv[2] || null;
const OUT = path.join(ROOT, "우리팀-소스.md");

// ── 통째로 건너뛸 폴더 ──
// ※ "lib" 은 넣지 않습니다. 2주차에서 만든 src/lib/db.ts 가 빠져 버립니다.
//    (CIRCUITPY/lib 는 아래에서 main.py 만 읽으므로 애초에 들어오지 않습니다)
const SKIP_DIRS = new Set([
  "node_modules", ".next", ".git", ".vscode", "out", "build",
]);

// ── 절대 넣으면 안 되는 파일 (비밀번호가 들어있다) ──
const SECRET_FILES = [/^\.env/i, /^settings\.toml$/i, /^secrets?\./i];

// ── 넣을 확장자 ──
const OK_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", ".json", ".py"];

// ── 코드블록 언어 표시 ──
const LANG = {
  ".ts": "typescript", ".tsx": "typescript", ".js": "javascript",
  ".jsx": "javascript", ".mjs": "javascript", ".css": "css",
  ".json": "json", ".py": "python",
};

// ── 혹시 남아있을 비밀번호를 찾는 그물 ──
const SECRET_WORDS = /(password|passwd|secret|api[_-]?key|token|CIRCUITPY_WIFI)/i;

const included = [];
const skippedSecret = [];
const warnings = [];

function walk(dir, base = "") {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    const stat = fs.statSync(full);

    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
      walk(full, rel);
      continue;
    }
    if (SECRET_FILES.some((re) => re.test(name))) {
      skippedSecret.push(rel);
      continue;
    }
    if (!OK_EXT.includes(path.extname(name))) continue;
    // 묶기 도구와 그 결과물은 "우리 팀 소스" 가 아니므로 넣지 않습니다.
    // (14주차 이후에는 bundle-ui.js 도 같은 폴더에 있게 됩니다)
    if ([
      "package-lock.json",
      "우리팀-소스.md", "bundle-source.js",
      "우리팀-UI.md", "bundle-ui.js",
    ].includes(name)) continue;

    const text = fs.readFileSync(full, "utf8");
    included.push({ rel, text, ext: path.extname(name) });

    text.split("\n").forEach((line, i) => {
      if (SECRET_WORDS.test(line) && /[:=]\s*["'][^"']{4,}/.test(line)) {
        warnings.push(`${rel}:${i + 1}  ${line.trim().slice(0, 60)}`);
      }
    });
  }
}

walk(ROOT);

// ── Pico 코드 ──
if (PICO_DRIVE) {
  const picoMain = path.join(PICO_DRIVE, "main.py");
  if (fs.existsSync(picoMain)) {
    const text = fs.readFileSync(picoMain, "utf8");
    // 이미 같은 내용이 들어갔으면(프로젝트 안에 복사본이 있는 경우) 두 번 넣지 않는다
    if (!included.some((f) => f.text === text)) {
      included.push({ rel: "CIRCUITPY/main.py", text, ext: ".py" });
    }
  } else {
    console.log(`\n(!) ${picoMain} 을 찾지 못했습니다. Pico 코드는 빠집니다.`);
  }
  const st = path.join(PICO_DRIVE, "settings.toml");
  if (fs.existsSync(st)) skippedSecret.push("CIRCUITPY/settings.toml");
}

// ── 파일 만들기 ──
const today = new Date().toISOString().slice(0, 10);
let md = `# 우리 팀 IoT 프로젝트 소스\n\n`;
md += `생성일: ${today} · 파일 ${included.length}개\n\n`;
md += `## 들어있는 파일\n\n`;
included.forEach((f) => (md += `- \`${f.rel}\` (${f.text.split("\n").length}줄)\n`));
md += `\n---\n\n`;
included.forEach((f) => {
  md += `## \`${f.rel}\`\n\n\`\`\`${LANG[f.ext] || ""}\n${f.text.replace(/\s+$/, "")}\n\`\`\`\n\n`;
});

fs.writeFileSync(OUT, md, "utf8");

// ── 결과 보고 ──
console.log(`\n✅ ${path.basename(OUT)} 를 만들었습니다 (${(md.length / 1024).toFixed(1)} KB)\n`);
console.log("넣은 파일:");
included.forEach((f) => console.log(`   ${f.rel}`));
if (skippedSecret.length) {
  console.log("\n🔒 비밀번호가 들어있어 뺀 파일:");
  skippedSecret.forEach((f) => console.log(`   ${f}`));
}
if (warnings.length) {
  console.log("\n⚠️  비밀번호처럼 보이는 줄이 남아 있습니다. 올리기 전에 확인하세요:");
  warnings.forEach((w) => console.log(`   ${w}`));
} else {
  console.log("\n✅ 비밀번호처럼 보이는 줄은 없습니다.");
}
console.log(`\n이 파일을 제미나이에 올리세요: ${OUT}\n`);
