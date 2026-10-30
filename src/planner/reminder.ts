import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const MARK = 'qagent-reminder';

/**
 * Plain sh, run by git before each commit. It only prints a reminder when the
 * commit adds a page-like file or a send/book/charge endpoint, and never blocks
 * the commit (OMS's commit reminder, without needing QAgent installed).
 */
export const REMINDER_SCRIPT = `#!/bin/sh
# QAgent commit reminder: prints a hint, never blocks the commit.
pages=$(git diff --cached --name-only --diff-filter=A | grep -E '(^|/)(pages|views|screens|routes|Pages|templates)/|(^|/)page\\.(t|j)sx?$|\\+page\\.svelte$|\\.(cshtml|razor)$|Controller\\.(cs|php)$')
risky=$(git diff --cached -U0 | grep -E '^\\+[^+]' | grep -ioE "['\\"\\\`][^'\\"\\\` /]*/[A-Za-z0-9_/{}:$.-]*(send|email|sms|notify|book|tender|ship|void|cancel|charge|pay|refund|invoice|label)[A-Za-z0-9_/{}:$.-]*['\\"\\\`]" | sort -u)
if [ -n "$pages" ] || [ -n "$risky" ]; then
  echo ""
  echo "┌─ QAgent reminder ─────────────────────────────────────────────"
  if [ -n "$pages" ]; then
    echo "│ New page files in this commit:"
    echo "$pages" | sed 's/^/│   /'
    echo "│   • key daily page? add it to Smoke · needs a record ID? set it up"
  fi
  if [ -n "$risky" ]; then
    echo "│ New calls that may send, book or charge:"
    echo "$risky" | sed 's/^/│   /'
    echo "│   • if it emails, ships, books or charges → block it in QAgent"
  fi
  echo "│ Set these up in QAgent: Pages → New since the base branch"
  echo "└────────────────────────────────────────────────────────────────"
fi
exit 0
`;

const hooksDir = (root: string) => path.resolve(root, execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: root, encoding: 'utf8' }).trim());

export type ReminderStatus = { state: 'installed' } | { state: 'not-installed' } | { state: 'not-git' } | { state: 'other-hook'; hookFile: string; line: string };

export const reminderStatus = (root: string): ReminderStatus => {
  let dir: string;
  try {
    dir = hooksDir(root);
  } catch {
    return { state: 'not-git' };
  }
  const hook = path.join(dir, 'pre-commit');
  if (!fs.existsSync(hook)) return { state: 'not-installed' };
  if (fs.readFileSync(hook, 'utf8').includes(MARK)) return { state: 'installed' };
  return { state: 'other-hook', hookFile: hook, line: `"$(git rev-parse --git-path hooks)/${MARK}.sh"` };
};

/**
 * Installs the reminder in this clone's git hooks (each developer opts in; nothing
 * is committed). An existing pre-commit hook is never changed: the user is shown the
 * one line to add to it instead.
 */
export const installReminder = (root: string): ReminderStatus => {
  const status = reminderStatus(root);
  if (status.state === 'not-git' || status.state === 'installed') return status;
  const dir = hooksDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${MARK}.sh`), REMINDER_SCRIPT, { mode: 0o755 });
  if (status.state === 'other-hook') return status;
  fs.writeFileSync(path.join(dir, 'pre-commit'), `#!/bin/sh\n# ${MARK}\n"$(dirname "$0")/${MARK}.sh"\nexit 0\n`, { mode: 0o755 });
  return { state: 'installed' };
};
