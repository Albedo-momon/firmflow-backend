# FirmFlow Backend Security Features

This document outlines the comprehensive security and abuse protection features implemented in the FirmFlow backend.

## 🛡️ Security Features Overview

### 1. Origin/Referrer Validation
- **Server-side allowlist** of permitted origins
- Configurable via `ALLOWED_ORIGINS` environment variable
- Blocks requests from unauthorized domains
- CORS protection with credential support

### 2. Authentication & Authorization
- **JWT-based authentication** for all upload endpoints
- Configurable JWT secret via `JWT_SECRET`
- User identification for quota tracking and audit logs
- Middleware validates tokens on protected routes

### 3. Rate Limiting
- **Redis-backed rate limiting** with in-memory fallback
- **Per-user limits**: Configurable requests per minute/hour
- **Per-IP limits**: Global IP-based rate limiting
- Separate limits for upload vs general endpoints
- Automatic cleanup of expired rate limit data

### 4. File Upload Security
- **Magic header validation** - Validates actual file content, not just extensions
- **File size limits** - Configurable maximum upload size
- **MIME type filtering** - Only allows specified document types
- **Filename sanitization** - Prevents directory traversal attacks
- **Temporary file cleanup** - Automatic cleanup on errors

### 5. Virus Scanning
- **ClamAV integration** with configurable enable/disable
- **Asynchronous scanning** - Doesn't block upload response
- **Automatic file deletion** for infected files
- **Job status updates** when threats are detected
- Fallback handling when ClamAV is unavailable

### 6. User Quotas
- **Daily and monthly upload limits** per user
- **Redis-backed tracking** with in-memory fallback
- **Configurable limits** via environment variables
- **Usage reporting** in API responses
- **Admin quota reset** functionality

### 7. S3 Presigned Upload Support
- **Optional S3 integration** for scalable file storage
- **Presigned URL generation** with expiration
- **Upload completion verification**
- **Automatic local processing** after S3 upload
- **Configurable S3 settings**

### 8. Security Headers & Middleware
- **Helmet.js integration** for security headers
- **Request size limits** to prevent DoS
- **Error sanitization** - No sensitive data in error responses
- **Security event logging** for audit trails

## 🔧 Environment Configuration

### Required Environment Variables

```bash
# Security & Authentication
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com
JWT_SECRET=your-super-secret-jwt-key-here

# Upload Configuration
UPLOAD_MAX_SIZE_BYTES=10485760  # 10MB default
ALLOWED_MIME_TYPES=application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain

# Rate Limiting
RATE_LIMIT_USER_PER_MINUTE=10
RATE_LIMIT_USER_PER_HOUR=100
RATE_LIMIT_IP_PER_MINUTE=20
RATE_LIMIT_IP_PER_HOUR=200

# Redis Configuration
REDIS_URL=redis://localhost:6379
# If Redis is unavailable, the system falls back to in-memory storage

# User Quotas
USER_QUOTA_ENABLED=true
USER_DAILY_UPLOAD_LIMIT=100    # MB
USER_MONTHLY_UPLOAD_LIMIT=1000 # MB

# Virus Scanning
VIRUS_SCAN_ENABLED=true
CLAMAV_HOST=localhost
CLAMAV_PORT=3310

# S3 Presigned Uploads (Optional)
ENABLE_PRESIGNED_UPLOADS=false
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=us-east-1
S3_BUCKET_NAME=your-upload-bucket
S3_UPLOAD_PREFIX=uploads

# Storage
STORAGE_DIR=./storage
```

### Optional Environment Variables

```bash
# Development/Testing
NODE_ENV=production
PORT=4000

# Logging
LOG_LEVEL=info
ENABLE_SECURITY_LOGGING=true
```

## 🚀 Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and configure your settings:

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Set Up Redis (Recommended)

For production deployments, Redis is recommended for rate limiting and quota tracking:

```bash
# Ubuntu/Debian
sudo apt-get install redis-server

# macOS
brew install redis

# Docker
docker run -d -p 6379:6379 redis:alpine
```

### 4. Set Up ClamAV (Optional)

For virus scanning capabilities:

```bash
# Ubuntu/Debian
sudo apt-get install clamav clamav-daemon
sudo freshclam  # Update virus definitions
sudo systemctl start clamav-daemon

# macOS
brew install clamav
freshclam
clamd  # Start daemon

# Docker
docker run -d -p 3310:3310 clamav/clamav:stable
```

### 5. Configure S3 (Optional)

If using presigned uploads:

1. Create an S3 bucket
2. Set up IAM user with appropriate permissions
3. Configure AWS credentials in environment variables

### 6. Start the Server

```bash
npm start
```

## 🧪 Testing Security Features

Run the comprehensive security test suite:

```bash
# Install test dependencies
npm install --save-dev axios form-data

# Run security tests
node test/security-test.js

# Or with custom configuration
TEST_BASE_URL=http://localhost:4000 TEST_JWT=your-test-token node test/security-test.js
```

The test suite validates:
- ✅ CORS protection
- ✅ Rate limiting
- ✅ Authentication requirements
- ✅ File validation
- ✅ Security headers
- ✅ Error handling
- ✅ Quota enforcement

## 📊 API Endpoints

### Upload Endpoints

#### Direct Upload
```http
POST /api/upload
Authorization: Bearer <jwt-token>
Content-Type: multipart/form-data

file: <file-data>
```

#### Presigned Upload (S3)
```http
POST /api/presign
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "filename": "document.pdf",
  "contentType": "application/pdf",
  "contentLength": 1024000
}
```

#### Complete Presigned Upload
```http
POST /api/complete
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "objectKey": "uploads/user123/uuid-document.pdf"
}
```

### Status & Health

#### Health Check
```http
GET /health
```

Returns service status including security components.

#### Job Status
```http
GET /api/status/:jobId
```

## 🔍 Security Monitoring

### Security Events Logged

- CORS violations
- Authentication failures
- Rate limit violations
- File validation failures
- Virus detections
- Quota violations
- Upload errors

### Log Format

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "level": "warn",
  "event": "rate_limit_exceeded",
  "details": {
    "ip": "192.168.1.100",
    "userId": "user123",
    "endpoint": "/api/upload",
    "limit": "10/minute"
  }
}
```

## 🛠️ Troubleshooting

### Common Issues

#### 1. CORS Errors
- Verify `ALLOWED_ORIGINS` includes your frontend domain
- Check that requests include proper Origin header

#### 2. Rate Limiting Too Aggressive
- Adjust `RATE_LIMIT_*` environment variables
- Check Redis connectivity for persistent rate limiting

#### 3. File Upload Failures
- Verify file size is within `UPLOAD_MAX_SIZE_BYTES`
- Check that MIME type is in `ALLOWED_MIME_TYPES`
- Ensure storage directory has write permissions

#### 4. Virus Scanning Issues
- Set `VIRUS_SCAN_ENABLED=false` to disable
- Check ClamAV daemon is running: `sudo systemctl status clamav-daemon`
- Update virus definitions: `sudo freshclam`

#### 5. S3 Upload Problems
- Verify AWS credentials and permissions
- Check S3 bucket exists and is accessible
- Ensure `ENABLE_PRESIGNED_UPLOADS=true`

### Health Check Diagnostics

The `/health` endpoint provides detailed service status:

```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z",
  "services": {
    "database": { "status": "ok" },
    "virusScanner": { 
      "available": true,
      "note": "Using daemon"
    },
    "s3": { 
      "healthy": true 
    },
    "quota": { 
      "healthy": true,
      "storage": "redis"
    }
  }
}
```

## 🔒 Security Best Practices

1. **Use HTTPS in production** - Never transmit JWTs over HTTP
2. **Rotate JWT secrets regularly** - Update `JWT_SECRET` periodically
3. **Monitor rate limits** - Adjust based on legitimate usage patterns
4. **Keep ClamAV updated** - Run `freshclam` regularly
5. **Use Redis in production** - In-memory fallbacks reset on restart
6. **Set appropriate quotas** - Balance usability with resource protection
7. **Monitor security logs** - Set up alerting for security events
8. **Regular security testing** - Run the test suite in CI/CD

## 📈 Performance Considerations

- **Redis**: Significantly improves rate limiting and quota performance
- **S3 Presigned Uploads**: Reduces server load for large files
- **Async Processing**: Virus scanning doesn't block upload responses
- **File Cleanup**: Automatic cleanup prevents disk space issues
- **Connection Pooling**: Configure Redis connection pooling for high load

## 🆘 Support

For security-related issues or questions:

1. Check the troubleshooting section above
2. Run the security test suite to identify issues
3. Review security logs for specific error details
4. Ensure all environment variables are properly configured

Remember: Security is a layered approach. These features work together to provide comprehensive protection against common attack vectors and abuse patterns.