/*
  Zion — Pacific Standard Time clock helper.

  Tiff is in Washington State. Render runs UTC. Every Zion response,
  document, and timestamp uses PST unless ZION_OWNER_TIMEZONE overrides.

  This module emits a single context block for the system prompt and
  also exposes raw helpers for routes that need the wall-clock value
  directly (timestamps in saved documents, log lines, etc.).
*/

const OWNER_TZ = process.env.ZION_OWNER_TIMEZONE || 'America/Los_Angeles';

function pstNow() {
  return new Date();
}

function formatPstDate(d = new Date()) {
  return d.toLocaleDateString('en-US', {
    timeZone: OWNER_TZ,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function formatPstTime(d = new Date()) {
  return d.toLocaleTimeString('en-US', {
    timeZone: OWNER_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function clockBlock() {
  const now = new Date();
  return `\n\nWALL-CLOCK TIME (you HAVE this — when Tiff asks what time or day it is, answer from here. Do NOT say "I don't know."):\n` +
    `Date: ${formatPstDate(now)}\n` +
    `Time: ${formatPstTime(now)}\n` +
    `Timezone: ${OWNER_TZ} (Tiff is in Washington State)`;
}

module.exports = {
  OWNER_TZ,
  pstNow,
  formatPstDate,
  formatPstTime,
  clockBlock
};
