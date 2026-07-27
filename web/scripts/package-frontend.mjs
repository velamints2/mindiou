import { cpSync, existsSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = resolve(webRoot, 'output')
const packageDir = resolve(outputRoot, 'mindiou-web-frontend')
const archive = resolve(outputRoot, 'mindiou-web-frontend.zip')

if (!existsSync(resolve(webRoot, 'dist/index.html'))) {
  throw new Error('dist/index.html 不存在，请先执行 npm run build')
}

mkdirSync(outputRoot, { recursive: true })
rmSync(packageDir, { recursive: true, force: true })
rmSync(archive, { force: true })
mkdirSync(packageDir, { recursive: true })

cpSync(resolve(webRoot, 'dist'), resolve(packageDir, 'public'), { recursive: true })
copyFileSync(resolve(webRoot, 'packaging/start.mjs'), resolve(packageDir, 'start.mjs'))
copyFileSync(resolve(webRoot, 'packaging/README.md'), resolve(packageDir, 'README.md'))
copyFileSync(resolve(webRoot, 'packaging/package.json'), resolve(packageDir, 'package.json'))

execFileSync('zip', ['-q', '-r', archive, 'mindiou-web-frontend'], { cwd: outputRoot })

console.log(packageDir)
console.log(archive)
