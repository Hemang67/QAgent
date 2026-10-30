import fs from 'fs';
import os from 'os';
import path from 'path';

const PREFIX = 'qagent-session-';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/**
 * The run's login state lives in one temp folder, deleted when the run ends,
 * is cancelled, or the engine exits. Folders left by a crashed engine are
 * removed when the next run starts.
 */
export class Session {
  readonly dir: string;
  private removed = false;

  constructor() {
    Session.removeOrphans();
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX));
    fs.writeFileSync(path.join(this.dir, 'owner.pid'), String(process.pid));
  }

  file(name: string) {
    return path.join(this.dir, name);
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    fs.rmSync(this.dir, { recursive: true, force: true });
  }

  static removeOrphans() {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(PREFIX));
    } catch {
      return;
    }
    for (const name of entries) {
      const dir = path.join(os.tmpdir(), name);
      let pid = 0;
      try {
        pid = Number(fs.readFileSync(path.join(dir, 'owner.pid'), 'utf8').trim()) || 0;
      } catch {
        // no owner file: left by a crash before it was written
      }
      if (!pid || !alive(pid)) fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}
