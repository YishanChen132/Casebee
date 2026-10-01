import {getGmailStatus, pollGmailMessages} from './gmailService.js';

let isPolling = false;

function isAutoPollEnabled() {
  return (process.env.GMAIL_AUTO_POLL_ENABLED ?? 'true').toLowerCase() !== 'false';
}

function pollIntervalMs() {
  const seconds = Number(process.env.GMAIL_AUTO_POLL_INTERVAL_SECONDS ?? 60);
  return Number.isFinite(seconds) && seconds >= 30 ? seconds * 1000 : 60_000;
}

async function runScheduledGmailPoll() {
  if (isPolling) {
    return;
  }

  isPolling = true;
  try {
    const status = await getGmailStatus();
    if (!status.configured || !status.connected) {
      return;
    }

    const result = await pollGmailMessages();
    if (result.importedCount > 0 || result.failedCount > 0) {
      console.log(`Gmail auto poll: imported ${result.importedCount}, skipped ${result.skippedCount}, failed ${result.failedCount}`);
    }
  } catch (error) {
    console.warn(`Gmail auto poll failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  } finally {
    isPolling = false;
  }
}

export function startGmailPollingScheduler() {
  if (!isAutoPollEnabled()) {
    console.log('Gmail auto poll disabled');
    return;
  }

  const interval = pollIntervalMs();
  console.log(`Gmail auto poll enabled every ${Math.round(interval / 1000)} seconds`);

  const initialTimer = setTimeout(() => void runScheduledGmailPoll(), 5_000);
  const intervalTimer = setInterval(() => void runScheduledGmailPoll(), interval);

  initialTimer.unref?.();
  intervalTimer.unref?.();
}
