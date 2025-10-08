const { getOpenAI, getModelConfig } = require('./openaiClient');

/**
 * Run extraction call to OpenAI API
 * @param {Object} params - Parameters for the extraction call
 * @param {string} params.systemText - System prompt text
 * @param {string} params.userText - User prompt text with document content
 * @returns {Promise<string>} Raw text response from OpenAI
 */
async function runExtractionCall({ systemText, userText }) {
  try {
    const openai = getOpenAI();
    const config = getModelConfig();
    
    const response = await openai.chat.completions.create({
      model: config.model,
      messages: [
        { role: 'system', content: systemText },
        { role: 'user', content: userText }
      ],
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      response_format: { type: 'json_object' },
    });
    
    // Return the raw text content from the first choice
    return response.choices[0]?.message?.content || '';
    
  } catch (error) {
    console.error('OpenAI API call failed:', error.message);
    throw new Error(`OpenAI extraction failed: ${error.message}`);
  }
}

module.exports = {
  runExtractionCall,
};