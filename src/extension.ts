/**
 * Extension entry point for "Take It Out Back".
 *
 * Activates the process manager: wires up the poller, tree view,
 * controller, SFX manager, and all commands.
 */

import * as vscode from 'vscode';
import { ProcessPoller } from './processPoller';
import { ProcessController } from './processController';
import { ProcessTreeProvider, TreeElement, ProcessNode } from './processTreeProvider';
import { SFXManager, SFXEvent } from './sfxManager';

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('takeitoutback');

  // --- Core components ---
  const poller = new ProcessPoller(config.get<number>('refreshIntervalMs', 1000));
  const controller = new ProcessController();
  const treeProvider = new ProcessTreeProvider();
  const sfx = new SFXManager();

  // Configure tree provider from settings
  treeProvider.setCurrentUser(poller.getUser());
  treeProvider.setShowSystemProcesses(config.get<boolean>('showSystemProcesses', false));
  treeProvider.setShowOtherUsers(config.get<boolean>('showOtherUsers', false));
  sfx.setEnabled(config.get<boolean>('enableSFX', true));
  sfx.setExtensionPath(context.extensionPath);

  // --- Tree View ---
  const treeView = vscode.window.createTreeView('takeitoutback.processTree', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // --- Poller event wiring ---
  poller.on('snapshot', (snapshot) => {
    treeProvider.update(snapshot);
  });

  poller.on('error', (err: Error) => {
    console.error('[Take It Out Back] Poller error:', err.message);
  });

  // --- Commands ---
  const confirmSetting = () =>
    vscode.workspace
      .getConfiguration('takeitoutback')
      .get<boolean>('confirmBeforeKill', true);

  context.subscriptions.push(
    vscode.commands.registerCommand('takeitoutback.refresh', () => {
      poller.refresh();
    }),

    vscode.commands.registerCommand('takeitoutback.togglePause', () => {
      const paused = poller.togglePause();
      vscode.window.showInformationMessage(
        paused ? 'Process polling paused.' : 'Process polling resumed.'
      );
    }),

    vscode.commands.registerCommand(
      'takeitoutback.terminate',
      async (item?: TreeElement) => {
        const proc = resolveProcess(item);
        const pid = proc ? proc.pid : await promptForPid();
        if (pid === undefined) { return; }
        sfx.trigger(SFXEvent.Cock);
        const ok = await controller.terminatePid(pid, confirmSetting());
        if (ok) { sfx.trigger(SFXEvent.Fire); poller.refresh(); }
      }
    ),

    vscode.commands.registerCommand(
      'takeitoutback.forceKill',
      async (item?: TreeElement) => {
        const proc = resolveProcess(item);
        const pid = proc ? proc.pid : await promptForPid();
        if (pid === undefined) { return; }
        sfx.trigger(SFXEvent.Cock);
        const ok = await controller.forceKillPid(pid, confirmSetting());
        if (ok) { sfx.trigger(SFXEvent.Fire); poller.refresh(); }
      }
    ),

    vscode.commands.registerCommand(
      'takeitoutback.killGroup',
      async (item?: TreeElement) => {
        const proc = resolveProcess(item);
        if (!proc) { return; }
        sfx.trigger(SFXEvent.Cock);
        const ok = await controller.terminateGroup(proc.pgid, confirmSetting());
        if (ok) { sfx.trigger(SFXEvent.Fire); poller.refresh(); }
      }
    ),

    vscode.commands.registerCommand(
      'takeitoutback.killSubtree',
      async (item?: TreeElement) => {
        const proc = resolveProcess(item);
        if (!proc || !poller.snapshot) { return; }
        sfx.trigger(SFXEvent.Cock);
        const ok = await controller.terminateSubtree(proc.pid, poller.snapshot, confirmSetting());
        if (ok) { sfx.trigger(SFXEvent.Fire); poller.refresh(); }
      }
    ),

    vscode.commands.registerCommand(
      'takeitoutback.copyPid',
      async (item?: TreeElement) => {
        const proc = resolveProcess(item);
        if (!proc) { return; }
        await vscode.env.clipboard.writeText(String(proc.pid));
        vscode.window.showInformationMessage(`Copied PID ${proc.pid}`);
      }
    ),

    vscode.commands.registerCommand(
      'takeitoutback.copyCommand',
      async (item?: TreeElement) => {
        const proc = resolveProcess(item);
        if (!proc) { return; }
        await vscode.env.clipboard.writeText(proc.args);
        vscode.window.showInformationMessage(`Copied command for PID ${proc.pid}`);
      }
    )
  );

  // --- Settings change listener ---
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('takeitoutback')) {
        const cfg = vscode.workspace.getConfiguration('takeitoutback');
        poller.setInterval(cfg.get<number>('refreshIntervalMs', 1000));
        treeProvider.setShowSystemProcesses(cfg.get<boolean>('showSystemProcesses', false));
        treeProvider.setShowOtherUsers(cfg.get<boolean>('showOtherUsers', false));
        sfx.setEnabled(cfg.get<boolean>('enableSFX', true));
      }
    })
  );

  // --- Start ---
  poller.start();

  // Cleanup
  context.subscriptions.push({
    dispose() {
      poller.stop();
      sfx.dispose();
    },
  });
}

export function deactivate() {
  // Handled by disposables
}

/** Extract the ProcessInfo from a tree element, if it's a ProcessNode. */
function resolveProcess(item?: TreeElement): import('./processModel').ProcessInfo | undefined {
  if (item && item.kind === 'process') {
    return (item as ProcessNode).proc;
  }
  return undefined;
}

/** Prompt user to enter a PID manually. */
async function promptForPid(): Promise<number | undefined> {
  const input = await vscode.window.showInputBox({
    prompt: 'Enter a PID to target',
    validateInput: (v) => {
      const n = parseInt(v, 10);
      return isNaN(n) || n <= 0 ? 'Enter a valid PID (positive integer)' : null;
    },
  });
  if (!input) { return undefined; }
  return parseInt(input, 10);
}
