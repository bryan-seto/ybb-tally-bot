/**
 * TDD tests for parseMultipleExpenses — multi-line expense batch parsing.
 *
 * Covers:
 *  - Exact repro: "Baby store 11.86\nStella dresses 38.38" → 2 parsed
 *  - Mixed valid/invalid lines
 *  - CRLF line endings
 *  - Blank lines between entries
 *  - Single-line back-compat (still returns an array of 1)
 *  - FX lines mixed with SGD
 *  - All lines fail → empty parsed, all in failedLines
 *  - Empty string → empty result
 */

import { describe, it, expect } from 'vitest';
import { parseMultipleExpenses } from '../quickExpenseParser';

describe('parseMultipleExpenses', () => {

  // ── Exact production repro ──────────────────────────────────────────────
  it('exact repro: "Baby store 11.86\\nStella dresses 38.38" → 2 parsed, 0 failed', () => {
    const r = parseMultipleExpenses('Baby store 11.86\nStella dresses 38.38');
    expect(r.parsed).toHaveLength(2);
    expect(r.failedLines).toHaveLength(0);
    expect(r.parsed[0]).toMatchObject({ amount: 11.86, description: 'Baby store', currency: 'SGD' });
    expect(r.parsed[1]).toMatchObject({ amount: 38.38, description: 'Stella dresses', currency: 'SGD' });
  });

  // ── Mixed valid/invalid lines ───────────────────────────────────────────
  it('mixed: 2 valid + 1 unparseable → 2 parsed, 1 in failedLines', () => {
    const r = parseMultipleExpenses('coffee 5\ngibberish only words here\n10 grab');
    expect(r.parsed).toHaveLength(2);
    expect(r.failedLines).toEqual(['gibberish only words here']);
    expect(r.parsed[0]).toMatchObject({ amount: 5, description: 'coffee' });
    expect(r.parsed[1]).toMatchObject({ amount: 10, description: 'grab' });
  });

  // ── Line-ending variants ────────────────────────────────────────────────
  it('CRLF (\\r\\n) line endings are handled correctly', () => {
    const r = parseMultipleExpenses('Baby store 11.86\r\nStella dresses 38.38');
    expect(r.parsed).toHaveLength(2);
    expect(r.failedLines).toHaveLength(0);
  });

  it('blank lines between entries are silently ignored', () => {
    const r = parseMultipleExpenses('Baby store 11.86\n\nStella dresses 38.38\n');
    expect(r.parsed).toHaveLength(2);
    expect(r.failedLines).toHaveLength(0);
  });

  it('leading/trailing whitespace per line is trimmed', () => {
    const r = parseMultipleExpenses('  Baby store 11.86  \n  Stella dresses 38.38  ');
    expect(r.parsed).toHaveLength(2);
    expect(r.parsed[0]).toMatchObject({ description: 'Baby store', amount: 11.86 });
  });

  // ── Single-line back-compat ─────────────────────────────────────────────
  it('single line → array of length 1 (back-compat)', () => {
    const r = parseMultipleExpenses('coffee 5');
    expect(r.parsed).toHaveLength(1);
    expect(r.failedLines).toHaveLength(0);
    expect(r.parsed[0]).toMatchObject({ amount: 5, description: 'coffee', currency: 'SGD' });
  });

  it('number-first single line still works', () => {
    const r = parseMultipleExpenses('10 grab');
    expect(r.parsed).toHaveLength(1);
    expect(r.parsed[0]).toMatchObject({ amount: 10, description: 'grab', currency: 'SGD' });
  });

  // ── FX mixed with SGD ───────────────────────────────────────────────────
  it('FX line + SGD line in one message', () => {
    const r = parseMultipleExpenses('VND 50000 pho\nlunch 12');
    expect(r.parsed).toHaveLength(2);
    expect(r.failedLines).toHaveLength(0);
    expect(r.parsed[0]).toMatchObject({ amount: 50000, currency: 'VND', description: 'pho', category: 'Food' });
    expect(r.parsed[1]).toMatchObject({ amount: 12, currency: 'SGD', description: 'lunch', category: 'Food' });
  });

  it('three FX lines, all different currencies', () => {
    const r = parseMultipleExpenses('VND 50000 pho\nMYR 15 petrol\nAUD 8 coffee');
    expect(r.parsed).toHaveLength(3);
    expect(r.parsed[0].currency).toBe('VND');
    expect(r.parsed[1].currency).toBe('MYR');
    expect(r.parsed[2].currency).toBe('AUD');
  });

  // ── Edge cases ──────────────────────────────────────────────────────────
  it('all lines fail → 0 parsed, all in failedLines', () => {
    const r = parseMultipleExpenses('hello world\njust text no number');
    expect(r.parsed).toHaveLength(0);
    expect(r.failedLines).toHaveLength(2);
    expect(r.failedLines).toEqual(['hello world', 'just text no number']);
  });

  it('empty string → 0 parsed, 0 failed', () => {
    const r = parseMultipleExpenses('');
    expect(r.parsed).toHaveLength(0);
    expect(r.failedLines).toHaveLength(0);
  });

  it('only blank lines → 0 parsed, 0 failed', () => {
    const r = parseMultipleExpenses('\n\n\n');
    expect(r.parsed).toHaveLength(0);
    expect(r.failedLines).toHaveLength(0);
  });

  // ── Category inference survives multi-line ──────────────────────────────
  it('category is inferred correctly per line', () => {
    const r = parseMultipleExpenses('grab 5\ngroceries 30\nmovie 15');
    expect(r.parsed[0].category).toBe('Transport');
    expect(r.parsed[1].category).toBe('Groceries');
    expect(r.parsed[2].category).toBe('Entertainment');
  });

});
