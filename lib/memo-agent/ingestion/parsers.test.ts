import { describe, it, expect } from 'vitest'
import { parseVtt, parseSrt } from './parsers'

describe('parseVtt', () => {
  it('parses cues with voice tags', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:05.000
<v Jane Doe>Hello there, this is Jane.

00:00:05.500 --> 00:00:09.000
<v John Smith>Hi Jane, good to meet you.
`
    const turns = parseVtt(vtt)
    expect(turns).toHaveLength(2)
    expect(turns[0]).toEqual({
      speaker: 'Jane Doe',
      start_ms: 1000,
      end_ms: 5000,
      text: 'Hello there, this is Jane.',
    })
    expect(turns[1].speaker).toBe('John Smith')
    expect(turns[1].start_ms).toBe(5500)
  })

  it('parses cues without voice tags', () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
Just a line of dialogue.
`
    const turns = parseVtt(vtt)
    expect(turns).toHaveLength(1)
    expect(turns[0].speaker).toBeNull()
    expect(turns[0].text).toBe('Just a line of dialogue.')
  })

  it('handles hour-prefixed timestamps', () => {
    const vtt = `WEBVTT

01:02:03.500 --> 01:02:08.000
<v Speaker>Long meeting.
`
    const turns = parseVtt(vtt)
    expect(turns[0].start_ms).toBe(((1 * 3600) + (2 * 60) + 3) * 1000 + 500)
  })
})

describe('parseSrt', () => {
  it('parses numbered blocks with comma-separated millis', () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
Hello there.

2
00:00:04,500 --> 00:00:07,000
SPEAKER A: With a speaker prefix.
`
    const turns = parseSrt(srt)
    expect(turns).toHaveLength(2)
    expect(turns[0]).toEqual({
      speaker: null,
      start_ms: 1000,
      end_ms: 4000,
      text: 'Hello there.',
    })
    expect(turns[1].speaker).toBe('SPEAKER A')
    expect(turns[1].text).toBe('With a speaker prefix.')
  })

  it('ignores blocks without timing lines', () => {
    const srt = `garbage

1
00:00:01,000 --> 00:00:02,000
Valid cue.
`
    const turns = parseSrt(srt)
    expect(turns).toHaveLength(1)
    expect(turns[0].text).toBe('Valid cue.')
  })
})
