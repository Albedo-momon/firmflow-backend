const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

class S3Service {
  constructor() {
    this.enabled = process.env.ENABLE_PRESIGNED_UPLOADS === 'true';
    
    if (this.enabled) {
      this.s3 = new AWS.S3({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || 'us-east-1'
      });
      
      this.bucketName = process.env.S3_BUCKET_NAME;
      this.uploadPrefix = process.env.S3_UPLOAD_PREFIX || 'uploads';
      
      if (!this.bucketName) {
        console.error('❌ S3_BUCKET_NAME is required when ENABLE_PRESIGNED_UPLOADS=true');
        this.enabled = false;
      } else {
        console.log('☁️  S3 presigned uploads enabled');
      }
    } else {
      console.log('📁 Using local storage (S3 presigned uploads disabled)');
    }
  }

  /**
   * Generate presigned URL for file upload
   * @param {string} userId - User ID
   * @param {string} filename - Original filename
   * @param {string} contentType - MIME type
   * @param {number} contentLength - File size in bytes
   * @returns {Promise<{uploadUrl: string, objectKey: string, expiresIn: number}>}
   */
  async generatePresignedUpload(userId, filename, contentType, contentLength) {
    if (!this.enabled) {
      throw new Error('S3 presigned uploads not enabled');
    }

    // Sanitize filename
    const sanitizedFilename = filename
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .substring(0, 100);
    
    // Generate unique object key
    const objectKey = `${this.uploadPrefix}/${userId}/${uuidv4()}-${sanitizedFilename}`;
    
    const expiresIn = 300; // 5 minutes
    
    const params = {
      Bucket: this.bucketName,
      Key: objectKey,
      Expires: expiresIn,
      ContentType: contentType,
      ContentLength: contentLength,
      Conditions: [
        ['content-length-range', 1, parseInt(process.env.UPLOAD_MAX_SIZE_BYTES) || 10485760]
      ]
    };

    try {
      const uploadUrl = await this.s3.getSignedUrlPromise('putObject', params);
      
      return {
        uploadUrl,
        objectKey,
        expiresIn
      };
    } catch (error) {
      console.error('Error generating presigned URL:', error);
      throw new Error('Failed to generate upload URL');
    }
  }

  /**
   * Check if object exists in S3
   * @param {string} objectKey - S3 object key
   * @returns {Promise<{exists: boolean, size?: number, lastModified?: Date}>}
   */
  async checkObjectExists(objectKey) {
    if (!this.enabled) {
      throw new Error('S3 not enabled');
    }

    try {
      const params = {
        Bucket: this.bucketName,
        Key: objectKey
      };
      
      const result = await this.s3.headObject(params).promise();
      
      return {
        exists: true,
        size: result.ContentLength,
        lastModified: result.LastModified,
        contentType: result.ContentType
      };
    } catch (error) {
      if (error.code === 'NotFound') {
        return { exists: false };
      }
      throw error;
    }
  }

  /**
   * Get object metadata and generate download URL
   * @param {string} objectKey - S3 object key
   * @returns {Promise<{downloadUrl: string, metadata: Object}>}
   */
  async getObjectInfo(objectKey) {
    if (!this.enabled) {
      throw new Error('S3 not enabled');
    }

    const objectInfo = await this.checkObjectExists(objectKey);
    
    if (!objectInfo.exists) {
      throw new Error('Object not found');
    }

    const downloadUrl = await this.s3.getSignedUrlPromise('getObject', {
      Bucket: this.bucketName,
      Key: objectKey,
      Expires: 3600 // 1 hour
    });

    return {
      downloadUrl,
      metadata: {
        size: objectInfo.size,
        lastModified: objectInfo.lastModified,
        contentType: objectInfo.contentType
      }
    };
  }

  /**
   * Delete object from S3
   * @param {string} objectKey - S3 object key
   */
  async deleteObject(objectKey) {
    if (!this.enabled) {
      return;
    }

    try {
      await this.s3.deleteObject({
        Bucket: this.bucketName,
        Key: objectKey
      }).promise();
      
      console.log(`🗑️  Deleted S3 object: ${objectKey}`);
    } catch (error) {
      console.error('Error deleting S3 object:', error);
      throw error;
    }
  }

  /**
   * Copy file from S3 to local storage for processing
   * @param {string} objectKey - S3 object key
   * @param {string} localPath - Local file path
   */
  async downloadToLocal(objectKey, localPath) {
    if (!this.enabled) {
      throw new Error('S3 not enabled');
    }

    const fs = require('fs');
    const stream = fs.createWriteStream(localPath);
    
    const params = {
      Bucket: this.bucketName,
      Key: objectKey
    };

    return new Promise((resolve, reject) => {
      this.s3.getObject(params)
        .createReadStream()
        .pipe(stream)
        .on('error', reject)
        .on('close', resolve);
    });
  }

  /**
   * Check S3 service health
   */
  async checkHealth() {
    if (!this.enabled) {
      return { healthy: true, message: 'S3 disabled' };
    }

    try {
      await this.s3.headBucket({ Bucket: this.bucketName }).promise();
      return { healthy: true };
    } catch (error) {
      return { 
        healthy: false, 
        error: error.message,
        suggestion: 'Check AWS credentials and bucket permissions'
      };
    }
  }
}

module.exports = S3Service;