(() => {
  'use strict';

  const STORAGE_KEY = 'quizPwaState_v1_3';
  const DEFAULT_TITLE = '問題集PWA';
  const MODE_EXAM = 'exam';
  const MODE_MASTER = 'master';
  const SPECIAL_CHOICE_ID = '__unknown__';

  const app = document.getElementById('app');

  const state = {
    ready: false,
    problemSet: [],
    title: DEFAULT_TITLE,
    settings: {
      fontScale: 1.0,
    },
    ui: {
      currentScreen: 'home',
      overlayText: '',
    },
    lastMode: null,
    exam: createDefaultExamState(),
    master: createDefaultMasterState(),
  };

  init().catch((err) => {
    console.error(err);
    app.innerHTML = '<div class="card"><div class="card-title">読み込みに失敗しました</div><div class="muted">ファイル配置を確認してください。</div></div>';
  });

  async function init() {
    loadLocalState();
    applyFontScale();
    registerServiceWorker();

    const [title, problemPaths] = await Promise.all([
      loadTitle(),
      loadProblemIndex(),
    ]);

    state.title = title;
    document.title = title;

    const problems = await loadProblems(problemPaths);
    state.problemSet = problems;

    repairStatesAfterProblemLoad();

    if (!state.lastMode) {
      state.ui.currentScreen = 'home';
    } else {
      state.ui.currentScreen = 'mode';
    }

    state.ready = true;
    saveState();
    render();
  }

  function createDefaultExamState() {
    return {
      order: [],
      currentIndex: 0,
      answered: 0,
      correct: 0,
      totalAttempts: 0,
      history: [],
      currentQuestionAnswered: false,
      currentQuestionResult: null,
      currentQuestionSelectedId: null,
      currentQuestionExplanation: '',
      currentDisplayedChoices: [],
    };
  }

  function createDefaultMasterState() {
    return {
      round: 1,
      queue: [],
      nextQueue: [],
      currentIndex: 0,
      answered: 0,
      correct: 0,
      totalAttempts: 0,
      history: [],
      currentQuestionAnswered: false,
      currentQuestionResult: null,
      currentQuestionSelectedId: null,
      currentQuestionExplanation: '',
      currentDisplayedChoices: [],
      completed: false,
    };
  }

  function loadLocalState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') {
        state.settings = { ...state.settings, ...(saved.settings || {}) };
        state.lastMode = saved.lastMode || null;
        state.exam = { ...createDefaultExamState(), ...(saved.exam || {}) };
        state.master = { ...createDefaultMasterState(), ...(saved.master || {}) };
      }
    } catch (err) {
      console.warn('state load failed', err);
    }
  }

  function saveState() {
    const payload = {
      settings: state.settings,
      lastMode: state.lastMode,
      exam: state.exam,
      master: state.master,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  function applyFontScale() {
    document.documentElement.style.fontSize = `${16 * state.settings.fontScale}px`;
  }

  async function loadTitle() {
    try {
      const text = await fetchText('title.txt');
      const firstLine = (text.split(/\r?\n/)[0] || '').trim();
      return firstLine || DEFAULT_TITLE;
    } catch (_) {
      return DEFAULT_TITLE;
    }
  }

  async function loadProblemIndex() {
    const res = await fetch('problems-index.json', { cache: 'no-cache' });
    if (!res.ok) {
      throw new Error('problems-index.json の読込失敗');
    }
    const data = await res.json();
    const problems = Array.isArray(data.problems) ? data.problems : [];
    return problems.filter((p) => typeof p === 'string' && p.trim());
  }

  async function loadProblems(paths) {
    const results = [];
    for (const relativePath of paths) {
      const problem = await loadSingleProblem(relativePath);
      if (problem) results.push(problem);
    }
    return results;
  }

  async function loadSingleProblem(relativePath) {
    try {
      const raw = await fetchText(relativePath);
      const parsed = parseProblemText(raw);
      if (!parsed) return null;

      const baseNoExt = relativePath.replace(/\.[^.]+$/, '');
      const explainPath = baseNoExt.replace(/toi(\d+)$/i, 'kai$1') + '.txt';
      const imagePath = await findFirstExistingImage(baseNoExt);

      let explanation = '';
      try {
        explanation = await fetchText(explainPath);
      } catch (_) {
        explanation = '';
      }

      const choices = parsed.choices.map((choiceText, idx) => ({
        id: `c${idx + 1}`,
        text: choiceText,
        isCorrect: idx === parsed.correctIndex,
      }));

      return {
        id: relativePath,
        sourcePath: relativePath,
        questionText: parsed.questionText,
        choices,
        explanation: explanation.trim(),
        imagePath,
      };
    } catch (err) {
      console.warn('problem skipped', relativePath, err);
      return null;
    }
  }

  function parseProblemText(raw) {
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.replace(/\uFEFF/g, ''))
      .filter((line) => !line.trim().startsWith('##'));

    if (lines.length < 4) return null;

    const questionText = (lines[0] || '').trim();
    const rawAnswer = normalizeDigits((lines[1] || '').trim()).replace(/\s+/g, '');
    const answerNum = Number(rawAnswer);
    const choices = lines.slice(2).map((line) => line.trim()).filter(Boolean);

    if (!questionText || !Number.isInteger(answerNum) || choices.length < 2) return null;
    if (answerNum < 1 || answerNum > choices.length) return null;

    return {
      questionText,
      correctIndex: answerNum - 1,
      choices,
    };
  }

  function normalizeDigits(value) {
    return value.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
  }

  async function fetchText(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`fetch failed: ${path}`);
    return await res.text();
  }

  async function findFirstExistingImage(baseNoExt) {
    const exts = ['jpg', 'jpeg', 'png'];
    for (const ext of exts) {
      const path = `${baseNoExt}.${ext}`;
      try {
        const res = await fetch(path, { method: 'HEAD', cache: 'no-cache' });
        if (res.ok) return path;
      } catch (_) {
      }
    }
    return '';
  }

  function repairStatesAfterProblemLoad() {
    const allIds = state.problemSet.map((p) => p.id);

    state.exam.order = sanitizeIdList(state.exam.order, allIds);
    if (state.exam.order.length === 0 && allIds.length > 0) {
      state.exam.order = shuffled([...allIds]);
      state.exam.currentIndex = 0;
      clearCurrentQuestionState(state.exam);
    }
    if (state.exam.currentIndex >= state.exam.order.length) {
      state.exam.currentIndex = Math.max(0, state.exam.order.length - 1);
    }

    state.master.queue = sanitizeIdList(state.master.queue, allIds);
    state.master.nextQueue = sanitizeIdList(state.master.nextQueue, allIds);
    if (state.master.queue.length === 0 && !state.master.completed && allIds.length > 0) {
      state.master.queue = shuffled([...allIds]);
      state.master.currentIndex = 0;
      state.master.round = Math.max(1, state.master.round || 1);
      clearCurrentQuestionState(state.master);
    }
    if (state.master.currentIndex >= state.master.queue.length) {
      state.master.currentIndex = Math.max(0, state.master.queue.length - 1);
    }
  }

  function sanitizeIdList(ids, validIds) {
    const set = new Set(validIds);
    return Array.isArray(ids) ? ids.filter((id) => set.has(id)) : [];
  }

  function render() {
    applyFontScale();
    if (!state.ready) return;

    const body = state.ui.currentScreen === 'home'
      ? renderHome()
      : renderModeScreen();

    app.innerHTML = body + renderOverlay();
    bindCommonEvents();

    if (state.ui.currentScreen !== 'home') {
      bindModeEvents();
    }
  }

  function renderHome() {
    return `
      <div class="header-row">
        <div>
          <div class="screen-title">${escapeHtml(state.title)}</div>
          <div class="screen-subtitle">ホーム</div>
        </div>
      </div>

      <div class="home-grid">
        ${renderHomeCard(MODE_EXAM)}
        ${renderHomeCard(MODE_MASTER)}
      </div>

      <div class="card" style="margin-top:14px;">
        <div class="card-title">共通設定</div>
        <div class="settings-row">
          <label for="fontScale">文字サイズ</label>
          <select id="fontScale">
            ${renderFontOptions()}
          </select>
        </div>
      </div>
    `;
  }

  function renderHomeCard(mode) {
    const s = mode === MODE_EXAM ? state.exam : state.master;
    const rate = formatRate(s.correct, s.totalAttempts);

    let progressText = '';
    if (mode === MODE_EXAM) {
      const total = state.problemSet.length;
      const current = total === 0 ? 0 : Math.min(s.currentIndex + 1, total);
      progressText = `${current} / ${total}`;
    } else {
      progressText = s.completed ? `完了` : `第${s.round}周 / 残り${getMasterRemainingCount()}問`;
    }

    return `
      <div class="card">
        <div class="card-title">${mode === MODE_EXAM ? '疑似試験モード' : 'マスターモード'}</div>
        <div class="stats">
          <div class="stat">
            <div class="stat-label">正解率</div>
            <div class="stat-value">${rate}</div>
          </div>
          <div class="stat">
            <div class="stat-label">進行状況</div>
            <div class="stat-value">${escapeHtml(progressText)}</div>
          </div>
        </div>
        <div class="btn-row">
          <button class="primary" data-action="start-mode" data-mode="${mode}">${getContinueLabel(mode)}</button>
          <button class="danger" data-action="reset-mode" data-mode="${mode}">周回リセット</button>
        </div>
      </div>
    `;
  }

  function renderFontOptions() {
    const options = [
      { value: 0.9, label: '小' },
      { value: 1.0, label: '標準' },
      { value: 1.15, label: '大' },
      { value: 1.3, label: '特大' },
    ];
    return options.map((opt) => {
      const selected = Number(state.settings.fontScale) === opt.value ? 'selected' : '';
      return `<option value="${opt.value}" ${selected}>${opt.label}</option>`;
    }).join('');
  }

  function renderModeScreen() {
    const mode = state.lastMode;
    const s = mode === MODE_EXAM ? state.exam : state.master;
    const question = getCurrentQuestion(mode);

    if (!question) {
      return `
        <div class="header-row">
          <div>
            <div class="screen-title">${mode === MODE_EXAM ? '疑似試験モード' : 'マスターモード'}</div>
            <div class="screen-subtitle">出題できる問題がありません</div>
          </div>
          <button data-action="go-home">ホーム</button>
        </div>
        <div class="card">問題ファイルを確認してください。</div>
      `;
    }

    const choices = getDisplayedChoices(mode, question);
    const rate = formatRate(s.correct, s.totalAttempts);

    return `
      <div class="header-row">
        <div>
          <div class="screen-title">${mode === MODE_EXAM ? '疑似試験モード' : 'マスターモード'}</div>
          <div class="screen-subtitle">${escapeHtml(renderModeMeta(mode))}</div>
        </div>
        <button data-action="go-home">ホーム</button>
      </div>

      <div class="card">
        <div class="top-actions">
          ${renderModeStats(mode, rate)}
        </div>

        ${question.imagePath ? renderImageBox(question.imagePath) : ''}

        <div class="question-text">${escapeHtml(question.questionText)}</div>

        <div class="choices">
          ${choices.map((choice) => renderChoiceButton(choice, s)).join('')}
        </div>

        ${s.currentQuestionAnswered ? renderExplanationBox(s) : ''}

        <div class="footer-row">
          <div class="muted">${s.currentQuestionAnswered ? '採点済み' : '未回答'}</div>
          <button class="primary" data-action="next-question" ${s.currentQuestionAnswered ? '' : 'disabled'}>次へ</button>
        </div>
      </div>
    `;
  }

  function renderModeStats(mode, rate) {
    const s = mode === MODE_EXAM ? state.exam : state.master;
    if (mode === MODE_EXAM) {
      return `
        <div class="stat"><div class="stat-label">回答数（今回）</div><div class="stat-value">${s.answered}</div></div>
        <div class="stat"><div class="stat-label">正解率（今回累積）</div><div class="stat-value">${rate}</div></div>
      `;
    }
    return `
      <div class="stat"><div class="stat-label">現在周回</div><div class="stat-value">${s.round}</div></div>
      <div class="stat"><div class="stat-label">残り問題数</div><div class="stat-value">${getMasterRemainingCount()}</div></div>
      <div class="stat"><div class="stat-label">正解率</div><div class="stat-value">${rate}</div></div>
    `;
  }

  function renderModeMeta(mode) {
    if (mode === MODE_EXAM) {
      return `全${state.problemSet.length}問`;
    }
    if (state.master.completed) {
      return '完了';
    }
    return `第${state.master.round}周`;
  }

  function renderChoiceButton(choice, s) {
    const answered = s.currentQuestionAnswered;
    let className = 'choice-btn';

    if (choice.id === SPECIAL_CHOICE_ID) {
      className += ' special';
    }

    if (answered) {
      if (choice.isCorrect) className += ' correct';
      if (s.currentQuestionSelectedId === choice.id && !choice.isCorrect) className += ' incorrect';
    }

    return `<button class="${className}" data-action="answer" data-choice-id="${choice.id}" ${answered ? 'disabled' : ''}>${escapeHtml(choice.text)}</button>`;
  }

  function renderExplanationBox(s) {
    const label = s.currentQuestionResult === 'correct' ? '正解' : '間違い';
    const body = s.currentQuestionExplanation ? escapeHtml(s.currentQuestionExplanation) : '解説なし';
    return `<div class="explain-box"><strong>${label}</strong><br>${body}</div>`;
  }

  function renderImageBox(path) {
    return `
      <div class="image-wrap">
        <div class="image-stage" id="imageStage">
          <img id="questionImage" class="zoomable" src="${encodeURI(path)}" alt="問題画像">
        </div>
        <div class="image-controls">
          <button data-action="zoom-out">－</button>
          <button data-action="zoom-reset">戻す</button>
          <button data-action="zoom-in">＋</button>
        </div>
      </div>
    `;
  }

  function renderOverlay() {
    return `<div class="overlay ${state.ui.overlayText ? '' : 'hidden'}" id="resultOverlay">${escapeHtml(state.ui.overlayText)}</div>`;
  }

  function bindCommonEvents() {
    app.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', handleActionClick);
    });

    const fontScale = document.getElementById('fontScale');
    if (fontScale) {
      fontScale.addEventListener('change', () => {
        state.settings.fontScale = Number(fontScale.value) || 1.0;
        applyFontScale();
        saveState();
        render();
      });
    }
  }

  function bindModeEvents() {
    initImageZoom();
  }

  function handleActionClick(event) {
    const button = event.currentTarget;
    const action = button.dataset.action;
    const mode = button.dataset.mode;

    switch (action) {
      case 'start-mode':
        startMode(mode);
        break;
      case 'reset-mode':
        resetMode(mode);
        break;
      case 'go-home':
        state.ui.currentScreen = 'home';
        saveState();
        render();
        break;
      case 'answer':
        answerCurrentQuestion(button.dataset.choiceId);
        break;
      case 'next-question':
        moveNextQuestion();
        break;
      case 'zoom-in':
        updateZoom(0.25);
        break;
      case 'zoom-out':
        updateZoom(-0.25);
        break;
      case 'zoom-reset':
        resetZoom();
        break;
      default:
        break;
    }
  }

  function startMode(mode) {
    state.lastMode = mode;
    state.ui.currentScreen = 'mode';

    if (mode === MODE_EXAM && state.exam.order.length === 0 && state.problemSet.length > 0) {
      state.exam.order = shuffled(state.problemSet.map((p) => p.id));
    }
    if (mode === MODE_MASTER && state.master.queue.length === 0 && !state.master.completed && state.problemSet.length > 0) {
      state.master.queue = shuffled(state.problemSet.map((p) => p.id));
    }

    saveState();
    render();
  }

  function resetMode(mode) {
    if (mode === MODE_EXAM) {
      state.exam = createDefaultExamState();
      state.exam.order = shuffled(state.problemSet.map((p) => p.id));
    } else {
      state.master = createDefaultMasterState();
      state.master.queue = shuffled(state.problemSet.map((p) => p.id));
    }
    saveState();
    render();
  }

  function getContinueLabel(mode) {
    const s = mode === MODE_EXAM ? state.exam : state.master;
    const hasProgress = s.answered > 0 || (mode === MODE_EXAM ? s.currentIndex > 0 : s.round > 1 || s.currentIndex > 0);
    return hasProgress ? '続きから' : '開始';
  }

  function getCurrentQuestion(mode) {
    const questionId = mode === MODE_EXAM
      ? state.exam.order[state.exam.currentIndex]
      : state.master.queue[state.master.currentIndex];
    return state.problemSet.find((p) => p.id === questionId) || null;
  }

  function getDisplayedChoices(mode, question) {
    const s = mode === MODE_EXAM ? state.exam : state.master;
    if (Array.isArray(s.currentDisplayedChoices) && s.currentDisplayedChoices.length > 0) {
      const map = new Map(question.choices.map((c) => [c.id, c]));
      return s.currentDisplayedChoices.map((id) => {
        if (id === SPECIAL_CHOICE_ID) return { id: SPECIAL_CHOICE_ID, text: '？', isCorrect: false };
        return map.get(id);
      }).filter(Boolean);
    }

    const normal = shuffled(question.choices.map((c) => ({ ...c })));
    const result = [
      { id: SPECIAL_CHOICE_ID, text: '？', isCorrect: false },
      ...normal,
    ];
    s.currentDisplayedChoices = result.map((c) => c.id);
    saveState();
    return result;
  }

  function answerCurrentQuestion(selectedId) {
    const mode = state.lastMode;
    const s = mode === MODE_EXAM ? state.exam : state.master;
    if (s.currentQuestionAnswered) return;

    const question = getCurrentQuestion(mode);
    if (!question) return;

    const chosen = selectedId === SPECIAL_CHOICE_ID
      ? { id: SPECIAL_CHOICE_ID, text: '？', isCorrect: false }
      : question.choices.find((c) => c.id === selectedId);

    if (!chosen) return;

    const isCorrect = !!chosen.isCorrect;
    s.currentQuestionAnswered = true;
    s.currentQuestionSelectedId = selectedId;
    s.currentQuestionResult = isCorrect ? 'correct' : 'incorrect';
    s.currentQuestionExplanation = question.explanation || '';
    s.totalAttempts += 1;
    s.answered += 1;
    if (isCorrect) s.correct += 1;
    s.history.push({
      questionId: question.id,
      selectedId,
      isCorrect,
      ts: Date.now(),
      round: mode === MODE_MASTER ? s.round : undefined,
    });

    if (mode === MODE_MASTER && !isCorrect) {
      if (!s.nextQueue.includes(question.id)) {
        s.nextQueue.push(question.id);
      }
    }

    state.ui.overlayText = isCorrect ? '正解' : '間違い';
    saveState();
    render();

    setTimeout(() => {
      state.ui.overlayText = '';
      render();
    }, 900);
  }

  function moveNextQuestion() {
    const mode = state.lastMode;
    const s = mode === MODE_EXAM ? state.exam : state.master;
    if (!s.currentQuestionAnswered) return;

    if (mode === MODE_EXAM) {
      if (s.currentIndex < s.order.length - 1) {
        s.currentIndex += 1;
      }
    } else {
      if (s.currentIndex < s.queue.length - 1) {
        s.currentIndex += 1;
      } else {
        finishMasterRound();
      }
    }

    clearCurrentQuestionState(s);
    saveState();
    render();
  }

  function finishMasterRound() {
    const s = state.master;
    if (s.nextQueue.length === 0) {
      s.completed = true;
      s.queue = [];
      s.currentIndex = 0;
      return;
    }
    s.queue = shuffled([...s.nextQueue]);
    s.nextQueue = [];
    s.currentIndex = 0;
    s.round += 1;
  }

  function clearCurrentQuestionState(modeState) {
    modeState.currentQuestionAnswered = false;
    modeState.currentQuestionResult = null;
    modeState.currentQuestionSelectedId = null;
    modeState.currentQuestionExplanation = '';
    modeState.currentDisplayedChoices = [];
  }

  function getMasterRemainingCount() {
    if (state.master.completed) return 0;
    return Math.max(0, state.master.queue.length - state.master.currentIndex);
  }

  function formatRate(correct, total) {
    if (!total) return '0.0%';
    return `${((correct / total) * 100).toFixed(1)}%`;
  }

  function shuffled(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((err) => {
          console.warn('SW registration failed', err);
        });
      });
    }
  }

  let zoomState = { scale: 1, x: 0, y: 0, active: false, startX: 0, startY: 0 };

  function initImageZoom() {
    const img = document.getElementById('questionImage');
    const stage = document.getElementById('imageStage');
    if (!img || !stage) return;

    applyTransform();

    stage.addEventListener('pointerdown', (e) => {
      zoomState.active = true;
      zoomState.startX = e.clientX - zoomState.x;
      zoomState.startY = e.clientY - zoomState.y;
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', (e) => {
      if (!zoomState.active) return;
      zoomState.x = e.clientX - zoomState.startX;
      zoomState.y = e.clientY - zoomState.startY;
      applyTransform();
    });
    stage.addEventListener('pointerup', () => {
      zoomState.active = false;
    });
    stage.addEventListener('pointercancel', () => {
      zoomState.active = false;
    });
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      updateZoom(e.deltaY < 0 ? 0.15 : -0.15);
    }, { passive: false });
  }

  function updateZoom(delta) {
    zoomState.scale = clamp(zoomState.scale + delta, 1, 4);
    applyTransform();
  }

  function resetZoom() {
    zoomState = { scale: 1, x: 0, y: 0, active: false, startX: 0, startY: 0 };
    applyTransform();
  }

  function applyTransform() {
    const img = document.getElementById('questionImage');
    if (!img) return;
    img.style.transform = `translate(${zoomState.x}px, ${zoomState.y}px) scale(${zoomState.scale})`;
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }
})();
