const { OpenAI } = require('openai');

/**
 * Get configured OpenAI client instance
 * @returns {OpenAI} Configured OpenAI client
 */
function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }
  
  const config = getModelConfig();
  
  return new OpenAI({
    apiKey: apiKey,
    timeout: config.timeoutMs,
  });
}

/**
 * Get model configuration from environment variables
 * @returns {Object} Model configuration object
 */
function getModelConfig() {
  return {
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.1,
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS) || 4000,
    timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS) || 30000,
  };
}

module.exports = {
  getOpenAI,
  getModelConfig,
};