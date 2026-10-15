let ctx: AudioContext | null = null;

/** Short two-note chime synthesised locally (no audio files, works offline). */
export function playChime(kind: 'done' | 'warn' = 'done'): void {
  try {
    ctx ??= new AudioContext();
    const notes = kind === 'done' ? [880, 1318.5] : [440, 330];
    notes.forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      const t = ctx!.currentTime + i * 0.12;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  } catch {
    /* audio unavailable */
  }
}
