/**
 * ProcessController: kill operations for PIDs, process groups, and subtrees.
 */

import * as vscode from 'vscode';
import { ProcessSnapshot } from './processModel';

export class ProcessController {
  /**
   * Send SIGTERM to a single PID.
   */
  async terminatePid(pid: number, confirm: boolean): Promise<boolean> {
    if (confirm) {
      const answer = await vscode.window.showWarningMessage(
        `Terminate process ${pid} (SIGTERM)?`,
        { modal: true },
        'Terminate'
      );
      if (answer !== 'Terminate') {
        return false;
      }
    }
    return this.sendSignal(pid, 'SIGTERM');
  }

  /**
   * Send SIGKILL to a single PID.
   */
  async forceKillPid(pid: number, confirm: boolean): Promise<boolean> {
    if (confirm) {
      const answer = await vscode.window.showWarningMessage(
        `Force kill process ${pid} (SIGKILL)? This cannot be caught or ignored.`,
        { modal: true },
        'Force Kill'
      );
      if (answer !== 'Force Kill') {
        return false;
      }
    }
    return this.sendSignal(pid, 'SIGKILL');
  }

  /**
   * Terminate all processes in a process group (PGID).
   */
  async terminateGroup(pgid: number, confirm: boolean): Promise<boolean> {
    if (confirm) {
      const answer = await vscode.window.showWarningMessage(
        `Terminate process group ${pgid} (SIGTERM)?`,
        { modal: true },
        'Terminate Group'
      );
      if (answer !== 'Terminate Group') {
        return false;
      }
    }
    return this.sendSignalToGroup(pgid, 'SIGTERM');
  }

  /**
   * Force kill all processes in a process group (PGID).
   */
  async forceKillGroup(pgid: number, confirm: boolean): Promise<boolean> {
    if (confirm) {
      const answer = await vscode.window.showWarningMessage(
        `Force kill process group ${pgid} (SIGKILL)?`,
        { modal: true },
        'Force Kill Group'
      );
      if (answer !== 'Force Kill Group') {
        return false;
      }
    }
    return this.sendSignalToGroup(pgid, 'SIGKILL');
  }

  /**
   * Terminate a process and all its descendants (subtree kill).
   */
  async terminateSubtree(pid: number, snapshot: ProcessSnapshot, confirm: boolean): Promise<boolean> {
    const descendants = this.getDescendants(pid, snapshot);
    if (confirm) {
      const answer = await vscode.window.showWarningMessage(
        `Terminate process ${pid} and ${descendants.length} descendant(s) (SIGTERM)?`,
        { modal: true },
        'Terminate Subtree'
      );
      if (answer !== 'Terminate Subtree') {
        return false;
      }
    }

    let allOk = true;
    // Kill children first (bottom-up), then the target
    for (const childPid of [...descendants].reverse()) {
      if (!this.sendSignal(childPid, 'SIGTERM')) {
        allOk = false;
      }
    }
    if (!this.sendSignal(pid, 'SIGTERM')) {
      allOk = false;
    }
    return allOk;
  }

  /**
   * Collect all descendant PIDs of a given PID using the PPID tree.
   */
  private getDescendants(pid: number, snapshot: ProcessSnapshot): number[] {
    const result: number[] = [];
    const stack = [pid];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const children = snapshot.childrenByPpid.get(current) || [];
      for (const child of children) {
        result.push(child);
        stack.push(child);
      }
    }

    return result;
  }

  /**
   * Send a signal to a single PID. Returns true if successful.
   */
  private sendSignal(pid: number, signal: NodeJS.Signals): boolean {
    try {
      process.kill(pid, signal);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ESRCH')) {
        // Process already exited
        vscode.window.showInformationMessage(`Process ${pid} has already exited.`);
        return true;
      }
      if (msg.includes('EPERM')) {
        vscode.window.showErrorMessage(`Permission denied: cannot signal process ${pid}.`);
      } else {
        vscode.window.showErrorMessage(`Failed to signal process ${pid}: ${msg}`);
      }
      return false;
    }
  }

  /**
   * Send a signal to a process group via negative PID.
   */
  private sendSignalToGroup(pgid: number, signal: NodeJS.Signals): boolean {
    try {
      process.kill(-pgid, signal);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ESRCH')) {
        vscode.window.showInformationMessage(`Process group ${pgid} has already exited.`);
        return true;
      }
      if (msg.includes('EPERM')) {
        vscode.window.showErrorMessage(`Permission denied: cannot signal process group ${pgid}.`);
      } else {
        vscode.window.showErrorMessage(`Failed to signal process group ${pgid}: ${msg}`);
      }
      return false;
    }
  }
}
