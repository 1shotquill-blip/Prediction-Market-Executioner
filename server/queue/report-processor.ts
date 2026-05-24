import { Worker } from 'bullmq';
import { generateAlphaReport } from '../intelligence/reports/alpha-reporter';
import { connection } from './index';

export const reportWorker = new Worker('reporting-tasks', async job => {
  if (job.name === 'generate-alpha-feed') {
    const report = await generateAlphaReport();
    console.info('[AlphaReport] Feed generated:', JSON.stringify(report.summary));
    // In production, this would upload to S3 or ship via webhook
  }
}, { connection });
