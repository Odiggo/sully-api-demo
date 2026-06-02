import {
  SullyStreamingDemo,
  type SessionPhase,
  type TranscriptSegment,
  type TranscriptWord,
} from './sully-browser-demo.js';
import {
  copyTextToClipboard,
  fetchHealth,
  formatActiveConfig,
  formatEndReason,
  loadSettings,
  populateLanguageSelect,
  saveSettings,
  type DemoSettings,
} from './demo-ui.js';

const recBtn = document.getElementById('recBtn') as HTMLButtonElement;
const btnLbl = document.getElementById('btnLbl')!;
const recHint = document.getElementById('recHint')!;
const statusPill = document.getElementById('statusPill')!;
const statusText = document.getElementById('statusText')!;
const txBody = document.getElementById('txBody')!;
const txPlaceholder = document.getElementById('txPlaceholder')!;
const txDot = document.getElementById('txDot')!;
const txMeta = document.getElementById('txMeta')!;
const histList = document.getElementById('histList')!;
const histCount = document.getElementById('histCount')!;
const histDot = document.getElementById('histDot')!;
const evList = document.getElementById('evList')!;
const evCount = document.getElementById('evCount')!;
const evDot = document.getElementById('evDot')!;
const wordChip = document.getElementById('wordChip')!;
const durationChip = document.getElementById('durationChip')!;
const configChip = document.getElementById('configChip')!;
const languageSelect = document.getElementById('languageSelect') as HTMLSelectElement;
const languageFilter = document.getElementById('languageFilter') as HTMLInputElement;
const durationSelect = document.getElementById('durationSelect') as HTMLSelectElement;
const dictationCheck = document.getElementById('dictationCheck') as HTMLInputElement;
const wordDebugCheck = document.getElementById('wordDebugCheck') as HTMLInputElement;
const setupBanner = document.getElementById('setupBanner')!;
const alertBanner = document.getElementById('alertBanner')!;
const alertBannerText = document.getElementById('alertBannerText')!;
const alertBannerDismiss = document.getElementById('alertBannerDismiss')!;
const copyBtn = document.getElementById('copyBtn') as HTMLButtonElement;
const newSessionBtn = document.getElementById('newSessionBtn') as HTMLButtonElement;
const clearLogBtn = document.getElementById('clearLogBtn') as HTMLButtonElement;
const wordDebugPanel = document.getElementById('wordDebugPanel')!;
const wordDebugBody = document.getElementById('wordDebugBody')!;
const meterBars = [...document.querySelectorAll<HTMLDivElement>('#waveform .w-bar')];
const ring1 = document.getElementById('ring1')!;
const ring2 = document.getElementById('ring2')!;
const waveform = document.getElementById('waveform')!;
const micIco = document.getElementById('micIco')!;
const stopIco = document.getElementById('stopIco')!;

let cursorEl: HTMLSpanElement | null = null;
let wordCount = 0;
let lastLoggedWords = -1;
let historyTotal = 0;
let evTotal = 0;
let startTime: number | null = null;
let durationTimer: ReturnType<typeof setInterval> | null = null;
let timerPausedAt: number | null = null;
let elapsedBeforePause = 0;
let currentPhase: SessionPhase = 'idle';
let serverHealthy = true;
let lastSegments: TranscriptSegment[] = [];

const PHASE_LABEL: Record<SessionPhase, string> = {
  idle: 'disconnected',
  preparing: 'initializing',
  connecting: 'connecting',
  live: 'connected',
  reconnecting: 'reconnecting',
  stopping: 'stopping',
  error: 'error',
};

document.getElementById('sessionId')!.textContent =
  'session:' + Math.random().toString(36).slice(2, 10);

function ts(): string {
  return new Date().toTimeString().slice(0, 8);
}

function setBannerVisible(el: HTMLElement, visible: boolean): void {
  el.hidden = !visible;
}

function showAlert(message: string): void {
  alertBannerText.textContent = message;
  setBannerVisible(alertBanner, true);
}

function hideAlert(): void {
  setBannerVisible(alertBanner, false);
}

alertBannerDismiss.addEventListener('click', hideAlert);

function setStatusPhase(phase: SessionPhase): void {
  currentPhase = phase;
  const label = PHASE_LABEL[phase] || phase;
  statusPill.className = `status-pill ${label === 'initializing' ? 'starting' : label}`;
  statusText.textContent = label;
}

function setStreamControlsDisabled(disabled: boolean): void {
  languageSelect.disabled = disabled;
  languageFilter.disabled = disabled;
  durationSelect.disabled = disabled;
  dictationCheck.disabled = disabled;
  wordDebugCheck.disabled = disabled;
}

function transcriptText(segments: TranscriptSegment[]): string {
  return segments.map((s) => s.text).join(' ').trim();
}

function renderTranscript(segments: TranscriptSegment[]): void {
  txPlaceholder.remove();
  txBody.innerHTML = '';

  segments.forEach((segment, index) => {
    if (index > 0) {
      txBody.appendChild(document.createTextNode(' '));
    }
    const span = document.createElement('span');
    span.className = segment.isFinal ? 'tx-final' : 'tx-interim';
    span.textContent = segment.text;
    txBody.appendChild(span);
  });

  if (cursorEl) {
    txBody.appendChild(cursorEl);
  }
}

function renderWordDebug(words?: TranscriptWord[]): void {
  if (!wordDebugCheck.checked) {
    wordDebugPanel.hidden = true;
    return;
  }
  wordDebugPanel.hidden = false;
  const list = words ?? [];
  if (!list.length) {
    wordDebugBody.textContent = 'Word timings appear on finalized segments…';
    return;
  }
  wordDebugBody.innerHTML = list
    .map(
      (w) =>
        `<tr><td>${w.word}</td><td>${w.start?.toFixed(2) ?? '—'}</td><td>${w.end?.toFixed(2) ?? '—'}</td><td>${w.confidence?.toFixed(2) ?? '—'}</td></tr>`,
    )
    .join('');
}

function updateMeter(level: number): void {
  meterBars.forEach((bar, index) => {
    const scale = Math.max(0.12, Math.min(1, level * (1.1 - index * 0.08)));
    bar.style.height = `${Math.round(4 + scale * 18)}px`;
  });
}

function pushHistory(phase: SessionPhase): void {
  histList.querySelector('.empty-state')?.remove();
  const row = document.createElement('div');
  row.className = 'h-row';
  const dot = document.createElement('div');
  const histClass =
    phase === 'preparing' ? 'starting' : PHASE_LABEL[phase] || phase;
  dot.className = `h-dot ${histClass}`;
  const label = document.createElement('span');
  label.className = 'h-label';
  label.textContent = PHASE_LABEL[phase] || phase;
  const time = document.createElement('span');
  time.className = 'h-ts';
  time.textContent = ts();
  row.append(dot, label, time);
  histList.insertBefore(row, histList.firstChild);
  historyTotal++;
  histCount.textContent = `${historyTotal} event${historyTotal !== 1 ? 's' : ''}`;
  histDot.classList.add('on');
}

function pushEvent(type: string, mainText: string, asideText?: string): void {
  evList.querySelector('.ev-empty')?.remove();
  const row = document.createElement('div');
  row.className = 'ev-row';
  const head = document.createElement('div');
  head.className = 'ev-head';
  const tag = document.createElement('span');
  tag.className = `ev-tag ${type}`;
  tag.textContent = type;
  const time = document.createElement('span');
  time.className = 'ev-ts';
  time.textContent = ts();
  head.append(tag, time);
  const data = document.createElement('div');
  data.className = 'ev-data';
  const em = document.createElement('span');
  em.className = 'ev-data-em';
  em.textContent = mainText;
  data.appendChild(em);
  if (asideText) {
    const aside = document.createElement('span');
    aside.className = 'ev-data-aside';
    aside.textContent = ' · ' + asideText;
    data.appendChild(aside);
  }
  row.append(head, data);
  evList.appendChild(row);
  evList.scrollTop = evList.scrollHeight;
  evTotal++;
  evCount.textContent = `${evTotal} event${evTotal !== 1 ? 's' : ''}`;
  evDot.classList.add('on');
}

function clearEventLog(): void {
  evList.innerHTML = '<div class="ev-empty">SDK events will appear here</div>';
  evTotal = 0;
  evCount.textContent = '—';
  evDot.classList.remove('on');
}

function updateDurationChip(): void {
  if (startTime === null) {
    durationChip.textContent = '00:00';
    return;
  }
  const elapsed =
    elapsedBeforePause + (timerPausedAt ? 0 : Date.now() - startTime);
  const s = Math.floor(elapsed / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  durationChip.textContent = `${mm}:${ss}`;
}

function startDurationTimer(): void {
  startTime = Date.now();
  elapsedBeforePause = 0;
  timerPausedAt = null;
  durationChip.classList.add('live');
  durationTimer = setInterval(updateDurationChip, 1000);
}

function pauseDurationTimer(): void {
  if (startTime !== null && timerPausedAt === null) {
    elapsedBeforePause += Date.now() - startTime;
    timerPausedAt = Date.now();
  }
}

function resumeDurationTimer(): void {
  if (timerPausedAt !== null) {
    startTime = Date.now();
    timerPausedAt = null;
  }
}

function stopDurationTimer(reset: boolean): void {
  if (durationTimer) {
    clearInterval(durationTimer);
    durationTimer = null;
  }
  startTime = null;
  timerPausedAt = null;
  elapsedBeforePause = 0;
  durationChip.classList.remove('live');
  if (reset) {
    durationChip.textContent = '00:00';
  } else {
    updateDurationChip();
  }
}

function setLiveVisual(on: boolean): void {
  recBtn.classList.toggle('recording', on);
  recBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  ring1.classList.toggle('pulse', on);
  ring2.classList.toggle('pulse', on);
  waveform.classList.toggle('on', on);
  micIco.style.display = on ? 'none' : '';
  stopIco.style.display = on ? '' : 'none';
  btnLbl.textContent = on ? 'stop' : 'record';
  wordChip.classList.toggle('live', on);
  txDot.classList.toggle('on', on);
  copyBtn.disabled = !on && wordCount === 0;
}

function applyPhaseUi(phase: SessionPhase): void {
  setStatusPhase(phase);
  pushHistory(phase);

  const sessionActive =
    phase === 'preparing' ||
    phase === 'connecting' ||
    phase === 'live' ||
    phase === 'reconnecting' ||
    phase === 'stopping';

  recBtn.disabled =
    !serverHealthy || phase === 'preparing' || phase === 'connecting' || phase === 'stopping';
  recBtn.setAttribute('aria-busy', phase === 'preparing' || phase === 'connecting' ? 'true' : 'false');

  setStreamControlsDisabled(sessionActive);

  if (phase === 'preparing') {
    recHint.textContent = 'Requesting streaming token…';
    btnLbl.textContent = '…';
  } else if (phase === 'connecting') {
    recHint.textContent = 'Connecting to Sully…';
    btnLbl.textContent = '…';
  } else if (phase === 'live') {
    const durationSec = Number.parseInt(durationSelect.value, 10);
    recHint.textContent =
      durationSec > 0
        ? `Live — auto-stops in ${durationSec}s (or click stop)`
        : 'Live — click stop when finished';
    setLiveVisual(true);
    if (durationTimer === null) {
      startDurationTimer();
    } else {
      resumeDurationTimer();
    }
    hideAlert();
  } else if (phase === 'reconnecting') {
    recHint.textContent = 'Connection lost — reconnecting…';
    pauseDurationTimer();
  } else if (phase === 'stopping') {
    recHint.textContent = 'Wrapping up…';
    btnLbl.textContent = '…';
  } else if (phase === 'idle') {
    recHint.textContent = 'Click to start recording your microphone';
    setLiveVisual(false);
    stopDurationTimer(true);
    configChip.textContent = '—';
    configChip.classList.remove('live');
    if (cursorEl?.parentNode) {
      cursorEl.parentNode.removeChild(cursorEl);
      cursorEl = null;
    }
    if (!txBody.querySelector('.tx-final, .tx-interim')) {
      txBody.innerHTML = '';
      txBody.appendChild(txPlaceholder);
    }
    setStreamControlsDisabled(false);
    recBtn.disabled = !serverHealthy;
  } else if (phase === 'error') {
    recHint.textContent = 'Something went wrong — adjust settings and try again';
    setLiveVisual(false);
    stopDurationTimer(false);
    recBtn.disabled = !serverHealthy;
    setStreamControlsDisabled(false);
  }
}

function applySettingsToForm(settings: DemoSettings): void {
  populateLanguageSelect(languageSelect);
  languageSelect.value = settings.language;
  durationSelect.value = String(settings.durationSec);
  dictationCheck.checked = settings.dictation;
  wordDebugCheck.checked = settings.wordDebug;
  wordDebugPanel.hidden = !settings.wordDebug;
}

function persistFormSettings(): void {
  saveSettings({
    language: languageSelect.value,
    durationSec: Number.parseInt(durationSelect.value, 10),
    dictation: dictationCheck.checked,
    wordDebug: wordDebugCheck.checked,
  });
}

function resetTranscript(): void {
  lastSegments = [];
  wordCount = 0;
  lastLoggedWords = -1;
  wordChip.textContent = '0 words';
  txBody.innerHTML = '';
  txBody.appendChild(txPlaceholder);
  txMeta.textContent = '—';
  wordDebugBody.textContent = '';
}

const demo = new SullyStreamingDemo({
  onPhaseChange: (phase) => {
    applyPhaseUi(phase);
    pushEvent('STATUS', PHASE_LABEL[phase] || phase);
  },

  onAutoStopTick: (secondsRemaining) => {
    recHint.textContent = `Live — auto-stops in ${secondsRemaining}s (or click stop)`;
  },

  onReconnectAttempt: ({ attempt, maxAttempts, delayMs }) => {
    showAlert(`Connection lost — reconnecting (${attempt}/${maxAttempts}) in ${Math.round(delayMs / 1000)}s…`);
  },

  onStreamError: ({ message }) => {
    showAlert(message);
    pushEvent('ERROR', message, 'stream');
  },

  onAudioLevel: (level) => {
    if (currentPhase === 'live') {
      updateMeter(level);
    }
  },

  onTranscription: ({ segments, words }) => {
    lastSegments = segments;
    if (cursorEl?.parentNode) {
      cursorEl.parentNode.removeChild(cursorEl);
    }
    renderTranscript(segments);
    if (currentPhase === 'live' && !cursorEl) {
      cursorEl = document.createElement('span');
      cursorEl.className = 'cursor';
      txBody.appendChild(cursorEl);
    }

    const text = transcriptText(segments);
    const hasInterim = segments.some((s) => !s.isFinal);
    wordCount = text.split(/\s+/).filter(Boolean).length;
    wordChip.textContent = `${wordCount} words`;
    txMeta.textContent = hasInterim
      ? `${wordCount} words · listening…`
      : `${wordCount} words`;
    copyBtn.disabled = wordCount === 0;

    renderWordDebug(words);

    if (!hasInterim && wordCount !== lastLoggedWords) {
      lastLoggedWords = wordCount;
      const preview = text.length > 72 ? text.slice(0, 72) + '…' : text;
      pushEvent('TRANSCRIPT', `"${preview}"`, `${wordCount}w · final`);
    }
  },

  onError: (error) => {
    showAlert(error.message);
    pushEvent('ERROR', error.message);
  },

  onComplete: ({ reason }) => {
    const label = formatEndReason(reason);
    pushEvent('COMPLETE', label);
    hideAlert();
  },
});

async function checkHealth(): Promise<void> {
  try {
    const health = await fetchHealth();
    serverHealthy = health.ok;
    if (!health.ok) {
      setupBanner.hidden = false;
      const missing = [
        !health.hasApiKey && 'SULLY_API_KEY',
        !health.hasAccountId && 'SULLY_ACCOUNT_ID',
        !health.hasApiUrl && 'SULLY_API_URL',
      ].filter(Boolean);
      setupBanner.textContent = `Setup required: add ${missing.join(', ')} to .env and restart the server.`;
      recBtn.disabled = true;
    } else {
      setupBanner.hidden = true;
      recBtn.disabled = currentPhase !== 'idle';
    }
  } catch {
    serverHealthy = false;
    setupBanner.hidden = false;
    setupBanner.textContent = 'Could not reach the demo server. Run pnpm start from the project root.';
    recBtn.disabled = true;
  }
}

recBtn.addEventListener('click', async () => {
  if (!serverHealthy) return;

  if (currentPhase === 'idle' || currentPhase === 'error') {
    persistFormSettings();
    const durationSec = Number.parseInt(durationSelect.value, 10);
    demo.setLanguage(languageSelect.value);
    demo.setDictation(dictationCheck.checked);
    demo.setDuration(durationSec * 1000);

    configChip.textContent = formatActiveConfig(
      languageSelect.value,
      durationSec,
      dictationCheck.checked,
    );
    configChip.classList.add('live');

    resetTranscript();
    cursorEl = document.createElement('span');
    cursorEl.className = 'cursor';
    txBody.innerHTML = '';
    txBody.appendChild(cursorEl);
    txMeta.textContent = 'recording…';
    pushEvent('LANGUAGE', languageSelect.value);
    pushEvent(
      'CONFIG',
      durationSec > 0 ? `auto-stop ${durationSec}s` : 'manual stop',
      dictationCheck.checked ? 'dictation' : 'conversation',
    );

    await demo.start();
  } else if (currentPhase === 'live' || currentPhase === 'reconnecting') {
    demo.stop('manual');
  }
});

copyBtn.addEventListener('click', async () => {
  const ok = await copyTextToClipboard(transcriptText(lastSegments));
  pushEvent('ACTION', ok ? 'Transcript copied' : 'Nothing to copy');
});

newSessionBtn.addEventListener('click', () => {
  if (currentPhase !== 'idle' && currentPhase !== 'error') {
    demo.stop('manual');
  }
  const hasText = transcriptText(lastSegments).length > 0 || evTotal > 0;
  if (hasText && !window.confirm('Start a new session? This clears the transcript and event log.')) {
    return;
  }
  resetTranscript();
  clearEventLog();
  hideAlert();
  pushEvent('ACTION', 'New session');
});

clearLogBtn.addEventListener('click', clearEventLog);

languageFilter.addEventListener('input', () => {
  const value = languageSelect.value;
  populateLanguageSelect(languageSelect, languageFilter.value);
  if ([...languageSelect.options].some((o) => o.value === value)) {
    languageSelect.value = value;
  }
});

languageSelect.addEventListener('change', persistFormSettings);
durationSelect.addEventListener('change', persistFormSettings);
dictationCheck.addEventListener('change', persistFormSettings);
wordDebugCheck.addEventListener('change', () => {
  persistFormSettings();
  wordDebugPanel.hidden = !wordDebugCheck.checked;
});

document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) {
    return;
  }
  event.preventDefault();
  recBtn.click();
});

applySettingsToForm(loadSettings());
setStatusPhase('idle');
checkHealth();
