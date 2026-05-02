#!/usr/bin/env bun
import { Command } from 'commander'

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
    console.log(`[openrelay] Task received: ${task}`)
    console.log(`[openrelay] Project dir:   ${options.dir}`)
    if (options.dryRun) console.log('[openrelay] Dry run mode — not executing')
    // Phase 5: SessionManager.start(task, config, options)
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
