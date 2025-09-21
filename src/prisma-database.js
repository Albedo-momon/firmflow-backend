const { PrismaClient } = require('@prisma/client');

class PrismaDatabaseManager {
  constructor() {
    this.prisma = new PrismaClient();
  }

  async initialize() {
    try {
      // Test the connection
      await this.prisma.$connect();
      console.log('✅ Connected to PostgreSQL database via Prisma');
    } catch (error) {
      console.error('❌ Failed to connect to PostgreSQL database:', error);
      throw error;
    }
  }

  async createJob(filename, status = 'pending', extraction = null) {
    try {
      const job = await this.prisma.job.create({
        data: {
          filename,
          status,
          extraction: extraction || null,
        },
      });
      return job;
    } catch (error) {
      console.error('Error creating job:', error);
      throw error;
    }
  }

  async getJob(id) {
    try {
      const job = await this.prisma.job.findUnique({
        where: { id: id },
      });
      return job;
    } catch (error) {
      console.error('Error getting job:', error);
      throw error;
    }
  }

  async updateJobStatus(id, status, extraction = null) {
    try {
      const updateData = { status };
      if (extraction !== null) {
        updateData.extraction = extraction;
      }

      const job = await this.prisma.job.update({
        where: { id: id },
        data: updateData,
      });
      return job;
    } catch (error) {
      console.error('Error updating job status:', error);
      throw error;
    }
  }

  async logWebhook(payload) {
    try {
      const webhook = await this.prisma.webhook.create({
        data: {
          payload,
        },
      });
      return webhook;
    } catch (error) {
      console.error('Error logging webhook:', error);
      throw error;
    }
  }

  async getAllJobs() {
    try {
      const jobs = await this.prisma.job.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return jobs;
    } catch (error) {
      console.error('Error getting all jobs:', error);
      throw error;
    }
  }

  async getAllWebhooks() {
    try {
      const webhooks = await this.prisma.webhook.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return webhooks;
    } catch (error) {
      console.error('Error getting all webhooks:', error);
      throw error;
    }
  }

  async close() {
    await this.prisma.$disconnect();
    console.log('🔌 Disconnected from PostgreSQL database');
  }
}

module.exports = PrismaDatabaseManager;