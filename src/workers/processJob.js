const { runLlmForJob } = require('../llm/extractContract');
const { PrismaClient } = require('@prisma/client');
const { extractAndStoreText } = require('../utils/textExtract');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

/**
 * Process a job through the complete extraction workflow
 * @param {Object} job - Job object from database
 * @returns {Promise<Object>} Processing result
 */
async function processJob(job) {
  const jobId = job.id;
  const filename = job.filename;
  
  try {
    // Update job status to processing
    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'processing' }
    });

    // Step 1: Text extraction (OCR phase)
    let textPath;
    let extractedText;
    
    // Check if we already have extracted text
    const currentJob = await prisma.job.findUnique({
      where: { id: jobId }
    });
    
    if (currentJob.text_path && fs.existsSync(currentJob.text_path)) {
      // Use existing extracted text
      textPath = currentJob.text_path;
      extractedText = fs.readFileSync(textPath, 'utf8');
      console.log(`OCR_START chars=${extractedText.length}`);
    } else {
      // Need to extract text from original file
      // This assumes the file path is stored or can be derived from job data
      const filePath = path.join(process.env.STORAGE_DIR || './storage', `${jobId}-${filename}`);
      
      if (!fs.existsSync(filePath)) {
        throw new Error(`Original file not found: ${filePath}`);
      }
      
      console.log(`OCR_START chars=0`);
      const textResult = await extractAndStoreText(filePath, 'application/pdf', jobId);
      textPath = textResult.tempPath;
      extractedText = textResult.text;
      
      // Update job with text path
      await prisma.job.update({
        where: { id: jobId },
        data: { text_path: textPath }
      });
    }
    
    console.log(`OCR_DONE`);
    
    // Step 2: LLM processing - get model info for logging
    const { getModelConfig } = require('../llm/openaiClient');
    const modelConfig = getModelConfig();
    console.log(`LLM_START model=${modelConfig.model}`);
    
    // Prepare file metadata for runLlmForJob
    const fileMeta = {
      filename: filename,
      mime: 'application/pdf', // Default, could be enhanced to detect actual MIME type
      filePath: textPath, // Use the text file path since we already extracted text
      text: extractedText // Pass the extracted text directly
    };
    
    // Call the LLM extraction function
    const extractionResult = await runLlmForJob(jobId, fileMeta);
    
    // Calculate token estimates for logging
    const estimatedInputTokens = Math.ceil((extractedText?.length || 0) / 4);
    const estimatedOutputTokens = Math.ceil((JSON.stringify(extractionResult.extraction || {})).length / 4);
    const totalTokens = estimatedInputTokens + estimatedOutputTokens;
    const estimatedCost = extractionResult.estimatedCost || 0;
    
    console.log(`LLM_DONE tokens~=${totalTokens}, cost~=$${estimatedCost.toFixed(4)}`);
    console.log(`JOB_DONE`);

    return {
      success: true,
      jobId: jobId,
      status: 'completed',
      extraction: extractionResult.extraction,
      confidenceScore: extractionResult.confidenceScore,
      estimatedCost: extractionResult.estimatedCost
    };
    
  } catch (error) {
    console.log(`JOB_FAILED err=${error.message}`);
    
    // Update job status to failed
    try {
      await prisma.job.update({
        where: { id: jobId },
        data: { 
          status: 'failed',
          extraction: JSON.stringify({ 
            error: error.message,
            timestamp: new Date().toISOString()
          })
        }
      });
    } catch (updateError) {
      console.error(`Failed to update job ${jobId} status to failed:`, updateError);
    }

    return {
      success: false,
      jobId: jobId,
      status: 'failed',
      error: error.message
    };
  }
}

/**
 * Process job with enhanced error handling and retry logic
 * @param {string} jobId - Job ID to process
 * @returns {Promise<Object>} Processing result
 */
async function processJobById(jobId) {
  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId }
    });
    
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }
    
    return await processJob(job);
    
  } catch (error) {
    console.error(`Failed to process job ${jobId}:`, error);
    throw error;
  } finally {
    // Ensure Prisma connection is properly handled
    // Note: Don't disconnect here as it might be used elsewhere
  }
}

module.exports = {
  processJob,
  processJobById
};