#!/usr/bin/env bun
import { Command } from 'commander'
import { join } from 'path'
import { existsSync, writeFileSync } from 'fs'
import { emitKeypressEvents } from 'readline'
import { createElement } from 'react'
import { render } from 'ink'
import { loadConfig, ConfigError } from '@openrelay/config'
import { MessageBus } from '@openrelay/core'
import { createAdapter } from '@openrelay/adapters'
import { SessionManager } from '@openrelay/planner'
import { Dashboard } from '@openrelay/tui'

// ─── ANSI colors ──────────────────────────────────────────────────────────────

const L  = '\x1b[95m'  // lila (bright magenta)
const DM = '\x1b[2m'   // dim
const RS = '\x1b[0m'   // reset

// ─── Shared Types ─────────────────────────────────────────────────────────────

/** Minimal interface for pausing/resuming stdin — works with both readline and raw mode */
interface ReplHandle {
  pause(): void
  resume(): void
  close(): void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VERSION = 'v0.1.0'

const KNOWN_CLIS = ['claude', 'gemini', 'codex', 'opencode'] as const

const AVAILABLE_MODELS: Record<string, { planner: string[]; coder: string[] }> = {
  claude: {
    planner: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    coder:   ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-7'],
  },
  gemini: {
    planner: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    coder:   ['gemini-2.5-flash', 'gemini-2.5-pro'],
  },
  codex: {
    planner: ['o3', 'o4-mini'],
    coder:   ['o4-mini', 'o3'],
  },
  opencode: {
    planner: ['claude-opus-4-7', 'claude-sonnet-4-6'],
    coder:   ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  },
}

const TOKEN_BUDGETS = { planner: 50000, coder: 200000 }

const REPL_COMMANDS = [
  { cmd: '/init',    desc: 'Initialize crew.md in current directory' },
  { cmd: '/config',  desc: 'Configure agents interactively' },
  { cmd: '/run',     desc: 'Run a task with your crew' },
  { cmd: '/status',  desc: 'Show latest session status' },
  { cmd: '/history', desc: 'Show past sessions' },
  { cmd: '/help',    desc: 'Show available commands' },
  { cmd: '/exit',    desc: 'Exit OpenRelay' },
]

const CREW_SKELETON = `\
[session]
max_retries = 2
summary_interval = 10
checkpoint_timeout = 300
`

// ─── ASCII Banner ──────────────────────────────────────────────────────────────

// O = chars 0-8 (9 chars) · PEN = 9-34 · R = 35-42 (8 chars) · ELAY = 43+
const BANNER_LINES = [
  ' ██████╗ ██████╗ ███████╗███╗   ██╗██████╗ ███████╗██╗      █████╗ ██╗   ██╗',
  '██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔══██╗██╔════╝██║     ██╔══██╗╚██╗ ██╔╝',
  '██║   ██║██████╔╝█████╗  ██╔██╗ ██║██████╔╝█████╗  ██║     ███████║ ╚████╔╝ ',
  '██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║██╔══██╗██╔══╝  ██║     ██╔══██║  ╚██╔╝  ',
  '╚██████╔╝██║     ███████╗██║ ╚████║██║  ██║███████╗███████╗██║  ██║   ██║   ',
  ' ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝   ╚═╝  ',
]

function printBanner(dir: string) {
  const lines = BANNER_LINES.map(line => {
    const o    = line.slice(0, 9)
    const pen  = line.slice(9, 35)
    const r    = line.slice(35, 43)
    const elay = line.slice(43)
    return `${L}${o}${RS}${pen}${L}${r}${RS}${elay}`
  })
  console.log(lines.join('\n'))
  console.log()
  console.log(`  ${L}${VERSION}${RS}`)
  console.log()

  try {
    const cfg = loadConfig(dir)
    const p = cfg.agents.find(a => a.role === 'planner')
    const e = cfg.agents.find(a => a.role === 'coder')
    if (p) {
      const pb = p.mode === 'api'  ? `${p.provider}/${p.model}` : `${p.cli}/${p.model}`
      const eb = e ? (e.mode === 'api' ? `${e.provider}/${e.model}` : `${e.cli}/${e.model}`) : '-'
      console.log(`  ${L}planner${RS}  ${pb}   ${L}executor${RS}  ${eb}`)
      console.log(`  ${DM}${dir}${RS}`)
    }
  } catch {
    console.log(`  ${DM}No crew configured — run /config to set up agents.${RS}`)
  }
  console.log()
  console.log(`  ${DM}Type / to see commands · /exit to quit${RS}`)
  console.log()
}

// ─── CLI detection ────────────────────────────────────────────────────────────

function detectClis(): string[] {
  return KNOWN_CLIS.filter(c => Bun.which(c) !== null)
}

// ─── Raw config wizard (no Ink — avoids readline/stdin conflict) ───────────────

interface AgentSlot { cli: string; model: string }
interface ConfigResult { planner: AgentSlot; executor: AgentSlot; saved: boolean }

async function runRawConfigWizard(
  detected: string[],
  initial?: { planner: AgentSlot; executor: AgentSlot },
): Promise<ConfigResult | null> {
  return new Promise<ConfigResult | null>(resolve => {
    // Temporarily remove readline's keypress listeners to avoid conflict
    const savedListeners = process.stdin.rawListeners('keypress').slice()
    process.stdin.removeAllListeners('keypress')

    emitKeypressEvents(process.stdin)
    if (process.stdin.isTTY) process.stdin.setRawMode(true)
    process.stdin.resume()

    // Alternate screen buffer — wizard runs on a clean screen, normal buffer restored on exit
    process.stdout.write('\x1b[?1049h')

    let focus = 0  // 0=plannerCli 1=plannerModel 2=executorCli 3=executorModel
    let plannerCli    = initial?.planner.cli   ?? detected[0] ?? ''
    let executorCli   = initial?.executor.cli  ?? detected[0] ?? ''
    let plannerModel  = initial?.planner.model  ?? ''
    let executorModel = initial?.executor.model ?? ''

    const pModels = () => AVAILABLE_MODELS[plannerCli]?.planner  ?? [plannerCli]
    const eModels = () => AVAILABLE_MODELS[executorCli]?.coder   ?? [executorCli]
    const rPModel = () => { const m = pModels(); return m.includes(plannerModel)  ? plannerModel  : m[0]! }
    const rEModel = () => { const m = eModels(); return m.includes(executorModel) ? executorModel : m[0]! }

    function cycleStr(cur: string, list: string[], dir: 1 | -1): string {
      const i = list.indexOf(cur)
      return list[(i === -1 ? 0 : (i + dir + list.length) % list.length)]!
    }

    function fRow(idx: number, label: string, value: string, opts: string[]): string {
      const active = focus === idx
      const i = opts.indexOf(value)
      const count = `${DM}(${i + 1}/${opts.length})${RS}`
      const ind = active ? `${L}▶${RS}` : ' '
      const lbl = (active ? `${L}` : `${DM}`) + label.padEnd(6) + RS
      const val = active ? `${L}${value}${RS}` : value
      const arr = active
        ? `${L}◀${RS} ${val} ${L}▶${RS}  ${count}`
        : `  ${val}    ${count}`
      return `    ${ind} ${lbl}  ${arr}`
    }

    const WIZARD_HEIGHT = 15

    function draw() {
      const rows = process.stdout.rows ?? 24
      const startRow = Math.max(1, rows - WIZARD_HEIGHT - 1)
      // In alt screen: clear entire buffer then position near bottom
      process.stdout.write(`\x1b[2J\x1b[${startRow}H`)
      const out = [
        '',
        `  ${L}Configure Crew${RS}`,
        `  ${L}${'─'.repeat(50)}${RS}`,
        '',
        `  ${L}Planner${RS}`,
        fRow(0, 'CLI',   plannerCli,  detected),
        fRow(1, 'Model', rPModel(),   pModels()),
        '',
        `  ${L}Executor${RS}`,
        fRow(2, 'CLI',   executorCli, detected),
        fRow(3, 'Model', rEModel(),   eModels()),
        '',
        `  ${L}${'─'.repeat(50)}${RS}`,
        `  ${DM}↑↓ navigate · ←→ or Enter change ·${RS} ${L}S${RS}${DM} save ·${RS} ${L}Q${RS}${DM} cancel${RS}`,
        '',
      ]
      process.stdout.write(out.join('\n'))
    }

    function cleanup() {
      process.stdin.removeAllListeners('keypress')
      if (process.stdin.isTTY) process.stdin.setRawMode(false)
      process.stdin.pause()
      for (const l of savedListeners) process.stdin.on('keypress', l as any)
      // Exit alternate screen — normal buffer (with full scroll history) is restored
      process.stdout.write('\x1b[?1049l')
    }

    function done(saved: boolean) {
      cleanup()
      resolve(saved
        ? { planner: { cli: plannerCli, model: rPModel() }, executor: { cli: executorCli, model: rEModel() }, saved: true }
        : null)
    }

    function onKey(str: string, key: { name: string; ctrl: boolean }) {
      if (!key) return
      if (key.ctrl && key.name === 'c') { cleanup(); process.exit(0) }

      switch (key.name) {
        case 'up':   focus = Math.max(0, focus - 1); break
        case 'down': focus = Math.min(3, focus + 1); break
        case 'left':
        case 'right':
        case 'return': {
          const dir: 1 | -1 = key.name === 'left' ? -1 : 1
          if (focus === 0) { plannerCli  = cycleStr(plannerCli,  detected, dir); plannerModel  = pModels()[0]! }
          if (focus === 1) { plannerModel  = cycleStr(rPModel(), pModels(), dir) }
          if (focus === 2) { executorCli = cycleStr(executorCli, detected, dir); executorModel = eModels()[0]! }
          if (focus === 3) { executorModel = cycleStr(rEModel(), eModels(), dir) }
          break
        }
      }

      if (str === 's' || str === 'S') { done(true);  return }
      if (str === 'q' || str === 'Q' || key.name === 'escape') { done(false); return }

      draw()
    }

    process.stdin.on('keypress', onKey)
    draw()
  })
}

// ─── crew.md writer ───────────────────────────────────────────────────────────

function writeCrewMd(planner: AgentSlot, executor: AgentSlot, dir: string) {
  const lines = [
    '[session]',
    'max_retries = 2',
    'summary_interval = 10',
    'checkpoint_timeout = 300',
    '',
    '[[agents]]',
    'id = "orchestrator"',
    'role = "planner"',
    `cli = "${planner.cli}"`,
    `model = "${planner.model}"`,
    `token_budget = ${TOKEN_BUDGETS.planner}`,
    'working_dir = "."',
    'checkpoints = ["plan_ready", "deviation_found"]',
    '',
    '[[agents]]',
    'id = "executor"',
    'role = "coder"',
    `cli = "${executor.cli}"`,
    `model = "${executor.model}"`,
    `token_budget = ${TOKEN_BUDGETS.coder}`,
    'working_dir = "."',
    'checkpoints = []',
    '',
  ]
  writeFileSync(join(dir, 'crew.md'), lines.join('\n'))
}

// ─── Command implementations ──────────────────────────────────────────────────

async function cmdInit(dir: string, force: boolean) {
  const detected = detectClis()
  if (detected.length === 0) {
    console.log('[openrelay] No CLI agents detected. Install claude, gemini, or codex first.')
  } else {
    console.log(`[openrelay] Detected: ${detected.join(', ')}`)
  }
  const target = join(dir, 'crew.md')
  if (existsSync(target) && !force) {
    console.log('[openrelay] crew.md already exists. Use /init --force to overwrite.')
    return
  }
  writeFileSync(target, CREW_SKELETON)
  console.log(`[openrelay] crew.md created at ${target}`)
  console.log('  Run /config to configure your agents.')
}

async function cmdConfig(dir: string, rl: ReplHandle) {
  const detected = detectClis()
  if (detected.length === 0) {
    console.log('[openrelay] No CLI agents detected. Install at least one to continue.')
    return
  }

  let initial: { planner: AgentSlot; executor: AgentSlot } | undefined
  try {
    const cfg = loadConfig(dir)
    const p = cfg.agents.find(a => a.role === 'planner')
    const e = cfg.agents.find(a => a.role === 'coder')
    if (p && e) initial = { planner: { cli: p.cli ?? '', model: p.model }, executor: { cli: e.cli ?? '', model: e.model } }
  } catch { /* no existing config */ }

  rl.pause()
  const result = await runRawConfigWizard(detected, initial)
  rl.resume()
  // Wizard set raw mode off; readline needs it on for interactive editing
  if (process.stdin.isTTY) process.stdin.setRawMode(true)

  // Alt screen was exited — we're back in normal buffer with history intact
  if (!result) {
    console.log(`  ${DM}└${RS} Config dialog dismissed.`)
    return
  }

  writeCrewMd(result.planner, result.executor, dir)
  console.log(`  ${DM}└${RS} Saved — ${L}planner${RS} ${result.planner.cli}/${result.planner.model}  ${L}executor${RS} ${result.executor.cli}/${result.executor.model}`)
}

async function cmdStatus(dir: string) {
  const dbPath = join(dir, '.openrelay', 'session.db')
  if (!existsSync(dbPath)) { console.log('[openrelay] No sessions found.'); return }
  const bus = new MessageBus(dbPath)
  const sessions = bus.getSessions(1)
  if (!sessions.length) { console.log('[openrelay] No sessions found.'); bus.close(); return }
  const s = sessions[0]!
  const tasks = bus.getTasks(s.id)
  const done = tasks.filter(t => t.status === 'done').length
  const elapsed = s.endedAt
    ? Math.round((s.endedAt - s.startedAt) / 1000)
    : Math.round((Date.now() - s.startedAt) / 1000)
  console.log(`Session:  ${s.id.slice(0, 8)}`)
  console.log(`Task:     ${s.originalTask}`)
  console.log(`Status:   ${s.status}`)
  console.log(`Started:  ${new Date(s.startedAt).toLocaleString()}`)
  console.log(`Elapsed:  ${elapsed}s`)
  console.log(`Progress: ${done}/${tasks.length} tasks done`)
  bus.close()
}

async function cmdHistory(dir: string, limit: number) {
  const dbPath = join(dir, '.openrelay', 'session.db')
  if (!existsSync(dbPath)) { console.log('[openrelay] No sessions found.'); return }
  const bus = new MessageBus(dbPath)
  const sessions = bus.getSessions(limit)
  if (!sessions.length) { console.log('[openrelay] No sessions found.'); bus.close(); return }
  console.log('DATE                 TASK                                     STATUS     DURATION')
  console.log('─'.repeat(80))
  for (const s of sessions) {
    const date   = new Date(s.startedAt).toLocaleString().padEnd(20)
    const task   = s.originalTask.slice(0, 40).padEnd(40)
    const status = s.status.padEnd(10)
    const dur    = s.endedAt ? `${Math.round((s.endedAt - s.startedAt) / 1000)}s` : 'running'
    console.log(`${date} ${task} ${status} ${dur}`)
  }
  bus.close()
}

async function cmdRun(task: string, dir: string, dryRun = false, rl?: ReplHandle) {
  let config
  try {
    config = loadConfig(dir)
  } catch (e) {
    if (e instanceof ConfigError) { console.error(`[openrelay] ${e.message}`); process.exit(1) }
    throw e
  }

  if (dryRun) {
    console.log(`[openrelay] Dry run — ${task}`)
    for (const a of config.agents) {
      const b = a.mode === 'api' ? `${a.provider}/${a.model}` : `${a.cli}/${a.model}`
      console.log(`  ${a.id.padEnd(14)} ${a.role.padEnd(8)} ${b}`)
    }
    return
  }

  const plannerConfig = config.agents.find(a => a.role === 'planner')
  if (!plannerConfig) { console.error('[openrelay] No planner agent in crew.md'); process.exit(1) }

  const bus            = new MessageBus(join(dir, '.openrelay', 'session.db'))
  const plannerAdapter = createAdapter(plannerConfig)
  const manager        = new SessionManager(bus, config, plannerAdapter)
  const sessionId      = manager.getSessionId()

  rl?.pause()
  const { unmount } = render(
    createElement(Dashboard, { bus, sessionId, agents: config.agents, startedAt: Date.now(), workingDir: dir })
  )

  let cancelled = false
  const sigintHandler = () => {
    cancelled = true
    bus.updateSession(sessionId, { status: 'cancelled', endedAt: Date.now() })
    rl?.resume()
    // Keep stdin alive so the event loop doesn't exit
    process.stdin.ref()
    unmount()
    bus.close()
    if (!rl) process.exit(0) // non-interactive mode: exit
    // interactive mode: fall through — the finally block shows the prompt
  }
  process.on('SIGINT', sigintHandler)

  let completed = false
  try {
    await manager.run(task)
    completed = true
  } finally {
    process.off('SIGINT', sigintHandler)
    // Resume readline BEFORE unmounting — keeps the event loop alive so Node doesn't exit
    rl?.resume()
    // Keep stdin ref'd so the event loop doesn't exit after Ink unmount
    process.stdin.ref()
    unmount()

    if (completed) {
      const tasks  = bus.getTasks(sessionId)
      const done   = tasks.filter(t => t.status === 'done').length
      const failed = tasks.filter(t => t.status === 'failed').length
      const states = bus.getAgentStates(sessionId)
      const total  = states.reduce((s, a) => s + a.tokensIn + a.tokensOut, 0)
      console.log()
      console.log(`  ${L}✓${RS} Complete — ${done}/${tasks.length} tasks${failed ? `  ${L}✗${RS} ${failed} failed` : ''}   ${total.toLocaleString()} tokens`)
      console.log()
    } else if (cancelled) {
      console.log()
      console.log(`  ${DM}Session cancelled.${RS}`)
      console.log()
    }

    bus.close()
  }
}

function printHelp() {
  console.log(`Commands:`)
  for (const { cmd, desc } of REPL_COMMANDS) {
    console.log(`  ${L}${cmd.padEnd(14)}${RS} ${desc}`)
  }
}

// ─── Interactive REPL ─────────────────────────────────────────────────────────

async function handleCommand(cmd: string, args: string[], dir: string, rl: ReplHandle) {
  switch (cmd) {
    case 'init':    await cmdInit(dir, args.includes('--force')); break
    case 'config':  await cmdConfig(dir, rl); break
    case 'status':  await cmdStatus(dir); break
    case 'history': {
      const li = args.indexOf('--limit')
      await cmdHistory(dir, li !== -1 ? parseInt(args[li + 1] ?? '10', 10) : 10)
      break
    }
    case 'run': {
      const task = args.join(' ')
      if (!task) { console.log('[openrelay] Usage: /run <task>'); break }
      await cmdRun(task, dir, false, rl)
      break
    }
    case 'help':  printHelp(); break
    case 'exit':
    case 'quit':  rl.close(); process.exit(0); break
    default:      console.log(`[openrelay] Unknown command: /${cmd}. Type /help.`)
  }
}

async function startInteractiveMode(dir = process.cwd()) {
  printBanner(dir)

  // ── ANSI ──────────────────────────────────────────────────────────────────────

  const BAR  = '\x1b[48;5;239m' // dark gray bar background (like Gemini CLI)
  const WHT  = '\x1b[97m'       // bright white text
  const PHD  = '\x1b[38;5;102m' // placeholder (visible on dark bar)
  const EL   = '\x1b[K'         // erase to end of line (inherits bg color → fills bar)
  const HIDE = '\x1b[?25l'
  const SHOW = '\x1b[?25h'
  const BLOCK = '\x1b[2 q'      // steady block cursor shape

  // ── State ─────────────────────────────────────────────────────────────────────

  let busy = false
  let lines: string[] = ['']
  let cursorLine = 0
  let cursorCol  = 0

  let prevRenderHeight = 0
  let screenCursorRow  = 0

  const cols = () => process.stdout.columns || 80

  // ── Render ────────────────────────────────────────────────────────────────────

  function render() {
    // Dropdown
    const text = lines[0] ?? ''
    const dropdown = text.startsWith('/')
      ? REPL_COMMANDS.filter(r => r.cmd.startsWith(text) && r.cmd !== text).slice(0, 6)
      : []

    // Total height: dropdown lines + content lines (no separator)
    const totalHeight = dropdown.length + lines.length

    let buf = HIDE

    // Move up to top of previous render
    if (prevRenderHeight > 0 && screenCursorRow > 0) {
      buf += `\x1b[${screenCursorRow}A`
    }
    buf += '\r\x1b[J'

    // Dropdown entries (plain, above the bar)
    for (const { cmd, desc } of dropdown) {
      buf += `  ${L}${cmd}${RS}  ${DM}${desc}${RS}\n`
    }

    // Content lines: full-width dark gray background bar
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i]!

      buf += BAR  // start background bar

      if (i === 0) {
        // First line: " > text" or " > placeholder"
        if (lines.length === 1 && lineText === '') {
          buf += ` ${L}>${RS}${BAR} ${PHD}Type your message or @path/to/file`
        } else if (lineText.startsWith('/')) {
          buf += ` ${L}> ${lineText}${RS}${BAR}`
        } else {
          buf += ` ${L}>${RS}${BAR} ${WHT}${lineText}`
        }
      } else {
        // Continuation lines: "   text" (aligned with first line text)
        buf += `   ${WHT}${lineText}`
      }

      buf += `${EL}${RS}` // fill rest of line with bar bg, then reset

      if (i < lines.length - 1) buf += '\n'
    }

    // Position cursor
    // Target row (0-indexed): dropdown.length + cursorLine
    const targetRow = dropdown.length + cursorLine
    const lastRow = totalHeight - 1
    const upCount = lastRow - targetRow
    if (upCount > 0) buf += `\x1b[${upCount}A`

    // Column: first line = 1(space) + 1(>) + 1(space) + cursorCol = 3 + cursorCol
    //         other lines = 3(spaces) + cursorCol
    const colOffset = 3 + cursorCol + 1 // +1 for 1-based terminal column
    buf += `\r\x1b[${colOffset}C`

    // Block cursor + white foreground + show
    buf += `${BLOCK}${WHT}${SHOW}`

    process.stdout.write(buf)

    prevRenderHeight = totalHeight
    screenCursorRow = targetRow
  }

  function initialDraw() {
    process.stdout.write('\n')
    prevRenderHeight = 0
    screenCursorRow = 0
    render()
  }

  function resetInput() {
    lines = ['']
    cursorLine = 0
    cursorCol = 0
  }

  // ── Submission ────────────────────────────────────────────────────────────────

  async function submitInput() {
    if (busy) return
    const fullText = lines.join('\n').trim()

    // Move below the render area
    const downCount = (prevRenderHeight - 1) - screenCursorRow
    if (downCount > 0) process.stdout.write(`\x1b[${downCount}B`)
    process.stdout.write('\r\n')

    resetInput()

    if (!fullText) {
      initialDraw()
      return
    }

    if (!fullText.startsWith('/')) {
      console.log('[openrelay] Commands start with /. Type /help for a list.')
      initialDraw()
      return
    }

    const [cmd, ...args] = fullText.slice(1).split(/\s+/)
    busy = true
    try {
      await handleCommand(cmd!, args, dir, rlCompat)
    } finally {
      busy = false
      initialDraw()
    }
  }

  // ── RL-compat ─────────────────────────────────────────────────────────────────

  let rawModeActive = true

  const rlCompat = {
    pause: () => {
      if (process.stdin.isTTY && rawModeActive) {
        process.stdin.setRawMode(false)
        rawModeActive = false
      }
      process.stdin.pause()
    },
    resume: () => {
      process.stdin.resume()
      if (process.stdin.isTTY && !rawModeActive) {
        process.stdin.setRawMode(true)
        rawModeActive = true
      }
    },
    close: () => { process.exit(0) },
  } as ReplHandle

  // ── Raw key handling ──────────────────────────────────────────────────────────

  emitKeypressEvents(process.stdin)
  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  process.stdin.resume()

  process.stdin.on('keypress', (str: string | undefined, key: { name: string; ctrl: boolean; shift: boolean; meta: boolean; sequence: string }) => {
    if (!key || busy) return

    if (key.ctrl && (key.name === 'c' || key.name === 'd')) {
      process.stdout.write(`${SHOW}\n`)
      process.exit(0)
    }

    if (key.name === 'return') {
      if (key.shift) {
        const cur = lines[cursorLine]!
        lines[cursorLine] = cur.slice(0, cursorCol)
        lines.splice(cursorLine + 1, 0, cur.slice(cursorCol))
        cursorLine++
        cursorCol = 0
        render()
        return
      }
      submitInput()
      return
    }

    if (key.name === 'backspace') {
      if (cursorCol === 0 && cursorLine === 0) return
      if (cursorCol > 0) {
        const l = lines[cursorLine]!
        lines[cursorLine] = l.slice(0, cursorCol - 1) + l.slice(cursorCol)
        cursorCol--
      } else {
        const prev = lines[cursorLine - 1]!
        cursorCol = prev.length
        lines[cursorLine - 1] = prev + lines[cursorLine]!
        lines.splice(cursorLine, 1)
        cursorLine--
      }
      render()
      return
    }

    if (key.name === 'delete') {
      const l = lines[cursorLine]!
      if (cursorCol < l.length) {
        lines[cursorLine] = l.slice(0, cursorCol) + l.slice(cursorCol + 1)
      } else if (cursorLine < lines.length - 1) {
        lines[cursorLine] = l + lines[cursorLine + 1]!
        lines.splice(cursorLine + 1, 1)
      }
      render()
      return
    }

    if (key.name === 'left') {
      if (cursorCol > 0) cursorCol--
      else if (cursorLine > 0) { cursorLine--; cursorCol = lines[cursorLine]!.length }
      render(); return
    }
    if (key.name === 'right') {
      if (cursorCol < lines[cursorLine]!.length) cursorCol++
      else if (cursorLine < lines.length - 1) { cursorLine++; cursorCol = 0 }
      render(); return
    }
    if (key.name === 'up') {
      if (cursorLine > 0) { cursorLine--; cursorCol = Math.min(cursorCol, lines[cursorLine]!.length) }
      render(); return
    }
    if (key.name === 'down') {
      if (cursorLine < lines.length - 1) { cursorLine++; cursorCol = Math.min(cursorCol, lines[cursorLine]!.length) }
      render(); return
    }

    if (key.name === 'home') { cursorCol = 0; render(); return }
    if (key.name === 'end')  { cursorCol = lines[cursorLine]!.length; render(); return }

    if (key.name === 'tab') {
      const t = lines[0] ?? ''
      if (t.startsWith('/') && lines.length === 1) {
        const m = REPL_COMMANDS.filter(r => r.cmd.startsWith(t))
        if (m.length === 1) { lines[0] = m[0]!.cmd + ' '; cursorCol = lines[0].length }
      }
      render(); return
    }

    if (key.name === 'escape') { resetInput(); render(); return }

    if (str && !key.ctrl && !key.meta && str.length > 0 && str.charCodeAt(0) >= 32) {
      const l = lines[cursorLine]!
      lines[cursorLine] = l.slice(0, cursorCol) + str + l.slice(cursorCol)
      cursorCol += str.length
      render()
    }
  })

  initialDraw()
}

// ─── Commander (non-interactive) ──────────────────────────────────────────────

const program = new Command()
program.name('openrelay').description('Multi-agent orchestration for terminal AI agents').version(VERSION)

program.command('run <task>')
  .description('Run a task with the agent crew defined in crew.md')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .option('--dry-run', 'Show plan without executing')
  .action(async (task: string, options: { dir: string; dryRun?: boolean }) => {
    await cmdRun(task, options.dir, options.dryRun)
    await startInteractiveMode(options.dir)
  })

program.command('init')
  .description('Initialize a crew.md in the current directory')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .option('--force', 'Overwrite existing crew.md')
  .action(async (options: { dir: string; force?: boolean }) => {
    await cmdInit(options.dir, options.force ?? false)
  })

program.command('status')
  .description('Show the latest session status')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .action(async (options: { dir: string }) => await cmdStatus(options.dir))

program.command('history')
  .description('Show past sessions')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .option('--limit <n>', 'Number of sessions to show', '10')
  .action(async (options: { dir: string; limit: string }) => await cmdHistory(options.dir, parseInt(options.limit, 10)))

// ─── Entry point ──────────────────────────────────────────────────────────────

if (process.argv.length <= 2) {
  await startInteractiveMode()
} else {
  await program.parseAsync(process.argv)
}
