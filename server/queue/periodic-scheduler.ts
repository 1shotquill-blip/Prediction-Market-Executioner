import { addTradingTask } from './index';

// Schedule report generation daily at midnight (or configured interval)
export async function schedulePeriodicReports() {
  await addTradingTask('generate-alpha-feed', { timestamp: Date.now() });
  // Set up recurring logic via BullMQ repeat options
}
