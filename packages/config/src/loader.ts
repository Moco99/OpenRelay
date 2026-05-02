import { parse } from 'smol-toml'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { validateRaw } from './validator.js'
import { ConfigError } from './errors.js'
import type { ProjectConfig } from '@openrelay/core'

export interface LoadConfigOptions {
  crewFile?: string                        // default: 'crew.md'
  checkCli?: (name: string) => boolean     // default: uses Bun.which
}

export function loadConfig(projectDir: string, options: LoadConfigOptions = {}): ProjectConfig {
  const crewFile = options.crewFile ?? 'crew.md'
  const checkCli = options.checkCli ?? ((name: string) => Bun.which(name) !== null)

  const filePath = join(projectDir, crewFile)
  if (!existsSync(filePath)) {
    throw new ConfigError(`crew.md not found at ${filePath}. Run "openrelay init" to create one.`)
  }

  const raw = readFileSync(filePath, 'utf-8')
  let parsed: unknown
  try {
    parsed = parse(raw)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new ConfigError(`Invalid TOML in ${crewFile}: ${msg}`)
  }

  const config = validateRaw(parsed, projectDir)

  // interpolate env vars and check cli tools after validation
  for (const agent of config.agents) {
    for (const [key, value] of Object.entries(agent.env)) {
      agent.env[key] = interpolateEnv(value)
    }
    if (agent.mode === 'cli' && agent.cli) {
      if (!checkCli(agent.cli)) {
        throw new ConfigError(
          `CLI tool "${agent.cli}" not found in PATH. Install it or check your $PATH.`,
          `agents[${agent.id}].cli`,
        )
      }
    }
  }

  return config
}

function interpolateEnv(value: string): string {
  return value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, name: string) => process.env[name] ?? '')
}
