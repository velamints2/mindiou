// vitest 的 happy-dom 环境注入会把 localStorage 的原型方法弄丢（getItem 等变 undefined），
// 这里用独立 Window 实例的 storage 补齐。
import { Window } from 'happy-dom'

const storage = (globalThis as { localStorage?: Storage }).localStorage
if (!storage || typeof storage.getItem !== 'function') {
  const win = new Window()
  ;(globalThis as { localStorage: Storage }).localStorage = win.localStorage
}
