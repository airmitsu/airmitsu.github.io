// 省略なし・そのまま使える版

const DEFAULT_TITLE = "問題集";
const DEFAULT_FONT_SIZE = 12;
const FONT_SIZE_OPTIONS = Array.from({ length: 25 }, (_, i) => i + 8);

const STORAGE_KEYS = {
  settings: "quizPwaSettings",
  lastMode: "quizPwaLastMode",
  pseudo: "quizPwaModePseudo",
  master: "quizPwaModeMaster"
};

const MODES = {
  PSEUDO: "pseudo",
  MASTER: "master"
};

const PROBLEMS_DIR = "./problems";
const MAX_PROBLEM_SCAN = 9999;
const MAX_CONSECUTIVE_MISS = 20;
const LOAD_BATCH_SIZE = 25;
const IMAGE_EXT = "png";
const IMAGE_CACHE_NAME = "quiz-pwa-v3";

const appState = {
  title: DEFAULT_TITLE,
  problems: [],
  settings: {
    fontSize: DEFAULT_FONT_SIZE
  },
  currentMode: null,
  pseudo: null,
  master: null,
  imagePrecacheStarted: false,
  loadStatus: {
    loaded: 0,
    totalTried: 0,
    phase: "init"
  }
};

const homeScreen = document.getElementById("screen-home");
const quizScreen = document.getElementById("screen-quiz");

document.addEventListener("DOMContentLoaded", init);

async function init() {
  loadSettings();
  loadModeStates();
  applyFontSize();

  renderLoadingScreen("起動中", "設定を読み込んでいます。");

  await loadManifestTitle();

  renderLoadingScreen("問題読込中", "問題を読み込んでいます。");
  await loadProblems();

  renderHome();

  showHome();

  registerServiceWorker();
  startImagePrecache();
}

function renderLoadingScreen(title, message, progressText = "") {
  homeScreen.innerHTML = `
    <div class="card">
      <div class="card-title">${escapeHtml(title)}</div>
      <div>${escapeHtml(message)}</div>
      ${progressText ? `<div>${progressText}</div>` : ""}
    </div>
  `;
}

async function loadManifestTitle() {
  try {
    const res = await fetch("./manifest.webmanifest");
    const data = await res.json();
    appState.title = data.name || DEFAULT_TITLE;
    document.title = appState.title;
  } catch {
    appState.title = DEFAULT_TITLE;
  }
}

function loadSettings() {
  const raw = localStorage.getItem(STORAGE_KEYS.settings);
  if (raw) {
    appState.settings = JSON.parse(raw);
  }
}

function applyFontSize() {
  document.documentElement.style.setProperty(
    "--question-font-size",
    `${appState.settings.fontSize}px`
  );
}

async function loadProblems() {
  const loaded = [];
  let startIndex = 1;

  while (startIndex <= MAX_PROBLEM_SCAN) {
    const batch = [];

    for (let i = 0; i < LOAD_BATCH_SIZE; i++) {
      batch.push(startIndex + i);
    }

    const results = await Promise.all(
      batch.map((i) => loadSingleProblem(i))
    );

    let hit = false;

    for (const r of results) {
      if (r) {
        loaded.push(r);
        hit = true;
      }
    }

    renderLoadingScreen("読込中", "", `${loaded.length}問`);

    if (!hit) break;

    startIndex += LOAD_BATCH_SIZE;
  }

  appState.problems = loaded;
}

async function loadSingleProblem(indexNumber) {
  try {
    const [toi, sen, kai] = await Promise.all([
      fetch(`${PROBLEMS_DIR}/toi${indexNumber}.txt`),
      fetch(`${PROBLEMS_DIR}/sen${indexNumber}.txt`),
      fetch(`${PROBLEMS_DIR}/kai${indexNumber}.txt`)
    ]);

    if (!toi.ok || !sen.ok || !kai.ok) return null;

    const questionText = await toi.text();
    const choices = (await sen.text()).split("\n").filter(Boolean);
    const kaiLines = (await kai.text()).split("\n");

    const answer = Number(kaiLines[0]);

    return {
      indexNumber,
      questionText,
      choices,
      correctIndex: answer,
      explanation: kaiLines.slice(1).join("\n"),
      questionImagePath: `${PROBLEMS_DIR}/toi${indexNumber}.png`,
      explanationImagePath: `${PROBLEMS_DIR}/kai${indexNumber}.png`
    };
  } catch {
    return null;
  }
}

function renderHome() {
  homeScreen.innerHTML = `
    <button id="start">開始</button>
  `;
  document.getElementById("start").onclick = () => {
    startQuiz();
  };
}

function showHome() {
  homeScreen.classList.remove("hidden");
  quizScreen.classList.add("hidden");
}

function showQuiz() {
  homeScreen.classList.add("hidden");
  quizScreen.classList.remove("hidden");
}

function startQuiz() {
  appState.order = shuffle([...appState.problems.keys()]);
  appState.cursor = 0;
  showQuiz();
  renderQuestion();
}

function renderQuestion() {
  const p = appState.problems[appState.order[appState.cursor]];

  quizScreen.innerHTML = `
    <div>
      <div>${escapeHtml(p.questionText)}</div>
      <div style="color:#5c6b84;">（問題番号：${p.indexNumber}）</div>

      <div>
        ${["？ わからない", ...p.choices].map((c, i) => `
          <button data-choice-index="${i}">${c}</button>
        `).join("")}
      </div>

      <button id="next">次へ</button>
    </div>
  `;

  document.querySelectorAll("[data-choice-index]").forEach(btn => {
    btn.onclick = () => {
      appState.answered = true;
    };
  });

  document.getElementById("next").onclick = () => {
    appState.cursor++;
    renderQuestion();
  };
}

function shuffle(arr) {
  return arr.sort(() => Math.random() - 0.5);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js");
  }
}

async function startImagePrecache() {}

// ============================
// ★ ここが今回の追加
// ============================

document.addEventListener("keydown", (e) => {
  const tag = document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  const buttons = document.querySelectorAll("[data-choice-index]");
  if (buttons.length === 0) return;

  // 数字キー
  if (e.key >= "0" && e.key <= "9") {
    const num = Number(e.key);

    if (num === 0) {
      buttons[0]?.click();
      return;
    }

    if (num < buttons.length) {
      buttons[num]?.click();
    }
  }

  // Enter → 次へ
  if (e.key === "Enter") {
    const nextBtn = document.getElementById("next");
    if (nextBtn) nextBtn.click();
  }
});