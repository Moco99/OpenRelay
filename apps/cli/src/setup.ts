import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import os from 'os'
import { execa } from 'execa'

const MCPS = [
  {
    id: 'playwright',
    name: 'Playwright (Browser Automation)',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-playwright'],
    env: {},
    instructions: 'No credentials required. Playwright will download browser binaries automatically on first run.',
  },
  {
    id: 'github',
    name: 'GitHub',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    instructions: 'Requires a GitHub Personal Access Token (classic). Generate one at https://github.com/settings/tokens.',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    command: 'npx',
    args: ['-y', '@supabase/mcp'],
    env: { SUPABASE_ACCESS_TOKEN: '' },
    instructions: 'Requires a Supabase Access Token. Generate one at https://supabase.com/dashboard/account/tokens.',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    command: 'npx',
    args: ['-y', '@vercel/mcp'],
    env: { VERCEL_ACCESS_TOKEN: '' },
    instructions: 'Requires a Vercel Access Token. Generate one at https://vercel.com/account/tokens.',
  },
  {
    id: 'context7',
    name: 'Context7',
    command: 'npx',
    args: ['-y', '@context7/mcp'],
    env: { CONTEXT7_API_KEY: '' },
    instructions: 'Requires a Context7 API Key. Check their documentation for details.',
  },
]

const CLIS = [
  { name: 'Claude Code', dir: '.claude', configFile: '.claude.json' },
  { name: 'Gemini CLI',  dir: '.gemini', configFile: 'mcp.json' },
  { name: 'Codex',       dir: '.codex',  configFile: 'mcp.json' },
  { name: 'OpenCode',    dir: '.opencode', configFile: 'mcp.json' },
]

export async function cmdSetup(rl: any) {
  rl.pause()
  try {
    console.log('\x1b[2J\x1b[0f') // clear screen
    console.log('\x1b[95m[openrelay]\x1b[0m Starting Setup Wizard for MCPs and ECC Skills...\n')

    const homeDir = os.homedir()
    const detectedClis = CLIS.filter(c => existsSync(join(homeDir, c.dir)))

    if (detectedClis.length === 0) {
      console.log('No supported CLIs (Claude Code, Gemini CLI, Codex, OpenCode) detected in your home directory.')
      console.log('Please run their respective initializations first.')
      return
    }

  console.log(`Detected CLIs: ${detectedClis.map(c => c.name).join(', ')}\n`)

  for (const cli of detectedClis) {
    console.log(`\x1b[95m===\x1b[0m Configuring ${cli.name} \x1b[95m===\x1b[0m`)
    
    // 1. Setup MCPs
    const configPath = join(homeDir, cli.dir, cli.configFile)
    let config: { mcpServers?: Record<string, any> } = {}
    
    if (existsSync(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, 'utf8'))
      } catch (e) {
        console.log(`  \x1b[31mError reading ${configPath}. Starting fresh.\x1b[0m`)
      }
    }
    if (!config.mcpServers) config.mcpServers = {}

    for (const mcp of MCPS) {
      if (config.mcpServers[mcp.id]) {
        console.log(`  \x1b[32m✔\x1b[0m MCP ${mcp.name} already installed.`)
      } else {
        console.log(`  \x1b[33m+\x1b[0m Installing MCP: ${mcp.name}`)
        config.mcpServers[mcp.id] = {
          command: mcp.command,
          args: mcp.args,
          env: mcp.env,
        }
        if (Object.keys(mcp.env).length > 0) {
          console.log(`    \x1b[36mNote:\x1b[0m ${mcp.instructions}`)
          console.log(`    (Added empty placeholder for environment variables. Please edit \x1b[35m${configPath}\x1b[0m to add your keys later)`)
        }
      }
    }

    writeFileSync(configPath, JSON.stringify(config, null, 2))
    console.log(`  Updated MCP config at ${configPath}`)

    // 2. Setup ECC Skills baseline
    const skillsDir = join(homeDir, cli.dir, 'skills')
    if (!existsSync(skillsDir)) mkdirSync(skillsDir, { recursive: true })

    const rulesFile = join(skillsDir, 'ecc-baseline.md')
    if (existsSync(rulesFile)) {
      console.log(`  \x1b[32m✔\x1b[0m ECC Skills already installed at ${rulesFile}.`)
    } else {
      console.log(`  \x1b[33m+\x1b[0m Downloading Everything Claude Code (ECC) baseline skills...`)
      try {
        // We use a placeholder URL for the ECC rules (could be a GitHub raw link or gist)
        const response = await fetch('https://raw.githubusercontent.com/anthropics/claude-code/main/README.md')
        if (!response.ok) throw new Error('Network response was not ok')
        const eccContent = await response.text()
        writeFileSync(rulesFile, eccContent)
        console.log(`  ECC baseline skills downloaded and written to ${rulesFile}`)
      } catch (e) {
        console.log(`  \x1b[31mFailed to download ECC skills from remote. Writing fallback rules.\x1b[0m`)
        const eccContent = `# ECC Baseline Skills\n\n- Prefer immutable updates over in-place mutation.\n- Keep functions small and files focused.\n- Validate user input at boundaries.\n- Never hardcode secrets.\n`
        writeFileSync(rulesFile, eccContent)
      }
    }
    
    console.log()
  }

  console.log('\x1b[92mSetup Complete!\x1b[0m')
  console.log('Remember to add your API keys to the config files mentioned above before running tasks.')
  console.log('Press any key to return to REPL...')
  
  // Wait for single keypress
  await new Promise<void>(resolve => {
    const onData = () => {
      process.stdin.removeListener('data', onData)
      resolve()
    }
    process.stdin.on('data', onData)
  })

  } finally {
    rl.resume()
  }
}
