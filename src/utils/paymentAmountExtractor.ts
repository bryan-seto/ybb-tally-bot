/**
 * Payment Amount Extractor
 * Extracts payment amount from user input with clarification prompts for ambiguous cases
 */

export interface AmountExtractionResult {
  amount: number | null;
  needsClarification: boolean;
  reason?: string;
}

/**
 * Extract payment amount from user input text
 * Handles multiple numbers and tip keywords by prompting for clarification
 */
export function extractPaymentAmount(text: string): AmountExtractionResult {
  // Extract all numbers from text
  const numberMatches = text.match(/\d+(\.\d+)?/g);
  const numbers = numberMatches ? numberMatches.map(n => parseFloat(n)) : [];
  
  // Check for keywords that indicate tips or extras
  const hasTipKeyword = /\b(tip|extra|bonus|additional|gratuity)\b/i.test(text);
  const hasMultipleAmounts = /\b(and|plus|with|,)\b/i.test(text) && numbers.length > 1;
  
  // Scenario A: Multiple numbers detected
  if (numbers.length > 1 && !hasTipKeyword) {
    return {
      amount: null,
      needsClarification: true,
      reason: `I found multiple amounts: ${numbers.map(n => `$${n.toFixed(2)}`).join(', ')}. Which amount should I record?`
    };
  }
  
  // Scenario B: Keywords like 'tip' or 'extra' detected
  if (hasTipKeyword && numbers.length > 0) {
    const baseAmount = numbers[0];
    const tipAmount = numbers.length > 1 ? numbers[1] : null;
    
    if (tipAmount) {
      return {
        amount: null,
        needsClarification: true,
        reason: `I see you mentioned a tip. Do you want to pay $${baseAmount.toFixed(2)} (base amount) or $${(baseAmount + tipAmount).toFixed(2)} (including tip)? Please confirm the exact amount to record.`
      };
    } else {
      return {
        amount: null,
        needsClarification: true,
        reason: `I see you mentioned a tip. Do you want to pay $${baseAmount.toFixed(2)} (base amount) or a different amount? Please confirm the exact amount to record.`
      };
    }
  }
  
  // Scenario C: Single clear number
  if (numbers.length === 1) {
    const amount = numbers[0];
    
    // Validate amount is positive
    if (amount <= 0) {
      return {
        amount: null,
        needsClarification: true,
        reason: 'The amount must be greater than $0.00. Please enter a valid positive amount.'
      };
    }
    
    return {
      amount: amount,
      needsClarification: false
    };
  }
  
  // Scenario D: No valid number found
  return {
    amount: null,
    needsClarification: true,
    reason: `I couldn't find a valid amount in that message.\n\nPlease enter a number, like:\n• 30\n• $30\n• 30 dollars\n• 30.50`
  };
}

/**
 * Simple amount parser for cases where we just need to extract the first number
 * Used as fallback when clarification is not needed
 */
export function parseSimpleAmount(text: string): number | null {
  const match = text.match(/\d+(\.\d+)?/);
  if (match) {
    const amount = parseFloat(match[0]);
    return amount > 0 ? amount : null;
  }
  return null;
}
