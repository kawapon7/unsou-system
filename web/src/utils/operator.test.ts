import { describe, it, expect } from 'vitest'
import { parseOperatorIds, isOperatorId } from './operator'

describe('parseOperatorIds', () => {
  it('カンマ区切りをtrimして配列にする', () => {
    expect(parseOperatorIds(' abc-1 , def-2 ')).toEqual(['abc-1', 'def-2'])
  })
  it('未設定(undefined)は空配列（fail-closed）', () => {
    expect(parseOperatorIds(undefined)).toEqual([])
  })
  it('空文字列は空配列', () => {
    expect(parseOperatorIds('')).toEqual([])
  })
})

describe('isOperatorId', () => {
  it('一致すればtrue', () => {
    expect(isOperatorId('abc-1', ['abc-1'])).toBe(true)
  })
  it('リストが空なら常にfalse', () => {
    expect(isOperatorId('abc-1', [])).toBe(false)
  })
  it('部分一致はfalse', () => {
    expect(isOperatorId('abc', ['abc-1'])).toBe(false)
  })
})
