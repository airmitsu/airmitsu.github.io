const DEFAULT_TITLE = "問題集PWA";
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

const appState = {
  title: DEFAULT_TITLE,
  problems: [],
  settings: {
    fontSize: DEFAULT_FONT_SIZE
  },
  currentMode: null,
  pseudo: null,
  master: null
};

const homeScreen = document.getElementById("screen-home");
const quizScreen = document.getElementById("screen-quiz");

document.addEventListener("DOMContentLoaded", init);

async function init() {
  loadSettings();
  loadModeStates();
  applyFontSize();

  await loadTitle();
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

async function loadTitle() {
  try {
    const res = await fetch("./title.txt", { cache: "no-store" });
    if (!res.ok) {
      appState.title = DEFAULT_TITLE;
      document.title = DEFAULT_TITLE;
      return;
    }

    const text = await res.text();
    const firstLine = (text.split(/\r?\n/)[0] || "").trim();
    appState.title = firstLine || DEFAULT_TITLE;
    document.title = appState.title;
  } catch (e) {
    appState.title = DEFAULT_TITLE;
    document.title = DEFAULT_TITLE;
  }
}

async function loadProblems() {
  try {
    const res = await fetch("./problems-index.json", { cache: "no-store" });
    if (!res.ok) {
      appState.problems = [];
      return;
    }

    const data = await res.json();
    const paths = Array.isArray(data.problems) ? data.problems : [];
    const loaded = [];

    for (const relPath of paths) {
      const problem = await loadSingleProblem(relPath);
      if (problem) {
        loaded.push(problem);
      }
    }

    appState.problems = loaded;
  } catch (e) {
    appState.problems = [];
  }
}

async function loadSingleProblem(relPath) {
  try {
    const res = await fetch(`./${relPath}`, { cache: "no-store" });
    if (!res.ok) return null;

    const text = await res.text();
    const rawLines = text.split(/\r?\n/);

    const lines = rawLines
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("##"));

    if (lines.length < 4) return null;

    const questionText = lines[0].trim();
    const answerRaw = normalizeDigits(lines[1]).trim();
    const choices = lines.slice(2).map((v) => v.trim()).filter(Boolean);

    if (!questionText || choices.length < 2) return null;

    const answerNumber = Number(answerRaw);
    if (!Number.isInteger(answerNumber)) return null;
    if (answerNumber < 1 || answerNumber > choices.length) return null;

    const correctChoiceText = choices[answerNumber - 1];

    const basePath = relPath.replace(/[^/]+$/, "");
    const fileName = relPath.split("/").pop() || "";
    const match = fileName.match(/^toi(\d+)\.txt$/i);
    const indexNumber = match ? match[1] : null;

    let explanation = "";
    if (indexNumber) {
      const kaiPath = `${basePath}kai${indexNumber}.txt`;
      explanation = await tryLoadText(kaiPath);
    }

    let imagePath = null;
    if (indexNumber) {
      const imgBase = `${basePath}toi${indexNumber}`;
      imagePath = await findExistingImage(imgBase);
    }

    return {
      sourcePath: relPath,
      questionText,
      choices,
      correctChoiceText,
      explanation,
      imagePath
    };
  } catch (e) {
    return null;
  }
}

async function tryLoadText(path) {
  try {
    const res = await fetch(`./${path}`, { cache: "no-store" });
    if (!res.ok) return "";
    return (await res.text()).trim();
  } catch (e) {
    return "";
  }
}

async function findExistingImage(imgBase) {
  const exts = ["jpg", "jpeg", "png"];

  for (const ext of exts) {
    const path = `${imgBase}.${ext}`;
    try {
      const res = await fetch(`./${path}`, {
        method: "HEAD",
        cache: "no-store"
      });
      if (res.ok) return `./${path}`;
    } catch (e) {
      // 次へ
    }
  }

  return null;
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
    progress: isCompleted ? `${total} / ${total}` : `${Math.min(answered, total)} / ${total}`,
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
  renderHome();
}

function showQuiz() {
  homeScreen.classList.add("hidden");
  quizScreen.classList.remove("hidden");
}

function startMode(mode, allowResume) {
  if (!appState.problems.length) {
    alert("問題が見つかりません。problems-index.json と問題ファイルを確認してください。");
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
    explanation: problem.explanation,
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
    explanation: problem.explanation,
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
  explanation,
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
        <div class="question-text">${escapeHtml(question.questionText)}</div>

        ${question.imagePath ? `
          <div class="question-image-wrap">
            <img
              src="${question.imagePath}"
              alt="問題画像"
              class="question-image"
              id="question-image"
            />
          </div>
        ` : ""}
      </div>

      <div class="choices">
        ${choices.map((choice, index) => {
          const selectedClass = selectedIndex === index ? " selected" : "";
          const disabledAttr = answered ? "disabled" : "";
          return `
            <button
              class="choice-btn${selectedClass}"
              data-choice-index="${index}"
              ${disabledAttr}
            >
              ${escapeHtml(choice)}
            </button>
          `;
        }).join("")}
      </div>

      ${answered ? `
        <div class="result-panel ${result === "correct" ? "correct" : "wrong"}">
          ${result === "correct" ? "正解" : "間違い"}
        </div>
      ` : ""}

      ${answered && explanation ? `
        <div class="explanation-block">
          <div class="explanation-title">解説</div>
          <div class="explanation-body">${escapeHtml(explanation).replace(/\n/g, "<br>")}</div>
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

  const img = document.getElementById("question-image");
  if (img) {
    enableImageZoomPan(img);
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
  const accuracy = calcAccuracy(
    state?.correctCount || 0,
    state?.answerCount || 0
  );

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