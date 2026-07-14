export interface ClipboardPort {
  writeText(text: string): Promise<void>;
}

export interface CopyResultOptions {
  text: string;
  clipboard: ClipboardPort;
  announce: (message: string) => void;
  showError: (message: string) => void;
  restoreFocus: () => void;
}

export interface ResultPayload {
  formatted: string;
  raw?: unknown;
  copyText?: string;
}

export interface ResultView {
  setLoading(message?: string): void;
  setResult(payload: ResultPayload): void;
  setError(message: string): void;
  clear(message?: string): void;
  dispose(): void;
}

export interface CreateResultViewOptions {
  clipboard: ClipboardPort;
  announce: (message: string) => void;
  showError: (message: string) => void;
}

export async function copyResultText(options: CopyResultOptions): Promise<boolean> {
  try {
    await options.clipboard.writeText(options.text);
    options.announce('Result copied to clipboard');
    return true;
  } catch {
    options.showError('Clipboard access was denied. Select and copy the result manually.');
    return false;
  } finally {
    options.restoreFocus();
  }
}

function requireElement<ElementType extends Element>(root: ParentNode, selector: string): ElementType {
  const element = root.querySelector<ElementType>(selector);
  if (!element) throw new Error(`Result view is missing ${selector}`);
  return element;
}

function rawText(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return 'Unable to format raw response';
  }
}

export function createResultView(
  root: HTMLElement,
  options: CreateResultViewOptions,
): ResultView {
  const status = requireElement<HTMLElement>(root, '[data-result-status]');
  const empty = requireElement<HTMLElement>(root, '[data-result-empty]');
  const formatted = requireElement<HTMLElement>(root, '[data-result-formatted]');
  const rawWrap = requireElement<HTMLDetailsElement>(root, '[data-result-raw-wrap]');
  const raw = requireElement<HTMLElement>(root, '[data-result-raw]');
  const copy = requireElement<HTMLButtonElement>(root, '[data-result-copy]');
  let copyText = '';

  const setStatus = (text: string, state?: string) => {
    status.textContent = text;
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
  };
  const handleCopy = () => {
    void copyResultText({
      text: copyText,
      clipboard: options.clipboard,
      announce: options.announce,
      showError: options.showError,
      restoreFocus: () => copy.focus(),
    });
  };
  copy.addEventListener('click', handleCopy);

  return {
    setLoading(message = 'Working') {
      setStatus(message, 'running');
      empty.textContent = 'Waiting for Sully API response…';
      empty.hidden = false;
      formatted.hidden = true;
      rawWrap.hidden = true;
      copy.disabled = true;
    },
    setResult(payload) {
      setStatus('Complete', 'complete');
      formatted.textContent = payload.formatted;
      formatted.hidden = false;
      empty.hidden = true;
      if (payload.raw === undefined) {
        rawWrap.hidden = true;
      } else {
        raw.textContent = rawText(payload.raw);
        rawWrap.hidden = false;
      }
      copyText = payload.copyText ?? payload.formatted;
      copy.disabled = copyText.length === 0;
    },
    setError(message) {
      setStatus('Error', 'error');
      empty.textContent = message;
      empty.hidden = false;
      formatted.hidden = true;
      rawWrap.hidden = true;
      copy.disabled = true;
    },
    clear(message = 'Result will appear here.') {
      setStatus('Ready');
      empty.textContent = message;
      empty.hidden = false;
      formatted.hidden = true;
      rawWrap.hidden = true;
      copy.disabled = true;
      copyText = '';
    },
    dispose() {
      copy.removeEventListener('click', handleCopy);
    },
  };
}
