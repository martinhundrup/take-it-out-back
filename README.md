# Take It Out Back

A lightweight process manager embedded in VS Code. Browse running processes grouped by path, see CPU and memory at a glance, and terminate what you don't want with optional sound effects.

**macOS and Linux only.**

---

## Features

- **Path-grouped tree view** - processes organized into collapsible folders by filesystem path, with aggregate CPU, RSS, and count per folder
- **Live polling** - refreshes every second by default; pause/resume at any time
- **Kill operations** - right-click any process for:
  - Terminate (SIGTERM)
  - Force Kill (SIGKILL)
  - Kill Process Group (all processes sharing the PGID)
  - Kill Subtree (the process and all its descendants)
- **Resource display** - CPU %, RSS memory, elapsed time, full command line in tooltip
- **High-CPU highlighting** - flame icon at >= 90% CPU, warning icon at >= 50%
- **Sound effects** - shotgun cock before the confirm dialog, shotgun fire on successful kill (bring your own .wav files)
- **Clipboard** - copy PID or full command line from any process

---

## Getting Started

### Requirements

- VS Code >= 1.85
- macOS or Linux

### Build from Source

Run the following commands:

    git clone https://github.com/martinhundrup/takeitoutback.git
    cd takeitoutback
    npm install
    npm run compile

Open the folder in VS Code and press F5 to launch the Extension Development Host.

---

## Sound Effects

Drop your audio files into media/sfx/ inside the extension directory:

- cock.wav - plays when a kill command is invoked (before the confirm dialog)
- fire.wav - plays after a kill is successfully sent

Or point to custom files via settings:

- takeitoutback.sfx.pathCock
- takeitoutback.sfx.pathFire

Disable SFX entirely with takeitoutback.enableSFX set to false.

---

## Settings

Setting / Default / Description:
- takeitoutback.refreshIntervalMs: 1000 - Poll interval in milliseconds (min 500)
- takeitoutback.showSystemProcesses: false - Include processes owned by system users
- takeitoutback.showOtherUsers: false - Include processes owned by other users
- takeitoutback.cpuAlertThreshold: 90 - CPU % at which the flame icon appears
- takeitoutback.confirmBeforeKill: true - Show a confirmation dialog before killing
- takeitoutback.enableSFX: true - Enable sound effects
- takeitoutback.sfx.pathCock: "" - Custom path to cock sound (overrides bundled)
- takeitoutback.sfx.pathFire: "" - Custom path to fire sound (overrides bundled)

---

## Permissions

The extension operates entirely within your user permissions - no sudo, no privilege escalation. Attempts to kill system-owned processes will fail gracefully with an error message.

---

## License

MIT
