export class ConfigError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(field ? `[${field}] ${message}` : message)
    this.name = 'ConfigError'
  }
}
