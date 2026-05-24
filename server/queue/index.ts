import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { ENV } from '../_core/env';

export const connection = new IORedis(ENV.databaseUrl); // Adjust connection string as needed
export const tradingQueue = new Queue('trading-tasks', { connection });

export async function addTradingTask(name: string, data: any) {
  return await tradingQueue.add(name, data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 }
  });
}
