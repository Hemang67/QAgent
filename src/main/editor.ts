import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { shell } from 'electron';
import type { EditorChoice } from '../shared/ipc';

// Command-line launchers that accept "file:line"
const GOTO: Partial<Record<EditorChoice, (target: string) => [string, string[]]>> = {
  code: (t) => ['code', ['-g', t]],
  cursor: (t) => ['cursor', ['-g', t]],
  windsurf: (t) => ['windsurf', ['-g', t]],
  idea: (t) => ['idea', [t]],
};

/**
 * Opens a project file in the user's editor; falls back to the system's
 * default app when the editor's command is not on PATH. Returns an error text.
 */
export const openInEditor = async (root: string, file: string, editor: EditorChoice): Promise<string | null> => {
  const abs = path.resolve(root, file);
  // Only files inside the project: results rows come from a workbook anyone can edit
  if (!abs.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(abs)) return `File not found in the project: ${file}`;
  const launcher = GOTO[editor];
  if (launcher) {
    const [cmd, args] = launcher(`${abs}:1`);
    const started = await new Promise<boolean>((resolve) => {
      // windowsHide hides only the cmd shell used to find the editor, not the editor itself
      const child = spawn(cmd, args, { shell: process.platform === 'win32', detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', () => resolve(false));
      child.on('spawn', () => resolve(true));
      child.unref();
    });
    if (started) return null;
  }
  const err = await shell.openPath(abs);
  return err || null;
};
