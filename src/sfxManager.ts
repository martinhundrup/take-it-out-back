/**
 * SFXManager: plays sound effects for process-related events.
 *
 * Bundled sounds live in `media/sfx/` inside the extension directory.
 * Users can override paths via settings.
 *
 * Events:
 *   Cock  — shotgun cocking, triggered when a process is selected / right-clicked
 *   Fire  — shotgun firing, triggered when any kill command is issued
 */

import { exec } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

export enum SFXEvent {
  Cock = 'cock',
  Fire = 'fire',
}

export class SFXManager {
  private enabled: boolean = true;
  private playbackCommand: string | undefined;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private extensionPath: string = '';

  /** Debounce durations per event (ms). */
  private static readonly DEBOUNCE: Record<SFXEvent, number> = {
    [SFXEvent.Cock]: 400,   // short debounce — allow rapid re-cocking if clicking around
    [SFXEvent.Fire]: 300,   // short — let rapid kills each fire
  };

  /** Default filenames bundled in media/sfx/. */
  private static readonly DEFAULT_FILES: Record<SFXEvent, string> = {
    [SFXEvent.Cock]: 'cock.wav',
    [SFXEvent.Fire]: 'fire.wav',
  };

  constructor() {
    this.detectPlaybackCommand();
  }

  /** Set the extension install path so we can resolve bundled sounds. */
  setExtensionPath(extPath: string): void {
    this.extensionPath = extPath;
  }

  /** Update enabled state from settings. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Play a sound for an event, with per-event debounce.
   */
  trigger(event: SFXEvent): void {
    if (!this.enabled || !this.playbackCommand) {
      return;
    }

    if (this.debounceTimers.has(event)) {
      return; // still in debounce window
    }

    const soundPath = this.resolveSoundPath(event);
    if (!soundPath) {
      return;
    }

    this.play(soundPath);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(event);
    }, SFXManager.DEBOUNCE[event]);
    this.debounceTimers.set(event, timer);
  }

  /** Clean up timers. */
  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  // ─── Internals ──────────────────────────────────────────────────

  private detectPlaybackCommand(): void {
    const platform = os.platform();
    if (platform === 'darwin') {
      this.playbackCommand = 'afplay';
    } else {
      exec('which paplay', (err) => {
        if (!err) {
          this.playbackCommand = 'paplay';
        } else {
          exec('which aplay', (err2) => {
            if (!err2) {
              this.playbackCommand = 'aplay';
            }
          });
        }
      });
    }
  }

  /**
   * Resolve the sound file path for an event:
   *   1. Check user setting override
   *   2. Fall back to bundled file in media/sfx/
   */
  private resolveSoundPath(event: SFXEvent): string | undefined {
    const config = vscode.workspace.getConfiguration('takeitoutback');

    // User override via settings
    const settingKey = `sfx.path${capitalize(event)}`;
    const userPath = config.get<string>(settingKey);
    if (userPath && fs.existsSync(userPath)) {
      return userPath;
    }

    // Bundled default
    if (this.extensionPath) {
      const bundled = path.join(this.extensionPath, 'media', 'sfx', SFXManager.DEFAULT_FILES[event]);
      if (fs.existsSync(bundled)) {
        return bundled;
      }
    }

    return undefined;
  }

  private play(filePath: string): void {
    if (!this.playbackCommand) {
      return;
    }
    // Fire and forget — don't block on playback
    exec(`${this.playbackCommand} "${filePath}"`, (_err) => {
      // silently ignore playback errors
    });
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
