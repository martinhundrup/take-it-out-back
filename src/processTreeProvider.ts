/**
 * ProcessTreeProvider: VS Code TreeDataProvider that groups processes
 * into collapsible path-based folders derived from the process command path.
 *
 * e.g. "/System/Library/Frameworks/..." processes are grouped under:
 *   System/ (330 processes)
 *     Library/ (280 processes)
 *       Frameworks/ (200 processes)
 *         individual processes...
 *
 * Single-child folder chains are collapsed so you see
 * "System/Library/Frameworks/" instead of three nested levels with
 * one child each.
 */

import * as vscode from 'vscode';
import { ProcessInfo, ProcessSnapshot } from './processModel';

// ─── Tree node types ────────────────────────────────────────────────

/** Union type for all tree elements. */
export type TreeElement = FolderNode | ProcessNode;

/** A folder grouping processes by command-path prefix. */
export class FolderNode {
  readonly kind = 'folder' as const;
  readonly id: string;

  constructor(
    /** Display name — just the segment(s), e.g. "Library" or "System/Library" */
    public readonly segment: string,
    /** Full path prefix this folder represents, e.g. "System/Library" */
    public readonly pathPrefix: string,
    /** Total number of processes underneath this folder (recursive). */
    public readonly processCount: number,
    /** Aggregate CPU % of all processes underneath. */
    public readonly totalCpu: number,
    /** Aggregate RSS (KB) of all processes underneath. */
    public readonly totalRss: number,
  ) {
    this.id = `folder:${pathPrefix}`;
  }
}

/** A leaf node representing a single process. */
export class ProcessNode {
  readonly kind = 'process' as const;
  readonly id: string;

  constructor(public readonly proc: ProcessInfo) {
    this.id = `proc:${proc.pid}`;
  }
}

// ─── Helper: format memory ─────────────────────────────────────────

function formatMemory(rssKb: number): string {
  if (rssKb < 1024) {
    return `${rssKb} KB`;
  }
  const mb = rssKb / 1024;
  if (mb < 1024) {
    return `${mb.toFixed(1)} MB`;
  }
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

// ─── Internal trie for path grouping ────────────────────────────────

interface TrieNode {
  segment: string;
  fullPath: string;
  children: Map<string, TrieNode>;
  processes: ProcessInfo[];
  totalCount: number;
  totalCpu: number;
  totalRss: number;
}

function createTrieNode(segment: string, fullPath: string): TrieNode {
  return { segment, fullPath, children: new Map(), processes: [], totalCount: 0, totalCpu: 0, totalRss: 0 };
}

/**
 * Extract path segments from the process command path.
 * "/System/Library/Frameworks/foo" → ["System", "Library", "Frameworks", "foo"]
 * "node" (no slashes) → ["node"]
 */
function getPathSegments(proc: ProcessInfo): string[] {
  let cmdPath = proc.args.split(/\s/)[0] || proc.command;
  if (cmdPath.startsWith('/')) {
    cmdPath = cmdPath.substring(1);
  }
  const segments = cmdPath.split('/').filter(s => s.length > 0);
  return segments.length > 0 ? segments : [proc.command];
}

/** Build a trie from a list of processes. */
function buildTrie(processes: ProcessInfo[]): TrieNode {
  const root = createTrieNode('', '');

  for (const proc of processes) {
    const segments = getPathSegments(proc);
    let current = root;

    // All segments except the last form folder levels; the process itself
    // is a leaf at the deepest folder.
    const folderSegments = segments.length > 1 ? segments.slice(0, -1) : [];

    for (const seg of folderSegments) {
      if (!current.children.has(seg)) {
        const childPath = current.fullPath ? `${current.fullPath}/${seg}` : seg;
        current.children.set(seg, createTrieNode(seg, childPath));
      }
      current = current.children.get(seg)!;
    }

    current.processes.push(proc);
  }

  computeTotals(root);
  return root;
}

function computeTotals(node: TrieNode): void {
  let count = node.processes.length;
  let cpu = 0, rss = 0;
  for (const p of node.processes) { cpu += p.cpu; rss += p.rss; }
  for (const child of node.children.values()) {
    computeTotals(child);
    count += child.totalCount;
    cpu += child.totalCpu;
    rss += child.totalRss;
  }
  node.totalCount = count;
  node.totalCpu = cpu;
  node.totalRss = rss;
}

/**
 * Collapse single-child folder chains:
 * "System" → "Library" → "Frameworks" becomes "System/Library/Frameworks"
 * when intermediate nodes have no direct processes.
 */
function collapseChains(node: TrieNode): TrieNode {
  const newChildren = new Map<string, TrieNode>();
  for (const [key, child] of node.children) {
    newChildren.set(key, collapseChains(child));
  }
  node.children = newChildren;

  if (node.children.size === 1 && node.processes.length === 0 && node.segment !== '') {
    const onlyChild = [...node.children.values()][0];
    const merged = createTrieNode(`${node.segment}/${onlyChild.segment}`, onlyChild.fullPath);
    merged.children = onlyChild.children;
    merged.processes = onlyChild.processes;
    merged.totalCount = onlyChild.totalCount;
    merged.totalCpu = onlyChild.totalCpu;
    merged.totalRss = onlyChild.totalRss;
    return merged;
  }

  return node;
}

// ─── TreeDataProvider ───────────────────────────────────────────────

export class ProcessTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private snapshot: ProcessSnapshot | undefined;
  private trie: TrieNode | undefined;
  private showSystemProcesses: boolean = false;
  private showOtherUsers: boolean = false;
  private currentUser: string = '';

  setCurrentUser(user: string): void { this.currentUser = user; }
  setShowSystemProcesses(value: boolean): void { this.showSystemProcesses = value; }
  setShowOtherUsers(value: boolean): void { this.showOtherUsers = value; }

  /** Update the snapshot, rebuild the trie, and refresh the tree. */
  update(snapshot: ProcessSnapshot): void {
    this.snapshot = snapshot;
    const visible = this.getVisibleProcesses();
    this.trie = collapseChains(buildTrie(visible));
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    if (element.kind === 'folder') {
      return this.makeFolderItem(element);
    }
    return this.makeProcessItem(element);
  }

  getChildren(element?: TreeElement): TreeElement[] {
    if (!this.trie) { return []; }

    if (!element) {
      return this.getTrieNodeChildren(this.trie);
    }

    if (element.kind === 'folder') {
      const trieNode = this.findTrieNode(element.pathPrefix);
      return trieNode ? this.getTrieNodeChildren(trieNode) : [];
    }

    return [];
  }

  // ─── Item creation ──────────────────────────────────────────────

  private makeFolderItem(folder: FolderNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      `${folder.segment}/`,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.id = folder.id;
    item.description = `${folder.processCount} processes — CPU ${folder.totalCpu.toFixed(1)}% — RSS ${formatMemory(folder.totalRss)}`;
    item.iconPath = new vscode.ThemeIcon('folder');
    item.contextValue = 'folder';
    return item;
  }

  private makeProcessItem(node: ProcessNode): vscode.TreeItem {
    const proc = node.proc;
    const item = new vscode.TreeItem(proc.command, vscode.TreeItemCollapsibleState.None);
    item.id = node.id;
    item.description = `PID ${proc.pid}  CPU ${proc.cpu.toFixed(1)}%  RSS ${formatMemory(proc.rss)}  ${proc.etime}`;
    item.contextValue = 'process';
    item.tooltip = new vscode.MarkdownString([
      `**${proc.command}**`, ``,
      `| Field | Value |`, `|-------|-------|`,
      `| PID | ${proc.pid} |`, `| PPID | ${proc.ppid} |`,
      `| PGID | ${proc.pgid} |`, `| User | ${proc.user} |`,
      `| CPU | ${proc.cpu.toFixed(1)}% |`, `| Memory | ${formatMemory(proc.rss)} |`,
      `| Elapsed | ${proc.etime} |`, ``, `\`${proc.args}\``,
    ].join('\n'));

    if (proc.cpu >= 90) {
      item.iconPath = new vscode.ThemeIcon('flame', new vscode.ThemeColor('errorForeground'));
    } else if (proc.cpu >= 50) {
      item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
    } else {
      item.iconPath = new vscode.ThemeIcon('circle-outline');
    }
    return item;
  }

  // ─── Trie navigation ───────────────────────────────────────────

  private getTrieNodeChildren(node: TrieNode): TreeElement[] {
    const elements: TreeElement[] = [];

    // Folders sorted by process count descending
    const folders = [...node.children.values()]
      .sort((a, b) => b.totalCount - a.totalCount)
      .map(c => new FolderNode(c.segment, c.fullPath, c.totalCount, c.totalCpu, c.totalRss));
    elements.push(...folders);

    // Direct processes sorted by CPU descending
    const procs = [...node.processes]
      .sort((a, b) => b.cpu - a.cpu)
      .map(p => new ProcessNode(p));
    elements.push(...procs);

    return elements;
  }

  private findTrieNode(pathPrefix: string): TrieNode | undefined {
    return this.trie ? this.findInNode(this.trie, pathPrefix) : undefined;
  }

  private findInNode(node: TrieNode, target: string): TrieNode | undefined {
    for (const child of node.children.values()) {
      if (child.fullPath === target) { return child; }
      if (target.startsWith(child.fullPath + '/')) {
        return this.findInNode(child, target);
      }
    }
    return undefined;
  }

  // ─── Filtering ────────────────────────────────────────────────

  private getVisibleProcesses(): ProcessInfo[] {
    return this.snapshot ? this.snapshot.processes.filter(p => this.isVisible(p)) : [];
  }

  private isVisible(proc: ProcessInfo): boolean {
    if (!this.showOtherUsers && proc.user !== this.currentUser) { return false; }
    if (!this.showSystemProcesses && this.isSystemUser(proc.user)) { return false; }
    return true;
  }

  private isSystemUser(user: string): boolean {
    const systemUsers = [
      'root', 'daemon', 'nobody', 'sys', 'bin', 'mail',
      '_windowserver', '_coreaudiod', '_spotlight', '_locationd',
      '_hidd', '_distnoted', '_nsurlsessiond', '_displaypolicyd',
    ];
    return systemUsers.includes(user) || user.startsWith('_');
  }
}
