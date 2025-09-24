const { fileTypeFromBuffer } = require('file-type');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Magic bytes for file type validation
const MAGIC_BYTES = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46], // %PDF
  'application/msword': [0xD0, 0xCF, 0x11, 0xE0], // DOC (OLE2)
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [0x50, 0x4B, 0x03, 0x04], // DOCX (ZIP)
  'text/plain': null // Text files can have various encodings, skip magic byte check
};

/**
 * Validate file type using magic bytes
 */
const validateMagicBytes = async (filePath, declaredMimeType) => {
  try {
    const buffer = fs.readFileSync(filePath);
    const detectedType = await fileTypeFromBuffer(buffer);
    
    // For text files, we'll be more lenient
    if (declaredMimeType === 'text/plain') {
      // Check if it's actually a text file by trying to read as UTF-8
      try {
        const content = buffer.toString('utf-8');
        // Simple heuristic: if we can read it as UTF-8 and it doesn't contain too many null bytes
        const nullBytes = (content.match(/\0/g) || []).length;
        return nullBytes < content.length * 0.1; // Less than 10% null bytes
      } catch (e) {
        return false;
      }
    }
    
    // For binary files, check magic bytes
    if (detectedType) {
      const allowedMimes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ];
      
      return allowedMimes.includes(detectedType.mime);
    }
    
    // If file-type can't detect it, check manual magic bytes
    const expectedMagic = MAGIC_BYTES[declaredMimeType];
    if (expectedMagic && buffer.length >= expectedMagic.length) {
      return expectedMagic.every((byte, index) => buffer[index] === byte);
    }
    
    return false;
  } catch (error) {
    console.error('Magic byte validation error:', error);
    return false;
  }
};

/**
 * Create multer configuration with security validations
 */
const createSecureUpload = (storageDir) => {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, storageDir);
    },
    filename: (req, file, cb) => {
      // Sanitize filename
      const sanitizedName = file.originalname
        .replace(/[^a-zA-Z0-9.-]/g, '_')
        .substring(0, 100); // Limit filename length
      
      const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}-${sanitizedName}`;
      cb(null, uniqueName);
    }
  });

  const fileFilter = (req, file, cb) => {
    const config = req.uploadConfig || {};
    const allowedMimes = config.allowedMimes || [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ];

    if (!allowedMimes.includes(file.mimetype)) {
      const error = new Error(`Invalid file type. Allowed types: ${allowedMimes.join(', ')}`);
      error.code = 'INVALID_FILE_TYPE';
      return cb(error, false);
    }

    cb(null, true);
  };

  return multer({
    storage,
    fileFilter,
    limits: {
      fileSize: parseInt(process.env.UPLOAD_MAX_SIZE_BYTES) || 10485760, // 10MB default
      files: 1 // Only allow single file upload
    }
  });
};

/**
 * Middleware to validate uploaded file after multer processing
 */
const validateUploadedFile = async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      error: 'no_file_uploaded',
      message: 'Please provide a file to upload'
    });
  }

  try {
    // Validate magic bytes
    const isValidFile = await validateMagicBytes(req.file.path, req.file.mimetype);
    
    if (!isValidFile) {
      // Delete the invalid file
      try {
        fs.unlinkSync(req.file.path);
      } catch (deleteError) {
        console.error('Error deleting invalid file:', deleteError);
      }
      
      return res.status(415).json({
        error: 'invalid_file_format',
        message: 'File content does not match declared file type'
      });
    }

    // Add file metadata to request
    req.fileMetadata = {
      originalName: req.file.originalname,
      filename: req.file.filename,
      path: req.file.path,
      size: req.file.size,
      mimeType: req.file.mimetype,
      uploadedAt: new Date().toISOString(),
      userId: req.userId,
      origin: req.validatedOrigin,
      ip: req.ip
    };

    next();
  } catch (error) {
    console.error('File validation error:', error);
    
    // Clean up file on error
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (deleteError) {
        console.error('Error deleting file after validation error:', deleteError);
      }
    }
    
    return res.status(500).json({
      error: 'file_validation_failed',
      message: 'File validation failed'
    });
  }
};

/**
 * Error handler for multer errors
 */
const handleMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(413).json({
          error: 'file_too_large',
          message: `File size exceeds limit of ${Math.round((parseInt(process.env.UPLOAD_MAX_SIZE_BYTES) || 10485760) / 1024 / 1024)}MB`
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          error: 'too_many_files',
          message: 'Only one file allowed per upload'
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          error: 'unexpected_field',
          message: 'Unexpected file field'
        });
      default:
        return res.status(400).json({
          error: 'upload_error',
          message: error.message
        });
    }
  }
  
  if (error.code === 'INVALID_FILE_TYPE') {
    return res.status(415).json({
      error: 'invalid_file_type',
      message: error.message
    });
  }
  
  next(error);
};

module.exports = {
  createSecureUpload,
  validateUploadedFile,
  handleMulterError,
  validateMagicBytes
};