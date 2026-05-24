import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { ENV } from '../_core/env';

const connection = new IORedis(ENV.databaseUrl); // Assuming Redis/DB sharing or standard connection

export const worker = new Worker('trading-tasks', async job => {
  console.info(`[Queue] Processing ${job.name}: ${job.id}`);
  // Task logic dispatch
}, { connection });
