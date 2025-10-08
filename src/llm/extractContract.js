const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { extractAndStoreText } = require('../utils/textExtract');
const { buildUserPrompt } = require('./promptBuilders');
const { runExtractionCall } = require('./callOpenAI');
const { getModelConfig } = require('./openaiClient');

const prisma = new PrismaClient();

/**
 * Validate and coerce extracted JSON data
 * @param {Object} data - Raw extracted data
 * @returns {Object} Validated and coerced data
 */
function validateAndCoerceData(data) {
  // Ensure required fields exist
  const validated = {
    document_type: data.document_type || null,
    parties: Array.isArray(data.parties) ? data.parties : [],
    effective_date: coerceDate(data.effective_date),
    renewal_date: coerceDate(data.renewal_date),
    term: coerceNullableString(data.term),
    termination_clauses: Array.isArray(data.termination_clauses) ? data.termination_clauses : [],
    governing_law: coerceNullableString(data.governing_law),
    key_obligations: Array.isArray(data.key_obligations) ? data.key_obligations : [],
    financial_terms: data.financial_terms || null,
    summary: coerceNullableString(data.summary),
    confidence_score: coerceConfidenceScore(data.confidence_score),
    notes: coerceNullableString(data.notes),
  };

  return validated;
}

/**
 * Coerce date to YYYY-MM-DD format or null
 * @param {any} value - Date value to coerce
 * @returns {string|null} Formatted date or null
 */
function coerceDate(value) {
  if (!value || value === '') return null;
  
  // If already in YYYY-MM-DD format, return as is
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  
  // Try to parse and format
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

/**
 * Coerce string to null if empty
 * @param {any} value - String value to coerce
 * @returns {string|null} String or null
 */
function coerceNullableString(value) {
  if (!value || value === '' || value === 'null' || value === 'undefined') {
    return null;
  }
  return String(value);
}

/**
 * Coerce confidence score to 0-1 range
 * @param {any} value - Confidence score to coerce
 * @returns {number} Clamped confidence score
 */
function coerceConfidenceScore(value) {
  const score = parseFloat(value);
  if (isNaN(score)) return 0.5; // Default to medium confidence
  return Math.max(0, Math.min(1, score)); // Clamp to 0-1 range
}

/**
 * Estimate cost for OpenAI API call (rough approximation)
 * @param {string} model - Model name
 * @param {number} inputTokens - Estimated input tokens
 * @param {number} outputTokens - Estimated output tokens
 * @returns {number} Estimated cost in USD
 */
function estimateCallCost(model, inputTokens, outputTokens) {
  // Rough pricing for gpt-4o-mini (as of 2024)
  const inputCostPer1k = 0.00015; // $0.15 per 1K input tokens
  const outputCostPer1k = 0.0006; // $0.60 per 1K output tokens
  
  const inputCost = (inputTokens / 1000) * inputCostPer1k;
  const outputCost = (outputTokens / 1000) * outputCostPer1k;
  
  return inputCost + outputCost;
}

/**
 * Run LLM extraction for a job
 * @param {string} jobId - Job ID
 * @param {Object} fileMeta - File metadata { filename, mime, filePath }
 * @returns {Promise<Object>} Extracted and validated data
 */
async function runLlmForJob(jobId, fileMeta) {
  const { filename, mime, filePath } = fileMeta;
  
  try {
    console.log(`🚀 Starting LLM extraction for job ${jobId}: ${filename}`);
    
    // Step 1: Extract plain text and store
    console.log('📄 Extracting text from file...');
    const textResult = await extractAndStoreText(filePath, mime, jobId);
    const textPath = textResult.tempPath;
    
    // Step 2: Read system prompt
    console.log('📋 Loading system prompt...');
    const systemPromptPath = path.join(__dirname, 'prompts', 'system_contracts_analyst.txt');
    const systemText = fs.readFileSync(systemPromptPath, 'utf8').trim();
    
    // Step 3: Build user prompt
    console.log('🔨 Building user prompt...');
    const userText = buildUserPrompt({
      filename,
      text: textResult.text,
      maxChars: 12000
    });
    
    // Step 4: Make LLM call with retry logic
    console.log('🤖 Calling OpenAI API...');
    let rawResponse;
    let parsedData;
    let retryAttempted = false;
    
    try {
      rawResponse = await runExtractionCall({
        systemText,
        userText
      });
      
      // Try to parse JSON
      parsedData = JSON.parse(rawResponse);
      
    } catch (parseError) {
      if (!retryAttempted) {
        console.log('⚠️  Invalid JSON response, retrying with corrective prompt...');
        retryAttempted = true;
        
        // Step 5: Retry with corrective preface
        const correctiveUserText = `Previous output invalid. Return ONLY valid JSON per schema.\n\n${userText}`;
        
        rawResponse = await runExtractionCall({
          systemText,
          userText: correctiveUserText
        });
        
        parsedData = JSON.parse(rawResponse);
      } else {
        throw new Error(`Failed to parse JSON after retry: ${parseError.message}`);
      }
    }
    
    // Step 6: Validate and coerce data
    console.log('✅ Validating and coercing extracted data...');
    const validatedData = validateAndCoerceData(parsedData);
    
    // Step 7: Calculate confidence and review requirement
    const confidenceScore = validatedData.confidence_score;
    const requiresReview = confidenceScore < 0.65;
    
    // Step 8: Get model config for persistence
    const modelConfig = getModelConfig();
    
    // Estimate cost (rough approximation)
    const estimatedInputTokens = Math.ceil(userText.length / 4); // ~4 chars per token
    const estimatedOutputTokens = Math.ceil(rawResponse.length / 4);
    const estimatedCost = estimateCallCost(modelConfig.model, estimatedInputTokens, estimatedOutputTokens);
    
    // Step 9: Persist to database via Prisma
    console.log('💾 Persisting results to database...');
    const updatedJob = await prisma.job.update({
      where: { id: jobId },
      data: {
        extraction_json: validatedData,
        confidence_score: confidenceScore,
        requires_review: requiresReview,
        llm_provider: 'openai',
        llm_model: modelConfig.model,
        llm_raw_response: { raw: rawResponse },
        last_call_cost_estimate: estimatedCost,
        status: 'completed',
        text_path: textPath,
      },
    });
    
    console.log(`✅ Job ${jobId} completed successfully`);
    console.log(`📊 Confidence: ${confidenceScore}, Review required: ${requiresReview}`);
    console.log(`💰 Estimated cost: $${estimatedCost.toFixed(4)}`);
    
    return {
      extraction: validatedData,
      confidenceScore: confidenceScore,
      estimatedCost: estimatedCost
    };
    
  } catch (error) {
    console.error(`❌ LLM extraction failed for job ${jobId}:`, error.message);
    
    // Update job status to failed
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        llm_raw_response: { error: error.message },
      },
    });
    
    throw error;
  }
}

module.exports = {
  runLlmForJob,
  validateAndCoerceData,
  coerceDate,
  coerceNullableString,
  coerceConfidenceScore,
};