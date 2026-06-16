/**
 * Regex-based parser for simple expense patterns (e.g., "5 coffee", "120 pork")
 * This avoids using AI/LLM for simple cases to save on API costs
 *
 * Foreign currency support added:
 *   - ISO code prefix:   "VND 50000 pho", "MYR 50 petrol"
 *   - Symbol prefix:     "₫50000 pho", "¥1200 ramen", "RM 50 petrol"
 *   - Suffix ISO code:   "50000 VND pho"
 *   - Comma amounts:     "VND 500,000 hotel" → 500000
 *   - Word aliases:      DONG → VND, RINGGIT → MYR
 */

export interface ParsedExpense {
  amount: number;
  description: string;
  category: string;
  currency: string;
}

const VALID_CATEGORIES = ['Food', 'Transport', 'Shopping', 'Groceries', 'Bills', 'Entertainment', 'Medical', 'Travel', 'Other'];

// Category inference keywords
const CATEGORY_KEYWORDS: { [key: string]: string } = {
  // Food
  'coffee': 'Food',
  'tea': 'Food',
  'lunch': 'Food',
  'dinner': 'Food',
  'breakfast': 'Food',
  'food': 'Food',
  'restaurant': 'Food',
  'cafe': 'Food',
  'chicken': 'Food',
  'pork': 'Food',
  'beef': 'Food',
  'rice': 'Food',
  'noodles': 'Food',
  'pizza': 'Food',
  'burger': 'Food',
  'sushi': 'Food',
  'mcdonald': 'Food',
  'kfc': 'Food',
  'starbucks': 'Food',
  'pho': 'Food',
  'ramen': 'Food',
  'grocery': 'Groceries',
  'groceries': 'Groceries',
  'supermarket': 'Groceries',
  'ntuc': 'Groceries',
  'cold storage': 'Groceries',
  
  // Transport
  'taxi': 'Transport',
  'grab': 'Transport',
  'uber': 'Transport',
  'bus': 'Transport',
  'mrt': 'Transport',
  'train': 'Transport',
  'transport': 'Transport',
  'fuel': 'Transport',
  'petrol': 'Transport',
  'parking': 'Transport',
  'grabcar': 'Transport',
  'grabhitch': 'Transport',
  
  // Shopping
  'shopping': 'Shopping',
  'clothes': 'Shopping',
  'shoes': 'Shopping',
  'shirt': 'Shopping',
  'pants': 'Shopping',
  'uniqlo': 'Shopping',
  'hm': 'Shopping',
  'zara': 'Shopping',
  
  // Bills
  'bills': 'Bills',
  'electricity': 'Bills',
  'water': 'Bills',
  'internet': 'Bills',
  'phone': 'Bills',
  'utilities': 'Bills',
  'utility': 'Bills',
  
  // Entertainment
  'movie': 'Entertainment',
  'cinema': 'Entertainment',
  'netflix': 'Entertainment',
  'spotify': 'Entertainment',
  'game': 'Entertainment',
  'games': 'Entertainment',
  'concert': 'Entertainment',
  
  // Medical
  'medicine': 'Medical',
  'pharmacy': 'Medical',
  'doctor': 'Medical',
  'hospital': 'Medical',
  'clinic': 'Medical',
  'medical': 'Medical',
  
  // Travel
  'hotel': 'Travel',
  'flight': 'Travel',
  'airplane': 'Travel',
  'travel': 'Travel',
  'vacation': 'Travel',
  'trip': 'Travel',
  'resort': 'Travel',
};

/**
 * Infer category from description keywords
 */
function inferCategory(description: string): string {
  const lowerDesc = description.toLowerCase().trim();
  
  // Check for exact matches first
  for (const [keyword, category] of Object.entries(CATEGORY_KEYWORDS)) {
    if (lowerDesc.includes(keyword)) {
      return category;
    }
  }
  
  // Default to "Other" if no match found
  return 'Other';
}

/** Normalize aliases and symbols to ISO 4217 codes */
function normalizeCurrency(raw: string): string {
  const upper = raw.toUpperCase();
  const aliases: Record<string, string> = {
    'RM': 'MYR',
    '₫': 'VND',
    '¥': 'JPY',
    'DONG': 'VND',
    'RINGGIT': 'MYR',
  };
  return aliases[upper] ?? upper;
}

/**
 * Parse simple expense patterns using regex
 *
 * Currency detection runs FIRST (before SGD number patterns).
 * Returns null if no pattern matches (triggers AI fallback).
 */
export function parseQuickExpense(text: string): ParsedExpense | null {
  const trimmed = text.trim();

  if (!trimmed || trimmed.length === 0) {
    return null;
  }

  // ── Currency patterns (checked BEFORE SGD patterns) ──────────────────────

  // Pattern C0: Symbol prefix without space — ₫50000, ¥1200, ¥ 1,200
  // Symbols: ₫ → VND, ¥ → JPY
  const symbolNoSpacePattern = /^([₫¥])\s*([\d,]+(?:\.\d{1,2})?)\s+(.+)$/;
  const symbolNoSpaceMatch = trimmed.match(symbolNoSpacePattern);
  if (symbolNoSpaceMatch) {
    const currency = normalizeCurrency(symbolNoSpaceMatch[1]);
    const amount = parseFloat(symbolNoSpaceMatch[2].replace(/,/g, ''));
    const description = symbolNoSpaceMatch[3].trim();
    if (amount > 0 && description.length > 0) {
      return { amount, description, category: inferCategory(description), currency };
    }
  }

  // Pattern C1: Word/ISO code prefix — "VND 50000 pho", "RM 50 petrol", "DONG 50000 pho"
  // Covers: ISO codes + aliases (RM, DONG, RINGGIT)
  const isoOrAliasPrefixPattern = /^(VND|MYR|THB|JPY|USD|IDR|HKD|AUD|GBP|EUR|TWD|RM|DONG|RINGGIT)\s+([\d,]+(?:\.\d{1,2})?)\s+(.+)$/i;
  const isoOrAliasPrefixMatch = trimmed.match(isoOrAliasPrefixPattern);
  if (isoOrAliasPrefixMatch) {
    const currency = normalizeCurrency(isoOrAliasPrefixMatch[1]);
    const amount = parseFloat(isoOrAliasPrefixMatch[2].replace(/,/g, ''));
    const description = isoOrAliasPrefixMatch[3].trim();
    if (amount > 0 && description.length > 0) {
      return { amount, description, category: inferCategory(description), currency };
    }
    // Matched pattern but bad data → return null (no description)
    return null;
  }

  // Pattern C2: Amount then ISO code suffix — "50000 VND pho"
  const isoPlusSuffixPattern = /^([\d,]+(?:\.\d{1,2})?)\s+(VND|MYR|THB|JPY|USD|IDR|HKD|AUD|GBP|EUR|TWD)\s+(.+)$/i;
  const isoPlusSuffixMatch = trimmed.match(isoPlusSuffixPattern);
  if (isoPlusSuffixMatch) {
    const currency = normalizeCurrency(isoPlusSuffixMatch[2]);
    const amount = parseFloat(isoPlusSuffixMatch[1].replace(/,/g, ''));
    const description = isoPlusSuffixMatch[3].trim();
    if (amount > 0 && description.length > 0) {
      return { amount, description, category: inferCategory(description), currency };
    }
  }

  // ── SGD patterns (original logic, extended with currency: 'SGD') ─────────

  // Pattern 1: Number first (e.g., "5 coffee", "120 pork", "5.50 lunch")
  // Matches: optional $, number (integer or decimal), whitespace, description (letters/numbers/spaces)
  const numberFirstPattern = /^(\$)?(\d+(?:\.\d{1,2})?)\s+(.+)$/i;
  const numberFirstMatch = trimmed.match(numberFirstPattern);
  
  if (numberFirstMatch) {
    const amount = parseFloat(numberFirstMatch[2]);
    const description = numberFirstMatch[3].trim();
    
    if (amount > 0 && amount <= 1000000 && description.length > 0) { // Reasonable limits for SGD
      return {
        amount,
        description,
        category: inferCategory(description),
        currency: 'SGD',
      };
    }
  }
  
  // Pattern 2: Description first (e.g., "coffee 5", "lunch 15.50")
  // Matches: description (letters/numbers/spaces), whitespace, optional $, number (integer or decimal)
  const descriptionFirstPattern = /^(.+?)\s+(\$)?(\d+(?:\.\d{1,2})?)$/i;
  const descriptionFirstMatch = trimmed.match(descriptionFirstPattern);
  
  if (descriptionFirstMatch) {
    const description = descriptionFirstMatch[1].trim();
    const amount = parseFloat(descriptionFirstMatch[3]);
    
    if (amount > 0 && amount <= 1000000 && description.length > 0) { // Reasonable limits for SGD
      // Check if description is actually just a number (false positive)
      if (!/^\d+(\.\d+)?$/.test(description)) {
        // Check if description is a bare currency code (e.g., "VND 50000" → description="VND")
        const KNOWN_CURRENCIES = /^(VND|MYR|THB|JPY|USD|IDR|HKD|AUD|GBP|EUR|TWD|SGD|RM|DONG|RINGGIT)$/i;
        if (KNOWN_CURRENCIES.test(description.trim())) {
          return null; // "VND 50000" — no description, not a valid expense
        }
        return {
          amount,
          description,
          category: inferCategory(description),
          currency: 'SGD',
        };
      }
    }
  }
  
  // No pattern matched - return null to use AI instead
  return null;
}
