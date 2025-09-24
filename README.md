# FirmFlow Backend

A Node.js + Express backend for document processing and contract extraction, built with JavaScript.

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ 
- npm
- PostgreSQL 12+ (local installation)

### Installation

1. **Clone and navigate to backend directory**
   ```bash
   cd firmflow-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Database setup**
   
   **Local PostgreSQL Setup**
   - Ensure PostgreSQL is running on your system
   - Create a database named `firmflow_dev`
   - Update `.env` with your PostgreSQL credentials

4. **Environment setup**
   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

5. **Run database migrations**
   ```bash
   npx prisma migrate dev
   ```

6. **Start development server**
   ```bash
   npm run dev
   ```

The server will start on `http://localhost:4000`

## 📋 Available Scripts

- `npm run dev` - Start development server with nodemon
- `npm start` - Start production server
- `npm run build` - Build info (placeholder)

### Database Scripts

- `npx prisma migrate dev` - Run database migrations
- `npx prisma generate` - Generate Prisma client
- `npx prisma studio` - Open Prisma Studio (database GUI)
- `node test-prisma.js` - Test Prisma database operations

## 🛠️ Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL with Prisma ORM
- **File Upload**: Multer
- **CORS**: Enabled for cross-origin requests
- **Logging**: Morgan middleware

## 📡 API Endpoints

### Health Check
```bash
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Upload Document
```bash
POST /api/upload
Content-Type: multipart/form-data
```

**cURL Example:**
```bash
curl -X POST http://localhost:4000/api/upload \
  -F "file=@contract.pdf"
```

**Response:**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "contract.pdf",
  "status": "processing",
  "message": "File uploaded successfully and processing started"
}
```

**Supported file types:**
- PDF (application/pdf)
- Word Documents (application/msword, .docx)
- Text files (text/plain)
- Max file size: 10MB

### Check Job Status
```bash
GET /api/status/:jobId
```

**cURL Example:**
```bash
curl http://localhost:4000/api/status/550e8400-e29b-41d4-a716-446655440000
```

**Response (Processing):**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "contract.pdf",
  "status": "processing",
  "created_at": "2024-01-15 10:30:00",
  "updated_at": "2024-01-15 10:30:00"
}
```

**Response (Completed):**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "filename": "contract.pdf", 
  "status": "completed",
  "created_at": "2024-01-15 10:30:00",
  "updated_at": "2024-01-15 10:33:00",
  "extraction": {
    "document_type": "contract",
    "parties": [...],
    "contract_details": {...},
    "financial_terms": {...},
    "key_clauses": [...],
    "confidence_scores": {...}
  }
}
```

### Webhook Automation
```bash
POST /webhook/automation
Content-Type: application/json
```

**cURL Example:**
```bash
curl -X POST http://localhost:4000/webhook/automation \
  -H "Content-Type: application/json" \
  -d '{
    "event": "document_processed",
    "jobId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "completed"
  }'
```

**Response:**
```json
{
  "status": "received",
  "message": "Webhook processed successfully",
  "timestamp": "2024-01-15T10:35:00.000Z"
}
```

## 🗄️ Database Schema

The application uses PostgreSQL with Prisma ORM. The schema is defined in `prisma/schema.prisma`.

### Jobs Table
```prisma
model Job {
  id         Int      @id @default(autoincrement())
  filename   String
  status     String   @default("pending")
  extraction Json?
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  @@map("jobs")
}
```

### Webhooks Table
```prisma
model Webhook {
  id        Int      @id @default(autoincrement())
  payload   Json
  createdAt DateTime @default(now()) @map("created_at")

  @@map("webhooks")
}
```

### Database Setup

The application uses PostgreSQL with Prisma ORM for data persistence.

1. **Set up PostgreSQL database**:
   ```bash
   # Install PostgreSQL locally and create database
   createdb firmflow_db
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

3. **Run database migrations**:
   ```bash
   npx prisma migrate dev
   ```

4. **Generate Prisma client**:
   ```bash
   npx prisma generate
   ```

5. **Test database operations**:
   ```bash
   node test-prisma.js
   ```

## 📁 Project Structure

```
firmflow-backend/
├── src/
│   ├── index.js              # Main Express server
│   └── prisma-database.js    # Prisma database manager
├── prisma/
│   ├── schema.prisma         # Database schema definition
│   └── migrations/           # Database migration files
├── samples/
│   └── contract-extraction.json  # Sample extraction data
├── storage/                  # Uploaded files (auto-created)
├── test-prisma.js           # Database operations test script
├── .env                      # Environment variables
├── .env.example              # Environment template
├── package.json              # Dependencies and scripts
└── README.md                # This file
```

## 🔧 Configuration

Environment variables in `.env`:

```bash
# Server Configuration
PORT=4000
NODE_ENV=development

# Database Configuration
DATABASE_URL="postgresql://firmflow_user:firmflow_password@localhost:5432/firmflow_db"
POSTGRES_USER=firmflow_user
POSTGRES_PASSWORD=firmflow_password

# File Storage
STORAGE_DIR=./storage
```

### Database Setup Options

**Local PostgreSQL Setup**
- Install PostgreSQL on your system
- Create a database: `createdb firmflow_dev`
- Update `DATABASE_URL` in `.env`

## 🧪 Testing the API

### Complete workflow test:

1. **Check health**
   ```bash
   curl http://localhost:4000/health
   ```

2. **Upload a document**
   ```bash
   curl -X POST http://localhost:4000/api/upload \
     -F "file=@sample-contract.pdf"
   ```

3. **Check processing status** (use jobId from step 2)
   ```bash
   curl http://localhost:4000/api/status/YOUR_JOB_ID
   ```

4. **Test webhook**
   ```bash
   curl -X POST http://localhost:4000/webhook/automation \
     -H "Content-Type: application/json" \
     -d '{"event": "test", "data": "webhook test"}'
   ```

## 🔍 Mock Contract Extraction

The backend simulates contract extraction using realistic sample data from `samples/contract-extraction.json`. Processing takes 3-5 seconds to simulate real AI processing time.

**Extracted data includes:**
- Document parties and contact information
- Contract details (dates, terms, governing law)
- Financial terms (value, payment schedule, terms)
- Key clauses (termination, confidentiality, liability)
- Risk assessment and recommendations
- Confidence scores for extraction accuracy

## 🚨 Error Handling

The API includes comprehensive error handling:

- **400 Bad Request**: Invalid file type, missing file, file too large
- **404 Not Found**: Job ID not found, invalid routes
- **500 Internal Server Error**: Server errors, database issues

## 🔒 Security Features

- File type validation (PDF, DOC, DOCX, TXT only)
- File size limits (10MB max)
- CORS enabled for cross-origin requests
- Input sanitization and validation
- Graceful error handling
- **Redis-based rate limiting** with memory fallback

### Rate Limiting

The backend implements sophisticated rate limiting with Redis support for production environments:

#### Configuration

Rate limiting is configured via environment variables:

```bash
# Rate limiting driver (memory or redis)
RATE_LIMIT_DRIVER=memory

# Redis connection (required for redis driver)
REDIS_URL=redis://localhost:6379

# Rate limits
RATE_LIMIT_GENERAL_PER_MINUTE=60      # General requests per minute
RATE_LIMIT_USER_PER_MINUTE=3          # User uploads per minute  
RATE_LIMIT_USER_PER_HOUR=100          # User uploads per hour
```

#### Redis Setup (Production)

1. **Start Redis with Docker Compose**
   ```bash
   docker-compose up redis -d
   ```

2. **Update environment for Redis**
   ```bash
   RATE_LIMIT_DRIVER=redis
   REDIS_URL=redis://localhost:6379
   ```

3. **Restart the backend**
   ```bash
   npm start
   ```

#### Features

- **Dual Driver Support**: Memory (development) and Redis (production)
- **Automatic Fallback**: Falls back to memory if Redis is unavailable
- **Proper HTTP Headers**: Includes `X-RateLimit-*` and `Retry-After` headers
- **Comprehensive Logging**: Logs rate limit hits with user details
- **Per-User Limits**: Separate limits for authenticated users vs IP addresses

#### Rate Limit Responses

When rate limited, the API returns:

```json
{
  "error": "rate_limited",
  "message": "Rate limit exceeded", 
  "retryAfter": 45,
  "limit": 3,
  "remaining": 0,
  "resetTime": 1640995200000
}
```

**Headers:**
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining in current window
- `X-RateLimit-Reset`: When the rate limit resets (ISO timestamp)
- `Retry-After`: Seconds to wait before retrying

#### Testing Rate Limits

Run the specialized Redis rate limiting test:

```bash
node test/redis-rate-limit-test.js
```

This test validates:
- Redis driver functionality
- Memory driver fallback
- Proper 429 responses with headers
- Rate limit enforcement with upload endpoints

## 📊 Logging

- HTTP request logging via Morgan
- Console logging for job processing
- Webhook call logging
- Database operation logging

## 🛑 Graceful Shutdown

The server handles SIGINT and SIGTERM signals for graceful shutdown, ensuring:
- Database connections are closed properly
- In-flight requests are completed
- Resources are cleaned up

---

**FirmFlow Backend** - Built for efficient document processing and contract extraction.