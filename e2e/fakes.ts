/** A fake YouTube IFrame API with a simulated video clock (`window.__fakeYT`), shared by the e2e tests. */
export const FAKE_YT = `
(() => {
  class FakePlayer {
    constructor(el, opts) {
      this.t = 0; this.state = -1; this.rate = 1; this.vol = 100; this.opts = opts;
      const box = document.createElement('div');
      box.id = 'fake-yt'; box.textContent = 'FAKE VIDEO ' + opts.videoId;
      box.style.cssText = 'width:100%;height:100%;display:grid;place-items:center;color:#fff;background:#333';
      el.replaceWith(box);
      window.__fakeYT = this;
      setTimeout(() => opts.events.onReady && opts.events.onReady(), 50);
      setInterval(() => { if (this.state === 1) this.t += 0.05 * this.rate; }, 50);
    }
    _set(s) { this.state = s; this.opts.events.onStateChange && this.opts.events.onStateChange({ data: s }); }
    playVideo() { if (this.state !== 1) this._set(1); }
    pauseVideo() { if (this.state === 1) this._set(2); }
    seekTo(s) { this.t = s; }
    getCurrentTime() { return this.t; }
    getDuration() { return 120; }
    getPlayerState() { return this.state; }
    setPlaybackRate(r) { this.rate = r; }
    getAvailablePlaybackRates() { return [0.25, 0.5, 0.75, 1, 1.25, 1.5]; }
    setVolume(v) { this.vol = v; }
    mute() {} unMute() {} destroy() {}
  }
  window.YT = { Player: FakePlayer, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
})();`;
