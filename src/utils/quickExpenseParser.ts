/**
 * Regex-based parser for simple expense patterns (e.g., "5 coffee", "120 pork")
 * This avoids using AI/LLM for simple cases to save on API costs
 */

export interface ParsedExpense {
  amount: number;
  description: string;
  category: string;
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

/**
 * Parse simple expense patterns using regex
 * Supports patterns like:
 * - "5 coffee" (number first)
 * - "120 pork" (number first)
 * - "coffee 5" (description first)
 * - "5.50 lunch" (decimal number)
 * 
 * Returns parsed expense if pattern matches, null otherwise
 */
export function parseQuickExpense(text: string): ParsedExpense | null {
  const trimmed = text.trim();
  
  if (!trimmed || trimmed.length === 0) {
    return null;
  }
  
  // Pattern 1: Number first (e.g., "5 coffee", "120 pork", "5.50 lunch")
  // Matches: optional $, number (integer or decimal), whitespace, description (letters/numbers/spaces)
  const numberFirstPattern = /^(\$)?(\d+(?:\.\d{1,2})?)\s+(.+)$/i;
  const numberFirstMatch = trimmed.match(numberFirstPattern);
  
  if (numberFirstMatch) {
    const amount = parseFloat(numberFirstMatch[2]);
    const description = numberFirstMatch[3].trim();
    
    if (amount > 0 && amount <= 1000000 && description.length > 0) { // Reasonable limits
      return {
        amount,
        description,
        category: inferCategory(description)
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
    
    if (amount > 0 && amount <= 1000000 && description.length > 0) { // Reasonable limits
      // Check if description is actually just a number (false positive)
      if (!/^\d+(\.\d+)?$/.test(description)) {
        return {
          amount,
          description,
          category: inferCategory(description)
        };
      }
    }
  }
  
  // No pattern matched - return null to use AI instead
  return null;
}
