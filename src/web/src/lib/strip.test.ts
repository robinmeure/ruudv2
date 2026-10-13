import { expect, it } from 'vitest'
import { classifyActivity, splitActivity } from './strip'

it('splits the timestamp from the activity text', () => {
  expect(splitActivity('10:01:02 Reading https://learn.microsoft.com')).toEqual({ time: '10:01:02', text: 'Reading https://learn.microsoft.com' })
  expect(splitActivity('no timestamp')).toEqual({ time: '', text: 'no timestamp' })
})

it('classifies reasoning, plan and result lines and drops their prefix', () => {
  expect(classifyActivity('Thinking: compare the slide with the update')).toEqual({ kind: 'thinking', text: 'compare the slide with the update' })
  expect(classifyActivity('Plan: Checking release status')).toEqual({ kind: 'plan', text: 'Checking release status' })
  expect(classifyActivity('Result: Searching Azure Updates (33 KB)')).toEqual({ kind: 'result', text: 'Searching Azure Updates (33 KB)' })
  expect(classifyActivity('Searching the web: basic ip')).toEqual({ kind: 'step', text: 'Searching the web: basic ip' })
})

it('keeps the prefix on problems so they read as errors', () => {
  expect(classifyActivity('Tool failed: timeout')).toEqual({ kind: 'problem', text: 'Tool failed: timeout' })
  expect(classifyActivity('Blocked: file write')).toEqual({ kind: 'problem', text: 'Blocked: file write' })
})
