// Text extraction utilities for various document formats
const fs = require('fs').promises;
const path = require('path');
const { pdf } = require('pdf-parse');
const mammoth = require('mammoth');

/**
 * Extract plain text from various document formats
 * @param {string} filePath - Path to the file to extract text from
 * @param {string} mime - MIME type of the file
 * @returns {Promise<{text: string, charLength: number}>} Extracted text and character count
 */
async function extractPlainText(filePath, mime) {
  let text = '';
  
  try {
    if (mime === 'application/pdf' || filePath.toLowerCase().endsWith('.pdf')) {
      // Extract text from PDF using pdf-parse
      const dataBuffer = await fs.readFile(filePath);
      const data = await pdf(dataBuffer);
      text = data.text;
    } else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
               filePath.toLowerCase().endsWith('.docx')) {
      // Extract text from DOCX using mammoth
      const result = await mammoth.extractRawText({ path: filePath });
      text = result.value;
    } else if (mime === 'text/plain' || filePath.toLowerCase().endsWith('.txt')) {
      // Read plain text file
      text = await fs.readFile(filePath, 'utf8');
    } else {
      throw new Error(`Unsupported file type: ${mime}`);
    }
    
    // Normalize whitespace and trim
    text = text.replace(/\s+/g, ' ').trim();
    
    return {
      text,
      charLength: text.length
    };
  } catch (error) {
    throw new Error(`Failed to extract text from ${filePath}: ${error.message}`);
  }
}

/**
 * Extract text and save to temp storage for worker processing
 * @param {string} filePath - Path to the source file
 * @param {string} mime - MIME type of the file
 * @param {string} jobId - Job ID for temp file naming
 * @returns {Promise<{text: string, charLength: number, textPath: string}>} Extraction result with temp file path
 */
async function extractAndStoreText(filePath, mime, jobId) {
  // Extract the text
  const result = await extractPlainText(filePath, mime);
  
  // Create temp directory if it doesn't exist
  const tempDir = path.join(__dirname, '../../temp');
  try {
    await fs.access(tempDir);
  } catch {
    await fs.mkdir(tempDir, { recursive: true });
  }
  
  // Write text to temp file
  const textPath = path.join(tempDir, `${jobId}.txt`);
  await fs.writeFile(textPath, result.text, 'utf8');
  
  return {
    ...result,
    textPath
  };
}

module.exports = {
  extractPlainText,
  extractAndStoreText
};