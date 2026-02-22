/**
 * Core process data model types for Take It Out Back.
 */

/** Normalized representation of a single OS process. */
export interface ProcessInfo {
  pid: number;
  ppid: number;
  pgid: number;
  user: string;
  cpu: number;       // %CPU from ps
  rss: number;       // Resident set size in KB
  etime: string;     // Elapsed time as raw string from ps
  etimeSeconds: number; // Elapsed time converted to seconds
  command: string;   // Short command name (comm)
  args: string;      // Full command line (args)
}

/** A complete snapshot of all processes at a point in time. */
export interface ProcessSnapshot {
  timestamp: number;
  processes: ProcessInfo[];
  byPid: Map<number, ProcessInfo>;
  childrenByPpid: Map<number, number[]>;
  pidsByPgid: Map<number, number[]>;
}

/** Events emitted when the process list changes between snapshots. */
export enum ProcessEventType {
  Added = 'added',
  Removed = 'removed',
  Updated = 'updated',
}

export interface ProcessEvent {
  type: ProcessEventType;
  process: ProcessInfo;
  previous?: ProcessInfo; // Only set for Updated events
}

/**
 * Parse an elapsed-time string (from ps etime) into total seconds.
 *
 * Formats:
 *   ss
 *   mm:ss
 *   hh:mm:ss
 *   dd-hh:mm:ss
 */
export function parseEtime(etime: string): number {
  const trimmed = etime.trim();
  let days = 0;
  let rest = trimmed;

  // Check for days component: "dd-..."
  const dashIdx = rest.indexOf('-');
  if (dashIdx !== -1) {
    days = parseInt(rest.substring(0, dashIdx), 10) || 0;
    rest = rest.substring(dashIdx + 1);
  }

  const parts = rest.split(':').map(p => parseInt(p, 10) || 0);

  let hours = 0, minutes = 0, seconds = 0;
  if (parts.length === 3) {
    [hours, minutes, seconds] = parts;
  } else if (parts.length === 2) {
    [minutes, seconds] = parts;
  } else if (parts.length === 1) {
    [seconds] = parts;
  }

  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

/**
 * Build derived indexes from a flat list of ProcessInfo.
 */
export function buildSnapshot(processes: ProcessInfo[]): ProcessSnapshot {
  const byPid = new Map<number, ProcessInfo>();
  const childrenByPpid = new Map<number, number[]>();
  const pidsByPgid = new Map<number, number[]>();

  for (const proc of processes) {
    byPid.set(proc.pid, proc);

    const siblings = childrenByPpid.get(proc.ppid);
    if (siblings) {
      siblings.push(proc.pid);
    } else {
      childrenByPpid.set(proc.ppid, [proc.pid]);
    }

    const groupMembers = pidsByPgid.get(proc.pgid);
    if (groupMembers) {
      groupMembers.push(proc.pid);
    } else {
      pidsByPgid.set(proc.pgid, [proc.pid]);
    }
  }

  return {
    timestamp: Date.now(),
    processes,
    byPid,
    childrenByPpid,
    pidsByPgid,
  };
}

/**
 * Diff two snapshots and return a list of process events.
 */
export function diffSnapshots(
  oldSnap: ProcessSnapshot | undefined,
  newSnap: ProcessSnapshot
): ProcessEvent[] {
  const events: ProcessEvent[] = [];

  if (!oldSnap) {
    // First snapshot: everything is "added"
    for (const proc of newSnap.processes) {
      events.push({ type: ProcessEventType.Added, process: proc });
    }
    return events;
  }

  // Detect added and updated
  for (const proc of newSnap.processes) {
    const old = oldSnap.byPid.get(proc.pid);
    if (!old) {
      events.push({ type: ProcessEventType.Added, process: proc });
    } else if (old.cpu !== proc.cpu || old.rss !== proc.rss || old.etime !== proc.etime) {
      events.push({ type: ProcessEventType.Updated, process: proc, previous: old });
    }
  }

  // Detect removed
  for (const proc of oldSnap.processes) {
    if (!newSnap.byPid.has(proc.pid)) {
      events.push({ type: ProcessEventType.Removed, process: proc });
    }
  }

  return events;
}
