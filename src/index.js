const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const helmet = require('helmet');
require('dotenv').config();

const PrismaDatabaseManager = require('./prisma-database');
const { processJob, processJobById } = require('./workers/processJob');

// Import security middleware and services
const { 
  validateOrigin, 
  validateAuth: authenticateUser, 
  logSecurityEvent 
} = require('./middleware/security');
const { 
  createSecureUpload, 
  validateUploadedFile 
} = require('./middleware/fileValidation');

const {
  generalRateLimiter,
  combinedUploadRateLimiter
} = require('./middleware/rateLimitMiddleware');
const VirusScanner = require('./services/virusScanner');
const S3Service = require('./services/s3Service');
const UserQuotaService = require('./services/userQuota');

const app = express();
const PORT = process.env.PORT || 4000;
const STORAGE_DIR = process.env.STORAGE_DIR || './storage';
const MAX_FILE_SIZE = parseInt(process.env.UPLOAD_MAX_SIZE_BYTES) || 10485760; // 10MB default

// Initialize services
const db = new PrismaDatabaseManager();
const virusScanner = new VirusScanner();
const s3Service = new S3Service();
const quotaService = new UserQuotaService();

// Initialize rate limiters
const uploadRateLimiter = async (req, res, next) => {
  try {
    const rateLimiter = createRateLimiter('upload', 10, 60); // 10 uploads per minute
    await rateLimiter.consume(req.ip);
    next();
  } catch (rejRes) {
    res.status(429).json({
      error: 'Too many upload requests',
      message: 'Please wait before uploading again',
      retryAfter: Math.round(rejRes.msBeforeNext / 1000)
    });
  }
};

// Remove old rate limiting code - now handled by rateLimitMiddleware.js

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// Security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false
}));

// CORS configuration with origin validation
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : ['http://localhost:3000'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    logSecurityEvent('cors_violation', { origin, allowedOrigins });
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Apply general rate limiting to all routes
app.use(generalRateLimiter);

// Configure secure file upload
const upload = createSecureUpload(STORAGE_DIR);

// Mock contract extraction function
function simulateContractExtraction() {
  // Load sample extraction data
  const samplePath = path.join(__dirname, '..', 'samples', 'contract-extraction.json');
  try {
    const sampleData = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
    // Add some randomization to make it feel more realistic
    sampleData.extraction_timestamp = new Date().toISOString();
    sampleData.confidence_scores.overall_accuracy = 0.85 + Math.random() * 0.15;
    return sampleData;
  } catch (error) {
    console.error('Error loading sample extraction:', error);
    return {
      document_type: "contract",
      extraction_timestamp: new Date().toISOString(),
      status: "extracted",
      confidence_scores: { overall_accuracy: 0.92 }
    };
  }
}

// Routes

// Health check endpoint with service status
app.get('/health', generalRateLimiter, async (req, res) => {
  try {
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: { status: 'ok' },
        virusScanner: await virusScanner.checkAvailability(),
        s3: await s3Service.checkHealth(),
        quota: await quotaService.checkHealth()
      }
    };
    
    res.json(health);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Presigned upload endpoint (S3)
app.post('/api/presign', 
  validateOrigin,
  authenticateUser,
  uploadRateLimiter,
  async (req, res) => {
    try {
      if (!s3Service.enabled) {
        return res.status(400).json({
          error: 'Presigned uploads not enabled',
          message: 'Use /api/upload for direct uploads'
        });
      }

      const { filename, contentType, contentLength } = req.body;
      const userId = req.user.id;

      if (!filename || !contentType || !contentLength) {
        return res.status(400).json({
          error: 'Missing required fields',
          message: 'filename, contentType, and contentLength are required'
        });
      }

      // Check quota
      const quotaCheck = await quotaService.checkQuota(userId, contentLength);
      if (!quotaCheck.allowed) {
        return res.status(429).json({
          error: 'Quota exceeded',
          message: quotaCheck.reason,
          usage: quotaCheck.usage
        });
      }

      // Generate presigned URL
      const presignedData = await s3Service.generatePresignedUpload(
        userId, filename, contentType, contentLength
      );

      res.json({
        ...presignedData,
        message: 'Presigned URL generated successfully'
      });

    } catch (error) {
      console.error('Presign error:', error);
      logSecurityEvent('presign_error', { 
        userId: req.user?.id, 
        error: error.message 
      });
      
      res.status(500).json({
        error: 'Failed to generate presigned URL',
        message: error.message
      });
    }
  }
);

// Complete presigned upload
app.post('/api/complete',
  validateOrigin,
  authenticateUser,
  async (req, res) => {
    try {
      const { objectKey } = req.body;
      const userId = req.user.id;

      if (!objectKey) {
        return res.status(400).json({
          error: 'Missing objectKey',
          message: 'objectKey is required'
        });
      }

      // Verify object exists
      const objectInfo = await s3Service.checkObjectExists(objectKey);
      if (!objectInfo.exists) {
        return res.status(404).json({
          error: 'Object not found',
          message: 'Upload may have failed or expired'
        });
      }

      // Record usage
      await quotaService.recordUsage(userId, objectInfo.size);

      // Create job in database
      const job = await db.createJob(objectKey, 'processing');
      const jobId = job.id;

      // Start async processing
      setTimeout(async () => {
        try {
          // Download file for processing if needed
          const localPath = path.join(STORAGE_DIR, `${jobId}-${path.basename(objectKey)}`);
          await s3Service.downloadToLocal(objectKey, localPath);

          // Virus scan
          await virusScanner.scanFileAsync(localPath, jobId, db);

          // Process extraction
          const extractionData = simulateContractExtraction();
          await db.updateJobStatus(jobId, 'completed', JSON.stringify(extractionData));
          
          // Cleanup local file
          fs.unlinkSync(localPath);
          
          console.log(`✅ Job ${jobId} completed for S3 object: ${objectKey}`);
        } catch (error) {
          console.error(`❌ Job ${jobId} failed:`, error);
          await db.updateJobStatus(jobId, 'failed', JSON.stringify({ error: error.message }));
        }
      }, 3000 + Math.random() * 2000);

      res.json({
        jobId,
        objectKey,
        status: 'processing',
        message: 'Upload completed and processing started'
      });

    } catch (error) {
      console.error('Complete upload error:', error);
      res.status(500).json({
        error: 'Failed to complete upload',
        message: error.message
      });
    }
  }
);

// Multer error handling middleware
const handleMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(413).json({
          error: 'File too large',
          message: `File size exceeds the limit of ${MAX_FILE_SIZE / (1024 * 1024)}MB`
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          error: 'Too many files',
          message: 'Only one file is allowed per upload'
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          error: 'Unexpected field',
          message: 'File must be uploaded in the "file" field'
        });
      default:
        return res.status(400).json({
          error: 'Upload error',
          message: error.message
        });
    }
  }
  
  if (error.code === 'INVALID_FILE_TYPE') {
    return res.status(400).json({
      error: 'Invalid file type',
      message: error.message
    });
  }
  
  next(error);
};

// Upload endpoint (direct upload)
app.post('/api/upload', 
  validateOrigin,
  authenticateUser,
  combinedUploadRateLimiter,
  upload.single('file'), 
  handleMulterError,
  validateUploadedFile,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ 
          error: 'No file uploaded',
          message: 'Please provide a file to upload'
        });
      }

      const userId = req.user.id;
      const filename = req.file.originalname;
      const filePath = req.file.path;
      const fileSize = req.file.size;

      // Check quota
      const quotaCheck = await quotaService.checkQuota(userId, fileSize);
      if (!quotaCheck.allowed) {
        // Delete uploaded file
        fs.unlinkSync(filePath);
        
        return res.status(429).json({
          error: 'Quota exceeded',
          message: quotaCheck.reason,
          usage: quotaCheck.usage
        });
      }

      // Record usage
      await quotaService.recordUsage(userId, fileSize);

      // Create job in database
      const job = await db.createJob(filename, 'processing');
      const jobId = job.id;

      // Start async processing with real LLM extraction
      setImmediate(async () => {
        try {
          // Virus scan first
          await virusScanner.scanFileAsync(filePath, jobId, db);

          // Process with real LLM extraction
          console.log(`🚀 Starting processJob for ${jobId}`);
          const result = await processJob(job);
          
          if (result.success) {
            console.log(`✅ Job ${jobId} completed successfully`);
          } else {
            console.error(`❌ Job ${jobId} failed: ${result.error}`);
          }
        } catch (error) {
          console.error(`❌ Job ${jobId} processing failed:`, error);
          await db.updateJobStatus(jobId, 'failed', JSON.stringify({ error: error.message }));
        }
      });

      res.json({
        jobId,
        filename,
        status: 'processing',
        message: 'File uploaded successfully and processing started',
        usage: quotaCheck.usage
      });

    } catch (error) {
      console.error('Upload error:', error);
      
      // Clean up file if it exists
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (cleanupError) {
          console.error('Error cleaning up file:', cleanupError);
        }
      }
      
      res.status(500).json({ 
        error: 'Upload failed',
        message: error.message 
      });
    }
  }
);

// Status check endpoint
app.get('/api/status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await db.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
        message: `No job found with ID: ${jobId}`
      });
    }

    const response = {
      jobId: job.id,
      filename: job.filename,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    };

    // Include extraction data if completed
    if (job.status === 'completed' && job.extraction) {
      try {
        response.extraction = JSON.parse(job.extraction);
      } catch (error) {
        console.error('Error parsing extraction data:', error);
        response.extraction = { error: 'Failed to parse extraction data' };
      }
    }

    // Include error details if failed
    if (job.status === 'failed' && job.extraction) {
      try {
        response.error_details = JSON.parse(job.extraction);
      } catch (error) {
        response.error_details = { error: 'Failed to parse error details' };
      }
    }

    // Disable caching to prevent 304 responses
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    res.json(response);

  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({ 
      error: 'Status check failed',
      message: error.message 
    });
  }
});

// Dev-only endpoint to force re-process a job
app.post('/api/force-process/:jobId', async (req, res) => {
  // Only allow in development mode
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Endpoint not available in production' });
  }

  try {
    const { jobId } = req.params;
    
    console.log(`🔄 Force processing requested for job: ${jobId}`);
    
    // Check if job exists
    const job = await db.getJob(jobId);
    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
        message: `No job found with ID: ${jobId}`
      });
    }

    // Reset job status to processing
    await db.updateJobStatus(jobId, 'processing', null);
    
    // Start processing immediately
    setImmediate(async () => {
      try {
        console.log(`🚀 Force processing job ${jobId}`);
        const result = await processJobById(jobId);
        
        if (result.success) {
          console.log(`✅ Force processing completed for job ${jobId}`);
        } else {
          console.error(`❌ Force processing failed for job ${jobId}: ${result.error}`);
        }
      } catch (error) {
        console.error(`❌ Force processing error for job ${jobId}:`, error);
        await db.updateJobStatus(jobId, 'failed', JSON.stringify({ 
          error: error.message,
          timestamp: new Date().toISOString(),
          source: 'force-process'
        }));
      }
    });

    res.json({
      message: 'Job re-processing started',
      jobId: jobId,
      status: 'processing'
    });

  } catch (error) {
    console.error('Force process error:', error);
    res.status(500).json({ 
      error: 'Force process failed',
      message: error.message 
    });
  }
});

// Webhook endpoint for automation
app.post('/webhook/automation', (req, res) => {
  try {
    const payload = req.body;
    
    // Log webhook call
    console.log('📥 Webhook received:', {
      timestamp: new Date().toISOString(),
      headers: req.headers,
      body: payload
    });

    // Persist webhook data
    db.logWebhook({
      headers: req.headers,
      body: payload,
      timestamp: new Date().toISOString()
    });

    // Respond with success
    res.json({
      status: 'received',
      message: 'Webhook processed successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ 
      error: 'Webhook processing failed',
      message: error.message 
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large',
        message: 'File size must be less than 10MB'
      });
    }
  }

  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.originalUrl} not found`
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server...');
  await db.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down server...');
  await db.close();
  process.exit(0);
});

// Start server
async function startServer() {
  try {
    // Initialize database connection
    await db.initialize();
    
    app.listen(PORT, () => {
      console.log(`🚀 FirmFlow Backend running on http://localhost:${PORT}`);
      console.log(`📁 Storage directory: ${STORAGE_DIR}`);
      console.log(`🗄️  Database: PostgreSQL via Prisma`);
      console.log('\n📋 Available endpoints:');
      console.log(`   GET  /health`);
      console.log(`   POST /api/upload`);
      console.log(`   GET  /api/status/:jobId`);
      console.log(`   POST /webhook/automation`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;