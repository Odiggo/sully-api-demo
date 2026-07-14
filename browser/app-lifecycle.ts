import type { WorkspaceState } from './workspace-state.js';

export interface AppDisposable {
  dispose(): void | Promise<void>;
}

export interface AppLifecycle {
  add(disposable: AppDisposable): Promise<void>;
  dispose(): Promise<void>;
}

export interface CreateAppLifecycleOptions {
  workspace: WorkspaceState;
  disposables?: AppDisposable[];
}

export function createAppLifecycle(options: CreateAppLifecycleOptions): AppLifecycle {
  const disposables = [...(options.disposables ?? [])];
  let disposal: Promise<void> | undefined;

  return {
    async add(disposable) {
      if (disposal) {
        await Promise.resolve(disposable.dispose()).catch(() => undefined);
        return;
      }
      disposables.push(disposable);
    },
    dispose() {
      if (disposal) return disposal;
      options.workspace.dispose();
      disposal = Promise.allSettled(
        disposables.map((disposable) => Promise.resolve().then(() => disposable.dispose())),
      ).then(() => undefined);
      return disposal;
    },
  };
}
