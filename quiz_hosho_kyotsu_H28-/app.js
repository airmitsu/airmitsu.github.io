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

  const lastMode = localStorage.getItem(STORAGE_KEYS.lastMode);
  if (lastMode === MODES.PSEUDO && hasPseudoResume()) {
    startMode(MODES.PSEUDO, true);
  } else if (lastMode === MODES.MASTER && hasMasterResume()) {
    startMode(MODES.MASTER, true);
  } else {
    showHome();
  }

  registerServiceWorker();
  startImagePrecache();
}

function renderLoadingScreen(title, message, progressText = "") {
  homeScreen.innerHTML = `
    <div class="card">
      <div class="card-title">${escapeHtml(title)}</div>
      <div>${escapeHtml(message)}</div>
      ${progressText ? `<div style="margin-top:8px;color:#5c6b84;">${escapeHtml(progressText)}</div>` : ""}
    </div>
  `;
  showHome();
}

async function loadManifestTitle() {
  try {
    const res = await fetch("./manifest.webmanifest", { cache: "no-store" });
    if (!res.ok) {
      appState.title = DEFAULT_TITLE;
      document.title = DEFAULT_TITLE;
      return;
    }

    const data = await res.json();
    appState.title =
      data && typeof data.name === "string" && data.name.trim()
        ? data.name.trim()
        : DEFAULT_TITLE;

    document.title = appState.title;
  } catch (e) {
    appState.title = DEFAULT_TITLE;
    document.title = DEFAULT_TITLE;
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.fontSize === "number" &&
      FONT_SIZE_OPTIONS.includes(parsed.fontSize)
    ) {
      appState.settings.fontSize = parsed.fontSize;
    }
  } catch (e) {
    // 無視
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(appState.settings));
}

function applyFontSize() {
  document.documentElement.style.setProperty(
    "--question-font-size",
    `${appState.settings.fontSize}px`
  );

  const subFontSize = Math.max(6, appState.settings.fontSize - 2);
  document.documentElement.style.setProperty(
    "--sub-font-size",
    `${subFontSize}px`
  );
}

function loadModeStates() {
  appState.pseudo = loadJson(STORAGE_KEYS.pseudo, null);
  appState.master = loadJson(STORAGE_KEYS.master, null);
}

function saveModeState(mode) {
  if (mode === MODES.PSEUDO) {
    localStorage.setItem(STORAGE_KEYS.pseudo, JSON.stringify(appState.pseudo));
  } else if (mode === MODES.MASTER) {
    localStorage.setItem(STORAGE_KEYS.master, JSON.stringify(appState.master));
  }
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

async function loadProblems() {
  const loaded = [];
  let consecutiveMisses = 0;
  let startIndex = 1;

  while (startIndex <= MAX_PROBLEM_SCAN) {
    const batchIndexes = [];
    for (let i = 0; i < LOAD_BATCH_SIZE && startIndex + i <= MAX_PROBLEM_SCAN; i += 1) {
      batchIndexes.push(startIndex + i);
    }

    appState.loadStatus.phase = "loading";
    appState.loadStatus.totalTried += batchIndexes.length;

    const batchResults = await Promise.all(
      batchIndexes.map((indexNumber) => loadSingleProblem(indexNumber))
    );

    let batchHadHit = false;

    for (const result of batchResults) {
      if (result) {
        loaded.push(result);
        consecutiveMisses = 0;
        batchHadHit = true;
      } else {
        consecutiveMisses += 1;
      }
    }

    appState.loadStatus.loaded = loaded.length;

    renderLoadingScreen(
      "問題読込中",
      `${appState.title} を読み込んでいます。`,
      `${loaded.length}問 読込済み`
    );

    if (!batchHadHit && consecutiveMisses >= MAX_CONSECUTIVE_MISS) {
      break;
    }

    startIndex += LOAD_BATCH_SIZE;
  }

  appState.problems = loaded;
}

async function loadSingleProblem(indexNumber) {
  const toiPath = `${PROBLEMS_DIR}/toi${indexNumber}.txt`;
  const senPath = `${PROBLEMS_DIR}/sen${indexNumber}.txt`;
  const kaiPath = `${PROBLEMS_DIR}/kai${indexNumber}.txt`;

  try {
    const [toiRes, senRes, kaiRes] = await Promise.all([
      fetch(toiPath, { cache: "no-store" }),
      fetch(senPath, { cache: "no-store" }),
      fetch(kaiPath, { cache: "no-store" })
    ]);

    if (!toiRes.ok || !senRes.ok || !kaiRes.ok) {
      return null;
    }

    const [toiText, senText, kaiText] = await Promise.all([
      toiRes.text(),
      senRes.text(),
      kaiRes.text()
    ]);

    const questionText = normalizeMultilineText(toiText);
    if (!questionText) return null;

    const choices = senText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("##"));

    if (choices.length < 2) return null;

    const kaiLines = kaiText
      .split(/\r?\n/)
      .map((line) => line.replace(/\r/g, ""));

    const nonCommentKaiLines = [];
    for (const line of kaiLines) {
      if (line.trim().startsWith("##")) continue;
      nonCommentKaiLines.push(line);
    }

    if (nonCommentKaiLines.length < 1) return null;

    const answerRaw = normalizeDigits(nonCommentKaiLines[0].trim());
    const answerNumber = Number(answerRaw);

    if (!Number.isInteger(answerNumber)) return null;
    if (answerNumber < 1 || answerNumber > choices.length) return null;

    const explanation = nonCommentKaiLines.slice(1).join("\n").trim();
    const correctChoiceText = choices[answerNumber - 1];

    return {
      indexNumber,
      sourcePath: toiPath,
      questionText,
      choices,
      correctChoiceText,
      explanation,
      questionImagePath: `${PROBLEMS_DIR}/toi${indexNumber}.${IMAGE_EXT}`,
      explanationImagePath: `${PROBLEMS_DIR}/kai${indexNumber}.${IMAGE_EXT}`
    };
  } catch (e) {
    return null;
  }
}

function normalizeMultilineText(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("##"))
    .join("\n")
    .trim();
}

function normalizeDigits(str) {
  return str.replace(/[０-９]/g, (s) =>
    String.fromCharCode(s.charCodeAt(0) - 0xfee0)
  );
}

function renderHome() {
  const pseudoStats = getPseudoHomeStats();
  const masterStats = getMasterHomeStats();

  homeScreen.innerHTML = `
    <div class="page-header">
      <div class="app-title">${escapeHtml(appState.title)}</div>
      <div class="page-subtitle">ホーム</div>
    </div>

    <div class="home-grid">
      <section class="card mode-card">
        <div class="card-title">疑似試験モード</div>

        <div class="stats-grid">
          <div class="stat-box">
            <div class="stat-label">正解率</div>
            <div class="stat-value">${pseudoStats.accuracy}%</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">進行状況</div>
            <div class="stat-value">${pseudoStats.progress}</div>
          </div>
        </div>

        <div class="button-row">
          <button class="btn btn-primary" id="btn-pseudo-start">
            ${pseudoStats.canResume ? "続きから" : "開始"}
          </button>
          <button class="btn btn-secondary" id="btn-pseudo-reset">周回リセット</button>
        </div>
      </section>

      <section class="card mode-card">
        <div class="card-title">マスターモード</div>

        <div class="stats-grid">
          <div class="stat-box">
            <div class="stat-label">正解率</div>
            <div class="stat-value">${masterStats.accuracy}%</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">進行状況</div>
            <div class="stat-value">${masterStats.progress}</div>
          </div>
        </div>

        <div class="button-row">
          <button class="btn btn-primary" id="btn-master-start">
            ${masterStats.canResume ? "続きから" : "開始"}
          </button>
          <button class="btn btn-secondary" id="btn-master-reset">周回リセット</button>
        </div>
      </section>
    </div>

    <section class="card settings-card">
      <div class="card-title">共通設定</div>

      <div class="setting-row">
        <label for="font-size-select" class="setting-label">文字サイズ</label>
        <select id="font-size-select" class="select-control">
          ${FONT_SIZE_OPTIONS.map(
            (size) =>
              `<option value="${size}" ${
                size === appState.settings.fontSize ? "selected" : ""
              }>${size}px</option>`
          ).join("")}
        </select>
      </div>
    </section>
  `;

  document.getElementById("btn-pseudo-start").addEventListener("click", () => {
    startMode(MODES.PSEUDO, true);
  });

  document.getElementById("btn-master-start").addEventListener("click", () => {
    startMode(MODES.MASTER, true);
  });

  document.getElementById("btn-pseudo-reset").addEventListener("click", () => {
    resetMode(MODES.PSEUDO);
    renderHome();
    showHome();
  });

  document.getElementById("btn-master-reset").addEventListener("click", () => {
    resetMode(MODES.MASTER);
    renderHome();
    showHome();
  });

  document.getElementById("font-size-select").addEventListener("change", (e) => {
    const value = Number(e.target.value);
    if (FONT_SIZE_OPTIONS.includes(value)) {
      appState.settings.fontSize = value;
      saveSettings();
      applyFontSize();
      renderHome();
      if (!quizScreen.classList.contains("hidden")) {
        renderCurrentQuestion();
      }
    }
  });
}

function getPseudoHomeStats() {
  const state = appState.pseudo;

  if (!state) {
    return {
      accuracy: "0.0",
      progress: `0 / ${appState.problems.length}`,
      canResume: false
    };
  }

  const total = state.order ? state.order.length : appState.problems.length;
  const answered = state.answeredCount || 0;
  const answerCount = state.answerCount || 0;
  const correctCount = state.correctCount || 0;
  const accuracy = calcAccuracy(correctCount, answerCount);
  const isCompleted = answered >= total && total > 0;

  return {
    accuracy,
    progress: isCompleted
      ? `${total} / ${total}`
      : `${Math.min(answered, total)} / ${total}`,
    canResume: !isCompleted && answered < total && total > 0
  };
}

function getMasterHomeStats() {
  const state = appState.master;

  if (!state) {
    return {
      accuracy: "0.0",
      progress: `第1周 / 残り${appState.problems.length}問`,
      canResume: false
    };
  }

  const accuracy = calcAccuracy(state.correctCount || 0, state.answerCount || 0);
  const round = state.round || 1;
  const remain = Array.isArray(state.pool) ? state.pool.length : 0;

  return {
    accuracy,
    progress: `第${round}周 / 残り${remain}問`,
    canResume: remain > 0
  };
}

function calcAccuracy(correct, total) {
  if (!total) return "0.0";
  return ((correct / total) * 100).toFixed(1);
}

function resetMode(mode) {
  if (mode === MODES.PSEUDO) {
    appState.pseudo = null;
    localStorage.removeItem(STORAGE_KEYS.pseudo);
    if (appState.currentMode === MODES.PSEUDO) {
      appState.currentMode = null;
    }
  } else if (mode === MODES.MASTER) {
    appState.master = null;
    localStorage.removeItem(STORAGE_KEYS.master);
    if (appState.currentMode === MODES.MASTER) {
      appState.currentMode = null;
    }
  }

  localStorage.removeItem(STORAGE_KEYS.lastMode);
}

function hasPseudoResume() {
  if (!appState.pseudo || !Array.isArray(appState.pseudo.order)) return false;
  const total = appState.pseudo.order.length;
  const answered = appState.pseudo.answeredCount || 0;
  return answered < total;
}

function hasMasterResume() {
  if (!appState.master || !Array.isArray(appState.master.pool)) return false;
  return appState.master.pool.length > 0;
}

function showHome() {
  quizScreen.classList.add("hidden");
  homeScreen.classList.remove("hidden");
}

function showQuiz() {
  homeScreen.classList.add("hidden");
  quizScreen.classList.remove("hidden");
}

function startMode(mode, allowResume) {
  if (!appState.problems.length) {
    alert("問題が見つかりません。problems フォルダ内の toi#.txt / sen#.txt / kai#.txt を確認してください。");
    return;
  }

  appState.currentMode = mode;
  localStorage.setItem(STORAGE_KEYS.lastMode, mode);

  if (mode === MODES.PSEUDO) {
    if (!allowResume || !hasPseudoResume()) {
      initPseudoMode();
    }
  } else if (mode === MODES.MASTER) {
    if (!allowResume || !hasMasterResume()) {
      initMasterMode();
    }
  }

  renderCurrentQuestion();
  showQuiz();
}

function initPseudoMode() {
  const order = shuffle(appState.problems.map((_, index) => index));

  appState.pseudo = {
    order,
    answeredCount: 0,
    answerCount: 0,
    correctCount: 0,
    currentQuestionShuffledChoices: null,
    currentCorrectIndex: null,
    currentAnswered: false,
    currentSelectedIndex: null,
    currentResult: null
  };

  saveModeState(MODES.PSEUDO);
}

function initMasterMode() {
  const pool = shuffle(appState.problems.map((_, index) => index));

  appState.master = {
    round: 1,
    pool,
    cursor: 0,
    nextRoundPool: [],
    answerCount: 0,
    correctCount: 0,
    currentQuestionShuffledChoices: null,
    currentCorrectIndex: null,
    currentAnswered: false,
    currentSelectedIndex: null,
    currentResult: null
  };

  saveModeState(MODES.MASTER);
}

function renderCurrentQuestion() {
  if (appState.currentMode === MODES.PSEUDO) {
    renderPseudoQuestion();
  } else if (appState.currentMode === MODES.MASTER) {
    renderMasterQuestion();
  }
}

function renderPseudoQuestion() {
  const state = appState.pseudo;
  if (!state) {
    showHome();
    return;
  }

  const total = state.order.length;
  const answered = state.answeredCount;

  if (answered >= total) {
    finishPseudoMode();
    return;
  }

  const problemIndex = state.order[answered];
  const problem = appState.problems[problemIndex];

  ensurePreparedQuestion(state, problem, MODES.PSEUDO);

  const accuracy = calcAccuracy(state.correctCount, state.answerCount);

  renderQuestionLayout({
    title: appState.title,
    modeLabel: "疑似試験モード",
    subInfo: `全${total}問`,
    statItems: [
      { label: "回答数", value: String(state.answerCount) },
      { label: "正解率", value: `${accuracy}%` }
    ],
    question: problem,
    choices: state.currentQuestionShuffledChoices,
    answered: state.currentAnswered,
    selectedIndex: state.currentSelectedIndex,
    result: state.currentResult,
    correctAnswerIndex: state.currentCorrectIndex,
    explanation: problem.explanation,
    explanationImagePath: problem.explanationImagePath,
    footerText: answered === total - 1 ? "最終問題" : "未回答",
    nextLabel: answered === total - 1 ? "終了" : "次へ",
    onChoice: (index) => handlePseudoAnswer(index),
    onNext: () => handlePseudoNext()
  });
}

function renderMasterQuestion() {
  const state = appState.master;
  if (!state) {
    showHome();
    return;
  }

  if (state.pool.length === 0) {
    finishMasterMode();
    return;
  }

  if (state.cursor >= state.pool.length) {
    if (state.nextRoundPool.length === 0) {
      finishMasterMode();
      return;
    }

    state.pool = shuffle([...state.nextRoundPool]);
    state.nextRoundPool = [];
    state.cursor = 0;
    state.round += 1;
    clearPreparedQuestion(state);
    saveModeState(MODES.MASTER);
  }

  const problemIndex = state.pool[state.cursor];
  const problem = appState.problems[problemIndex];

  ensurePreparedQuestion(state, problem, MODES.MASTER);

  const accuracy = calcAccuracy(state.correctCount, state.answerCount);
  const remain = state.pool.length - state.cursor;

  renderQuestionLayout({
    title: appState.title,
    modeLabel: "マスターモード",
    subInfo: `第${state.round}周 / 残り${remain}問`,
    statItems: [
      { label: "残り問題数", value: String(remain) },
      { label: "正解率", value: `${accuracy}%` }
    ],
    question: problem,
    choices: state.currentQuestionShuffledChoices,
    answered: state.currentAnswered,
    selectedIndex: state.currentSelectedIndex,
    result: state.currentResult,
    correctAnswerIndex: state.currentCorrectIndex,
    explanation: problem.explanation,
    explanationImagePath: problem.explanationImagePath,
    footerText: state.currentAnswered ? "" : "未回答",
    nextLabel: "次へ",
    onChoice: (index) => handleMasterAnswer(index),
    onNext: () => handleMasterNext()
  });
}

function renderQuestionLayout({
  title,
  modeLabel,
  subInfo,
  statItems,
  question,
  choices,
  answered,
  selectedIndex,
  result,
  correctAnswerIndex,
  explanation,
  explanationImagePath,
  footerText,
  nextLabel,
  onChoice,
  onNext
}) {
  quizScreen.innerHTML = `
    <div class="quiz-page card">
      <div class="quiz-header">
        <div class="quiz-header-left">
          <div class="quiz-app-title">${escapeHtml(title)}</div>
          <div class="quiz-mode-title">${escapeHtml(modeLabel)}</div>
          <div class="quiz-subinfo">${escapeHtml(subInfo)}</div>
        </div>
        <div class="quiz-header-right">
          <button class="btn btn-home" id="btn-home">ホーム</button>
        </div>
      </div>

      <div class="stats-grid quiz-stats">
        ${statItems.map((item) => `
          <div class="stat-box">
            <div class="stat-label">${escapeHtml(item.label)}</div>
            <div class="stat-value">${escapeHtml(item.value)}</div>
          </div>
        `).join("")}
      </div>

      <div class="question-block">
        <div class="question-text">
          ${escapeHtml(question.questionText).replace(/\n/g, "<br>")}
          <div style="margin-top:6px; font-size:0.8em; color:#5c6b84;">
            （問題番号：${question.indexNumber}）
          </div>
        </div>

        <div class="question-image-wrap" id="question-image-wrap" style="display:none;">
          <img alt="問題画像" class="question-image" id="question-image" />
        </div>
      </div>

      <div class="choices">
        ${choices.map((choice, index) => {
          const selectedClass = selectedIndex === index ? " selected" : "";
          const disabledAttr = answered ? "disabled" : "";
          const toZenkaku = (n) => String.fromCharCode(n + 0xFF10);
          const labelText = index === 0 ? "わからない" : choice;
          const choiceLabel = `${toZenkaku(index)}：${labelText}`;
          return `
            <button
              class="choice-btn${selectedClass}"
              data-choice-index="${index}"
              ${disabledAttr}
            >
              ${escapeHtml(choiceLabel)}
            </button>
          `;
        }).join("")}
      </div>

      ${answered ? `
        <div class="result-panel ${result === "correct" ? "correct" : "wrong"}">
          ${result === "correct" ? "正解" : "間違い"}
        </div>
      ` : ""}

      ${answered && result === "wrong" ? `
        <div class="result-panel correct-answer-panel">
          正解：${escapeHtml(String(correctAnswerIndex ?? ""))}
        </div>
      ` : ""}

      ${answered && (explanation || explanationImagePath) ? `
        <div class="explanation-block">
          ${explanation ? `
            <div class="explanation-title">解説</div>
            <div class="explanation-body">${escapeHtml(explanation).replace(/\n/g, "<br>")}</div>
          ` : ""}

          <div class="question-image-wrap explanation-image-wrap" id="explanation-image-wrap" style="display:none;">
            <img alt="解説画像" class="question-image" id="explanation-image" />
          </div>
        </div>
      ` : ""}

      <div class="quiz-footer">
        <div class="quiz-footer-left">${escapeHtml(footerText)}</div>
        <button class="btn btn-next" id="btn-next" ${answered ? "" : "disabled"}>
          ${escapeHtml(nextLabel)}
        </button>
      </div>
    </div>
  `;

  document.getElementById("btn-home").addEventListener("click", () => {
    renderHome();
    showHome();
  });

  document.querySelectorAll("[data-choice-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.choiceIndex);
      onChoice(index);
    });
  });

  document.getElementById("btn-next").addEventListener("click", onNext);

  attachSinglePngImage(
    document.getElementById("question-image"),
    document.getElementById("question-image-wrap"),
    question.questionImagePath
  );

  attachSinglePngImage(
    document.getElementById("explanation-image"),
    document.getElementById("explanation-image-wrap"),
    explanationImagePath
  );
}

function attachSinglePngImage(imgEl, wrapEl, src) {
  if (!imgEl || !wrapEl || !src) {
    if (wrapEl) wrapEl.style.display = "none";
    return;
  }

  imgEl.onload = () => {
    wrapEl.style.display = "";
    enableImageZoomPan(imgEl);
  };

  imgEl.onerror = () => {
    wrapEl.style.display = "none";
  };

  imgEl.src = src;
}

async function startImagePrecache() {
  if (appState.imagePrecacheStarted) return;
  appState.imagePrecacheStarted = true;

  if (!("caches" in window)) return;

  try {
    const cache = await caches.open(IMAGE_CACHE_NAME);

    for (const problem of appState.problems) {
      const targets = [
        problem.questionImagePath,
        problem.explanationImagePath
      ].filter(Boolean);

      for (const url of targets) {
        const exists = await cache.match(url);
        if (exists) continue;

        try {
          const res = await fetch(url, { cache: "no-store" });
          if (res.ok) {
            await cache.put(url, res.clone());
          }
        } catch (e) {
          // 画像なしは想定内
        }
      }
    }
  } catch (e) {
    // 無視
  }
}

function ensurePreparedQuestion(state, problem, mode) {
  if (Array.isArray(state.currentQuestionShuffledChoices)) {
    return;
  }

  const shuffledReal = shuffle([...problem.choices]);
  const shuffledChoices = ["？ わからない", ...shuffledReal];
  const correctIndex = shuffledChoices.findIndex(
    (choice) => choice === problem.correctChoiceText
  );

  state.currentQuestionShuffledChoices = shuffledChoices;
  state.currentCorrectIndex = correctIndex;
  state.currentAnswered = false;
  state.currentSelectedIndex = null;
  state.currentResult = null;

  saveModeState(mode);
}

function clearPreparedQuestion(state) {
  state.currentQuestionShuffledChoices = null;
  state.currentCorrectIndex = null;
  state.currentAnswered = false;
  state.currentSelectedIndex = null;
  state.currentResult = null;
}

function handlePseudoAnswer(selectedIndex) {
  const state = appState.pseudo;
  if (!state || state.currentAnswered) return;

  state.currentAnswered = true;
  state.currentSelectedIndex = selectedIndex;
  state.answerCount += 1;

  const isCorrect = selectedIndex === state.currentCorrectIndex;
  if (isCorrect) {
    state.correctCount += 1;
    state.currentResult = "correct";
  } else {
    state.currentResult = "wrong";
  }

  saveModeState(MODES.PSEUDO);
  renderPseudoQuestion();
}

function handlePseudoNext() {
  const state = appState.pseudo;
  if (!state || !state.currentAnswered) return;

  state.answeredCount += 1;
  clearPreparedQuestion(state);
  saveModeState(MODES.PSEUDO);

  if (state.answeredCount >= state.order.length) {
    finishPseudoMode();
  } else {
    renderPseudoQuestion();
  }
}

function handleMasterAnswer(selectedIndex) {
  const state = appState.master;
  if (!state || state.currentAnswered) return;

  state.currentAnswered = true;
  state.currentSelectedIndex = selectedIndex;
  state.answerCount += 1;

  const isCorrect = selectedIndex === state.currentCorrectIndex;
  if (isCorrect) {
    state.correctCount += 1;
    state.currentResult = "correct";
  } else {
    state.currentResult = "wrong";
    const problemIndex = state.pool[state.cursor];
    state.nextRoundPool.push(problemIndex);
  }

  saveModeState(MODES.MASTER);
  renderMasterQuestion();
}

function handleMasterNext() {
  const state = appState.master;
  if (!state || !state.currentAnswered) return;

  state.cursor += 1;
  clearPreparedQuestion(state);
  saveModeState(MODES.MASTER);
  renderMasterQuestion();
}

function finishPseudoMode() {
  const state = appState.pseudo;
  const accuracy = calcAccuracy(state?.correctCount || 0, state?.answerCount || 0);

  alert(`疑似試験モードが終了しました。正解率は ${accuracy}% です。`);

  if (state) {
    state.answeredCount = state.order.length;
    clearPreparedQuestion(state);
    saveModeState(MODES.PSEUDO);
  }

  localStorage.removeItem(STORAGE_KEYS.lastMode);
  appState.currentMode = null;

  renderHome();
  showHome();
}

function finishMasterMode() {
  const accuracy = calcAccuracy(
    appState.master?.correctCount || 0,
    appState.master?.answerCount || 0
  );

  alert(`マスターモードが完了しました。正解率は ${accuracy}% です。`);

  appState.master = {
    round: 1,
    pool: [],
    cursor: 0,
    nextRoundPool: [],
    answerCount: appState.master?.answerCount || 0,
    correctCount: appState.master?.correctCount || 0,
    currentQuestionShuffledChoices: null,
    currentCorrectIndex: null,
    currentAnswered: false,
    currentSelectedIndex: null,
    currentResult: null
  };

  saveModeState(MODES.MASTER);
  localStorage.removeItem(STORAGE_KEYS.lastMode);
  appState.currentMode = null;

  renderHome();
  showHome();
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        // 無視
      });
    });
  }
}

function enableImageZoomPan(img) {
  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let isDragging = false;
  let startX = 0;
  let startY = 0;

  const applyTransform = () => {
    img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  };

  img.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      scale = Math.min(6, Math.max(1, scale + delta));
      if (scale === 1) {
        translateX = 0;
        translateY = 0;
      }
      applyTransform();
    },
    { passive: false }
  );

  img.addEventListener("pointerdown", (e) => {
    if (scale <= 1) return;
    isDragging = true;
    startX = e.clientX - translateX;
    startY = e.clientY - translateY;
    img.setPointerCapture(e.pointerId);
  });

  img.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    translateX = e.clientX - startX;
    translateY = e.clientY - startY;
    applyTransform();
  });

  img.addEventListener("pointerup", () => {
    isDragging = false;
  });

  img.addEventListener("pointercancel", () => {
    isDragging = false;
  });

  img.addEventListener("dblclick", () => {
    scale = 1;
    translateX = 0;
    translateY = 0;
    applyTransform();
  });
}

document.addEventListener("keydown", (e) => {
  const active = document.activeElement;
  const tag = active && active.tagName ? active.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (active && active.isContentEditable) return;

  if (quizScreen.classList.contains("hidden")) return;

  const key = e.key;

  if (/^[0-9]$/.test(key)) {
    const buttons = document.querySelectorAll("[data-choice-index]");
    if (!buttons.length) return;

    const num = Number(key);

    if (num === 0) {
      e.preventDefault();
      buttons[0]?.click();
      return;
    }

    if (num < buttons.length) {
      e.preventDefault();
      buttons[num]?.click();
      return;
    }
  }

  if (key === "Enter") {
    const nextBtn = document.getElementById("btn-next");
    if (nextBtn && !nextBtn.disabled) {
      e.preventDefault();
      nextBtn.click();
    }
  }
});
