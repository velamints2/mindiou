// happy-dom 18 does not implement Web Storage; backfill a spec-compliant
// in-memory localStorage/sessionStorage so i18n/auth modules work in tests.
const memory = new Map<string, string>()

function storage(keyPrefix: string): Storage {
  return {
    get length(): number { return memory.size },
    clear(): void { memory.clear() },
    key(index: number): string | null { return [...memory.keys()][index] ?? null },
    getItem(key: string): string | null { return memory.get(`${keyPrefix}${key}`) ?? null },
    setItem(key: string, value: string): void { memory.set(`${keyPrefix}${key}`, String(value)) },
    removeItem(key: string): void { memory.delete(`${keyPrefix}${key}`) }
  } as Storage
}

const g = globalThis as unknown as Record<string, Storage | undefined>
if (!g.localStorage || typeof g.localStorage.getItem !== 'function') {
  g.localStorage = storage('local:')
}
if (!g.sessionStorage || typeof g.sessionStorage.getItem !== 'function') {
  g.sessionStorage = storage('session:')
}
