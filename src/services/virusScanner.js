const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class VirusScanner {
  constructor() {
    this.enabled = process.env.VIRUS_SCAN_ENABLED === 'true';
    this.clamavHost = process.env.CLAMAV_HOST || 'localhost';
    this.clamavPort = process.env.CLAMAV_PORT || 3310;
    
    if (this.enabled) {
      console.log('🦠 Virus scanning enabled');
    } else {
      console.log('⚠️  Virus scanning disabled');
    }
  }

  /**
   * Scan a file for viruses
   * @param {string} filePath - Path to the file to scan
   * @returns {Promise<{clean: boolean, threat?: string, error?: string}>}
   */
  async scanFile(filePath) {
    if (!this.enabled) {
      return { clean: true };
    }

    try {
      // Try clamdscan first (daemon), fallback to clamscan
      let result;
      try {
        result = await this.scanWithClamdscan(filePath);
      } catch (daemonError) {
        console.warn('ClamAV daemon not available, trying direct scan:', daemonError.message);
        result = await this.scanWithClamscan(filePath);
      }

      return result;
    } catch (error) {
      console.error('Virus scan error:', error);
      return {
        clean: false,
        error: `Virus scan failed: ${error.message}`
      };
    }
  }

  /**
   * Scan using clamdscan (ClamAV daemon)
   */
  async scanWithClamdscan(filePath) {
    try {
      const { stdout, stderr } = await execAsync(`clamdscan --no-summary "${filePath}"`);
      
      if (stdout.includes('FOUND')) {
        const threatMatch = stdout.match(/: (.+) FOUND/);
        const threat = threatMatch ? threatMatch[1] : 'Unknown threat';
        return { clean: false, threat };
      }
      
      return { clean: true };
    } catch (error) {
      // clamdscan returns exit code 1 for infected files
      if (error.code === 1 && error.stdout && error.stdout.includes('FOUND')) {
        const threatMatch = error.stdout.match(/: (.+) FOUND/);
        const threat = threatMatch ? threatMatch[1] : 'Unknown threat';
        return { clean: false, threat };
      }
      throw error;
    }
  }

  /**
   * Scan using clamscan (direct scan)
   */
  async scanWithClamscan(filePath) {
    try {
      const { stdout, stderr } = await execAsync(`clamscan --no-summary "${filePath}"`);
      
      if (stdout.includes('FOUND')) {
        const threatMatch = stdout.match(/: (.+) FOUND/);
        const threat = threatMatch ? threatMatch[1] : 'Unknown threat';
        return { clean: false, threat };
      }
      
      return { clean: true };
    } catch (error) {
      // clamscan returns exit code 1 for infected files
      if (error.code === 1 && error.stdout && error.stdout.includes('FOUND')) {
        const threatMatch = error.stdout.match(/: (.+) FOUND/);
        const threat = threatMatch ? threatMatch[1] : 'Unknown threat';
        return { clean: false, threat };
      }
      throw error;
    }
  }

  /**
   * Scan file asynchronously and update job status
   * @param {string} filePath - Path to the file
   * @param {string} jobId - Job ID to update
   * @param {Object} db - Database instance
   */
  async scanFileAsync(filePath, jobId, db) {
    if (!this.enabled) {
      return;
    }

    try {
      console.log(`🦠 Starting virus scan for job ${jobId}`);
      const scanResult = await this.scanFile(filePath);
      
      if (!scanResult.clean) {
        console.warn(`🚨 Virus detected in job ${jobId}:`, scanResult.threat || scanResult.error);
        
        // Update job status to failed
        await db.updateJob(jobId, {
          status: 'failed',
          error_message: `File infected: ${scanResult.threat || scanResult.error}`,
          completed_at: new Date()
        });
        
        // Delete infected file
        const fs = require('fs');
        try {
          fs.unlinkSync(filePath);
          console.log(`🗑️  Deleted infected file: ${filePath}`);
        } catch (deleteError) {
          console.error('Error deleting infected file:', deleteError);
        }
        
        // Log security event
        const { logSecurityEvent } = require('../middleware/security');
        logSecurityEvent('virus_detected', {
          jobId,
          filePath,
          threat: scanResult.threat,
          action: 'file_deleted'
        });
        
      } else {
        console.log(`✅ File clean for job ${jobId}`);
      }
      
    } catch (error) {
      console.error(`Virus scan failed for job ${jobId}:`, error);
      
      // Update job with scan error but don't fail it completely
      await db.updateJob(jobId, {
        scan_status: 'error',
        scan_error: error.message
      });
    }
  }

  /**
   * Check if ClamAV is available
   */
  async checkAvailability() {
    if (!this.enabled) {
      return { available: false, reason: 'Virus scanning disabled' };
    }

    try {
      await execAsync('clamdscan --version');
      return { available: true };
    } catch (daemonError) {
      try {
        await execAsync('clamscan --version');
        return { available: true, note: 'Using direct scan (daemon not available)' };
      } catch (directError) {
        return { 
          available: false, 
          reason: 'ClamAV not installed or not in PATH',
          suggestion: 'Install ClamAV: apt-get install clamav clamav-daemon (Ubuntu) or brew install clamav (macOS)'
        };
      }
    }
  }
}

module.exports = VirusScanner;