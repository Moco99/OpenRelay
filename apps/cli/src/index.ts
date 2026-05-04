#!/usr/bin/env bun
import { Command } from 'commander'
import { join } from 'path'
import { existsSync, writeFileSync } from 'fs'
import { createInterface, type Interface } from 'readline'
import { createElement } from 'react'
import { render } from 'ink'
import { loadConfig, ConfigError } from '@openrelay/config'
import { MessageBus } from '@openrelay/core'
import { createAdapter } from '@openrelay/adapters'
import { SessionManager } from '@openrelay/planner'
import { Dashboard } from '@openrelay/tui'

// ─── Constants ────────────────────────────────────────────────────────────────

const KNOWN_CLIS = ['claude', 'gemini', 'codex', 'opencode'] as const

const DEFAULT_MODELS: Record<string, { planner: string; coder: string }> = {
  claude:   { planner: 'claude-opus-4-7',        coder: 'claude-sonnet-4-6' },
  gemini:   { planner: 'gemini-3.1-pro-preview', coder: 'gemini-2.5-pro' },
  codex:    { planner: 'o3',                     coder: 'o4-mini' },
  opencode: { planner: 'claude-opus-4-7',        coder: 'claude-sonnet-4-6' },
}

const TOKEN_BUDGETS = { planner: 50000, coder: 200000 }

const CREW_SKELETON = `\
# OpenRelay crew configuration
# Run /config in the OpenRelay CLI to configure your agents

[session]
max_retries = 2
summary_interval = 10
checkpoint_timeout = 300

# No agents configured yet.
# Run /config to set up your crew.
`

// ─── CLI detection ────────────────────────────────────────────────────────────

function detectClis(): string[] {
  return KNOWN_CLIS.filter(c => Bun.which(c) !== null)
}

// ─── Readline helpers ─────────────────────────────────────────────────────────

function ask(rl: Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve))
}

async function askChoice(rl: Interface, question: string, choices: string[]): Promise<string> {
  while (true) {
    const answer = (await ask(rl, question)).trim()
    if (choices.includes(answer)) return answer
    console.log(`    Must be one of: ${choices.join(', ')}`)
  }
}

// ─── crew.md writer ───────────────────────────────────────────────────────────

function writeCrewMd(
  agents: Array<{ id: string; cli: string; role: 'planner' | 'coder'; model: string }>,
  dir: string,
) {
  const lines = [
    '[session]',
    'max_retries = 2',
    'summary_interval = 10',
    'checkpoint_timeout = 300',
    '',
  ]
  for (const a of agents) {
    const budget = TOKEN_BUDGETS[a.role]
    const cps = a.role === 'planner' ? '["plan_ready", "deviation_found"]' : '[]'
    lines.push(
      '[[agents]]',
      `id = "${a.id}"`,
      `role = "${a.role}"`,
      `cli = "${a.cli}"`,
      `model = "${a.model}"`,
      `token_budget = ${budget}`,
      'working_dir = "."',
      `checkpoints = ${cps}`,
      '',
    )
  }
  writeFileSync(join(dir, 'crew.md'), lines.join('\n'))
}

// ─── Command implementations ──────────────────────────────────────────────────

async function cmdInit(dir: string, force: boolean) {
  const detected = detectClis()

  if (detected.length === 0) {
    console.log('[openrelay] No CLI agents detected.')
    console.log('  * No CLI agents detected, please make sure to install one so OpenRelay can work correctly.')
  } else {
    console.log(`[openrelay] Detected CLI agents: ${detected.join(', ')}`)
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

async function cmdConfig(dir: string, rl: Interface) {
  const detected = detectClis()
  if (detected.length === 0) {
    console.log('[openrelay] No CLI agents detected. Install at least one to continue.')
    return
  }

  console.log(`[openrelay] Detected: ${detected.join(', ')}`)
  console.log('  A planner uses the strongest model; an executor uses an intermediate one.\n')

  const plannerCli = await askChoice(rl, `  Planner CLI [${detected.join('/')}]: `, detected)
  const plannerModel = DEFAULT_MODELS[plannerCli]!.planner
  console.log(`    → ${plannerModel}`)

  const coderCli = await askChoice(rl, `  Executor CLI [${detected.join('/')}]: `, detected)
  const coderModel = DEFAULT_MODELS[coderCli]!.coder
  console.log(`    → ${coderModel}`)

  const agents = [
    { id: 'orchestrator', cli: plannerCli, role: 'planner' as const, model: plannerModel },
    { id: 'executor',     cli: coderCli,   role: 'coder'   as const, model: coderModel  },
  ]
  writeCrewMd(agents, dir)
  console.log('\n[openrelay] crew.md updated. Run /run "<task>" to start.')
}

async function cmdStatus(dir: string) {
  const dbPath = join(dir, '.openrelay', 'session.db')
  if (!existsSync(dbPath)) {
    console.log('[openrelay] No sessions found.')
    return
  }
  const bus = new MessageBus(dbPath)
  const sessions = bus.getSessions(1)
  if (sessions.length === 0) {
    console.log('[openrelay] No sessions found.')
    bus.close()
    return
  }
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
  if (!existsSync(dbPath)) {
    console.log('[openrelay] No sessions found.')
    return
  }
  const bus = new MessageBus(dbPath)
  const sessions = bus.getSessions(limit)
  if (sessions.length === 0) {
    console.log('[openrelay] No sessions found.')
    bus.close()
    return
  }
  console.log('DATE                 TASK                                     STATUS     DURATION')
  console.log('─'.repeat(80))
  for (const s of sessions) {
    const date = new Date(s.startedAt).toLocaleString().padEnd(20)
    const task = s.originalTask.slice(0, 40).padEnd(40)
    const status = s.status.padEnd(10)
    const dur = s.endedAt ? `${Math.round((s.endedAt - s.startedAt) / 1000)}s` : 'running'
    console.log(`${date} ${task} ${status} ${dur}`)
  }
  bus.close()
}

async function cmdRun(task: string, dir: string, dryRun = false) {
  let config
  try {
    config = loadConfig(dir)
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`[openrelay] Config error: ${e.message}`)
      process.exit(1)
    }
    throw e
  }

  console.log(`[openrelay] Task:    ${task}`)
  console.log(`[openrelay] Crew:    ${config.agents.length} agent(s) loaded`)
  for (const agent of config.agents) {
    const backend = agent.mode === 'api' ? `${agent.provider}/${agent.model}` : `${agent.cli} (${agent.model})`
    console.log(`  · ${agent.id.padEnd(16)} ${agent.role.padEnd(10)} ${agent.mode}  ${backend}`)
  }

  if (dryRun) {
    console.log('[openrelay] Dry run — stopping before execution')
    return
  }

  const plannerConfig = config.agents.find(a => a.role === 'planner')
  if (!plannerConfig) {
    console.error('[openrelay] No agent with role "planner" found in crew.md')
    process.exit(1)
  }

  const bus = new MessageBus(join(dir, '.openrelay', 'session.db'))
  const plannerAdapter = createAdapter(plannerConfig)
  const manager = new SessionManager(bus, config, plannerAdapter)
  const sessionId = manager.getSessionId()

  const { unmount } = render(
    createElement(Dashboard, {
      bus,
      sessionId,
      agents: config.agents,
      startedAt: Date.now(),
    })
  )

  process.on('SIGINT', () => {
    bus.updateSession(sessionId, { status: 'cancelled', endedAt: Date.now() })
    unmount()
    bus.close()
    process.exit(0)
  })

  try {
    await manager.run(task)
  } finally {
    unmount()
    bus.close()
  }
}

function printHelp() {
  console.log('Commands:')
  console.log('  /init [--force]         Initialize crew.md in current directory')
  console.log('  /config                 Configure agents interactively')
  console.log('  /run <task>             Run a task with your crew')
  console.log('  /status                 Show latest session status')
  console.log('  /history [--limit n]    Show past sessions (default: 10)')
  console.log('  /help                   Show this help')
  console.log('  /exit                   Exit OpenRelay')
}

// ─── Interactive REPL ─────────────────────────────────────────────────────────

async function handleCommand(cmd: string, args: string[], dir: string, rl: Interface) {
  switch (cmd) {
    case 'init':    await cmdInit(dir, args.includes('--force')); break
    case 'config':  await cmdConfig(dir, rl); break
    case 'status':  await cmdStatus(dir); break
    case 'history': {
      const li = args.indexOf('--limit')
      const limit = li !== -1 ? parseInt(args[li + 1] ?? '10', 10) : 10
      await cmdHistory(dir, limit)
      break
    }
    case 'run': {
      const task = args.join(' ')
      if (!task) { console.log('[openrelay] Usage: /run <task>'); break }
      await cmdRun(task, dir)
      break
    }
    case 'help':  printHelp(); break
    case 'exit':
    case 'quit':  rl.close(); process.exit(0); break
    default:      console.log(`[openrelay] Unknown command: /${cmd}. Type /help for a list.`)
  }
}

async function startInteractiveMode() {
  console.log('OpenRelay v0.1.0')
  console.log('Type /help for commands, /exit to quit.\n')
  const dir = process.cwd()
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' })
  rl.prompt()
  let busy = false

  rl.on('line', async (line) => {
    if (busy) return
    const input = line.trim()
    if (!input) { rl.prompt(); return }

    if (!input.startsWith('/')) {
      console.log('[openrelay] Commands start with /. Type /help for a list.')
      rl.prompt()
      return
    }

    const [cmd, ...args] = input.slice(1).split(/\s+/)
    busy = true
    try {
      await handleCommand(cmd!, args, dir, rl)
    } finally {
      busy = false
      rl.prompt()
    }
  })

  rl.on('close', () => process.exit(0))
}

// ─── Commander (non-interactive) ──────────────────────────────────────────────

const program = new Command()

program
  .name('openrelay')
  .description('Multi-agent orchestration for terminal AI agents')
  .version('0.1.0')

program
  .command('run <task>')
  .description('Run a task with the agent crew defined in crew.md')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .option('--dry-run', 'Show plan without executing')
  .action(async (task: string, options: { dir: string; dryRun?: boolean }) => {
    await cmdRun(task, options.dir, options.dryRun)
  })

program
  .command('init')
  .description('Initialize a crew.md in the current directory')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .option('--force', 'Overwrite existing crew.md')
  .action(async (options: { dir: string; force?: boolean }) => {
    await cmdInit(options.dir, options.force ?? false)
  })

program
  .command('status')
  .description('Show the latest session status')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .action(async (options: { dir: string }) => {
    await cmdStatus(options.dir)
  })

program
  .command('history')
  .description('Show past sessions')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .option('--limit <n>', 'Number of sessions to show', '10')
  .action(async (options: { dir: string; limit: string }) => {
    await cmdHistory(options.dir, parseInt(options.limit, 10))
  })

// ─── Entry point ──────────────────────────────────────────────────────────────

if (process.argv.length <= 2) {
  await startInteractiveMode()
} else {
  await program.parseAsync(process.argv)
}
