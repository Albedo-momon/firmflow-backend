const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

async function testPrismaOperations() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🧪 Testing Prisma database operations...\n');
    
    // Connect to database
    await prisma.$connect();
    console.log('✅ Connected to PostgreSQL database');
    
    let allTestsPass = true;
  let testJob = null;
  
  // Test 1: Create a test job
  console.log('\n📋 Test 1: Creating a test job...');
  try {
    testJob = await prisma.job.create({
      data: {
        id: uuidv4(),
        filename: 'sample.pdf',
        status: 'pending',
        extraction: {
          contractType: 'Service Agreement',
          parties: ['Company A', 'Company B'],
          amount: 50000
        }
      }
    });
      
      console.log(`   ✅ Created job with ID: ${testJob.id}`);
      console.log(`   📄 Filename: ${testJob.filename}`);
      console.log(`   📊 Status: ${testJob.status}`);
    } catch (error) {
      console.log('   ❌ Failed to create job:', error.message);
      allTestsPass = false;
    }
    
    // Test 2: Read the job back
    console.log('\n📖 Test 2: Reading jobs...');
    try {
      const jobs = await prisma.job.findMany({
        where: { filename: 'sample.pdf' },
        orderBy: { createdAt: 'desc' }
      });
      
      if (jobs.length > 0) {
        console.log(`   ✅ Found ${jobs.length} test job(s)`);
        console.log(`   📄 Latest job: ${jobs[0].filename} (${jobs[0].status})`);
        
        // Test JSON extraction field
        if (jobs[0].extraction) {
          console.log(`   📊 Extraction data: ${JSON.stringify(jobs[0].extraction)}`);
        }
      } else {
        console.log('   ❌ No test jobs found');
        allTestsPass = false;
      }
    } catch (error) {
      console.log('   ❌ Failed to read jobs:', error.message);
      allTestsPass = false;
    }
    
    // Test 3: Update job status
    console.log('\n🔄 Test 3: Updating job status...');
    try {
      if (testJob) {
        const updatedJob = await prisma.job.update({
          where: { id: testJob.id },
          data: { 
            status: 'completed',
            extraction: {
              ...testJob.extraction,
              processingTime: '2.5 seconds',
              confidence: 0.95
            }
          }
        });
        
        console.log(`   ✅ Updated job ${updatedJob.id} to status: ${updatedJob.status}`);
      } else {
        console.log('   ❌ No test job found to update');
        allTestsPass = false;
      }
    } catch (error) {
      console.log('   ❌ Failed to update job:', error.message);
      allTestsPass = false;
    }
    
    // Test 4: Create a test webhook
    console.log('\n🪝 Test 4: Creating a test webhook...');
    try {
      const testWebhook = await prisma.webhook.create({
        data: {
          payload: {
            event: 'job.completed',
            jobId: testJob.id,
            timestamp: new Date().toISOString(),
            data: {
              filename: 'test-contract.pdf',
              status: 'completed'
            }
          }
        }
      });
      
      console.log(`   ✅ Created webhook with ID: ${testWebhook.id}`);
      console.log(`   📡 Event: ${testWebhook.payload.event}`);
    } catch (error) {
      console.log('   ❌ Failed to create webhook:', error.message);
      allTestsPass = false;
    }
    
    // Test 5: Read webhooks
    console.log('\n📡 Test 5: Reading webhooks...');
    try {
      const webhooks = await prisma.webhook.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5
      });
      
      console.log(`   ✅ Found ${webhooks.length} webhook(s)`);
      if (webhooks.length > 0) {
        console.log(`   📡 Latest webhook event: ${webhooks[0].payload?.event || 'unknown'}`);
      }
    } catch (error) {
      console.log('   ❌ Failed to read webhooks:', error.message);
      allTestsPass = false;
    }
    
    // Test 6: Complex query with filtering
    console.log('\n🔍 Test 6: Complex queries...');
    try {
      const completedJobs = await prisma.job.findMany({
        where: { status: 'completed' },
        select: {
          id: true,
          filename: true,
          status: true,
          createdAt: true
        }
      });
      
      console.log(`   ✅ Found ${completedJobs.length} completed job(s)`);
      
      // Test aggregation
      const jobStats = await prisma.job.groupBy({
        by: ['status'],
        _count: {
          status: true
        }
      });
      
      console.log('   📊 Job statistics by status:');
      jobStats.forEach(stat => {
        console.log(`      ${stat.status}: ${stat._count.status} jobs`);
      });
      
    } catch (error) {
      console.log('   ❌ Failed to execute complex queries:', error.message);
      allTestsPass = false;
    }
    
    // Test 7: Transaction test
    console.log('\n💳 Test 7: Transaction handling...');
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Create a job and webhook in a transaction
        const job = await tx.job.create({
          data: {
            id: uuidv4(),
            filename: 'transaction-test.pdf',
            status: 'processing'
          }
        });
        
        const webhook = await tx.webhook.create({
          data: {
            payload: {
              event: 'job.created',
              jobId: job.id,
              timestamp: new Date().toISOString()
            }
          }
        });
        
        return { job, webhook };
      });
      
      console.log(`   ✅ Transaction completed: Job ${result.job.id}, Webhook ${result.webhook.id}`);
    } catch (error) {
      console.log('   ❌ Transaction failed:', error.message);
      allTestsPass = false;
    }
    
    // Cleanup test data
    console.log('\n🧹 Cleaning up test data...');
    try {
      const deletedJobs = await prisma.job.deleteMany({
        where: {
          filename: {
            in: ['sample.pdf', 'test-contract.pdf', 'transaction-test.pdf']
          }
        }
      });
      
      const deletedWebhooks = await prisma.webhook.deleteMany({
        where: {
          payload: {
            path: ['event'],
            string_contains: 'job.'
          }
        }
      });
      
      console.log(`   ✅ Cleaned up ${deletedJobs.count} test jobs and ${deletedWebhooks.count} test webhooks`);
    } catch (error) {
      console.log('   ⚠️  Cleanup warning:', error.message);
    }
    
    // Close connection
    await prisma.$disconnect();
    
    // Final result
    console.log('\n' + '='.repeat(50));
    if (allTestsPass) {
      console.log('🎉 All Prisma tests PASSED!');
      console.log('✅ Database operations are working correctly');
    } else {
      console.log('❌ Some Prisma tests FAILED!');
      console.log('⚠️  Please check the database configuration and connection');
    }
    console.log('='.repeat(50));
    
    return allTestsPass;
    
  } catch (error) {
    console.error('❌ Test suite failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

// Run tests if called directly
if (require.main === module) {
  testPrismaOperations()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(console.error);
}

module.exports = { testPrismaOperations };