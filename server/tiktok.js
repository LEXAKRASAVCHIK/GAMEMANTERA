import { TikTokLiveConnection, WebcastEvent, ControlEvent } from 'tiktok-live-connector';

/**
 * Map a raw gift event to { coins, name, repeat, user }, or null while a
 * streak is still running. Streakable gifts (giftType 1) re-fire with a
 * growing repeatCount, so only the final event (repeatEnd) is counted.
 */
export function normalizeGift(data) {
  const d = data.giftDetails ?? {};
  const ext = data.extendedGiftInfo ?? {};
  if (d.giftType === 1 && !data.repeatEnd) return null;
  return {
    coins: Number(d.diamondCount ?? ext.diamond_count ?? 0),
    name: d.giftName || ext.name || `Gift ${data.giftId}`,
    repeat: Math.max(1, Number(data.repeatCount) || 1),
    user: data.user?.uniqueId ?? 'viewer',
  };
}

/** Feed a live room's likes and gifts into the game, reconnecting on drops. */
export function connectTikTok(game, username, { signApiKey, log = console.log } = {}) {
  let stopped = false;
  let retryMs = 5000;
  let timer = null;

  const connection = new TikTokLiveConnection(username, {
    enableExtendedGiftInfo: true,
    ...(signApiKey ? { signApiKey } : {}),
  });

  connection.on(WebcastEvent.LIKE, (data) => {
    game.onLike(data.likeCount, data.user?.uniqueId ?? 'viewer');
  });

  connection.on(WebcastEvent.GIFT, (data) => {
    const gift = normalizeGift(data);
    if (gift) game.onGift(gift);
  });

  connection.on(WebcastEvent.STREAM_END, () => log('[tiktok] stream ended'));
  connection.on(ControlEvent.ERROR, (err) => log('[tiktok] error:', err?.info ?? err?.message ?? err));
  connection.on(ControlEvent.DISCONNECTED, () => {
    log('[tiktok] disconnected');
    scheduleReconnect();
  });

  function scheduleReconnect() {
    if (stopped || timer) return;
    log(`[tiktok] retrying in ${retryMs / 1000}s`);
    timer = setTimeout(() => {
      timer = null;
      connect();
    }, retryMs);
    retryMs = Math.min(retryMs * 2, 60000);
  }

  async function connect() {
    if (stopped) return;
    try {
      const state = await connection.connect();
      retryMs = 5000;
      log(`[tiktok] connected to @${username} (room ${state.roomId})`);
    } catch (err) {
      // Typically the streamer is offline or the sign server is rate limiting.
      log(`[tiktok] connect failed: ${err?.message ?? err}`);
      scheduleReconnect();
    }
  }

  connect();

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      connection.disconnect();
    },
  };
}
