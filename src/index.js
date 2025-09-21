const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const PrismaDatabaseManager = require('./prisma-database');

const app = express();
const PORT = process.env.PORT || 4000;
const STORAGE_DIR = process.env.STORAGE_DIR || './storage';

// Initialize database
const db = new PrismaDatabaseManager();

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, STORAGE_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept common document formats
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, DOC, DOCX, and TXT files are allowed.'));
    }
  }
});

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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Upload endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        error: 'No file uploaded',
        message: 'Please provide a file to upload'
      });
    }

    const filename = req.file.originalname;

    // Create job in database
    const job = await db.createJob(filename, 'processing');
    const jobId = job.id;

    // Simulate async processing
    setTimeout(async () => {
      try {
        const extractionData = simulateContractExtraction();
        await db.updateJobStatus(jobId, 'completed', JSON.stringify(extractionData));
        console.log(`✅ Job ${jobId} completed for file: ${filename}`);
      } catch (error) {
        console.error(`❌ Job ${jobId} failed:`, error);
        await db.updateJobStatus(jobId, 'failed', JSON.stringify({ error: error.message }));
      }
    }, 3000 + Math.random() * 2000); // 3-5 seconds processing time

    res.json({
      jobId,
      filename,
      status: 'processing',
      message: 'File uploaded successfully and processing started'
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: 'Upload failed',
      message: error.message 
    });
  }
});

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