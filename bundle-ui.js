/**
 * bundle-ui.js — 화면(UI) 코드만 한 개의 MD 파일로 묶습니다.
 *
 * 쓰는 법 (Tailwind 프로젝트 iot-tailwind 폴더에서):
 *   node bundle-ui.js
 *
 * → 우리팀-UI.md 가 만들어집니다. 제미나이에 이 파일 하나만 올리면 됩니다.
 *
 * 11주차의 bundle-source.js 는 프로젝트를 "전부" 묶습니다.
 * 이것은 "보이는 부분만" 묶습니다 — 통신·DB·Pico 코드를 일부러 뺍니다.
 * 올리는 범위가 좁을수록 AI 가 엉뚱한 곳을 건드리지 않습니다. 그것이 14주차의 핵심입니다.
 */
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const OUT_NAME = "우리팀-UI.md";

// ── ① 반드시 들어가는 화면 파일 (이 순서로 들어갑니다) ──
const CORE = [
  "src/app/globals.css",          // 색 토큰(@theme) 이 여기 있습니다
  "src/app/layout.tsx",           // 바깥 틀
  "src/app/dashboard/page.tsx",   // 오늘 고치는 파일
];

// ── ② 더 찾아볼 폴더 (팀이 화면 파일을 더 만들었을 때) ──
const SCAN_DIRS = ["src/app", "src/components"];
const SCAN_EXT = [".tsx", ".jsx", ".css"];

// ── ③ 환경을 알려주는 파일 (버전을 보고 답하게 하려고 넣습니다) ──
const CONFIG = ["package.json", "postcss.config.mjs"];

// ── 화면이 아니라서 빼는 것 ──
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "api", "lib"]);
const SKIP_FILES = new Set([
  "src/app/page.tsx",   // create-next-app 이 만들어 준 기본 화면 — 우리가 안 건드립니다
]);

// ── 절대 넣으면 안 되는 파일 (비밀번호가 들어있다) ──
const SECRET_FILES = [/^\.env/i, /^settings\.toml$/i, /^secrets?\./i];

// ── 혹시 코드에 박혀 있을 비밀번호를 찾는 그물 ──
const SECRET_WORDS = /(password|passwd|secret|api[_-]?key|token|CIRCUITPY_WIFI)/i;

const LANG = {
  ".tsx": "tsx", ".jsx": "jsx", ".css": "css",
  ".json": "json", ".mjs": "javascript", ".js": "javascript", ".ts": "typescript",
};

const included = [];
const seen = new Set();
const skippedSecret = [];
// 14주차의 핵심이 "좁게 올리는 것" 이라서, 뺀 폴더를 눈에 보이게 찍어 줍니다.
// 조용히 빼기만 하면 학생이 매뉴얼 체크리스트("api 와 lib 을 뺐다고 찍혀 있다")를
// 확인할 수 없습니다 — 14주차 모의 진행에서 나온 문제입니다.
const PROTECTED_DIRS = [
  { rel: "src/app/api", why: "서버 · 통신 코드 — 오늘 고칠 것이 아닙니다" },
  { rel: "src/lib",     why: "데이터베이스 코드 — 오늘 고칠 것이 아닙니다" },
];
const protectedFound = [];
const warnings = [];
const notes = [];

/** 저장소 기준 상대경로는 항상 "/" 로 만듭니다 (윈도우에서도 같게 보이도록) */
function toRel(parts) {
  return parts.join("/");
}

function add(rel) {
  if (seen.has(rel)) return false;
  const full = path.join(ROOT, ...rel.split("/"));
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return false;

  const name = path.basename(rel);
  if (SECRET_FILES.some((re) => re.test(name))) {
    skippedSecret.push(rel);
    return false;
  }

  const text = fs.readFileSync(full, "utf8");
  seen.add(rel);
  included.push({ rel, text, ext: path.extname(rel) });

  text.split("\n").forEach((line, i) => {
    if (SECRET_WORDS.test(line) && /[:=]\s*["'][^"']{4,}/.test(line)) {
      warnings.push(`${rel}:${i + 1}  ${line.trim().slice(0, 60)}`);
    }
  });
  return true;
}

function scan(relDir) {
  const full = path.join(ROOT, ...relDir.split("/"));
  if (!fs.existsSync(full)) return;
  for (const name of fs.readdirSync(full).sort()) {
    const rel = toRel([relDir, name]);
    const stat = fs.statSync(path.join(full, name));
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
      scan(rel);
      continue;
    }
    if (!SCAN_EXT.includes(path.extname(name))) continue;
    if (SKIP_FILES.has(rel)) {
      notes.push(`${rel} — create-next-app 기본 화면이라 뺐습니다`);
      continue;
    }
    add(rel);
  }
}

// ── 모으기 ──
const missing = CORE.filter((rel) => !add(rel));
SCAN_DIRS.forEach(scan);
CONFIG.forEach(add);

// ── 비밀번호 파일이 있으면 "뺐다"고 눈에 보이게 알려 줍니다 ──
//    (애초에 읽지도 않지만, 빠진 것을 확인하는 것이 11주차에서 배운 습관입니다)
for (const n of [".env", ".env.local", ".env.development", ".env.production", "settings.toml"]) {
  if (fs.existsSync(path.join(ROOT, n))) skippedSecret.push(n);
}

// ── Tailwind v4 에는 없어야 하는 파일 ──
for (const n of ["tailwind.config.js", "tailwind.config.ts", "tailwind.config.mjs"]) {
  if (fs.existsSync(path.join(ROOT, n))) {
    add(n);
    warnings.push(
      `${n} 이 있습니다 — Tailwind v4 에는 보통 없는 파일입니다. ` +
      `AI 가 만들라고 해서 만든 것이면 지우고, 설정은 globals.css 의 @theme 에 쓰세요.`
    );
  }
}

if (!included.length) {
  console.error(
    "\n(!) 화면 파일을 하나도 찾지 못했습니다.\n" +
    "    iot-tailwind 프로젝트 폴더(= package.json 이 있는 곳)에서 실행했는지 확인하세요.\n"
  );
  process.exit(1);
}

// ── MD 만들기 ──
const totalLines = included.reduce((n, f) => n + f.text.split("\n").length, 0);
const today = new Date().toISOString().slice(0, 10);

let md = `# 우리 팀 화면(UI) 소스\n\n`;
md += `생성일: ${today} · 파일 ${included.length}개 · ${totalLines}줄\n\n`;

md += `## 이 파일을 읽는 AI 에게\n\n`;
md += `- 이것은 **Next.js + Tailwind CSS v4** 프로젝트의 **화면 코드만** 모은 것입니다.\n`;
md += `- 통신(WebSocket) 코드와 Pico 코드, 데이터베이스 코드는 **일부러 뺐습니다.**\n`;
md += `- 오늘 고치는 파일은 \`src/app/dashboard/page.tsx\` 입니다.\n`;
md += `- \`SENSORS\` / \`SWITCHES\` 배열 구조와 통신 함수\n`;
md += `  (\`connect\` · \`disconnect\` · \`sendCommand\` 등 이 소스에 있는 이름), 자동 제어 \`useEffect\` 는\n`;
md += `  **한 글자도 바꾸지 마세요.** 바꿀 것은 보이는 부분뿐입니다.\n`;
md += `- 색과 간격은 파일 맨 위 **\`const UI = { ... }\` 객체**에 모여 있습니다.\n`;
md += `  반복되는 스타일이 생기면 그 객체에 항목을 더하세요. \`globals.css\` 에 \`@theme\` 을 만들지 마세요.\n`;
md += `- \`package.json\` 을 같이 넣었습니다. **버전을 보고** 답해 주세요.\n`;
md += `  단, 새 라이브러리를 추가하자고 하지는 마세요.\n`;
md += `- 같이 올린 \`프로젝트-규칙.md\` 의 규칙을 **모두** 지켜 주세요.\n`;
md += `- 학생마다 소스가 조금씩 다릅니다. **여기 실제로 있는 것**을 기준으로 답해 주세요.\n\n`;

md += `## 들어있는 파일\n\n`;
included.forEach((f) => (md += `- \`${f.rel}\` (${f.text.split("\n").length}줄)\n`));
md += `\n---\n\n`;
included.forEach((f) => {
  md += `## \`${f.rel}\`\n\n`;
  md += `\`\`\`${LANG[f.ext] || ""}\n${f.text.replace(/\s+$/, "")}\n\`\`\`\n\n`;
});

const OUT = path.join(ROOT, OUT_NAME);
fs.writeFileSync(OUT, md, "utf8");

// ── 결과 보고 ──
console.log(`\n✅ ${OUT_NAME} 를 만들었습니다 (${(md.length / 1024).toFixed(1)} KB)\n`);
console.log("넣은 파일:");
included.forEach((f) => console.log(`   ${f.rel}`));

if (missing.length) {
  console.log("\n(!) 못 찾은 화면 파일:");
  missing.forEach((f) => console.log(`   ${f}`));
  console.log("    대시보드 파일이 다른 곳에 있을 수 있습니다.");
  console.log("    src/app 아래에서 \"use client\" 로 시작하는 page.tsx 를 찾아보세요.");
}
// 실제로 있는 폴더만 찍습니다 (없는 것을 뺐다고 하면 거짓말이 됩니다)
PROTECTED_DIRS.forEach((d) => {
  const full = path.join(ROOT, ...d.rel.split("/"));
  if (fs.existsSync(full) && fs.statSync(full).isDirectory()) protectedFound.push(d);
});
if (protectedFound.length) {
  console.log("\n🛡️  화면이 아니라서 통째로 뺀 폴더:");
  protectedFound.forEach((d) => console.log(`   ${d.rel}/  — ${d.why}`));
  console.log("    안 올라간 코드는 AI 가 망가뜨릴 수 없습니다.");
}
if (notes.length) {
  console.log("\n— 일부러 뺀 것:");
  notes.forEach((n) => console.log(`   ${n}`));
}
if (skippedSecret.length) {
  console.log("\n🔒 비밀번호가 들어있어 뺀 파일:");
  skippedSecret.forEach((f) => console.log(`   ${f}`));
}
if (warnings.length) {
  console.log("\n⚠️  올리기 전에 확인하세요:");
  warnings.forEach((w) => console.log(`   ${w}`));
} else {
  console.log("\n✅ 비밀번호처럼 보이는 줄은 없습니다.");
}
console.log(`\n이 파일을 제미나이에 올리세요: ${OUT}`);
console.log(`같이 올릴 것: 프로젝트-규칙.md\n`);
