#!/usr/bin/env bun
import { Command } from 'commander'
import { loadConfig, ConfigError } from '@openrelay/config'

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
  .action((task: string, options: { dir: string; dryRun?: boolean }) => {
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
    // Phase 5: SessionManager.start(task, config)
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
