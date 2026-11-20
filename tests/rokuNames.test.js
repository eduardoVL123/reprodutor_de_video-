import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Guarda do app Roku: o BrighterScript troca, sem avisar, um nome local pelo valor de uma `const` do mesmo namespace
 * (maiúsculas não contam) e um nome local por uma função do namespace. Já aconteceu três vezes: `version` virou 6,
 * `ui.text()` virou a cor "0xF1F5F9FF" e o parâmetro `dir` virou "cachefs:/catalog" (testes gravando no catálogo real).
 */
function bsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return bsFiles(path)
    return path.endsWith('.bs') ? [path] : []
  })
}

/** Por namespace: nomes de const e de função, e nomes locais (parâmetros e atribuições) com o arquivo onde estão. */
function collect() {
  const spaces = new Map()
  const get = (ns) => {
    if (!spaces.has(ns)) spaces.set(ns, { consts: new Set(), functions: new Set(), locals: [] })
    return spaces.get(ns)
  }
  for (const file of bsFiles('roku')) {
    let ns = null
    let inClass = false // métodos de classe (m.metodo) não entram no namespace
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const code = line.replace(/'.*$/, '')
      const nsMatch = code.match(/^\s*namespace\s+([\w.]+)/i)
      if (nsMatch) ns = nsMatch[1].toLowerCase()
      if (/^\s*end\s+namespace/i.test(code)) ns = null
      if (/^\s*class\s+\w+/i.test(code)) inClass = true
      if (/^\s*end\s+class/i.test(code)) inClass = false
      if (!ns) continue
      const space = get(ns)
      const constMatch = code.match(/^\s*const\s+(\w+)/i)
      if (constMatch) space.consts.add(constMatch[1].toLowerCase())
      const fnMatch = code.match(/^\s*(?:(?:public|private|protected|override)\s+)*(?:function|sub)\s+(\w+)\s*\(([^)]*)\)/i)
      if (fnMatch) {
        if (!inClass) space.functions.add(fnMatch[1].toLowerCase())
        for (const param of fnMatch[2].split(',')) {
          const name = param.trim().split(/[\s=]/)[0]
          if (name) space.locals.push([name.toLowerCase(), file])
        }
      }
      const assign = code.match(/^\s*(\w+)\s*=(?!=)/)
      if (assign) space.locals.push([assign[1].toLowerCase(), file])
    }
  }
  return spaces
}

describe('app Roku — nomes que o BrighterScript troca sem avisar', () => {
  it('nenhuma variável ou parâmetro tem o nome de uma const ou função do mesmo namespace', () => {
    const clashes = []
    for (const [ns, { consts, functions, locals }] of collect()) {
      for (const [name, file] of locals) {
        if (consts.has(name)) clashes.push(`${file}: "${name}" é const de ${ns}`)
        else if (functions.has(name)) clashes.push(`${file}: "${name}" é função de ${ns}`)
      }
    }
    expect([...new Set(clashes)]).toEqual([])
  })

  it('nenhuma função tem o nome de uma const do mesmo namespace', () => {
    const clashes = []
    for (const [ns, { consts, functions }] of collect()) {
      for (const name of functions) if (consts.has(name)) clashes.push(`${ns}.${name}`)
    }
    expect(clashes).toEqual([])
  })
})
