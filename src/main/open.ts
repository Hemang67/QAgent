import { spawn } from 'child_process';
import { shell } from 'electron';

/**
 * Opens a file in the system's default app. On Windows, shell.openPath fails with
 * "Failed to open path" for Office files (their open command uses DDE), so a failure
 * falls back to Explorer, which opens it exactly as a double-click would.
 * Returns an error text, or null when the file was handed over.
 */
export const openWithSystem = async (file: string): Promise<string | null> => {
  const err = await shell.openPath(file);
  if (!err) return null;
  if (process.platform !== 'win32') return err;
  return new Promise((resolve) => {
    const child = spawn('explorer.exe', [file], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', (e) => resolve(`${err}; Explorer could not open it either: ${e.message}`));
    child.on('spawn', () => {
      child.unref();
      resolve(null);
    });
  });
};
