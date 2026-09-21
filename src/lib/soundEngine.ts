import { DrawingStyle } from '../types';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private noiseNode: AudioBufferSourceNode | null = null;
  private filterNode: BiquadFilterNode | null = null;
  private gainNode: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private isMuted: boolean = false;
  private isPlayingSound: boolean = false;
  private style: DrawingStyle = 'pencil';

  private init() {
    if (this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      // Create pink noise buffer (2 seconds looping)
      const bufferSize = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);

      // Pink noise algorithm (Paul Kellet's filtered white noise)
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }

      this.filterNode = this.ctx.createBiquadFilter();
      this.filterNode.type = 'bandpass';
      this.filterNode.frequency.value = 2400; // Pencil scratch frequency
      this.filterNode.Q.value = 3.5;

      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = 0;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.25;

      // Connect graph
      this.filterNode.connect(this.gainNode);
      this.gainNode.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      // Start continuous looping source
      this.noiseNode = this.ctx.createBufferSource();
      this.noiseNode.buffer = buffer;
      this.noiseNode.loop = true;
      this.noiseNode.connect(this.filterNode);
      this.noiseNode.start(0);

      this.isPlayingSound = true;
    } catch (e) {
      console.warn('Web Audio not available or blocked:', e);
    }
  }

  public setStyle(style: DrawingStyle) {
    this.style = style;
    if (!this.filterNode) return;
    if (style === 'pencil') {
      this.filterNode.frequency.value = 2600;
      this.filterNode.Q.value = 3.2;
    } else if (style === 'charcoal') {
      this.filterNode.frequency.value = 1400;
      this.filterNode.Q.value = 1.8; // Broader, throatier scrape
    } else {
      // Fineliner
      this.filterNode.frequency.value = 3800;
      this.filterNode.Q.value = 4.5; // High-pitch technical nib friction
    }
  }

  public update(isDrawing: boolean, speed: number, pressure: number) {
    if (this.isMuted) return;
    if (!this.ctx) {
      this.init();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    if (!this.gainNode || !this.filterNode) return;

    const now = this.ctx?.currentTime || 0;

    if (!isDrawing || speed < 0.2) {
      // Lift pencil - silent
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setTargetAtTime(0, now, 0.04);
      return;
    }

    // Dynamic modulation based on pencil speed and pressure
    const targetGain = Math.min(0.35, Math.max(0.04, (speed / 15) * 0.2 * (0.6 + pressure * 0.4)));
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setTargetAtTime(targetGain, now, 0.02);

    // Subtle pitch modulation as stroke direction or speed changes
    const baseFreq = this.style === 'charcoal' ? 1400 : this.style === 'fineliner' ? 3800 : 2500;
    const targetFreq = baseFreq + Math.min(800, speed * 25);
    this.filterNode.frequency.setTargetAtTime(targetFreq, now, 0.03);
  }

  public stop() {
    if (!this.gainNode || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setTargetAtTime(0, now, 0.05);
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.isMuted) {
      this.stop();
    }
    return this.isMuted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }
}

export const soundEngine = new SoundEngine();
