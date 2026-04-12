/**
 * Safe arithmetic for accounting steps — no eval(), no arbitrary code.
 * Supports: + - * / parentheses, numbers, input.x / param.x / step.x, round2(), min(), max()
 */

import { round2 } from './money.js'

class ParseError extends Error {
  constructor(msg) {
    super(msg)
    this.name = 'ParseError'
  }
}

function tokenize(str) {
  const s = String(str || '').trim()
  const out = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === ' ' || c === '\t' || c === '\n') {
      i += 1
      continue
    }
    if ('+-*/(),.'.includes(c)) {
      out.push({ t: c })
      i += 1
      continue
    }
    if (c >= '0' && c <= '9') {
      let j = i
      while (j < s.length && (s[j] === '.' || (s[j] >= '0' && s[j] <= '9'))) j += 1
      out.push({ t: 'num', v: parseFloat(s.slice(i, j)) })
      i = j
      continue
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1
      while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j += 1
      out.push({ t: 'id', v: s.slice(i, j) })
      i = j
      continue
    }
    throw new ParseError(`حرف غير متوقع: ${c}`)
  }
  return out
}

class Parser {
  constructor(tokens, ctx) {
    this.tokens = tokens
    this.i = 0
    this.ctx = ctx
  }

  peek() {
    return this.tokens[this.i] ?? null
  }

  eat(expected) {
    const t = this.peek()
    if (!t || t.t !== expected) {
      throw new ParseError(`متوقع ${expected}`)
    }
    this.i += 1
    return t
  }

  parseExpr() {
    let left = this.parseTerm()
    while (true) {
      const t = this.peek()
      if (!t || (t.t !== '+' && t.t !== '-')) break
      this.i += 1
      const right = this.parseTerm()
      left = t.t === '+' ? left + right : left - right
    }
    return left
  }

  parseTerm() {
    let left = this.parseUnary()
    while (true) {
      const t = this.peek()
      if (!t || (t.t !== '*' && t.t !== '/')) break
      this.i += 1
      const right = this.parseUnary()
      if (t.t === '*') left = left * right
      else {
        if (right === 0) throw new ParseError('قسمة على صفر')
        left = left / right
      }
    }
    return left
  }

  parseUnary() {
    const t = this.peek()
    if (t?.t === '-') {
      this.i += 1
      return -this.parseUnary()
    }
    return this.parsePrimary()
  }

  resolveRef(ns, field) {
    const bag = this.ctx[ns]
    if (bag == null || typeof bag !== 'object') throw new ParseError(`مرجع غير معروف: ${ns}`)
    if (!(field in bag)) throw new ParseError(`حقل غير معروف: ${ns}.${field}`)
    const v = bag[field]
    const n = Number(v)
    if (!Number.isFinite(n)) throw new ParseError(`قيمة غير رقمية: ${ns}.${field}`)
    return n
  }

  parsePrimary() {
    const t = this.peek()
    if (!t) throw new ParseError('تعبير ناقص')

    if (t.t === 'num') {
      this.i += 1
      return t.v
    }

    if (t.t === '(') {
      this.eat('(')
      const inner = this.parseExpr()
      this.eat(')')
      return inner
    }

    if (t.t === 'id') {
      const name = t.v
      this.i += 1
      if (name === 'round2' || name === 'min' || name === 'max') {
        const lp = this.peek()
        if (!lp || lp.t !== '(') throw new ParseError(`متوقع ( بعد ${name}`)
        this.i += 1
        const a = this.parseExpr()
        if (name === 'round2') {
          const rp = this.peek()
          if (!rp || rp.t !== ')') throw new ParseError('متوقع )')
          this.i += 1
          return round2(a)
        }
        const c1 = this.peek()
        if (!c1 || c1.t !== ',') throw new ParseError('متوقع ,')
        this.i += 1
        const b = this.parseExpr()
        const rp = this.peek()
        if (!rp || rp.t !== ')') throw new ParseError('متوقع )')
        this.i += 1
        if (name === 'min') return Math.min(a, b)
        return Math.max(a, b)
      }

      if (name === 'input' || name === 'param' || name === 'step') {
        const dot = this.peek()
        if (!dot || dot.t !== '.') throw new ParseError('متوقع . بعد المرجع')
        this.i += 1
        const fieldTok = this.peek()
        if (!fieldTok || fieldTok.t !== 'id') throw new ParseError('متوقع اسم حقل بعد النقطة')
        const field = fieldTok.v
        this.i += 1
        return this.resolveRef(name, field)
      }

      throw new ParseError(`معرف غير مسموح: ${name}`)
    }

    throw new ParseError('تعبير غير صالح')
  }
}

/**
 * @param {string} expression
 * @param {{ input: Record<string, number>, param: Record<string, number>, step: Record<string, number> }} ctx
 */
export function evaluateExpression(expression, ctx) {
  const tokens = tokenize(expression)
  const p = new Parser(tokens, ctx)
  const v = p.parseExpr()
  if (p.peek() !== null) throw new ParseError('بقايا بعد نهاية التعبير')
  return v
}
