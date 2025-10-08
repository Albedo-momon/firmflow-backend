// Prompt building utilities for LLM interactions

/**
 * Build user prompt for contract analysis
 * @param {Object} params - Parameters for building the prompt
 * @param {string} params.filename - Name of the file being analyzed
 * @param {string} params.text - Full text content of the document
 * @param {number} params.maxChars - Maximum characters to include (default: 12000)
 * @returns {string} Formatted user prompt for LLM
 */
function buildUserPrompt({ filename, text, maxChars = 12000 }) {
  // Truncate text to maxChars
  const truncatedText = text.length > maxChars ? text.substring(0, maxChars) : text;
  
  const prompt = `Extract structured data from this contract document and return ONLY a valid JSON object matching this exact schema:

{
  "document_type": "string or null",
  "parties": ["array of party names/entities"],
  "effective_date": "YYYY-MM-DD or null",
  "renewal_date": "YYYY-MM-DD or null", 
  "term": "string describing contract term or null",
  "termination_clauses": ["array of termination clause descriptions"],
  "governing_law": "string or null",
  "key_obligations": ["array of key obligation descriptions"],
  "financial_terms": {
    "currency": "string or null",
    "amount": "number or null",
    "payment_terms": "string or null"
  },
  "summary": "string summary of the contract or null",
  "confidence_score": 0.95,
  "notes": "string with any additional notes or null"
}

RULES:
- Return ONLY valid JSON, no commentary, no markdown, no code fences
- Use null for any unknown or missing values
- Dates must be in YYYY-MM-DD format or null
- confidence_score must be a number between 0 and 1
- Arrays can be empty [] if no items found

FILENAME: ${filename}
CHAR_LENGTH: ${truncatedText.length}

TEXT:
${truncatedText}`;

  return prompt;
}

module.exports = {
  buildUserPrompt
};