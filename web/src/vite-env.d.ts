/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_COGNITIVE_LOOP?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
