#!/usr/bin/env bun
import { Command } from 'commander'
import { join } from 'path'
import { createElement } from 'react'
import { render } from 'ink'
import { loadConfig, ConfigError } from '@openrelay/config'
import { MessageBus } from '@openrelay/core'
import { createAdapter } from '@openrelay/adapters'
import { SessionManager } from '@openrelay/planner'
import { Dashboard } from '@openrelay/tui'

const program = new Command()

program
  .name('openrelay')
  .description('Multi-agent orchestration for terminal AI agents')
  .version('0.1.0')

program
  .command('run <task>', { isDefault: true })
  .description('Run a task with the agent crew defined in crew.md')
  .option('-d, --dir <path>', 'Project directory', process.cwd())
  .option('--dry-run', 'Show plan without executing')
  .action(async (task: string, options: { dir: string; dryRun?: boolean }) => {
    let config
    try {
      config = loadConfig(options.dir)
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

    if (options.dryRun) {
      console.log('[openrelay] Dry run — stopping before execution')
      return
    }

    const plannerConfig = config.agents.find(a => a.role === 'planner')
    if (!plannerConfig) {
      console.error('[openrelay] No agent with role "planner" found in crew.md')
      process.exit(1)
    }

    const bus = new MessageBus(join(options.dir, '.openrelay', 'session.db'))
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
  })

program
  .command('init')
  .description('Initialize a crew.md in the current directory')
  .action(() => {
    console.log('[openrelay] init — Phase 7')
  })

program
  .command('status')
  .description('Show the active session status')
  .action(() => {
    console.log('[openrelay] status — Phase 7')
  })

program
  .command('history')
  .description('Show past sessions')
  .action(() => {
    console.log('[openrelay] history — Phase 7')
  })

await program.parseAsync(process.argv)
