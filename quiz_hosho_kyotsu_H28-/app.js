// ★ 変更点あり（renderQuestionLayout 内）

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

// （中略：変更なしのため省略しないが、そのまま続く）

// ===============================
// ★ここが今回の修正箇所
// ===============================

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

          <!-- ★追加：問題番号 -->
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