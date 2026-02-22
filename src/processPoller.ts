/**
 * ProcessPoller: polls `ps` on an interval, parses output, builds snapshots,
 * and emits diff events.
 */

import { execFile } from 'child_process';
import { EventEmitter } from 'events';
import * as os from 'os';
import {
  ProcessInfo,
  ProcessSnapshot,
  ProcessEvent,
  buildSnapshot,
  diffSnapshots,
  parseEtime,
} from './processModel';

export class ProcessPoller extends EventEmitter {
  private intervalHandle: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  private paused = false;
  private _currentSnapshot: ProcessSnapshot | undefined;
  private currentUser: string;

  constructor(private intervalMs: number = 1000) {
    super();
    this.currentUser = os.userInfo().username;
  }

  /** The latest process snapshot, if available. */
  get snapshot(): ProcessSnapshot | undefined {
    return this._currentSnapshot;
  }

  /** Start polling. */
  start(): void {
    if (this.intervalHandle) {
      return;
    }
    this.poll(); // immediate first poll
    this.intervalHandle = setInterval(() => this.poll(), this.intervalMs);
  }

  /** Stop polling. */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  /** Pause/resume without stopping the timer. */
  togglePause(): boolean {
    this.paused = !this.paused;
    return this.paused;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Update the poll interval (takes effect on next cycle). */
  setInterval(ms: number): void {
    this.intervalMs = ms;
    if (this.intervalHandle) {
      this.stop();
      this.start();
    }
  }

  /** Force an immediate poll. */
  refresh(): void {
    this.poll();
  }

  /** Get the current user, used for filtering. */
  getUser(): string {
    return this.currentUser;
  }

  /** Internal poll routine. */
  private poll(): void {
    if (this.polling || this.paused) {
      return;
    }
    this.polling = true;

    const platform = os.platform();
    let cmd: string;
    let args: string[];

    if (platform === 'darwin') {
      cmd = 'ps';
      args = ['-axo', 'pid,ppid,pgid,user,%cpu,rss,etime,comm,args'];
    } else {
      // Linux and compatible
      cmd = 'ps';
      args = ['-eo', 'pid,ppid,pgid,user,pcpu,rss,etime,comm,args'];
    }

    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, _stderr) => {
      this.polling = false;

      if (err) {
        this.emit('error', err);
        return;
      }

      try {
        const processes = this.parseOutput(stdout, platform);
        const newSnapshot = buildSnapshot(processes);
        const events = diffSnapshots(this._currentSnapshot, newSnapshot);
        this._currentSnapshot = newSnapshot;

        if (events.length > 0) {
          this.emit('events', events);
        }
        this.emit('snapshot', newSnapshot);
      } catch (parseErr) {
        this.emit('error', parseErr);
      }
    });
  }

  /**
   * Parse the `ps` output into ProcessInfo[].
   *
   * The header line is skipped. Fields are whitespace-separated with
   * the last field (args) consuming the remainder of the line.
   */
  private parseOutput(stdout: string, platform: string): ProcessInfo[] {
    const lines = stdout.split('\n');
    const results: ProcessInfo[] = [];

    // Skip header
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        continue;
      }

      const info = this.parseLine(line, platform);
      if (info) {
        results.push(info);
      }
    }

    return results;
  }

  /**
   * Parse a single line from `ps` output.
   *
   * Expected columns: PID PPID PGID USER %CPU RSS ETIME COMM ARGS
   * The first 8 fields are whitespace-delimited; ARGS is everything remaining.
   */
  private parseLine(line: string, _platform: string): ProcessInfo | null {
    // Split into at most 9 parts (8 fixed fields + args remainder)
    const parts: string[] = [];
    let current = 0;
    const len = line.length;

    for (let field = 0; field < 8; field++) {
      // Skip whitespace
      while (current < len && line[current] === ' ') {
        current++;
      }
      // Read non-whitespace
      const start = current;
      while (current < len && line[current] !== ' ') {
        current++;
      }
      if (start === current) {
        return null; // Not enough fields
      }
      parts.push(line.substring(start, current));
    }

    // The rest is args
    while (current < len && line[current] === ' ') {
      current++;
    }
    const argsStr = current < len ? line.substring(current) : parts[7]; // fallback to comm

    const pid = parseInt(parts[0], 10);
    const ppid = parseInt(parts[1], 10);
    const pgid = parseInt(parts[2], 10);
    const user = parts[3];
    const cpu = parseFloat(parts[4]) || 0;
    const rss = parseInt(parts[5], 10) || 0;
    const etime = parts[6];
    const command = parts[7];

    if (isNaN(pid) || isNaN(ppid) || isNaN(pgid)) {
      return null;
    }

    return {
      pid,
      ppid,
      pgid,
      user,
      cpu,
      rss,
      etime,
      etimeSeconds: parseEtime(etime),
      command,
      args: argsStr,
    };
  }
}
